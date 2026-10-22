/**
 * EXECUÇÃO das apresentações do Estúdio (fora do React, testável sem tela).
 *
 * Ao entrar numa etapa: carrega o estado guardado (se houver), aplica câmera,
 * camadas, velocidade do tempo e executar/pausar, troca de tela e dispara as
 * ações sem atraso. A cada quadro: dispara as ações atrasadas e confere o
 * gatilho (manual, tempo ou condição física). Guarda o estado de entrada de
 * cada etapa visitada, de modo que "voltar" e "repetir a etapa" restauram a
 * física daquele momento. "Ir para" uma etapa ainda não visitada avança a
 * simulação acelerada, executando as etapas do meio pela física.
 *
 * As ações só emitem comandos registrados (origem "apresentação"): a resposta
 * é sempre a da física.
 */
import type { SimRunner } from '../../sim/core/runner';
import type { SimulationEngine } from '../../sim/core/engine';
import { applyCommand, withCommandSource, type Command } from '../../sim/commands';
import { buildScenario, SCENARIOS } from '../../sim/scenarios';
import { deserializeEngine, serializeEngine, type SaveFile } from '../../sim/persistence';
import { replayLock } from '../replayLock';
import { pres } from '../presentation';
import { baseConfig } from '../store';
import { demo } from '../demo';
import { maneuver } from '../maneuvers';
import { tours } from '../tours';
import { runAction, type ActionCtx } from './actions';
import { describeCondition, evalConditions, fillTemplate, fmtVarUnit, presVar, readVar, takeVars, type VarCtx } from './variables';
import { presLibrary } from './library';
import { droneCtl } from '../droneCtl';
import { graphics } from '../graphics';
import { bridgeSight } from '../bridgeSight';
import type { ViewMode } from '../../render3d/SubmarineScene';
import { NEXT_END, normalizePresentation, droneFromStep, type CamPose, type PresStep, type StepFormat, type StepScreen, type StepVisual, type SubRef, type UserPresentation } from './model';

/**
 * Câmeras com posição guardada na etapa: drone (fixo no mundo) e passadiço
 * (para onde o observador olha, com ou sem binóculo). A câmera livre é
 * aplicada pela própria cena (prop camPose). Só visual.
 */
export function applyViewPose(v: StepVisual, view: ViewMode, e: SimulationEngine): void {
  if (view === 'drone' && v.drone) droneCtl.pose = droneFromStep(v.drone, subRef(e), v.droneFrame);
  if (view === 'passadico' && v.bridge && typeof window !== 'undefined') bridgeSight.set({ ...v.bridge });
}

/** posição e proa atuais do submarino (referência do drone) */
export const subRef = (e: SimulationEngine): SubRef => ({ n: e.state.body.pos.x, e: e.state.body.pos.y, heading: e.outputs.euler.heading });

export type StepOutcome = 'pendente' | 'em curso' | 'concluída' | 'tempo esgotado' | 'pulada';

export interface CardStatus {
  kind: 'manual' | 'tempo' | 'aguardando' | 'pronto' | 'esgotado' | 'pausado' | 'acelerando';
  text: string;
}

/** o que o cartão mostra (também enviado à 2ª janela — sem as notas do apresentador) */
export interface CardData {
  name: string;
  title: string;
  text: string;
  why: string;
  k: number;
  n: number;
  format: StepFormat;
  status: CardStatus;
  outcome: StepOutcome[];
}

export interface HudItem {
  id: string;
  label: string;
  value: string;
}

export interface PresOverlayData {
  card: CardData;
  hud: HudItem[];
  cam: { key: number; pose: CamPose } | null;
}

export interface PlayerSnapshot {
  pres: UserPresentation;
  active: boolean;
  paused: boolean;
  k: number;
  clock: number;
  tStep: number;
  holdT: number;
  met: boolean;
  timedOut: boolean;
  fired: string[];
  base: Record<string, number>;
  trail: number[];
  outcome: StepOutcome[];
  sent: { t: number; text: string; step: number }[];
  finished: PlayerSummary | null;
  elapsed: number;
  startFile: SaveFile | null;
}

export interface PlayerSummary {
  ok: number;
  timeout: number;
  skipped: number;
  duration: number;
}

/** limites do avanço acelerado (s de simulação / s de relógio por etapa) */
const FF_MAX_SIM = 1800;
const FF_MAX_CLOCK = 3600;
/** limite total de um avanço acelerado (s de simulação) */
const FF_MAX_TOTAL = 4 * 3600;

export class PresPlayer {
  pres: UserPresentation | null = null;
  active = false;
  /** pausa da apresentação (congela o relógio da etapa e a simulação) */
  paused = false;
  k = 0;
  /** s de apresentação na etapa (conta com a simulação rodando, ou sempre numa etapa pausada de propósito) */
  clock = 0;
  /** s de simulação na etapa */
  tStep = 0;
  holdT = 0;
  met = false;
  timedOut = false;
  fired = new Set<string>();
  base: Record<string, number> = {};
  /** etapas visitadas (para voltar) */
  trail: number[] = [];
  outcome: StepOutcome[] = [];
  sent: { t: number; text: string; step: number }[] = [];
  finished: PlayerSummary | null = null;
  elapsed = 0;
  /** avanço acelerado em andamento */
  ff: { target: number; from: number } | null = null;
  /** câmera livre definida pela etapa (a cena aplica quando a chave muda) */
  cam: { key: number; pose: CamPose } | null = null;
  /** troca de tela pedida pela etapa (ligado pela interface) */
  onScreen: ((s: StepScreen) => void) | null = null;
  /** mensagens curtas para a interface (ex.: etapa sem estado para voltar) */
  onNotice: ((m: string) => void) | null = null;

  private startFile: SaveFile | null = null;
  private entry = new Map<number, SaveFile>();
  private camKey = 0;
  private lastT = 0;
  private engineRef: SimulationEngine | null = null;
  private runBeforePause = true;
  private ffSim = 0;
  private ffGen = 0;

  get step(): PresStep | null {
    return this.pres && (this.active || this.ff) ? (this.pres.steps[this.k] ?? null) : null;
  }

  varCtx(): VarCtx {
    return { tStep: this.tStep, maneuver: !!maneuver.active };
  }

  // ------------------------------------------------------------ início e fim
  /**
   * Inicia a apresentação: do início, ou acelerando até a etapa `from`.
   * direct = true: entra direto na etapa `from` a partir da situação atual do
   * simulador (para testar uma etapa enquanto edita).
   */
  start(r: SimRunner, p: UserPresentation, from = 0, direct = false): boolean {
    if (replayLock.active || !p.steps.length) return false;
    demo.stop(r);
    maneuver.cancel(r);
    maneuver.result = null;
    if (tours.active) tours.stop(r);
    this.pres = structuredClone(p);
    this.ff = null;
    this.ffGen++;
    const wasRunning = r.running;
    r.running = false;
    if (!direct) this.loadStart(r, this.pres);
    pres.initial = serializeEngine(r.engine, `Início: ${p.name}`);
    pres.before = null;
    this.startFile = pres.initial;
    this.active = true;
    this.paused = false;
    this.outcome = this.pres.steps.map(() => 'pendente');
    this.trail = [];
    this.entry.clear();
    this.sent = [];
    this.finished = null;
    this.elapsed = 0;
    r.engine.log(`APRESENTAÇÃO iniciada: ${p.name}`, 'Apresentação');
    const target = Math.max(0, Math.min(this.pres.steps.length - 1, from));
    if (direct) {
      r.running = wasRunning;
      this.enter(r, target);
      return true;
    }
    this.enter(r, 0);
    if (target > 0) void this.fastForward(r, target);
    return true;
  }

  /** interrompe o avanço acelerado na etapa em que estiver */
  cancelFastForward(): void {
    this.ff = null;
  }

  /** coloca o simulador no ponto de partida da apresentação (também usado pelo editor) */
  loadStart(r: SimRunner, p: UserPresentation): void {
    const st = p.start;
    if (st.mode === 'atual') return;
    if (st.mode === 'estado' && st.state) {
      try {
        r.replaceEngine(deserializeEngine(st.state));
        return;
      } catch {
        this.onNotice?.('O estado guardado do início não pôde ser carregado; usando o cenário.');
      }
    }
    const id = SCENARIOS.some((s) => s.id === st.scenario) ? st.scenario : 'superficie';
    const e = buildScenario(id, baseConfig(), { load: st.load, precompensated: st.precompensated });
    if (st.sea !== null) applyCommand(e, { type: 'seaState', value: st.sea });
    e.computeOutputs();
    r.replaceEngine(e);
  }

  /** Encerra (o resumo fica disponível). */
  stop(r: SimRunner, why = 'encerrada pelo apresentador'): void {
    if (!this.active) return;
    if (this.outcome[this.k] === 'em curso') this.outcome[this.k] = this.met ? 'concluída' : 'pulada';
    this.ff = null;
    this.active = false;
    this.paused = false;
    this.summarize();
    r.engine.log(`Apresentação ${why}`, 'Apresentação');
    r.notify();
  }

  /** fecha o resumo final */
  dismiss(r: SimRunner): void {
    this.finished = null;
    if (!this.active) this.pres = null;
    r.notify();
  }

  private summarize(): void {
    this.finished = {
      ok: this.outcome.filter((o) => o === 'concluída').length,
      timeout: this.outcome.filter((o) => o === 'tempo esgotado').length,
      skipped: this.outcome.filter((o) => o === 'pulada').length,
      duration: this.elapsed,
    };
  }

  private finish(r: SimRunner): void {
    this.active = false;
    this.paused = false;
    this.ff = null;
    this.summarize();
    r.engine.log(`Apresentação concluída: ${this.pres!.name} (${this.finished!.ok}/${this.pres!.steps.length} etapas)`, 'Apresentação');
    r.notify();
  }

  // ------------------------------------------------------------ etapas
  private enter(r: SimRunner, k: number): void {
    const p = this.pres!;
    const st = p.steps[k];
    this.k = k;
    this.clock = 0;
    this.tStep = 0;
    this.holdT = 0;
    this.met = false;
    this.timedOut = false;
    this.fired = new Set();
    this.outcome[k] = 'em curso';
    if (st.loadState && st.state) {
      try {
        r.replaceEngine(deserializeEngine(st.state));
      } catch {
        this.onNotice?.(`Etapa ${k + 1}: o estado guardado não pôde ser carregado.`);
      }
    }
    this.entry.set(k, serializeEngine(r.engine, `Apresentação — etapa ${k + 1}`));
    const e = r.engine;
    this.engineRef = e;
    this.lastT = e.state.t;
    e.log(`Apresentação — etapa ${k + 1}/${p.steps.length}: ${st.title}`, 'Apresentação');
    const v = st.visual;
    if (v.layers) pres.setLayers({ ...v.layers });
    if (v.view) pres.setView(v.view);
    if (v.camPose && (v.view ?? pres.view) === 'livre') this.cam = { key: ++this.camKey, pose: v.camPose };
    applyViewPose(v, v.view ?? pres.view, e);
    if (v.timeScale !== null) r.timeScale = v.timeScale;
    if (v.persp !== null) graphics.set({ deepPersp: v.persp });
    if (v.run === 'executar') r.running = true;
    else if (v.run === 'pausar') r.running = false;
    if (!this.ff) this.onScreen?.(v.screen);
    this.base = takeVars(e, this.varCtx());
    this.fireDue(r);
    r.engine.computeOutputs();
    r.notify();
  }

  private ctx(r: SimRunner): ActionCtx {
    const rebase = (wasRunning: boolean) => {
      this.engineRef = r.engine;
      this.lastT = r.engine.state.t;
      this.base = takeVars(r.engine, this.varCtx());
      r.running = wasRunning;
    };
    return {
      r,
      send: (c) => this.send(r, c),
      setView: (v) => pres.setView(v),
      setLayers: (l) => pres.setLayers(l),
      markBefore: () => pres.markBefore(r),
      restoreBefore: () => {
        const run = r.running;
        if (!pres.before) return;
        pres.restoreBefore(r);
        rebase(run);
      },
      restoreStart: () => {
        const run = r.running;
        if (!this.startFile) return;
        r.replaceEngine(deserializeEngine(this.startFile));
        rebase(run);
      },
      loadScenario: (id, sea) => {
        const run = r.running;
        const e = buildScenario(SCENARIOS.some((s) => s.id === id) ? id : 'superficie', baseConfig());
        if (sea !== null) applyCommand(e, { type: 'seaState', value: sea });
        e.computeOutputs();
        r.replaceEngine(e);
        rebase(run);
      },
    };
  }

  /** envia um comando registrado e guarda o texto do registro */
  private send(r: SimRunner, c: Command): void {
    const e = r.engine;
    const log = e.state.commands;
    const last = log[log.length - 1];
    withCommandSource('apresentação', () => applyCommand(e, c));
    let i = log.length - 1;
    while (i >= 0 && log[i] !== last) i--;
    for (const rec of log.slice(i + 1)) this.sent.push({ t: rec.t, text: rec.text, step: this.k });
    if (this.sent.length > 120) this.sent.splice(0, this.sent.length - 120);
  }

  private fireDue(r: SimRunner): void {
    const st = this.pres?.steps[this.k];
    if (!st) return;
    const due = st.actions.filter((a) => !this.fired.has(a.id) && a.delay <= this.clock + 1e-9).sort((a, b) => a.delay - b.delay);
    if (!due.length) return;
    const c = this.ctx(r);
    for (const a of due) {
      this.fired.add(a.id);
      runAction(a, c);
    }
    r.engine.computeOutputs();
    r.notify();
  }

  private allFired(st: PresStep): boolean {
    return st.actions.every((a) => this.fired.has(a.id));
  }

  /** próxima etapa conforme o destino configurado (-1 = encerrar) */
  nextIndex(st: PresStep): number {
    const nx = st.advance.next;
    if (nx === NEXT_END) return -1;
    if (nx) {
      const i = this.pres!.steps.findIndex((s) => s.id === nx);
      if (i >= 0) return i;
    }
    return this.k + 1 < this.pres!.steps.length ? this.k + 1 : -1;
  }

  private advance(r: SimRunner): void {
    const st = this.pres!.steps[this.k];
    const j = this.nextIndex(st);
    this.trail.push(this.k);
    if (j < 0) return this.finish(r);
    this.enter(r, j);
  }

  // ------------------------------------------------------------ comandos do apresentador
  /** próxima etapa (a atual fica como concluída ou pulada) */
  next(r: SimRunner): void {
    if (!this.active || this.ff) return;
    // etapa manual: avançar é o que conclui a etapa
    this.outcome[this.k] = this.met || this.pres!.steps[this.k].advance.mode === 'manual' ? 'concluída' : 'pulada';
    this.unpause(r);
    this.advance(r);
  }

  /** volta à etapa anterior, com a física de quando ela começou */
  prev(r: SimRunner): void {
    if (!this.active || this.ff) return;
    const j = this.trail.length ? this.trail.pop()! : this.k;
    this.outcome[this.k] = 'pendente';
    this.reenter(r, j);
  }

  /** repete a etapa atual desde o começo (física restaurada) */
  restartStep(r: SimRunner): void {
    if (!this.active || this.ff) return;
    this.reenter(r, this.k);
  }

  private reenter(r: SimRunner, j: number): void {
    this.unpause(r);
    const snap = this.entry.get(j);
    if (snap) r.replaceEngine(deserializeEngine(snap));
    else this.onNotice?.('Sem o estado do início desta etapa (sessão retomada): a etapa recomeça a partir da situação atual.');
    this.enter(r, j);
  }

  /**
   * Vai para a etapa j. Já visitada: restaura a física daquele momento. Com
   * estado guardado: carrega. Adiante: simulação acelerada. Atrás e nunca
   * visitada (desvios): entra direto.
   */
  goto(r: SimRunner, j: number): 'restaurada' | 'estado' | 'acelerada' | 'direta' | null {
    if (!this.active || !this.pres || this.ff || j < 0 || j >= this.pres.steps.length) return null;
    if (j === this.k) {
      this.restartStep(r);
      return 'restaurada';
    }
    if (this.outcome[this.k] === 'em curso') this.outcome[this.k] = this.met ? 'concluída' : 'pulada';
    this.unpause(r);
    const st = this.pres.steps[j];
    if (this.entry.has(j)) {
      this.trail.push(this.k);
      this.reenter(r, j);
      return 'restaurada';
    }
    if (st.loadState && st.state) {
      this.trail.push(this.k);
      this.enter(r, j);
      return 'estado';
    }
    if (j > this.k) {
      void this.fastForward(r, j);
      return 'acelerada';
    }
    this.trail.push(this.k);
    this.enter(r, j);
    return 'direta';
  }

  pause(r: SimRunner): void {
    if (!this.active || this.ff) return;
    if (this.paused) this.unpause(r);
    else {
      this.paused = true;
      this.runBeforePause = r.running;
      r.running = false;
    }
    r.notify();
  }

  private unpause(r: SimRunner): void {
    if (!this.paused) return;
    this.paused = false;
    r.running = this.runBeforePause;
  }

  // ------------------------------------------------------------ laço
  /** chamado a cada quadro (realDt em s reais) */
  tick(r: SimRunner, realDt: number): void {
    if (!this.active || !this.pres || replayLock.active || this.ff) return;
    if (tours.active) return this.stop(r, 'encerrada: um roteiro automático foi iniciado');
    const e = r.engine;
    if (e !== this.engineRef) {
      // motor trocado por fora (reiniciar, carregar cenário): segue a partir dele
      this.engineRef = e;
      this.lastT = e.state.t;
    }
    const simDt = Math.max(0, e.state.t - this.lastT);
    this.lastT = e.state.t;
    if (this.paused) return;
    const st = this.pres.steps[this.k];
    const clockOn = r.running || st.visual.run === 'pausar';
    this.update(r, clockOn ? Math.min(0.25, Math.max(0, realDt)) : 0, simDt, false);
  }

  /** um avanço do relógio da etapa: ações atrasadas, gatilho e passagem de etapa */
  private update(r: SimRunner, dClock: number, simDt: number, ff: boolean): void {
    this.clock += dClock;
    this.tStep += simDt;
    this.elapsed += simDt;
    const k0 = this.k;
    this.fireDue(r);
    if (!this.active || this.k !== k0) return;
    const st = this.pres!.steps[this.k];
    const adv = st.advance;
    if (!this.met) {
      if (adv.mode === 'manual') this.met = ff && this.allFired(st);
      else if (adv.mode === 'tempo') this.met = this.clock >= adv.seconds - 1e-9;
      else if (evalConditions(adv.conditions, adv.logic, r.engine, this.varCtx())) {
        this.holdT += simDt;
        if (this.holdT >= adv.hold - 1e-9) this.met = true;
      } else this.holdT = 0;
      if (this.met) {
        if (adv.mode === 'condicao') r.engine.log(`Apresentação — etapa ${this.k + 1}: condição atingida (${this.waitText(st)})`, 'Apresentação');
        if (!ff) r.notify();
      }
    }
    let go = false;
    let outcome: StepOutcome = 'concluída';
    if (this.met) go = adv.mode === 'condicao' ? this.clock >= adv.minDwell - 1e-9 : true;
    else if (adv.timeout > 0 && this.tStep > adv.timeout) {
      if (adv.onTimeout === 'avancar' || ff) {
        go = true;
        outcome = 'tempo esgotado';
        r.engine.log(`Apresentação — etapa ${this.k + 1}: TEMPO ESGOTADO (${this.waitText(st)})`, 'Apresentação');
      } else if (!this.timedOut) {
        this.timedOut = true;
        r.engine.log(`Apresentação — etapa ${this.k + 1}: tempo limite passou, continua aguardando (${this.waitText(st)})`, 'Apresentação');
        r.notify();
      }
    }
    if (!go && ff && (this.tStep > FF_MAX_SIM || this.clock > FF_MAX_CLOCK)) {
      go = true;
      outcome = 'tempo esgotado';
    }
    if (go) {
      this.outcome[this.k] = outcome;
      this.advance(r);
    }
  }

  /**
   * Avança acelerado até a etapa `target` (ou até o fim, com target = -1),
   * executando as etapas do meio pela física, em lotes entre quadros.
   * Etapas manuais passam assim que as suas ações forem disparadas.
   */
  async fastForward(r: SimRunner, target: number, budgetMs = 30): Promise<void> {
    if (!this.active || !this.pres || this.ff) return;
    const token = ++this.ffGen;
    const mine = () => this.ffGen === token && !!this.ff && this.active;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.ff = { target, from: this.k };
    this.ffSim = 0;
    this.paused = false;
    r.notify();
    try {
      while (mine() && this.k !== target) {
        if (this.ffSim > FF_MAX_TOTAL) {
          this.onNotice?.(`O avanço acelerado parou na etapa ${this.k + 1}: a etapa ${target + 1} não foi alcançada em ${FF_MAX_TOTAL / 3600} h de simulação.`);
          break;
        }
        const t0 = now();
        do this.ffChunk(r, 25);
        while (mine() && this.k !== target && now() - t0 < budgetMs);
        r.notify();
        if (mine() && this.k !== target) await new Promise((res) => setTimeout(res, 0));
      }
    } finally {
      if (this.ffGen === token) {
        this.ff = null;
        if (this.active && this.pres) {
          const st = this.pres.steps[this.k];
          // a etapa de chegada começa como numa apresentação normal
          if (st.visual.run !== 'pausar') r.running = true;
          this.onScreen?.(st.visual.screen);
        }
        r.notify();
      }
    }
  }

  /** Executa a apresentação inteira sem esperar (testes e conferência). */
  runToEnd(r: SimRunner, maxSteps = 2_000_000): void {
    if (!this.active) return;
    this.ff = { target: -1, from: this.k };
    this.ffSim = 0;
    let n = 0;
    while (this.active && n < maxSteps) {
      this.ffChunk(r, 50);
      n += 50;
    }
    this.ff = null;
  }

  private ffChunk(r: SimRunner, nSteps: number): void {
    const st = this.pres!.steps[this.k];
    const frozen = st.visual.run === 'pausar' && !r.running;
    if (frozen) {
      // sem física: o relógio salta até o próximo evento da etapa
      const pending = st.actions.filter((a) => !this.fired.has(a.id)).map((a) => a.delay);
      const ev = [...pending, st.advance.mode === 'tempo' ? st.advance.seconds : Infinity, st.advance.mode === 'condicao' ? st.advance.minDwell : Infinity].filter((x) => x > this.clock + 1e-9);
      const next = ev.length ? Math.min(...ev) : this.clock + 1;
      this.update(r, Math.max(1e-3, Math.min(next, this.clock + 600) - this.clock), 0, true);
      return;
    }
    const dt = r.engine.config.settings.dt;
    const k0 = this.k;
    for (let i = 0; i < nSteps && this.active && this.k === k0; i++) {
      const e0 = r.engine;
      const t0 = e0.state.t;
      if (!r.stepBatch(1)) break;
      const simDt = r.engine === e0 ? r.engine.state.t - t0 : dt;
      this.ffSim += simDt;
      this.lastT = r.engine.state.t;
      this.engineRef = r.engine;
      this.update(r, simDt / Math.max(0.05, r.timeScale), simDt, true);
    }
  }

  // ------------------------------------------------------------ leitura
  waitText(st: PresStep): string {
    const a = st.advance;
    if (a.waitText.trim()) return a.waitText.trim();
    if (a.mode === 'manual') return 'o apresentador';
    if (a.mode === 'tempo') return `${a.seconds} s`;
    return a.conditions.length ? a.conditions.map(describeCondition).join(a.logic === 'todas' ? ' e ' : ' ou ') : 'leitura';
  }

  status(): CardStatus {
    const st = this.step;
    if (!st) return { kind: 'manual', text: '' };
    if (this.ff) return { kind: 'acelerando', text: `⏩ avançando acelerado até a etapa ${this.ff.target + 1}…` };
    if (this.paused) return { kind: 'pausado', text: '❚❚ PAUSADO' };
    const a = st.advance;
    if (a.mode === 'manual') return { kind: 'manual', text: '→ quando quiser, avance para a próxima etapa' };
    if (a.mode === 'tempo') return { kind: 'tempo', text: `⏱ próxima etapa em ${Math.max(0, Math.ceil(a.seconds - this.clock))} s` };
    const w = this.waitText(st);
    if (this.met) return { kind: 'pronto', text: `✓ ${w} — próxima etapa em ${Math.max(0, Math.ceil(a.minDwell - this.clock))} s` };
    const hold = a.hold > 0 && this.holdT > 0 ? ` · mantendo ${Math.floor(this.holdT)}/${a.hold} s` : '';
    if (this.timedOut) return { kind: 'esgotado', text: `⌛ tempo limite passou — ainda aguardando: ${w}${hold}` };
    return { kind: 'aguardando', text: `⟳ aguardando: ${w}${hold}` };
  }

  card(e: SimulationEngine): CardData | null {
    const st = this.step;
    const p = this.pres;
    if (!st || !p) return null;
    const c = this.varCtx();
    return {
      name: p.name,
      title: fillTemplate(st.title, e, c, this.base),
      text: fillTemplate(st.text, e, c, this.base),
      why: fillTemplate(st.why, e, c, this.base),
      k: this.k,
      n: p.steps.length,
      format: st.format,
      status: this.status(),
      outcome: [...this.outcome],
    };
  }

  hud(e: SimulationEngine): HudItem[] {
    const st = this.step;
    if (!st) return [];
    const c = this.varCtx();
    return st.visual.hud.flatMap((id) => {
      const v = presVar(id);
      return v ? [{ id, label: v.label, value: fmtVarUnit(v, readVar(id, e, c)) }] : [];
    });
  }

  overlay(e: SimulationEngine): PresOverlayData | null {
    const card = this.card(e);
    if (!card) return null;
    return { card, hud: this.hud(e), cam: this.cam };
  }

  /** notas do apresentador da etapa atual (só na janela de controle) */
  notes(e: SimulationEngine): string {
    const st = this.step;
    return st ? fillTemplate(st.notes, e, this.varCtx(), this.base) : '';
  }

  /** comandos enviados na etapa atual */
  sentHere(): { t: number; text: string }[] {
    return this.sent.filter((c) => c.step === this.k);
  }

  /** a apresentação foi editada durante a execução: passa a valer a versão nova */
  syncDefinition(p: UserPresentation): void {
    if (!this.pres || p.id !== this.pres.id || this.ff) return;
    this.pres = structuredClone(p);
    const n = p.steps.length;
    if (this.k >= n) this.k = Math.max(0, n - 1);
    this.outcome = p.steps.map((_, i) => this.outcome[i] ?? 'pendente');
  }

  // ------------------------------------------------------------ sessão
  snapshot(): PlayerSnapshot | null {
    if (!this.pres || (!this.active && !this.finished)) return null;
    return {
      // os estados guardados das etapas ficam na biblioteca (a sessão não os duplica)
      pres: { ...this.pres, steps: this.pres.steps.map((s) => ({ ...s, state: null })) },
      active: this.active && !this.ff,
      paused: this.paused,
      k: this.k,
      clock: this.clock,
      tStep: this.tStep,
      holdT: this.holdT,
      met: this.met,
      timedOut: this.timedOut,
      fired: [...this.fired],
      base: { ...this.base },
      trail: [...this.trail],
      outcome: [...this.outcome],
      sent: this.sent.slice(-60),
      finished: this.finished,
      elapsed: this.elapsed,
      startFile: this.startFile,
    };
  }

  /** retoma sem repetir ações (o estado físico já as contém) */
  restore(r: SimRunner, d: Partial<PlayerSnapshot> | null | undefined): void {
    this.ff = null;
    this.ffGen++;
    this.entry.clear();
    if (!d || !d.pres) {
      this.pres = null;
      this.active = false;
      this.finished = null;
      this.paused = false;
      return;
    }
    const saved = normalizePresentation(d.pres);
    const lib = presLibrary.get(saved.id);
    // a versão da biblioteca tem os estados guardados das etapas
    const p = lib && lib.steps.length === saved.steps.length ? structuredClone(lib) : saved;
    this.pres = p;
    const n = p.steps.length;
    this.k = Math.max(0, Math.min(n - 1, Number(d.k ?? 0)));
    this.active = !!d.active;
    this.paused = !!d.paused;
    this.clock = Number(d.clock ?? 0) || 0;
    this.tStep = Number(d.tStep ?? 0) || 0;
    this.holdT = Number(d.holdT ?? 0) || 0;
    this.met = !!d.met;
    this.timedOut = !!d.timedOut;
    this.fired = new Set(Array.isArray(d.fired) ? d.fired.map(String) : p.steps[this.k].actions.map((a) => a.id));
    this.base = d.base && typeof d.base === 'object' ? { ...d.base } : takeVars(r.engine, this.varCtx());
    this.trail = Array.isArray(d.trail) ? d.trail.map(Number).filter((x) => x >= 0 && x < n) : [];
    this.outcome = Array.isArray(d.outcome) && d.outcome.length === n ? d.outcome : p.steps.map(() => 'pendente');
    this.sent = Array.isArray(d.sent) ? d.sent : [];
    this.finished = d.finished ?? null;
    this.elapsed = Number(d.elapsed ?? 0) || 0;
    this.startFile = d.startFile ?? null;
    this.engineRef = r.engine;
    this.lastT = r.engine.state.t;
    this.runBeforePause = true;
    if (this.active) {
      const v = p.steps[this.k].visual;
      if (v.layers) pres.setLayers({ ...v.layers });
      if (v.view) pres.setView(v.view);
      if (v.camPose && (v.view ?? pres.view) === 'livre') this.cam = { key: ++this.camKey, pose: v.camPose };
      applyViewPose(v, v.view ?? pres.view, r.engine);
    }
  }
}

export const presPlayer = new PresPlayer();
