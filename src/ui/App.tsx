/** Aplicação: barra superior, navegação entre telas e modo engenharia. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { UiContext, useUi, type ScreenId } from './uiContext';
import { baseConfig, cmd, runner, useSim } from './store';
import { buildScenario } from '../sim/scenarios';
import { visibleAlarms, PRIORITY_LABEL } from '../sim/systems/alarms';
import { captureSession, restoreSession } from './session';
import { storage } from './storage';
import { toKnots } from '../sim/units';
import { fmt, fmtTime } from './format';
import { SimSpeedButtons } from './components/Controls';
import { CommandCenter } from './screens/CommandCenter';
import { PilotScreen } from './screens/PilotScreen';
import { HelmScreen } from './screens/HelmScreen';
import { ControlRoomScreen } from './screens/ControlRoomScreen';
import { PresentationScreen } from './screens/PresentationScreen';
import { TacticalMapScreen } from './screens/TacticalMapScreen';
import { EnergyFlowScreen } from './screens/EnergyFlowScreen';
import { BallastScreen } from './screens/BallastScreen';
import { TrimHeelScreen } from './screens/TrimHeelScreen';
import { PropulsionScreen } from './screens/PropulsionScreen';
import { SafetyScreen } from './screens/SafetyScreen';
import { View3DScreen } from './screens/View3DScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { ScenarioScreen } from './screens/ScenarioScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useIdentity } from './appearance';
import { RecIndicator } from './components/RecordingPanel';
import { recorder } from './recorder';
import { AuxSystemsScreen } from './screens/AuxSystemsScreen';
import { ValidationScreen } from './screens/ValidationScreen';
import { HelpScreen } from './screens/HelpScreen';
import { Inspector } from './inspector/Inspector';
import { ProcedurePanel } from './components/Procedure';
import { demo } from './demo';
import { maneuver } from './maneuvers';
import { opsBus, ALARM_GROUP } from './ops/opsBus';
import { loadScenario } from './ops/OpsGroups';
import { SCENARIOS } from '../sim/scenarios';
import { link } from './link';
import { isPanelWindow, openPanelWindow, openVisualWindow, panelIndex } from './sync';
import { loadPersisted, savePersisted } from './persist';

const TABS: { id: ScreenId; n?: string; label: string }[] = [
  { id: 'pilotagem', n: '0', label: 'Pilotagem' },
  { id: 'governo', label: 'Governo' },
  { id: 'apresentacao', label: 'Apresentação' },
  { id: 'mapa', label: 'Mapa tático' },
  { id: 'energia', label: 'Fluxo de energia' },
  { id: 'comando', n: '1', label: 'Central de comando' },
  { id: 'lastro', n: '2', label: 'Lastro e compensação' },
  { id: 'trim', n: '3', label: 'Trim e banda' },
  { id: 'propulsao', n: '4', label: 'Propulsão e energia' },
  { id: 'seguranca', n: '5', label: 'Segurança' },
  { id: 'v3d', n: '6', label: 'Visualização 3D' },
  { id: 'historico', n: '7', label: 'Histórico' },
  { id: 'cenarios', label: 'Cenários' },
  { id: 'config', label: '⚙ Configurações' },
  { id: 'auxiliares', label: 'Sistemas auxiliares' },
  { id: 'validacao', label: 'Validação' },
  { id: 'ajuda', label: 'Guia' },
  { id: 'sala', n: '8', label: 'Sala de comando' },
];

function ScenarioPicker({ current }: { current: string }) {
  const [sel, setSel] = useState(current);
  useEffect(() => setSel(current), [current]);
  return (
    <span className="row" style={{ gap: 4 }}>
      <select value={sel} onChange={(ev) => setSel(ev.target.value)} style={{ maxWidth: 170 }} aria-label="Cenário">
        {SCENARIOS.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      <button className="btn" onClick={() => loadScenario(sel)} title="Carrega o cenário (pausado)">
        Carregar
      </button>
    </span>
  );
}

function TopBar({ topRef }: { topRef: React.RefObject<HTMLDivElement> }) {
  const e = useSim(8);
  const s = e.state;
  const o = e.outputs;
  const vis = visibleAlarms(s);
  const unack = vis.filter((a) => !a.acked);
  const top = unack[0] ?? vis[0];
  const ui = useUi();
  const id = useIdentity();
  // celular: controles secundários recolhidos atrás de "☰" (no PC tudo fica visível, como sempre)
  const [phMore, setPhMore] = useState(false);
  return (
    <div className={`topbar${phMore ? '' : ' ph-collapsed'}`} ref={topRef}>
      <div className="brand">
        <b>{id.name}</b>
        <span>Simulador técnico de submarino · embarcação fictícia</span>
      </div>
      <div className="simctl">
        <button className={`btn ${runner.running ? 'on' : 'ok'}`} onClick={() => ((runner.running = !runner.running), runner.notify())} title="Executar/pausar (Espaço)">
          {runner.running ? '❚❚ Pausar' : '▶ Executar'}
        </button>
        <button className="btn ph-more" disabled={runner.running} onClick={() => runner.stepOnce(1)} title="Avançar um passo fixo">
          +1 passo
        </button>
        <button className="btn ph-more" disabled={runner.running} onClick={() => runner.stepOnce(50)} title="Avançar 1 s">
          +1 s
        </button>
        <button
          className="btn warn ph-more"
          onClick={() => {
            demo.stop(runner);
            maneuver.cancel(runner);
            runner.running = false;
            runner.replaceEngine(buildScenario(s.scenarioId, baseConfig()));
          }}
          title="Reiniciar o cenário atual"
        >
          ↺ Reiniciar
        </button>
        <span className="ph-wrap ph-more">
          <SimSpeedButtons />
        </span>
        <span className="clock" title="Tempo de simulação">
          {fmtTime(s.t)}
        </span>
        {runner.running && runner.lagging && <span className="badge warn">CPU: tempo reduzido</span>}
        <span className="ph-wrap ph-more">
          <ScenarioPicker current={s.scenarioId} />
        </span>
        <RecIndicator />
        {isPanelWindow ? (
          <>
            <span className={`badge ${link.viewer?.connected ? 'ok' : 'warn'}`} title="Esta janela espelha a janela de controle: os comandos dados aqui são executados lá">
              Tela {panelIndex} · {link.viewer?.connected ? 'espelhando o controle' : 'sem conexão'}
            </span>
            <button
              className="btn ph-more"
              onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)}
              title="Tela cheia neste monitor (F11 também funciona)"
            >
              ⛶ Tela cheia
            </button>
          </>
        ) : (
          <>
            <button className={`btn ph-more ${link.master?.connected ? 'on' : ''}`} onClick={openVisualWindow} title="Abre a cena numa segunda janela (ex.: outro monitor), espelhando esta simulação">
              ⧉ 2ª janela{link.master?.connected ? ' ✓' : ''}
            </button>
            <button
              className={`btn ph-more ${link.master?.panelConnected ? 'on' : ''}`}
              onClick={() => {
                const n = openPanelWindow();
                ui.toast(`Tela ${n} aberta: arraste-a para o outro monitor e escolha a aba. Comandos dados nela valem aqui.`);
              }}
              title="Abre outra janela com o simulador completo (todas as abas), espelhando esta simulação — ex.: o mapa tático num 3º monitor"
            >
              ＋ Tela{link.master?.panelConnected ? ' ✓' : ''}
            </button>
          </>
        )}
        <button className={`btn phone-only ph-toggle ${phMore ? 'on' : ''}`} onClick={() => setPhMore(!phMore)} aria-expanded={phMore} title="Mais controles (cenário, passos, aceleração, 2ª janela, engenharia)">
          {phMore ? '✕' : '☰'}
        </button>
      </div>
      <div className="strip">
        <div className="kv">
          <small>PROF (m)</small>
          <b>{fmt(0.5 * (s.sensors.PRF1.value + s.sensors.PRF2.value), 1)}</b>
        </div>
        <div className="kv">
          <small>VEL (nós)</small>
          <b>{fmt(toKnots(s.sensors.DVLU.value), 1)}</b>
        </div>
        <div className="kv">
          <small>RUMO</small>
          <b>{fmt(s.sensors.GIRO.value, 0)}°</b>
        </div>
        <div className="kv">
          <small>PITCH</small>
          <b>{fmt(s.sensors.INSP.value, 1)}°</b>
        </div>
        <div className="kv">
          <small>BANDA</small>
          <b>{fmt(s.sensors.INSR.value, 1)}°</b>
        </div>
        {o.surfaced ? (
          <div className="kv" title="Reserva de flutuabilidade: peso adicional necessário para submergir por completo">
            <small>RESERVA</small>
            <b>{fmt(o.reserveKg / 1000, 1)} t</b>
          </div>
        ) : (
          <div className="kv" title="Flutuabilidade líquida calculada (+ positiva)">
            <small>FLUTUAB.</small>
            <b style={{ color: Math.abs(o.netBuoyancyKg) > 2000 ? '#f5b041' : undefined }}>{fmt(o.netBuoyancyKg / 1000, 2)} t</b>
          </div>
        )}
        <div className="kv">
          <small>BATERIA</small>
          <b>{fmt(s.electrical.soc * 100, 0)}%</b>
        </div>
      </div>
      <div
        className="annunciator"
        onClick={() => {
          // alarme → sistema afetado na central de operação
          ui.setScreen('pilotagem');
          opsBus.focus(top ? (ALARM_GROUP[top.def.system] ?? 'falhas') : 'falhas');
        }}
        style={{ cursor: 'pointer' }}
        title="Abrir o sistema afetado na Pilotagem"
      >
        {top ? (
          <>
            <span className={`badge ${top.def.priority <= 2 ? 'alarm' : 'warn'} ${!top.acked && top.active ? 'blink' : ''}`}>
              {PRIORITY_LABEL[top.def.priority]} {unack.length > 1 ? `+${unack.length - 1}` : ''}
            </span>
            <span className={`msg prio${top.def.priority}`}>{top.def.text}</span>
            {unack.length > 0 && (
              <button
                className="btn sm"
                onClick={(ev) => {
                  ev.stopPropagation();
                  cmd({ type: 'ack', id: 'ALL' });
                }}
              >
                Reconhecer
              </button>
            )}
          </>
        ) : (
          <span className="badge ok">SEM ALARMES</span>
        )}
      </div>
      <div className="row ph-more" style={{ gap: 6 }}>
        <button className={`btn ${ui.eng ? 'on' : ''}`} onClick={() => ui.setEng(!ui.eng)} title="Modo engenharia (I)">
          ⓘ Engenharia
        </button>
        <button className={`btn ${ui.showProcedure ? 'on' : ''}`} onClick={() => ui.setShowProcedure(!ui.showProcedure)}>
          Procedimento
        </button>
      </div>
    </div>
  );
}

/** aba de cada janela de tela (a janela de controle usa as preferências gerais) */
const PANEL_SCREEN_KEY = `tela${panelIndex}.screen`;

/** janela de tela sem a janela de controle aberta */
function PanelWait() {
  useSim(2);
  if (link.viewer?.connected) return null;
  return (
    <div className="visual-wait" style={{ position: 'fixed', zIndex: 60 }}>
      <b>Tela {panelIndex}: aguardando a janela de controle…</b>
      <span>Esta janela mostra a mesma simulação da janela principal do simulador (aberta no mesmo navegador). Abra o simulador e use “＋ Tela”, ou deixe as duas abertas.</span>
      {!link.viewer?.available && <span className="badge alarm">Este navegador não permite comunicação entre janelas (BroadcastChannel).</span>}
    </div>
  );
}

export function App() {
  const prefs = storage.getPrefs({ screen: 'pilotagem' as ScreenId, eng: false });
  const [screen, setScreen] = useState<ScreenId>(() => (isPanelWindow ? loadPersisted<ScreenId>(PANEL_SCREEN_KEY, 'mapa') : prefs.screen));
  const [eng, setEngState] = useState<boolean>(prefs.eng);
  const [inspect, setInspect] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [showProcedure, setShowProcedure] = useState(false);
  const [resume, setResume] = useState(() => (isPanelWindow ? null : storage.getAutosave()));
  const topRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number>(0);

  const toast = (m: string) => {
    setToastMsg(m);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 3500);
  };
  const setEng = (v: boolean) => {
    setEngState(v);
    if (v) toast('Modo engenharia: clique em tanques, válvulas, bombas, lemes ou instrumentos.');
    else setInspect(null);
  };

  useEffect(() => {
    if (isPanelWindow) savePersisted(PANEL_SCREEN_KEY, screen);
    else storage.setPrefs({ screen, eng });
  }, [screen, eng]);

  // janela de tela: nome da aba na barra do navegador (ajuda a achar a janela certa)
  useEffect(() => {
    if (isPanelWindow) document.title = `Tela ${panelIndex} — ${TABS.find((t) => t.id === screen)?.label ?? ''}`;
  }, [screen]);

  // comandos recusados durante a reprodução de uma gravação
  useEffect(() => {
    let last = 0;
    recorder.onBlocked = (m) => {
      if (performance.now() - last > 4000) toast(m);
      last = performance.now();
    };
    return () => {
      recorder.onBlocked = null;
    };
  }, []);

  // altura da barra superior → posição das abas
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // cliques na janela de visualização abrem os controles aqui
  useEffect(() => {
    if (!link.master) return;
    link.master.onPick = (p) => {
      setScreen('pilotagem');
      opsBus.select(p);
    };
  }, []);

  // salvamento automático
  useEffect(() => {
    if (isPanelWindow) return; // quem salva é a janela de controle
    const id = window.setInterval(() => {
      if (runner.running) storage.setAutosave(captureSession('Salvamento automático'));
    }, 20000);
    return () => window.clearInterval(id);
  }, []);

  // atalhos de teclado
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      const s = runner.engine.state;
      const k = ev.key.toLowerCase();
      // na sala de comando W/A/S/D andam (e Q/E ficam livres): os lemes vão pelos manches
      if (screen === 'sala' && 'wasdqe'.includes(k) && k.length === 1) return;
      if (k === ' ') {
        ev.preventDefault();
        runner.running = !runner.running;
        runner.notify();
      } else if (k === 'a' || k === 'd') cmd({ type: 'surface', id: 'rudder', angle: s.surfaces.rudder.cmd + (k === 'd' ? 5 : -5) });
      else if (k === 'w' || k === 's') cmd({ type: 'surface', id: 'stern', angle: s.surfaces.stern.cmd + (k === 's' ? 5 : -5) });
      else if (k === 'q' || k === 'e') cmd({ type: 'surface', id: 'bow', angle: s.surfaces.bow.cmd + (k === 'e' ? 5 : -5) });
      else if (k === '+' || k === '=') cmd({ type: 'telegraph', rpm: s.propulsion.rpmCmd + 10 });
      else if (k === '-') cmd({ type: 'telegraph', rpm: s.propulsion.rpmCmd - 10 });
      else if (k === 'i') setEng(!eng);
      else if (/^[0-8]$/.test(k)) setScreen(TABS.find((x) => x.n === k)!.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const screens: Record<ScreenId, ReactNode> = {
    pilotagem: <PilotScreen />,
    governo: <HelmScreen />,
    sala: <ControlRoomScreen />,
    apresentacao: <PresentationScreen />,
    mapa: <TacticalMapScreen />,
    energia: <EnergyFlowScreen />,
    comando: <CommandCenter />,
    lastro: <BallastScreen />,
    trim: <TrimHeelScreen />,
    propulsao: <PropulsionScreen />,
    seguranca: <SafetyScreen />,
    v3d: <View3DScreen />,
    historico: <HistoryScreen />,
    cenarios: <ScenarioScreen />,
    config: <SettingsScreen />,
    auxiliares: <AuxSystemsScreen />,
    validacao: <ValidationScreen />,
    ajuda: <HelpScreen />,
  };

  return (
    <UiContext.Provider value={{ screen, setScreen, eng, setEng, inspect, setInspect, toast, showProcedure, setShowProcedure }}>
      <div className={`app ${eng ? 'eng' : ''}`}>
        <TopBar topRef={topRef} />
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={screen === t.id ? 'active' : ''} onClick={() => setScreen(t.id)}>
              {t.n && <span className="n">{t.n}</span>}
              {t.label}
            </button>
          ))}
        </nav>
        {resume && (
          <div className="banner">
            <span>
              Sessão anterior encontrada (t = {fmtTime(resume.simTime)}, {new Date(resume.savedAt).toLocaleString('pt-BR')}).
            </span>
            <button
              className="btn"
              onClick={() => {
                try {
                  const r = restoreSession(resume);
                  toast(`Sessão carregada (pausada${r.resumed.length ? `; em andamento: ${r.resumed.join(', ')}` : ''}). Pressione ▶ para continuar.`);
                } catch (ex) {
                  toast('Não foi possível retomar: ' + (ex instanceof Error ? ex.message : String(ex)));
                }
                setResume(null);
              }}
            >
              Retomar
            </button>
            <button
              className="btn"
              onClick={() => {
                storage.clearAutosave();
                setResume(null);
              }}
            >
              Descartar
            </button>
          </div>
        )}
        <main className="main">
          <div className="screen">{screens[screen]}</div>
          {eng && inspect && <Inspector />}
        </main>
        {showProcedure && (
          <div className="panel" style={{ position: 'fixed', left: 10, bottom: 10, width: 360, maxWidth: 'calc(100% - 20px)', maxHeight: '55vh', overflow: 'auto', zIndex: 40, boxShadow: '0 6px 24px rgba(0,0,0,0.5)' }}>
            <header>
              <h3>Procedimento guiado</h3>
              <button className="btn sm" onClick={() => setShowProcedure(false)}>
                ✕
              </button>
            </header>
            <div className="body">
              <ProcedurePanel />
            </div>
          </div>
        )}
        {isPanelWindow && <PanelWait />}
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    </UiContext.Provider>
  );
}
