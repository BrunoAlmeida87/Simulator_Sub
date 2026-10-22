/**
 * Cargas a bordo: modelos prontos, nome automático, mapa de bordo clicável (perfil + planta),
 * arrastar para mover, dica com o nome ao passar o mouse, prévia do efeito e compensação opcional.
 * Toda alteração passa por comandos (cargoUpsert / cargoRemove / dosing).
 */
import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { SimulationEngine } from '../../sim/core/engine';
import type { CargoLoad } from '../../sim/core/state';
import type { Vec3 } from '../../sim/core/math';
import { qToMat3, qFromEuler, DEG, RAD } from '../../sim/core/math';
import { cmd } from '../store';
import { fmt, fmtMass } from '../format';
import { usePersisted } from '../persist';
import { WideDiagram } from './WideDiagram';
import {
  CARGO_CATEGORIES,
  CARGO_MODELS,
  CARGO_STYLE,
  CATEGORY_BASE,
  SvgTip,
  cargoMass,
  compensationCommand,
  compensationRoom,
  usableComp,
  cargoTipLines,
  clampInHull,
  compartmentOf,
  heightOf,
  insideHull,
  markerRadius,
  newCargoId,
  nextCargoName,
  sideOf,
  type CargoCategory,
} from './cargoUi';

const MAX_ITEM_KG = 200000;
const blank = (): CargoLoad => ({ id: '', category: 'carga', name: '', quantity: 1, unitMass: 1000, position: { x: 3, y: 0, z: 1 } });

/** Efeito estático estimado de embarcar (ou alterar) uma carga: Δmassa, Δpitch e Δbanda (sem ondas e sem lemes). */
function cargoEffect(e: SimulationEngine, next: CargoLoad, old?: CargoLoad) {
  const g = e.env.cfg.gravity;
  const xB = e.outputs.forces.hs.center.x;
  const mN = cargoMass(next);
  const mO = old ? cargoMass(old) : 0;
  const my = mN * (next.position.x - xB) - (old ? mO * (old.position.x - xB) : 0);
  const mx = mN * next.position.y - (old ? mO * old.position.y : 0);
  return {
    dm: mN - mO,
    dPitch: -Math.atan((g * my) / Math.max(1, e.outputs.pitchStiffness)) * RAD,
    dRoll: Math.atan((g * mx) / Math.max(1, e.outputs.rollStiffness)) * RAD,
  };
}

/** Aciona a compensação para anular dm (kg a mais a bordo ⇒ esgotar), dentro do que os tanques permitem. */
function compensate(e: SimulationEngine, dm: number) {
  const c = compensationCommand(e, dm);
  if (c) cmd(c);
}

type View = 'side' | 'plan';
interface Drag {
  kind: 'load' | 'draft';
  id: string;
  view: View;
  pointer: number;
  startX: number;
  startY: number;
  moved: boolean;
  pos: Vec3;
  orig: Vec3;
}

/** Mapa de bordo: perfil (X–Z) em cima, planta (X–Y) embaixo. Clique posiciona a nova carga; arraste move as existentes. */
function CargoMap({
  e,
  loads,
  draft,
  hover,
  setHover,
  onPlace,
  onMove,
  onSelect,
}: {
  e: SimulationEngine;
  loads: CargoLoad[];
  draft: CargoLoad;
  hover: string | null;
  setHover: (id: string | null) => void;
  onPlace: (p: Vec3) => void;
  onMove: (l: CargoLoad, p: Vec3) => void;
  onSelect: (l: CargoLoad) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const W = 760;
  const H = 276;
  const half = e.vessel.hull.length / 2;
  const kx = 700 / (2 * half);
  const MX = (x: number) => 30 + (x + half) * kx;
  const invX = (px: number) => (px - 30) / kx - half;
  const K = 16;
  const S0 = 78; // eixo do perfil
  const P0 = 216; // eixo da planta
  const SPLIT = 142;
  const SY = (z: number) => S0 + z * K;
  const PY = (y: number) => P0 + y * K;
  const outline = useMemo(() => {
    const top: string[] = [];
    const bot: string[] = [];
    const ptop: string[] = [];
    const pbot: string[] = [];
    for (let i = 0; i <= 120; i++) {
      const x = -half + (i / 120) * 2 * half;
      const r = e.geom.radiusAt(x);
      top.push(`${MX(x).toFixed(1)},${SY(-r).toFixed(1)}`);
      bot.unshift(`${MX(x).toFixed(1)},${SY(r).toFixed(1)}`);
      ptop.push(`${MX(x).toFixed(1)},${PY(-r).toFixed(1)}`);
      pbot.unshift(`${MX(x).toFixed(1)},${PY(r).toFixed(1)}`);
    }
    return { side: `M${top.join(' L')} L${bot.join(' L')} Z`, plan: `M${ptop.join(' L')} L${pbot.join(' L')} Z` };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.geom, half]);

  const toSvg = (ev: RPointerEvent) => {
    const svg = ref.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const p = pt.matrixTransform(m.inverse());
    return { px: p.x, py: p.y };
  };
  const posFrom = (view: View, px: number, py: number, base: Vec3): Vec3 => clampInHull(e, view === 'side' ? { x: invX(px), y: base.y, z: (py - S0) / K } : { x: invX(px), y: (py - P0) / K, z: base.z });

  const startDrag = (ev: RPointerEvent, kind: Drag['kind'], id: string, base: Vec3) => {
    const p = toSvg(ev);
    if (!p) return;
    ev.stopPropagation();
    const view: View = p.py < SPLIT ? 'side' : 'plan';
    ref.current?.setPointerCapture?.(ev.pointerId);
    // a nova carga vai para o ponto clicado ao soltar (no toque, deslizar para rolar não a move)
    const pos = kind === 'draft' ? posFrom(view, p.px, p.py, base) : base;
    setDrag({ kind, id, view, pointer: ev.pointerId, startX: p.px, startY: p.py, moved: false, pos, orig: base });
  };
  const moveDrag = (ev: RPointerEvent) => {
    if (!drag || ev.pointerId !== drag.pointer) return;
    const p = toSvg(ev);
    if (!p) return;
    const moved = drag.moved || Math.hypot(p.px - drag.startX, p.py - drag.startY) > 4;
    if (!moved) return;
    const base = drag.kind === 'draft' ? draft.position : (loads.find((l) => l.id === drag.id)?.position ?? drag.pos);
    const pos = posFrom(drag.view, p.px, p.py, base);
    if (drag.kind === 'draft') onPlace(pos);
    setDrag({ ...drag, moved, pos });
  };
  const endDrag = (ev: RPointerEvent, cancel = false) => {
    if (!drag || ev.pointerId !== drag.pointer) return;
    if (drag.kind === 'draft') {
      if (cancel) {
        if (drag.moved) onPlace(drag.orig);
      } else if (!drag.moved) onPlace(drag.pos);
    }
    if (drag.kind === 'load' && !cancel) {
      const l = loads.find((x) => x.id === drag.id);
      if (l) {
        if (drag.moved) {
          if (l.position.x !== drag.pos.x || l.position.y !== drag.pos.y || l.position.z !== drag.pos.z) onMove(l, drag.pos);
        } else onSelect(l);
      }
    }
    setDrag(null);
  };

  // posição exibida de cada carga (a que está sendo arrastada segue o ponteiro)
  const shown = loads.map((l) => ({ l, p: drag?.kind === 'load' && drag.id === l.id && drag.moved ? drag.pos : l.position }));
  const editing = draft.id ? loads.find((l) => l.id === draft.id) : undefined;
  const draftOk = insideHull(e, draft.position);
  const draftColor = CARGO_STYLE[draft.category].color;
  const dr = markerRadius(cargoMass(draft));
  // rótulos no perfil: acima ou abaixo do marcador, sem sobrepor; os que não cabem ficam só na dica
  const labelRow = new Map<string, number>();
  {
    const ends = [-Infinity, -Infinity];
    for (const { l, p } of [...shown].sort((a, b) => a.p.x - b.p.x)) {
      const r = markerRadius(cargoMass(l));
      const x0 = MX(p.x) + r + 3;
      const w = Math.min(16, l.name.length) * 5.1;
      const row = ends.findIndex((end) => end < x0);
      if (row < 0) continue;
      ends[row] = x0 + w + 4;
      labelRow.set(l.id, row);
    }
  }
  const fixed = e.vessel.mass.variableLoads;

  // dica: carga sob o mouse (ou destacada na tabela), carga de projeto ou a nova carga
  let tip: { x: number; y: number; lines: string[] } | null = null;
  if (hover?.startsWith('fixed:')) {
    const f = fixed.find((x) => 'fixed:' + x.id === hover);
    if (f) tip = { x: MX(f.position.x), y: SY(f.position.z), lines: [f.name, `Carga de projeto: ${fmt(f.mass / 1000, 1)} t (fixa)`, compartmentOf(e, f.position.x)] };
  } else if (hover === '__draft') {
    tip = {
      x: MX(draft.position.x),
      y: SY(draft.position.z),
      lines: [draft.name.trim() || '(sem nome)', editing ? 'Nova posição — clique em Salvar' : 'Nova carga — clique em Embarcar', ...cargoTipLines(e, draft).slice(2)],
    };
  } else if (hover) {
    const it = shown.find((s) => s.l.id === hover);
    if (it) tip = { x: MX(it.p.x), y: SY(it.p.z), lines: cargoTipLines(e, { ...it.l, position: it.p }) };
  }

  const marker = (l: CargoLoad, p: Vec3, view: View) => {
    const st = CARGO_STYLE[l.category];
    const r = markerRadius(cargoMass(l));
    const cx = MX(p.x);
    const cy = view === 'side' ? SY(p.z) : PY(p.y);
    const hot = hover === l.id || draft.id === l.id;
    return (
      <g
        key={l.id + view}
        style={{ cursor: 'grab', touchAction: 'none' }}
        onPointerDown={(ev) => startDrag(ev, 'load', l.id, l.position)}
        onPointerEnter={() => setHover(l.id)}
        onPointerLeave={() => setHover(null)}
        opacity={editing && editing.id === l.id ? 0.35 : 1}
      >
        <circle cx={cx} cy={cy} r={r + 3} fill="transparent" />
        <circle cx={cx} cy={cy} r={r} fill={st.color} stroke={hot ? '#ffffff' : '#0a1017'} strokeWidth={hot ? 2.2 : 1.2} />
        {view === 'side' && labelRow.has(l.id) && (
          <text x={cx + r + 3} y={labelRow.get(l.id) ? cy + r + 7 : cy - r + 1} fontSize="9" fill={hot ? '#ffffff' : '#cfe0f0'} pointerEvents="none" style={{ paintOrder: 'stroke' }} stroke="#0a1017" strokeWidth="2.5">
            {l.name.length > 16 ? l.name.slice(0, 15) + '…' : l.name}
          </text>
        )}
      </g>
    );
  };

  const ghost = (view: View) => {
    const cx = MX(draft.position.x);
    const cy = view === 'side' ? SY(draft.position.z) : PY(draft.position.y);
    return (
      <g style={{ cursor: 'move', touchAction: 'none' }} onPointerDown={(ev) => startDrag(ev, 'draft', '__draft', draft.position)} onPointerEnter={() => setHover('__draft')} onPointerLeave={() => setHover(null)}>
        <circle cx={cx} cy={cy} r={dr + 6} fill="transparent" />
        <circle cx={cx} cy={cy} r={dr} fill={draftColor} fillOpacity={0.25} stroke={draftOk ? draftColor : '#ff5257'} strokeWidth="2" strokeDasharray="3 2" />
        <path d={`M${cx - 4},${cy} H${cx + 4} M${cx},${cy - 4} V${cy + 4}`} stroke="#fff" strokeWidth="1.4" />
        {editing && <line x1={MX(editing.position.x)} y1={view === 'side' ? SY(editing.position.z) : PY(editing.position.y)} x2={cx} y2={cy} stroke={draftColor} strokeDasharray="4 3" pointerEvents="none" />}
      </g>
    );
  };

  const ticks: number[] = [];
  for (let x = Math.ceil(-half / 5) * 5; x <= half; x += 5) ticks.push(x);

  return (
    <WideDiagram minWidth={560}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="svgbox cargo-map" onPointerMove={moveDrag} onPointerUp={(ev) => endDrag(ev)} onPointerCancel={(ev) => endDrag(ev, true)} style={{ userSelect: 'none' }}>
        <rect width={W} height={H} fill="#08131f" rx="4" />
        {/* áreas clicáveis: perfil e planta */}
        <rect x={0} y={0} width={W} height={SPLIT} fill="transparent" style={{ cursor: 'crosshair' }} onPointerDown={(ev) => startDrag(ev, 'draft', '__draft', draft.position)} />
        <rect x={0} y={SPLIT} width={W} height={H - SPLIT} fill="transparent" style={{ cursor: 'crosshair' }} onPointerDown={(ev) => startDrag(ev, 'draft', '__draft', draft.position)} />
        <g pointerEvents="none">
          <text x={6} y={12} fontSize="10" fill="#8fb3d9" fontWeight="700">
            PERFIL (vista lateral)
          </text>
          <text x={128} y={12} fontSize="9.5" fill="#7f93a8">
            clique para escolher a posição longitudinal (X) e a altura (Z) · arraste uma carga para movê-la
          </text>
          <text x={W - 6} y={12} fontSize="10" fill="#a9bdd2" textAnchor="end">
            PROA →
          </text>
          <path d={outline.side} fill="#14263a" stroke="#9fb7cf" strokeWidth="1.2" />
          <line x1={MX(-half)} x2={MX(half)} y1={SY(0)} y2={SY(0)} stroke="#2c4260" strokeDasharray="3 4" />
          <text x={4} y={SY(-1.8)} fontSize="8.5" fill="#7f93a8">
            alto
          </text>
          <text x={4} y={SY(2.2)} fontSize="8.5" fill="#7f93a8">
            porão
          </text>
          {e.vessel.compartments.map((c) => (
            <g key={c.id}>
              <line x1={MX(c.xFwd)} x2={MX(c.xFwd)} y1={SY(-e.geom.radiusAt(c.xFwd))} y2={SY(e.geom.radiusAt(c.xFwd))} stroke="#3a5878" strokeDasharray="2 3" />
              <line x1={MX(c.xAft)} x2={MX(c.xAft)} y1={SY(-e.geom.radiusAt(c.xAft))} y2={SY(e.geom.radiusAt(c.xAft))} stroke="#3a5878" strokeDasharray="2 3" />
              <line x1={MX(c.xFwd)} x2={MX(c.xFwd)} y1={PY(-e.geom.radiusAt(c.xFwd))} y2={PY(e.geom.radiusAt(c.xFwd))} stroke="#3a5878" strokeDasharray="2 3" />
              <line x1={MX(c.xAft)} x2={MX(c.xAft)} y1={PY(-e.geom.radiusAt(c.xAft))} y2={PY(e.geom.radiusAt(c.xAft))} stroke="#3a5878" strokeDasharray="2 3" />
              <text x={(MX(c.xFwd) + MX(c.xAft)) / 2} y={SY(-3.1) - 4} fontSize="9" textAnchor="middle" fill="#8fb3d9">
                {c.name}
              </text>
            </g>
          ))}
          {ticks.map((x) => (
            <text key={x} x={MX(x)} y={SPLIT - 4} fontSize="8.5" textAnchor="middle" fill="#5a6f86">
              {x > 0 ? '+' + x : x}
            </text>
          ))}
          <text x={6} y={SPLIT + 14} fontSize="10" fill="#8fb3d9" fontWeight="700">
            PLANTA (vista de cima)
          </text>
          <text x={136} y={SPLIT + 14} fontSize="9.5" fill="#7f93a8">
            clique para escolher X e o bordo (Y)
          </text>
          <path d={outline.plan} fill="#14263a" stroke="#9fb7cf" strokeWidth="1.2" />
          <line x1={MX(-half)} x2={MX(half)} y1={PY(0)} y2={PY(0)} stroke="#2c4260" strokeDasharray="3 4" />
          <text x={6} y={PY(-1.6)} fontSize="9" fill="#7f93a8">
            BB
          </text>
          <text x={6} y={PY(2)} fontSize="9" fill="#7f93a8">
            BE
          </text>
        </g>
        {/* cargas de projeto (fixas) */}
        {fixed.map((f) => (
          <g key={f.id} onPointerEnter={() => setHover('fixed:' + f.id)} onPointerLeave={() => setHover(null)}>
            <rect x={MX(f.position.x) - 4} y={SY(f.position.z) - 4} width={8} height={8} fill="#5a6f86" stroke="#9fb7cf" strokeWidth="0.8" transform={`rotate(45 ${MX(f.position.x)} ${SY(f.position.z)})`} />
            <rect x={MX(f.position.x) - 4} y={PY(f.position.y) - 4} width={8} height={8} fill="#5a6f86" stroke="#9fb7cf" strokeWidth="0.8" transform={`rotate(45 ${MX(f.position.x)} ${PY(f.position.y)})`} />
          </g>
        ))}
        {shown.map(({ l, p }) => marker(l, p, 'side'))}
        {shown.map(({ l, p }) => marker(l, p, 'plan'))}
        {ghost('side')}
        {ghost('plan')}
        {tip && <SvgTip {...tip} W={W} H={H} />}
      </svg>
    </WideDiagram>
  );
}

export function CargoPanel({ e }: { e: SimulationEngine }) {
  const loads = e.state.cargoLoads ?? [];
  const [draftRaw, setDraft] = useState<CargoLoad>(blank);
  const [nameTouched, setNameTouched] = useState(false);
  /** nome-base do nome automático (modelo ou tipo); o número é o próximo livre, calculado a cada quadro */
  const [autoBase, setAutoBase] = useState('Carga');
  const draft: CargoLoad = nameTouched ? draftRaw : { ...draftRaw, name: nextCargoName(autoBase, loads, draftRaw.id) };
  const [posTouched, setPosTouched] = useState(false);
  const [model, setModel] = useState('');
  const [error, setError] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [massUnit, setMassUnit] = usePersisted<'kg' | 't'>('cargo.massUnit', 'kg');
  const [autoComp, setAutoComp] = usePersisted<boolean>('cargo.autoComp', false);
  const massScale = massUnit === 't' ? 1000 : 1;
  const total = loads.reduce((sum, l) => sum + cargoMass(l), 0);
  const editing = draft.id ? loads.find((l) => l.id === draft.id) : undefined;
  const R = qToMat3(e.state.body.quat);
  const half = e.vessel.hull.length / 2;
  const depthAt = (x: number) => e.state.body.pos.z + R[6] * x + (R[8] * e.vessel.hull.diameter) / 2;
  const levelMoment = e.hydrostaticMoment(e.outputs.mp, qFromEuler(0, 0, e.outputs.euler.heading * DEG));
  const room = compensationRoom(e);
  const compWater = room.water;
  const compBusy = !!e.state.compensation.dosing?.active;
  const suggestions = (['trim', 'heel'] as const).map((system) => {
    const cfg = e.vessel[system];
    const state = e.state[system];
    const arm = system === 'trim' ? cfg.tankA.center.x - cfg.tankB.center.x : cfg.tankB.center.y - cfg.tankA.center.y;
    const moment = system === 'trim' ? levelMoment.y : levelMoment.x;
    const dir = moment < 0 ? ('AtoB' as const) : ('BtoA' as const);
    const source = dir === 'AtoB' ? state.tankA : state.tankB;
    const destination = dir === 'AtoB' ? state.tankB : state.tankA;
    const capacity = (dir === 'AtoB' ? cfg.tankB : cfg.tankA).capacity * 1025;
    return { system, dir, kg: Math.abs(moment / (e.env.cfg.gravity * arm)), limit: Math.max(0, Math.min(source.mass, capacity - destination.mass)) };
  });

  const resetDraft = () => {
    setDraft(blank());
    setNameTouched(false);
    setAutoBase('Carga');
    setPosTouched(false);
    setModel('');
    setError('');
  };
  const pickModel = (id: string) => {
    const m = CARGO_MODELS.find((x) => x.id === id);
    if (!m) return;
    setModel(id);
    if (!nameTouched) setAutoBase(m.base);
    setDraft({
      ...draft,
      category: m.category,
      quantity: m.quantity,
      unitMass: m.unitMass,
      name: draftRaw.name,
      position: posTouched ? draft.position : clampInHull(e, m.position),
    });
    setError('');
  };
  const setPos = (p: Partial<Vec3>) => {
    setDraft({ ...draft, position: clampInHull(e, { ...draft.position, ...p }) });
    setPosTouched(true);
  };

  /** grava a carga (nova ou alterada) e, se pedido, aciona a compensação para a diferença de massa */
  const commit = (next: CargoLoad, old?: CargoLoad) => {
    cmd({ type: 'cargoUpsert', load: next });
    const dm = cargoMass(next) - (old ? cargoMass(old) : 0);
    if (autoComp && Math.abs(dm) >= 1) compensate(e, dm);
  };
  const remove = (l: CargoLoad) => {
    cmd({ type: 'cargoRemove', id: l.id });
    if (autoComp) compensate(e, -cargoMass(l));
    if (draft.id === l.id) resetDraft();
  };
  const validate = (l: CargoLoad): string => {
    const { x, y, z } = l.position;
    if (![l.quantity, l.unitMass, x, y, z].every(Number.isFinite)) return 'Preencha quantidade, massa e posição.';
    if (!Number.isInteger(l.quantity) || l.quantity < 1) return 'A quantidade deve ser um número inteiro a partir de 1.';
    if (l.unitMass <= 0) return 'A massa por unidade deve ser positiva.';
    if (cargoMass(l) > MAX_ITEM_KG) return `Máximo de ${MAX_ITEM_KG / 1000} t por item (agora ${fmt(cargoMass(l) / 1000, 1)} t).`;
    if (Math.abs(x) > half || Math.hypot(y, z) > e.geom.radiusAt(x)) return 'A posição fica fora do casco: clique no mapa ou use os botões de local.';
    return '';
  };
  const apply = () => {
    const name = (draft.name.trim() || nextCargoName(CATEGORY_BASE[draft.category], loads, draft.id)).slice(0, 80);
    const next: CargoLoad = { ...draft, name, id: draft.id || newCargoId() };
    const err = validate(next);
    if (err) {
      setError(err);
      return;
    }
    commit(next, editing);
    if (editing) {
      resetDraft();
      return;
    }
    // nova carga: mantém modelo, quantidade e local para embarcar outra igual; o nome passa ao próximo número
    if (nameTouched) setAutoBase(name.replace(/\s+\d+$/, ''));
    setNameTouched(false);
    // a próxima fica um pouco a ré (ou a vante, no limite), para não cobrir a que acabou de embarcar
    const px = draftRaw.position.x;
    const step = Math.max(1, Math.ceil((markerRadius(cargoMass(next)) * 2 * 2) / 10) / 2);
    const shifted = clampInHull(e, { ...draftRaw.position, x: px - step });
    setDraft({ ...draftRaw, name: '', position: shifted.x !== px ? shifted : clampInHull(e, { ...draftRaw.position, x: px + step }) });
    setPosTouched(true);
    setError('');
  };
  const startEdit = (l: CargoLoad) => {
    setDraft(structuredClone(l));
    setNameTouched(true);
    setPosTouched(true);
    setModel('');
    setError('');
  };
  const duplicate = (l: CargoLoad) => {
    const base = l.name.replace(/\s+\d+$/, '');
    const pos = clampInHull(e, { ...l.position, x: l.position.x - 1.5 });
    commit({ ...structuredClone(l), id: newCargoId(), name: nextCargoName(base, loads), position: pos });
  };
  const changeQty = (l: CargoLoad, dq: number) => {
    const q = l.quantity + dq;
    if (q < 1 || q * l.unitMass > MAX_ITEM_KG) return;
    commit({ ...l, quantity: q }, l);
  };
  const finishRename = () => {
    if (!renaming) return;
    const l = loads.find((x) => x.id === renaming.id);
    const name = renaming.text.trim().slice(0, 80);
    if (l && name && name !== l.name) cmd({ type: 'cargoUpsert', load: { ...l, name } });
    setRenaming(null);
  };
  const clearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    for (const l of loads) cmd({ type: 'cargoRemove', id: l.id });
    if (autoComp) compensate(e, -total);
    setConfirmClear(false);
    resetDraft();
  };

  const effect = cargoEffect(e, draft, editing);
  const draftErr = validate(draft);
  const dupName = draft.name.trim() && loads.some((l) => l.id !== draft.id && l.name.trim().toLowerCase() === draft.name.trim().toLowerCase());
  const byCat = CARGO_CATEGORIES.map((c) => {
    const items = loads.filter((l) => l.category === c);
    return { c, n: items.reduce((a, l) => a + l.quantity, 0), kg: items.reduce((a, l) => a + cargoMass(l), 0) };
  }).filter((x) => x.n > 0);
  const p = draft.position;
  const zones = e.vessel.compartments.map((c) => ({ label: c.name.replace('Compartimento', 'Comp.').replace(' (ré)', ''), x: (c.xFwd + c.xAft) / 2, x0: c.xAft, x1: c.xFwd }));

  return (
    <div className="col cargo-panel">
      <div className="row">
        <span className="badge info">{e.outputs.surfaced ? 'Superfície — maior rigidez longitudinal' : 'Submerso — menor rigidez longitudinal'}</span>
        <b>
          Carga adicional: {fmt(total / 1000, 3)} t em {loads.length} {loads.length === 1 ? 'item' : 'itens'}
        </b>
        {byCat.map((x) => (
          <span key={x.c} className="cargo-chip" style={{ borderColor: CARGO_STYLE[x.c].color }}>
            <i style={{ background: CARGO_STYLE[x.c].color }} />
            {CARGO_STYLE[x.c].label}: {x.n} · {fmtMass(x.kg)}
          </span>
        ))}
        <span className="subtle">Massa total do navio: {fmt(e.outputs.mp.mass / 1000, 3)} t</span>
      </div>

      <div className="cargo-layout">
        <div className="cargo-mapbox">
          <CargoMap
            e={e}
            loads={loads}
            draft={draft}
            hover={hover}
            setHover={setHover}
            onPlace={(pos) => {
              setDraft((d) => ({ ...d, position: pos }));
              setPosTouched(true);
            }}
            onMove={(l, pos) => {
              commit({ ...l, position: pos }, l);
              if (draft.id === l.id) setDraft((d) => ({ ...d, position: pos }));
            }}
            onSelect={startEdit}
          />
          <div className="subtle cargo-legend">
            {CARGO_CATEGORIES.map((c) => (
              <span key={c}>
                <i style={{ background: CARGO_STYLE[c].color }} /> {CARGO_STYLE[c].label}
              </span>
            ))}
            <span>
              <i className="dia" /> carga de projeto (fixa)
            </span>
            <span>
              <i className="ghost" style={{ borderColor: CARGO_STYLE[draft.category].color }} /> {editing ? 'nova posição' : 'nova carga'}
            </span>
            <span>Passe o mouse (ou toque) numa carga para ver o nome; clique para editar; arraste para mover.</span>
          </div>
        </div>

        <div className="cargo-form col">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>{editing ? `Editando: ${editing.name}` : 'Nova carga'}</b>
            {editing && (
              <button className="btn sm" onClick={resetDraft}>
                Cancelar edição
              </button>
            )}
          </div>
          {!editing && (
            <div className="cargo-models">
              {CARGO_MODELS.map((m) => (
                <button
                  key={m.id}
                  className={`btn sm${model === m.id ? ' on' : ''}`}
                  onClick={() => pickModel(m.id)}
                  title={`${m.quantity} × ${m.unitMass} kg · ${CARGO_STYLE[m.category].label}`}
                  style={{ borderLeft: `3px solid ${CARGO_STYLE[m.category].color}` }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
          <div className="row">
            <label>
              Nome{' '}
              <input
                type="text"
                value={draft.name}
                maxLength={80}
                placeholder={nextCargoName(CATEGORY_BASE[draft.category], loads, draft.id)}
                onFocus={(ev) => !nameTouched && ev.target.select()}
                onChange={(ev) => {
                  setDraft({ ...draft, name: ev.target.value });
                  setNameTouched(true);
                }}
                onKeyDown={(ev) => ev.key === 'Enter' && apply()}
                style={{ width: 170 }}
              />
            </label>
            <label>
              Tipo{' '}
              <select
                value={draft.category}
                onChange={(ev) => {
                  const category = ev.target.value as CargoCategory;
                  if (!nameTouched) setAutoBase(CATEGORY_BASE[category]);
                  setDraft({ ...draft, category });
                }}
              >
                {CARGO_CATEGORIES.map((k) => (
                  <option key={k} value={k}>
                    {CARGO_STYLE[k].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {dupName && <span className="badge warn">Já existe uma carga com esse nome — use um nome diferente para distinguir no diagrama.</span>}
          <div className="row">
            <label>
              Quantidade{' '}
              <span className="cargo-step">
                <button className="btn sm" onClick={() => setDraft({ ...draft, quantity: Math.max(1, Math.round(draft.quantity) - 1) })} aria-label="Diminuir quantidade">
                  −
                </button>
                <input type="number" min={1} step={1} value={draft.quantity} onChange={(ev) => setDraft({ ...draft, quantity: Number(ev.target.value) })} style={{ width: 56 }} />
                <button className="btn sm" onClick={() => setDraft({ ...draft, quantity: Math.round(draft.quantity) + 1 })} aria-label="Aumentar quantidade">
                  +
                </button>
              </span>
            </label>
            <label>
              Massa por unidade{' '}
              <input
                type="number"
                min={0.001}
                step={massUnit === 't' ? 0.1 : 10}
                value={Number((draft.unitMass / massScale).toFixed(massUnit === 't' ? 3 : 1))}
                onChange={(ev) => setDraft({ ...draft, unitMass: Number(ev.target.value) * massScale })}
              />
            </label>
            <div className="seg" role="group" aria-label="Unidade de massa">
              <button className={massUnit === 'kg' ? 'on' : ''} onClick={() => setMassUnit('kg')}>
                kg
              </button>
              <button className={massUnit === 't' ? 'on' : ''} onClick={() => setMassUnit('t')}>
                t
              </button>
            </div>
            <b className="mono">= {fmtMass(cargoMass(draft))}</b>
          </div>

          <div className="cargo-where">
            <span className="subtle">Compartimento</span>
            <div className="btngroup">
              {zones.map((z) => (
                <button key={z.label} className={`btn sm${p.x <= z.x1 && p.x >= z.x0 ? ' on' : ''}`} onClick={() => setPos({ x: z.x })}>
                  {z.label}
                </button>
              ))}
            </div>
            <span className="subtle">Bordo</span>
            <div className="btngroup">
              {(
                [
                  ['Bombordo', -1.5, p.y < -0.25],
                  ['Linha de centro', 0, Math.abs(p.y) <= 0.25],
                  ['Boreste', 1.5, p.y > 0.25],
                ] as const
              ).map(([label, y, on]) => (
                <button key={label} className={`btn sm${on ? ' on' : ''}`} onClick={() => setPos({ y })}>
                  {label}
                </button>
              ))}
            </div>
            <span className="subtle">Altura</span>
            <div className="btngroup">
              {(
                [
                  ['Alto', -1.5, p.z < -0.6],
                  ['Meia altura', 0.5, p.z >= -0.6 && p.z <= 1.3],
                  ['Porão', 2, p.z > 1.3],
                ] as const
              ).map(([label, z, on]) => (
                <button key={label} className={`btn sm${on ? ' on' : ''}`} onClick={() => setPos({ z })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <label key={axis} title={axis === 'x' ? 'positivo = vante' : axis === 'y' ? 'positivo = boreste' : 'positivo = para baixo'}>
                {axis.toUpperCase()} (m){' '}
                <input
                  type="number"
                  step={0.5}
                  value={draft.position[axis]}
                  onChange={(ev) => {
                    setDraft({ ...draft, position: { ...draft.position, [axis]: Number(ev.target.value) } });
                    setPosTouched(true);
                  }}
                  style={{ width: 64 }}
                />
              </label>
            ))}
          </div>
          <div className="subtle">
            Local: <b>{compartmentOf(e, p.x)}</b> · {sideOf(p.y)} · {heightOf(p.z)}
          </div>

          <div className="cargo-preview">
            <div>
              Efeito estimado {editing ? 'da alteração' : 'ao embarcar'} <span className="kind CALC">CALC</span>
            </div>
            <div className="mono">
              Δmassa {effect.dm >= 0 ? '+' : '−'}
              {fmtMass(Math.abs(effect.dm))} · Δpitch {fmt(effect.dPitch, 2)}° ({effect.dPitch < -0.005 ? 'proa desce' : effect.dPitch > 0.005 ? 'proa sobe' : 'neutro'}) · Δbanda {fmt(effect.dRoll, 2)}° (
              {effect.dRoll > 0.005 ? 'aderna p/ BE' : effect.dRoll < -0.005 ? 'aderna p/ BB' : 'neutro'})
            </div>
            {Math.abs(effect.dm) >= 10 && (
              <div className="subtle">
                {e.outputs.surfaced
                  ? `Na superfície o calado aumenta um pouco (${effect.dm > 0 ? 'mais' : 'menos'} peso).`
                  : `Submerso: ${effect.dm > 0 ? 'mais pesado, tende a afundar' : 'mais leve, tende a subir'}. Para manter a flutuabilidade, ${effect.dm > 0 ? 'esgotar' : 'admitir'} ≈ ${fmtMass(Math.abs(effect.dm))} na compensação (água disponível: ${fmtMass(compWater)}).`}
              </div>
            )}
          </div>
          <label className="chk" title="Ao embarcar, mover, mudar a quantidade ou desembarcar, aciona a sequência automática da compensação com a mesma massa (esgotar ao embarcar, admitir ao desembarcar)">
            <input type="checkbox" checked={autoComp} onChange={(ev) => setAutoComp(ev.target.checked)} />
            Compensar automaticamente o peso (sequência da compensação)
          </label>
          {autoComp && effect.dm > usableComp(room.water) && (
            <span className="badge warn">Água de compensação insuficiente: a compensação esgota no máximo {fmtMass(usableComp(room.water))}; o restante fica sem compensar.</span>
          )}
          {autoComp && -effect.dm > usableComp(room.free) && (
            <span className="badge warn">Espaço livre insuficiente na compensação: admite no máximo {fmtMass(usableComp(room.free))}; o restante fica sem compensar.</span>
          )}
          {autoComp && compBusy && <span className="subtle">Há uma sequência de compensação em curso: o novo ajuste será somado a ela.</span>}
          <div className="row">
            <button className="btn ok on" onClick={apply} disabled={!!draftErr}>
              {editing ? 'Salvar alterações' : 'Embarcar carga'}
            </button>
            {draftErr && <span className="badge warn">{draftErr}</span>}
          </div>
          {error && (
            <div role="alert" className="badge warn">
              {error}
            </div>
          )}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="t cargo-table">
          <thead>
            <tr>
              <th>Carga</th>
              <th>Tipo</th>
              <th>Quantidade</th>
              <th>kg/unid.</th>
              <th>Total</th>
              <th>Local</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loads.map((l) => (
              <tr key={l.id} className={hover === l.id || draft.id === l.id ? 'focus' : ''} onPointerEnter={() => setHover(l.id)} onPointerLeave={() => setHover(null)}>
                <td>
                  <i className="cargo-dot" style={{ background: CARGO_STYLE[l.category].color }} />
                  {renaming?.id === l.id ? (
                    <input
                      type="text"
                      autoFocus
                      value={renaming.text}
                      maxLength={80}
                      onChange={(ev) => setRenaming({ id: l.id, text: ev.target.value })}
                      onBlur={finishRename}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter') finishRename();
                        if (ev.key === 'Escape') setRenaming(null);
                      }}
                      style={{ width: 150 }}
                    />
                  ) : (
                    <button className="cargo-name" title="Clique para renomear" onClick={() => setRenaming({ id: l.id, text: l.name })}>
                      {l.name} <span aria-hidden>✎</span>
                    </button>
                  )}
                </td>
                <td>{CARGO_STYLE[l.category]?.label ?? l.category}</td>
                <td>
                  <span className="cargo-step">
                    <button className="btn sm" disabled={l.quantity <= 1} onClick={() => changeQty(l, -1)} aria-label={`Diminuir ${l.name}`}>
                      −
                    </button>
                    <span className="mono">{l.quantity}</span>
                    <button className="btn sm" disabled={(l.quantity + 1) * l.unitMass > MAX_ITEM_KG} onClick={() => changeQty(l, 1)} aria-label={`Aumentar ${l.name}`}>
                      +
                    </button>
                  </span>
                </td>
                <td className="mono">{fmt(l.unitMass, 0)}</td>
                <td className="mono">{fmtMass(cargoMass(l))}</td>
                <td title={`X ${l.position.x} / Y ${l.position.y} / Z ${l.position.z} m`}>
                  {compartmentOf(e, l.position.x)}, {sideOf(l.position.y)}
                </td>
                <td className="nowrap">
                  <button className="btn sm" onClick={() => startEdit(l)}>
                    Editar / mover
                  </button>
                  <button className="btn sm" onClick={() => duplicate(l)} title="Cria uma cópia 1,5 m a ré, com o próximo número no nome">
                    Duplicar
                  </button>
                  <button className="btn sm danger" onClick={() => remove(l)}>
                    Desembarcar
                  </button>
                </td>
              </tr>
            ))}
            {!loads.length && (
              <tr>
                <td colSpan={7}>Nenhuma carga adicional. Escolha um modelo, clique no mapa para posicionar e embarque. As cargas de projeto (◆ no mapa) e o peso móvel continuam a bordo.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {loads.length > 0 && (
        <div className="row">
          <button className={`btn sm danger${confirmClear ? ' on' : ''}`} onClick={clearAll} onBlur={() => setConfirmClear(false)}>
            {confirmClear ? `Confirmar: desembarcar todas (${fmtMass(total)})` : 'Desembarcar todas'}
          </button>
        </div>
      )}

      <div className="row mono">
        <span>Banda real: {fmt(e.outputs.euler.roll, 3)}°</span>
        <span>Pitch real: {fmt(e.outputs.euler.pitch, 3)}°</span>
        <span>Profundidade da referência inferior de vante: {fmt(depthAt(half), 3)} m</span>
        <span>Ré: {fmt(depthAt(-half), 3)} m</span>
        <span>Diferença vante − ré: {fmt((depthAt(half) - depthAt(-half)) * 100, 1)} cm</span>
        <button className="btn sm" onClick={() => cmd({ type: 'seaState', value: 0 })}>
          Mar calmo para ensaio
        </button>
      </div>
      <div className="row">
        {suggestions.map((t) => (
          <div key={t.system}>
            <span>
              Correção aproximada de {t.system === 'trim' ? 'trim' : 'banda'}: {fmt(t.kg, 0)} kg {t.dir === 'AtoB' ? 'A → B' : 'B → A'}; disponível {fmt(t.limit, 0)} kg.{' '}
            </span>
            <button
              className="btn sm"
              disabled={t.kg < 10 || t.limit < 10 || !!e.state[t.system].dosing?.active}
              onClick={() => cmd({ type: 'dosing', system: t.system, mode: 'transferir', dir: t.dir, kg: Math.min(t.kg, t.limit) })}
            >
              Transferir {fmt(Math.min(t.kg, t.limit), 0)} kg
            </button>
            {t.kg > t.limit + 1 && <span className="badge warn">Capacidade insuficiente para correção completa</span>}
          </div>
        ))}
      </div>
      <div className="subtle">Sugestões calculadas para nivelar o casco na posição atual, sem ondas ou lemes; reavaliar após a transferência e a mudança de calado. A = tanque de vante/bombordo; B = ré/boreste.</div>
      <div className="note">
        X positivo = vante; Y positivo = boreste; Z positivo = abaixo do eixo do casco. Embarcar altera massa e centro de gravidade; mover conserva a massa. As cargas permanecem durante o mergulho e são salvas com o
        cenário. A compensação só é automática com a opção marcada; caso contrário, corrija pela compensação (flutuabilidade) e pelos tanques de trim e banda.
      </div>
    </div>
  );
}
