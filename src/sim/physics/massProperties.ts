/**
 * PROPRIEDADES DE MASSA — massa total, centro de gravidade (CG) e momentos
 * de inércia calculados a cada passo a partir de TODOS os itens de peso:
 * peso leve, cargas variáveis, combustível compensado, ar AP, água dos TLP,
 * água de compensação, trim, banda e alagamentos.
 *
 *   m = Σ mᵢ,   G = Σ mᵢ·rᵢ / m
 *   I_xx = Σ mᵢ(yᵢ² + zᵢ²) + m_L·k_xx²   (análogo para I_yy, I_zz; em torno da origem)
 *
 * Simplificações: produtos de inércia desprezados; massas pontuais; a
 * superfície livre da água nos tanques não se desloca com a atitude.
 */
import type { VesselConfig } from '../config/types';
import type { SimState } from '../core/state';
import type { Vec3 } from '../core/math';
import { RHO_NOMINAL } from '../core/context';
import { R_AIR } from '../core/context';
import { seawaterDensity } from '../environment/seawater';
import { buildHullGeometry, type HullGeometry } from './hullGeometry';
import { tankWaterCentroid } from '../systems/internalTanks';

export interface MassItem {
  id: string;
  name: string;
  group: 'leve' | 'cargas' | 'combustivel' | 'ar' | 'lastro' | 'compensacao' | 'trim' | 'banda' | 'alagamento';
  mass: number;
  pos: Vec3;
}

export interface MassProps {
  mass: number;
  cg: Vec3;
  inertia: Vec3; // I_xx, I_yy, I_zz em torno da origem (kg·m²)
  items: MassItem[];
  /** massa "interna" (exclui a água livre dos TLP) — usada no balanço de massa */
  internalMass: number;
}

export interface ResolvedMass {
  lightshipMass: number;
  lightshipCG: Vec3;
}

const HP_AIR_POS: Vec3 = { x: -8, y: 0, z: 1.2 };

export function fuelTankMass(cfg: VesselConfig, fuelVolume: number): { mass: number; fuel: number; water: number } {
  const f = cfg.electrical.fuel;
  const fuel = fuelVolume * f.density;
  const water = Math.max(0, f.tankVolume - fuelVolume) * RHO_NOMINAL;
  return { mass: fuel + water, fuel, water };
}

/**
 * Calcula peso leve e CG do peso leve para a condição de projeto:
 * flutuabilidade neutra, trim nulo e BG = designBG, totalmente submerso com
 * TLP cheios e tanques internos nos volumes iniciais.
 */
export function resolveLightship(cfg: VesselConfig, geom?: HullGeometry): ResolvedMass {
  const g = geom ?? buildHullGeometry(cfg.hull);
  const dc = cfg.mass.designCondition;
  const pBar = (1026 * 9.80665 * dc.depth) / 1e5;
  const rho = seawaterDensity(dc.salinity, dc.temperature, pBar);
  const vMbt = cfg.ballast.tanks.reduce((a, t) => a + t.volume, 0);
  const vEff = g.volume - cfg.hull.compressibility * pBar * 1e5 * (g.volume - vMbt);
  const mTotal = rho * vEff;
  const others: { m: number; p: Vec3 }[] = [];
  for (const t of cfg.ballast.tanks) others.push({ m: rho * t.volume, p: t.center });
  const internal = [...cfg.compensation.tanks, cfg.trim.tankA, cfg.trim.tankB, cfg.heel.tankA, cfg.heel.tankB];
  for (const t of internal) {
    others.push({ m: t.initialVolume * RHO_NOMINAL, p: tankWaterCentroid(t, { mass: t.initialVolume * RHO_NOMINAL }) });
  }
  for (const l of cfg.mass.variableLoads) others.push({ m: l.mass, p: l.position });
  const dw = cfg.mass.demoWeight;
  if (dw) others.push({ m: dw.mass, p: { x: dw.xNeutral, y: dw.y, z: dw.z } });
  const fuel = fuelTankMass(cfg, cfg.electrical.fuel.initialFuel);
  others.push({ m: fuel.mass, p: cfg.electrical.fuel.position });
  const Tb = cfg.hpAir.temperature + 273.15;
  for (const b of cfg.hpAir.banks) others.push({ m: (b.initialPressure * b.volume) / (R_AIR * Tb), p: HP_AIR_POS });
  const mOthers = others.reduce((a, o) => a + o.m, 0);
  const mL = typeof cfg.mass.lightshipMass === 'number' ? cfg.mass.lightshipMass : mTotal - mOthers;
  let cgL: Vec3;
  if (cfg.mass.lightshipCG === 'auto') {
    const target: Vec3 = { x: g.centroidX, y: 0, z: cfg.mass.designBG };
    const mx = others.reduce((a, o) => a + o.m * o.p.x, 0);
    const my = others.reduce((a, o) => a + o.m * o.p.y, 0);
    const mz = others.reduce((a, o) => a + o.m * o.p.z, 0);
    const M = mL + mOthers;
    cgL = { x: (M * target.x - mx) / mL, y: (M * target.y - my) / mL, z: (M * target.z - mz) / mL };
  } else cgL = cfg.mass.lightshipCG;
  return { lightshipMass: mL, lightshipCG: cgL };
}

export function computeMassProps(cfg: VesselConfig, s: SimState, light: ResolvedMass, rhoBallast: number): MassProps {
  const items: MassItem[] = [];
  items.push({ id: 'leve', name: 'Peso leve (estrutura e máquinas)', group: 'leve', mass: light.lightshipMass, pos: light.lightshipCG });
  for (const l of cfg.mass.variableLoads) items.push({ id: l.id, name: l.name, group: 'cargas', mass: l.mass, pos: l.position });
  if (cfg.mass.loadOffset !== 0)
    items.push({ id: 'ajuste', name: 'Ajuste de condição de carga', group: 'cargas', mass: cfg.mass.loadOffset, pos: cfg.mass.loadOffsetPosition });
  const fuel = fuelTankMass(cfg, s.electrical.fuel);
  items.push({ id: 'comb', name: 'Combustível + água de compensação', group: 'combustivel', mass: fuel.mass, pos: cfg.electrical.fuel.position });
  let air = 0;
  for (const b of cfg.hpAir.banks) air += s.hpAir.banks[b.id].mass;
  items.push({ id: 'arAP', name: 'Ar comprimido (garrafas)', group: 'ar', mass: air, pos: HP_AIR_POS });
  let internalMass = light.lightshipMass + fuel.mass + air + cfg.mass.loadOffset + cfg.mass.variableLoads.reduce((a, l) => a + l.mass, 0);
  const dw = cfg.mass.demoWeight;
  if (dw && s.demoWeight && s.demoWeight.mass > 0) {
    items.push({ id: 'pesoMovel', name: 'Peso deslocável (demonstração)', group: 'cargas', mass: s.demoWeight.mass, pos: { x: s.demoWeight.x, y: dw.y, z: dw.z } });
    internalMass += s.demoWeight.mass;
  }
  for (const t of cfg.ballast.tanks) {
    const st = s.ballast[t.id];
    const h = st.water / (t.volume / t.height);
    items.push({
      id: t.id,
      name: t.name + ' (água)',
      group: 'lastro',
      mass: st.water * rhoBallast,
      pos: { x: t.center.x, y: t.center.y, z: t.center.z + t.height / 2 - h / 2 },
    });
    if (st.air > 0) {
      items.push({ id: t.id + '_ar', name: t.name + ' (ar)', group: 'lastro', mass: st.air, pos: { x: t.center.x, y: t.center.y, z: t.center.z - t.height / 2 } });
      internalMass += st.air;
    }
  }
  cfg.compensation.tanks.forEach((t) => {
    const st = s.compensation.tanks[t.id];
    items.push({ id: t.id, name: t.name, group: 'compensacao', mass: st.mass, pos: tankWaterCentroid(t, st) });
    internalMass += st.mass;
  });
  for (const [sys, group] of [
    [cfg.trim, 'trim'],
    [cfg.heel, 'banda'],
  ] as const) {
    const st = sys.id === 'trim' ? s.trim : s.heel;
    items.push({ id: sys.tankA.id, name: sys.tankA.name, group, mass: st.tankA.mass, pos: tankWaterCentroid(sys.tankA, st.tankA) });
    items.push({ id: sys.tankB.id, name: sys.tankB.name, group, mass: st.tankB.mass, pos: tankWaterCentroid(sys.tankB, st.tankB) });
    internalMass += st.tankA.mass + st.tankB.mass;
  }
  for (const c of cfg.compartments) {
    const f = s.flooding[c.id];
    if (f && f.water > 0) {
      items.push({ id: 'alag_' + c.id, name: 'Alagamento: ' + c.name, group: 'alagamento', mass: f.water, pos: { x: 0.5 * (c.xFwd + c.xAft), y: 0, z: c.bilgeZ } });
      internalMass += f.water;
    }
  }
  let m = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  let ixx = 0;
  let iyy = 0;
  let izz = 0;
  for (const it of items) {
    m += it.mass;
    mx += it.mass * it.pos.x;
    my += it.mass * it.pos.y;
    mz += it.mass * it.pos.z;
    ixx += it.mass * (it.pos.y * it.pos.y + it.pos.z * it.pos.z);
    iyy += it.mass * (it.pos.x * it.pos.x + it.pos.z * it.pos.z);
    izz += it.mass * (it.pos.x * it.pos.x + it.pos.y * it.pos.y);
  }
  const k = cfg.mass.gyration;
  ixx += light.lightshipMass * k.kxx * k.kxx;
  iyy += light.lightshipMass * k.kyy * k.kyy;
  izz += light.lightshipMass * k.kzz * k.kzz;
  return { mass: m, cg: { x: mx / m, y: my / m, z: mz / m }, inertia: { x: ixx, y: iyy, z: izz }, items, internalMass };
}
