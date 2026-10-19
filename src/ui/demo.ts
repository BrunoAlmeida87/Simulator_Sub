/**
 * Demonstração automática da sequência completa (mesmo roteiro do teste V12),
 * executada em tempo real sobre o motor da interface. Cada etapa só avança
 * quando a condição física é atingida; o resultado de cada etapa é registrado
 * como SUCESSO, TEMPO ESGOTADO ou FALHA (alarme crítico durante a etapa).
 */
import { fullSequenceSteps, type SequenceStep } from '../sim/validation/suite';
import type { SimRunner } from '../sim/core/runner';
import { visibleAlarms } from '../sim/systems/alarms';

export type StepOutcome = 'pendente' | 'em curso' | 'sucesso' | 'tempo esgotado' | 'falha' | 'interrompida';

export class DemoController {
  active = false;
  steps: SequenceStep[] = fullSequenceSteps();
  k = 0;
  tStep = 0;
  entered = false;
  lastT = 0;
  outcome: StepOutcome[] = [];
  duration: number[] = [];
  /** resultado geral da última demonstração */
  final: { ok: number; timeout: number; fail: number; stopped: boolean } | null = null;

  /** compatibilidade: etapas concluídas com sucesso */
  get done(): boolean[] {
    return this.outcome.map((o) => o === 'sucesso');
  }

  start(r: SimRunner): void {
    this.steps = fullSequenceSteps();
    this.k = 0;
    this.tStep = 0;
    this.entered = false;
    this.outcome = this.steps.map(() => 'pendente');
    this.duration = this.steps.map(() => 0);
    this.final = null;
    this.lastT = r.engine.state.t;
    this.active = true;
    r.engine.log('DEMONSTRAÇÃO AUTOMÁTICA iniciada (roteiro da sequência completa)', 'Demonstração');
    r.running = true;
    r.notify();
  }

  stop(r: SimRunner): void {
    if (this.active) {
      r.engine.log('Demonstração automática interrompida', 'Demonstração');
      if (this.outcome[this.k] === 'em curso') this.outcome[this.k] = 'interrompida';
      this.summarize(true);
    }
    this.active = false;
    r.notify();
  }

  private summarize(stopped: boolean): void {
    this.final = {
      ok: this.outcome.filter((o) => o === 'sucesso').length,
      timeout: this.outcome.filter((o) => o === 'tempo esgotado').length,
      fail: this.outcome.filter((o) => o === 'falha').length,
      stopped,
    };
  }

  tick(r: SimRunner): void {
    if (!this.active) return;
    const e = r.engine;
    const t = e.state.t;
    const dt = t - this.lastT;
    this.lastT = t;
    if (dt <= 0) return;
    const st = this.steps[this.k];
    if (!st) {
      this.active = false;
      return;
    }
    if (!this.entered) {
      e.log(`Demonstração — etapa ${this.k + 1}: ${st.name}`, 'Demonstração');
      st.enter(e);
      this.entered = true;
      this.tStep = 0;
      this.outcome[this.k] = 'em curso';
      r.notify();
    }
    st.during?.(e);
    this.tStep += dt;
    // alarme de prioridade 1 (crítico) durante a etapa = falha
    const critical = visibleAlarms(e.state).find((a) => a.active && a.def.priority === 1);
    const ok = st.done(e, this.tStep);
    if (ok || this.tStep > st.timeout || critical) {
      this.outcome[this.k] = ok ? 'sucesso' : critical ? 'falha' : 'tempo esgotado';
      this.duration[this.k] = this.tStep;
      e.log(`Demonstração — etapa ${this.k + 1}: ${this.outcome[this.k].toUpperCase()}${critical && !ok ? ` (${critical.def.text})` : ''}`, 'Demonstração');
      this.k++;
      this.entered = false;
      if (this.k >= this.steps.length || (critical && !ok)) {
        this.active = false;
        this.summarize(false);
        e.log(`Demonstração automática concluída: ${this.final!.ok} sucesso, ${this.final!.timeout} tempo esgotado, ${this.final!.fail} falha`, 'Demonstração');
      }
      r.notify();
    }
  }
}

export const demo = new DemoController();
