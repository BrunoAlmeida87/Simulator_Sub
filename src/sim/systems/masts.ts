/**
 * EXPOSIÇÃO DOS MASTROS (lado da física): quais cabeças de mastro estão acima do nível médio da água,
 * com a atitude completa do casco. Mesma regra do `mastOut` da Sala de comando (render3d/controlRoom),
 * mas sem depender da interface. Usada pela correção de posição por GPS, pela discrição e pela aeronave.
 */
import type { VesselConfig } from '../config/types';
import type { SimState } from '../core/state';
import { qToMat3 } from '../core/math';
import { periscopeCfg, periscopeHeadZ } from './actuation';

/** altura (m, + fora d'água) do ponto (x, 0, z) do corpo sobre o nível médio */
function heightAboveMean(s: SimState, x: number, z: number): number {
  const R = qToMat3(s.body.quat);
  return -(s.body.pos.z + R[6] * x + R[8] * z);
}

export interface MastExposure {
  periscope: boolean;
  snorkel: boolean;
  surfaced: boolean;
  /** alguma antena/óptica fora d'água (GPS disponível) */
  any: boolean;
  /** rótulos do que está exposto */
  list: string[];
}

export function mastExposure(cfg: VesselConfig, s: SimState, surfaced: boolean): MastExposure {
  const top = -(cfg.hull.diameter / 2 + cfg.hull.sail.height);
  const pp = s.periscope?.pos ?? 0;
  const periscope = pp > 0.95 && heightAboveMean(s, periscopeCfg(cfg).x, periscopeHeadZ(cfg, pp)) > 0.2;
  const sp = s.snorkel.pos;
  const snorkel = sp > 0.95 && heightAboveMean(s, cfg.hull.snorkelMast.x, top - cfg.hull.snorkelMast.extension * sp) > 0.2;
  const list: string[] = [];
  if (surfaced) list.push('casco na superfície');
  if (snorkel) list.push('snorkel');
  if (periscope) list.push('periscópio');
  return { periscope, snorkel, surfaced, any: surfaced || snorkel || periscope, list };
}
