/**
 * Apresentação dos alarmes — a mesma em todas as telas: prioridade em FORMA +
 * TEXTO + cor (nunca só cor). P1 CRÍTICO ⬢ fundo sólido, P2 ALTO ◆ vermelho com
 * contorno, P3 MÉDIO ▲ âmbar, P4 INFO ● ciano. Vermelho, âmbar e verde ficam
 * reservados para estado (global.css: --crit, --alarm, --warn, --ok).
 */
import { PRIORITY_LABEL } from '../sim/systems/alarms';

/** forma de cada prioridade */
export const PRIO_SHAPE: Record<number, string> = { 1: '⬢', 2: '◆', 3: '▲', 4: '●' };

/** classe do selo (.badge) de uma prioridade */
export function prioBadge(priority: number): 'crit' | 'alarm' | 'warn' | 'info' {
  return priority <= 1 ? 'crit' : priority === 2 ? 'alarm' : priority === 3 ? 'warn' : 'info';
}

/** texto do selo: forma + nome da prioridade (ex.: "◆ ALTO") */
export function prioText(priority: number): string {
  return `${PRIO_SHAPE[priority] ?? '●'} ${PRIORITY_LABEL[priority] ?? ''}`.trim();
}
