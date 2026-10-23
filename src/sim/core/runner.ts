/**
 * EXECUTOR EM TEMPO REAL — acumulador de tempo com passo fixo.
 *
 *   acc += Δt_real × fator_de_aceleração
 *   enquanto acc ≥ dt: engine.step(); acc −= dt
 *
 * A física é idêntica em qualquer aceleração (mesma sequência de passos);
 * só muda quantos passos são executados por quadro. Se o processador não
 * acompanhar (limite de passos por quadro), o tempo excedente é descartado e
 * a condição é sinalizada (a simulação desacelera em vez de perder estabilidade).
 */
import type { SimulationEngine } from './engine';
import { HistoryRecorder } from '../history';
import { applyCommand, type Command } from '../commands';

export class SimRunner {
  engine: SimulationEngine;
  running = false;
  timeScale = 1;
  acc = 0;
  maxStepsPerFrame = 600;
  lagging = false;
  realTimeFactor = 0;
  history: HistoryRecorder;
  version = 0;
  private listeners = new Set<() => void>();
  /**
   * Ganchos chamados ANTES de cada passo fixo (gravação: pontos de controle;
   * reprodução: comandos gravados para este passo). Retornar false interrompe
   * os passos do quadro (ex.: fim da reprodução).
   */
  readonly beforeStep = new Set<(e: SimulationEngine) => boolean | void>();
  private resetHooks = new Set<() => void>();

  constructor(engine: SimulationEngine) {
    this.engine = engine;
    this.history = new HistoryRecorder();
    this.history.sample(engine, true);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onEngineReplaced(fn: () => void): () => void {
    this.resetHooks.add(fn);
    return () => this.resetHooks.delete(fn);
  }

  notify(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Executa os passos correspondentes a realDt segundos reais. */
  frame(realDt: number): number {
    if (!this.running) {
      this.realTimeFactor = 0;
      return 0;
    }
    const dt = this.engine.config.settings.dt;
    this.acc += Math.min(realDt, 0.25) * this.timeScale;
    let n = Math.floor(this.acc / dt + 1e-9);
    if (n > this.maxStepsPerFrame) {
      n = this.maxStepsPerFrame;
      this.acc = 0;
      this.lagging = true;
    } else {
      this.acc -= n * dt;
      this.lagging = false;
    }
    let done = 0;
    for (let i = 0; i < n; i++) {
      if (!this.doStep()) break;
      done++;
    }
    this.realTimeFactor = realDt > 0 ? (done * dt) / realDt : 0;
    return done;
  }

  /** Fração do passo atual (para interpolação visual). */
  /** interpolação imposta de fora (janela de visualização que espelha outra janela) */
  alphaOverride: number | null = null;

  get alpha(): number {
    if (this.alphaOverride !== null) return this.alphaOverride;
    return Math.max(0, Math.min(1, this.acc / this.engine.config.settings.dt));
  }

  /** Um passo fixo, precedido dos ganchos; false se um gancho interrompeu. */
  private doStep(): boolean {
    for (const h of this.beforeStep) if (h(this.engine) === false) return false;
    this.engine.step();
    this.history.sample(this.engine);
    return true;
  }

  stepOnce(n = 1): void {
    for (let i = 0; i < n; i++) if (!this.doStep()) break;
    this.notify();
  }

  /** n passos fixos sem avisar a interface (avanço acelerado); devolve quantos foram executados. */
  stepBatch(n: number): number {
    let done = 0;
    for (let i = 0; i < n; i++) {
      if (!this.doStep()) break;
      done++;
    }
    return done;
  }

  command(c: Command): void {
    applyCommand(this.engine, c);
    this.engine.computeOutputs();
    this.notify();
  }

  replaceEngine(engine: SimulationEngine, keepHistory = false): void {
    this.engine = engine;
    this.acc = 0;
    if (!keepHistory) this.history.clear();
    this.history.sample(engine, true);
    for (const h of this.resetHooks) h();
    this.notify();
  }
}
