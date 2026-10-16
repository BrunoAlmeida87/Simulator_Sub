/**
 * SISTEMA ELÉTRICO E ENERGIA (balanço simplificado).
 *
 * Bateria (circuito equivalente): V_oc(SoC) = V_min + (V_max − V_min)·SoC,
 * resistência interna R. Para a potência P solicitada nos terminais:
 *
 *   I = (V_oc − √(V_oc² − 4·R·P)) / (2R),   V = V_oc − R·I,   perdas = I²R
 *   dSoC/dt = −I / (3600·C_Ah)      (η_carga aplicada em recarga)
 *
 * Grupos diesel-geradores: só operam com tomada de ar disponível (superfície
 * ou snorkel içado com a cabeça fora d'água) e combustível; partida em
 * t_partida; consomem combustível ṁ = sfc·P. O tanque de combustível é
 * COMPENSADO com água do mar: cada m³ queimado é substituído por 1 m³ de
 * água ⇒ a massa do submarino AUMENTA (ρ_mar − ρ_comb)·V.
 *
 * O barramento distribui a demanda de todas as cargas modeladas (propulsão,
 * bombas, hidráulica, compressor, habitabilidade, navegação). A potência
 * disponível para a propulsão no passo seguinte é limitada pela capacidade
 * de fornecimento menos as demais cargas.
 */
import type { ElectricalConfig } from '../config/types';
import type { SimState } from '../core/state';
import { RHO_NOMINAL, type StepContext } from '../core/context';

export const batteryOcv = (cfg: ElectricalConfig, soc: number) => cfg.battery.vMin + (cfg.battery.vMax - cfg.battery.vMin) * Math.max(0, Math.min(1, soc));

export function updateGenerators(cfg: ElectricalConfig, s: SimState, ctx: StepContext): number {
  let available = 0;
  for (const g of cfg.generators) {
    const st = s.electrical.generators[g.id];
    const canRun = ctx.airIntakeAvailable && s.electrical.fuel > 0.01 && !st.failed;
    if (st.failed) {
      st.status = 'FALHA';
      st.timer = 0;
      continue;
    }
    if (!st.cmd) {
      st.status = st.power > 1 ? 'PARANDO' : 'PARADO';
      st.timer = 0;
      continue;
    }
    if (!canRun) {
      st.status = 'SEM AR';
      st.timer = 0;
      continue;
    }
    if (st.status !== 'EM CARGA') {
      st.status = 'PARTINDO';
      st.timer += ctx.dt;
      if (st.timer >= g.startTime) st.status = 'EM CARGA';
    }
    if (st.status === 'EM CARGA') available += g.ratedPower;
  }
  return available;
}

export interface ElectricalResult {
  fuelBurnedKg: number;
  seawaterIntoFuelKg: number;
}

/**
 * Fecha o balanço do barramento com as demandas do passo (W).
 * Atualiza SoC, tensão, corrente, geração, combustível e o limite de
 * potência da propulsão para o próximo passo.
 */
export function updateElectrical(
  cfg: ElectricalConfig,
  s: SimState,
  ctx: StepContext,
  demands: Record<string, number>,
  genAvailable: number,
  propulsionDemand: number,
): ElectricalResult {
  const e = s.electrical;
  const b = cfg.battery;
  const dt = ctx.dt;
  const batteryConnected = e.breakerClosed && !e.batteryFailed && e.soc > 0.0005;
  const ocv = batteryOcv(cfg, e.soc);
  e.ocv = ocv;
  let demand = 0;
  for (const k in demands) demand += demands[k];

  // geração: atende carga + recarga permitida
  const pChargeMax = batteryConnected ? b.maxChargeCurrent * ocv : 0;
  let gen = Math.min(genAvailable, demand + pChargeMax);
  let pBatt = demand - gen;
  let I = 0;
  let V = ocv;
  e.chargeLimited = false;
  let energized = true;
  if (batteryConnected) {
    const Rb = b.internalResistance;
    const disc = ocv * ocv - 4 * Rb * pBatt;
    if (disc <= 0) {
      I = b.maxCurrent;
    } else {
      I = (ocv - Math.sqrt(disc)) / (2 * Rb);
    }
    if (I > b.maxCurrent) I = b.maxCurrent;
    V = ocv - Rb * I;
    const delivered = V * I;
    if (delivered + 1 < pBatt) e.chargeLimited = true; // sobrecarga: tensão cai
    if (I >= 0) e.soc -= (I * dt) / (3600 * b.capacityAh);
    else e.soc -= (I * b.chargeEfficiency * dt) / (3600 * b.capacityAh);
    e.soc = Math.max(0, Math.min(1, e.soc));
    pBatt = V * I;
    s.ledger.batteryOut += pBatt * dt;
    s.ledger.batteryChemical += ocv * I * dt;
    s.ledger.batteryLoss += I * I * Rb * dt;
  } else {
    // sem bateria: só os geradores sustentam o barramento
    if (gen + 1 < demand || gen <= 0) energized = false;
    pBatt = 0;
    V = gen > 0 ? cfg.battery.vMin + 0.5 * (cfg.battery.vMax - cfg.battery.vMin) : 0;
    if (!energized) gen = 0;
  }

  // despacho dos geradores
  const running = cfg.generators.filter((g) => e.generators[g.id].status === 'EM CARGA');
  const capTotal = running.reduce((a, g) => a + g.ratedPower, 0);
  for (const g of cfg.generators) {
    const st = e.generators[g.id];
    st.power = st.status === 'EM CARGA' && capTotal > 0 ? (gen * g.ratedPower) / capTotal : 0;
  }
  let fuelKg = 0;
  for (const g of running) fuelKg += g.sfc * e.generators[g.id].power * dt;
  const fuelVol = fuelKg / cfg.fuel.density;
  const burned = Math.min(fuelVol, e.fuel);
  e.fuel -= burned;
  const seawaterKg = burned * RHO_NOMINAL;
  s.ledger.fuelBurned += burned * cfg.fuel.density;
  s.ledger.fuelSeawaterIn += seawaterKg;
  s.ledger.generatorEnergy += gen * dt;

  const delivered = energized ? gen + (batteryConnected ? pBatt : 0) : 0;
  s.ledger.loadEnergy += delivered * dt;
  e.loads = { ...demands };
  e.totalLoad = demand;
  e.generation = gen;
  e.batteryPower = batteryConnected ? pBatt : 0;
  e.current = batteryConnected ? I : 0;
  e.voltage = energized ? V : 0;
  e.energized = energized && (batteryConnected || gen > 0);

  // potência disponível para a propulsão no próximo passo
  const battMax = batteryConnected ? Math.max(0, ocv * b.maxCurrent - b.maxCurrent * b.maxCurrent * b.internalResistance) : 0;
  const others = demand - propulsionDemand;
  e.propulsionLimit = e.energized ? Math.max(0, battMax + genAvailable - others) : 0;
  return { fuelBurnedKg: burned * cfg.fuel.density, seawaterIntoFuelKg: seawaterKg };
}
