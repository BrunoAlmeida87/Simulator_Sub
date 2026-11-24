import type { Environment } from '../../sim/environment/environment';
import type { EnvironmentPatch } from '../../sim/commands';
import { clamp, sumDb } from '../types';
/** Mackenzie-style educational approximation, T °C, S PSU, depth m (pressure contribution). */
export function soundSpeed(t: number, s: number, z: number): number {
  return 1448.96 + 4.591 * t - 0.05304 * t * t + 0.0002374 * t ** 3 + 1.34 * (s - 35) + 0.0163 * z + 1.675e-7 * z * z - 0.01025 * t * (s - 35);
}
/** Direct evaluation (no table): c(z) from the profile. */
function speedDirect(env: Environment, z: number): number {
  return soundSpeed(env.temperatureAt(z), env.salinityAt(z), Math.max(0, z));
}
/** Direct evaluation (no table): centred ±0.5 m difference, one-sided near the surface. */
function gradientDirect(env: Environment, z: number): number {
  const lo = Math.max(0, z - 0.5);
  return (speedDirect(env, z + 0.5) - speedDirect(env, lo)) / (z + 0.5 - lo);
}
/**
 * The profile depends only on depth (horizontal stratification) and is fixed for an Environment
 * instance (changing T/S rebuilds the Environment), so c(z) and dc/dz are tabulated once per
 * instance every 0.25 m and interpolated linearly. Ray tracing evaluates them ~5× per step;
 * the table removes the cubic polynomial and the two tanh per evaluation (interpolation error
 * < 1e-3 m/s for the thermoclines of the scenarios).
 */
const TABLE_STEP = 0.25;
const TABLE_MAX = 3000;
interface SpeedTable {
  c: Float64Array;
  g: Float64Array;
}
const tables = new WeakMap<object, SpeedTable>();
function tableFor(env: Environment): SpeedTable {
  let t = tables.get(env);
  if (!t) {
    const n = Math.round(TABLE_MAX / TABLE_STEP) + 1;
    const c = new Float64Array(n),
      g = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      c[i] = speedDirect(env, i * TABLE_STEP);
      g[i] = gradientDirect(env, i * TABLE_STEP);
    }
    t = { c, g };
    tables.set(env, t);
  }
  return t;
}
function lookup(a: Float64Array, z: number): number {
  const f = z / TABLE_STEP,
    i = Math.floor(f);
  return a[i] + (a[i + 1] - a[i]) * (f - i);
}
export function speedAt(env: Environment, z: number, homogeneous = false): number {
  if (homogeneous) return 1500;
  if (!(z >= 0) || z >= TABLE_MAX) return speedDirect(env, z);
  const t = tableFor(env);
  return lookup(t.c, z);
}
export function gradientAt(env: Environment, z: number, homogeneous = false): number {
  if (homogeneous) return 0;
  if (!(z >= 0) || z >= TABLE_MAX) return gradientDirect(env, z);
  const t = tableFor(env);
  return lookup(t.g, z);
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
