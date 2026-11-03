/**
 * Tela ARMAS — console de tiro em três zonas, com a faixa dos tubos em cima:
 *  - TUBO (esquerda): o tubo escolhido, lançamento AUTOMÁTICO ou PASSO A PASSO (dez etapas em ordem: verde = liberada,
 *    cinza = ainda não, âmbar = em andamento, ✓ = feita; a cor vem de tubeSteps, a mesma regra dos intertravamentos da
 *    física), o esquema do tubo, as leituras e a compensação das armas;
 *  - PALCO (centro): abas Cena 3D (câmeras em grupos, dados da arma sobre a cena, plotagem pequena no canto, câmera
 *    automática e tela cheia), Tubo 3D (etapa a etapa) e Plotagem; embaixo, as armas em corrida;
 *  - TIRO (direita): arma de exercício ou de combate, uma lista só de alvos (hostis primeiro, civis recolhidos) e os
 *    dados de tiro da arma que está no tubo; embaixo, o botão DISPARAR com tampa (o mesmo nos dois modos).
 * O instrutor coloca os alvos (submarino inimigo, fragata, alvo em terra) num painel à parte. No celular, abas.
 *
 * Tudo passa por comandos ('tube', 'torpedo', 'enemy', 'hostile'); a física fica em src/sim/systems/weapons.ts e
 * src/sim/systems/missiles.ts. A escolha da arma/alvo acompanhados pela câmera é só exibição (render3d/weaponFocus.ts).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { cmd, useSim } from '../store';
import { Panel } from '../components/Panel';
import { Readout } from '../components/Readout';
import { Scene3D } from '../components/Scene3D';
import { TubeStage3D } from '../components/TubeStage3D';
import { usePersisted } from '../persist';
import { graphics } from '../graphics';
import { geoOriginOf } from '../routeNav';
import { fmt } from '../format';
import { makeDepthOf, RHO_NOMINAL } from '../../sim/core/context';
import { qToMat3 } from '../../sim/core/math';
import { tubeLength, stowedWeaponX } from '../../sim/systems/torpedoTubes';
import { DEFAULT_PRESETS, tubeSteps, tubeView, weaponTargets, weaponsWeight, isEnemyId, type ManualStep, type TubeAction, type TubeView } from '../../sim/systems/weapons';
import { ENEMY_SURFACE_D, isHostileId, kindOf, missileActive, missileRefusal, missileTargets, weaponDims } from '../../sim/systems/missiles';
import type { MissileRun, TorpedoRun, TubePresets, TubeState, WeaponKind, WeaponsState } from '../../sim/core/state';
import type { SimulationEngine } from '../../sim/core/engine';
import type { ViewMode } from '../../render3d/SubmarineScene';
import type { TubeLabelGroup, TubeStagePreset } from '../../render3d/TubeStage';
import { defaultLayers, type SceneLayers } from '../../render3d/layers';
import { weaponFollow } from '../../render3d/weaponFocus';

const KT = 1852 / 3600;
/** prazo para disparar depois de levantar a tampa (como o sopro de emergência) */
const ARM_MS = 5000;
const TONE_BADGE: Record<TubeView['tone'], string> = { off: 'off', busy: 'info', ready: 'ok', warn: 'warn' };
const PHASE: Record<TorpedoRun['phase'], [string, string]> = {
  afastamento: ['AFASTAMENTO', 'info'],
  guiado: ['GUIADO PELO FIO', 'info'],
  busca: ['CORRIDA', 'info'],
  ataque: ['ATAQUE', 'warn'],
  flutuando: ['FIM DE CORRIDA', 'off'],
  recolher: ['FLUTUANDO', 'ok'],
  explodiu: ['EXPLODIU', 'alarm'],
  perdido: ['AFUNDOU', 'off'],
};
const MPHASE: Record<MissileRun['phase'], [string, string]> = {
  capsula: ['CÁPSULA SUBINDO', 'info'],
  superficie: ['ROMPEU A SUPERFÍCIE', 'info'],
  separacao: ['SEPARAÇÃO', 'info'],
  acelerador: ['ACELERADOR', 'warn'],
  cruzeiro: ['CRUZEIRO', 'info'],
  busca: ['AUTODIRETOR BUSCANDO', 'info'],
  terminal: ['TERMINAL', 'warn'],
  subida: ['SUBIDA', 'warn'],
  mergulho: ['MERGULHO', 'warn'],
  impacto: ['IMPACTO', 'alarm'],
  passagem: ['SAINDO DA ROTA (EXERCÍCIO)', 'info'],
  caindo: ['SEM COMBUSTÍVEL', 'off'],
  perdido: ['CAIU', 'off'],
};
const STEP_ICON: Record<ManualStep['state'], string> = { feito: '✓', andamento: '…', liberado: '›', bloqueado: '🔒' };
const TORP_DONE = new Set<TorpedoRun['phase']>(['flutuando', 'recolher', 'explodiu', 'perdido']);
const WEAPON_VIEWS = new Set<ViewMode>(['torpedo', 'missil', 'missilCine', 'alvo']);
const SUB_VIEWS: [ViewMode, string][] = [
  ['perspectiva', 'Proa ¾'],
  ['perfil', 'Perfil'],
  ['frente', 'Frente'],
  ['perseguicao', 'Perseguição'],
  ['livre', 'Livre'],
];
const STAGE_PRESETS: [TubeStagePreset, string][] = [
  ['tres4', '¾'],
  ['lado', 'Lado'],
  ['boca', 'Boca'],
  ['culatra', 'Culatra'],
  ['cima', 'Cima'],
];

type StageTab = 'cena' | 'tubo' | 'plot';
type MobileTab = 'tubo' | 'tiro' | 'palco' | 'instrutor';
type Lane = 'lancar' | 'recarregar';
type InstrKind = 'sub' | 'fragata' | 'terra';
type Fired = { kind: 'torpedo'; r: TorpedoRun } | { kind: 'missil'; r: MissileRun };

/** contexto de leitura da pressão do mar na boca de cada tubo */
function seaCtx(e: SimulationEngine) {
  const s = e.state;
  return { env: e.env, depthOf: makeDepthOf(s.body.pos, qToMat3(s.body.quat)), rhoLocal: e.env.densityAt(Math.max(0, s.body.pos.z)) };
}

interface Target {
  id: string;
  name: string;
  n: number;
  e: number;
  course: number;
  speed: number;
  range: number;
  bearing: number;
  enemy: boolean;
  d?: number;
}

function useTargets(e: SimulationEngine): Target[] {
  const s = e.state;
  const origin = geoOriginOf(e);
  const traffic = graphics.get().traffic;
  return weaponTargets(e.env, origin, s.t, traffic, s.weapons)
    .map((c) => {
      const dn = c.n - s.body.pos.x;
      const de = c.e - s.body.pos.y;
      return { id: c.id, name: c.name, n: c.n, e: c.e, course: c.course, speed: c.speed, range: Math.hypot(dn, de), bearing: ((Math.atan2(de, dn) * 180) / Math.PI + 360) % 360, enemy: !!c.enemy, d: c.d };
    })
    .sort((a, b) => Number(b.enemy) - Number(a.enemy) || a.range - b.range);
}

/** layout compacto do projeto (≤ 760 px, com ou sem toque) */
function useNarrow(): boolean {
  const q = '(max-width: 760px)';
  const [on, setOn] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const m = matchMedia(q);
    const f = () => setOn(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return on;
}

const km = (m: number) => (m >= 1000 ? `${fmt(m / 1000, 1)} km` : `${fmt(m, 0)} m`);
const deg3 = (x: number) =>
  Math.round(((x % 360) + 360) % 360)
    .toString()
    .padStart(3, '0') + '°';
const mmss = (sec: number) =>
  `${Math.floor(sec / 60)}:${Math.round(sec % 60)
    .toString()
    .padStart(2, '0')}`;
const shortName = (n: string) => n.replace(' (classe Tamandaré, alvo fictício)', '').replace(' (instalação fictícia)', '').replace(' (fictício)', '');
const relBearing = (b: number) => (b > 0 ? `${b}° BE` : b < 0 ? `${-b}° BB` : 'pela proa');

function firedOf(ws: WeaponsState): Fired[] {
  const out: Fired[] = [...ws.runs.map((r) => ({ kind: 'torpedo' as const, r })), ...(ws.missiles ?? []).map((r) => ({ kind: 'missil' as const, r }))];
  return out.sort((a, b) => b.r.tFire - a.r.tFire);
}
const isActive = (f: Fired) => (f.kind === 'torpedo' ? !TORP_DONE.has(f.r.phase) : missileActive(f.r));
const missilePhase = (r: MissileRun): [string, string] => (r.phase === 'perdido' && r.hit ? ['CAIU AO LADO DO ALVO', 'ok'] : MPHASE[r.phase]);

/** linha da lista única de alvos */
interface TargetRow {
  id: string;
  tag: string;
  name: string;
  info: string;
  status?: string;
  hostile: boolean;
  dead: boolean;
  /** motivo de o alvo não servir para a arma do tubo (null = serve) */
  invalid: string | null;
  out: boolean;
  remove?: () => void;
}

export function WeaponsScreen() {
  const e = useSim(10);
  const s = e.state;
  const v = e.vessel;
  const w = v.weapons;
  const ws = s.weapons;
  const narrow = useNarrow();
  const [sel, setSel] = usePersisted('armas.tubo', 1);
  const [draft, setDraft] = useState<Record<number, TubePresets>>({});
  const [mode, setMode] = usePersisted<'auto' | 'manual'>('armas.modo', 'manual');
  const [stage, setStage] = usePersisted<StageTab>('armas.palco', 'cena');
  const [mtab, setMtab] = usePersisted<MobileTab>('armas.celular', 'tubo');
  const [view, setViewRaw] = usePersisted<ViewMode>('armas.vista', 'perspectiva');
  const [subView, setSubView] = usePersisted<ViewMode>('armas.vistaSub', 'perspectiva');
  const [autoCam, setAutoCam] = usePersisted('armas.camAuto', false);
  const [follow, setFollowState] = useState<string | null>(weaponFollow.id);
  const [cut, setCut] = usePersisted('armas.corte', false);
  const [lbl3d, setLbl3d] = usePersisted('armas.rotulos3d', true);
  const [depthRef, setDepthRef] = usePersisted('armas.refProf', false);
  const [full, setFull] = useState(false);
  const [camKey, setCamKey] = useState(0);
  const [tsCut, setTsCut] = usePersisted('armas.tubo3d.corte', true);
  const [tsFlows, setTsFlows] = usePersisted('armas.tubo3d.fluxos', true);
  const [tsLbl, setTsLbl] = usePersisted<Record<TubeLabelGroup, boolean>>('armas.tubo3d.rotulos', { pecas: true, valvulas: true, valores: true });
  const [tsHidden, setTsHidden] = usePersisted<string[]>('armas.tubo3d.ocultos', []);
  const [tsPreset, setTsPreset] = useState<{ key: number; p: TubeStagePreset } | undefined>(undefined);
  const [enemyCfg, setEnemyCfg] = usePersisted('armas.inimigo', { range: 3000, bearing: 20, depth: 60, speed: 5 });
  const [hostCfg, setHostCfg] = usePersisted('armas.alvoSuperficie', { range: 25000, bearing: 20, course: 90, speed: 15, landRange: 8000, landBearing: 0 });
  const [ikind, setIkind] = usePersisted<InstrKind>('armas.instrutor.tipo', 'sub');
  const [instrOpen, setInstrOpen] = usePersisted('armas.instrutor.aberto', true);
  const [civOpen, setCivOpen] = usePersisted('armas.civis', false);
  // arma da reserva para recarga e troca: começa no torpedo F21
  const [loadKind, setLoadKind] = usePersisted<WeaponKind>('armas.recarga', 'f21');
  const [lanePin, setLanePin] = useState<Partial<Record<Lane, boolean>>>({});
  const [armedAt, setArmedAt] = useState(0);
  const autoRef = useRef<{ last: string | null; endAt: number | null; init: boolean }>({ last: null, endAt: null, init: false });
  const targets = useTargets(e);
  const ctx = useMemo(() => seaCtx(e), [e, s.t]);

  const fired = ws ? firedOf(ws) : [];
  const latest = fired[0] ?? null;
  const followed = follow ? (fired.find((f) => f.r.id === follow) ?? null) : null;
  const lead = followed ?? fired.find(isActive) ?? latest;
  const armaView: ViewMode = lead?.kind === 'missil' ? 'missil' : 'torpedo';

  const setFollow = (id: string | null) => {
    weaponFollow.id = id;
    setFollowState(id);
  };
  /** troca de câmera pelo operador (desliga a câmera automática) */
  const camera = (vw: ViewMode) => {
    setAutoCam(false);
    setViewRaw(vw);
    setCamKey((k) => k + 1);
  };

  // "Arma" acompanha a última arma lançada (ou a escolhida): torpedo ou míssil
  useEffect(() => {
    if ((view === 'torpedo' || view === 'missil') && lead && armaView !== view) setViewRaw(armaView);
  }, [view, armaView, lead?.r.id]);

  // câmera automática: arma no disparo, alvo perto do impacto do torpedo, volta ao submarino depois do fim
  useEffect(() => {
    if (!autoCam || !latest) return;
    const st = autoRef.current;
    // ao abrir a tela, as armas que já estavam na lista não mudam a câmera
    if (!st.init) {
      st.init = true;
      st.last = latest.r.id;
      st.endAt = isActive(latest) ? null : s.t;
      return;
    }
    let want: ViewMode | null = null;
    if (latest.r.id !== st.last) {
      st.last = latest.r.id;
      st.endAt = null;
      setFollow(null);
      want = latest.kind === 'missil' ? 'missilCine' : 'torpedo';
    } else if (isActive(latest)) {
      const r = latest.r;
      if (latest.kind === 'torpedo' && view === 'torpedo' && r.target && isEnemyId(r.target) && r.tgt && r.tgt.range < 450) {
        weaponFollow.target = r.target;
        want = 'alvo';
      }
    } else {
      st.endAt ??= s.t;
      if (s.t - st.endAt > 15 && WEAPON_VIEWS.has(view)) want = subView;
    }
    if (want && want !== view) {
      setViewRaw(want);
      setCamKey((k) => k + 1);
    }
  });

  // tela cheia da cena: Esc sai
  useEffect(() => {
    if (!full) return;
    const k = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [full]);

  // tampa do disparo: baixa sozinha depois de 5 s e ao trocar de tubo
  useEffect(() => {
    if (!armedAt) return;
    const id = window.setTimeout(() => setArmedAt(0), ARM_MS);
    return () => window.clearTimeout(id);
  }, [armedAt]);
  useEffect(() => {
    setArmedAt(0);
    setLanePin({});
  }, [sel]);

  if (!w || !ws) return <div className="note">Este navio não tem tubos lançadores na configuração.</div>;

  const views = w.tubes.map((_, i) => tubeView(v, s, ctx, e.geom.radiusAt, i));
  const i = Math.max(
    0,
    w.tubes.findIndex((t) => t.n === sel),
  );
  const tc = w.tubes[i];
  const t = ws.tubes[i];
  const tv = views[i];
  const pr: TubePresets = draft[tc.n] ?? t.presets;
  const setPr = (p: Partial<TubePresets>) => setDraft({ ...draft, [tc.n]: { ...pr, ...p } });
  const origin = geoOriginOf(e);
  const traffic = graphics.get().traffic;
  const hasMissile = !!w.missile;
  const load: WeaponKind = hasMissile ? loadKind : 'f21';
  const reserveOf = (k: WeaponKind) => (k === 'sm39' ? (ws.reserveSm39 ?? 0) : ws.reserve);
  const order = (action: TubeAction, n = tc.n, kind: WeaponKind = load) => cmd({ type: 'tube', tube: n, action, presets: n === tc.n ? { ...pr, load: kind } : undefined, origin, traffic });
  // os dados de tiro seguem a arma que ESTÁ no tubo (tubo vazio: nenhum)
  const isSm39 = hasMissile && !!t.weapon && kindOf(t) === 'sm39';
  const weaponName = t.weapon ? (kindOf(t) === 'sm39' ? 'SM39' : 'F21') : 'vazio';
  const mTargets = hasMissile
    ? missileTargets(e.env, origin, s.t, traffic, ws).map((c) => ({
        ...c,
        range: Math.hypot(c.n - s.body.pos.x, c.e - s.body.pos.y),
        bearing: ((Math.atan2(c.e - s.body.pos.y, c.n - s.body.pos.x) * 180) / Math.PI + 360) % 360,
      }))
    : [];
  const hostiles = ws.hostiles ?? [];
  const enemies = ws.enemies ?? [];
  const busy = t.auto !== null || t.eject !== null || t.reload !== null || t.unload != null;
  const combat = pr.warhead === 'combate';
  const combatBad = !!t.weapon && (isSm39 ? !!missileRefusal(ws, pr) : combat && !!pr.target && !isEnemyId(pr.target));
  const steps = tubeSteps(v, s, ctx, e.geom.radiusAt, i, pr);
  const current = steps.find((x) => x.state === 'andamento') ?? steps.find((x) => x.state === 'liberado') ?? null;
  const fogo = steps.find((x) => x.action === 'fogo');
  const armed = armedAt > 0 && performance.now() - armedAt < ARM_MS;
  const torpRange = w.weapon.range[pr.speed];
  const maxRange = isSm39 ? (w.missile?.range ?? 5e4) : torpRange;

  // ---------- alvos: uma lista só (hostis primeiro, depois os civis)
  const own = s.body.pos;
  const rngOf = (n: number, ee: number) => Math.hypot(n - own.x, ee - own.y);
  const brgOf = (n: number, ee: number) => ((Math.atan2(ee - own.y, n - own.x) * 180) / Math.PI + 360) % 360;
  const hostileRows: TargetRow[] = [
    ...enemies.map((x): TargetRow => {
      const r = rngOf(x.n, x.e);
      const dead = x.sunk !== null;
      const surf = x.d <= ENEMY_SURFACE_D + 2;
      return {
        id: x.id,
        tag: 'SUB',
        name: x.name,
        info: `${km(r)} · ${deg3(brgOf(x.n, x.e))} · ${surf ? 'na superfície' : `cota ${fmt(x.d, 0)} m`} · ${fmt(x.speed / KT, 0)} nós`,
        status: dead ? `atingido — afundando (${fmt(x.d, 0)} m)` : x.evading ? 'FUGINDO' : x.hits ? `${x.hits} acerto(s) de exercício` : undefined,
        hostile: true,
        dead,
        invalid: isSm39 && !surf ? 'o SM39 só atinge submarino na superfície' : null,
        out: !dead && r > maxRange,
        remove: () => cmd({ type: 'enemy', action: 'remove', id: x.id }),
      };
    }),
    ...hostiles.map((h): TargetRow => {
      const r = rngOf(h.n, h.e);
      const dead = h.sunk !== null;
      const land = h.type === 'terra';
      return {
        id: h.id,
        tag: land ? 'TER' : 'FRG',
        name: shortName(h.name),
        info: land ? `${km(r)} · ${deg3(brgOf(h.n, h.e))} · ${fmt(h.ground, 0)} m de altitude` : `${km(r)} · ${deg3(brgOf(h.n, h.e))} · ${fmt(h.speed / KT, 0)} nós · rumo ${deg3(h.course)}`,
        status: dead ? (land ? 'destruído' : 'destruída — afundando') : h.tHit !== null ? 'EM CHAMAS' : h.evading ? 'MANOBRA EVASIVA' : h.hits ? `${h.hits} acerto(s) de exercício` : undefined,
        hostile: true,
        dead,
        invalid: !isSm39 && land ? 'alvo em terra: só com o míssil SM39' : null,
        out: !dead && r > maxRange,
        remove: () => cmd({ type: 'hostile', action: 'remove', id: h.id }),
      };
    }),
  ];
  const civilRows: TargetRow[] = (isSm39 ? mTargets.filter((c) => !c.hostile) : targets.filter((c) => !isEnemyId(c.id) && !isHostileId(c.id)))
    .map((c): TargetRow => ({
      id: c.id,
      tag: 'NAV',
      name: shortName(c.name),
      info: `${km(c.range)} · ${deg3(c.bearing)}`,
      hostile: false,
      dead: false,
      invalid: null,
      out: c.range > maxRange,
    }))
    .sort((a, b) => Number(a.out) - Number(b.out));
  const allRows = [...hostileRows, ...civilRows];
  const selRow = pr.target ? allRows.find((x) => x.id === pr.target) : undefined;
  const selectTarget = (id: string | null, hostile = false) => setPr({ target: id, ...(id && !hostile ? { warhead: 'exercicio' as const } : {}) });
  const aimAt = (id: string) => setPr({ target: id, warhead: 'combate' });
  const camOn = (id: string) => {
    weaponFollow.target = id;
    camera('alvo');
    setStage('cena');
    if (narrow) setMtab('palco');
  };

  // ---------- dados do alvo escolhido (linha de informação)
  const tgtTorp = pr.target ? targets.find((x) => x.id === pr.target) : undefined;
  const tgtMis = pr.target ? mTargets.find((x) => x.id === pr.target) : undefined;
  let tgtInfo: string | null = null;
  if (t.weapon && !isSm39 && tgtTorp)
    tgtInfo = `Rumo ${deg3(tgtTorp.course)}, ${fmt(tgtTorp.speed / KT, 1)} nós${tgtTorp.d !== undefined ? `, cota ${fmt(tgtTorp.d, 0)} m` : ''}. Corrida ≈ ${fmt(tgtTorp.range / w.weapon.speeds[pr.speed] / 60, 1)} min. ${combat ? 'Combate: desce à cota do alvo e explode pela espoleta de proximidade.' : 'Exercício: passa sob o alvo na cota ajustada e flutua para ser recolhida.'}`;
  if (isSm39 && tgtMis && w.missile)
    tgtInfo = `${tgtMis.kind !== 'terra' ? `Rumo ${deg3(tgtMis.course)}, ${fmt(tgtMis.speed / KT, 0)} nós` : `${fmt(tgtMis.ground, 0)} m de altitude`}. Voo ≈ ${fmt(tgtMis.range / w.missile.cruiseSpeed / 60 + 0.2, 1)} min a ${fmt(w.missile.cruiseSpeed * 3.6, 0)} km/h. ${combat ? 'Combate: ogiva de 165 kg, um impacto destrói o alvo.' : 'Exercício: sai da rota a 1,5 km e cai no mar ao lado do alvo.'}`;

  // ---------- disparo (lugar fixo, com tampa)
  const fireBlock: string | null = !t.weapon
    ? 'tubo vazio'
    : t.eject !== null
      ? 'disparo em andamento'
      : t.reload !== null || t.unload != null
        ? 'recarga em andamento'
        : t.auto
          ? `sequência automática em andamento (${t.auto})`
          : combatBad
            ? isSm39
              ? (missileRefusal(ws, pr) ?? 'alvo recusado')
              : 'combate só contra submarino inimigo'
            : mode === 'manual' && fogo?.state !== 'liberado'
              ? fogo?.state === 'feito'
                ? 'arma já disparada'
                : `faça as etapas 1 a 4${fogo?.why ? ` (${fogo.why})` : ''}`
              : null;
  const fireLabel = `${mode === 'auto' && !tv.ready ? 'PREPARAR E DISPARAR' : 'DISPARAR'} · TUBO ${tc.n}`;
  const doFire = () => {
    order(mode === 'auto' ? 'disparar' : 'fogo');
    setArmedAt(0);
  };

  // ---------- câmeras e cena
  const hasWeapon = fired.length > 0;
  const hasTarget = enemies.length + hostiles.length > 0;
  const hasMissiles = (ws.missiles ?? []).length > 0;
  const noSubject =
    (view === 'torpedo' || view === 'missil') && !hasWeapon
      ? 'Nenhuma arma lançada: a câmera mostra o submarino.'
      : view === 'missilCine' && !hasMissiles
        ? 'Nenhum míssil lançado: a câmera mostra o submarino.'
        : view === 'alvo' && !hasTarget
          ? 'Nenhum alvo colocado: a câmera mostra o submarino. Coloque um no painel do instrutor.'
          : null;
  const layers: Partial<SceneLayers> = {
    ...defaultLayers(),
    torpedoes: true,
    tanks: cut,
    pipes: cut,
    flows: cut,
    labels: lbl3d,
    ships: true,
    wake: true,
    trail: true,
    depthLines: depthRef,
    wind: false,
    batteryInfo: false,
  };
  const hudW: Fired | null =
    view === 'torpedo'
      ? followed?.kind === 'torpedo'
        ? followed
        : (fired.find((f) => f.kind === 'torpedo' && isActive(f)) ?? fired.find((f) => f.kind === 'torpedo') ?? null)
      : view === 'missil' || view === 'missilCine'
        ? followed?.kind === 'missil'
          ? followed
          : (fired.find((f) => f.kind === 'missil' && isActive(f)) ?? fired.find((f) => f.kind === 'missil') ?? null)
        : lead;
  const showHud = !!hudW && (isActive(hudW) || s.t - hudW.r.tFire < 900);
  const labelAction = {
    hint: (id: string) => {
      const tid = id.startsWith('ini_') || id.startsWith('hst_') ? id.slice(4) : id.startsWith('ship') ? id.slice(4) : null;
      const row = tid ? allRows.find((x) => x.id === tid && !x.dead) : undefined;
      return row ? `Clique para escolher ${row.name} como alvo do tubo ${tc.n}` : null;
    },
    run: (id: string) => {
      const tid = id.startsWith('ini_') || id.startsWith('hst_') || id.startsWith('ship') ? id.slice(4) : id;
      const row = allRows.find((x) => x.id === tid);
      if (row) selectTarget(row.id, row.hostile);
    },
  };
  const zone = (tab: MobileTab) => (narrow && mtab !== tab ? ' m-hide' : '');

  // ---------- instrutor
  const placeTarget = () => {
    if (ikind === 'sub') cmd({ type: 'enemy', action: 'add', range: enemyCfg.range, bearing: enemyCfg.bearing, depth: enemyCfg.depth, speed: enemyCfg.speed * KT });
    else if (ikind === 'fragata') cmd({ type: 'hostile', action: 'add', kind: 'fragata', range: hostCfg.range, bearing: hostCfg.bearing, course: hostCfg.course, speed: hostCfg.speed * KT });
    else cmd({ type: 'hostile', action: 'add', kind: 'terra', range: hostCfg.landRange, bearing: hostCfg.bearing });
  };
  const instrKinds: [InstrKind, string][] = hasMissile
    ? [
        ['sub', 'Submarino inimigo'],
        ['fragata', 'Fragata'],
        ['terra', 'Alvo em terra'],
      ]
    : [['sub', 'Submarino inimigo']];
  const ik: InstrKind = hasMissile ? ikind : 'sub';

  return (
    <div className={`weapons-screen wx${full ? ' is-full' : ''}${narrow ? ' is-narrow' : ''}`} data-stage={stage}>
      {/* ---------- faixa dos tubos */}
      <section className="wx-strip" aria-label="Tubos lançadores">
        <div className="wx-tubes">
          {[...w.tubes]
            .sort((a, b) => a.row - b.row || (a.side === 'BB' ? -1 : 1))
            .map((x) => {
              const k = w.tubes.indexOf(x);
              const st = ws.tubes[k];
              const vw = views[k];
              return (
                <button
                  key={x.n}
                  className={`wx-tube tone-${vw.tone} ${x.n === tc.n ? 'on' : ''}`}
                  onClick={() => setSel(x.n)}
                  title={`Tubo ${x.n} (${x.side === 'BE' ? 'boreste' : 'bombordo'}) — ${st.weapon ? weaponDims(w, kindOf(st)).name : 'vazio'}: ${vw.status}`}
                  aria-pressed={x.n === tc.n}
                >
                  <span className="wx-muzzle">
                    <TubeMuzzle st={st} full={vw.fullWater} />
                  </span>
                  <span className="wx-tube-txt">
                    <b>
                      {x.n} <span className="wx-side">{x.side}</span> <span className={`wx-kind k-${st.weapon ? kindOf(st) : 'vazio'}`}>{st.weapon ? weaponDims(w, kindOf(st)).name : '—'}</span>
                    </b>
                    <small>{vw.status}</small>
                  </span>
                </button>
              );
            })}
        </div>
        <div className="wx-stock">
          <span>
            Reserva F21 <b>{ws.reserve}</b>
            {hasMissile && (
              <>
                {' '}
                · SM39 <b>{ws.reserveSm39 ?? 0}</b>
              </>
            )}
          </span>
          <span>
            lançadas <b>{ws.fired}</b>
            {fired.some(isActive) && (
              <>
                {' '}
                · em corrida <b className="wx-live">{fired.filter(isActive).length}</b>
              </>
            )}
          </span>
        </div>
      </section>

      {narrow && (
        <nav className="wx-mtabs" role="tablist" aria-label="Partes da tela Armas">
          {(
            [
              ['tubo', 'Tubo'],
              ['tiro', 'Tiro'],
              ['palco', '3D'],
              ['instrutor', 'Instrutor'],
            ] as [MobileTab, string][]
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={mtab === id} className={mtab === id ? 'on' : ''} onClick={() => setMtab(id)}>
              {label}
            </button>
          ))}
        </nav>
      )}

      <div className="wx-console">
        {/* ---------- TUBO */}
        <Panel
          className={`wx-zone z-tube${zone('tubo')}`}
          title={
            <>
              Tubo {tc.n} · {tc.side === 'BE' ? 'boreste' : 'bombordo'} · {weaponName}
            </>
          }
          right={<span className={`badge ${TONE_BADGE[tv.tone]}`}>{tv.status}</span>}
        >
          {hasMissile && (
            <div className="wx-load">
              <span>Recarga e troca:</span>
              <div className="seg">
                {(['f21', 'sm39'] as WeaponKind[]).map((k) => (
                  <button key={k} className={load === k ? 'on' : ''} onClick={() => setLoadKind(k)} title={k === 'sm39' ? 'Míssil antinavio SM39 (Exocet) na cápsula VSM' : 'Torpedo pesado F21'}>
                    {k === 'sm39' ? 'SM39' : 'F21'} ({reserveOf(k)})
                  </button>
                ))}
              </div>
              {t.weapon && kindOf(t) !== load && (
                <button
                  className="btn sm"
                  disabled={busy || t.door.pos > 0.001 || reserveOf(load) <= 0}
                  onClick={() => order('trocar')}
                  title={t.door.pos > 0.001 ? 'Feche a porta da boca antes de trocar a arma' : 'Devolve a arma do tubo à reserva e carrega a escolhida (poucos segundos)'}
                >
                  Trocar por {load === 'sm39' ? 'SM39' : 'F21'}
                </button>
              )}
            </div>
          )}
          <div className="wx-mode" role="tablist" aria-label="Modo de lançamento">
            <button role="tab" aria-selected={mode === 'manual'} className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>
              Passo a passo
            </button>
            <button role="tab" aria-selected={mode === 'auto'} className={mode === 'auto' ? 'on' : ''} onClick={() => setMode('auto')}>
              Automático
            </button>
          </div>
          {mode === 'auto' ? (
            <div className="wx-auto">
              <button className="wx-big" disabled={!t.weapon || busy || tv.ready} onClick={() => order('preparar')} title="Alimentar a arma, alagar com a água do TCA, equalizar com o mar e abrir a porta da boca">
                Preparar
              </button>
              <button className="wx-big" disabled={busy || t.door.pos <= 0.001} onClick={() => order('fechar')} title="Fechar a porta da boca e isolar o tubo do mar">
                Fechar porta
              </button>
              <button className="wx-big" disabled={busy || t.weapon || reserveOf(load) <= 0} onClick={() => order('recarregar')} title="Fechar a porta, drenar para o TCA, abrir a culatra e puxar uma arma da reserva">
                Recarregar {load === 'sm39' ? 'SM39' : 'F21'}
              </button>
              <button className="wx-big" onClick={() => order('dados')} title="Passar os dados de tiro à arma (registrados no histórico)">
                Passar dados
              </button>
              {t.auto && t.auto !== 'disparar' && (
                <div className="wx-running">
                  <span>Sequência automática: {t.auto}…</span>
                  <button className="btn sm" onClick={() => order('cancelar')}>
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="wx-steps">
              {(['lancar', 'recarregar'] as const).map((g) => {
                const list = steps.filter((x) => x.group === g);
                const open = lanePin[g] ?? (current ? current.group === g : g === 'lancar');
                const done = list.filter((x) => x.state === 'feito').length;
                return (
                  <div key={g} className="wx-lane">
                    <button className="wx-lane-head" aria-expanded={open} onClick={() => setLanePin({ ...lanePin, [g]: !open })}>
                      <span>
                        {open ? '▾' : '▸'} {g === 'lancar' ? 'Lançamento' : 'Recarga'}
                      </span>
                      <small>
                        {done}/{list.length} feitas
                      </small>
                    </button>
                    {open &&
                      list.map((x) => {
                        const isFire = x.action === 'fogo';
                        return (
                          <button
                            key={x.action}
                            className={`wx-step st-${x.state}`}
                            disabled={x.state !== 'liberado' || (isFire && !!fireBlock)}
                            onClick={() => (isFire ? setArmedAt(performance.now()) : order(x.action))}
                            title={`${x.hint}${x.why ? `\nAinda não: ${x.why}` : ''}${isFire ? '\nO disparo é feito pelo botão DISPARAR, com tampa.' : ''}`}
                          >
                            <span className="wx-num">{x.state === 'feito' ? '✓' : x.n}</span>
                            <span className="wx-step-txt">
                              <b>{x.label}</b>
                              <small>
                                {x.state === 'bloqueado' ? x.why : x.state === 'andamento' ? 'em andamento…' : x.state === 'feito' ? 'feito' : isFire ? 'liberado — levanta a tampa do DISPARAR' : 'liberado — clique'}
                              </small>
                            </span>
                            <span className="wx-ico">{STEP_ICON[x.state]}</span>
                            {x.state === 'andamento' && <span className="wx-prog" style={{ width: `${Math.round(100 * Math.max(0.03, Math.min(1, x.progress ?? 0)))}%` }} />}
                          </button>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          )}
          <div className="wx-diagram">
            <TubeDiagram e={e} i={i} tv={tv} />
          </div>
          <div className="wx-reads">
            <Readout label="Água no tubo" value={t.water / RHO_NOMINAL} unit="m³" digits={2} kind="CALC" title={`Cheio com a arma: ${fmt(tv.fullWater / RHO_NOMINAL, 2)} m³`} />
            <Readout label="Pressão no tubo" value={t.pressure / 1e5} unit="bar" digits={2} kind="CALC" />
            <Readout label="Mar na boca" value={tv.seaPressure / 1e5} unit="bar" digits={2} kind="CALC" />
            <Readout label="Garrafa" value={tv.flaskBar} unit="bar" digits={0} kind="CALC" title={`Garrafa de lançamento. Mínimo para disparar: ${fmt(w.flask.minPressure / 1e5, 0)} bar`} />
          </div>
          <details className="wx-fold">
            <summary>Compensação automática das armas</summary>
            <div className="wx-reads">
              {w.tca.map((k, j) => (
                <Readout key={k.id} label={k.name.split(' ')[0]} value={ws.tca[j].mass / RHO_NOMINAL} unit="m³" digits={2} kind="CALC" title={`${k.name} — capacidade ${fmt(k.capacity, 1)} m³`} />
              ))}
              <Readout label="Admissão / descarga" value={ws.awcFlow} unit="kg/s" digits={1} kind="CALC" title="+ admitindo do mar, − descarregando" />
              <Readout label="Desvio de peso" value={weightError(e)} unit="kg" digits={0} kind="CALC" title="Peso de referência − peso atual (armas, água dos tubos, TCA e reserva)" />
              <Readout label="Trim corrigido" value={-(ws.awcTrim ?? 0) / 1000} unit="t·m" digits={1} kind="CALC" title="Momento já corrigido por transferências TT-AV ↔ TT-AR" />
            </div>
            <p className="note">
              Ao alagar, a água sai do TCA para o tubo (peso igual, mais a vante). No disparo sai a arma ({fmt(w.weapon.mass, 0)} kg) e entra no tubo o mar no lugar dela ({fmt(w.weapon.volume, 2)} m³): a compensação
              admite a diferença no TCA e, com os tubos parados, transfere água entre os tanques de trim para anular o binário.
            </p>
          </details>
        </Panel>

        {/* ---------- PALCO */}
        <section className={`panel wx-zone z-stage${zone('palco')}${full ? ' full' : ''}`} aria-label="Palco: cena 3D, tubo 3D e plotagem">
          <header className="wx-stage-head">
            <div className="wx-tabs" role="tablist" aria-label="Palco">
              {(
                [
                  ['cena', 'Cena 3D'],
                  ['tubo', 'Tubo 3D'],
                  ['plot', 'Plotagem'],
                ] as [StageTab, string][]
              ).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={stage === id} className={stage === id ? 'on' : ''} onClick={() => setStage(id)}>
                  {label}
                </button>
              ))}
            </div>
            <button className="wx-icon" onClick={() => setFull(!full)} title={full ? 'Sair da tela cheia (Esc)' : 'Tela cheia (Esc sai)'} aria-pressed={full}>
              {full ? '✕ Sair' : '⛶ Tela cheia'}
            </button>
          </header>

          {/* cena 3D */}
          <div className="wx-pane wx-pane-cena" hidden={stage !== 'cena'}>
            <div className="wx-cambar">
              <span className="lbl">Seguir</span>
              <button
                className={view === 'torpedo' || view === 'missil' ? 'on' : ''}
                disabled={!hasWeapon}
                onClick={() => camera(armaView)}
                title={hasWeapon ? 'Acompanha a última arma lançada (ou a escolhida em Em corrida)' : 'Nenhuma arma lançada'}
              >
                Arma
              </button>
              <button
                className={view === 'alvo' ? 'on' : ''}
                disabled={!hasTarget}
                onClick={() => {
                  weaponFollow.target = null;
                  camera('alvo');
                }}
                title={hasTarget ? 'Acompanha o alvo da última arma (ou o escolhido na lista de alvos)' : 'Nenhum alvo colocado'}
              >
                Alvo
              </button>
              <span className="sep" />
              <button
                className={view === 'missilCine' ? 'on' : ''}
                disabled={!hasMissiles}
                onClick={() => camera('missilCine')}
                title={hasMissiles ? 'Planos automáticos do míssil: cápsula subindo, saída da água, voo rasante e impacto' : 'Nenhum míssil lançado'}
              >
                Cinema
              </button>
              <span className="sep" />
              <select
                className={WEAPON_VIEWS.has(view) ? '' : 'on'}
                value={WEAPON_VIEWS.has(view) ? subView : view}
                onChange={(ev) => {
                  const vw = ev.target.value as ViewMode;
                  setSubView(vw);
                  camera(vw);
                }}
                aria-label="Câmera no submarino"
                title="Câmeras no submarino"
              >
                {SUB_VIEWS.map(([id, label]) => (
                  <option key={id} value={id}>
                    Submarino: {label}
                  </option>
                ))}
              </select>
              <button
                className={autoCam ? 'on' : ''}
                aria-pressed={autoCam}
                onClick={() => {
                  autoRef.current = { last: latest?.r.id ?? null, endAt: null, init: true };
                  setAutoCam(!autoCam);
                }}
                title="Câmera automática: vai para a arma no disparo, para o alvo perto do impacto e volta ao submarino depois"
              >
                Auto
              </button>
              <details className="wx-opts">
                <summary>Camadas ▾</summary>
                <div className="wx-opts-menu">
                  <Toggle on={cut} set={setCut} label="Corte (armas nos tubos)" />
                  <Toggle on={lbl3d} set={setLbl3d} label="Identificações" />
                  <Toggle on={depthRef} set={setDepthRef} label="Referência de profundidade" title="Linhas de profundidade a cada 25 m" />
                </div>
              </details>
            </div>
            <div className="wx-scene">
              <Scene3D view={view} viewKey={camKey} layers={layers} cutaway={cut} persistKey="armas" syncVisual={false} style={{ position: 'absolute', inset: 0 }} labelAction={labelAction}>
                {showHud && hudW && <WeaponHud f={hudW} />}
                {noSubject && <div className="wx-nosubj hud">{noSubject}</div>}
                {!narrow && (hasWeapon || hasTarget) && (
                  <button className="wx-pip" onClick={() => setStage('plot')} title="Plotagem (clique para abrir)">
                    <TacticalPlot e={e} targets={targets} sel={pr.target} compact />
                  </button>
                )}
              </Scene3D>
            </div>
            <p className="note">
              Arraste para girar em volta da arma ou do alvo (a câmera continua acompanhando), roda para aproximar; clique de novo no botão para voltar ao enquadramento padrão. Clique no nome de um alvo para mirar nele;
              nas outras identificações, o clique oculta.
            </p>
          </div>

          {/* tubo 3D */}
          <div className="wx-pane wx-pane-tubo" hidden={stage !== 'tubo'}>
            <TubeStage3D
              tube={tc.n}
              cut={tsCut}
              flows={tsFlows}
              labels={tsLbl}
              focus={current?.action ?? null}
              preset={tsPreset}
              hidden={tsHidden}
              onHide={(id) => setTsHidden([...tsHidden.filter((x) => x !== id), id])}
              style={{ flex: '1 1 auto', minHeight: 300 }}
            >
              <div className="wx-stage-bar">
                {STAGE_PRESETS.map(([p, l]) => (
                  <button key={p} onClick={() => setTsPreset({ key: (tsPreset?.key ?? 0) + 1, p })}>
                    {l}
                  </button>
                ))}
                {tsHidden.length > 0 && (
                  <button className="wx-restore" onClick={() => setTsHidden([])} title="Mostrar de novo as identificações ocultas">
                    {tsHidden.length === 1 ? '1 oculta' : `${tsHidden.length} ocultas`} · mostrar
                  </button>
                )}
              </div>
              {current && (
                <div className={`wx-stage-cap st-${current.state}`}>
                  <b>
                    {current.n}. {current.label}
                  </b>
                  <span>{current.hint}</span>
                </div>
              )}
            </TubeStage3D>
            <div className="wx-toggles">
              <Toggle on={tsCut} set={setTsCut} label="Corte" title="Meio tubo aberto (desligado: tubo de vidro)" />
              <Toggle on={tsFlows} set={setTsFlows} label="Fluxos" title="Escoamento nas tubulações e bolhas" />
              <Toggle on={tsLbl.pecas} set={(b) => setTsLbl({ ...tsLbl, pecas: b })} label="Peças" />
              <Toggle on={tsLbl.valvulas} set={(b) => setTsLbl({ ...tsLbl, valvulas: b })} label="Válvulas" />
              <Toggle on={tsLbl.valores} set={(b) => setTsLbl({ ...tsLbl, valores: b })} label="Valores" />
            </div>
            <p className="note">
              As peças da etapa atual aparecem com o nome; as outras viram um ponto (o nome aparece ao passar o mouse). A peça da etapa pisca em amarelo. Arraste para girar, roda ou pinça para aproximar, botão direito
              (ou dois dedos) para deslocar; clique numa identificação para ocultá-la.
            </p>
          </div>

          {/* plotagem */}
          <div className="wx-pane wx-pane-plot" hidden={stage !== 'plot'}>
            <TacticalPlot e={e} targets={targets} sel={pr.target} onPick={(id, hostile) => selectTarget(id, hostile)} />
          </div>

          {/* armas em corrida */}
          {fired.length > 0 && (
            <div className="wx-runs" aria-label="Armas em corrida">
              {fired.slice(0, 8).map((f) => (
                <RunCard
                  key={f.r.id}
                  f={f}
                  targets={targets}
                  followed={follow === f.r.id}
                  onFollow={() => {
                    if (follow === f.r.id) setFollow(null);
                    else {
                      setFollow(f.r.id);
                      camera(f.kind === 'missil' ? 'missil' : 'torpedo');
                      setStage('cena');
                      if (narrow) setMtab('palco');
                    }
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {/* ---------- TIRO */}
        <Panel
          className={`wx-zone z-shot${zone('tiro')}`}
          title={<>Tiro · tubo {tc.n}</>}
          right={<span className={`wx-kind k-${t.weapon ? kindOf(t) : 'vazio'}`}>{t.weapon ? (isSm39 ? 'míssil SM39' : 'torpedo F21') : 'vazio'}</span>}
        >
          {!t.weapon ? (
            <div className="wx-empty">
              <p>
                <b>Tubo {tc.n} vazio.</b> Recarregue para ajustar os dados de tiro. Os alvos abaixo continuam disponíveis.
              </p>
              <div className="row">
                {(hasMissile ? (['f21', 'sm39'] as WeaponKind[]) : (['f21'] as WeaponKind[])).map((k) => (
                  <button
                    key={k}
                    className="btn"
                    disabled={busy || reserveOf(k) <= 0}
                    onClick={() => {
                      setLoadKind(k);
                      order('recarregar', tc.n, k);
                    }}
                    title="Fechar a porta, drenar para o TCA, abrir a culatra e puxar uma arma da reserva"
                  >
                    Recarregar {k === 'sm39' ? 'SM39' : 'F21'} ({reserveOf(k)})
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="wx-warhead" role="radiogroup" aria-label="Arma de exercício ou de combate">
              <button
                role="radio"
                aria-checked={!combat}
                className={!combat ? 'on ex' : 'ex'}
                onClick={() => setPr({ warhead: 'exercicio' })}
                title={isSm39 ? 'Sem ogiva: sai da rota a 1,5 km e cai no mar ao lado do alvo' : 'Passa sob o alvo, registra o acerto e flutua para ser recolhida'}
              >
                <span aria-hidden>◎</span> Exercício
              </button>
              <button
                role="radio"
                aria-checked={combat}
                className={combat ? 'on cb' : 'cb'}
                onClick={() => setPr({ warhead: 'combate' })}
                title={isSm39 ? 'Ogiva de 165 kg: um impacto destrói o alvo (só contra alvo hostil)' : 'Ogiva real: explode no submarino inimigo (alvo fictício)'}
              >
                <span aria-hidden>✹</span> Combate
              </button>
            </div>
          )}

          <div className="wx-list" role="list" aria-label="Alvos">
            <button role="listitem" className={`wx-trow ${!pr.target ? 'on' : ''}`} onClick={() => selectTarget(null)}>
              <span className="wx-tag">—</span>
              <span className="wx-trow-txt">
                <b>Sem alvo</b>
                <small>{isSm39 ? 'autodiretor no rumo' : 'corrida no rumo'}</small>
              </span>
            </button>
            {hostileRows.length === 0 && <p className="wx-hint">Nenhum alvo hostil. O instrutor coloca submarino inimigo{hasMissile ? ', fragata ou alvo em terra' : ''} no painel do instrutor.</p>}
            {hostileRows.map((x) => (
              <div key={x.id} role="listitem" className={`wx-trow hostile ${pr.target === x.id ? 'on' : ''} ${x.dead ? 'dead' : ''} ${x.out || x.invalid ? 'dim' : ''}`}>
                <button className="wx-trow-main" disabled={x.dead} onClick={() => selectTarget(x.id, true)} title={x.invalid ?? (x.out ? 'Fora de alcance da arma do tubo' : `Escolher ${x.name} como alvo`)}>
                  <span className="wx-tag red">{x.tag}</span>
                  <span className="wx-trow-txt">
                    <b>{x.name}</b>
                    <small>
                      {x.info}
                      {x.out ? ' · fora de alcance' : ''}
                    </small>
                    {x.status && <small className="st">{x.status}</small>}
                  </span>
                </button>
                <span className="wx-trow-acts">
                  {!x.dead && (
                    <button
                      className={`btn sm ${pr.target === x.id && combat ? 'on' : ''}`}
                      disabled={!!x.invalid || !t.weapon}
                      onClick={() => aimAt(x.id)}
                      title={!t.weapon ? 'Tubo vazio' : (x.invalid ?? `Mirar o tubo ${tc.n} neste alvo com a arma de combate`)}
                    >
                      Mirar
                    </button>
                  )}
                  <button className="btn sm" onClick={() => camOn(x.id)} title="Câmera neste alvo">
                    Câmera
                  </button>
                  {x.remove && (
                    <button className="btn sm" onClick={x.remove} title="Remover o alvo" aria-label={`Remover ${x.name}`}>
                      ✕
                    </button>
                  )}
                </span>
              </div>
            ))}
            {civilRows.length > 0 && (
              <button className="wx-civ-head" aria-expanded={civOpen} onClick={() => setCivOpen(!civOpen)}>
                {civOpen ? '▾' : '▸'} Contatos civis ({civilRows.length}) <small>só exercício</small>
              </button>
            )}
            {(civOpen || (selRow && !selRow.hostile)) &&
              civilRows
                .filter((x) => civOpen || x.id === pr.target)
                .map((x) => (
                  <button
                    key={x.id}
                    role="listitem"
                    className={`wx-trow ${pr.target === x.id ? 'on' : ''} ${x.out ? 'dim' : ''}`}
                    onClick={() => selectTarget(x.id)}
                    title={x.out ? 'Fora de alcance da arma do tubo' : 'Alvo de exercício'}
                  >
                    <span className="wx-tag">{x.tag}</span>
                    <span className="wx-trow-txt">
                      <b>{x.name}</b>
                      <small>
                        {x.info}
                        {x.out ? ' · fora de alcance' : ''}
                      </small>
                    </span>
                  </button>
                ))}
          </div>

          {t.weapon && (
            <div className="wx-fields">
              {isSm39 ? (
                <>
                  <div className="wx-field">
                    <span>Subida da cápsula VSM</span>
                    <div className="seg">
                      {(['obliqua', 'vertical'] as const).map((k) => (
                        <button
                          key={k}
                          className={(pr.climb ?? 'obliqua') === k ? 'on' : ''}
                          onClick={() => setPr({ climb: k })}
                          title={k === 'vertical' ? 'Quase vertical (≈ 75°): rompe a superfície perto do submarino' : 'Oblíqua (≈ 45°): rompe a superfície a ~150–200 m'}
                        >
                          {k === 'vertical' ? 'Quase vertical' : 'Oblíqua 45°'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="wx-field">
                    <span>
                      Desvio da cápsula <b>{pr.dogleg ? `${Math.abs(pr.dogleg)}° ${pr.dogleg > 0 ? 'BE' : 'BB'}` : 'nenhum'}</b>
                    </span>
                    <input
                      type="range"
                      min={-40}
                      max={40}
                      step={5}
                      value={pr.dogleg ?? 0}
                      onChange={(ev) => setPr({ dogleg: Number(ev.target.value) })}
                      title="A cápsula guina debaixo d'água antes de subir: o míssil não denuncia a posição do submarino"
                    />
                  </label>
                </>
              ) : (
                <>
                  <div className="wx-field wide">
                    <span>Velocidade</span>
                    <div className="seg">
                      {(['baixa', 'alta'] as const).map((sp) => (
                        <button key={sp} className={pr.speed === sp ? 'on' : ''} onClick={() => setPr({ speed: sp })} title={`Alcance ${fmt(w.weapon.range[sp] / 1000, 0)} km`}>
                          {sp} · {fmt(w.weapon.speeds[sp] / KT, 0)} nós · {fmt(w.weapon.range[sp] / 1000, 0)} km
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="wx-field">
                    <span>
                      Cota de corrida <b>{fmt(pr.depth, 0)} m</b>
                    </span>
                    <input type="range" min={3} max={300} step={1} value={pr.depth} onChange={(ev) => setPr({ depth: Number(ev.target.value) || DEFAULT_PRESETS.depth })} />
                  </label>
                </>
              )}
              {!pr.target && (
                <label className="wx-field">
                  <span>Rumo (vazio = do submarino)</span>
                  <input
                    className="num"
                    type="number"
                    min={0}
                    max={359}
                    placeholder="auto"
                    value={pr.course ?? ''}
                    onChange={(ev) => setPr({ course: ev.target.value === '' ? null : Number(ev.target.value) })}
                    style={{ width: 90 }}
                  />
                </label>
              )}
            </div>
          )}
          {t.weapon && selRow && tgtInfo && (
            <p className="note">
              <b>{selRow.name}</b>: {selRow.info}. {tgtInfo}
            </p>
          )}
          {combatBad && <div className="wx-alert">{isSm39 ? `${missileRefusal(ws, pr)}.` : 'A arma de combate só pode ser usada contra um submarino inimigo. Escolha um alvo SUB ou troque para exercício.'}</div>}
          {isSm39 && (
            <p className="note">
              A cápsula VSM sai do tubo, acende o motor e sobe; rompe a superfície, ejeta o nariz; a ~20 m o míssil se separa, abre as asas e acende o acelerador; depois voa rente ao mar a Mach 0,93.
            </p>
          )}
        </Panel>

        {/* ---------- DISPARO (lugar fixo, com tampa) */}
        <div className={`wx-fire z-fire${armed ? ' armed' : ''}${fireBlock ? ' blocked' : ''}`} role="region" aria-label="Disparo">
          {t.auto === 'disparar' ? (
            <>
              <b>PREPARANDO PARA DISPARAR…</b>
              <button onClick={() => order('cancelar')}>Cancelar</button>
              <small>O tubo {tc.n} dispara sozinho quando ficar pronto.</small>
            </>
          ) : armed && !fireBlock ? (
            <>
              <b>TAMPA LEVANTADA</b>
              <button className="fire" onClick={doFire}>
                {fireLabel}
              </button>
              <small>
                {combat ? 'Arma de COMBATE' : 'Arma de exercício'}
                {selRow ? ` · alvo ${selRow.name}` : ' · sem alvo'} ·{' '}
                <button className="link" onClick={() => setArmedAt(0)}>
                  baixar tampa
                </button>
              </small>
            </>
          ) : (
            <>
              <b>DISPARO · TUBO {tc.n}</b>
              <button disabled={!!fireBlock} onClick={() => setArmedAt(performance.now())} title={fireBlock ? `Ainda não: ${fireBlock}` : 'Primeiro levante a tampa; depois, em até 5 s, dispare'}>
                ⛉ Levantar tampa
              </button>
              <small>{fireBlock ? `Ainda não: ${fireBlock}` : mode === 'auto' && !tv.ready ? 'O automático prepara o tubo e dispara.' : 'Tubo pronto.'}</small>
            </>
          )}
        </div>
      </div>

      {/* ---------- INSTRUTOR */}
      <section className={`panel instr-panel wx-instr${narrow && mtab !== 'instrutor' ? ' m-hide' : ''}`} aria-label="Instrutor: colocar alvo">
        <header>
          <h3>
            <button className="panel-fold" aria-expanded={instrOpen || narrow} onClick={() => setInstrOpen(!instrOpen)}>
              <span className="car">{instrOpen || narrow ? '▾' : '▸'}</span> Instrutor — colocar alvo (fictício)
            </button>
          </h3>
          {hostileRows.length > 0 && (
            <button
              className="btn sm"
              onClick={() => {
                if (enemies.length) cmd({ type: 'enemy', action: 'clear' });
                if (hostiles.length) cmd({ type: 'hostile', action: 'clear' });
              }}
            >
              Remover todos os alvos
            </button>
          )}
        </header>
        {(instrOpen || narrow) && (
          <div className="body">
            <div className="wx-instr-row">
              {instrKinds.length > 1 && (
                <div className="seg" role="radiogroup" aria-label="Tipo de alvo">
                  {instrKinds.map(([k, label]) => (
                    <button key={k} role="radio" aria-checked={ik === k} className={ik === k ? 'on' : ''} onClick={() => setIkind(k)}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <div className="wx-fields">
                {ik === 'sub' && (
                  <>
                    <label className="wx-field">
                      <span>
                        Distância <b>{km(enemyCfg.range)}</b>
                      </span>
                      <input type="range" min={600} max={12000} step={100} value={enemyCfg.range} onChange={(ev) => setEnemyCfg({ ...enemyCfg, range: Number(ev.target.value) })} />
                    </label>
                    <label className="wx-field">
                      <span>
                        Marcação relativa <b>{relBearing(enemyCfg.bearing)}</b>
                      </span>
                      <input type="range" min={-180} max={180} step={5} value={enemyCfg.bearing} onChange={(ev) => setEnemyCfg({ ...enemyCfg, bearing: Number(ev.target.value) })} />
                    </label>
                    <label className="wx-field">
                      <span>
                        Cota <b>{enemyCfg.depth > 0 ? `${enemyCfg.depth} m` : 'na superfície'}</b>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={250}
                        step={5}
                        value={enemyCfg.depth < 15 && enemyCfg.depth > 0 ? 15 : enemyCfg.depth}
                        onChange={(ev) => setEnemyCfg({ ...enemyCfg, depth: Number(ev.target.value) < 15 && Number(ev.target.value) > 0 ? 0 : Number(ev.target.value) })}
                        title="0 = navegando na superfície (alvo também do míssil SM39)"
                      />
                    </label>
                    <label className="wx-field">
                      <span>
                        Velocidade <b>{enemyCfg.speed} nós</b>
                      </span>
                      <input type="range" min={0} max={15} step={1} value={enemyCfg.speed} onChange={(ev) => setEnemyCfg({ ...enemyCfg, speed: Number(ev.target.value) })} />
                    </label>
                  </>
                )}
                {ik === 'fragata' && (
                  <>
                    <label className="wx-field">
                      <span>
                        Distância <b>{km(hostCfg.range)}</b>
                      </span>
                      <input type="range" min={3000} max={60000} step={1000} value={hostCfg.range} onChange={(ev) => setHostCfg({ ...hostCfg, range: Number(ev.target.value) })} />
                    </label>
                    <label className="wx-field">
                      <span>
                        Marcação relativa <b>{relBearing(hostCfg.bearing)}</b>
                      </span>
                      <input type="range" min={-180} max={180} step={5} value={hostCfg.bearing} onChange={(ev) => setHostCfg({ ...hostCfg, bearing: Number(ev.target.value) })} />
                    </label>
                    <label className="wx-field">
                      <span>
                        Rumo da fragata <b>{deg3(hostCfg.course)}</b>
                      </span>
                      <input type="range" min={0} max={355} step={5} value={hostCfg.course} onChange={(ev) => setHostCfg({ ...hostCfg, course: Number(ev.target.value) })} />
                    </label>
                    <label className="wx-field">
                      <span>
                        Velocidade <b>{hostCfg.speed} nós</b>
                      </span>
                      <input type="range" min={0} max={26} step={1} value={hostCfg.speed} onChange={(ev) => setHostCfg({ ...hostCfg, speed: Number(ev.target.value) })} />
                    </label>
                  </>
                )}
                {ik === 'terra' && (
                  <>
                    <label className="wx-field">
                      <span>
                        A partir de <b>{km(hostCfg.landRange)}</b>
                      </span>
                      <input type="range" min={1000} max={50000} step={500} value={hostCfg.landRange} onChange={(ev) => setHostCfg({ ...hostCfg, landRange: Number(ev.target.value) })} />
                    </label>
                    <label className="wx-field">
                      <span>
                        Marcação relativa <b>{relBearing(hostCfg.bearing)}</b>
                      </span>
                      <input type="range" min={-180} max={180} step={5} value={hostCfg.bearing} onChange={(ev) => setHostCfg({ ...hostCfg, bearing: Number(ev.target.value) })} />
                    </label>
                  </>
                )}
              </div>
              <button className="wx-big instr" onClick={placeTarget} title="Acrescenta o alvo fictício (registrado no histórico)">
                Colocar {ik === 'sub' ? 'submarino inimigo' : ik === 'fragata' ? 'fragata' : 'alvo em terra'}
              </button>
            </div>
            <p className="note">
              {ik === 'sub'
                ? 'O inimigo aparece na distância e marcação escolhidas, cruzando a proa do SX-1. Com cota 0 ele navega na superfície e também pode ser alvo do míssil SM39.'
                : ik === 'fragata'
                  ? 'Fragata classe Tamandaré (alvo fictício). Ela manobra a toda força quando percebe o míssil a ~9 km.'
                  : 'A instalação fica no primeiro ponto de terra na marcação escolhida, a partir da distância ajustada (só nos cenários com costa).'}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function Toggle({ on, set, label, title }: { on: boolean; set: (b: boolean) => void; label: string; title?: string }) {
  return (
    <button className={`wx-tog ${on ? 'on' : ''}`} onClick={() => set(!on)} title={title} aria-pressed={on}>
      {label}
    </button>
  );
}

/** dados da arma acompanhada, sobre a cena */
function WeaponHud({ f }: { f: Fired }) {
  const r = f.r;
  const active = isActive(f);
  const isT = f.kind === 'torpedo';
  const [ph] = isT ? PHASE[(r as TorpedoRun).phase] : missilePhase(r as MissileRun);
  const tgt = r.tgt;
  const speedTxt = isT ? `${fmt(r.speed / KT, 0)} nós` : `${fmt(r.speed * 3.6, 0)} km/h`;
  const posTxt = isT ? `cota ${fmt(r.d, 0)} m` : -r.d >= 0 ? `${fmt(-r.d, 0)} m de altitude` : `${fmt(r.d, 0)} m de profundidade`;
  const eta = active && tgt && r.speed > 1 ? tgt.range / r.speed : null;
  const prog = tgt ? Math.max(0, Math.min(1, r.run / Math.max(1, r.run + tgt.range))) : null;
  let result: string | null = null;
  if (!active) {
    if (isT) {
      const tr = r as TorpedoRun;
      result = tr.hit
        ? tr.phase === 'explodiu'
          ? `ALVO ATINGIDO — ${shortName(tr.hit.name)}`
          : `ACERTO — passou a ${fmt(tr.hit.dist, 0)} m de ${shortName(tr.hit.name)}`
        : (tr.endReason ?? (Number.isFinite(tr.closest) ? `menor distância ${km(tr.closest)}` : null));
    } else {
      const mr = r as MissileRun;
      result = mr.hit ? (mr.phase === 'impacto' ? `ALVO ATINGIDO — ${shortName(mr.hit.name)} destruído` : `ACERTO — ${mr.endReason ?? 'exercício'}`) : mr.endReason;
    }
  }
  return (
    <div className={`hud wx-hud ${active ? '' : 'done'} ${r.hit ? 'hit' : ''}`}>
      <b>
        {r.id} · {isT ? 'F21' : 'SM39'} · {r.presets.warhead === 'combate' ? 'COMBATE' : 'EXERCÍCIO'}
      </b>
      <span className="ph">{ph}</span>
      {active ? (
        <>
          <span>
            {speedTxt} · {posTxt}
          </span>
          <span>
            {tgt ? `alvo ${shortName(tgt.name)} a ${km(tgt.range)}` : 'sem alvo travado'}
            {eta !== null ? ` · ≈ ${mmss(eta)}` : ''}
          </span>
          {prog !== null && (
            <span className="bar" aria-hidden>
              <i style={{ width: `${Math.round(prog * 100)}%` }} />
            </span>
          )}
        </>
      ) : (
        result && <span>{result}</span>
      )}
    </div>
  );
}

/** cartão de uma arma lançada (torpedo ou míssil) */
function RunCard({ f, targets, followed, onFollow }: { f: Fired; targets: Target[]; followed: boolean; onFollow: () => void }) {
  const active = isActive(f);
  if (f.kind === 'torpedo') {
    const r = f.r;
    const [ph, tone] = PHASE[r.phase];
    return (
      <div className={`wx-run ${followed ? 'on' : ''} ${active ? '' : 'done'}`}>
        <div className="wx-run-head">
          <span className="wx-kind k-f21">F21</span>
          <b>{r.id}</b>
          <small>tubo {r.tube}</small>
          {r.presets.warhead === 'combate' && <span className="wx-tag cb">COMBATE</span>}
          <span className={`badge ${tone}`}>{ph}</span>
          {r.hit && <span className="badge ok">{r.phase === 'explodiu' ? 'ALVO ATINGIDO' : 'ACERTO'}</span>}
        </div>
        <div className="wx-run-data">
          {fmt(r.speed / KT, 0)} nós · cota {fmt(r.d, 0)} m · {km(r.run)} · fio {r.wire ? 'ligado' : '—'}
        </div>
        <div className="wx-run-tgt">
          {r.tgt ? `${shortName(r.tgt.name)} — ${km(r.tgt.range)}` : r.target ? r.target : 'sem alvo'}
          {r.hit && ` · passou a ${fmt(r.hit.dist, 0)} m, cota ${fmt(r.hit.depth, 0)} m`}
          {!r.hit && !active && r.target && Number.isFinite(r.closest) && ` · menor distância ${km(r.closest)}`}
        </div>
        <div className="wx-run-acts">
          <button className={`btn sm ${followed ? 'on' : ''}`} onClick={onFollow} title={followed ? 'Voltar a acompanhar a última arma' : 'Câmera nesta arma'}>
            Câmera
          </button>
          {active && r.wire && (
            <select value={r.target ?? ''} onChange={(ev) => cmd({ type: 'torpedo', id: r.id, action: 'alvo', target: ev.target.value || null })} title="Novo alvo pelo fio" aria-label={`Novo alvo de ${r.id} pelo fio`}>
              <option value="">sem alvo</option>
              {targets
                .filter((c) => r.presets.warhead !== 'combate' || c.enemy)
                .slice(0, 30)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {shortName(c.name)}
                  </option>
                ))}
            </select>
          )}
          {active && r.wire && (
            <button className="btn sm" onClick={() => cmd({ type: 'torpedo', id: r.id, action: 'cortarFio' })}>
              Cortar fio
            </button>
          )}
          {(r.phase === 'recolher' || r.phase === 'explodiu' || r.phase === 'perdido') && (
            <button className="btn sm" onClick={() => cmd({ type: 'torpedo', id: r.id, action: 'recolher' })}>
              {r.phase === 'recolher' ? 'Recolher' : 'Tirar da lista'}
            </button>
          )}
        </div>
      </div>
    );
  }
  const r = f.r;
  const [ph, tone] = missilePhase(r);
  const alt = -r.d;
  return (
    <div className={`wx-run ${followed ? 'on' : ''} ${active ? '' : 'done'}`}>
      <div className="wx-run-head">
        <span className="wx-kind k-sm39">SM39</span>
        <b>{r.id}</b>
        <small>tubo {r.tube}</small>
        {r.presets.warhead === 'combate' && <span className="wx-tag cb">COMBATE</span>}
        <span className={`badge ${tone}`}>{ph}</span>
        {r.hit && r.phase === 'impacto' && <span className="badge ok">ALVO ATINGIDO</span>}
      </div>
      <div className="wx-run-data">
        {fmt(r.speed * 3.6, 0)} km/h · {alt >= 0 ? `${fmt(alt, 0)} m alt.` : `${fmt(-alt, 0)} m prof.`} · {km(r.run)} · {r.seeker ? 'autodiretor' : 'inercial'}
      </div>
      <div className="wx-run-tgt">
        {r.tgt ? `${shortName(r.tgt.name)} — ${km(r.tgt.range)}` : r.target ? r.target : r.seeker ? 'buscando' : 'sem alvo'}
        {r.endReason && !active && ` · ${r.endReason}`}
      </div>
      <div className="wx-run-acts">
        <button className={`btn sm ${followed ? 'on' : ''}`} onClick={onFollow} title={followed ? 'Voltar a acompanhar a última arma' : 'Câmera neste míssil'}>
          Câmera
        </button>
      </div>
    </div>
  );
}

/** boca do tubo vista de frente: água (azul), arma (laranja) e a porta (aro) */
function TubeMuzzle({ st, full }: { st: TubeState; full: number }) {
  const f = Math.max(0, Math.min(1, full > 0 ? st.water / full : 0));
  const doorCol = st.door.pos > 0.999 ? '#3ddc84' : st.door.pos > 0.001 ? '#f5b041' : '#8399b1';
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <defs>
        <clipPath id={`mz${st.n}`}>
          <circle cx="20" cy="20" r="15" />
        </clipPath>
      </defs>
      <circle cx="20" cy="20" r="15" fill="#0b1622" />
      <rect x="4" y={35 - 30 * f} width="32" height={30 * f} fill="#2a92ec" opacity="0.8" clipPath={`url(#mz${st.n})`} />
      {st.weapon && <circle cx="20" cy="20" r="8" fill={kindOf(st) === 'sm39' ? '#5d6b3c' : '#e8622b'} stroke="#1a1a1a" strokeWidth="1.5" />}
      {st.weapon && <circle cx="20" cy="20" r="3" fill={kindOf(st) === 'sm39' ? '#d9dfc4' : '#ffd27a'} />}
      <circle cx="20" cy="20" r="17" fill="none" stroke={doorCol} strokeWidth="3.5" strokeDasharray={st.door.pos > 0.001 ? `${(1 - st.door.pos) * 107} 200` : undefined} />
    </svg>
  );
}

function weightError(e: SimulationEngine): number {
  const ws = e.state.weapons!;
  return ws.awcRef - weaponsWeight(e.vessel.weapons!, ws);
}

/** corte esquemático do tubo selecionado: culatra, água, arma, válvulas, porta da boca e casco */
function TubeDiagram({ e, i, tv }: { e: SimulationEngine; i: number; tv: TubeView }) {
  const w = e.vessel.weapons!;
  const tc = w.tubes[i];
  const t = e.state.weapons!.tubes[i];
  const L = tubeLength(w, tc, e.geom.radiusAt);
  const X0 = 40;
  const X1 = 560;
  const k = (X1 - X0) / L;
  const yT = 40;
  const H = 46;
  const fill = Math.max(0, Math.min(1, t.water / Math.max(1, tv.fullWater)));
  const dims = weaponDims(w, kindOf(t));
  const wx = X0 + (stowedWeaponX(w, dims.length) - dims.length / 2 - w.breechX + (t.eject ?? 0)) * k;
  const valve = (x: number, y: number, st: { pos: number; cmd: number }, label: string) => (
    <g>
      <circle cx={x} cy={y} r="7" fill={st.pos > 0.999 ? '#3ddc84' : st.pos > 0.001 || st.cmd > 0.5 ? '#f5b041' : '#5a6f86'} stroke="#0a1017" />
      <text x={x} y={y + (y < yT ? -11 : 19)} textAnchor="middle" fontSize="10" fill="#8399b1">
        {label}
      </text>
    </g>
  );
  return (
    <svg viewBox="0 0 640 150" className="svgbox" style={{ width: '100%', maxHeight: 150 }} role="img" aria-label={`Esquema do tubo ${tc.n}`}>
      {/* casco externo na boca */}
      <path d={`M ${X1 + 22} 10 Q ${X1 + 48} 63 ${X1 + 22} 116`} fill="none" stroke="#5a6f86" strokeWidth="3" />
      <text x={X1 + 50} y="20" fontSize="10" fill="#5a6f86">
        casco
      </text>
      {/* tubo */}
      <rect x={X0} y={yT} width={X1 - X0} height={H} fill="#0d1824" stroke="#8fa3b8" strokeWidth="2" />
      <rect x={X0 + 1} y={yT + H * (1 - fill)} width={X1 - X0 - 2} height={H * fill} fill="#2a7fd4" opacity="0.65" />
      {/* arma */}
      {t.weapon && (
        <g>
          <rect x={wx} y={yT + 9} width={dims.length * k} height={H - 18} rx={(H - 18) / 2} fill={dims.name === 'SM39' ? '#3d4628' : '#1d262c'} stroke="#c9d6e3" />
          <rect x={wx + dims.length * k * 0.35} y={yT + 9} width={dims.length * k * 0.34} height={H - 18} fill={dims.name === 'SM39' ? '#6b7a45' : '#e8622b'} />
          <text x={wx + (dims.length * k) / 2} y={yT + H / 2 + 4} textAnchor="middle" fontSize="11" fill="#fff">
            {dims.name === 'SM39' ? 'SM39 · VSM' : 'F21'}
          </text>
        </g>
      )}
      {/* culatra e porta da boca */}
      <line x1={X0} y1={yT - 4} x2={X0 - 26 * t.breech.pos} y2={yT + H + 4 - 40 * t.breech.pos} stroke={t.breech.pos > 0.001 ? '#f5b041' : '#c9d6e3'} strokeWidth="5" />
      <line x1={X1} y1={yT - 4} x2={X1 + 26 * t.door.pos} y2={yT + H + 4 - 40 * t.door.pos} stroke={t.door.pos > 0.999 ? '#3ddc84' : t.door.pos > 0.001 ? '#f5b041' : '#c9d6e3'} strokeWidth="5" />
      <text x={X0} y={yT + H + 30} fontSize="10" fill="#8399b1" textAnchor="middle">
        culatra
      </text>
      <text x={X1} y={yT + H + 30} fontSize="10" fill="#8399b1" textAnchor="middle">
        porta da boca
      </text>
      {/* válvulas */}
      {valve(X0 + 70, yT + H + 16, t.flood, 'alagamento (TCA)')}
      {valve(X0 + 70, yT - 16, t.vent, 'suspiro')}
      {valve(X0 + 230, yT - 16, t.equalize, 'equalização (mar)')}
      {valve(X0 + 230, yT + H + 16, t.drain, 'drenagem (TCA)')}
      <text x={X0 + 380} y={yT - 12} fontSize="10" fill="#c9a227">
        garrafa {fmt(tv.flaskBar, 0)} bar {t.energized ? '· arma alimentada' : ''}
      </text>
      <text x="8" y="146" fontSize="10" fill="#5a6f86">
        {fmt(L, 2)} m da culatra à boca · água {fmt((fill * 100) as number, 0)} % · Δp tubo − mar {fmt((t.pressure - tv.seaPressure) / 1e5, 2)} bar
      </text>
    </svg>
  );
}

/**
 * Plotagem tática (norte para cima): próprio navio, contatos, alvos, derrotas e posição das armas.
 * Nomes só do alvo escolhido, dos contatos atacados e dos hostis (os outros ao passar o mouse); clique escolhe o alvo.
 * `compact`: miniatura no canto da cena (sem nomes nem legenda).
 */
function TacticalPlot({ e, targets, sel, onPick, compact }: { e: SimulationEngine; targets: Target[]; sel: string | null; onPick?: (id: string, hostile: boolean) => void; compact?: boolean }) {
  const s = e.state;
  const runs = s.weapons?.runs ?? [];
  const foes = s.weapons?.enemies ?? [];
  const mis = s.weapons?.missiles ?? [];
  const hosts = s.weapons?.hostiles ?? [];
  const booms = (s.weapons?.explosions ?? []).filter((x) => s.t - x.t < 60);
  const own = { n: s.body.pos.x, e: s.body.pos.y };
  const focus = targets.filter((c) => c.id === sel || runs.some((r) => r.target === c.id) || mis.some((r) => r.target === c.id));
  let span = 2000;
  for (const r of runs) for (const p of [r, ...r.track]) span = Math.max(span, Math.abs(p.n - own.n), Math.abs(p.e - own.e));
  for (const r of mis) for (const p of [r, ...r.track]) span = Math.max(span, Math.abs(p.n - own.n), Math.abs(p.e - own.e));
  for (const h of hosts) span = Math.max(span, Math.abs(h.n - own.n), Math.abs(h.e - own.e));
  for (const c of focus) span = Math.max(span, Math.abs(c.n - own.n), Math.abs(c.e - own.e));
  for (const c of foes) span = Math.max(span, Math.abs(c.n - own.n), Math.abs(c.e - own.e));
  span *= 1.15;
  const S = 360;
  const k = S / 2 / span;
  const xy = (n: number, ee: number) => [S / 2 + (ee - own.e) * k, S / 2 - (n - own.n) * k] as const;
  const hdg = (e.outputs.euler.heading * Math.PI) / 180;
  const ring = Math.pow(10, Math.floor(Math.log10(span / 2)));
  const step = span / ring > 6 ? ring * 2 : ring;
  const rings = [1, 2, 3].map((j) => j * step).filter((r) => r < span);
  /** rótulo dentro do quadro: perto da borda direita o texto vira para a esquerda */
  const label = (x: number, y: number, text: string, fill: string, bold = false) =>
    compact ? null : (
      <text x={x > S - 110 ? x - 9 : x + 8} y={Math.max(10, Math.min(S - 4, y + 3))} fontSize="10" fill={fill} fontWeight={bold ? 'bold' : undefined} textAnchor={x > S - 110 ? 'end' : 'start'}>
        {text}
      </text>
    );
  const pick = (id: string, hostile: boolean) => (onPick && !compact ? () => onPick(id, hostile) : undefined);
  const cur = onPick && !compact ? 'pointer' : undefined;
  return (
    <div className={compact ? 'wx-plot compact' : 'wx-plot'}>
      <svg viewBox={`0 0 ${S} ${S}`} className="svgbox" role="img" aria-label="Plotagem tática, norte para cima">
        {rings.map((r) => (
          <g key={r}>
            <circle cx={S / 2} cy={S / 2} r={r * k} fill="none" stroke="#1d2e42" />
            {!compact && (
              <text x={S / 2 + 3} y={S / 2 - r * k - 2} fontSize="9" fill="#5a6f86">
                {km(r)}
              </text>
            )}
          </g>
        ))}
        {!compact && (
          <text x={S / 2} y="12" fontSize="10" fill="#5a6f86" textAnchor="middle">
            N
          </text>
        )}
        {targets
          .filter((c) => !c.enemy && !isHostileId(c.id) && Math.abs(c.n - own.n) < span && Math.abs(c.e - own.e) < span)
          .map((c) => {
            const [x, y] = xy(c.n, c.e);
            const ch = (c.course * Math.PI) / 180;
            const hot = c.id === sel || runs.some((r) => r.target === c.id) || mis.some((r) => r.target === c.id);
            const vl = Math.min(40, c.speed * 360 * k);
            return (
              <g key={c.id} onClick={pick(c.id, false)} style={{ cursor: cur }}>
                <title>{`${shortName(c.name)} — ${km(c.range)}`}</title>
                <line x1={x} y1={y} x2={x + Math.sin(ch) * vl} y2={y - Math.cos(ch) * vl} stroke={hot ? '#ffb347' : '#5a6f86'} />
                <rect x={x - 4} y={y - 4} width="8" height="8" fill={hot ? '#ffb347' : '#8399b1'} />
                {hot && label(x, y, shortName(c.name), '#ffd9a0')}
              </g>
            );
          })}
        {foes.map((x) => {
          const [px, py] = xy(x.n, x.e);
          const ch = (x.course * Math.PI) / 180;
          const vl = Math.min(40, x.speed * 360 * k);
          const dead = x.sunk !== null;
          return (
            <g key={x.id} onClick={dead ? undefined : pick(x.id, true)} style={{ cursor: dead ? undefined : cur }}>
              <title>{x.name}</title>
              {x.id === sel && <circle cx={px} cy={py} r="11" fill="none" stroke="#ffb347" strokeWidth="1.5" />}
              {!dead && <line x1={px} y1={py} x2={px + Math.sin(ch) * vl} y2={py - Math.cos(ch) * vl} stroke="#ff5257" />}
              <polygon points={`${px},${py - 6} ${px + 6},${py} ${px},${py + 6} ${px - 6},${py}`} fill={dead ? '#5a6f86' : '#ff5257'} stroke="#1a0000" />
              {label(px, py, dead ? `† ${x.name}` : x.name, dead ? '#8399b1' : '#ff9a9c', true)}
            </g>
          );
        })}
        {hosts.map((h) => {
          const [px, py] = xy(h.n, h.e);
          const dead = h.sunk !== null;
          const ch = (h.course * Math.PI) / 180;
          const vl = Math.min(40, h.speed * 360 * k);
          return (
            <g key={h.id} onClick={dead ? undefined : pick(h.id, true)} style={{ cursor: dead ? undefined : cur }}>
              <title>{h.name}</title>
              {h.id === sel && <circle cx={px} cy={py} r="12" fill="none" stroke="#ffb347" strokeWidth="1.5" />}
              {h.type === 'fragata' && !dead && <line x1={px} y1={py} x2={px + Math.sin(ch) * vl} y2={py - Math.cos(ch) * vl} stroke="#ff5257" />}
              {h.type === 'terra' ? (
                <rect x={px - 5} y={py - 5} width="10" height="10" fill={dead ? '#5a6f86' : '#ff8a3d'} stroke="#1a0000" />
              ) : (
                <polygon points={`${px},${py - 7} ${px + 6},${py + 5} ${px - 6},${py + 5}`} fill={dead ? '#5a6f86' : '#ff5257'} stroke="#1a0000" />
              )}
              {label(px, py, `${dead ? '† ' : h.tHit !== null ? '✱ ' : ''}${shortName(h.name)}`, dead ? '#8399b1' : '#ff9a9c', true)}
            </g>
          );
        })}
        {mis.map((r) => {
          const pts = [...r.track, r].map((p) => xy(p.n, p.e).join(',')).join(' ');
          const [x, y] = xy(r.n, r.e);
          const col = r.hit ? '#3ddc84' : r.presets.warhead === 'combate' ? '#ff6b5a' : '#ffd166';
          return (
            <g key={r.id}>
              <polyline points={pts} fill="none" stroke={col} strokeWidth="1.8" strokeDasharray={r.seeker ? undefined : '6 3'} />
              <circle cx={x} cy={y} r="3.5" fill={col} />
              {label(x, y - 8, r.id, '#ffe2c4')}
            </g>
          );
        })}
        {booms.map((x) => {
          const [px, py] = xy(x.n, x.e);
          const a = Math.max(0, 1 - (s.t - x.t) / 60);
          return (
            <g key={'b' + x.id} opacity={a}>
              <circle cx={px} cy={py} r={6 + 10 * (1 - a)} fill="none" stroke="#ffb347" strokeWidth="2" />
              <text x={px} y={py + 4} fontSize="12" textAnchor="middle" fill="#ffb347" fontWeight="bold">
                ✱
              </text>
            </g>
          );
        })}
        {runs.map((r) => {
          const pts = [...r.track, r].map((p) => xy(p.n, p.e).join(',')).join(' ');
          const [x, y] = xy(r.n, r.e);
          return (
            <g key={r.id}>
              <polyline points={pts} fill="none" stroke={r.hit ? '#3ddc84' : '#36c5f0'} strokeWidth="1.5" strokeDasharray={r.wire ? undefined : '4 3'} />
              <circle cx={x} cy={y} r="3.5" fill={r.hit ? '#3ddc84' : '#36c5f0'} />
              {label(x, y - 8, r.id, '#d8e4f0')}
            </g>
          );
        })}
        <polygon
          points={`${S / 2 + Math.sin(hdg) * 9},${S / 2 - Math.cos(hdg) * 9} ${S / 2 + Math.sin(hdg + 2.5) * 6},${S / 2 - Math.cos(hdg + 2.5) * 6} ${S / 2 + Math.sin(hdg - 2.5) * 6},${S / 2 - Math.cos(hdg - 2.5) * 6}`}
          fill="#3ddc84"
        />
      </svg>
      {!compact && (
        <ul className="wx-legend" aria-label="Legenda da plotagem">
          <li>
            <svg viewBox="0 0 14 14" aria-hidden>
              <polygon points="7,1 11,12 3,12" fill="#3ddc84" />
            </svg>
            SX-1
          </li>
          <li>
            <svg viewBox="0 0 22 14" aria-hidden>
              <line x1="1" y1="7" x2="21" y2="7" stroke="#36c5f0" strokeWidth="2" />
            </svg>
            torpedo (tracejado: sem fio)
          </li>
          <li>
            <svg viewBox="0 0 22 14" aria-hidden>
              <line x1="1" y1="7" x2="21" y2="7" stroke="#ffd166" strokeWidth="2" strokeDasharray="5 3" />
            </svg>
            míssil (tracejado: inercial)
          </li>
          <li>
            <svg viewBox="0 0 14 14" aria-hidden>
              <rect x="3" y="3" width="8" height="8" fill="#8399b1" />
            </svg>
            navio civil
          </li>
          <li>
            <svg viewBox="0 0 14 14" aria-hidden>
              <polygon points="7,1 13,7 7,13 1,7" fill="#ff5257" />
            </svg>
            submarino inimigo
          </li>
          <li>
            <svg viewBox="0 0 14 14" aria-hidden>
              <polygon points="7,1 12,12 2,12" fill="#ff5257" />
            </svg>
            fragata
          </li>
          <li>
            <svg viewBox="0 0 14 14" aria-hidden>
              <rect x="2" y="2" width="10" height="10" fill="#ff8a3d" />
            </svg>
            alvo em terra
          </li>
          <li>
            <span className="sym">✱</span> explosão
          </li>
          {onPick && <li className="tip">Clique num contato para escolher o alvo.</li>}
        </ul>
      )}
    </div>
  );
}
