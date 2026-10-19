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
