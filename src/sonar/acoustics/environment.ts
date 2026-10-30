import type { Environment } from '../../sim/environment/environment';
import type { EnvironmentPatch } from '../../sim/commands';
import { clamp, sumDb } from '../types';
/** Mackenzie-style educational approximation, T °C, S PSU, depth m (pressure contribution). */
export function soundSpeed(t: number, s: number, z: number): number {
  return 1448.96 + 4.591 * t - 0.05304 * t * t + 0.0002374 * t ** 3 + 1.34 * (s - 35) + 0.0163 * z + 1.675e-7 * z * z - 0.01025 * t * (s - 35);
}
export function speedAt(env: Environment, z: number, homogeneous = false): number {
  return homogeneous ? 1500 : soundSpeed(env.temperatureAt(z), env.salinityAt(z), Math.max(0, z));
}
export function gradientAt(env: Environment, z: number, homogeneous = false): number {
  const lo = Math.max(0, z - 0.5);
  return (speedAt(env, z + 0.5, homogeneous) - speedAt(env, lo, homogeneous)) / (z + 0.5 - lo);
}
export function ambientNoise(sea: number, shipping: number, biological: number): number {
  return sumDb(42 + 3.5 * clamp(sea, 0, 9), 40 + 14 * clamp(shipping, 0, 1), 34 + 16 * clamp(biological, 0, 1));
}
/** Thorp absorption dB/km; frequency in Hz. */
export function absorption(f: number): number {
  const f2 = (Math.max(1, f) / 1000) ** 2;
  return (0.11 * f2) / (1 + f2) + (44 * f2) / (4100 + f2) + 2.75e-4 * f2 + 0.003;
}
export const PRESETS: Record<string, EnvironmentPatch> = {
  Tropical: { surfaceTemperature: 28, deepTemperature: 4, thermoclineDepth: 180, thermoclineThickness: 85, salinity: 35, deepSalinity: 35 },
  Verão: { surfaceTemperature: 23, deepTemperature: 7, thermoclineDepth: 70, thermoclineThickness: 25 },
  Inverno: { surfaceTemperature: 12, deepTemperature: 8, thermoclineDepth: 160, thermoclineThickness: 80 },
  'Águas frias': { surfaceTemperature: 2, deepTemperature: 1, thermoclineDepth: 80, thermoclineThickness: 40 },
};
