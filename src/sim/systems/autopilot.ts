/**
 * CONTROLE AUTOMÁTICO CONCEITUAL (PID) — manutenção de rumo, profundidade e
 * atitude, respeitando as limitações do modelo (batentes dos lemes,
 * velocidade dos atuadores e efetividade ∝ U²).
 *
 * Rumo:          δ_r = K·[Kp·e_ψ + Ki·∫e_ψ − Kd·r]
 * Profundidade (cascata):
 *    θ_cmd  = clamp(Kz·e_z + Kzd·ż, ±θ_max)        (e_z = z − z_ref; + ⇒ subir)
 *    δ_ré   = K·[Kθ·(θ_cmd − θ) + Ki·∫(θ_cmd − θ) − Kq·q]
 *    δ_vante= K·[Kb·e_z + Kbd·ż]
 * Atitude:       δ_ré = K·[Kθ·(θ_ref − θ) + Ki·∫ − Kq·q]
 *
 * K = escalonamento de ganho com a velocidade: (U₀/U)², limitado a 4×,
 * pois a força dos lemes cresce com U². Abaixo de ~1 m/s os lemes perdem
 * efetividade e o controlador indica "BAIXA EFETIVIDADE": a profundidade
 * passa a depender do equilíbrio estático (compensação).
 *
 * Os controladores usam apenas as LEITURAS DOS SENSORES (não o estado real).
 * Anti-windup por integração condicional; transferência sem salto (bumpless)
 * ao entrar em AUTO.
 */
import type { VesselConfig } from '../config/types';
import type { PidTelemetry, SimState } from '../core/state';
import { clamp, wrapPi, DEG, RAD } from '../core/math';

const U0 = 4.0; // m/s — velocidade de referência das sintonias

export const AP_GAINS = {
  heading: { kp: 2.2, ki: 0.04, kd: 25 },
  depthOuter: { kz: 0.7, kzi: 0.006, kzd: 12, thetaMax: 8 },
  pitch: { kp: 2.5, ki: 0.06, kq: 30 },
  bow: { kb: 1.0, kbd: 20 },
  /** autoridade máxima do piloto sobre os lemes (graus) — abaixo do ângulo de estol */
  authority: 20,
};

export interface ApReadings {
  heading: number; // graus
  yawRate: number; // graus/s
  depth: number; // m
  depthRate: number; // m/s (+ descendo)
  pitch: number; // graus
  pitchRate: number; // graus/s
  speed: number; // m/s
}

function schedule(speed: number): { k: number; low: boolean } {
  const U = Math.max(Math.abs(speed), 0.2);
  return { k: Math.min(4, (U0 / U) ** 2), low: Math.abs(speed) < 1.5 };
}

function telemetry(t: PidTelemetry, sp: number, meas: number, err: number, p: number, i: number, d: number, out: number, sat: boolean, low: boolean) {
  t.setpoint = sp;
  t.measured = meas;
  t.error = err;
  t.p = p;
  t.i = i;
  t.d = d;
  t.output = out;
  t.saturated = sat;
  t.lowEffectiveness = low;
}

export function updateAutopilot(cfg: VesselConfig, s: SimState, r: ApReadings, dt: number): void {
  const ap = s.autopilot;
  const sch = schedule(r.speed);
  const rudder = cfg.fins.find((f) => f.id === 'rudder')!;
  const stern = cfg.fins.find((f) => f.id === 'stern')!;
  const bow = cfg.fins.find((f) => f.id === 'bow')!;
  const dirSign = r.speed >= 0 ? 1 : -1; // em marcha a ré a ação dos lemes se inverte

  if (ap.headingMode === 'AUTO') {
    const g = AP_GAINS.heading;
    const e = wrapPi((ap.headingSet - r.heading) * DEG) * RAD;
    const p = g.kp * e;
    const d = -g.kd * r.yawRate;
    let out = sch.k * dirSign * (p + ap.iHeading + d);
    const lim = Math.min(rudder.maxDeflection, AP_GAINS.authority + 5);
    const sat = Math.abs(out) >= lim;
    if (!sat || Math.sign(e) !== Math.sign(out)) ap.iHeading = clamp(ap.iHeading + g.ki * e * dt, -10, 10);
    out = clamp(out, -lim, lim);
    s.surfaces.rudder.cmd = out;
    telemetry(ap.tHeading, ap.headingSet, r.heading, e, p, ap.iHeading, d, out, sat, sch.low);
  }

  let thetaCmd: number | null = null;
  if (ap.depthMode === 'AUTO') {
    const g = AP_GAINS.depthOuter;
    const ez = r.depth - ap.depthSet;
    const unsat = g.kz * ez + ap.iDepth + g.kzd * r.depthRate;
    thetaCmd = clamp(unsat, -g.thetaMax, g.thetaMax);
    const satZ = Math.abs(unsat) >= g.thetaMax;
    // integral apenas perto da cota (evita acúmulo durante grandes mudanças)
    if (!satZ && Math.abs(ez) < 15) ap.iDepth = clamp(ap.iDepth + g.kzi * ez * dt, -4, 4);
    telemetry(ap.tDepth, ap.depthSet, r.depth, ez, g.kz * ez, ap.iDepth, g.kzd * r.depthRate, thetaCmd, satZ, sch.low);
    // lemes de vante: ação direta sobre o movimento vertical
    const gb = AP_GAINS.bow;
    let ob = sch.k * dirSign * (gb.kb * ez + gb.kbd * r.depthRate);
    const limB = Math.min(bow.maxDeflection, AP_GAINS.authority);
    const satB = Math.abs(ob) >= limB;
    ob = clamp(ob, -limB, limB);
    s.surfaces.bow.cmd = ob;
    telemetry(ap.tBow, ap.depthSet, r.depth, ez, gb.kb * ez, 0, gb.kbd * r.depthRate, ob, satB, sch.low);
  } else if (ap.pitchMode === 'AUTO') {
    thetaCmd = ap.pitchSet;
  }

  if (thetaCmd !== null) {
    const g = AP_GAINS.pitch;
    const e = thetaCmd - r.pitch;
    const p = g.kp * e;
    const d = -g.kq * r.pitchRate;
    let out = sch.k * dirSign * (p + ap.iPitch + d);
    const lim = Math.min(stern.maxDeflection, AP_GAINS.authority);
    const sat = Math.abs(out) >= lim;
    if (!sat || Math.sign(e) !== Math.sign(out)) ap.iPitch = clamp(ap.iPitch + g.ki * e * dt, -12, 12);
    out = clamp(out, -lim, lim);
    s.surfaces.stern.cmd = out;
    telemetry(ap.tPitch, thetaCmd, r.pitch, e, p, ap.iPitch, d, out, sat, sch.low);
  }
}

/** Inicialização sem salto ao comutar para AUTO. */
export function bumplessInit(s: SimState, channel: 'heading' | 'depth' | 'pitch', r: ApReadings): void {
  const ap = s.autopilot;
  const sch = schedule(r.speed);
  if (channel === 'heading') {
    ap.headingSet = r.heading;
    ap.iHeading = clamp(s.surfaces.rudder.cmd / sch.k, -10, 10);
  } else if (channel === 'depth') {
    ap.depthSet = Math.round(r.depth);
    ap.iDepth = 0;
    ap.iPitch = clamp(s.surfaces.stern.cmd / sch.k, -12, 12);
  } else {
    ap.pitchSet = Math.round(r.pitch * 2) / 2;
    ap.iPitch = clamp(s.surfaces.stern.cmd / sch.k, -12, 12);
  }
}
