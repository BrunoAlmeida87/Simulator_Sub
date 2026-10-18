/**
 * FORÇAS HIDRODINÂMICAS (referencial do corpo).
 *
 * Modelo por componentes (inspirado em Gertler–Hagen / Prestero, simplificado):
 *
 * 1) Resistência ao avanço:
 *      X_R = −½·ρ·S_m·C_t·(1 + k_sup·f_sup)·u|u| − c_u·u
 *    S_m = área molhada imersa; f_sup = 1 na superfície → 0 abaixo de ~3D
 *    (resistência de formação de ondas).
 *
 * 2) Escoamento cruzado viscoso (strip theory), por fatia i de diâmetro Dᵢ:
 *      v_c = (v + r·xᵢ,  w − q·xᵢ)
 *      dF = −½·ρ·C_dc·Dᵢ·Δx·|v_c|·v_c
 *    Gera amortecimento quadrático em sway/heave/yaw/pitch.
 *
 * 3) Sustentação do casco (linear em ângulo de ataque), no centro de pressão x_cp:
 *      Z_c = −½·ρ·D²·C_Lc·u·w,   Y_c = −½·ρ·D²·C_Lc·u·v
 *
 * 4) Superfícies (lemes e estabilizadores) — sustentação e arrasto pelo
 *    escoamento LOCAL na superfície (v_loc = v + ω × r):
 *      α = δ + atan2(v_n, v_x),  L = ½·ρ·|V|²·A·C_L(α),  D = ½·ρ·|V|²·A·C_D(α)
 *      C_Lα = 2π·AR / (2 + √(AR² + 4))   (Helmbold), estol em α_e
 *    ⇒ efetividade ∝ U²: com velocidade nula, os lemes não geram força.
 *
 * 5) Amortecimento linear residual (efeitos viscosos a baixa velocidade) e,
 *    perto da superfície, amortecimento por radiação de ondas (linear).
 *
 * O momento de Munk (massa adicional) é tratado em dynamics.ts.
 */
import type { FinConfig, VesselConfig } from '../config/types';
import { DEG, vCross, type Vec3 } from '../core/math';
import type { HullGeometry } from './hullGeometry';

export interface Wrench {
  F: Vec3;
  M: Vec3;
}

export const zeroWrench = (): Wrench => ({ F: { x: 0, y: 0, z: 0 }, M: { x: 0, y: 0, z: 0 } });

export function addWrench(a: Wrench, b: Wrench): void {
  a.F.x += b.F.x;
  a.F.y += b.F.y;
  a.F.z += b.F.z;
  a.M.x += b.M.x;
  a.M.y += b.M.y;
  a.M.z += b.M.z;
}

/** Fator de proximidade da superfície para resistência de ondas (1 → 0). */
export function surfaceProximity(axisDepth: number, radius: number): number {
  const d = axisDepth - radius;
  if (d <= 0) return 1;
  return Math.exp(-d / (2 * radius));
}

export function hullForces(
  cfg: VesselConfig,
  geom: HullGeometry,
  vel: Vec3,
  omega: Vec3,
  rho: number,
  sliceImm: Float64Array,
  immFraction: number,
  axisDepth: number,
  waveVel?: { vy: Float64Array; vz: Float64Array },
): { resistance: Wrench; crossflow: Wrench; lift: Wrench; damping: Wrench } {
  const h = cfg.hydro;
  const { x: u, y: v, z: w } = vel;
  const { x: p, y: q, z: r } = omega;
  const R = cfg.hull.diameter / 2;

  const resistance = zeroWrench();
  const S = geom.wettedArea * h.appendageFactor * immFraction;
  const ksurf = 1 + h.surfaceResistanceFactor * surfaceProximity(axisDepth, R);
  resistance.F.x = -0.5 * rho * S * h.totalResistanceCoeff * ksurf * u * Math.abs(u) - h.linearDamping.surge * u;

  const crossflow = zeroWrench();
  const slices = geom.slices;
  for (let i = 0; i < slices.length; i++) {
    const sl = slices[i];
    const im = sliceImm[i];
    if (im <= 0 || sl.r <= 0) continue;
    // velocidade do casco relativa à água (descontada a velocidade orbital das ondas)
    const vy = v + r * sl.x - (waveVel ? waveVel.vy[i] : 0);
    const vz = w - q * sl.x - (waveVel ? waveVel.vz[i] : 0);
    const vc = Math.sqrt(vy * vy + vz * vz);
    if (vc < 1e-9) continue;
    const k = -0.5 * rho * h.crossflowDrag * 2 * sl.r * sl.dx * im * vc;
    const fy = k * vy;
    const fz = k * vz;
    crossflow.F.y += fy;
    crossflow.F.z += fz;
    crossflow.M.y += -sl.x * fz;
    crossflow.M.z += sl.x * fy;
  }

  const lift = zeroWrench();
  const D = cfg.hull.diameter;
  const K = 0.5 * rho * D * D * h.bodyLiftCoeff * immFraction;
  const Zl = -K * u * w;
  const Yl = -K * u * v;
  lift.F.y = Yl;
  lift.F.z = Zl;
  lift.M.y = -h.bodyLiftXcp * Zl;
  lift.M.z = h.bodyLiftXcp * Yl;

  const damping = zeroWrench();
  const ld = h.linearDamping;
  damping.F.y = -ld.sway * v * immFraction;
  damping.F.z = -ld.heave * w * immFraction;
  damping.M.x = -(ld.roll * p + h.rollQuadDamping * p * Math.abs(p)) * Math.max(0.3, immFraction);
  damping.M.y = -ld.pitch * q * immFraction;
  damping.M.z = -ld.yaw * r * immFraction;
  // radiação de ondas (somente perto da superfície; simplificação linear)
  const sd = h.surfaceDamping;
  if (sd) {
    const fs = surfaceProximity(axisDepth, R) * (immFraction > 0 ? 1 : 0);
    if (fs > 1e-4) {
      damping.F.z -= sd.heave * fs * w;
      damping.M.y -= sd.pitch * fs * q;
      damping.M.x -= sd.roll * fs * p;
    }
  }
  return { resistance, crossflow, lift, damping };
}

export function liftCurveSlope(ar: number): number {
  return (2 * Math.PI * ar) / (2 + Math.sqrt(ar * ar + 4));
}

/** C_L(α) com estol suave; α em rad, já reduzido a [−π/2, π/2]. */
export function liftCoefficient(alpha: number, ar: number, stallDeg: number): number {
  const a = Math.abs(alpha);
  const as = stallDeg * DEG;
  const cla = liftCurveSlope(ar);
  const post = (x: number) => 0.9 * Math.sin(2 * x);
  let cl: number;
  if (a <= as) cl = cla * a;
  else if (a <= as + 8 * DEG) {
    const t = (a - as) / (8 * DEG);
    cl = cla * as * (1 - t) + post(a) * t;
  } else cl = post(a);
  return Math.sign(alpha) * cl;
}

export function dragCoefficient(alpha: number, cl: number, ar: number): number {
  const s = Math.sin(alpha);
  return 0.008 + (cl * cl) / (Math.PI * ar * 0.85) + 1.1 * s * s * (Math.abs(alpha) > 0.35 ? 1 : 0.15);
}

export interface FinResult extends Wrench {
  alpha: number; // rad (efetivo)
  lift: number; // N
  drag: number; // N
  speed2: number; // V_local²
}

/**
 * Força de uma superfície. deltaGeom em rad (convenção geométrica: rotação da
 * corda c = cos δ·eₓ − sin δ·n̂). immersion 0..1.
 */
export function finForce(fin: FinConfig, deltaGeom: number, vel: Vec3, omega: Vec3, rho: number, immersion: number): FinResult {
  const r = fin.position;
  const wr = vCross(omega, r);
  const vx = vel.x + wr.x;
  const vy = vel.y + wr.y;
  const vz = vel.z + wr.z;
  const horiz = fin.orientation === 'horizontal';
  const vn = horiz ? vz : vy;
  const V2 = vx * vx + vn * vn;
  const res: FinResult = { F: { x: 0, y: 0, z: 0 }, M: { x: 0, y: 0, z: 0 }, alpha: 0, lift: 0, drag: 0, speed2: V2 };
  if (V2 < 1e-8 || immersion <= 0) return res;
  const gamma = Math.atan2(vn, vx);
  let alpha = deltaGeom + gamma;
  // placa fina: simetria de 180°
  while (alpha > Math.PI / 2) alpha -= Math.PI;
  while (alpha < -Math.PI / 2) alpha += Math.PI;
  const reverse = vx < 0;
  const cl = liftCoefficient(alpha, fin.aspectRatio, fin.stallAngle) * (reverse ? 0.7 : 1);
  const cd = dragCoefficient(alpha, cl, fin.aspectRatio);
  const qd = 0.5 * rho * V2 * fin.area * immersion;
  const L = qd * cl;
  const D = qd * cd;
  const sg = Math.sin(gamma);
  const cg = Math.cos(gamma);
  // direção de sustentação l = sinγ·eₓ − cosγ·n̂ ; arrasto oposto à velocidade
  const fx = L * sg - D * cg;
  const fn = -L * cg - D * sg;
  const F = horiz ? { x: fx, y: 0, z: fn } : { x: fx, y: fn, z: 0 };
  res.F = F;
  res.M = vCross(r, F);
  res.alpha = alpha;
  res.lift = L;
  res.drag = D;
  return res;
}
