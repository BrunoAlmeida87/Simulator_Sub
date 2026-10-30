import type { Environment } from '../../sim/environment/environment';
import { type Observer, type Propagation, type Ray, type AcousticPath, clamp } from '../types';
import { absorption, gradientAt, speedAt } from './environment';
/** Sample the existing physical bottom once per vertical section, not once per ray step.
 * Linear interpolation, at most 10 m spacing for regular 6 km views (1024 intervals cap).
 */
function sectionFloor(env: Environment, origin: Observer, bearing: number, range: number): (r: number) => number {
  const a = (bearing * Math.PI) / 180,
    cn = Math.cos(a),
    ce = Math.sin(a);
  const n = Math.min(1024, Math.max(2, Math.ceil(range / 10))),
    step = range / n;
  const depths = Float64Array.from({ length: n + 1 }, (_, i) => env.bottomDepthAt(origin.n + cn * i * step, origin.e + ce * i * step));
  return (r) => {
    const f = clamp(r / step, 0, n),
      i = Math.min(n - 1, Math.floor(f));
    return depths[i] + (depths[i + 1] - depths[i]) * (f - i);
  };
}
/** Vertical 2D ray: dθ/ds = -cos(θ)/c · dc/dz, depth positive down.
 * No artistic curvature gain. Flat surface, specular sloping-bottom reflection.
 */
export function traceRay(env: Environment, origin: Observer, bearing: number, angle: number, maxRange: number, frequency = 1000, homogeneous = false, floorAt?: (r: number) => number, record = true): Ray {
  const floor = floorAt ?? sectionFloor(env, origin, bearing, maxRange);
  let r = 0,
    z = Math.max(0.2, origin.depth),
    theta = angle,
    t = 0,
    distance = 0,
    boundaryLoss = 0;
  const points: Ray['points'] = [{ r, z, t, loss: 0 }];
  const ds = clamp(maxRange / 220, 2, 40);
  for (let i = 0; i < 600 && r < maxRange && Math.cos(theta) > 0.01; i++) {
    const c = speedAt(env, z, homogeneous);
    const mid = theta - (((Math.cos(theta) * gradientAt(env, z, homogeneous)) / c) * ds) / 2;
    let nr = Math.min(maxRange, r + Math.cos(mid) * ds),
      nz = z + Math.sin(mid) * ds;
    theta -= ((Math.cos(mid) * gradientAt(env, Math.max(0, (z + nz) / 2), homogeneous)) / c) * ds;
    const bottom = floor(nr);
    if (bottom <= 0.3) break; // land blocks propagation
    let event: 'surface' | 'bottom' | undefined;
    // Stop at the boundary, discard remainder of this step (no rays below terrain).
    let fraction = 1;
    if (nz < 0) {
      fraction = z / Math.max(1e-9, z - nz);
      nz = 0;
      nr = r + (nr - r) * fraction;
      theta = -theta;
      boundaryLoss += 1;
      event = 'surface';
    } else if (nz >= bottom) {
      const oldFloor = floor(r);
      fraction = clamp((oldFloor - z) / Math.max(1e-9, nz - z - (bottom - oldFloor)), 0.01, 1);
      nr = r + (nr - r) * fraction;
      nz = Math.max(0.2, floor(nr) - 0.05);
      const slope = Math.atan2(floor(nr + 2) - floor(Math.max(0, nr - 2)), nr >= 2 ? 4 : nr + 2);
      theta = 2 * slope - theta;
      boundaryLoss += 5;
      event = 'bottom';
    }
    distance += ds * fraction;
    t += (ds * fraction) / c;
    r = nr;
    z = nz;
    const loss = 20 * Math.log10(Math.max(1, distance)) + (absorption(frequency) * distance) / 1000 + boundaryLoss;
    if (record) points.push({ r, z, t, loss, ...(event ? { event } : {}) });
    else {
      const p = (points[1] ??= { r, z, t, loss });
      p.r = r;
      p.z = z;
      p.t = t;
      p.loss = loss;
    }
  }
  return { points };
}
export function propagation(env: Environment, origin: Observer, bearing: number, range: number, count = 64, homogeneous = false): Propagation {
  const floor = sectionFloor(env, origin, bearing, range);
  const rays = Array.from({ length: clamp(Math.round(count), 8, 512) }, (_, i) => {
    return traceRay(env, origin, bearing, ((-65 + (130 * i) / Math.max(1, count - 1)) * Math.PI) / 180, range, 1000, homogeneous, floor);
  });
  const a = (bearing * Math.PI) / 180;
  const bottom = Array.from({ length: 121 }, (_, i) => {
    const r = (i * range) / 120;
    return { r, z: env.bottomDepthAt(origin.n + Math.cos(a) * r, origin.e + Math.sin(a) * r) };
  });
  const maxZ = Math.max(100, ...bottom.map((p) => p.z));
  const profile = Array.from({ length: 121 }, (_, i) => {
    const z = (i * maxZ) / 120;
    return { z, c: speedAt(env, z, homogeneous) };
  });
  return { origin: { ...origin }, bearing, range, rays, bottom, profile, thermocline: env.cfg.thermoclineDepth };
}
/** Coarse eigenray search independent of visualization quality. Finite beam width yields
 * a continuous coverage penalty; no ray match is never proof of an absolute shadow.
 */
export function pathEstimate(
  env: Environment,
  from: Observer,
  bearing: number,
  range: number,
  targetDepth: number,
  homogeneous = false,
  includePaths = false,
): { loss: number; time: number; coverage: number; paths: AcousticPath[] } {
  if (range < 1) return { loss: 0, time: Math.abs(from.depth - targetDepth) / speedAt(env, from.depth, homogeneous), coverage: 1, paths: [] };
  const floor = sectionFloor(env, from, bearing, range);
  const direct = Math.atan2(targetDepth - from.depth, range);
  const angles = [direct, ...Array.from({ length: 17 }, (_, i) => ((-50 + (i * 100) / 16) * Math.PI) / 180)];
  let best = { loss: 200, time: Math.hypot(range, targetDepth - from.depth) / speedAt(env, from.depth, homogeneous), coverage: 0 };
  const candidates: AcousticPath[] = [];
  for (const angle of angles) {
    const ray = traceRay(env, from, bearing, angle, range, 500, homogeneous, floor, includePaths);
    const end = ray.points[ray.points.length - 1];
    if (end.r < range - 0.01) continue; // stopped/backward rays cannot masquerade as short low-loss paths
    const miss = Math.abs(end.z - targetDepth);
    const width = Math.max(12, range * 0.015);
    const penalty = Math.min(60, 20 * Math.log10(1 + miss / width));
    if (includePaths) candidates.push({ loss: end.loss + penalty, time: end.t, coverage: 1 / (1 + miss / width), ray });
    if (end.loss + penalty < best.loss) best = { loss: end.loss + penalty, time: end.t + Math.max(0, range - end.r) / 1500, coverage: 1 / (1 + miss / width) };
  }
  const paths: AcousticPath[] = [];
  for (const candidate of candidates.sort((a, b) => a.loss - b.loss)) {
    if (paths.length >= 3) break;
    if (!paths.some((p) => Math.abs(p.time - candidate.time) < 0.04) && candidate.loss < best.loss + 12 && candidate.coverage > 0.25) paths.push(candidate);
  }
  return { ...best, paths };
}
