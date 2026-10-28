/**
 * OPERAÇÃO — CENTRAL DE OPERAÇÃO (antiga Pilotagem; id de tela 'pilotagem').
 * Indicadores no topo, cena 3D grande, console inferior fixo (propulsão,
 * governo, pilotos, manobras) e painel lateral com os sistemas em grupos
 * expansíveis (rolagem própria; até dois fixados + um livre aberto) e o sopro
 * de emergência fixo no rodapé. Clicar num objeto da cena abre o grupo
 * correspondente. Tudo usa os mesmos comandos e o mesmo estado das outras telas.
 */
import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import { usePersisted } from '../persist';
import { runner, useSim } from '../store';
import { Scene3D } from '../components/Scene3D';
import { useQuality } from '../graphics';
import { seaSections } from '../components/SeaControls';
import { DepthTape } from '../components/gauges';
import type { ViewMode } from '../../render3d/SubmarineScene';
import { navStatus } from '../navStatus';
import { ManeuverStatus } from '../components/ManeuverStatus';
import { GROUP_TITLE, GROUP_ICON, GROUP_COLOR, GROUP_SECTIONS, GROUP_SHORT, SIDE_GROUPS, type GroupId } from '../ops/opsBus';
import { GROUPS } from '../ops/OpsGroups';
import { OpsStrip } from '../ops/OpsStrip';
import { OpsConsole, OpsConsoleCompact, TakeoverToast, EmergencyBox } from '../ops/OpsConsole';
import { clampSideWidth, isCompact, SIDE_MAX, SIDE_MIN, type ConsoleMode } from '../ops/layout';
import { useOpsBus } from '../ops/useOpsBus';
import type { SimulationEngine } from '../../sim/core/engine';
import { OverlayCtl } from '../components/OverlayCtl';
import { viewSection, type ViewOption } from '../components/OverlayMenu';
import type { LayerKey } from '../components/LayerPanel';
import { SceneLayerPanel } from '../components/SceneLayerPanel';
import { defaultLayers, type SceneLayers } from '../../render3d/layers';

/** preferências adicionais da Operação (preserva as chaves já salvas da Pilotagem) */
const PILOT_LAYER_DEFAULTS = {
  pipes: true,
  torpedoes: true,
  flows: true,
  halfCut: false,
  labels: true,
  batteryInfo: true,
  airInfo: false,
  wake: true,
  trail: true,
  wind: true,
  pennant: false,
  flag: false,
  depthLines: true,
  pitchAngle: false,
  presLight: false,
  hullOpacity: 0.16,
  resultantGain: 'auto' as const,
};
const PILOT_LAYER_KEYS: LayerKey[] = [
  'vectors',
  'hydroVectors',
  'trimVectors',
  'tanks',
  'pipes',
  'flows',
  'halfCut',
  'labels',
  'batteryInfo',
  'airInfo',
  'wake',
  'wind',
  'pennant',
  'flag',
  'trail',
  'markers',
  'trimRef',
  'pitchAngle',
  'depthLines',
  'ships',
  'torpedoes',
  'noWater',
  'presLight',
];

/** vistas da Operação (os enquadramentos de apresentação já ligam o que mostram) */
const PILOT_VIEWS: ViewOption[] = [
  { id: 'piloto', label: 'Lateral' },
  { id: 'perseguicao', label: 'Perseguição' },
  { id: 'cinematografica', label: 'Cinematográfica' },
  { id: 'perspectiva', label: 'Perspectiva', tip: 'Grande-angular de perto, 3/4 pela proa: a proa (mais perto) aparece bem maior que a popa' },
  { id: 'tanques', label: 'Vista tanques', tip: 'Câmera de perto no corte (liga os tanques)' },
  { id: 'forcas', label: 'Vista forças', tip: 'Câmera lateral para os vetores (liga peso/empuxo)' },
  { id: 'calado', label: 'Calado' },
  { id: 'fixa', label: 'Fixa' },
  { id: 'passadico', label: 'Passadiço', tip: 'Passadiço: em pé no alto da vela, olhando em volta (arraste); roda do mouse ou B = binóculo 7×50' },
  { id: 'drone', label: 'Drone', tip: 'Drone: câmera livre no cenário (mar, orla, cidade). WASD mover · Q/E subir/descer · arrastar olhar · Shift rápido · roda = velocidade' },
  { id: 'livre', label: 'Livre' },
];

function OpsGroupBox({ id, e }: { id: GroupId; e: SimulationEngine }) {
  const ops = useOpsBus();
  const ref = useRef<HTMLElement>(null);
  const open = ops.isOpen(id);
  const pinned = ops.st.pinned.includes(id);
  const g = GROUPS[id];
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (ops.focusGroup === id && ops.focusSeq > 0) {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setFlash(true);
      const t = window.setTimeout(() => setFlash(false), 1400);
      return () => window.clearTimeout(t);
    }
  }, [ops.focusSeq]);
  const warn = g.warn?.(e);
  const Body = g.Body;
  return (
    <section ref={ref} className={`ops-group ${open ? 'open' : ''} ${pinned ? 'pinned' : ''} ${flash ? 'flash' : ''} ${warn ? 'warn' : ''}`} style={{ '--gc': GROUP_COLOR[id] } as CSSProperties}>
      <header onClick={() => ops.toggle(id)} title={pinned ? 'Grupo fixado (desafixe para recolher)' : open ? 'Recolher' : 'Expandir (fecha o outro grupo livre)'}>
        <span className="chev">{open ? '▾' : '▸'}</span>
        <span className="ico" aria-hidden>
          {GROUP_ICON[id]}
        </span>
        <b>{GROUP_TITLE[id]}</b>
        <span className="sum">{g.summary(e)}</span>
        <button
          className={`pin ${pinned ? 'on' : ''}`}
          onClick={(ev) => {
            ev.stopPropagation();
            ops.togglePin(id);
          }}
          title={pinned ? 'Desafixar' : 'Fixar aberto (até dois grupos)'}
          aria-label={pinned ? `Desafixar ${GROUP_TITLE[id]}` : `Fixar ${GROUP_TITLE[id]}`}
        >
          {pinned ? 'FIXO' : 'fixar'}
        </button>
      </header>
      {open && (
        <div className="body">
          <Body e={e} inOps />
        </div>
      )}
    </section>
  );
}

export function PilotScreen() {
  const e = useSim(8);
  const ops = useOpsBus();
  // visualização guardada ao trocar de aba (e ao recarregar a página)
  const [view, setView] = usePersisted<ViewMode>('pilot.view', 'piloto');
  const [cut, setCut] = usePersisted('pilot.cut', false);
  const [tankF, setTankF] = usePersisted<string[] | null>('pilot.tankFilter', null);
  const [vec, setVec] = usePersisted('pilot.vec', false);
  const [trimV, setTrimV] = usePersisted('pilot.trim', false);
  const [hydro, setHydro] = usePersisted('pilot.hydro', false);
  const [hiddenV, setHiddenV] = usePersisted<string[]>('pilot.hiddenVec', []);
  const [dry, setDry] = usePersisted('pilot.dry', false);
  const setVecLayers = (v: { vectors?: boolean; hydroVectors?: boolean; trimVectors?: boolean; hiddenVectors?: string[] }) => {
    if (v.vectors !== undefined) setVec(v.vectors);
    if (v.hydroVectors !== undefined) setHydro(v.hydroVectors);
    if (v.trimVectors !== undefined) setTrimV(v.trimVectors);
    if (v.hiddenVectors !== undefined) setHiddenV(v.hiddenVectors);
  };
  const [marks, setMarks] = usePersisted('pilot.marks', true);
  const [trimRef, setTrimRef] = usePersisted('pilot.trimRef', false);
  const [ships, setShips] = usePersisted('pilot.ships', true);
  // demais camadas (antes fixas: identificações, tubulações, escoamentos e o rótulo da bateria)
  const [laySaved, setLay] = usePersisted<Partial<SceneLayers>>('pilot.layers', {});
  const lay = { ...PILOT_LAYER_DEFAULTS, ...laySaved };
  const layerValue: SceneLayers = {
    ...defaultLayers(),
    ...lay,
    tankFilter: tankF,
    vectors: vec,
    hydroVectors: hydro,
    trimVectors: trimV,
    hiddenVectors: hiddenV,
    tanks: cut,
    noWater: dry,
    markers: marks,
    trimRef,
    ships,
  };
  const setLayers = (p: Partial<SceneLayers>) => {
    setVecLayers(p);
    if (p.tankFilter !== undefined) setTankF(p.tankFilter);
    if (p.tanks !== undefined) setCut(p.tanks);
    if (p.noWater !== undefined) setDry(p.noWater);
    if (p.markers !== undefined) setMarks(p.markers);
    if (p.trimRef !== undefined) setTrimRef(p.trimRef);
    if (p.ships !== undefined) setShips(p.ships);
    const rest: Partial<SceneLayers> = {};
    for (const k of Object.keys(PILOT_LAYER_DEFAULTS) as (keyof typeof PILOT_LAYER_DEFAULTS)[]) if (p[k] !== undefined) Object.assign(rest, { [k]: p[k] });
    if (Object.keys(rest).length) setLay({ ...laySaved, ...rest });
  };
  const [quality, setQuality] = useQuality();
  const o = e.outputs;
  const ap = e.state.autopilot;
  const st = navStatus(e);
  const L = e.vessel.limits;

  // console compacto: automático quando falta altura (só no layout de duas colunas), ou escolhido
  const opsRef = useRef<HTMLDivElement>(null);
  const [opsH, setOpsH] = useState(0);
  useEffect(() => {
    const el = opsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setOpsH(window.innerWidth > 1100 ? el.clientHeight : 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [consoleMode, setConsoleMode] = usePersisted<ConsoleMode>('ops.consoleMode', 'auto');
  const compact = isCompact(consoleMode, opsH);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    if (!compact || !drawer) return;
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && setDrawer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compact, drawer]);

  // largura do painel de sistemas: arrastar a alça (salva); duplo clique volta ao padrão
  const [sideW, setSideW] = usePersisted<number | null>('ops.sideW', null);
  const [dragW, setDragW] = useState<number | null>(null);
  const sideRef = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const curW = dragW ?? (sideW !== null ? clampSideWidth(sideW, window.innerWidth) : null);
  const setWidth = (w: number) => setSideW(clampSideWidth(w, window.innerWidth));
  return (
    <div className="ops" ref={opsRef} style={curW !== null ? ({ '--ops-side': `${curW}px` } as CSSProperties) : undefined}>
      <div className="ops-main">
        <OpsStrip e={e} />
        <div className="ops-view">
          <Scene3D
            quality={quality}
            view={view}
            cutaway={cut}
            labels={false}
            persistKey="pilot"
            layers={{ ...layerValue, highlight: ops.highlight }}
            onPick={(p) => {
              if (p && !cut && ['tank', 'valve', 'pump', 'battery', 'generator', 'hp', 'demoWeight'].includes(p.kind)) setCut(true);
              ops.select(p);
            }}
          >
            <div className="pilot-tape">
              <DepthTape
                depth={o.depthKeel}
                ordered={ap.depthMode === 'AUTO' ? ap.depthSet : null}
                bottom={o.bottomDepth}
                rate={o.verticalSpeed}
                opLimit={L.operatingDepth}
                testLimit={L.testDepth}
                height={window.innerHeight < 760 ? 150 : 220}
              />
            </div>
            <div className="pilot-hud">
              <span className={`badge ${st.cls}`} style={{ fontSize: 13, padding: '3px 10px' }}>
                {st.label}
              </span>
              <span className="subtle">Clique num tanque, leme, hélice, mastro, bateria ou válvula para abrir os controles.</span>
            </div>
            <OverlayCtl
              persistKey="pilot"
              sections={[
                viewSection(PILOT_VIEWS, view, (v) => {
                  setView(v);
                  // os enquadramentos de apresentação já ligam o que mostram
                  if (v === 'tanques') setCut(true);
                  if (v === 'forcas') setVec(true);
                  if (v === 'calado') setTrimRef(true);
                }),
                {
                  id: 'camadas',
                  label: <>Camadas ({PILOT_LAYER_KEYS.filter((k) => !!layerValue[k]).length})</>,
                  title: 'Tanques, vetores, identificações e ambiente',
                  className: 'scene-layer-pop',
                  content: <SceneLayerPanel e={e} keys={PILOT_LAYER_KEYS} value={layerValue} onChange={setLayers} />,
                },
                ...seaSections(quality, setQuality),
              ]}
            />
            {/* aviso de troca de comando e faixa da manobra; com a gaveta aberta ficam logo acima dela */}
            <div className={`ops-bottom-stack ${compact && drawer ? 'with-drawer' : ''}`}>
              <div className="ops-bottom">
                <TakeoverToast e={e} />
                <ManeuverStatus compact cancel />
              </div>
              {compact && drawer && (
                <div className="ops-drawer" role="dialog" aria-label="Console completo">
                  <OpsConsole e={e} />
                  <button className="btn sm ops-drawer-close" onClick={() => setDrawer(false)} title="Recolher o console (Esc)">
                    ▾ Recolher
                  </button>
                </div>
              )}
            </div>
            {!runner.running && e.state.t === 0 && (
              <button className="btn ok lg pilot-start" onClick={() => ((runner.running = true), runner.notify())}>
                ▶ Iniciar simulação
              </button>
            )}
          </Scene3D>
        </div>
        {compact ? <OpsConsoleCompact e={e} onOpen={() => setDrawer(!drawer)} /> : <OpsConsole e={e} />}
      </div>
      <aside className="ops-side" aria-label="Sistemas" ref={sideRef}>
        <div
          className="ops-grip"
          role="separator"
          aria-orientation="vertical"
          aria-label="Largura do painel de sistemas"
          aria-valuemin={SIDE_MIN}
          aria-valuemax={SIDE_MAX}
          aria-valuenow={Math.round(curW ?? sideRef.current?.offsetWidth ?? 0)}
          tabIndex={0}
          title="Arraste para ajustar a largura do painel · duplo clique: largura padrão · setas ← →"
          onPointerDown={(ev) => {
            drag.current = { x: ev.clientX, w: sideRef.current?.offsetWidth ?? 400 };
            ev.currentTarget.setPointerCapture(ev.pointerId);
          }}
          onPointerMove={(ev) => {
            const d = drag.current;
            if (d) setDragW(clampSideWidth(d.w + (d.x - ev.clientX), window.innerWidth));
          }}
          onPointerUp={() => {
            if (dragW !== null) setWidth(dragW);
            drag.current = null;
            setDragW(null);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragW(null);
          }}
          onDoubleClick={() => setSideW(null)}
          onKeyDown={(ev) => {
            const w = sideRef.current?.offsetWidth ?? 400;
            if (ev.key === 'ArrowLeft') setWidth(w + 20);
            else if (ev.key === 'ArrowRight') setWidth(w - 20);
            else if (ev.key === 'Home') setSideW(null);
            else return;
            ev.preventDefault();
          }}
        />
        <div className="ops-tools">
          <b>Sistemas</b>
          <span className="subtle">{ops.st.pinned.length ? `${ops.st.pinned.length} fixado(s) + 1 livre` : 'fixe até dois grupos'}</span>
          <select
            className="ops-cmode"
            value={consoleMode}
            onChange={(ev) => setConsoleMode(ev.target.value as ConsoleMode)}
            aria-label="Console de governo"
            title="Console de governo: automático (compacto quando falta altura), sempre completo ou sempre compacto"
          >
            <option value="auto">Console: auto</option>
            <option value="completo">Console: completo</option>
            <option value="compacto">Console: compacto</option>
          </select>
          <button className="btn sm" onClick={() => ops.collapseAll()}>
            Recolher todos
          </button>
        </div>
        <div className="ops-jump" role="toolbar" aria-label="Ir para o sistema">
          {SIDE_GROUPS.map((g) => (
            <button key={g} className={`${ops.isOpen(g) ? 'on' : ''} ${GROUPS[g].warn?.(e) ? 'warn' : ''}`} style={{ '--gc': GROUP_COLOR[g] } as CSSProperties} onClick={() => ops.focus(g)} title={GROUP_TITLE[g]}>
              <span aria-hidden>{GROUP_ICON[g]}</span> {GROUP_SHORT[g]}
            </button>
          ))}
        </div>
        <div className="ops-scroll">
          {GROUP_SECTIONS.map((sec) => (
            <Fragment key={sec.title}>
              <div className="ops-sec">{sec.title}</div>
              {sec.groups.map((g) => (
                <OpsGroupBox key={g} id={g} e={e} />
              ))}
            </Fragment>
          ))}
        </div>
        <EmergencyBox e={e} />
      </aside>
    </div>
  );
}
