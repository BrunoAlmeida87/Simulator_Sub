/** Aplicação: barra superior, navegação em dois níveis (grupos → telas, ver nav.ts) e modo engenharia. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { UiContext, useUi, type ScreenId, type ToastOptions } from './uiContext';
import { replaceUndo, UNDO_MS } from './undo';
import { baseConfig, cmd, runner, useSim } from './store';
import { buildScenario } from '../sim/scenarios';
import { captureSession, restoreSession } from './session';
import { storage } from './storage';
import { fmt, fmtTime, fmtSpeed } from './format';
import { SimSpeedButtons } from './components/Controls';
import { CommandCenter } from './screens/CommandCenter';
import { PilotScreen } from './screens/PilotScreen';
import { HelmScreen } from './screens/HelmScreen';
import { ControlRoomScreen } from './screens/ControlRoomScreen';
import { PresentationScreen } from './screens/PresentationScreen';
import { TacticalMapScreen } from './screens/TacticalMapScreen';
import { SonarScreen } from './screens/SonarScreen';
import { WeaponsScreen } from './screens/WeaponsScreen';
import { EnergyFlowScreen } from './screens/EnergyFlowScreen';
import { BallastScreen } from './screens/BallastScreen';
import { TrimHeelScreen } from './screens/TrimHeelScreen';
import { PropulsionScreen } from './screens/PropulsionScreen';
import { SafetyScreen } from './screens/SafetyScreen';
import { ModelsScreen } from './screens/ModelsScreen';
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
import { opsBus } from './ops/opsBus';
import { loadScenario } from './ops/OpsGroups';
import { SCENARIOS } from '../sim/scenarios';
import { link } from './link';
import { isPanelWindow, openPanelWindow, openVisualWindow, panelIndex } from './sync';
import { loadPersisted, savePersisted } from './persist';
import { NavBar } from './components/NavBar';
import { AlarmBand } from './components/AlarmBand';
import { SystemsOverview } from './screens/SystemsOverview';
import { StudioScreen } from './screens/StudioScreen';
import { PresFloating } from './components/PresFloating';
import { presPlayer } from './presBuilder/player';
import { isScreenId, screenForKey, screenLabel } from './nav';
import { BUTTON_SELECTOR, classifyFocus, focusFromKeyboard, installFocusTracking, shortcutAction } from './keyFocus';

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
      <button className="btn" onClick={() => loadScenario(sel)} title="Carrega o cenário (pausado). Por 10 s é possível desfazer.">
        Carregar
      </button>
    </span>
  );
}

function TopBar({ topRef }: { topRef: React.RefObject<HTMLDivElement> }) {
  const e = useSim(8);
  const s = e.state;
  const o = e.outputs;
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
        {/* junto do cenário (longe de +1 passo/+1 s); a simulação anterior fica guardada para “Desfazer” */}
        <button
          className="btn warn ph-more"
          onClick={() =>
            replaceUndo.run('Cenário reiniciado', () => {
              demo.stop(runner);
              maneuver.cancel(runner);
              runner.running = false;
              runner.replaceEngine(buildScenario(s.scenarioId, baseConfig()));
            })
          }
          title="Reiniciar o cenário atual (pausado). Por 10 s é possível desfazer."
        >
          ↺ Reiniciar
        </button>
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
      {/* 2ª linha, igual em todas as telas: faixa de alarme, indicadores (fora da Operação) e modos */}
      <div className="topbar-row2">
        <AlarmBand e={e} />
        <div className="strip">
          <div className="kv">
            <small>PROF (m)</small>
            <b>{fmt(0.5 * (s.sensors.PRF1.value + s.sensors.PRF2.value), 1)}</b>
          </div>
          <div className="kv">
            <small>VELOCIDADE</small>
            <b>{fmtSpeed(s.sensors.DVLU.value)}</b>
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
            <div className="kv" title="Flutuabilidade líquida calculada (+ positiva). ▲ acima de 2 t em módulo">
              <small>FLUTUAB.</small>
              <b className={Math.abs(o.netBuoyancyKg) > 2000 ? 'warnc' : undefined}>
                {Math.abs(o.netBuoyancyKg) > 2000 ? '▲ ' : ''}
                {fmt(o.netBuoyancyKg / 1000, 2)} t
              </b>
            </div>
          )}
          <div className="kv">
            <small>BATERIA</small>
            <b>{fmt(s.electrical.soc * 100, 0)}%</b>
          </div>
        </div>
        <div className="row ph-more topbar-modes" style={{ gap: 6 }}>
          <button className={`btn ${ui.eng ? 'on' : ''}`} onClick={() => ui.setEng(!ui.eng)} title="Modo engenharia (I)">
            ⓘ Engenharia
          </button>
          <button className={`btn ${ui.showProcedure ? 'on' : ''}`} onClick={() => ui.setShowProcedure(!ui.showProcedure)}>
            Procedimento
          </button>
        </div>
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
  const [screen, setScreen] = useState<ScreenId>(() => {
    const sc = isPanelWindow ? loadPersisted<ScreenId>(PANEL_SCREEN_KEY, 'mapa') : prefs.screen;
    return isScreenId(sc) ? sc : 'pilotagem';
  });
  const [eng, setEngState] = useState<boolean>(prefs.eng);
  const [inspect, setInspect] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ msg: string; action?: ToastOptions['action'] } | null>(null);
  const [showProcedure, setShowProcedure] = useState(false);
  const [resume, setResume] = useState(() => (isPanelWindow ? null : storage.getAutosave()));
  const topRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number>(0);

  const toast = (m: string, opts: ToastOptions = {}) => {
    setToastMsg({ msg: m, action: opts.action });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), opts.ms ?? 3500);
  };

  // troca da simulação inteira (reiniciar, carregar cenário…): mensagem com “Desfazer” (undo.ts)
  useEffect(() => {
    replaceUndo.onOffer = (o) =>
      toast(`${o.label} (pausado). A simulação anterior foi guardada.`, {
        ms: UNDO_MS,
        action: {
          label: '↶ Desfazer',
          run: () => {
            if (replaceUndo.undo()) toast('Simulação anterior restaurada (pausada). Pressione ▶ para continuar.');
            else toast('Não há mais o que desfazer (o prazo de 10 s passou).');
          },
        },
      });
    return () => {
      replaceUndo.onOffer = null;
    };
  }, []);
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
    if (isPanelWindow) document.title = `Tela ${panelIndex} — ${screenLabel(screen)}`;
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

  // alturas da barra superior e da navegação → posição e altura das telas (--topbar-h, --nav-h)
  useEffect(() => {
    const top = topRef.current;
    const nav = navRef.current;
    if (!top || !nav) return;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--topbar-h', `${top.offsetHeight}px`);
      document.documentElement.style.setProperty('--nav-h', `${nav.offsetHeight}px`);
    });
    ro.observe(top);
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);

  // apresentações do Estúdio: a etapa escolhe a tela; avisos curtos viram mensagens
  useEffect(() => {
    presPlayer.onScreen = (s) => setScreen(s === 'palco' ? 'estudio' : s);
    presPlayer.onNotice = (m) => toast(m);
    return () => {
      presPlayer.onScreen = null;
      presPlayer.onNotice = null;
    };
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

  // atalhos de teclado (valem também depois de um clique num botão; ver keyFocus.ts)
  useEffect(() => installFocusTracking(), []);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (screen === 'modelos') return;
      const focus = classifyFocus(t, focusFromKeyboard());
      if (shortcutAction(focus, ev.key) === 'nativo') return;
      // botão focado por clique: perde o foco antes de Espaço, senão o navegador repete o último clique
      const releaseButton = () => {
        if (focus === 'botao-mouse') (t.closest(BUTTON_SELECTOR) as HTMLElement | null)?.blur();
      };
      const s = runner.engine.state;
      const k = ev.key.toLowerCase();
      // apresentação do Estúdio: → / Page Down próxima, ← / Page Up anterior, Espaço pausa (controles remotos de slides)
      if (presPlayer.active && !presPlayer.ff && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        const arrows = screen !== 'sala';
        if (ev.key === 'PageDown' || (arrows && ev.key === 'ArrowRight')) {
          ev.preventDefault();
          presPlayer.next(runner);
          return;
        }
        if (ev.key === 'PageUp' || (arrows && ev.key === 'ArrowLeft')) {
          ev.preventDefault();
          presPlayer.prev(runner);
          return;
        }
        if (k === ' ') {
          ev.preventDefault();
          releaseButton();
          presPlayer.pause(runner);
          return;
        }
      }
      // na sala de comando W/A/S/D andam (e Q/E ficam livres): os lemes vão pelos manches
      if (screen === 'sala' && 'wasdqe'.includes(k) && k.length === 1) return;
      if (k === ' ') {
        ev.preventDefault();
        releaseButton();
        runner.running = !runner.running;
        runner.notify();
      } else if (k === 'a' || k === 'd') cmd({ type: 'surface', id: 'rudder', angle: s.surfaces.rudder.cmd + (k === 'd' ? 5 : -5) });
      else if (k === 'w' || k === 's') cmd({ type: 'surface', id: 'stern', angle: s.surfaces.stern.cmd + (k === 's' ? 5 : -5) });
      else if (k === 'q' || k === 'e') cmd({ type: 'surface', id: 'bow', angle: s.surfaces.bow.cmd + (k === 'e' ? 5 : -5) });
      else if (k === '+' || k === '=') cmd({ type: 'telegraph', rpm: s.propulsion.rpmCmd + 10 });
      else if (k === '-') cmd({ type: 'telegraph', rpm: s.propulsion.rpmCmd - 10 });
      else if (k === 'i') setEng(!eng);
      else if (/^[0-8]$/.test(k)) {
        // o foco num botão da navegação ficaria marcado num grupo que não é mais o atual
        if (t?.closest?.('.nav2')) t.blur();
        setScreen(screenForKey(k) ?? screen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const screens: Record<ScreenId, ReactNode> = {
    pilotagem: <PilotScreen />,
    governo: <HelmScreen />,
    sala: <ControlRoomScreen />,
    apresentacao: <PresentationScreen />,
    estudio: <StudioScreen />,
    mapa: <TacticalMapScreen />,
    sonar: <SonarScreen />,
    armas: <WeaponsScreen />,
    energia: <EnergyFlowScreen />,
    comando: <CommandCenter />,
    sistemas: <SystemsOverview />,
    lastro: <BallastScreen />,
    trim: <TrimHeelScreen />,
    propulsao: <PropulsionScreen />,
    seguranca: <SafetyScreen />,
    v3d: <View3DScreen />,
    modelos: <ModelsScreen />,
    historico: <HistoryScreen />,
    cenarios: <ScenarioScreen />,
    config: <SettingsScreen />,
    auxiliares: <AuxSystemsScreen />,
    validacao: <ValidationScreen />,
    ajuda: <HelpScreen />,
  };

  return (
    <UiContext.Provider value={{ screen, setScreen, eng, setEng, inspect, setInspect, toast, showProcedure, setShowProcedure }}>
      <div className={`app scr-${screen} ${eng ? 'eng' : ''}`}>
        <TopBar topRef={topRef} />
        <NavBar screen={screen} setScreen={setScreen} navRef={navRef} />
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
        {screen !== 'estudio' && <PresFloating onStage={() => setScreen('estudio')} />}
        {isPanelWindow && <PanelWait />}
        {toastMsg && (
          <div className="toast" role="status">
            <span>{toastMsg.msg}</span>
            {toastMsg.action && (
              <button
                className="btn sm"
                onClick={() => {
                  const a = toastMsg.action!;
                  setToastMsg(null);
                  a.run();
                }}
              >
                {toastMsg.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </UiContext.Provider>
  );
}
