/**
 * INSTRUTOR — eventos programados (falhas e outras ações) por instante ou por condição.
 *
 * Os eventos ficam no estado da simulação (salvos com a sessão, iguais em todas as janelas) e são avaliados
 * no início de cada passo. Um evento que dispara aplica o seu comando pela via normal (applyCommand, com a
 * origem "instrutor"): aparece no histórico e na gravação como os outros comandos.
 */
import type { SimulationEngine } from '../core/engine';
import type { InstructorCond, InstructorEvent } from '../core/extState';

export function condValue(e: SimulationEngine, c: InstructorCond): number {
  const o = e.outputs;
  switch (c.variable) {
    case 'depth':
      return o.depthKeel;
    case 'speed':
      return (o.speed * 3600) / 1852;
    case 'pitch':
      return o.euler.pitch;
    case 'heading':
      return o.euler.heading;
    case 'soc':
      return e.state.electrical.soc * 100;
    case 'time':
      return e.state.t;
  }
}

export function eventDue(e: SimulationEngine, ev: InstructorEvent): boolean {
  if (ev.fired) return false;
  if (ev.at !== undefined && e.state.t + 1e-9 < ev.at) return false;
  if (ev.cond) {
    const v = condValue(e, ev.cond);
    if (!(ev.cond.op === '>' ? v > ev.cond.value : v < ev.cond.value)) return false;
  }
  return ev.at !== undefined || !!ev.cond;
}

/** eventos que devem disparar agora (o motor os marca e aplica) */
export function dueEvents(e: SimulationEngine): InstructorEvent[] {
  const ins = e.state.instructor;
  if (!ins || !ins.events.length) return [];
  return ins.events.filter((ev) => eventDue(e, ev));
}

export const COND_LABEL: Record<InstructorCond['variable'], string> = {
  depth: 'profundidade (m)',
  speed: 'velocidade (nós)',
  pitch: 'pitch (°)',
  heading: 'rumo (°)',
  soc: 'carga da bateria (%)',
  time: 'tempo (s)',
};
