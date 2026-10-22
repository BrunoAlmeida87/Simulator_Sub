/**
 * VÁRIAS JANELAS (vários monitores): a janela de CONTROLE roda a física; as
 * outras recebem o estado pelo BroadcastChannel do navegador. Não há segundo
 * motor físico: o estado é um só.
 *
 *  - VISUALIZAÇÃO (#visual, botão "⧉ 2ª janela"): só a cena 3D. Cliques em
 *    objetos abrem os controles na janela de controle.
 *  - TELA (#tela=N, botão "＋ Tela"): o simulador completo, com todas as abas,
 *    numa janela própria (ex.: mapa tático no 3º monitor). Comandos, executar/
 *    pausar, aceleração, troca de cenário e automações feitos nela são
 *    enviados à janela de controle, que os executa e devolve o estado.
 */
import type { SimRunner } from '../sim/core/runner';
import { deserializeEngine, serializeEngine, type SaveFile } from '../sim/persistence';
import type { SimState } from '../sim/core/state';
import type { SceneLayers } from '../render3d/layers';
import type { ViewMode } from '../render3d/SubmarineScene';
import type { PickTarget } from './ops/opsBus';
import { tours } from './tours';
import { maneuver, MANEUVER_STEPS } from './maneuvers';
import { visibleAlarms } from '../sim/systems/alarms';
import type { Command } from '../sim/commands';
import type { SimulationEngine } from '../sim/core/engine';
import type { HistorySnapshot } from '../sim/history';
import { applyAutomation, captureAutomation, installRemoteAutomation, runRemoteCall, type AutomationMirror } from './mirror';
import { identity, type Identity } from './identity';
import { recorder } from './recorder';
import { graphics, type GraphicsSettings } from './graphics';

const CH = 'sx1-sync-v1';

export interface OverlayData {
  tour: { name: string; k: number; n: number; title: string; text: string; why?: string; waitFor: string; met: boolean; remaining: number } | null;
  maneuver: string | null;
  alarm: { text: string; priority: number } | null;
  /** gravação/reprodução de comandos em andamento */
  rec?: string | null;
}

type Msg =
  | { type: 'hello'; id: number; kind?: 'visual' | 'tela' }
  | { type: 'engine'; id: number; file: SaveFile }
  | { type: 'history'; id: number; h: HistorySnapshot }
  | {
      type: 'state';
      id: number;
      state: SimState;
      waves: unknown;
      running: boolean;
      timeScale: number;
      layers: SceneLayers | null;
      view: ViewMode | null;
      overlay: OverlayData;
      sent: number;
      /** identificação (sem a imagem do emblema) e preferências gráficas da janela de controle */
      vis?: { identity: Partial<Identity>; graphics: GraphicsSettings };
      /** ambiente (fundo, água, costa, posição geográfica) quando mudou desde o envio do motor */
      env?: string;
      /** registros completos (comandos e alarmes) — para as janelas de tela, quando mudaram */
      full?: boolean;
      /** automações em andamento — para as janelas de tela */
      auto?: AutomationMirror;
    }
  | { type: 'visImg'; img: string | null }
  | { type: 'pick'; target: PickTarget | null }
  | { type: 'toggleRun' }
  // janela de tela → controle
  | { type: 'cmd'; c: Command }
  | { type: 'run'; running?: boolean; timeScale?: number }
  | { type: 'step'; n: number }
  | { type: 'load'; file: SaveFile; keepHistory: boolean }
  | { type: 'call'; fn: string; args: unknown[] }
  | { type: 'bye' };

/** última configuração visual da cena ativa na janela de controle (escrita pelo Scene3D) */
export const visualOut: { layers: SceneLayers | null; view: ViewMode | null } = { layers: null, view: null };

export const isVisualWindow = typeof location !== 'undefined' && /(^|[#&?])visual\b/.test(location.hash + location.search);

const panelMatch = typeof location !== 'undefined' ? /(^|[#&?])tela(?:=(\d+))?\b/.exec(location.hash + location.search) : null;
/** janela de tela (simulador completo espelhando a janela de controle) */
export const isPanelWindow = !isVisualWindow && !!panelMatch;
/** número da janela de tela (1, 2…): cada uma lembra a sua aba */
export const panelIndex = panelMatch ? Math.max(1, Number(panelMatch[2] ?? 1)) : 0;

function chan(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CH) : null;
  } catch {
    return null;
  }
}

export function openVisualWindow(): void {
  const url = new URL(location.href);
  url.hash = 'visual';
  window.open(url.href, 'sx1-visual', 'popup=yes,width=1280,height=760');
}

const panelWins: (Window | null)[] = [];
/** Abre uma janela de tela (a próxima livre: 1, 2…). Devolve o número aberto. */
export function openPanelWindow(): number {
  let n = 1;
  while (panelWins[n] && !panelWins[n]!.closed) n++;
  const url = new URL(location.href);
  url.hash = `tela=${n}`;
  panelWins[n] = window.open(url.href, `sx1-tela-${n}`, 'popup=yes,width=1280,height=800');
  return n;
}

// ------------------------------------------------------------------ controle
export class SyncMaster {
  private ch = chan();
  private lastHello = -1e9;
  private engineId = 0;
  private lastEngine: unknown = null;
  private lastSend = 0;
  private lastTrail = 0;
  viewers = 0;
  private lastImg: string | null | undefined = undefined;
  private lastEnv = '';
  private lastEnvCheck = 0;
  private lastPanelHello = -1e9;
  private lastAuto = 0;
  private lastFull = 0;
  private fullKey = '';
  onPick: ((t: PickTarget | null) => void) | null = null;

  constructor(private runner: SimRunner) {
    if (!this.ch) return;
    this.ch.onmessage = (ev: MessageEvent<Msg>) => {
      const m = ev.data;
      const r = this.runner;
      if (m.type === 'hello') {
        this.lastHello = performance.now();
        this.viewers = 1;
        if (m.kind === 'tela') {
          this.lastPanelHello = this.lastHello;
          if (m.id !== this.engineId) this.fullKey = '';
        }
        // só reenvia o motor completo se a visualização não tem o atual
        if (this.lastEngine !== r.engine || m.id !== this.engineId) this.sendEngine();
        if (m.id !== this.engineId) this.lastImg = undefined;
        this.lastEnv = '';
      } else if (m.type === 'pick') this.onPick?.(m.target);
      else if (m.type === 'toggleRun') {
        r.running = !r.running;
        r.notify();
      } else if (m.type === 'cmd') r.command(m.c);
      else if (m.type === 'run') {
        if (typeof m.running === 'boolean') r.running = m.running;
        if (typeof m.timeScale === 'number' && Number.isFinite(m.timeScale) && m.timeScale > 0) r.timeScale = Math.min(64, m.timeScale);
        r.notify();
      } else if (m.type === 'step') r.stepOnce(Math.max(1, Math.min(500, Math.round(m.n))));
      else if (m.type === 'load') {
        try {
          r.replaceEngine(deserializeEngine(m.file), m.keepHistory);
        } catch (ex) {
          console.warn('Estado recusado (janela de tela):', ex);
        }
      } else if (m.type === 'call') runRemoteCall(r, m.fn, m.args);
      else if (m.type === 'bye') this.viewers = 0;
    };
    window.addEventListener('beforeunload', () => this.ch?.postMessage({ type: 'bye' } satisfies Msg));
  }

  get connected(): boolean {
    return !!this.ch && performance.now() - this.lastHello < 6000;
  }
  /** há janela de tela aberta (recebe registros completos e automações) */
  get panelConnected(): boolean {
    return !!this.ch && performance.now() - this.lastPanelHello < 6000;
  }

  private sendEngine(): void {
    if (!this.ch) return;
    if (this.lastEngine !== this.runner.engine) {
      this.lastEngine = this.runner.engine;
      this.engineId++;
    }
    this.ch.postMessage({ type: 'engine', id: this.engineId, file: serializeEngine(this.runner.engine, 'sincronismo') } satisfies Msg);
    // janela de tela: gráficos e histórico desde o início
    if (this.panelConnected) this.ch.postMessage({ type: 'history', id: this.engineId, h: this.runner.history.snapshot() } satisfies Msg);
    this.fullKey = '';
  }

  private overlay(): OverlayData {
    const e = this.runner.engine;
    const st = tours.step;
    const top = visibleAlarms(e.state).find((a) => a.active);
    return {
      tour:
        tours.active && tours.tour && st
          ? { name: tours.tour.name, k: tours.k, n: tours.tour.steps.length, title: st.title, text: tours.text(e), why: st.why, waitFor: st.waitFor, met: tours.conditionMet, remaining: tours.remaining }
          : null,
      maneuver: maneuver.active ? `${maneuver.active === 'imergir' ? `IMERGIR para ${maneuver.target} m` : 'EMERGIR'} · etapa ${maneuver.step + 1}/${MANEUVER_STEPS[maneuver.active].length}: ${maneuver.phase}` : null,
      alarm: top ? { text: top.def.text, priority: top.def.priority } : null,
      rec: recorder.mode === 'gravando' ? '● GRAVANDO COMANDOS' : recorder.mode === 'reproduzindo' ? `▶ REPRODUÇÃO DE GRAVAÇÃO${recorder.finished ? ' (concluída)' : ''}` : null,
    };
  }

  tick(): void {
    if (!this.ch || !this.connected) return;
    if (this.lastEngine !== this.runner.engine) this.sendEngine();
    const now = performance.now();
    if (now - this.lastSend < 33) return;
    this.lastSend = now;
    const e = this.runner.engine;
    const s = e.state;
    // estado sem os registros longos (a trajetória vai a cada ~1 s)
    const sendTrail = now - this.lastTrail > 1000;
    if (sendTrail) this.lastTrail = now;
    const trail = sendTrail ? s.nav.trail : [];
    // janela de tela: registros completos quando mudaram (no máximo 4×/s)
    const panel = this.panelConnected;
    let full = false;
    if (panel && now - this.lastFull > 250) {
      const lc = s.commands[s.commands.length - 1];
      const la = s.alarms.log[s.alarms.log.length - 1] as { t?: number } | undefined;
      const key = `${s.commands.length}|${lc?.t}|${s.alarms.log.length}|${la?.t}`;
      if (key !== this.fullKey) {
        this.fullKey = key;
        this.lastFull = now;
        full = true;
      }
    }
    const lite = (full ? { ...s, nav: { ...s.nav, trail } } : { ...s, nav: { ...s.nav, trail }, commands: s.commands.slice(-12), alarms: { runtime: s.alarms.runtime, log: [] } }) as SimState;
    let auto: AutomationMirror | undefined;
    if (panel && now - this.lastAuto > 200) {
      this.lastAuto = now;
      auto = captureAutomation();
    }
    // ambiente: reenviado quando muda (comandos de ambiente/costa/posição)
    let env: string | undefined;
    if (now - this.lastEnvCheck > 400) {
      this.lastEnvCheck = now;
      const j = JSON.stringify(e.config.environment);
      if (j !== this.lastEnv) {
        this.lastEnv = j;
        env = j;
      }
    }
    this.ch.postMessage({
      type: 'state',
      env,
      id: this.engineId,
      state: lite,
      waves: e.config.environment.waves,
      running: this.runner.running,
      timeScale: this.runner.timeScale,
      layers: visualOut.layers,
      view: visualOut.view,
      overlay: this.overlay(),
      sent: now,
      full,
      auto,
      vis: { identity: { ...identity.get(), emblemImage: undefined }, graphics: graphics.get() },
    } satisfies Msg);
    const img = identity.get().emblemImage;
    if (img !== this.lastImg) {
      this.lastImg = img;
      this.ch.postMessage({ type: 'visImg', img } satisfies Msg);
    }
  }
}

// ---------------------------------------------------------- visualização
export class SyncViewer {
  private ch = chan();
  private engineId = -1;
  private lastMsgAt = -1e9;
  private interval = 33;
  private lastAsk = 0;
  layers: SceneLayers | null = null;
  view: ViewMode | null = null;
  overlay: OverlayData = { tour: null, maneuver: null, alarm: null };
  private listeners = new Set<() => void>();
  /** troca de motor local (o replaceEngine do executor é remoto na janela de tela) */
  private replaceLocal: (e: SimulationEngine) => void;
  /** estado executar/aceleração recebido (janela de tela) */
  private mirrored: ((running: boolean, timeScale: number) => void) | null = null;

  /**
   * remote = janela de tela: tudo o que o operador fizer nela (comandos,
   * executar/pausar, aceleração, passos, troca de cenário, automações) é
   * enviado à janela de controle em vez de alterar a cópia local.
   */
  constructor(
    private runner: SimRunner,
    readonly remote = false,
  ) {
    const orig = runner.replaceEngine.bind(runner);
    this.replaceLocal = (e) => orig(e);
    if (!this.ch) return;
    if (remote) this.installRemote();
    this.ch.onmessage = (ev: MessageEvent<Msg>) => this.onMsg(ev.data);
    const hello = () => this.ch?.postMessage({ type: 'hello', id: this.engineId, kind: remote ? 'tela' : 'visual' } satisfies Msg);
    hello();
    window.setInterval(hello, 2000);
    window.addEventListener('beforeunload', () => this.ch?.postMessage({ type: 'bye' } satisfies Msg));
  }

  get available(): boolean {
    return !!this.ch;
  }
  get connected(): boolean {
    return performance.now() - this.lastMsgAt < 3000 && this.engineId >= 0;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private send(m: Msg): void {
    this.ch?.postMessage(m);
  }

  /** ação de automação executada na janela de controle */
  call(fn: string, args: unknown[]): void {
    this.send({ type: 'call', fn, args });
  }

  private installRemote(): void {
    const r = this.runner;
    r.command = (c) => this.send({ type: 'cmd', c });
    r.stepOnce = (n = 1) => this.send({ type: 'step', n });
    r.replaceEngine = (e, keepHistory = false) => {
      try {
        this.send({ type: 'load', file: serializeEngine(e, 'janela de tela'), keepHistory });
      } catch (ex) {
        console.warn('Não foi possível enviar o estado:', ex);
      }
    };
    // executar/pausar e aceleração: o valor escolhido aqui vale de imediato e é
    // pedido à janela de controle; por um instante ignora o eco antigo dela
    const st = { running: r.running, timeScale: r.timeScale, hold: 0 };
    Object.defineProperty(r, 'running', {
      configurable: true,
      get: () => st.running,
      set: (v: boolean) => {
        if (v === st.running) return;
        st.running = v;
        st.hold = performance.now() + 400;
        this.send({ type: 'run', running: v });
      },
    });
    Object.defineProperty(r, 'timeScale', {
      configurable: true,
      get: () => st.timeScale,
      set: (v: number) => {
        if (v === st.timeScale) return;
        st.timeScale = v;
        st.hold = performance.now() + 400;
        this.send({ type: 'run', timeScale: v });
      },
    });
    this.mirrored = (running, timeScale) => {
      if (performance.now() < st.hold) return;
      st.running = running;
      st.timeScale = timeScale;
    };
    installRemoteAutomation((fn, args) => this.call(fn, args));
  }

  pick(t: PickTarget | null): void {
    this.ch?.postMessage({ type: 'pick', target: t } satisfies Msg);
  }
  toggleRun(): void {
    this.ch?.postMessage({ type: 'toggleRun' } satisfies Msg);
  }

  private onMsg(m: Msg): void {
    const r = this.runner;
    if (m.type === 'engine') {
      if (m.id === this.engineId) return;
      this.engineId = m.id;
      this.replaceLocal(deserializeEngine(m.file));
      r.alphaOverride = 1;
      this.lastMsgAt = performance.now();
      for (const l of this.listeners) l();
    } else if (m.type === 'state') {
      if (m.id !== this.engineId) {
        const now = performance.now();
        if (now - this.lastAsk > 500) {
          this.lastAsk = now;
          this.ch?.postMessage({ type: 'hello', id: this.engineId, kind: this.remote ? 'tela' : 'visual' } satisfies Msg);
        }
        return;
      }
      const e = r.engine;
      const now = performance.now();
      this.interval = Math.min(200, Math.max(16, now - this.lastMsgAt));
      this.lastMsgAt = now;
      e.prevPos = { ...e.state.body.pos };
      e.prevQuat = { ...e.state.body.quat };
      const trail = m.state.nav.trail.length ? m.state.nav.trail : e.state.nav.trail;
      // janela de tela: entre os envios completos, mantém os registros já recebidos
      const keepLogs = this.remote && !m.full;
      e.state = keepLogs ? { ...m.state, nav: { ...m.state.nav, trail }, commands: e.state.commands, alarms: { ...m.state.alarms, log: e.state.alarms.log } } : { ...m.state, nav: { ...m.state.nav, trail } };
      if (JSON.stringify(e.config.environment.waves) !== JSON.stringify(m.waves) && m.waves) {
        const w = m.waves as { seaState: number; direction: number };
        e.env.setSeaState(w.seaState, w.direction);
      }
      e.computeOutputs();
      if (this.mirrored) this.mirrored(m.running, m.timeScale);
      else {
        r.running = m.running;
        r.timeScale = m.timeScale;
      }
      r.alphaOverride = 0;
      this.layers = m.layers;
      this.view = m.view;
      this.overlay = m.overlay;
      if (m.vis) {
        identity.set(m.vis.identity, false);
        graphics.set(m.vis.graphics, false);
      }
      if (m.env) {
        const env = JSON.parse(m.env) as typeof e.config.environment;
        if (JSON.stringify(e.config.environment) !== m.env) {
          Object.assign(e.config.environment, env);
          if (!env.geo) delete e.config.environment.geo;
          e.rebuildEnvironment();
        }
      }
      if (this.remote) {
        r.history.sample(e);
        if (m.auto) applyAutomation(r, m.auto);
      }
    } else if (m.type === 'history') {
      if (this.remote && m.id === this.engineId) r.history.restore(m.h);
    } else if (m.type === 'visImg') {
      identity.set({ emblemImage: m.img }, false);
    }
  }

  /** interpola a pose entre as duas últimas mensagens */
  frame(): void {
    const a = (performance.now() - this.lastMsgAt) / this.interval;
    this.runner.alphaOverride = Math.max(0, Math.min(1, a));
  }
}
