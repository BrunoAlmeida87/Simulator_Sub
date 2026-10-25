/**
 * CONTROLE AUTOMÁTICO CONCEITUAL (PID) — manutenção de rumo, profundidade e
 * atitude, respeitando as limitações do modelo (batentes dos lemes,
 * velocidade dos atuadores e efetividade ∝ U²).
 *
 * Rumo:          δ_r = K·[Kp·e_ψ + Ki·∫e_ψ − Kd·r]
 * Profundidade (cascata — os LEMES DE RÉ fazem a mudança de cota):
 *    θ_cmd  = clamp(Kz·e_z + Ki·∫e_z + Kzd·ż, ±θ_max)   (e_z = z − z_ref; + ⇒ subir)
 *    δ_ré   = K·[Kθ·(θ_cmd − θ) + Ki·∫(θ_cmd − θ) − Kq·q]
 * Lemes de vante (vela) — só AJUSTE FINO da cota, com autoridade reduzida:
 *    δ_vante = K·[Kb·sat(e_z, ±b)·max(w, a) + Kbd·ż·w],   |δ_vante| ≤ δ_v,max (10°)
 *    w = 1 até |e_z| = b e cai linearmente a 0 em |e_z| = b + f (perto da cota);
 *    a = pequena ajuda constante durante a travessia (≈ 3,5° a 6 nós).
 * Atitude:       δ_ré = K·[Kθ·(θ_ref − θ) + Ki·∫ − Kq·q]
 *
 * Por que assim: os lemes de ré (21 m² a 31,5 m do centro) têm momento de
 * caturro ~6× maior que os de vela (11 m² a 10,5 m) — são eles que dão o
 * ângulo, e o ângulo (sustentação do casco) é que leva o submarino à nova cota.
 * Os lemes de vela geram força vertical direta, pequena e sem atraso: servem
 * para corrigir pequenos erros e frear a chegada na cota (cota periscópica).
 *
 * Alocação a baixa velocidade: perto da velocidade crítica dos lemes de ré
 * (~3 nós neste modelo) a força direta desses lemes anula a sustentação que
 * o ângulo produz no casco e eles deixam de mudar a cota. Entre lowSpeed.uHi
 * (~3,9 nós) e lowSpeed.uLo (~3,1 nós) a fração L = 0 → 1 passa a cota para
 * os lemes de vela: Kb·(1 + L), a → 1, δ_v,max → 20° e θ_max → θ_max,baixa.
 *
 * K = escalonamento de ganho com a velocidade: (U₀/U)², limitado a 4×,
 * pois a força dos lemes cresce com U². Abaixo de ~1,5 m/s os lemes perdem
 * efetividade e o controlador indica "BAIXA EFETIVIDADE": a profundidade
 * passa a depender do equilíbrio estático (compensação).
 *
 * Os controladores usam apenas as LEITURAS DOS SENSORES (não o estado real).
 * Anti-windup por integração condicional (o integral de profundidade só atua
 * perto da cota, para não acumular durante a travessia); transferência sem
 * salto (bumpless) ao entrar em AUTO.
 */
import type { VesselConfig } from '../config/types';
import type { PidTelemetry, SimState } from '../core/state';
import { clamp, wrapPi, DEG, RAD } from '../core/math';

const U0 = 4.0; // m/s — velocidade de referência das sintonias

export const AP_GAINS = {
  heading: { kp: 2.2, ki: 0.04, kd: 25 },
  /** malha externa: erro de profundidade (m) → pitch ordenado (°), executado pelos lemes de ré */
  depthOuter: { kz: 1.0, kzi: 0.01, kzd: 10, thetaMax: 10.5, thetaMaxLow: 4, iBand: 3 },
  /** malha interna (lemes de ré): erro de pitch (°) → ângulo dos lemes */
  pitch: { kp: 2.5, ki: 0.06, kq: 30 },
  /**
   * lemes de vante (vela): ajuste fino. band/fade em m (faixa perto da cota),
   * assist = fração do termo proporcional mantida na travessia, authority em graus
   */
  bow: { kb: 1.0, kbd: 10, band: 3, fade: 5, assist: 0.7, authority: 10 },
  /** velocidades (m/s) entre as quais a alocação passa dos lemes de ré para os de vela */
  lowSpeed: { uLo: 1.6, uHi: 2.0 },
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

/**
 * Sinal da malha externa de profundidade: ż ≈ −u·sen θ, então em marcha a ré a
 * proa para cima APROFUNDA e o pitch ordenado se inverte. Avante vale 1; entre
 * 0 e −0,5 m/s passa continuamente a −1 (perto de zero, pitch ordenado ≈ 0).
 */
export function depthPitchSign(speed: number): number {
  return speed >= 0 ? 1 : clamp(1 + speed / 0.25, -1, 1);
}

/** Pitch ordenado pela malha externa de profundidade (graus) e se saturou. */
function depthOuterCommand(ez: number, iDepth: number, depthRate: number, speed: number): { theta: number; unsat: number; thMax: number } {
  const g = AP_GAINS.depthOuter;
  const low = lowSpeedShare(speed);
  const thMax = g.thetaMax + low * (g.thetaMaxLow - g.thetaMax);
  const unsat = g.kz * ez + iDepth + g.kzd * depthRate;
  return { theta: clamp(depthPitchSign(speed) * unsat, -thMax, thMax), unsat, thMax };
}

/** 0 em velocidade normal (lemes de ré principais) → 1 abaixo de lowSpeed.uLo (lemes de vela principais). */
export function lowSpeedShare(speed: number): number {
  const { uLo, uHi } = AP_GAINS.lowSpeed;
  return clamp((uHi - Math.abs(speed)) / Math.max(1e-6, uHi - uLo), 0, 1);
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
    // anti-windup na coordenada do controlador (antes da inversão de ré)
    if (!sat || Math.sign(e) !== Math.sign(out) * dirSign) ap.iHeading = clamp(ap.iHeading + g.ki * e * dt, -10, 10);
    out = clamp(out, -lim, lim);
    s.surfaces.rudder.cmd = out;
    telemetry(ap.tHeading, ap.headingSet, r.heading, e, p, ap.iHeading, d, out, sat, sch.low);
  }

  let thetaCmd: number | null = null;
  if (ap.depthMode === 'AUTO') {
    const g = AP_GAINS.depthOuter;
    const low = lowSpeedShare(r.speed);
    const ez = r.depth - ap.depthSet;
    // malha externa → pitch ordenado (lemes de ré); menor a baixa velocidade; invertido em ré
    const oc = depthOuterCommand(ez, ap.iDepth, r.depthRate, r.speed);
    thetaCmd = oc.theta;
    const satZ = Math.abs(oc.unsat) >= oc.thMax;
    // integral apenas perto da cota (evita acúmulo durante a travessia e a aproximação)
    if (!satZ && Math.abs(ez) < g.iBand) ap.iDepth = clamp(ap.iDepth + g.kzi * ez * dt, -4, 4);
    telemetry(ap.tDepth, ap.depthSet, r.depth, ez, g.kz * ez, ap.iDepth, g.kzd * r.depthRate, thetaCmd, satZ, sch.low);
    // lemes de vante (vela): ajuste fino perto da cota; na travessia, só uma pequena ajuda
    const gb = AP_GAINS.bow;
    const aez = Math.abs(ez);
    const near = aez <= gb.band ? 1 : aez >= gb.band + gb.fade ? 0 : 1 - (aez - gb.band) / gb.fade;
    const assist = gb.assist + low * (1 - gb.assist);
    const pB = gb.kb * (1 + low) * clamp(ez, -gb.band, gb.band) * Math.max(near, assist);
    const dB = gb.kbd * r.depthRate * near;
    let ob = sch.k * dirSign * (pB + dB);
    const limB = Math.min(bow.maxDeflection, gb.authority + low * (AP_GAINS.authority - gb.authority));
    const satB = Math.abs(ob) >= limB;
    ob = clamp(ob, -limB, limB);
    s.surfaces.bow.cmd = ob;
    telemetry(ap.tBow, ap.depthSet, r.depth, ez, pB, 0, dB, ob, satB, sch.low);
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
    if (!sat || Math.sign(e) !== Math.sign(out) * dirSign) ap.iPitch = clamp(ap.iPitch + g.ki * e * dt, -12, 12);
    out = clamp(out, -lim, lim);
    s.surfaces.stern.cmd = out;
    telemetry(ap.tPitch, thetaCmd, r.pitch, e, p, ap.iPitch, d, out, sat, sch.low);
  }
}

/**
 * Inicialização sem salto ao comutar para AUTO: a integral recebe o valor que
 * reproduz o comando atual do leme, contando os termos P e D, o sinal de ré e,
 * na profundidade, o pitch ordenado pela malha externa. Se o limite da
 * integral impedir, o comando muda o mínimo possível.
 */
export function bumplessInit(s: SimState, channel: 'heading' | 'depth' | 'pitch', r: ApReadings): void {
  const ap = s.autopilot;
  const sch = schedule(r.speed);
  const dirSign = r.speed >= 0 ? 1 : -1;
  // integral que faz k·dirSign·(p + i + d) = comando atual
  const iFor = (cmd: number, pd: number, lim: number) => clamp(cmd / (sch.k * dirSign) - pd, -lim, lim);
  const innerPitch = (thetaCmd: number) => {
    const g = AP_GAINS.pitch;
    ap.iPitch = iFor(s.surfaces.stern.cmd, g.kp * (thetaCmd - r.pitch) - g.kq * r.pitchRate, 12);
  };
  if (channel === 'heading') {
    ap.headingSet = r.heading;
    ap.iHeading = iFor(s.surfaces.rudder.cmd, -AP_GAINS.heading.kd * r.yawRate, 10);
  } else if (channel === 'depth') {
    ap.depthSet = Math.round(r.depth);
    ap.iDepth = 0;
    innerPitch(depthOuterCommand(r.depth - ap.depthSet, 0, r.depthRate, r.speed).theta);
  } else {
    ap.pitchSet = Math.round(r.pitch * 2) / 2;
    innerPitch(ap.pitchSet);
  }
}
