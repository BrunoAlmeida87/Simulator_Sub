/**
 * DUAS JANELAS: a janela de CONTROLE roda a física; uma ou mais janelas de
 * VISUALIZAÇÃO (abertas com "Abrir visual em outra janela", útil com dois
 * monitores) recebem o estado pelo BroadcastChannel do navegador e desenham a
 * mesma cena. Cliques em objetos na visualização abrem os controles na janela
 * de controle. Não há segundo motor físico: o estado é um só.
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
  | { type: 'hello'; id: number }
  | { type: 'engine'; id: number; file: SaveFile }
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
    }
  | { type: 'visImg'; img: string | null }
  | { type: 'pick'; target: PickTarget | null }
  | { type: 'toggleRun' }
  | { type: 'bye' };

/** última configuração visual da cena ativa na janela de controle (escrita pelo Scene3D) */
export const visualOut: { layers: SceneLayers | null; view: ViewMode | null } = { layers: null, view: null };

export const isVisualWindow = typeof location !== 'undefined' && /(^|[#&?])visual\b/.test(location.hash + location.search);

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
  onPick: ((t: PickTarget | null) => void) | null = null;

  constructor(private runner: SimRunner) {
    if (!this.ch) return;
    this.ch.onmessage = (ev: MessageEvent<Msg>) => {
      const m = ev.data;
      if (m.type === 'hello') {
        this.lastHello = performance.now();
        this.viewers = 1;
        // só reenvia o motor completo se a visualização não tem o atual
        if (this.lastEngine !== this.runner.engine || m.id !== this.engineId) this.sendEngine();
        if (m.id !== this.engineId) this.lastImg = undefined;
      } else if (m.type === 'pick') this.onPick?.(m.target);
      else if (m.type === 'toggleRun') {
        this.runner.running = !this.runner.running;
        this.runner.notify();
      } else if (m.type === 'bye') this.viewers = 0;
    };
    window.addEventListener('beforeunload', () => this.ch?.postMessage({ type: 'bye' } satisfies Msg));
  }

  get connected(): boolean {
    return !!this.ch && performance.now() - this.lastHello < 6000;
  }

  private sendEngine(): void {
    if (!this.ch) return;
    if (this.lastEngine !== this.runner.engine) {
      this.lastEngine = this.runner.engine;
      this.engineId++;
    }
    this.ch.postMessage({ type: 'engine', id: this.engineId, file: serializeEngine(this.runner.engine, 'sincronismo') } satisfies Msg);
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
    const lite = { ...s, nav: { ...s.nav, trail }, commands: s.commands.slice(-12), alarms: { runtime: s.alarms.runtime, log: [] } } as SimState;
    this.ch.postMessage({
      type: 'state',
      id: this.engineId,
      state: lite,
      waves: e.config.environment.waves,
      running: this.runner.running,
      timeScale: this.runner.timeScale,
      layers: visualOut.layers,
      view: visualOut.view,
      overlay: this.overlay(),
      sent: now,
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

  constructor(private runner: SimRunner) {
    if (!this.ch) return;
    this.ch.onmessage = (ev: MessageEvent<Msg>) => this.onMsg(ev.data);
    const hello = () => this.ch?.postMessage({ type: 'hello', id: this.engineId } satisfies Msg);
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
      r.replaceEngine(deserializeEngine(m.file));
      r.alphaOverride = 1;
      this.lastMsgAt = performance.now();
      for (const l of this.listeners) l();
    } else if (m.type === 'state') {
      if (m.id !== this.engineId) {
        const now = performance.now();
        if (now - this.lastAsk > 500) {
          this.lastAsk = now;
          this.ch?.postMessage({ type: 'hello', id: this.engineId } satisfies Msg);
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
      e.state = { ...m.state, nav: { ...m.state.nav, trail } };
      if (JSON.stringify(e.config.environment.waves) !== JSON.stringify(m.waves) && m.waves) {
        const w = m.waves as { seaState: number; direction: number };
        e.env.setSeaState(w.seaState, w.direction);
      }
      e.computeOutputs();
      r.running = m.running;
      r.timeScale = m.timeScale;
      r.alphaOverride = 0;
      this.layers = m.layers;
      this.view = m.view;
      this.overlay = m.overlay;
      if (m.vis) {
        identity.set(m.vis.identity, false);
        graphics.set(m.vis.graphics, false);
      }
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
