/**
 * Demonstração automática da sequência completa (mesmo roteiro do teste V12),
 * executada em tempo real sobre o motor da interface. Cada etapa só avança
 * quando a condição física é atingida.
 */
import { fullSequenceSteps, type SequenceStep } from '../sim/validation/suite';
import type { SimRunner } from '../sim/core/runner';

export class DemoController {
  active = false;
  steps: SequenceStep[] = fullSequenceSteps();
  k = 0;
  tStep = 0;
  entered = false;
  lastT = 0;
  done: boolean[] = [];

  start(r: SimRunner): void {
    this.steps = fullSequenceSteps();
    this.k = 0;
    this.tStep = 0;
    this.entered = false;
    this.done = this.steps.map(() => false);
    this.lastT = r.engine.state.t;
    this.active = true;
    r.engine.log('DEMONSTRAÇÃO AUTOMÁTICA iniciada (roteiro da sequência completa)', 'Demonstração');
    r.running = true;
    r.notify();
  }

  stop(r: SimRunner): void {
    if (this.active) r.engine.log('Demonstração automática interrompida', 'Demonstração');
    this.active = false;
    r.notify();
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
      r.notify();
    }
    st.during?.(e);
    this.tStep += dt;
    if (st.done(e, this.tStep) || this.tStep > st.timeout) {
      this.done[this.k] = st.done(e, this.tStep);
      this.k++;
      this.entered = false;
      if (this.k >= this.steps.length) {
        this.active = false;
        e.log('Demonstração automática concluída', 'Demonstração');
      }
      r.notify();
    }
  }
}

export const demo = new DemoController();
