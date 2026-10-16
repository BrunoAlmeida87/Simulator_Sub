/**
 * Geometria do envelope do casco (corpo de revolução) discretizado em fatias.
 *
 *  r(x) = R·√(1 − ((x − x_b0)/L_b)²)            proa elíptica (x > x_b0)
 *  r(x) = R                                      corpo paralelo
 *  r(x) = r_t + (R − r_t)·(1 − s²), s = (x_s0 − x)/L_s   popa parabólica (x < x_s0)
 *
 * Origem do referencial do corpo: eixo do casco, a meio comprimento.
 * A vela (torre) é tratada como espaço de alagamento livre (não desloca).
 */
import type { HullConfig } from '../config/types';

export interface HullSlice {
  x: number; // posição longitudinal do centro da fatia
  r: number; // raio
  dx: number; // espessura
}

export interface HullGeometry {
  slices: HullSlice[];
  volume: number; // volume do envelope (m³)
  centroidX: number; // centro de carena longitudinal (submerso)
  wettedArea: number; // m²
  /** ∫ π r² (x − x_B)² dx — momento de inércia de volume (m⁵), para massa adicional. */
  volumeInertiaYY: number;
  radiusAt: (x: number) => number;
}

export function buildHullGeometry(h: HullConfig): HullGeometry {
  const L = h.length;
  const R = h.diameter / 2;
  const xb0 = L / 2 - h.bowLength;
  const xs0 = -L / 2 + h.sternLength;
  const radiusAt = (x: number): number => {
    if (x > L / 2 || x < -L / 2) return 0;
    if (x > xb0) {
      const t = (x - xb0) / h.bowLength;
      return R * Math.sqrt(Math.max(0, 1 - t * t));
    }
    if (x < xs0) {
      const s = (xs0 - x) / h.sternLength;
      return h.tailRadius + (R - h.tailRadius) * (1 - s * s);
    }
    return R;
  };
  const n = Math.max(20, h.slices);
  const dx = L / n;
  const slices: HullSlice[] = [];
  let vol = 0;
  let mx = 0;
  let wet = 0;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * dx;
    const r = radiusAt(x);
    slices.push({ x, r, dx });
    const a = Math.PI * r * r;
    vol += a * dx;
    mx += a * dx * x;
    // área lateral do tronco de cone entre as bordas da fatia
    const r0 = radiusAt(x - dx / 2);
    const r1 = radiusAt(x + dx / 2);
    wet += Math.PI * (r0 + r1) * Math.sqrt(dx * dx + (r1 - r0) * (r1 - r0));
  }
  const cx = mx / vol;
  let iyy = 0;
  for (const s of slices) iyy += Math.PI * s.r * s.r * s.dx * (s.x - cx) * (s.x - cx);
  return { slices, volume: vol, centroidX: cx, wettedArea: wet, volumeInertiaYY: iyy, radiusAt };
}
