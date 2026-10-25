/**
 * MOTOR DE SIMULAÇÃO — independente da interface (sem DOM, React ou Three.js).
 *
 * Executa passos de tempo FIXOS (dt, padrão 0,02 s = 50 Hz) a partir de um
 * acumulador de tempo real × fator de aceleração; a taxa de quadros da
 * interface não afeta a física. A ordem dos módulos em cada passo é:
 *
 *  1. controle automático (a partir das leituras dos sensores)
 *  2. atuadores de lemes, mastro do snorkel
 *  3. ar AP + tanques de lastro principal
 *  4. compensação, trim, banda, alagamentos
 *  5. planta hidráulica
 *  6. propulsão (eixo/hélice)
 *  7. propriedades de massa (CG, inércia) a partir de todos os tanques
 *  8. corpo rígido 6-GL (RK4)
 *  9. sensores e navegação estimada
 * 10. balanço elétrico (bateria, geradores, combustível)
 * 11. supervisão de alarmes; balanços de massa e energia
 */
import type { SimConfig, VesselConfig } from '../config/types';
import { Environment } from '../environment/environment';
import { buildHullGeometry, type HullGeometry } from '../physics/hullGeometry';
import { computeMassProps, resolveLightship, type MassProps, type ResolvedMass } from '../physics/massProperties';
import { computeForces, computeWaveCache, fullAddedMass, rk4Step, type AddedMass, type BodyState, type ForceBreakdown, type ForceInputs, type WaveCache } from '../physics/dynamics';
import { makeDepthOf, type StepContext } from './context';
import { clamp, mulMat3Vec, qToEuler, qToMat3, RAD, wrap360, qFromEuler as qFromEulerLocal, mulMat3TVec as mulMat3TVecLocal, vCross as vCrossLocal, type Mat3, type Quat, type Vec3 } from './math';
import { computeHydrostatics as computeHydrostaticsLocal } from '../physics/hydrostatics';
import type { SimState } from './state';
import { updateBallastTank } from '../systems/ballast';
import { bankPressure, bankTempK, drawFromManifold, manifoldMass, updateCompressor, updateHpManifold } from '../systems/hpAir';
import { updateCompensation, updateTransfer } from '../systems/internalTanks';
import { updatePropulsion } from '../systems/propulsion';
import { finGeometricAngles, hydraulicFactor, updateFlooding, updateHydraulics, updatePeriscope, updateSnorkel, updateSurfaces } from '../systems/actuation';
import { updateElectrical, updateGenerators } from '../systems/electrical';
import { updateAutopilot, type ApReadings } from '../systems/autopilot';
import { updateNavigation, updateSensors, type TrueValues } from '../systems/sensors';
import { evaluateAlarms } from '../systems/alarms';

/** rigidez hidrostática (N·m/rad) abaixo da qual o equilíbrio é tratado como instável/indiferente */
const MIN_STIFFNESS = 1e3;

export interface SimOutputs {
  mp: MassProps;
  forces: ForceBreakdown;
  euler: { roll: number; pitch: number; heading: number }; // graus
  depthAxis: number;
  depthKeel: number;
  pressureKeel: number;
  bottomDepth: number;
  altitude: number;
  velNED: Vec3;
  verticalSpeed: number; // m/s (+ descendo)
  speed: number; // m/s (u)
  speedOverGround: number;
  courseOverGround: number;
  netBuoyancyKg: number; // + = flutuabilidade positiva (empuxo > peso)
  /** ρ·V_envelope(submerso) − m: flutuabilidade se totalmente submerso (reserva na superfície) */
  reserveKg: number;
  surfaced: boolean;
  displacementKg: number; // ρ·V_imerso
  depthRateCalc: number; // calculada a partir dos profundímetros
  rhoLocal: number;
  seaTemp: number;
  salinity: number;
  /** momentos estáticos em torno de B, mundo (N·m): + = proa para cima / adernar BE */
  staticPitchMoment: number;
  staticRollMoment: number;
  /** momento devido à separação longitudinal/transversal entre G e B (N·m) */
  weightTrimMoment: number;
  weightHeelMoment: number;
  /**
   * rigidez hidrostática (N·m/rad), limitada a ≥ 1 para as divisões das telas;
   * o valor com sinal e a estabilidade estão em *StiffnessSigned / *Stable
   */
  pitchStiffness: number;
  rollStiffness: number;
  pitchStiffnessSigned: number;
  rollStiffnessSigned: number;
  /** rigidez positiva: o ângulo tende a voltar; false = instável, sem previsão linear */
  pitchStable: boolean;
  rollStable: boolean;
  /** ângulos de equilíbrio estático previstos (graus); instável ⇒ ângulo atual */
  staticPitchEq: number;
  staticRollEq: number;
  BG: number;
  airIntake: boolean;
  hpManifoldBar: number;
  massAudit: number; // kg — erro do balanço de massa (deve ser ≈ 0)
  energyAudit: number; // J — erro do balanço energético do barramento
  rpm: number;
}

export type CommandSink = (text: string, group: string) => void;

export class SimulationEngine {
  readonly config: SimConfig;
  /** ambiente (reconstruído pelo comando 'environment' quando o operador altera T/S/fundo) */
  env: Environment;
  readonly geom: HullGeometry;
  readonly light: ResolvedMass;
  readonly added: AddedMass;
  readonly compressibleVolume: number;
  state: SimState;
  outputs!: SimOutputs;
  /** pose do passo anterior (interpolação visual) */
  prevPos: Vec3;
  prevQuat: Quat;
  private scratch: Float64Array;
  private scratch2: Float64Array;
  private waveCache: WaveCache | null = null;
  private readings: ApReadings;

  constructor(config: SimConfig, state: SimState) {
    this.config = config;
    this.env = new Environment(config.environment);
    this.geom = buildHullGeometry(config.vessel.hull);
    this.light = resolveLightship(config.vessel, this.geom);
    this.added = fullAddedMass(config.vessel, this.geom, 1025);
    this.compressibleVolume = this.geom.volume - config.vessel.ballast.tanks.reduce((a, t) => a + t.volume, 0);
    this.state = state;
    this.scratch = new Float64Array(this.geom.slices.length);
    this.scratch2 = new Float64Array(this.geom.slices.length);
    this.prevPos = { ...state.body.pos };
    this.prevQuat = { ...state.body.quat };
    this.readings = { heading: 0, yawRate: 0, depth: 0, depthRate: 0, pitch: 0, pitchRate: 0, speed: 0 };
    this.computeOutputs();
    this.refreshReadings();
    if (state.ledger.mass0 === 0) state.ledger.mass0 = this.outputs.mp.internalMass;
  }

  get vessel(): VesselConfig {
    return this.config.vessel;
  }

  /**
   * GANCHOS DE GRAVAÇÃO/REPRODUÇÃO (não alteram a física):
   *  - commandGate: se definido e retornar false, o comando é recusado
   *    (a reprodução bloqueia comandos que não sejam os gravados);
   *  - commandTap: recebe cada comando aceito, com a origem;
   *  - noteTap: recebe as mensagens de histórico emitidas FORA dos passos e
   *    dos comandos (narração das automações), para serem regravadas.
   */
  commandGate: ((c: unknown, source: string) => boolean) | null = null;
  commandTap: ((c: unknown, source: string) => void) | null = null;
  noteTap: ((text: string, group: string) => void) | null = null;
  /** > 0 enquanto um passo ou um comando está sendo aplicado */
  busy = 0;

  log(text: string, group: string): void {
    if (this.noteTap && this.busy === 0) this.noteTap(text, group);
    this.state.commands.push({ t: this.state.t, text, group });
    if (this.state.commands.length > 500) this.state.commands.splice(0, this.state.commands.length - 500);
  }

  /**
   * Reconstrói o ambiente a partir de config.environment (após alteração de
   * temperatura, salinidade, termoclina ou fundo). O estado físico é mantido.
   */
  rebuildEnvironment(): void {
    this.env = new Environment(this.config.environment);
    this.computeOutputs();
  }

  /** Leituras dos sensores usadas pelo controle automático (não o estado real). */
  get apReadings(): ApReadings {
    return this.readings;
  }

  private refreshReadings(): void {
    const s = this.state;
    this.readings = {
      heading: s.sensors.GIRO.value,
      yawRate: s.sensors.INSW.value,
      depth: 0.5 * (s.sensors.PRF1.value + s.sensors.PRF2.value),
      depthRate: s.nav.depthRate,
      pitch: s.sensors.INSP.value,
      pitchRate: s.sensors.INSQ.value,
      speed: s.sensors.DVLU.value,
    };
  }

  private forceInputs(mp: MassProps): ForceInputs {
    const s = this.state;
    const rho = this.env.densityAt(Math.max(0, s.body.pos.z));
    const k = rho / 1025;
    const A = this.added;
    return {
      cfg: this.vessel,
      geom: this.geom,
      env: this.env,
      mp,
      added: { X: A.X * k, Y: A.Y * k, Z: A.Z * k, K: A.K * k, M: A.M * k, N: A.N * k },
      finAngles: finGeometricAngles(this.vessel, s),
      thrust: s.propulsion.thrust,
      propTorque: s.propulsion.propTorque,
      compressibleVolume: this.compressibleVolume,
      sliceScratch: this.scratch,
      t: s.t,
    };
  }

  /** Executa um passo fixo de simulação. */
  step(): void {
    this.busy++;
    try {
      this.stepInner();
    } finally {
      this.busy--;
    }
  }

  private stepInner(): void {
    const s = this.state;
    const cfg = this.vessel;
    const env = this.env;
    const dt = this.config.settings.dt;
    const R: Mat3 = qToMat3(s.body.quat);
    const pos = s.body.pos;
    const axisDepth = pos.z;
    const ctx: StepContext = {
      cfg,
      env,
      geom: this.geom,
      dt,
      t: s.t,
      R,
      pos,
      depthOf: makeDepthOf(pos, R),
      busPowered: s.electrical.energized,
      hydraulicFactor: hydraulicFactor(cfg, s),
      rhoLocal: env.densityAt(Math.max(0, axisDepth)),
      seaTempK: env.temperatureAt(Math.max(0, axisDepth)) + 273.15,
      airIntakeAvailable: false,
      hydraulicDemand: 0,
      log: (t, g) => this.log(t, g),
    };

    // 1–2. controle automático e atuadores
    updateAutopilot(cfg, s, this.readings, dt);
    updateSurfaces(cfg, s, ctx);
    ctx.airIntakeAvailable = updateSnorkel(cfg, s, ctx);
    updatePeriscope(cfg, s, ctx);

    // 3. ar AP e lastro principal
    let strokes = updateHpManifold(cfg.hpAir, s, ctx);
    let drawn = 0;
    let emergencyDrawn = 0;
    const normalAvailable = manifoldMass(cfg.hpAir, s);
    const emergencyAvailable = manifoldMass(cfg.hpAir, s, 'emergency');
    const Tb = bankTempK(cfg.hpAir);
    for (const t of cfg.ballast.tanks) {
      const r = updateBallastTank(t, s.ballast[t.id], ctx, s.hpAir.manifoldPressure, Tb, s.hpAir.emergencyManifoldPressure, normalAvailable - drawn, emergencyAvailable - emergencyDrawn);
      drawn += r.airDrawn;
      emergencyDrawn += r.emergencyAirDrawn;
      s.ledger.airVented += r.airVented;
      s.ledger.airSpilled += r.airSpilled;
      strokes += r.valveStrokes;
    }
    drawFromManifold(cfg.hpAir, s, drawn);
    drawFromManifold(cfg.hpAir, s, emergencyDrawn, 'emergency');
    const comp = updateCompressor(cfg.hpAir, s, ctx);
    s.ledger.airCompressed += comp.added;

    // 4. tanques internos e alagamento
    const rt = updateTransfer(cfg.trim, s.trim, ctx);
    const rh = updateTransfer(cfg.heel, s.heel, ctx);
    const rc = updateCompensation(cfg.compensation, s.compensation, ctx, cfg.heel, s.heel);
    s.ledger.seaIn += rc.seaIn;
    s.ledger.seaOut += rc.seaOut;
    strokes += rc.strokes + rt.strokes + rh.strokes;
    s.ledger.floodIn += updateFlooding(cfg, s, ctx);

    // 5. hidráulica
    ctx.hydraulicDemand += strokes * cfg.hydraulics.consumptionPerStroke;
    const hydPower = updateHydraulics(cfg, s, ctx);

    // 6. propulsão
    const propX = -cfg.hull.length / 2 + 0.5;
    const propDepth = ctx.depthOf({ x: propX, y: 0, z: 0 });
    const Rp = cfg.propulsion.propeller.diameter / 2;
    const propImm = Math.max(0, Math.min(1, (propDepth + Rp) / (2 * Rp)));
    updatePropulsion(cfg.propulsion, s.propulsion, dt, s.body.vel.x, ctx.rhoLocal, ctx.busPowered, s.electrical.propulsionLimit, propImm);
    s.ledger.propellerWork += s.propulsion.propTorque * s.propulsion.omega * dt;

    // peso deslocável de demonstração: carro no trilho com velocidade limitada
    const dwc = cfg.mass.demoWeight;
    if (dwc && s.demoWeight) {
      const d = s.demoWeight;
      d.xCmd = Math.max(dwc.xMin, Math.min(dwc.xMax, d.xCmd));
      const dx = d.xCmd - d.x;
      const stepMax = dwc.speed * dt;
      d.x += Math.abs(dx) <= stepMax ? dx : Math.sign(dx) * stepMax;
    }
    // cargas deslocáveis a bordo (torpedos, tripulantes, mantimentos): andam até a posição ordenada
    if (cfg.mass.shiftLoads && s.shiftLoads) {
      for (const lc of cfg.mass.shiftLoads) {
        const l = s.shiftLoads[lc.id];
        if (!l) continue;
        l.xCmd = Math.max(lc.xMin, Math.min(lc.xMax, l.xCmd));
        const dx = l.xCmd - l.x;
        const stepMax = lc.speed * dt;
        l.x += Math.abs(dx) <= stepMax ? dx : Math.sign(dx) * stepMax;
      }
    }

    // 7–8. massa e corpo rígido
    const mp = computeMassProps(cfg, s, this.light, ctx.rhoLocal);
    const fi = this.forceInputs(mp);
    // ondas: cinemática por fatia uma vez por passo (instante médio)
    this.waveCache = computeWaveCache(this.geom, env, s.body.pos, R, s.t + dt / 2, cfg.hull.diameter, this.waveCache);
    fi.waveCache = this.waveCache;
    const body: BodyState = { pos: s.body.pos, quat: s.body.quat, vel: s.body.vel, omega: s.body.omega };
    this.prevPos = { ...s.body.pos };
    this.prevQuat = { ...s.body.quat };
    const nb = rk4Step(body, fi, dt);
    s.body.pos = nb.pos;
    s.body.quat = nb.quat;
    s.body.vel = nb.vel;
    s.body.omega = nb.omega;

    s.t += dt;
    s.step += 1;

    // 9. sensores e saídas
    this.computeOutputs(mp);
    const o = this.outputs;
    updateSensors(cfg, s, this.trueValues(), dt, this.config.settings.advancedInstrumentation);
    const depthRate = updateNavigation(s, dt, o.velNED, s.nav.prevDepth);
    // taxa calculada filtrada (1ª ordem, 2 s)
    s.nav.depthRate += Math.min(1, dt / 2) * (depthRate - s.nav.depthRate);
    s.nav.prevDepth = 0.5 * (s.sensors.PRF1.value + s.sensors.PRF2.value);
    o.depthRateCalc = s.nav.depthRate;
    this.refreshReadings();
    s.nav.trailTimer += dt;
    if (s.nav.trailTimer >= 5) {
      s.nav.trailTimer = 0;
      s.nav.trail.push({ n: s.body.pos.x, e: s.body.pos.y, z: s.body.pos.z });
      if (s.nav.trail.length > 1500) s.nav.trail.splice(0, s.nav.trail.length - 1500);
    }

    // 10. balanço elétrico
    const genAvail = updateGenerators(cfg.electrical, s, ctx);
    const demands: Record<string, number> = {
      MEP: s.propulsion.elecPower,
      BC: s.compensation.pump.power,
      BTC: s.compensation.transfer?.pump.power ?? 0,
      BT: rt.power,
      BB: rh.power,
      HID: hydPower,
      COMP: comp.power,
      HOTEL: cfg.electrical.hotelLoad,
      NAV: cfg.electrical.navLoad,
    };
    const er = updateElectrical(cfg.electrical, s, ctx, demands, genAvail, s.propulsion.elecPower);
    void er;
    s.contact = o.forces.contactActive;

    // 11. alarmes
    this.evaluateAlarms();
    // balanço de massa
    const L = s.ledger;
    const expected = L.mass0 + (L.cargoIn ?? 0) + L.seaIn - L.seaOut + L.floodIn + L.fuelSeawaterIn - L.fuelBurned + L.airCompressed - L.airVented - L.airSpilled;
    o.massAudit = o.mp.internalMass - expected;
    o.energyAudit = L.batteryChemical - L.batteryOut - L.batteryLoss;
  }

  private trueValues(): TrueValues {
    const o = this.outputs;
    const s = this.state;
    return {
      depthKeel: o.depthKeel,
      pressureKeel: o.pressureKeel,
      heading: o.euler.heading,
      pitch: o.euler.pitch,
      roll: o.euler.roll,
      q: s.body.omega.y * RAD,
      r: s.body.omega.z * RAD,
      u: s.body.vel.x,
      v: s.body.vel.y,
      altitude: o.altitude,
      gravity: this.env.cfg.gravity,
      atm: this.env.cfg.atmosphericPressure,
      declination: this.env.cfg.magneticDeclination,
    };
  }

  private evaluateAlarms(): void {
    const s = this.state;
    const o = this.outputs;
    const cfg = this.vessel;
    const stuck: string[] = [];
    const noHyd: string[] = [];
    const hyd = hydraulicFactor(cfg, s) > 0;
    const checkValve = (name: string, v: { cmd: number; pos: number; stuck: boolean }, hydraulic = true) => {
      if (Math.abs(v.cmd - v.pos) > 0.02) {
        if (v.stuck) stuck.push(name);
        else if (!hyd && hydraulic !== false) noHyd.push(name);
      }
    };
    for (const t of cfg.ballast.tanks) {
      checkValve(t.ventValve.name, s.ballast[t.id].vent);
      checkValve(t.blowValve.name, s.ballast[t.id].blow);
      checkValve(t.emergencyBlowValve.name, s.ballast[t.id].emergencyBlow, t.emergencyBlowValve.hydraulic);
    }
    checkValve(cfg.compensation.inletValve.name, s.compensation.inlet);
    checkValve(cfg.compensation.dischargeValve.name, s.compensation.discharge);
    cfg.compensation.tankValves.forEach((v) => checkValve(v.name, s.compensation.tankValves[v.id]));
    for (const b of cfg.compensation.heelBranches ?? []) if (s.compensation.tankValves[b.valve.id]) checkValve(b.valve.name, s.compensation.tankValves[b.valve.id]);
    for (const [sys, st] of [
      [cfg.trim, s.trim],
      [cfg.heel, s.heel],
    ] as const) {
      checkValve(sys.valveA.name, st.valveA);
      checkValve(sys.valveB.name, st.valveB);
      checkValve(sys.directionValve.name, st.direction);
    }
    for (const b of cfg.hpAir.banks) checkValve(b.valve.name, s.hpAir.banks[b.id].valve, b.valve.hydraulic);
    if (cfg.compensation.transfer && s.compensation.transfer) {
      checkValve(cfg.compensation.transfer.directionValve.name, s.compensation.transfer.direction);
      checkValve('Isolamento BTC A', s.compensation.transfer.valveA);
      checkValve('Isolamento BTC B', s.compensation.transfer.valveB);
    }
    const failedPumps: string[] = [];
    if (s.compensation.transfer?.pump.failed) failedPumps.push('Bomba de transferência de compensação (BTC)');
    if (s.compensation.pump.failed) failedPumps.push(cfg.compensation.pump.name);
    if (s.trim.pump.failed) failedPumps.push(cfg.trim.pump.name);
    if (s.heel.pump.failed) failedPumps.push(cfg.heel.pump.name);
    if (s.propulsion.failed) failedPumps.push('Motor elétrico principal');
    let hpMin = Infinity;
    for (const b of cfg.hpAir.banks) hpMin = Math.min(hpMin, bankPressure(cfg.hpAir, b.id, s.hpAir.banks[b.id].mass) / 1e5);
    evaluateAlarms(
      {
        cfg,
        s,
        depthTrue: o.depthKeel,
        altitude: o.altitude,
        verticalSpeed: o.verticalSpeed,
        pitch: o.euler.pitch,
        roll: o.euler.roll,
        netBuoyancyKg: o.netBuoyancyKg,
        hpMinPressureBar: hpMin,
        stuckValves: stuck,
        unpoweredValves: noHyd,
        failedPumps,
        contact: s.contact,
        speed: s.body.vel.x,
        declination: this.env.cfg.magneticDeclination,
      },
      this.config.settings.dt,
    );
  }

  /** Recalcula as grandezas derivadas para a interface a partir do estado atual. */
  computeOutputs(mpIn?: MassProps): void {
    const s = this.state;
    const cfg = this.vessel;
    const env = this.env;
    const R = qToMat3(s.body.quat);
    const pos = s.body.pos;
    const rho = env.densityAt(Math.max(0, pos.z));
    const mp = mpIn ?? computeMassProps(cfg, s, this.light, rho);
    const fi = this.forceInputs(mp);
    fi.waveCache = this.waveCache;
    const forces = computeForces({ pos: s.body.pos, quat: s.body.quat, vel: s.body.vel, omega: s.body.omega }, fi);
    // copia a imersão por fatia (o buffer é reutilizado)
    forces.hs = { ...forces.hs, sliceImmersion: Float64Array.from(forces.hs.sliceImmersion) };
    const e = qToEuler(s.body.quat);
    const depthOf = makeDepthOf(pos, R);
    const depthKeel = depthOf(cfg.hull.keelRef);
    const velNED = mulMat3Vec(R, s.body.vel);
    const bottom = env.bottomDepthAt(pos.x, pos.y);
    const g = env.cfg.gravity;
    const B = forces.hs.center;
    const G = mp.cg;
    const W = mp.mass * g;
    const dispKg = rho * forces.displacedVolume;
    const BGvert = G.z - B.z;
    // momentos hidrostáticos (peso + empuxo) no corpo e rigidez por diferenças finitas
    const m0 = this.hydrostaticMoment(mp, s.body.quat);
    const d = 0.003;
    const mP = this.hydrostaticMoment(mp, qFromEulerLocal(e.phi, e.theta + d, e.psi));
    const mR = this.hydrostaticMoment(mp, qFromEulerLocal(e.phi + d, e.theta, e.psi));
    // rigidez com sinal: ≤ 0 = equilíbrio instável (ou indiferente) — sem previsão linear nesse caso
    const pitchK = -(mP.y - m0.y) / d;
    const rollK = -(mR.x - m0.x) / d;
    const pitchStable = pitchK > MIN_STIFFNESS;
    const rollStable = rollK > MIN_STIFFNESS;
    const pitchStiff = Math.max(1, pitchK);
    const rollStiff = Math.max(1, rollK);
    const hpBar = s.hpAir.manifoldPressure / 1e5;
    this.outputs = {
      mp,
      forces,
      euler: { roll: e.phi * RAD, pitch: e.theta * RAD, heading: wrap360(e.psi * RAD) },
      depthAxis: pos.z,
      depthKeel,
      pressureKeel: this.keelPressure(depthKeel, R),
      bottomDepth: bottom,
      altitude: bottom - Math.max(depthKeel, pos.z + cfg.hull.diameter / 2),
      velNED,
      verticalSpeed: velNED.z,
      speed: s.body.vel.x,
      speedOverGround: Math.sqrt(velNED.x * velNED.x + velNED.y * velNED.y),
      courseOverGround: wrap360(Math.atan2(velNED.y, velNED.x) * RAD),
      netBuoyancyKg: dispKg - mp.mass,
      reserveKg: rho * (this.geom.volume - this.vessel.hull.compressibility * env.gaugePressureAt(Math.max(0, pos.z)) * this.compressibleVolume) - mp.mass,
      surfaced: forces.hs.immersedFraction < 0.995,
      displacementKg: dispKg,
      depthRateCalc: s.nav.depthRate,
      rhoLocal: rho,
      seaTemp: env.temperatureAt(Math.max(0, pos.z)),
      salinity: env.salinityAt(Math.max(0, pos.z)),
      staticPitchMoment: m0.y,
      staticRollMoment: m0.x,
      weightTrimMoment: -W * (G.x - B.x),
      weightHeelMoment: W * (G.y - B.y),
      pitchStiffness: pitchStiff,
      rollStiffness: rollStiff,
      pitchStiffnessSigned: pitchK,
      rollStiffnessSigned: rollK,
      pitchStable,
      rollStable,
      staticPitchEq: pitchStable ? clamp((e.theta + m0.y / pitchStiff) * RAD, -90, 90) : e.theta * RAD,
      staticRollEq: rollStable ? clamp((e.phi + m0.x / rollStiff) * RAD, -180, 180) : e.phi * RAD,
      BG: BGvert,
      airIntake: s.snorkel.headValveOpen,
      hpManifoldBar: hpBar,
      massAudit: this.outputs ? this.outputs.massAudit : 0,
      energyAudit: this.outputs ? this.outputs.energyAudit : 0,
      rpm: (s.propulsion.omega * 60) / (2 * Math.PI),
    };
  }

  /** Pressão na tomada da quilha, incluindo a pressão dinâmica das ondas. */
  private keelPressure(depthKeel: number, R: Mat3): number {
    const env = this.env;
    let p = env.pressureAt(depthKeel);
    const w = env.waves;
    if (w.active && depthKeel < w.cutoffDepth) {
      const k = this.vessel.hull.keelRef;
      const n = this.state.body.pos.x + R[0] * k.x;
      const e = this.state.body.pos.y + R[3] * k.x;
      const kin = { vn: 0, ve: 0, vz: 0, an: 0, ae: 0, az: 0, pd: 0 };
      w.kinematics(n, e, Math.max(0, depthKeel), this.state.t, kin);
      p += env.densityAt(Math.max(0, depthKeel)) * kin.pd;
    }
    return Math.max(env.cfg.atmosphericPressure, p);
  }

  /** Momento (corpo) de peso + empuxo para uma atitude dada, posição fixa. */
  hydrostaticMoment(mp: MassProps, quat: Quat): Vec3 {
    const R = qToMat3(quat);
    const pos = this.state.body.pos;
    const hs = computeHydrostaticsLocal(this.geom, pos, R, this.scratch2);
    const rho = this.env.densityAt(Math.max(0, pos.z));
    const g = this.env.cfg.gravity;
    const dp = this.env.gaugePressureAt(Math.max(0, pos.z));
    const vol = Math.max(0, hs.volume - this.vessel.hull.compressibility * dp * this.compressibleVolume * hs.immersedFraction);
    const Wb = mulMat3TVecLocal(R, { x: 0, y: 0, z: mp.mass * g });
    const Bb = mulMat3TVecLocal(R, { x: 0, y: 0, z: -rho * g * vol });
    const mw = vCrossLocal(mp.cg, Wb);
    const mb = vCrossLocal(hs.center, Bb);
    return { x: mw.x + mb.x, y: mw.y + mb.y, z: mw.z + mb.z };
  }

  /** Pose "anterior" da interpolação visual = pose atual (após ajustes feitos fora de step()). */
  resetInterpolation(): void {
    this.prevPos = { ...this.state.body.pos };
    this.prevQuat = { ...this.state.body.quat };
  }

  /** Inicializa as leituras dos sensores com os valores verdadeiros atuais. */
  primeSensors(): void {
    this.computeOutputs();
    const s = this.state;
    for (const k in s.sensors) {
      s.sensors[k].filtered = 0;
      s.sensors[k].value = 0;
    }
    updateSensors(this.vessel, s, this.trueValues(), this.config.settings.dt, false);
    s.nav.prevDepth = 0.5 * (s.sensors.PRF1.value + s.sensors.PRF2.value);
    s.nav.depthRate = 0;
    this.refreshReadings();
    this.outputs.depthRateCalc = 0;
    this.primeElectrical();
  }

  /**
   * Fecha o balanço elétrico com passo nulo (dt = 0): tensão, corrente e
   * cargas ficam coerentes com o estado ANTES do primeiro avanço (sem
   * alterar SoC, combustível ou balanços, que são integrados em dt).
   */
  primeElectrical(): void {
    const s = this.state;
    const cfg = this.vessel;
    const ctx = { dt: 0, airIntakeAvailable: s.snorkel.headValveOpen } as unknown as StepContext;
    let gen = 0;
    for (const g of cfg.electrical.generators) if (s.electrical.generators[g.id].status === 'EM CARGA') gen += g.ratedPower;
    const demands: Record<string, number> = {
      MEP: s.propulsion.elecPower,
      BC: s.compensation.pump.power,
      BTC: s.compensation.transfer?.pump.power ?? 0,
      BT: s.trim.pump.power,
      BB: s.heel.pump.power,
      HID: s.hydraulics.power,
      COMP: 0,
      HOTEL: cfg.electrical.hotelLoad,
      NAV: cfg.electrical.navLoad,
    };
    updateElectrical(cfg.electrical, s, ctx, demands, gen, s.propulsion.elecPower);
  }

  /** Avança a simulação por um intervalo de tempo de simulação (s). Retorna nº de passos. */
  advanceSim(simSeconds: number): number {
    const n = Math.round(simSeconds / this.config.settings.dt);
    for (let i = 0; i < n; i++) this.step();
    return n;
  }
}

