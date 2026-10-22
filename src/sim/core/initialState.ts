/**
 * Construção do estado inicial a partir da configuração.
 */
import type { SimConfig } from '../config/types';
import { qFromEuler, DEG } from './math';
import { newPid, newPump, newValve, type SimState, type TransferState } from './state';
import { RHO_NOMINAL, R_AIR } from './context';
import { SENSOR_DEFS } from '../systems/sensors';

export interface InitialPose {
  depth: number; // profundidade do eixo (m)
  heading: number; // graus
  pitch?: number;
  roll?: number;
  speed?: number; // m/s
  north?: number;
  east?: number;
}

function transferState(cfg: SimConfig['vessel']['trim']): TransferState {
  return {
    tankA: { mass: cfg.tankA.initialVolume * RHO_NOMINAL },
    tankB: { mass: cfg.tankB.initialVolume * RHO_NOMINAL },
    valveA: newValve(),
    valveB: newValve(),
    direction: newValve(),
    pump: newPump(),
    flow: 0,
    dosing: null,
  };
}

export function createState(config: SimConfig, pose: InitialPose, scenarioId: string, mbtFull: boolean): SimState {
  const v = config.vessel;
  const ballast: SimState['ballast'] = {};
  for (const t of v.ballast.tanks) {
    ballast[t.id] = {
      water: mbtFull ? t.volume : 0,
      air: mbtFull ? 0 : (101325 * t.volume) / (R_AIR * 293),
      vent: newValve(),
      blow: newValve(),
      emergencyBlow: newValve(),
      ventLeak: 0,
      qWater: 0,
      mdotVent: 0,
      mdotBlow: 0,
      mdotEmergencyBlow: 0,
      mdotSpill: 0,
      pAir: 0,
      pExtPort: 0,
    };
  }
  const banks: SimState['hpAir']['banks'] = {};
  const Tb = v.hpAir.temperature + 273.15;
  for (const b of v.hpAir.banks) banks[b.id] = { mass: (b.initialPressure * b.volume) / (R_AIR * Tb), valve: newValve(b.purpose !== 'emergency') };
  const compTanks: SimState['compensation']['tanks'] = {};
  for (const t of v.compensation.tanks) compTanks[t.id] = { mass: t.initialVolume * RHO_NOMINAL };
  const tankValves: SimState['compensation']['tankValves'] = {};
  for (const tv of v.compensation.tankValves) tankValves[tv.id] = newValve();
  for (const b of v.compensation.heelBranches ?? []) tankValves[b.valve.id] = newValve();
  const surfaces: SimState['surfaces'] = {};
  for (const f of v.fins) if (f.maxDeflection > 0) surfaces[f.id] = { cmd: 0, actual: 0, jammed: false };
  const generators: SimState['electrical']['generators'] = {};
  for (const g of v.electrical.generators) generators[g.id] = { cmd: false, status: 'PARADO', timer: 0, power: 0, failed: false };
  const flooding: SimState['flooding'] = {};
  for (const c of v.compartments) flooding[c.id] = { water: 0, breachArea: 0, rate: 0 };
  const sensors: SimState['sensors'] = {};
  for (const d of SENSOR_DEFS) sensors[d.id] = { value: 0, filtered: 0, failMode: 'normal', drift: 0, valid: true };
  const speed = pose.speed ?? 0;
  const rpm0 = speed > 0 ? estimateRpmForSpeed(config, speed) : 0;
  return {
    version: 1,
    scenarioId,
    t: 0,
    step: 0,
    rng: { seed: config.settings.seed },
    body: {
      pos: { x: pose.north ?? 0, y: pose.east ?? 0, z: pose.depth },
      quat: qFromEuler((pose.roll ?? 0) * DEG, (pose.pitch ?? 0) * DEG, pose.heading * DEG),
      vel: { x: speed, y: 0, z: 0 },
      omega: { x: 0, y: 0, z: 0 },
    },
    ballast,
    hpAir: { banks, compressorCmd: false, compressorRunning: false, manifoldPressure: v.hpAir.banks[0].initialPressure, emergencyManifoldPressure: config.environment.atmosphericPressure },
    compensation: {
      tanks: compTanks,
      tankValves,
      inlet: newValve(),
      discharge: newValve(),
      pump: newPump(),
      qIn: 0,
      qOut: 0,
      dosing: null,
    },
    trim: transferState(v.trim),
    heel: transferState(v.heel),
    propulsion: {
      rpmCmd: rpm0,
      rpmRef: rpm0,
      omega: (rpm0 * 2 * Math.PI) / 60,
      integ: 0,
      thrust: 0,
      propTorque: 0,
      motorTorque: 0,
      shaftPower: 0,
      elecPower: 0,
      advance: 0,
      failed: false,
      powerLimited: false,
      shaftAngle: 0,
    },
    electrical: {
      soc: 0.85,
      breakerClosed: true,
      batteryFailed: false,
      energized: true,
      voltage: 0,
      current: 0,
      ocv: 0,
      generators,
      fuel: v.electrical.fuel.initialFuel,
      loads: {},
      totalLoad: 0,
      generation: 0,
      batteryPower: 0,
      propulsionLimit: v.propulsion.motor.ratedPower / v.propulsion.motor.efficiency,
      chargeLimited: false,
    },
    hydraulics: { pressure: v.hydraulics.nominalPressure, failed: false, pumpOn: false, power: 0 },
    surfaces,
    snorkel: { cmd: false, pos: 0, headValveOpen: false },
    periscope: { cmd: false, pos: 0 },
    flooding,
    autopilot: {
      headingMode: 'MANUAL',
      headingSet: pose.heading,
      depthMode: 'MANUAL',
      depthSet: Math.max(0, pose.depth + 3.1),
      pitchMode: 'MANUAL',
      pitchSet: 0,
      iHeading: 0,
      iDepth: 0,
      iPitch: 0,
      tHeading: newPid(),
      tDepth: newPid(),
      tPitch: newPid(),
      tBow: newPid(),
    },
    sensors,
    nav: { drNorth: pose.north ?? 0, drEast: pose.east ?? 0, distance: 0, trail: [], depthRate: 0, prevDepth: 0, trailTimer: 0 },
    alarms: { runtime: {}, log: [] },
    commands: [],
    ledger: {
      seaIn: 0,
      seaOut: 0,
      airVented: 0,
      airSpilled: 0,
      airCompressed: 0,
      fuelBurned: 0,
      fuelSeawaterIn: 0,
      floodIn: 0,
      batteryOut: 0,
      batteryChemical: 0,
      batteryLoss: 0,
      loadEnergy: 0,
      generatorEnergy: 0,
      propellerWork: 0,
      mass0: 0,
    },
    contact: false,
    demoWeight: v.mass.demoWeight ? { x: v.mass.demoWeight.xNeutral, xCmd: v.mass.demoWeight.xNeutral, mass: v.mass.demoWeight.mass } : undefined,
  };
}

/**
 * Estimativa de rpm em regime para a velocidade u (equilíbrio empuxo × resistência
 * submersa), usada apenas para iniciar cenários já em movimento.
 */
export function estimateRpmForSpeed(config: SimConfig, u: number): number {
  const v = config.vessel;
  const p = v.propulsion.propeller;
  const rho = 1025;
  // área molhada aproximada do envelope
  const S = Math.PI * v.hull.diameter * v.hull.length * 0.88 * v.hydro.appendageFactor;
  const Rt = 0.5 * rho * S * v.hydro.totalResistanceCoeff * u * u;
  const T = Rt / (1 - p.thrustDeduction);
  const ua = u * (1 - p.wakeFraction);
  const D = p.diameter;
  // T = ρD⁴K_T0 (n² − n·ua/(D·J0T))  → n² − b·n − c = 0
  const b = ua / (D * p.J0T);
  const c = T / (rho * D ** 4 * p.KT0);
  const n = (b + Math.sqrt(b * b + 4 * c)) / 2;
  return Math.min(v.propulsion.motor.ratedRpm, n * 60);
}
