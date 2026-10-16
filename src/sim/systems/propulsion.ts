/**
 * PROPULSÃO DIESEL-ELÉTRICA (simplificada).
 *
 * Motor elétrico principal (MEP) com controle de velocidade PI, limitado por
 * torque máximo e por potência (nominal e disponível no barramento):
 *
 *   I_eixo·dω/dt = Q_motor − Q_hélice − c·ω
 *
 * Hélice de passo fixo — modelo de 4 quadrantes simplificado com K_T e K_Q
 * lineares em J = u_a/(n·D), u_a = u·(1 − w):
 *
 *   T = ρ·D⁴·K_T0·(n|n| − |n|·u_a/(D·J0T))      (empuxo)
 *   Q = ρ·D⁵·K_Q0·(n|n| − |n|·u_a/(D·J0Q))      (torque)
 *   Empuxo efetivo no casco = T·(1 − t)           (dedução de empuxo)
 *
 * P_mecânica = Q_motor·ω;  P_elétrica = P_mec/η + perdas em vazio.
 * Sem regeneração: potência mecânica negativa é dissipada (resistor de frenagem).
 */
import type { PropulsionConfig } from '../config/types';
import type { PropulsionState } from '../core/state';
import { clamp, rateLimit } from '../core/math';

export interface PropellerForces {
  thrust: number; // N (efetivo no casco)
  torque: number; // N·m absorvido pelo hélice
  J: number;
}

export function propellerForces(cfg: PropulsionConfig, omega: number, u: number, rho: number, immersion: number): PropellerForces {
  const p = cfg.propeller;
  const n = omega / (2 * Math.PI);
  const D = p.diameter;
  const ua = u * (1 - p.wakeFraction);
  const an = Math.abs(n);
  let T = rho * D ** 4 * p.KT0 * (n * an - (an * ua) / (D * p.J0T));
  let Q = rho * D ** 5 * p.KQ0 * (n * an - (an * ua) / (D * p.J0Q));
  if (n < 0) {
    T *= p.reverseFactor;
  }
  // hélice parcialmente emerso (superfície com caturro): perda de empuxo
  T *= immersion;
  Q *= immersion;
  const J = an > 1e-3 ? ua / (an * D) : 0;
  return { thrust: T * (1 - p.thrustDeduction), torque: Q, J };
}

export function updatePropulsion(
  cfg: PropulsionConfig,
  st: PropulsionState,
  dt: number,
  u: number,
  rho: number,
  powered: boolean,
  powerAvailable: number,
  propImmersion: number,
): void {
  const m = cfg.motor;
  const omegaRated = (m.ratedRpm * 2 * Math.PI) / 60;
  st.rpmCmd = clamp(st.rpmCmd, -m.ratedRpm, m.ratedRpm);
  st.rpmRef = rateLimit(st.rpmRef, st.rpmCmd, m.rpmRampRate, dt);
  const omegaRef = (st.rpmRef * 2 * Math.PI) / 60;

  const prop = propellerForces(cfg, st.omega, u, rho, propImmersion);
  let Qm = 0;
  st.powerLimited = false;
  if (powered && !st.failed) {
    const err = omegaRef - st.omega;
    const qUnsat = m.speedKp * err + st.integ;
    const pLimit = Math.max(0, Math.min(m.ratedPower, powerAvailable * m.efficiency));
    const absW = Math.max(Math.abs(st.omega), 0.05 * omegaRated);
    const qPowerLim = pLimit / absW;
    const qLim = Math.min(m.maxTorque, qPowerLim);
    Qm = clamp(qUnsat, -qLim, qLim);
    if (qPowerLim < m.maxTorque && Math.abs(qUnsat) > qPowerLim) st.powerLimited = true;
    // anti-windup: integra apenas se não saturado ou se o erro reduz a saturação
    if (Qm === qUnsat || Math.sign(err) !== Math.sign(qUnsat)) st.integ += m.speedKi * err * dt;
    st.integ = clamp(st.integ, -m.maxTorque, m.maxTorque);
  } else {
    st.integ = 0;
  }
  const dOmega = (Qm - prop.torque - m.friction * st.omega) / m.inertia;
  st.omega += dOmega * dt;
  st.shaftAngle = (st.shaftAngle + st.omega * dt) % (2 * Math.PI * 1000);
  st.motorTorque = Qm;
  st.propTorque = prop.torque;
  st.thrust = prop.thrust;
  st.advance = prop.J;
  st.shaftPower = Qm * st.omega;
  const noLoad = powered && !st.failed ? m.noLoadLoss * Math.min(1, Math.abs(st.omega) / omegaRated) : 0;
  st.elecPower = Math.max(0, st.shaftPower) / m.efficiency + noLoad;
}

export const shaftRpm = (st: PropulsionState) => (st.omega * 60) / (2 * Math.PI);
