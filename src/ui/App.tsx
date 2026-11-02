/** Aplicação: barra superior, navegação em dois níveis (grupos → telas, ver nav.ts) e modo engenharia. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { UiContext, type ScreenId, type ToastOptions } from './uiContext';
import { replaceUndo, UNDO_MS } from './undo';
import { cmd, runner, useSim } from './store';
import { captureSession, restoreSession } from './session';
import { storage } from './storage';
import { fmtTime } from './format';
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
import { recorder } from './recorder';
import { AuxSystemsScreen } from './screens/AuxSystemsScreen';
import { ValidationScreen } from './screens/ValidationScreen';
import { HelpScreen } from './screens/HelpScreen';
import { Inspector } from './inspector/Inspector';
import { ProcedurePanel } from './components/Procedure';
import { opsBus } from './ops/opsBus';
import { link } from './link';
import { isPanelWindow, panelIndex } from './sync';
import { loadPersisted, savePersisted } from './persist';
import { NavBar } from './components/NavBar';
import { TopBar } from './components/TopBar';
import { visibleAlarms } from '../sim/systems/alarms';
import { AlarmBand } from './components/AlarmBand';
import { SystemsOverview } from './screens/SystemsOverview';
import { StudioScreen } from './screens/StudioScreen';
import { PresFloating } from './components/PresFloating';
import { presPlayer } from './presBuilder/player';
import { isScreenId, screenForKey, screenLabel } from './nav';
import { useGraphics } from './graphics';
import { BUTTON_SELECTOR, classifyFocus, focusFromKeyboard, installFocusTracking, shortcutAction } from './keyFocus';

/** aba de cada janela de tela (a janela de controle usa as preferências gerais) */
const PANEL_SCREEN_KEY = `tela${panelIndex}.screen`;

/** modo palco: a faixa de alarme continua visível, mas só quando há alarme */
function StageAlarm() {
  const e = useSim(4);
  return visibleAlarms(e.state).length ? <AlarmBand e={e} /> : null;
}

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
  // modo palco (F): sem barra nem navegação — só a tela, os alarmes e um botão para sair
  const [stage, setStage] = useState(false);
  const [resume, setResume] = useState(() => (isPanelWindow ? null : storage.getAutosave()));
  const topRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number>(0);
  // opções de interface (Configurações › Aparência): alto contraste e selos de origem
  const gfx = useGraphics();

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

  useEffect(() => {
    // nome da tela na aba do navegador (ajuda a saber onde se está e a achar a janela certa)
    document.title = isPanelWindow ? `Tela ${panelIndex} — ${screenLabel(screen)}` : `${screenLabel(screen)} · SX-1 Simulador`;
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
      // W = lemes de ré a SUBIR, S = a DESCER (tecla de cima sobe, como as alavancas: para cima = subir)
      else if (k === 'w' || k === 's') cmd({ type: 'surface', id: 'stern', angle: s.surfaces.stern.cmd + (k === 'w' ? 5 : -5) });
      else if (k === 'q' || k === 'e') cmd({ type: 'surface', id: 'bow', angle: s.surfaces.bow.cmd + (k === 'e' ? 5 : -5) });
      else if (k === '+' || k === '=') cmd({ type: 'telegraph', rpm: s.propulsion.rpmCmd + 10 });
      else if (k === '-') cmd({ type: 'telegraph', rpm: s.propulsion.rpmCmd - 10 });
      else if (k === 'i') setEng(!eng);
      else if (k === 'f' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) setStage(!stage);
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
      <div className={`app scr-${screen} ${eng ? 'eng' : ''} ${gfx.uiContrast ? 'hi-contrast' : ''} ${gfx.hideKinds ? 'hide-kinds' : ''} ${stage ? 'stage' : ''}`}>
        <TopBar topRef={topRef} stage={stage} setStage={setStage} />
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
        {stage && (
          <div className="stage-ctl">
            <StageAlarm />
            <button className="btn" onClick={() => setStage(false)} title="Sair do modo palco (F)">
              ✕ Sair do palco <kbd>F</kbd>
            </button>
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
