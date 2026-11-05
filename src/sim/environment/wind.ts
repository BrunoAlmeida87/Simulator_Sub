/**
 * Vento real do cenário (fictício, sem efeito na dinâmica do submarino): uma brisa leve no sentido em que as
 * ondas vão, um pouco mais forte com o mar mais agitado. Usado pelo desenho do vento (render3d/WindFx.ts) e pela
 * deriva dos sinais na superfície (systems/signals.ts).
 */
import type { WaveConfig } from './waves';

/** brisa (m/s) por estado do mar 0…6 — fraca de propósito: o avanço do submarino domina o vento aparente */
export const WIND_BY_SEA_STATE = [0.4, 0.8, 1.2, 1.6, 2.0, 2.5, 3.0];

/** vento real (m/s), como vetor para onde o ar vai (n, e) */
export function windOf(w: WaveConfig | undefined): { n: number; e: number; speed: number } {
  const ss = Math.max(0, Math.min(6, Math.round(w?.seaState ?? 0)));
  const speed = WIND_BY_SEA_STATE[ss];
  const a = ((w?.direction ?? 0) * Math.PI) / 180;
  return { n: Math.cos(a) * speed, e: Math.sin(a) * speed, speed };
}
