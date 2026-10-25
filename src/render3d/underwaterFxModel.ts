/** Modelos VISUAIS: não modificam empuxo, forças, sensores ou ruído acústico.
 * σ = (p∞ − pv)/(½ρVrel²). σ crítico é uma calibração ilustrativa do SX-1,
 * não um resultado de ensaio de hélice. Ver docs/EFEITOS-SUBMERSOS.md.
 */
import { clamp } from '../sim/core/math';

export const CAVITATION_SIGMA_CRITICAL = 0.8;

export function cavitationIntensity(pressure: number, density: number, temperature: number, omega: number, radius: number, advanceSpeed: number): number {
  if (Math.abs(omega) < 0.1) return 0;
  // Pressão de vapor de água pura (aproximação de Tetens, Pa).
  const pv = 610.78 * Math.exp((17.27 * temperature) / (temperature + 237.3));
  const q = 0.5 * density * ((omega * radius) ** 2 + advanceSpeed ** 2);
  const sigma = (pressure - pv) / Math.max(1, q);
  return clamp((CAVITATION_SIGMA_CRITICAL - sigma) / 0.45, 0, 1);
}

/** Alcance de 6 m é ajuste visual para fundo arenoso; não é um limite físico universal. */
export function sedimentIntensity(clearance: number, speed: number, jetSpeed: number, downwardSpeed: number): number {
  const proximity = clamp(1 - Math.max(0, clearance) / 6, 0, 1) ** 2;
  const stirring = clamp((speed ** 2 + 0.6 * jetSpeed ** 2) / 30, 0, 1);
  const impact = clearance <= 0.15 ? clamp(downwardSpeed * 2, 0, 1) : 0;
  return clamp(proximity * stirring + impact, 0, 1);
}
