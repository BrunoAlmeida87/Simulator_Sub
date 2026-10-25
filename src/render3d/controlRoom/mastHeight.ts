/**
 * Altura de um ponto dos mastros acima da água, com a atitude completa do
 * casco (caturro e balanço). Referência comum do periscópio, da antena de GPS
 * e do MAGE (auditoria A13). Só lê o estado.
 */
import type { SimulationEngine } from '../../sim/core/engine';
import { qToMat3 } from '../../sim/core/math';

/**
 * Altura (m, + = fora d'água) do ponto (x, 0, z) do corpo (z + para baixo).
 * `waves`: true = superfície local com a onda no instante t; false = nível médio.
 */
export function pointHeightAboveWater(e: SimulationEngine, x: number, z: number, waves: boolean, t = e.state.t): number {
  const s = e.state;
  const R = qToMat3(s.body.quat);
  const d = s.body.pos.z + R[6] * x + R[8] * z;
  if (!waves) return -d;
  const n = s.body.pos.x + R[0] * x + R[2] * z;
  const ea = s.body.pos.y + R[3] * x + R[5] * z;
  return -d - e.env.waves.elevation(n, ea, t);
}
