/**
 * SISTEMA DE LASTRO PRINCIPAL (TLP) — tanques de alagamento livre.
 *
 * Cada tanque possui embornais de fundo sempre abertos, válvula de suspiro no
 * topo e válvula de sopro alimentada pelo coletor de ar de alta pressão (AP).
 * Estado: volume de água V_w e massa de ar m_a (gás ideal, isotérmico à
 * temperatura do mar).
 *
 *   p_ar = m_a·R·T / (V_t − V_w)
 *   Δp_emb = p_ext(z_emb) − p_ar − ρ·g·h,   h = V_w / A_h
 *   Q_água = C_d·A_emb·√(2|Δp|/ρ)·sign(Δp)          (regularizada perto de 0)
 *
 * A água é integrada de forma IMPLÍCITA (Euler implícito, raiz por bissecção),
 * pois a compressão do colchão de ar torna o problema rígido; o ar é integrado
 * explicitamente com limites que impedem ultrapassar o equilíbrio:
 *
 *   ṁ_suspiro = C_d·A_s·Φ(p_ar, p_ext(z_susp))       (orifício compressível)
 *   ṁ_sopro   = C_d·A_b·Φ(p_coletor, p_ar)
 *
 * Consequências físicas emergentes: alagamento limitado pela saída de ar
 * pelo suspiro; colchão de ar comprimido com a profundidade (tanque
 * parcialmente soprado perde empuxo ao descer); expansão do ar na subida
 * (expulsa mais água); excesso de sopro escapa pelos embornais.
 */
import type { BallastTankConfig } from '../config/types';
import type { BallastTankState } from '../core/state';
import { GAMMA_AIR, R_AIR, type StepContext } from '../core/context';
import { bisectIncreasing, regSqrt } from '../core/math';
import { updateValve } from './components';

const CD_WATER = 0.62;
const CD_GAS = 0.8;

/** Fluxo mássico por unidade de área (kg/s/m²) de um orifício compressível. */
export function gasMassFlux(pUp: number, pDown: number, T: number): number {
  if (pUp <= pDown || pUp <= 0) return 0;
  const g = GAMMA_AIR;
  const r = pDown / pUp;
  const rCrit = Math.pow(2 / (g + 1), g / (g - 1)); // 0,528
  if (r <= rCrit) {
    return pUp * Math.sqrt(g / (R_AIR * T)) * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
  }
  // subsônico; regularização linear para r → 1
  const rr = Math.min(r, 0.9995);
  const f = pUp * Math.sqrt(((2 * g) / ((g - 1) * R_AIR * T)) * (Math.pow(rr, 2 / g) - Math.pow(rr, (g + 1) / g)));
  if (r > 0.9995) return (f * (1 - r)) / (1 - 0.9995);
  return f;
}

export interface BallastStepResult {
  airDrawn: number; // kg retirados do coletor AP neste passo
  emergencyAirDrawn: number; // kg retirados do coletor dedicado de emergência
  airVented: number; // kg ao mar pelo suspiro
  airSpilled: number; // kg ao mar pelos embornais
  valveStrokes: number; // fração de curso percorrida (consumo hidráulico)
}

export function tankPortDepth(cfg: BallastTankConfig, ctx: StepContext): number {
  return ctx.depthOf({ x: cfg.center.x, y: cfg.center.y, z: cfg.center.z + cfg.height / 2 });
}

export function tankVentDepth(cfg: BallastTankConfig, ctx: StepContext): number {
  return ctx.depthOf({ x: cfg.center.x, y: cfg.center.y, z: cfg.center.z - cfg.height / 2 });
}

export function updateBallastTank(
  cfg: BallastTankConfig,
  st: BallastTankState,
  ctx: StepContext,
  manifoldPressure: number,
  bankTempK: number,
  emergencyPressure = 0,
  normalAvailable = Infinity,
  emergencyAvailable = Infinity,
): BallastStepResult {
  const dt = ctx.dt;
  const g = ctx.env.cfg.gravity;
  const pAtm = ctx.env.cfg.atmosphericPressure;
  const strokes =
    updateValve(cfg.ventValve, st.vent, dt, ctx.hydraulicFactor > 0) +
    updateValve(cfg.blowValve, st.blow, dt, ctx.hydraulicFactor > 0) +
    updateValve(cfg.emergencyBlowValve, st.emergencyBlow, dt, ctx.hydraulicFactor > 0);

  const Vt = cfg.volume;
  const Ah = cfg.volume / cfg.height;
  const T = ctx.seaTempK;
  const zPort = tankPortDepth(cfg, ctx);
  const zVent = tankVentDepth(cfg, ctx);
  const rho = ctx.env.densityAt(Math.max(0, zPort));
  const pPort = ctx.env.pressureAt(zPort);
  const pVentExt = ctx.env.pressureAt(zVent);
  const flowK = CD_WATER * cfg.floodArea * Math.sqrt(2 / rho);
  const Vold = st.water;
  let mAir = st.air;
  let spilled = 0;

  const pAirOf = (V: number): number => {
    const va = Vt - V;
    if (mAir <= 0) return 0;
    return (mAir * R_AIR * T) / Math.max(va, 1e-7);
  };

  let Vnew: number;
  if (zPort <= 0) {
    // embornais fora d'água: água escoa para fora por gravidade, ar atmosférico entra.
    const h = Vold / Ah;
    const q = flowK * Math.sqrt(Math.max(0, rho * g * h));
    Vnew = Math.max(0, Vold - q * dt);
    // ar atmosférico entra pelos embornais emersos (origem modelada: atmosfera)
    const mFill = (pAtm * (Vt - Vnew)) / (R_AIR * T);
    if (mFill > mAir) {
      spilled -= mFill - mAir;
      mAir = mFill;
    }
    if (pAirOf(Vnew) > pAtm) {
      const mMax = (pAtm * (Vt - Vnew)) / (R_AIR * T);
      if (mAir > mMax) {
        spilled += mAir - mMax;
        mAir = mMax;
      }
    }
  } else {
    const dpOf = (V: number) => pPort - pAirOf(V) - rho * g * (V / Ah);
    const F = (V: number) => V - Vold - dt * flowK * regSqrt(dpOf(V), 200);
    const hi = mAir > 0 ? Vt * (1 - 1e-9) : Vt;
    Vnew = bisectIncreasing(F, 0, hi, 50);
  }

  // ---- ar: suspiro (saída) e sopro (entrada)
  let pAir = pAirOf(Vnew);
  const va = Math.max(Vt - Vnew, 1e-7);
  let vented = 0;
  const ventA = st.vent.pos * cfg.ventArea + st.ventLeak;
  if (ventA > 0 && mAir > 0 && pAir > pVentExt) {
    const mdot = CD_GAS * ventA * gasMassFlux(pAir, pVentExt, T);
    const mLimit = Math.max(0, mAir - (pVentExt * va) / (R_AIR * T));
    vented = Math.min(mdot * dt, mLimit);
    mAir -= vented;
  }
  let drawn = 0;
  const blowA = st.blow.pos * cfg.blowArea;
  pAir = pAirOf(Vnew);
  if (blowA > 0 && manifoldPressure > pAir) {
    const mdot = CD_GAS * blowA * gasMassFlux(manifoldPressure, Math.max(pAir, pAtm * 0.2), bankTempK);
    const mLimit = Math.max(0, (manifoldPressure * va) / (R_AIR * T) - mAir);
    drawn = Math.min(mdot * dt, mLimit, Math.max(0, normalAvailable));
    mAir += drawn;
  }
  let emergencyDrawn = 0;
  pAir = pAirOf(Vnew);
  const emergencyA = st.emergencyBlow.pos * cfg.blowArea;
  if (emergencyA > 0 && emergencyPressure > pAir) {
    const mdot = CD_GAS * emergencyA * gasMassFlux(emergencyPressure, Math.max(pAir, pAtm * 0.2), bankTempK);
    const mLimit = Math.max(0, (emergencyPressure * va) / (R_AIR * T) - mAir);
    emergencyDrawn = Math.min(mdot * dt, mLimit, Math.max(0, emergencyAvailable));
    mAir += emergencyDrawn;
  }
  // ---- tanque vazio: excesso de ar escapa pelos embornais
  if (zPort > 0 && Vnew <= 1e-6) {
    Vnew = 0;
    const mMax = (pPort * Vt) / (R_AIR * T);
    if (mAir > mMax) {
      spilled += mAir - mMax;
      mAir = mMax;
    }
  }

  st.qWater = (Vnew - Vold) / dt;
  st.water = Vnew;
  st.air = Math.max(0, mAir);
  st.mdotVent = vented / dt;
  st.mdotBlow = drawn / dt;
  st.mdotEmergencyBlow = emergencyDrawn / dt;
  st.mdotSpill = spilled / dt;
  st.pAir = st.air > 0 ? (st.air * R_AIR * T) / Math.max(Vt - Vnew, 1e-7) : 0;
  st.pExtPort = pPort;
  return { airDrawn: drawn, emergencyAirDrawn: emergencyDrawn, airVented: vented, airSpilled: spilled, valveStrokes: strokes };
}

/** Volume do colchão de ar (m³). */
export function ballastAirVolume(cfg: BallastTankConfig, st: BallastTankState): number {
  return Math.max(0, cfg.volume - st.water);
}

export type BallastFillStatus = 'CHEIO' | 'VAZIO' | 'PARCIAL' | 'ALAGANDO' | 'ESGOTANDO';

export function ballastFillStatus(cfg: BallastTankConfig, st: BallastTankState): BallastFillStatus {
  const f = st.water / cfg.volume;
  if (st.qWater > 0.02) return 'ALAGANDO';
  if (st.qWater < -0.02) return 'ESGOTANDO';
  if (f > 0.985) return 'CHEIO';
  if (f < 0.015) return 'VAZIO';
  return 'PARCIAL';
}
