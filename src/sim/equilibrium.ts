/**
 * CÁLCULOS DE EQUILÍBRIO (ferramentas de engenharia / preparação de cenários).
 *
 * 1) Compensação para flutuabilidade neutra submersa (o "cálculo de
 *    compensação" feito antes de mergulhar):
 *      M_req = ρ(z)·V_desl(z)                         (TLP cheios)
 *      Δm_comp = M_req − M                           (água nos TC)
 *      Δm_trim = (M_req·x_B − M·x_G − Δm_comp·x_TC)/(x_AR − x_AV)
 *      Δm_banda = −M·y_G/(y_BE − y_BB)
 *
 * 2) Equilíbrio hidrostático na superfície: Newton amortecido em (z, θ, φ)
 *    anulando força vertical líquida e momentos de pitch e banda.
 */
import type { SimulationEngine } from './core/engine';
import { computeMassProps } from './physics/massProperties';
import { computeHydrostatics } from './physics/hydrostatics';
import { qFromEuler, qToEuler, qToMat3, DEG, clamp } from './core/math';
import { RHO_NOMINAL, R_AIR } from './core/context';
import { tankWaterCentroid } from './systems/internalTanks';

export interface CompensationSolution {
  ok: boolean;
  message: string;
  compensation: Record<string, number>; // kg finais por tanque
  trimA: number;
  trimB: number;
  heelA: number;
  heelB: number;
  residualKg: number;
  residualMoment: number;
}

/** Calcula (sem aplicar, se apply = false) a água de compensação/trim/banda para neutralidade a uma profundidade. */
export function solveNeutralCompensation(engine: SimulationEngine, axisDepth: number, apply: boolean): CompensationSolution {
  const cfg = engine.vessel;
  const s = engine.state;
  const backup = JSON.stringify({ c: s.compensation.tanks, t: [s.trim.tankA, s.trim.tankB], h: [s.heel.tankA, s.heel.tankB], b: s.ballast });
  // condição de cálculo: TLP cheios, nivelado na profundidade dada
  for (const t of cfg.ballast.tanks) {
    s.ballast[t.id].water = t.volume;
    s.ballast[t.id].air = 0;
  }
  const env = engine.env;
  const rho = env.densityAt(axisDepth);
  const geom = engine.geom;
  const pos = { x: s.body.pos.x, y: s.body.pos.y, z: axisDepth };
  const R = qToMat3(qFromEuler(0, 0, 0));
  const hs = computeHydrostatics(geom, pos, R);
  const dp = env.gaugePressureAt(axisDepth);
  const vDisp = hs.volume - cfg.hull.compressibility * dp * engine.compressibleVolume * hs.immersedFraction;
  const Mreq = rho * vDisp;
  const xB = hs.center.x;
  const compIds = cfg.compensation.tanks.map((t) => t.id);
  const capC = (id: string) => cfg.compensation.tanks.find((t) => t.id === id)!.capacity * RHO_NOMINAL;
  let clamped = false;
  for (let it = 0; it < 6; it++) {
    const mp = computeMassProps(cfg, s, engine.light, rho);
    const M = mp.mass;
    const dmc = Mreq - M;
    // distribui a compensação igualmente pelos tanques de compensação (TC central)
    let left = dmc;
    for (const id of compIds) {
      const st = s.compensation.tanks[id];
      const nv = st.mass + dmc / compIds.length;
      st.mass = clamp(nv, 0, capC(id));
      left -= st.mass - (nv - dmc / compIds.length);
    }
    // o que não coube no central vai, em partes iguais, aos tanques de banda ligados ao coletor
    if (Math.abs(left) > 1e-6 && (cfg.compensation.heelBranches?.length ?? 0) > 0) {
      const capH0 = cfg.heel.tankA.capacity * RHO_NOMINAL;
      const capH1 = cfg.heel.tankB.capacity * RHO_NOMINAL;
      const room = left > 0 ? Math.min(capH0 - s.heel.tankA.mass, capH1 - s.heel.tankB.mass) : Math.min(s.heel.tankA.mass, s.heel.tankB.mass);
      const each = Math.sign(left) * Math.min(Math.abs(left) / 2, Math.max(0, room));
      s.heel.tankA.mass += each;
      s.heel.tankB.mass += each;
      left -= 2 * each;
    }
    if (Math.abs(left) > 1) clamped = true;
    const mp2 = computeMassProps(cfg, s, engine.light, rho);
    const xA = tankWaterCentroid(cfg.trim.tankA, s.trim.tankA).x;
    const xBt = tankWaterCentroid(cfg.trim.tankB, s.trim.tankB).x;
    const dt = (mp2.mass * xB - mp2.mass * mp2.cg.x) / (xBt - xA);
    const capTA = cfg.trim.tankA.capacity * RHO_NOMINAL;
    const capTB = cfg.trim.tankB.capacity * RHO_NOMINAL;
    const na = clamp(s.trim.tankA.mass - dt, 0, capTA);
    const moved = s.trim.tankA.mass - na;
    const nb = clamp(s.trim.tankB.mass + moved, 0, capTB);
    if (Math.abs(moved - dt) > 1 || nb - s.trim.tankB.mass !== moved) clamped = true;
    s.trim.tankA.mass = s.trim.tankA.mass - (nb - s.trim.tankB.mass);
    s.trim.tankB.mass = nb;
    const mp3 = computeMassProps(cfg, s, engine.light, rho);
    const yA = cfg.heel.tankA.center.y;
    const yB = cfg.heel.tankB.center.y;
    const dh = (-mp3.mass * mp3.cg.y) / (yB - yA);
    const capH = cfg.heel.tankA.capacity * RHO_NOMINAL;
    const ha = clamp(s.heel.tankA.mass - dh, 0, capH);
    const hb = clamp(s.heel.tankB.mass + (s.heel.tankA.mass - ha), 0, capH);
    s.heel.tankA.mass = s.heel.tankA.mass - (hb - s.heel.tankB.mass);
    s.heel.tankB.mass = hb;
  }
  const mpF = computeMassProps(cfg, s, engine.light, rho);
  const sol: CompensationSolution = {
    ok: !clamped && Math.abs(Mreq - mpF.mass) < 5,
    message: '',
    compensation: Object.fromEntries(compIds.map((id) => [id, s.compensation.tanks[id].mass])),
    trimA: s.trim.tankA.mass,
    trimB: s.trim.tankB.mass,
    heelA: s.heel.tankA.mass,
    heelB: s.heel.tankB.mass,
    residualKg: Mreq - mpF.mass,
    residualMoment: mpF.mass * (xB - mpF.cg.x) * env.cfg.gravity,
  };
  sol.message = sol.ok
    ? `Neutralidade a ${(axisDepth + cfg.hull.diameter / 2).toFixed(0)} m (quilha): resíduo ${sol.residualKg.toFixed(0)} kg`
    : `Capacidade dos tanques insuficiente — resíduo ${sol.residualKg.toFixed(0)} kg`;
  if (!apply) {
    const b = JSON.parse(backup);
    s.compensation.tanks = b.c;
    s.trim.tankA = b.t[0];
    s.trim.tankB = b.t[1];
    s.heel.tankA = b.h[0];
    s.heel.tankB = b.h[1];
    s.ballast = b.b;
  }
  return sol;
}

/** Resíduos hidrostáticos (W − B em N, momentos de pitch e banda no corpo). */
function residual(engine: SimulationEngine, z: number, th: number, ph: number, psi: number): [number, number, number] {
  const s = engine.state;
  const cfg = engine.vessel;
  s.body.pos.z = z;
  s.body.quat = qFromEuler(ph, th, psi);
  const rho = engine.env.densityAt(Math.max(0, z));
  const mp = computeMassProps(cfg, s, engine.light, rho);
  const R = qToMat3(s.body.quat);
  const hs = computeHydrostatics(engine.geom, s.body.pos, R);
  const g = engine.env.cfg.gravity;
  const m = engine.hydrostaticMoment(mp, s.body.quat);
  const B = rho * g * hs.volume;
  return [mp.mass * g - B, m.y, m.x];
}

function solve3(A: number[][], b: number[]): number[] {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [M[0][3] / (M[0][0] || 1e-12), M[1][3] / (M[1][1] || 1e-12), M[2][3] / (M[2][2] || 1e-12)];
}

/** Equilíbrio hidrostático flutuando (TLP vazios). Ajusta z, pitch e banda. */
export function settleAtSurface(engine: SimulationEngine): { ok: boolean; draftKeel: number; pitch: number } {
  const s = engine.state;
  const cfg = engine.vessel;
  const e0 = qToEuler(s.body.quat);
  const psi = e0.psi;
  let z = s.body.pos.z;
  let th = e0.theta;
  let ph = e0.phi;
  let ok = false;
  for (let it = 0; it < 60; it++) {
    const r0 = residual(engine, z, th, ph, psi);
    const scale = [Math.abs(r0[0]) / 1e4, Math.abs(r0[1]) / 1e5, Math.abs(r0[2]) / 1e4];
    if (scale[0] < 0.05 && scale[1] < 0.05 && scale[2] < 0.05) {
      ok = true;
      break;
    }
    const hz = 0.01;
    const ha = 0.0005;
    const rz = residual(engine, z + hz, th, ph, psi);
    const rt = residual(engine, z, th + ha, ph, psi);
    const rp = residual(engine, z, th, ph + ha, psi);
    const J = [0, 1, 2].map((i) => [(rz[i] - r0[i]) / hz, (rt[i] - r0[i]) / ha, (rp[i] - r0[i]) / ha]);
    const d = solve3(J, r0.map((x) => -x));
    z += clamp(d[0], -0.5, 0.5);
    th += clamp(d[1], -1 * DEG, 1 * DEG);
    ph += clamp(d[2], -1 * DEG, 1 * DEG);
  }
  s.body.pos.z = z;
  s.body.quat = qFromEuler(ph, th, psi);
  // ar dos TLP vazios à pressão externa dos embornais
  const R = qToMat3(s.body.quat);
  for (const t of cfg.ballast.tanks) {
    const st = s.ballast[t.id];
    if (st.water < 1e-6) {
      const zp = z + R[6] * t.center.x + R[7] * t.center.y + R[8] * (t.center.z + t.height / 2);
      const T = engine.env.temperatureAt(Math.max(0, z)) + 273.15;
      st.air = (engine.env.pressureAt(zp) * t.volume) / (R_AIR * T);
    }
  }
  return { ok, draftKeel: z + cfg.hull.diameter / 2, pitch: th / DEG };
}
