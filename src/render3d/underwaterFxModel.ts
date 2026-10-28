/** Modelos VISUAIS: não modificam empuxo, forças, sensores ou ruído acústico.
 * σ = (p∞ − pv)/(½ρVrel²). σ crítico é uma calibração ilustrativa do SX-1,
 * não um resultado de ensaio de hélice. Ver docs/EFEITOS-SUBMERSOS.md.
 */
import { clamp } from '../sim/core/math';

export { cavitationIntensity, CAVITATION_SIGMA_CRITICAL } from '../sim/systems/cavitation';

/** Alcance de 6 m é ajuste visual para fundo arenoso; não é um limite físico universal. */
export function sedimentIntensity(clearance: number, speed: number, jetSpeed: number, downwardSpeed: number): number {
  const proximity = clamp(1 - Math.max(0, clearance) / 6, 0, 1) ** 2;
  const stirring = clamp((speed ** 2 + 0.6 * jetSpeed ** 2) / 30, 0, 1);
  const impact = clearance <= 0.15 ? clamp(downwardSpeed * 2, 0, 1) : 0;
  return clamp(proximity * stirring + impact, 0, 1);
}
