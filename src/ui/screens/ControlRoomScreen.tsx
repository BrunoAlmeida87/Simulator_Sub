/**
 * SALA DE COMANDO EM PRIMEIRA PESSOA. Anda-se pela sala (WASD/setas ou os
 * botões de toque; arrastar = olhar) e clica-se nos postos: de longe o clique
 * APROXIMA a câmera e abre o painel 2D da estação ao lado; de perto (ou com
 * a estação em foco) os botões, chaves, volantes, manches e alavancas da
 * própria cena são ACIONADOS diretamente. Tudo envia os mesmos comandos das
 * outras telas (histórico e gravação). A segunda janela continua mostrando a
 * cena 3D externa; há também uma miniatura opcional da vista externa e a
 * visada do periscópio.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cmd, runner, useSim } from '../store';
import { usePersisted, loadPersisted, savePersisted } from '../persist';
import { useUi } from '../uiContext';
import type { ControlRoomScene, FrameInfo, HoverInfo } from '../../render3d/controlRoom/ControlRoomScene';
import type { RoomActions } from '../../render3d/controlRoom/actions';
import type { RoomLighting } from '../../render3d/controlRoom/panel';
import { STATIONS, stationById } from '../../render3d/controlRoom/stations';
import { roomContacts, mastOut } from '../../render3d/controlRoom/panelsCombat';
import { hullOpenings } from '../../render3d/controlRoom/panelsBallast';
import { GROUPS, loadScenario } from '../ops/OpsGroups';
import { maneuver, MANEUVER_STEPS } from '../maneuvers';
import { SCENARIOS } from '../../sim/scenarios';
import { graphics } from '../graphics';
import { geoOriginOf, route } from '../routeNav';
import { Scene3D, defaultQuality } from '../components/Scene3D';
import type { PeriscopeSight, ViewMode } from '../../render3d/SubmarineScene';
import type { SimulationEngine } from '../../sim/core/engine';
import { cpa } from '../../sim/geo';
import { toKnots } from '../../sim/units';
import { nearestOrder } from '../../sim/telegraph';
import { fmt } from '../format';

const PERI_POWERS: { fov: number; label: string }[] = [
  { fov: 32, label: '1,5×' },
  { fov: 8, label: '6×' },
];

function maneuverText(): string | null {
  if (!maneuver.active) return null;
  return `${maneuver.active === 'imergir' ? `IMERGIR para ${maneuver.target} m` : 'EMERGIR'} · etapa ${maneuver.step + 1}/${MANEUVER_STEPS[maneuver.active].length}: ${maneuver.phase}`;
}

/** periscópio de ataque: içar/arriar */
function PeriscopeRow({ e }: { e: SimulationEngine }) {
  const pr = e.state.periscope ?? { cmd: false, pos: 0 };
  return (
    <div className="row">
      <b>Periscópio</b>
      <span className="mono">{fmt(pr.pos * 100, 0)} % içado</span>
      <button className={`btn sm ${pr.cmd ? 'on' : ''}`} onClick={() => cmd({ type: 'periscope', raise: !pr.cmd })}>
        {pr.cmd ? 'Arriar' : 'Içar'}
      </button>
    </div>
  );
}

/** tabela de contatos (sonar, quadro tático, mesa) */
function ContactsTable({ e, acts }: { e: SimulationEngine; acts: RoomActions }) {
  const own = { n: e.state.body.pos.x, e: e.state.body.pos.y, vn: e.outputs.velNED.x, ve: e.outputs.velNED.y };
  const list = roomContacts(e, acts)
    .sort((a, b) => a.rng - b.rng)
    .slice(0, 10);
  return (
    <table className="t ops-t">
      <thead>
        <tr>
          <th>Contato</th>
          <th>Marcação</th>
          <th>Distância</th>
          <th>Rumo/vel.</th>
          <th>PMA</th>
        </tr>
      </thead>
      <tbody>
        {list.map((c) => {
          const p = cpa(own, c);
          return (
            <tr key={c.id}>
              <td>
                <b>{c.id}</b>
                <div className="subtle">{c.name}</div>
              </td>
              <td className="mono">{String(Math.round(c.brg)).padStart(3, '0')}°</td>
              <td className="mono">{fmt(c.rng / 1852, 1)} mn</td>
              <td className="mono">
                {Math.round(c.course)}° · {fmt(toKnots(c.speed), 1)} nós
              </td>
              <td className="mono">{p.tcpa > 0 ? `${fmt(p.dcpa / 1852, 1)} mn em ${Math.round(p.tcpa / 60)} min` : 'afastando'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** conteúdo 2D de cada estação (os mesmos controles da Pilotagem) */
function StationBody({ id, e, acts, onPeri }: { id: string; e: SimulationEngine; acts: RoomActions; onPeri: () => void }) {
  const ui = useUi();
  const G = GROUPS;
  const mapBtn = (
    <button className="btn sm" onClick={() => ui.setScreen('mapa')}>
      Abrir o Mapa tático →
    </button>
  );
  const blocks: Record<string, ReactNode> = {
    governo: (
      <>
        <G.nav.Body e={e} />
        <PeriscopeRow e={e} />
        <div className="row">
          <button className="btn sm" onClick={() => maneuver.start(runner, 'imergir', Math.max(20, Math.round(e.state.autopilot.depthSet / 10) * 10 || 50))}>
            Manobra: imergir
          </button>
          <button className="btn sm" onClick={() => maneuver.start(runner, 'emergir')}>
            Manobra: emergir
          </button>
          <button className="btn sm warn" disabled={!maneuver.active} onClick={() => maneuver.cancel(runner)}>
            Cancelar manobra
          </button>
        </div>
        {maneuverText() && <div className="subtle">{maneuverText()}</div>}
      </>
    ),
    instrumentos: <G.nav.Body e={e} />,
    alarmes: <G.falhas.Body e={e} />,
    lastro: (
      <>
        <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
          {hullOpenings(e).map((o) => (
            <span key={o.id} className={`badge ${o.open ? 'alarm' : 'ok'}`} title={o.fixed ? 'não modelada: sempre fechada' : undefined}>
              {o.open ? 'O' : '—'} {o.name}
            </span>
          ))}
        </div>
        <G.lastro.Body e={e} />
        <h4 className="mt8">Ar comprimido</h4>
        <G.ar.Body e={e} />
      </>
    ),
    mergulho: (
      <>
        <G.comp.Body e={e} />
        <h4 className="mt8">Trim e banda</h4>
        <G.trim.Body e={e} />
      </>
    ),
    coletor: (
      <>
        <G.ar.Body e={e} />
        <div className="subtle">
          Hidráulica: <b className="mono">{fmt(e.state.hydraulics.pressure / 1e5, 0)} bar</b> {e.state.hydraulics.failed ? '· PLANTA EM FALHA' : e.state.hydraulics.pumpOn ? '· bomba em carga' : ''}. Os volantes do
          coletor abrem/fecham as mesmas válvulas da compensação, do trim/banda e do ar AP.
        </div>
      </>
    ),
    plataforma: (
      <>
        <G.energia.Body e={e} />
        <div className="subtle">
          Motor: ordem <b className="mono">{nearestOrder(e.state.propulsion.rpmCmd).label}</b> ({fmt(e.state.propulsion.rpmCmd, 0)} rpm) · eixo {fmt(e.outputs.rpm, 0)} rpm · {fmt(e.state.propulsion.shaftPower / 1e6, 2)}{' '}
          MW
        </div>
      </>
    ),
    periscopio: (
      <>
        <PeriscopeRow e={e} />
        <button className="btn ok" onClick={onPeri}>
          Olhar pelo periscópio
        </button>
        <div className="subtle">
          Na cota periscópica (≈ {fmt(e.vessel.hull.diameter + e.vessel.hull.sail.height + 5.3, 0)} m de quilha) e com o periscópio içado, a cabeça fica fora d’água.{' '}
          {mastOut(e) ? 'Agora há mastro/antena fora d’água.' : ''}
        </div>
      </>
    ),
    sonar: (
      <>
        <ContactsTable e={e} acts={acts} />
        <div className="subtle">O ruído próprio cresce com a velocidade: a baixa velocidade o sonar ouve mais longe. A zona cega fica a ré (hélice).</div>
      </>
    ),
    combate: (
      <>
        <ContactsTable e={e} acts={acts} />
        {mapBtn}
      </>
    ),
    navegacao: (
      <>
        <div className="subtle">
          GPS: <b>{mastOut(e) ? 'fixo válido' : 'sem sinal (antena submersa)'}</b> · rumo {fmt(e.state.sensors.GIRO.value, 0)}° · {fmt(toKnots(e.state.sensors.DVLU.value), 1)} nós · fundo {fmt(e.outputs.bottomDepth, 0)}{' '}
          m
        </div>
        <ContactsTable e={e} acts={acts} />
        {mapBtn}
      </>
    ),
    mesa: (
      <>
        <ContactsTable e={e} acts={acts} />
        {mapBtn}
      </>
    ),
    instrutor: (
      <>
        <G.falhas.Body e={e} />
        <h4 className="mt8">Ambiente e cenário</h4>
        <G.ambiente.Body e={e} />
        <h4 className="mt8">Roteiros guiados</h4>
        <G.guiados.Body e={e} />
      </>
    ),
  };
  return <div className="col">{blocks[id] ?? null}</div>;
}

function StationPanel({ id, acts, onClose, onPeri }: { id: string; acts: RoomActions; onClose: () => void; onPeri: () => void }) {
  const e = useSim(6);
  const st = stationById(id);
  const [info, setInfo] = usePersisted('room.info', true);
  if (!st) return null;
  return (
    <div className="room-side panel">
      <header>
        <h3>{st.name}</h3>
        <span className="row" style={{ gap: 4 }}>
          <button className={`btn sm ${info ? 'on' : ''}`} onClick={() => setInfo(!info)} title="Como é este posto num submarino real">
            ⓘ
          </button>
          <button className="btn sm" onClick={onClose} title="Fechar o painel (a câmera continua na estação)">
            ✕
          </button>
        </span>
      </header>
      <div className="body">
        {info && <div className="note room-info">{st.info}</div>}
        <StationBody id={id} e={e} acts={acts} onPeri={onPeri} />
      </div>
    </div>
  );
}

/** visada do periscópio: cena externa com a câmera na cabeça do periscópio, retículo e escala de marcação */
function PeriscopeView({ sight, setSight, onExit }: { sight: PeriscopeSight; setSight: (s: PeriscopeSight) => void; onExit: () => void }) {
  const e = useSim(10);
  const pr = e.state.periscope ?? { cmd: false, pos: 0 };
  const raised = pr.pos > 0.97;
  const drag = useRef<{ x: number; y: number; b: number; el: number } | null>(null);
  const hdg = e.outputs.euler.heading;
  const trueBrg = (((hdg + sight.bearing) % 360) + 360) % 360;
  const wrap = (b: number) => ((((b + 180) % 360) + 360) % 360) - 180;
  const k = sight.fov / 600;
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onExit();
      else if (ev.key === 'ArrowLeft' || ev.key === 'a') setSight({ ...sight, bearing: wrap(sight.bearing - 2) });
      else if (ev.key === 'ArrowRight' || ev.key === 'd') setSight({ ...sight, bearing: wrap(sight.bearing + 2) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div
      className="room-peri"
      onPointerDown={(ev) => {
        (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
        drag.current = { x: ev.clientX, y: ev.clientY, b: sight.bearing, el: sight.elev };
      }}
      onPointerMove={(ev) => {
        const d = drag.current;
        if (!d) return;
        setSight({ ...sight, bearing: wrap(d.b - (ev.clientX - d.x) * k), elev: Math.max(-10, Math.min(30, d.el + (ev.clientY - d.y) * k)) });
      }}
      onPointerUp={() => (drag.current = null)}
    >
      <Scene3D
        view="periscopio"
        periscope={sight}
        quality={defaultQuality()}
        labels={false}
        syncVisual={false}
        layers={{
          vectors: false,
          hydroVectors: false,
          trimVectors: false,
          tanks: false,
          flows: false,
          pipes: false,
          labels: false,
          batteryInfo: false,
          airInfo: false,
          trail: false,
          trimRef: false,
          noWater: false,
          markers: false,
          wake: true,
          ships: true,
          hull: true,
        }}
      />
      <svg className="room-reticle" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
        <defs>
          <mask id="peri-mask">
            <rect x="-1000" y="-1000" width="2000" height="2000" fill="white" />
            <circle r="92" fill="black" />
          </mask>
        </defs>
        <rect x="-1000" y="-1000" width="2000" height="2000" fill="#000" mask="url(#peri-mask)" />
        <circle r="92" fill="none" stroke="#000" strokeWidth="3" />
        <line x1="-92" y1="0" x2="-8" y2="0" stroke="#111" strokeWidth="0.8" />
        <line x1="8" y1="0" x2="92" y2="0" stroke="#111" strokeWidth="0.8" />
        <line x1="0" y1="-92" x2="0" y2="-8" stroke="#111" strokeWidth="0.8" />
        <line x1="0" y1="8" x2="0" y2="40" stroke="#111" strokeWidth="0.8" />
        {Array.from({ length: 9 }, (_, i) => i - 4)
          .filter((i) => i)
          .map((i) => (
            <line key={i} x1={i * 10} y1="-3" x2={i * 10} y2="3" stroke="#111" strokeWidth="0.7" />
          ))}
        {Array.from({ length: 4 }, (_, i) => i + 1).map((i) => (
          <line key={i} x1="-3" y1={i * 8} x2="3" y2={i * 8} stroke="#111" strokeWidth="0.7" />
        ))}
      </svg>
      {!raised && <div className="room-peri-dark" style={{ opacity: Math.min(1, 1.15 - pr.pos) }} />}
      {!raised && (
        <div className="room-peri-off">
          <b>PERISCÓPIO {pr.cmd ? `IÇANDO… ${Math.round(pr.pos * 100)} %` : 'ARRIADO'}</b>
          <span>{pr.cmd ? 'Aguarde o fim do curso.' : 'Ice o periscópio para olhar.'}</span>
        </div>
      )}
      <div className="room-peri-bar" onPointerDown={(ev) => ev.stopPropagation()}>
        <div className="room-peri-brg mono">
          <span>
            MARCAÇÃO <b>{String(Math.round(trueBrg)).padStart(3, '0')}°</b>
          </span>
          <span>
            relativa {sight.bearing >= 0 ? 'BE' : 'BB'} {Math.abs(Math.round(sight.bearing))}°
          </span>
          <span>elevação {fmt(sight.elev, 0)}°</span>
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn sm" onClick={() => setSight({ ...sight, bearing: wrap(sight.bearing - 10) })}>
            ◀ 10°
          </button>
          <button className="btn sm" onClick={() => setSight({ ...sight, bearing: 0, elev: 0 })}>
            Proa
          </button>
          <button className="btn sm" onClick={() => setSight({ ...sight, bearing: wrap(sight.bearing + 10) })}>
            10° ▶
          </button>
          <span className="seg">
            {PERI_POWERS.map((p) => (
              <button key={p.label} className={Math.abs(sight.fov - p.fov) < 0.1 ? 'on' : ''} onClick={() => setSight({ ...sight, fov: p.fov })}>
                {p.label}
              </button>
            ))}
          </span>
          <button className={`btn sm ${pr.cmd ? 'on' : ''}`} onClick={() => cmd({ type: 'periscope', raise: !pr.cmd })}>
            {pr.cmd ? 'Arriar' : 'Içar'} periscópio
          </button>
          <button className="btn sm warn" onClick={onExit}>
            Sair (Esc)
          </button>
        </div>
        <div className="subtle">
          Arraste para girar o periscópio · cota {fmt(e.outputs.depthKeel, 1)} m · {fmt(toKnots(e.outputs.speed), 1)} nós
        </div>
      </div>
    </div>
  );
}

const PIP_VIEWS: [ViewMode, string][] = [
  ['perseguicao', 'Perseguição'],
  ['piloto', 'Lateral'],
  ['topo', 'Topo'],
];

const LIGHT_LABEL: Record<RoomLighting, string> = { normal: 'Normal', vermelha: 'Vermelha', azul: 'Azul' };

export function ControlRoomScreen() {
  const e = useSim(4);
  const box = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ControlRoomScene | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [frame, setFrame] = useState<FrameInfo | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [panelOpen, setPanelOpen] = usePersisted('room.panelOpen', true);
  const [help, setHelp] = usePersisted('room.help', true);
  const [menu, setMenu] = useState(false);
  const [peri, setPeri] = useState(false);
  const [sight, setSight] = usePersisted<PeriscopeSight>('room.sight', { bearing: 0, elev: 0, fov: 32 });
  const [pip, setPip] = usePersisted('room.pip', false);
  const [pipView, setPipView] = usePersisted<ViewMode>('room.pipView', 'perseguicao');
  const [lighting, setLighting] = useState<RoomLighting>('normal');
  const periRef = useRef(peri);
  periRef.current = peri;
  const lightingRef = useRef(lighting);
  lightingRef.current = lighting;
  const sightRef = useRef(sight);
  sightRef.current = sight;
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  const acts = useMemo<RoomActions>(
    () => ({
      cmd: (c) => cmd(c),
      maneuver: (k, t) => (k === 'cancelar' ? maneuver.cancel(runner) : maneuver.start(runner, k, t)),
      maneuverStatus: maneuverText,
      periscopeView: () => setPeri(true),
      focus: (id) => sceneRef.current?.focus(id),
      sim: {
        running: () => runner.running,
        toggleRun: () => {
          runner.running = !runner.running;
          runner.notify();
        },
        timeScale: () => runner.timeScale,
        setTimeScale: (x) => {
          runner.timeScale = x;
          runner.notify();
        },
        scenarios: () => SCENARIOS.map((s) => ({ id: s.id, name: s.name })),
        loadScenario: (id) => loadScenario(id),
      },
      traffic: () => graphics.get().traffic,
      geoOrigin: () => geoOriginOf(runner.engine),
      route: () => ({ points: route.points, idx: route.idx, active: route.active }),
    }),
    [],
  );

  // cena 3D (carregada sob demanda)
  useEffect(() => {
    let raf = 0;
    let disposed = false;
    let ro: ResizeObserver | null = null;
    let lastSave = 0;
    import('../../render3d/controlRoom/ControlRoomScene')
      .then(({ ControlRoomScene }) => {
        if (disposed || !box.current) return;
        let sc: ControlRoomScene;
        try {
          sc = new ControlRoomScene(box.current, runner, acts, defaultQuality());
        } catch (ex) {
          setErr('Não foi possível iniciar o WebGL neste navegador: ' + String(ex));
          return;
        }
        sceneRef.current = sc;
        const pose = loadPersisted<{ pos: [number, number, number]; yaw: number; pitch: number } | null>('room.pose', null);
        if (pose) sc.setPose(pose);
        const scen = SCENARIOS.findIndex((s) => s.id === runner.engine.state.scenarioId);
        sc.ui.scenario = Math.max(0, scen);
        sc.onHover = setHover;
        sc.onFrame = setFrame;
        sc.onFocus = (id) => {
          setFocus(id);
          if (id) setMenu(false);
        };
        ro = new ResizeObserver(() => sc.resize());
        ro.observe(box.current);
        setReady(true);
        const loop = () => {
          if (!periRef.current) {
            sc.periBearing = sightRef.current.bearing;
            sc.render();
            if (sc.ui.lighting !== lightingRef.current) setLighting(sc.ui.lighting);
          }
          if (performance.now() - lastSave > 1000) {
            lastSave = performance.now();
            if (!sc.focused) savePersisted('room.pose', sc.getPose());
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      })
      .catch((ex) => setErr(String(ex)));
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      const sc = sceneRef.current;
      if (sc && !sc.focused) savePersisted('room.pose', sc.getPose());
      sc?.dispose();
      sceneRef.current = null;
    };
  }, [acts]);

  // teclado: andar (WASD/setas, Shift corre), Esc sai do foco/periscópio
  useEffect(() => {
    const isField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
    };
    const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
    const down = (ev: KeyboardEvent) => {
      if (isField(ev.target) || periRef.current) return;
      if (ev.code === 'Escape') {
        if (menu) setMenu(false);
        else sceneRef.current?.focus(null);
        return;
      }
      // Tab / Shift+Tab: posto seguinte/anterior; ← → no posto: tela seguinte/anterior
      if (ev.code === 'Tab' && !ev.ctrlKey && !ev.altKey) {
        ev.preventDefault();
        sceneRef.current?.stationStep(ev.shiftKey ? -1 : 1);
        setPanelOpen(true);
        return;
      }
      if (sceneRef.current?.focused && (ev.code === 'ArrowLeft' || ev.code === 'ArrowRight')) {
        ev.preventDefault();
        if (!ev.repeat) sceneRef.current.frameStep(ev.code === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (MOVE.has(ev.code)) {
        if (ev.code.startsWith('Arrow')) ev.preventDefault();
        sceneRef.current?.key(ev.code, true);
      }
    };
    const up = (ev: KeyboardEvent) => sceneRef.current?.key(ev.code, false);
    const blur = () => ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].forEach((k) => sceneRef.current?.key(k, false));
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [menu]);

  // roda do mouse: passo à frente/atrás (listener não passivo para não rolar a página)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      sceneRef.current?.wheel(-Math.sign(ev.deltaY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const go = (id: string) => {
    sceneRef.current?.focus(id);
    setPanelOpen(true);
    setMenu(false);
  };
  const leave = () => sceneRef.current?.focus(null);
  const setMove = (f: number, s: number) => {
    if (sceneRef.current) sceneRef.current.move = { f, s };
  };
  const holdBtn = (label: string, f: number, s: number, title: string) => (
    <button
      className="btn"
      title={title}
      onPointerDown={(ev) => {
        ev.preventDefault();
        (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
        setMove(f, s);
      }}
      onPointerUp={() => setMove(0, 0)}
      onPointerCancel={() => setMove(0, 0)}
      onContextMenu={(ev) => ev.preventDefault()}
    >
      {label}
    </button>
  );
  const s = e.state;
  const st = focus ? stationById(focus) : null;
  const order = nearestOrder(s.propulsion.rpmCmd);

  return (
    <div className={`room ${focus && panelOpen ? 'with-side' : ''}`}>
      <div className="room-view">
        <div
          className="room-canvas"
          ref={box}
          onPointerDown={(ev) => {
            if ((ev.target as HTMLElement).tagName !== 'CANVAS') return;
            (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
            sceneRef.current?.pointerDown(ev.clientX, ev.clientY);
          }}
          onPointerMove={(ev) => sceneRef.current?.pointerMove(ev.clientX, ev.clientY, ev.buttons)}
          onPointerUp={(ev) => sceneRef.current?.pointerUp(ev.clientX, ev.clientY)}
          onPointerCancel={(ev) => sceneRef.current?.pointerUp(ev.clientX, ev.clientY)}
          onPointerLeave={() => setHover(null)}
        />
        {err && <div className="room-err">{err}</div>}
        {!ready && !err && <div className="room-loading">Montando a sala de comando…</div>}
        <div className="room-hud">
          <div className="room-nums mono">
            <span>
              <small>PROF</small> <b>{fmt(0.5 * (s.sensors.PRF1.value + s.sensors.PRF2.value), 1)} m</b>
            </span>
            <span>
              <small>RUMO</small> <b>{String(Math.round(((s.sensors.GIRO.value % 360) + 360) % 360)).padStart(3, '0')}°</b>
            </span>
            <span>
              <small>VEL</small> <b>{fmt(toKnots(s.sensors.DVLU.value), 1)} nós</b>
            </span>
            <span>
              <small>MÁQ.</small> <b>{order.label}</b>
            </span>
            <span>
              <small>θ</small> <b>{fmt(s.sensors.INSP.value, 1)}°</b>
            </span>
          </div>
          <div className="room-where">{st ? `● ${st.name}` : 'Sala de comando — ande e clique nos postos'}</div>
          {maneuverText() && <div className="room-man">⟳ {maneuverText()}</div>}
        </div>
        <div className="room-ctl" onPointerDown={(ev) => ev.stopPropagation()}>
          <button className={`btn sm ${menu ? 'on' : ''}`} onClick={() => setMenu(!menu)} title="Ir direto a um posto">
            Postos ▾
          </button>
          <button className="btn sm" onClick={() => setPeri(true)} title="Olhar pelo periscópio de ataque">
            Periscópio
          </button>
          <button className={`btn sm ${pip ? 'on' : ''}`} onClick={() => setPip(!pip)} title="Miniatura da vista 3D externa (a 2ª janela continua com a cena completa)">
            Vista externa
          </button>
          <button
            className="btn sm"
            onClick={() => {
              const sc = sceneRef.current;
              if (!sc) return;
              const order: RoomLighting[] = ['normal', 'vermelha', 'azul'];
              sc.ui.lighting = order[(order.indexOf(sc.ui.lighting) + 1) % 3];
              setLighting(sc.ui.lighting);
            }}
            title="Iluminação da sala: normal, vermelha (noturna) ou azul"
          >
            Luz: {LIGHT_LABEL[lighting]}
          </button>
          <button className={`btn sm ${help ? 'on' : ''}`} onClick={() => setHelp(!help)}>
            Ajuda
          </button>
          {menu && (
            <div className="room-menu">
              {STATIONS.map((x) => (
                <button key={x.id} className={`btn sm ${focus === x.id ? 'on' : ''}`} onClick={() => go(x.id)}>
                  {x.name}
                </button>
              ))}
              <button className="btn sm" onClick={() => (sceneRef.current?.setPose({ pos: [0.55, 1.65, 5.1], yaw: 0.05, pitch: -0.1 }), sceneRef.current?.focus(null), setMenu(false))}>
                ↺ Voltar à entrada (ré)
              </button>
            </div>
          )}
        </div>
        {help && (
          <div className="room-help" onPointerDown={(ev) => ev.stopPropagation()}>
            <b>Como usar a sala de comando</b>
            {coarse ? (
              <ul>
                <li>
                  <b>Andar:</b> segure os botões ▲ ▼ ◀ ▶.
                </li>
                <li>
                  <b>Olhar:</b> arraste o dedo na cena.
                </li>
                <li>
                  <b>Toque num posto:</b> a câmera se aproxima e o painel com todos os controles abre abaixo da cena. Tocar numa tela fora dos botões centraliza a câmera nela; ◀ ▶ passam de tela em tela.
                </li>
                <li>
                  <b>De perto:</b> toque nos botões das telas e do painel do lastro, nos volantes e no anunciador; arraste os <b>manches</b> e o <b>telégrafo</b>.
                </li>
                <li>
                  “Postos ▾” leva direto a cada posto; “Sair do posto” volta a andar. O <b>periscópio</b> abre a visada externa.
                </li>
              </ul>
            ) : (
              <ul>
                <li>
                  <b>Andar:</b> W A S D ou setas (Shift corre); roda do mouse = um passo (num posto, a roda aproxima a vista das telas).
                </li>
                <li>
                  <b>Olhar:</b> arraste em qualquer ponto vazio.
                </li>
                <li>
                  <b>Clique num posto de longe:</b> a câmera se aproxima e o painel com todos os controles abre ao lado. Clicar numa tela fora dos botões centraliza a câmera nela.
                </li>
                <li>
                  <b>No posto:</b> ← → (ou ◀ ▶) passam de tela em tela; <b>Tab</b> / Shift+Tab vão ao posto seguinte/anterior; a roda do mouse aproxima a vista.
                </li>
                <li>
                  <b>De perto:</b> os botões das telas, as lâmpadas do painel do lastro, os volantes e o anunciador funcionam com o clique; arraste os <b>manches</b> e o <b>telégrafo</b>.
                </li>
                <li>
                  <b>Esc</b> sai do posto. “Postos ▾” leva direto a cada um. O <b>periscópio</b> abre a visada externa.
                </li>
              </ul>
            )}
            <button className="btn sm" onClick={() => setHelp(false)}>
              Entendi
            </button>
          </div>
        )}
        {focus && (
          <div className="room-focusbar" onPointerDown={(ev) => ev.stopPropagation()}>
            <button className="btn sm" onClick={leave}>
              ✕ Sair do posto (Esc)
            </button>
            {frame && frame.n > 1 && (
              <span className="room-frames">
                <button className="btn sm" onClick={() => sceneRef.current?.frameStep(-1)} title="Enquadramento anterior (←)">
                  ◀
                </button>
                <span className="room-frame-name">
                  {frame.name} <small>{`${frame.i + 1}/${frame.n}`}</small>
                </span>
                <button className="btn sm" onClick={() => sceneRef.current?.frameStep(1)} title="Próximo enquadramento (→)">
                  ▶
                </button>
              </span>
            )}
            {!panelOpen && (
              <button className="btn sm on" onClick={() => setPanelOpen(true)}>
                Abrir painel
              </button>
            )}
            {focus === 'periscopio' && (
              <button className="btn sm ok" onClick={() => setPeri(true)}>
                Olhar
              </button>
            )}
          </div>
        )}
        <div className={`room-hint ${hover?.direct ? 'direct' : ''} ${hover ? '' : 'idle'}`}>
          {hover
            ? hover.text
            : focus
              ? coarse
                ? 'Toque nos controles · ◀ ▶ trocam de tela · painel abaixo'
                : 'Clique nos controles · ← → trocam de tela · Tab = próximo posto'
              : coarse
                ? 'Arraste para olhar · ▲▼◀▶ para andar · toque num posto'
                : 'Arraste para olhar · WASD para andar · clique num posto para se aproximar'}
        </div>
        {coarse && !focus && (
          <div className="room-pad" onPointerDown={(ev) => ev.stopPropagation()}>
            <span />
            {holdBtn('▲', 1, 0, 'Andar para a frente')}
            <span />
            {holdBtn('◀', 0, -1, 'Passo para a esquerda')}
            {holdBtn('▼', -1, 0, 'Andar para trás')}
            {holdBtn('▶', 0, 1, 'Passo para a direita')}
          </div>
        )}
        {pip && !peri && (
          <div className="room-pip" onPointerDown={(ev) => ev.stopPropagation()}>
            <Scene3D
              view={pipView}
              quality="baixa"
              labels={false}
              syncVisual={false}
              persistKey="roompip"
              layers={{ markers: true, wake: true, ships: true, labels: false, vectors: false, hydroVectors: false, tanks: false, trimRef: false }}
            >
              <div className="room-pip-ctl">
                <span className="seg">
                  {PIP_VIEWS.map(([k, l]) => (
                    <button key={k} className={pipView === k ? 'on' : ''} onClick={() => setPipView(k)}>
                      {l}
                    </button>
                  ))}
                </span>
                <button className="btn sm" onClick={() => setPip(false)}>
                  ✕
                </button>
              </div>
            </Scene3D>
          </div>
        )}
        {peri && <PeriscopeView sight={sight} setSight={setSight} onExit={() => setPeri(false)} />}
      </div>
      {focus && panelOpen && <StationPanel id={focus} acts={acts} onClose={() => setPanelOpen(false)} onPeri={() => setPeri(true)} />}
    </div>
  );
}
