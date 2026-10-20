/**
 * GRAVAÇÃO E REPRODUÇÃO DE COMANDOS (controle pela interface).
 *
 * Gravar: guarda a sessão inicial completa e, daí em diante, cada comando
 * aplicado ao motor (do operador ou das automações — manobras, demonstração,
 * cenário guiado, rota), com o passo fixo em que foi aplicado, além das
 * mensagens de narração das automações e pontos de controle periódicos.
 *
 * Reproduzir: carrega a sessão inicial (sem retomar automações), bloqueia
 * qualquer comando que não venha da gravação e reaplica cada comando
 * gravado ANTES do mesmo passo em que foi aplicado originalmente. As
 * automações não rodam durante a reprodução — os comandos que elas emitiram
 * estão na gravação — então nada é executado duas vezes.
 */
import { runner } from './store';
import { applyCommand, withCommandSource, type Command } from '../sim/commands';
import { CHECKPOINT_EVERY, REC_FORMAT, REC_VERSION, compareCheckpoint, makeCheckpoint, describeCommand, type CheckpointDiff, type RecEvent, type RecordingFile } from '../sim/recording';
import { SIM_VERSION } from '../sim/version';
import { captureSession, restoreSession } from './session';
import { replayLock } from './replayLock';
import type { SimulationEngine } from '../sim/core/engine';

export type RecMode = 'parado' | 'gravando' | 'reproduzindo';

const K_LIST = 'sx1.recordings.v1';

class Recorder {
  mode: RecMode = 'parado';
  /** gravação atual (em andamento, recém-terminada ou carregada) */
  rec: RecordingFile | null = null;
  /** avisos da gravação carregada (compatibilidade) */
  warnings: string[] = [];
  /** motivo do último encerramento automático */
  lastStop = '';
  // reprodução
  idx = 0;
  cpIdx = 0;
  applied = 0;
  diffs: CheckpointDiff[] = [];
  finished = false;
  blocked = 0;
  lastBlocked = '';
  private engine: SimulationEngine | null = null;
  private nextCpStep = 0;
  private listeners = new Set<() => void>();
  private unsubReplace: (() => void) | null = null;
  private hook = (e: SimulationEngine): boolean | void => (this.mode === 'gravando' ? this.recordHook(e) : this.replayHook(e));
  /** aviso quando um comando é recusado durante a reprodução */
  onBlocked: ((msg: string) => void) | null = null;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const l of this.listeners) l();
  }

  // ---------------------------------------------------------------- gravação
  start(name = ''): void {
    if (this.mode !== 'parado') return;
    const e = runner.engine;
    const initial = captureSession('Início da gravação', true);
    this.rec = {
      format: REC_FORMAT,
      version: REC_VERSION,
      simVersion: SIM_VERSION,
      name: name.trim() || `Gravação ${new Date().toLocaleString('pt-BR')}`,
      createdAt: new Date().toISOString(),
      dt: e.config.settings.dt,
      initial,
      events: [],
      checkpoints: [],
      end: { step: e.state.step, t: e.state.t },
    };
    this.warnings = [];
    this.lastStop = '';
    this.mode = 'gravando';
    this.attach(e);
    // 1º ponto de controle no próximo gancho (já com os comandos dados neste mesmo passo)
    this.nextCpStep = e.state.step;
    e.log(`GRAVAÇÃO de comandos iniciada: “${this.rec.name}”`, 'Gravação');
    this.emit();
  }

  private attach(e: SimulationEngine): void {
    this.engine = e;
    if (this.mode === 'gravando') {
      e.commandTap = (c, src) => this.rec!.events.push({ step: e.state.step, t: e.state.t, src, cmd: structuredClone(c as Command) });
      e.noteTap = (text, group) => {
        if (group !== 'Gravação') this.rec!.events.push({ step: e.state.step, t: e.state.t, src: 'narração', note: { text, group } });
      };
    } else {
      e.commandGate = (c, src) => {
        if (src === 'reproducao') return true;
        this.blocked++;
        this.lastBlocked = (c as Command).type;
        this.onBlocked?.('Reprodução em andamento: comandos manuais e automações ficam bloqueados. Pause ou encerre a reprodução para assumir o controle.');
        this.emit();
        return false;
      };
    }
    runner.beforeStep.add(this.hook);
    this.unsubReplace?.();
    this.unsubReplace = runner.onEngineReplaced(() => {
      if (runner.engine !== this.engine) this.autoStop('o cenário foi trocado ou reiniciado');
    });
  }

  private detach(): void {
    const e = this.engine;
    if (e) {
      e.commandTap = null;
      e.noteTap = null;
      e.commandGate = null;
    }
    runner.beforeStep.delete(this.hook);
    this.unsubReplace?.();
    this.unsubReplace = null;
    this.engine = null;
    replayLock.active = false;
  }

  private recordHook(e: SimulationEngine): void {
    if (e.state.step >= this.nextCpStep && this.rec) {
      this.rec.checkpoints.push(makeCheckpoint(e));
      this.nextCpStep = e.state.step + Math.round(CHECKPOINT_EVERY / e.config.settings.dt);
    }
  }

  stopRecording(): void {
    if (this.mode !== 'gravando' || !this.rec) return;
    const e = runner.engine;
    this.rec.end = { step: e.state.step, t: e.state.t };
    if (this.rec.checkpoints.at(-1)?.step !== e.state.step) this.rec.checkpoints.push(makeCheckpoint(e));
    e.log(`Gravação encerrada: ${this.rec.events.filter((x) => x.cmd).length} comandos em ${(this.rec.end.t - this.rec.initial.simTime).toFixed(0)} s`, 'Gravação');
    this.detach();
    this.mode = 'parado';
    this.emit();
  }

  private autoStop(why: string): void {
    if (this.mode === 'gravando' && this.rec && this.engine) {
      const e = this.engine;
      this.rec.end = { step: e.state.step, t: e.state.t };
    }
    this.lastStop = `${this.mode === 'gravando' ? 'Gravação' : 'Reprodução'} encerrada automaticamente: ${why}.`;
    this.detach();
    this.mode = 'parado';
    this.emit();
  }

  // ---------------------------------------------------------------- reprodução
  load(rec: RecordingFile, warnings: string[] = []): void {
    if (this.mode !== 'parado') this.endReplay();
    this.rec = rec;
    this.warnings = warnings;
    this.finished = false;
    this.diffs = [];
    this.emit();
  }

  /** Começa (ou recomeça) a reprodução do início gravado. */
  play(): void {
    const rec = this.rec;
    if (!rec) return;
    if (this.mode === 'reproduzindo' && !this.finished) {
      runner.running = true;
      runner.notify();
      return;
    }
    if (this.mode === 'gravando') this.stopRecording();
    if (this.mode === 'reproduzindo') this.detach();
    // estado inicial gravado, sem retomar automações (os comandos delas estão na gravação)
    restoreSession(rec.initial, { automations: false });
    this.mode = 'reproduzindo';
    replayLock.active = true;
    this.idx = 0;
    this.cpIdx = 0;
    this.applied = 0;
    this.blocked = 0;
    this.diffs = [];
    this.finished = false;
    this.lastStop = '';
    this.attach(runner.engine);
    runner.engine.log(`REPRODUÇÃO da gravação “${rec.name}” (${rec.events.filter((x) => x.cmd).length} comandos)`, 'Gravação');
    runner.running = true;
    runner.notify();
    this.emit();
  }

  pause(): void {
    runner.running = false;
    runner.notify();
  }

  /** Encerra a reprodução: a simulação fica no ponto atual e volta a aceitar comandos. */
  endReplay(): void {
    if (this.mode !== 'reproduzindo') return;
    runner.engine.log('Reprodução encerrada — controle devolvido ao operador', 'Gravação');
    this.detach();
    this.mode = 'parado';
    runner.running = false;
    runner.notify();
    this.emit();
  }

  private replayHook(e: SimulationEngine): boolean | void {
    const rec = this.rec;
    if (!rec || this.finished) return false;
    const st = e.state.step;
    // comandos gravados para este passo (e eventuais atrasados)
    while (this.idx < rec.events.length && rec.events[this.idx].step <= st) {
      const ev = rec.events[this.idx++];
      this.applyEvent(e, ev);
    }
    // pontos de controle: na gravação são tomados antes do passo, já com os comandos deste passo
    while (this.cpIdx < rec.checkpoints.length && rec.checkpoints[this.cpIdx].step <= st) {
      const cp = rec.checkpoints[this.cpIdx++];
      if (cp.step === st) this.diffs.push(compareCheckpoint(cp, e));
    }
    if (st >= rec.end.step) {
      this.finished = true;
      runner.running = false;
      e.log('Reprodução concluída (fim da gravação). Encerre para assumir o controle.', 'Gravação');
      runner.notify();
      this.emit();
      return false;
    }
  }

  private applyEvent(e: SimulationEngine, ev: RecEvent): void {
    if (ev.cmd) {
      withCommandSource('reproducao', () => applyCommand(e, ev.cmd!));
      this.applied++;
    } else if (ev.note) e.log(ev.note.text, ev.note.group);
  }

  // ---------------------------------------------------------------- informações
  get progress(): { t: number; t0: number; t1: number; frac: number } {
    const rec = this.rec;
    const t = runner.engine.state.t;
    if (!rec) return { t, t0: 0, t1: 0, frac: 0 };
    const t0 = rec.initial.simTime;
    const t1 = rec.end.t;
    return { t, t0, t1, frac: t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 0 };
  }

  get commandCount(): number {
    return this.rec ? this.rec.events.filter((x) => x.cmd).length : 0;
  }

  /** próximos comandos da reprodução */
  upcoming(n = 3): string[] {
    const rec = this.rec;
    if (!rec || this.mode !== 'reproduzindo') return [];
    return rec.events
      .slice(this.idx)
      .filter((x) => x.cmd)
      .slice(0, n)
      .map((x) => `${x.t.toFixed(0)} s · ${describeCommand(x.cmd!)}${x.src !== 'operador' ? ` (${x.src})` : ''}`);
  }

  get checkSummary(): { n: number; exact: number; maxPos: number } {
    return { n: this.diffs.length, exact: this.diffs.filter((d) => d.exact).length, maxPos: this.diffs.reduce((a, d) => Math.max(a, d.dPos), 0) };
  }

  // ---------------------------------------------------------------- navegador
  listSaved(): RecordingFile[] {
    try {
      const raw = localStorage.getItem(K_LIST);
      return raw ? (JSON.parse(raw) as RecordingFile[]) : [];
    } catch {
      return [];
    }
  }
  saveToBrowser(r: RecordingFile): boolean {
    try {
      const list = this.listSaved().filter((x) => x.createdAt !== r.createdAt);
      list.unshift(r);
      while (list.length > 6) list.pop();
      localStorage.setItem(K_LIST, JSON.stringify(list));
      this.emit();
      return true;
    } catch {
      return false;
    }
  }
  deleteSaved(createdAt: string): void {
    try {
      localStorage.setItem(K_LIST, JSON.stringify(this.listSaved().filter((x) => x.createdAt !== createdAt)));
    } catch {
      /* indisponível */
    }
    this.emit();
  }
}

export const recorder = new Recorder();
