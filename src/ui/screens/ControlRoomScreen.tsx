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
import { defaultQuality } from '../components/Scene3D';
import type { PeriscopeSight } from '../../render3d/SubmarineScene';
import { RoomPip } from './RoomPip';
import { RoomPeriscope, recentMarks } from './RoomPeriscope';
import { RoomBridge } from './RoomBridge';
import { periMarks } from './periMarks';
import { RoomAudio } from './roomAudio';
import type { SimulationEngine } from '../../sim/core/engine';
import { cpa } from '../../sim/geo';
import { nearestOrder } from '../../sim/telegraph';
import { fmt, fmtSpeed } from '../format';
import { FpsMeter, useRenderPerf } from '../components/FpsMeter';

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
                {Math.round(c.course)}° · {fmtSpeed(c.speed, 1)}
              </td>
              <td className="mono">{p.tcpa > 0 ? `${fmt(p.dcpa / 1852, 1)} mn em ${Math.round(p.tcpa / 60)} min` : 'afastando'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** conteúdo 2D de cada estação (os mesmos controles da Operação) */
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
    alarmes: (
      <>
        <G.alarmes.Body e={e} />
        <G.falhas.Body e={e} />
      </>
    ),
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
        {recentMarks().length > 0 && (
          <div className="subtle">
            Marcações: <span className="mono">{recentMarks().slice(-6).join(' · ')}</span>{' '}
            <button className="btn sm" onClick={() => periMarks.clear()}>
              Apagar marcações
            </button>
          </div>
        )}
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
          GPS: <b>{mastOut(e) ? 'fixo válido' : 'sem sinal (antena submersa)'}</b> · rumo {fmt(e.state.sensors.GIRO.value, 0)}° · {fmtSpeed(e.state.sensors.DVLU.value, 1)} · fundo {fmt(e.outputs.bottomDepth, 0)}{' '}
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

const LIGHT_LABEL: Record<RoomLighting, string> = { normal: 'Normal', vermelha: 'Vermelha', azul: 'Azul' };

export function ControlRoomScreen() {
  const e = useSim(4);
  const box = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ControlRoomScene | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const perf = useRenderPerf();
  const [ready, setReady] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [frame, setFrame] = useState<FrameInfo | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [panelOpen, setPanelOpen] = usePersisted('room.panelOpen', true);
  const [help, setHelp] = usePersisted('room.help', true);
  const [menu, setMenu] = useState(false);
  const [optMenu, setOptMenu] = useState(false);
  const audio = useMemo(() => new RoomAudio(), []);
  const [sound, setSound] = useState(false);
  const [voice, setVoice] = usePersisted('room.voice', false);
  const [tilt, setTilt] = usePersisted('room.tilt', true);
  const tiltRef = useRef(tilt);
  tiltRef.current = tilt;
  const [peri, setPeriState] = useState(false);
  const [bridge, setBridgeState] = useState(false);
  // periscópio e passadiço são exclusivos (cada um cobre a sala inteira)
  const setPeri = (on: boolean) => {
    setPeriState(on);
    if (on) setBridgeState(false);
  };
  const setBridge = (on: boolean) => {
    setBridgeState(on);
    if (on) setPeriState(false);
  };
  const [sight, setSight] = usePersisted<PeriscopeSight>('room.sight', { bearing: 0, elev: 0, fov: 32 });
  const [pip, setPip] = usePersisted('room.pip', false);
  const [lighting, setLighting] = useState<RoomLighting>('normal');
  const pipRef = useRef(pip);
  pipRef.current = pip;
  const periRef = useRef(peri);
  periRef.current = peri;
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
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
      periMarks: () => periMarks.list(runner.engine.state.t),
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
          const scale = perf.frame(() => sc.renderStats());
          if (!periRef.current && !bridgeRef.current) {
            sc.setRenderScale(scale);
            sc.periBearing = sightRef.current.bearing;
            sc.tilt = tiltRef.current;
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
  }, [acts, perf.frame]);

  // som e anúncios (1MC): leem o estado algumas vezes por segundo
  useEffect(() => {
    audio.setVoice(voice);
  }, [audio, voice]);
  useEffect(() => {
    const id = window.setInterval(() => audio.update(runner.engine), 250);
    return () => {
      window.clearInterval(id);
      audio.dispose();
    };
  }, [audio]);

  // teclado: andar (WASD/setas, Shift corre), Esc sai do foco/periscópio
  useEffect(() => {
    const isField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
    };
    const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
    const down = (ev: KeyboardEvent) => {
      if (isField(ev.target) || periRef.current || bridgeRef.current) return;
      if (ev.code === 'Escape') {
        if (menu || optMenu) {
          setMenu(false);
          setOptMenu(false);
        } else sceneRef.current?.focus(null);
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
      if (ev.code === 'KeyP' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        setPip(!pipRef.current);
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
  }, [menu, optMenu]);

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
        {perf.show && <FpsMeter meterRef={perf.meterRef} />}
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
              <small>VEL</small> <b>{fmtSpeed(s.sensors.DVLU.value, 1)}</b>
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
          <button className="btn sm" onClick={() => setBridge(true)} title="Subir ao passadiço, no alto da vela: olhar em volta e usar o binóculo 7×50 (com o submarino na superfície)">
            Subir à vela
          </button>
          <button className={`btn sm ${pip ? 'on' : ''}`} onClick={() => setPip(!pip)} title="Submarino 3D numa janela sobre a sala (picture-in-picture; tecla P). A 2ª janela continua com a cena completa.">
            ⧉ Submarino 3D
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
          <button className={`btn sm ${optMenu ? 'on' : ''}`} onClick={() => setOptMenu(!optMenu)} title="Som, anúncios por voz e inclinação da sala">
            {sound ? '🔊' : '🔈'} Opções ▾
          </button>
          <button className={`btn sm ${help ? 'on' : ''}`} onClick={() => setHelp(!help)}>
            Ajuda
          </button>
          {optMenu && (
            <div className="room-menu room-opts">
              <label className="chk">
                <input
                  type="checkbox"
                  checked={sound}
                  onChange={(ev) => {
                    audio.setSound(ev.target.checked);
                    setSound(ev.target.checked);
                  }}
                />{' '}
                Som (máquinas, sopro, buzina de imersão, telégrafo, alarmes)
              </label>
              <label className="chk">
                <input type="checkbox" checked={voice} onChange={(ev) => setVoice(ev.target.checked)} /> Voz: anúncios no fonoclama (1MC)
              </label>
              <label className="chk">
                <input type="checkbox" checked={tilt} onChange={(ev) => setTilt(ev.target.checked)} /> Sala inclina com o caturro e a banda (andando)
              </label>
            </div>
          )}
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
                  “Postos ▾” leva direto a cada posto; “Sair do posto” volta a andar. O <b>periscópio</b> abre a visada externa; <b>Subir à vela</b> leva ao passadiço (olho nu e binóculo).
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
                  <b>Esc</b> sai do posto. “Postos ▾” leva direto a cada um. O <b>periscópio</b> abre a visada externa; <b>Subir à vela</b> leva ao passadiço, no alto da vela (olho nu e binóculo 7×50).
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
        {pip && !peri && !bridge && <RoomPip onClose={() => setPip(false)} />}
        {peri && <RoomPeriscope sight={sight} setSight={setSight} onExit={() => setPeri(false)} acts={acts} />}
        {bridge && <RoomBridge onExit={() => setBridge(false)} />}
      </div>
      {focus && panelOpen && <StationPanel id={focus} acts={acts} onClose={() => setPanelOpen(false)} onPeri={() => setPeri(true)} />}
    </div>
  );
}
