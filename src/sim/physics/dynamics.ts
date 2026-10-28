/**
 * DINÂMICA DE CORPO RÍGIDO EM 6 GRAUS DE LIBERDADE.
 *
 *   (M_RB + M_A)·ν̇ = τ_hidrostática + τ_hidrodinâmica + τ_lemes + τ_hélice
 *                     + τ_contato − C_RB(ν)·ν − C_A(ν)·ν
 *   η̇ = J(η)·ν      (posição NED: ṗ = R·v;  atitude: q̇ = ½·q ⊗ (0, ω))
 *
 *  ν = [u v w p q r] no corpo;  M_RB = diag(m, m, m, I_xx, I_yy, I_zz);
 *  M_A = diag(X_u̇, Y_v̇, Z_ẇ, K_ṗ, M_q̇, N_ṙ)  (massa adicional, ≥ 0).
 *
 *  Termos de Coriolis (lado direito):
 *    F = −m(ω × v) + a₁ × ω,             a₁ = (A₁₁u, A₂₂v, A₃₃w)
 *    M = −ω × (Iω) + k_Munk·(a₁ × v) + b₁ × ω,   b₁ = (A₄₄p, A₅₅q, A₆₆r)
 *  O termo a₁ × v contém o MOMENTO DE MUNK, M = (A₃₃ − A₁₁)·u·w (instabilizante).
 *
 *  Hidrostática: peso m·g no CG (vertical do mundo) e empuxo ρ·g·V_imerso no
 *  centro de carena B (ver hydrostatics.ts), com compressibilidade do casco.
 *
 * Integração: Runge–Kutta de 4ª ordem com passo fixo; massas e posições dos
 * lemes congeladas durante o passo (separação de operadores).
 *
 * Simplificações: CG tratado na origem para os termos inerciais (o desvio do
 * CG entra pelos momentos de peso); produtos de inércia desprezados; massa
 * adicional escalada pela fração imersa; sem correntes. Ondas entram pela
 * elevação local (empuxo) e por forças de inércia aproximadas (ver EQUACOES §14).
 */
import type { VesselConfig } from '../config/types';
import type { Environment } from '../environment/environment';
import {
  mulMat3TVec,
  mulMat3Vec,
  qDerivative,
  qNormalize,
  qToMat3,
  vCross,
  type Mat3,
  type Quat,
  type Vec3,
} from '../core/math';
import type { HullGeometry } from './hullGeometry';
import { computeHydrostatics, type HydrostaticResult } from './hydrostatics';
import { addWrench, finForce, hullForces, zeroWrench, type FinResult, type Wrench } from './hydrodynamics';
import type { MassProps } from './massProperties';

export interface BodyState {
  pos: Vec3;
  quat: Quat;
  vel: Vec3;
  omega: Vec3;
}

export interface AddedMass {
  X: number;
  Y: number;
  Z: number;
  K: number;
  M: number;
  N: number;
}

export interface ForceInputs {
  cfg: VesselConfig;
  geom: HullGeometry;
  env: Environment;
  mp: MassProps;
  added: AddedMass; // valores para imersão total
  finAngles: Record<string, number>; // rad, convenção geométrica
  thrust: number;
  propTorque: number;
  compressibleVolume: number; // m³ sujeito à compressão do casco
  sliceScratch: Float64Array;
  /** tempo de simulação (s) — ondas */
  t: number;
  /** deslocamento temporal do estágio RK4 */
  tStage?: number;
  /** cinemática das ondas pré-calculada para o passo (undefined = calcular aqui) */
  waveCache?: WaveCache | null;
  /** reação do lançamento de torpedo (corpo; ausente fora da ejeção) */
  launch?: Wrench;
}

export interface WaveCache {
  eta: Float64Array;
  vy: Float64Array;
  vz: Float64Array;
  ay: Float64Array;
  az: Float64Array;
  depth: Float64Array;
}
const SAMPLE = { eta: 0, vn: 0, ve: 0, vz: 0, an: 0, ae: 0, az: 0 };

/**
 * Elevação local e cinemática das ondas em cada fatia (referencial do corpo).
 * Calculada uma vez por passo (no instante médio) e reutilizada nos estágios
 * do RK4 — o casco se desloca poucos centímetros dentro de um passo.
 */
export function computeWaveCache(geom: HullGeometry, env: Environment, pos: Vec3, R: Mat3, t: number, diameter: number, reuse?: WaveCache | null): WaveCache | null {
  const wf = env.waves;
  if (!wf.active || pos.z > wf.cutoffDepth + diameter) return null;
  const nS = geom.slices.length;
  const wb: WaveCache = reuse && reuse.eta.length === nS ? reuse : { eta: new Float64Array(nS), vy: new Float64Array(nS), vz: new Float64Array(nS), ay: new Float64Array(nS), az: new Float64Array(nS), depth: new Float64Array(nS) };
  for (let i = 0; i < nS; i++) {
    const x = geom.slices[i].x;
    const n = pos.x + R[0] * x;
    const e = pos.y + R[3] * x;
    const zc = pos.z + R[6] * x;
    wf.sample(n, e, zc, t, SAMPLE);
    wb.eta[i] = SAMPLE.eta;
    wb.vy[i] = R[1] * SAMPLE.vn + R[4] * SAMPLE.ve + R[7] * SAMPLE.vz;
    wb.vz[i] = R[2] * SAMPLE.vn + R[5] * SAMPLE.ve + R[8] * SAMPLE.vz;
    wb.ay[i] = R[1] * SAMPLE.an + R[4] * SAMPLE.ae + R[7] * SAMPLE.az;
    wb.az[i] = R[2] * SAMPLE.an + R[5] * SAMPLE.ae + R[8] * SAMPLE.az;
    wb.depth[i] = zc + SAMPLE.eta;
  }
  return wb;
}
const WAVE_CA = 1.0; // massa adicional transversal de seção circular

export interface ForceBreakdown {
  weight: Wrench;
  buoyancy: Wrench;
  resistance: Wrench;
  crossflow: Wrench;
  bodyLift: Wrench;
  damping: Wrench;
  fins: Record<string, FinResult>;
  propeller: Wrench;
  contact: Wrench;
  coriolis: Wrench; // inclui Munk
  munk: Vec3; // momento de Munk isolado
  waves: Wrench; // forças de inércia das ondas (Froude–Krylov + difração simplificada)
  /** reação da ejeção de torpedo (zero fora do disparo) */
  launch: Wrench;
  total: Wrench;
  hs: HydrostaticResult;
  rho: number;
  buoyancyForce: number; // N (módulo)
  weightForce: number; // N
  displacedVolume: number; // m³ (com compressão)
  contactActive: boolean;
}

export function fullAddedMass(cfg: VesselConfig, geom: HullGeometry, rho: number): AddedMass {
  const a = cfg.hydro.addedMass;
  const m = rho * geom.volume;
  return {
    X: a.surge * m,
    Y: a.sway * m,
    Z: a.heave * m,
    K: a.rollInertia,
    M: a.pitchYaw * rho * geom.volumeInertiaYY,
    N: a.pitchYaw * rho * geom.volumeInertiaYY,
  };
}

function finImmersion(depth: number): number {
  return Math.max(0, Math.min(1, depth / 1.5 + 0.5));
}

/** Calcula todas as forças e momentos (corpo). */
export function computeForces(bs: BodyState, fi: ForceInputs): ForceBreakdown {
  const { cfg, geom, env, mp } = fi;
  const R: Mat3 = qToMat3(bs.quat);
  const g = env.cfg.gravity;
  const axisDepth = bs.pos.z;
  const rho = env.densityAt(Math.max(0, axisDepth));
  // ---- ondas: elevação local por fatia e cinemática orbital
  const wf = env.waves;
  const tt = fi.t + (fi.tStage ?? 0);
  const nS = geom.slices.length;
  const wb = fi.waveCache !== undefined ? fi.waveCache : computeWaveCache(geom, env, bs.pos, R, tt, cfg.hull.diameter);
  const hs = computeHydrostatics(geom, bs.pos, R, fi.sliceScratch, wb ? wb.eta : undefined);
  const dp = env.gaugePressureAt(Math.max(0, axisDepth));
  const displaced = Math.max(0, hs.volume - cfg.hull.compressibility * dp * fi.compressibleVolume * hs.immersedFraction);
  const imm = hs.immersedFraction;

  // --- peso e empuxo
  const weightForce = mp.mass * g;
  const buoyancyForce = rho * g * displaced;
  const Wb = mulMat3TVec(R, { x: 0, y: 0, z: weightForce });
  const Bb = mulMat3TVec(R, { x: 0, y: 0, z: -buoyancyForce });
  const weight: Wrench = { F: Wb, M: vCross(mp.cg, Wb) };
  const buoyancy: Wrench = { F: Bb, M: vCross(hs.center, Bb) };

  // --- casco
  const hf = hullForces(cfg, geom, bs.vel, bs.omega, rho, hs.sliceImmersion, imm, axisDepth, wb ? { vy: wb.vy, vz: wb.vz } : undefined);

  // --- forças de inércia das ondas por fatia: (C_FK + C_a)·ρ·A·dx·a_água (transversais)
  const waves = zeroWrench();
  if (wb) {
    const R0 = cfg.hull.diameter / 2;
    for (let i = 0; i < nS; i++) {
      const sl = geom.slices[i];
      const im = hs.sliceImmersion[i];
      if (im <= 0) continue;
      // Froude–Krylov dinâmico só para fatias totalmente submersas (na superfície já entra pela η local)
      const fk = Math.max(0, Math.min(1, (wb.depth[i] - sl.r) / R0));
      const m = rho * Math.PI * sl.r * sl.r * im * sl.dx * (WAVE_CA + fk);
      const fy = m * wb.ay[i];
      const fz = m * wb.az[i];
      waves.F.y += fy;
      waves.F.z += fz;
      waves.M.y += -sl.x * fz;
      waves.M.z += sl.x * fy;
    }
  }

  // --- superfícies
  const fins: Record<string, FinResult> = {};
  const finsTotal = zeroWrench();
  for (const f of cfg.fins) {
    const depth = bs.pos.z + R[6] * f.position.x + R[7] * f.position.y + R[8] * f.position.z;
    const etaF = wf.active && depth < 25 ? wf.elevation(bs.pos.x + R[0] * f.position.x, bs.pos.y + R[3] * f.position.x, tt) : 0;
    const fr = finForce(f, fi.finAngles[f.id] ?? 0, bs.vel, bs.omega, rho, finImmersion(depth + etaF));
    fins[f.id] = fr;
    addWrench(finsTotal, fr);
  }

  // --- hélice (empuxo no eixo; reação do torque em banda)
  const propeller: Wrench = {
    F: { x: fi.thrust, y: 0, z: 0 },
    M: { x: -fi.propTorque * cfg.hydro.propTorqueRollFactor, y: 0, z: 0 },
  };

  // --- contato com o fundo (molas-amortecedores em pontos da quilha)
  const contact = zeroWrench();
  let contactActive = false;
  const keel = [cfg.hull.length * 0.36, 0, -cfg.hull.length * 0.36];
  const vWorld = mulMat3Vec(R, bs.vel);
  for (const x of keel) {
    const rb: Vec3 = { x, y: 0, z: geom.radiusAt(x) };
    const pw = mulMat3Vec(R, rb);
    const zw = bs.pos.z + pw.z;
    const bottom = env.bottomDepthAt(bs.pos.x + pw.x, bs.pos.y + pw.y);
    const pen = zw - bottom;
    if (pen > 0) {
      contactActive = true;
      const wr = mulMat3Vec(R, vCross(bs.omega, rb));
      const vz = vWorld.z + wr.z;
      const vxh = vWorld.x + wr.x;
      const vyh = vWorld.y + wr.y;
      const fn = Math.max(0, cfg.contact.stiffness * pen + cfg.contact.damping * vz);
      const vh = Math.sqrt(vxh * vxh + vyh * vyh);
      const ff = (cfg.contact.friction * fn) / Math.max(vh, 0.05);
      const Fw: Vec3 = { x: -ff * vxh, y: -ff * vyh, z: -fn };
      const Fb = mulMat3TVec(R, Fw);
      contact.F.x += Fb.x;
      contact.F.y += Fb.y;
      contact.F.z += Fb.z;
      const Mb = vCross(rb, Fb);
      contact.M.x += Mb.x;
      contact.M.y += Mb.y;
      contact.M.z += Mb.z;
    }
  }

  // --- Coriolis e Munk
  const A = fi.added;
  const v = bs.vel;
  const w = bs.omega;
  const m = mp.mass;
  const I = mp.inertia;
  const a1: Vec3 = { x: A.X * imm * v.x, y: A.Y * imm * v.y, z: A.Z * imm * v.z };
  const b1: Vec3 = { x: A.K * imm * w.x, y: A.M * imm * w.y, z: A.N * imm * w.z };
  const Iw: Vec3 = { x: I.x * w.x, y: I.y * w.y, z: I.z * w.z };
  const wxv = vCross(w, v);
  // acoplamento translação–rotação da massa adicional: força a₁×ω e momento de Munk a₁×v.
  // O fator de Munk (redução viscosa) multiplica OS DOIS termos: o bloco fora da diagonal
  // de C_A continua antissimétrico e a potência v·F + ω·M desse par segue nula.
  const kM = cfg.hydro.munkFactor;
  const a1xwFull = vCross(a1, w);
  const a1xw: Vec3 = { x: a1xwFull.x * kM, y: a1xwFull.y * kM, z: a1xwFull.z * kM };
  const munkFull = vCross(a1, v);
  const munk: Vec3 = { x: munkFull.x * kM, y: munkFull.y * kM, z: munkFull.z * kM };
  const wxIw = vCross(w, Iw);
  const b1xw = vCross(b1, w);
  const coriolis: Wrench = {
    F: { x: -m * wxv.x + a1xw.x, y: -m * wxv.y + a1xw.y, z: -m * wxv.z + a1xw.z },
    M: { x: -wxIw.x + munk.x + b1xw.x, y: -wxIw.y + munk.y + b1xw.y, z: -wxIw.z + munk.z + b1xw.z },
  };

  const launch = fi.launch ?? zeroWrench();
  const total = zeroWrench();
  for (const c of [weight, buoyancy, hf.resistance, hf.crossflow, hf.lift, hf.damping, finsTotal, propeller, contact, coriolis, waves, launch]) addWrench(total, c);

  return {
    weight,
    buoyancy,
    resistance: hf.resistance,
    crossflow: hf.crossflow,
    bodyLift: hf.lift,
    damping: hf.damping,
    fins,
    propeller,
    contact,
    coriolis,
    munk,
    waves,
    launch,
    total,
    hs,
    rho,
    buoyancyForce,
    weightForce,
    displacedVolume: displaced,
    contactActive,
  };
}

interface Deriv {
  dpos: Vec3;
  dquat: Quat;
  dvel: Vec3;
  domega: Vec3;
}

function derivative(bs: BodyState, fi: ForceInputs): Deriv {
  const fb = computeForces(bs, fi);
  const imm = fb.hs.immersedFraction;
  const A = fi.added;
  const m = fi.mp.mass;
  const I = fi.mp.inertia;
  const R = qToMat3(bs.quat);
  return {
    dpos: mulMat3Vec(R, bs.vel),
    dquat: qDerivative(bs.quat, bs.omega),
    dvel: {
      x: fb.total.F.x / (m + A.X * imm),
      y: fb.total.F.y / (m + A.Y * imm),
      z: fb.total.F.z / (m + A.Z * imm),
    },
    domega: {
      x: fb.total.M.x / (I.x + A.K * imm),
      y: fb.total.M.y / (I.y + A.M * imm),
      z: fb.total.M.z / (I.z + A.N * imm),
    },
  };
}

function addScaled(bs: BodyState, d: Deriv, h: number): BodyState {
  return {
    pos: { x: bs.pos.x + d.dpos.x * h, y: bs.pos.y + d.dpos.y * h, z: bs.pos.z + d.dpos.z * h },
    quat: qNormalize({
      w: bs.quat.w + d.dquat.w * h,
      x: bs.quat.x + d.dquat.x * h,
      y: bs.quat.y + d.dquat.y * h,
      z: bs.quat.z + d.dquat.z * h,
    }),
    vel: { x: bs.vel.x + d.dvel.x * h, y: bs.vel.y + d.dvel.y * h, z: bs.vel.z + d.dvel.z * h },
    omega: { x: bs.omega.x + d.domega.x * h, y: bs.omega.y + d.domega.y * h, z: bs.omega.z + d.domega.z * h },
  };
}

/** Um passo RK4 do corpo rígido. */
export function rk4Step(bs: BodyState, fi: ForceInputs, dt: number): BodyState {
  fi.tStage = 0;
  const k1 = derivative(bs, fi);
  fi.tStage = dt / 2;
  const k2 = derivative(addScaled(bs, k1, dt / 2), fi);
  const k3 = derivative(addScaled(bs, k2, dt / 2), fi);
  fi.tStage = dt;
  const k4 = derivative(addScaled(bs, k3, dt), fi);
  fi.tStage = 0;
  const comb = <T extends Vec3>(a: T, b: T, c: T, d: T): Vec3 => ({
    x: (a.x + 2 * b.x + 2 * c.x + d.x) / 6,
    y: (a.y + 2 * b.y + 2 * c.y + d.y) / 6,
    z: (a.z + 2 * b.z + 2 * c.z + d.z) / 6,
  });
  const dq: Quat = {
    w: (k1.dquat.w + 2 * k2.dquat.w + 2 * k3.dquat.w + k4.dquat.w) / 6,
    x: (k1.dquat.x + 2 * k2.dquat.x + 2 * k3.dquat.x + k4.dquat.x) / 6,
    y: (k1.dquat.y + 2 * k2.dquat.y + 2 * k3.dquat.y + k4.dquat.y) / 6,
    z: (k1.dquat.z + 2 * k2.dquat.z + 2 * k3.dquat.z + k4.dquat.z) / 6,
  };
  return addScaled(bs, { dpos: comb(k1.dpos, k2.dpos, k3.dpos, k4.dpos), dquat: dq, dvel: comb(k1.dvel, k2.dvel, k3.dvel, k4.dvel), domega: comb(k1.domega, k2.domega, k3.domega, k4.domega) }, dt);
}
