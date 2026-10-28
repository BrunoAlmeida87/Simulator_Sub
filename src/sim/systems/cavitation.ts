/** Estimativa educacional compartilhada pelo efeito 3D, configurações e alarmes.
 * Não modifica forças nem representa ensaios de uma hélice real. */
import { clamp, qToMat3 } from '../core/math';
import type { VesselConfig } from '../config/types';
import type { SimState } from '../core/state';
import type { Environment } from '../environment/environment';

export const CAVITATION_RADIUS_FRACTION = 0.9;
export const CAVITATION_INTENSITY_SPAN = 0.45;
export const CAVITATION_ALARM_ON = 0.05;
export const CAVITATION_ALARM_OFF = 0.02;
export const CAVITATION_ALARM_DELAY = 1;

export const CAVITATION_SIGMA_CRITICAL = 0.8;

export function cavitationIntensity(pressure: number, density: number, temperature: number, omega: number, radius: number, advanceSpeed: number): number {
  if (Math.abs(omega) < 0.1) return 0;
  // Pressão de vapor de água pura (aproximação de Tetens, Pa).
  const pv = 610.78 * Math.exp((17.27 * temperature) / (temperature + 237.3));
  const q = 0.5 * density * ((omega * radius) ** 2 + advanceSpeed ** 2);
  const sigma = (pressure - pv) / Math.max(1, q);
  return clamp((CAVITATION_SIGMA_CRITICAL - sigma) / CAVITATION_INTENSITY_SPAN, 0, 1);
}

export function cavitationSamples(vessel: VesselConfig, s: SimState, env: Environment, t = s.t) {
  const R = qToMat3(s.body.quat);
  const prop = vessel.propulsion.propeller;
  const x = -vessel.hull.length / 2 - 0.8;
  const r = (prop.diameter / 2) * CAVITATION_RADIUS_FRACTION;
  return Array.from({ length: prop.blades }, (_, blade) => {
    const angle = s.propulsion.shaftAngle + (blade * 2 * Math.PI) / prop.blades;
    const y = Math.cos(angle) * r,
      z = Math.sin(angle) * r;
    const n = s.body.pos.x + R[0] * x + R[1] * y + R[2] * z;
    const e = s.body.pos.y + R[3] * x + R[4] * y + R[5] * z;
    const d = s.body.pos.z + R[6] * x + R[7] * y + R[8] * z;
    const depth = d + env.waves.elevation(n, e, t);
    const intensity = depth > 0 ? cavitationIntensity(env.pressureAt(depth), env.densityAt(s.body.pos.z), env.temperatureAt(depth), s.propulsion.omega, r, s.body.vel.x * (1 - prop.wakeFraction)) : 0;
    return { n, e, d, depth, intensity };
  });
}

export function cavitationLevel(vessel: VesselConfig, s: SimState, env: Environment): number {
  return Math.max(0, ...cavitationSamples(vessel, s, env).map((p) => p.intensity));
}

/** Limite aproximado do eixo no topo do disco, mar calmo e casco nivelado. */
export function cavitationReferenceDepth(vessel: VesselConfig, env: Environment, rpm: number, knots: number): number | null {
  const prop = vessel.propulsion.propeller;
  const r = (prop.diameter / 2) * CAVITATION_RADIUS_FRACTION;
  const at = (h: number) => cavitationIntensity(env.pressureAt(h), env.densityAt(h + r), env.temperatureAt(h), (rpm * Math.PI) / 30, r, knots * 0.514444 * (1 - prop.wakeFraction));
  if (at(0) <= 0) return null;
  let lo = 0,
    hi = 3000;
  for (let i = 0; i < 35; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2 + r;
}
