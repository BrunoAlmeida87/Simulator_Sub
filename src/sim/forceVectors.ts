/**
 * GRANDEZAS PARA OS VETORES DE FORÇA exibidos sobre o submarino.
 *
 * Tudo é lido das saídas do último passo do motor (mesmos valores usados na
 * integração): nenhuma força é recalculada ou estimada pela interface.
 *
 *  - Peso P = m·g, aplicado no centro de gravidade G (inclui a água dos TLP,
 *    compensação, trim e banda — encher um tanque aumenta P).
 *  - Empuxo E = ρ·g·V_deslocado, aplicado no centro de carena B. Com o casco
 *    todo submerso, V_deslocado é o envelope (quase constante); na superfície
 *    varia com a imersão.
 *  - Resultante vertical hidrostática R = E − P (+ para cima).
 */
import type { SimulationEngine } from './core/engine';
import { mulMat3Vec, qToMat3, type Vec3 } from './core/math';
import { demoMovedMass } from './physics/massProperties';

export interface VerticalBalance {
  g: number;
  rho: number;
  massKg: number;
  weightN: number;
  buoyancyN: number;
  /** E − P (N, + para cima) */
  netN: number;
  displacedM3: number;
  envelopeM3: number;
  immersedFraction: number;
  /** G e B no referencial do corpo (m) */
  cg: Vec3;
  cb: Vec3;
  /** parcelas variáveis de massa (kg) */
  mbtWaterKg: number;
  compKg: number;
  trimKg: number;
  heelKg: number;
}

export function verticalBalance(e: SimulationEngine): VerticalBalance {
  const o = e.outputs;
  const f = o.forces;
  const s = e.state;
  const g = e.env.cfg.gravity;
  let mbt = 0;
  for (const it of o.mp.items) if (it.group === 'lastro' && !it.id.endsWith('_ar')) mbt += it.mass;
  let comp = 0;
  for (const k in s.compensation.tanks) comp += s.compensation.tanks[k].mass;
  return {
    g,
    rho: f.rho,
    massKg: o.mp.mass,
    weightN: f.weightForce,
    buoyancyN: f.buoyancyForce,
    netN: f.buoyancyForce - f.weightForce,
    displacedM3: f.displacedVolume,
    envelopeM3: e.geom.volume,
    immersedFraction: f.hs.immersedFraction,
    cg: { ...o.mp.cg },
    cb: { ...f.hs.center },
    mbtWaterKg: mbt,
    compKg: comp,
    trimKg: s.trim.tankA.mass + s.trim.tankB.mass,
    heelKg: s.heel.tankA.mass + s.heel.tankB.mass,
  };
}

export interface HydroArrow {
  id: string;
  label: string;
  /** ponto de aplicação (corpo, m) */
  origin: Vec3;
  /** força no referencial NED (N) */
  forceNED: Vec3;
  magnitudeN: number;
}

/** Forças hidrodinâmicas e de propulsão do último passo (hélice, resistência, lemes). */
export function hydroArrows(e: SimulationEngine): HydroArrow[] {
  const f = e.outputs.forces;
  const R = qToMat3(e.state.body.quat);
  const out: HydroArrow[] = [];
  const add = (id: string, label: string, origin: Vec3, Fb: Vec3) => {
    const w = mulMat3Vec(R, Fb);
    out.push({ id, label, origin, forceNED: w, magnitudeN: Math.hypot(w.x, w.y, w.z) });
  };
  const L = e.vessel.hull.length;
  add('prop', 'Empuxo do hélice', { x: -L / 2 - 0.6, y: 0, z: 0 }, { x: f.propeller.F.x, y: 0, z: 0 });
  // resistência ao avanço (componente longitudinal do casco)
  add('drag', 'Resistência da água', { x: L / 2, y: 0, z: 0 }, { x: f.resistance.F.x + f.crossflow.F.x, y: 0, z: 0 });
  const names: Record<string, string> = { bow: 'Lemes de vante', stern: 'Lemes de ré', rudder: 'Leme de direção' };
  for (const fin of e.vessel.fins) {
    if (!names[fin.id]) continue;
    const fr = f.fins[fin.id];
    if (!fr) continue;
    add(fin.id, names[fin.id], { ...fin.position }, { ...fr.F });
  }
  return out;
}

/** Ganho visual automático da resultante: potência de 10 (1, 2, 5 ×10ⁿ) que leva o vetor a ~6 m. */
export function autoGain(netN: number, metersPerN: number, target = 6): number {
  const len = Math.abs(netN) * metersPerN;
  if (len < 1e-9) return 1;
  const raw = target / len;
  if (raw <= 1) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  const k = f >= 5 ? 5 : f >= 2 ? 2 : 1;
  return Math.min(10000, k * p);
}

/** Toneladas-força (tf) a partir de newtons. */
export const toTf = (N: number, g = 9.80665) => N / g / 1000;

// ------------------------------------------------------------------ trim
export interface TrimBalance {
  g: number;
  /** peso deslocável: binário (+P na posição atual, −P na neutra); momento em t·m (+ proa para cima) */
  demo: { mass: number; x: number; xCmd: number; xNeutral: number; z: number; momentTm: number } | null;
  /** tanques de trim: variação de massa (kg) em relação à condição inicial e momento do binário (t·m) */
  tanks: { xA: number; xB: number; zA: number; zB: number; dA: number; dB: number; momentTm: number };
  /** desequilíbrio das cargas deslocadas = peso + tanques (t·m) */
  netTm: number;
  pitch: number; // graus
  pitchEq: number; // graus (equilíbrio estático previsto)
  stiffness: number; // N·m/rad
  /** transferência de trim que anula o pitch de equilíbrio estático */
  compensate: { kg: number; dir: 'AtoB' | 'BtoA' | null; feasible: boolean; limitKg: number };
}

/**
 * Momentos de trim (binários): deslocar um peso P de x₀ para x equivale a
 * somar +P em x e −P em x₀, um binário de momento −P·(x − x₀) (independente
 * do ponto de referência). Transferir Δm de TT-AR para TT-AV é o binário
 * −g·Δm·(x_A − x_B). O casco responde girando até o momento restaurador
 * (E·BG·sen θ submerso; plano de flutuação na superfície) equilibrar.
 */
export function trimBalance(e: SimulationEngine): TrimBalance {
  const s = e.state;
  const v = e.vessel;
  const o = e.outputs;
  const g = e.env.cfg.gravity;
  const dwc = v.mass.demoWeight;
  const d = s.demoWeight;
  const demo = dwc && d ? { mass: demoMovedMass(dwc, d), x: d.x, xCmd: d.xCmd, xNeutral: dwc.xNeutral, z: dwc.z, momentTm: (-demoMovedMass(dwc, d) * (d.x - dwc.xNeutral)) / 1000 } : null;
  const ref = s.trimRef ?? { a: s.trim.tankA.mass, b: s.trim.tankB.mass };
  const tA = v.trim.tankA;
  const tB = v.trim.tankB;
  const dA = s.trim.tankA.mass - ref.a;
  const dB = s.trim.tankB.mass - ref.b;
  const tanksM = -(dA * tA.center.x + dB * tB.center.x) / 1000;
  // compensação: transferência cujo binário anula o desequilíbrio das cargas deslocadas
  // (binário de Δm entre A e B = −g·Δm·(x_A − x_B); netTm < 0 = proa para baixo ⇒ levar água para ré)
  const arm = tA.center.x - tB.center.x;
  const netTm = (demo?.momentTm ?? 0) + tanksM;
  const kgRaw = (Math.abs(netTm) * 1000) / arm;
  const dir: 'AtoB' | 'BtoA' | null = Math.abs(netTm) < 0.5 ? null : netTm < 0 ? 'AtoB' : 'BtoA';
  const RHO = 1025;
  const capA = tA.capacity * RHO;
  const capB = tB.capacity * RHO;
  const limitKg = dir === 'BtoA' ? Math.min(s.trim.tankB.mass, capA - s.trim.tankA.mass) : dir === 'AtoB' ? Math.min(s.trim.tankA.mass, capB - s.trim.tankB.mass) : 0;
  return {
    g,
    demo,
    tanks: { xA: tA.center.x, xB: tB.center.x, zA: tA.center.z, zB: tB.center.z, dA, dB, momentTm: tanksM },
    netTm,
    pitch: o.euler.pitch,
    pitchEq: o.staticPitchEq,
    stiffness: o.pitchStiffness,
    compensate: { kg: dir ? kgRaw : 0, dir, feasible: !!dir && kgRaw <= limitKg + 1, limitKg: Math.max(0, limitKg) },
  };
}
