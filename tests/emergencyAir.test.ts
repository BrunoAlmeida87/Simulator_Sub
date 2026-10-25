import { describe, expect, it } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { bankCircuit, bankPressure, updateCompressor, updateHpManifold } from '../src/sim/systems/hpAir';
import { updateBallastTank } from '../src/sim/systems/ballast';
import { updateValve } from '../src/sim/systems/components';
import { qToMat3 } from '../src/sim/core/math';
import { makeDepthOf, type StepContext } from '../src/sim/core/context';
import type { SimulationEngine } from '../src/sim/core/engine';
import type { AirCircuit } from '../src/sim/config/types';
import { deserializeEngine, serializeEngine } from '../src/sim/persistence';

const banks = (e: SimulationEngine, circuit: AirCircuit) => e.vessel.hpAir.banks.filter((b) => bankCircuit(b) === circuit);
const mass = (e: SimulationEngine, circuit: AirCircuit) => banks(e, circuit).reduce((sum, b) => sum + e.state.hpAir.banks[b.id].mass, 0);
function context(e: SimulationEngine): StepContext {
  const R = qToMat3(e.state.body.quat);
  return {
    cfg: e.vessel,
    env: e.env,
    geom: e.geom,
    dt: 1,
    t: 0,
    R,
    pos: e.state.body.pos,
    depthOf: makeDepthOf(e.state.body.pos, R),
    busPowered: true,
    hydraulicFactor: 1,
    rhoLocal: 1025,
    seaTempK: 293.15,
    airIntakeAvailable: true,
    hydraulicDemand: 0,
    log: () => {},
  };
}

describe('Sopro de emergência: reserva e alimentação independentes', () => {
  it('ampolas dedicadas têm a mesma pressão e metade do volume normal', () => {
    const e = buildScenario('submerso_50');
    for (const b of banks(e, 'emergency')) {
      expect(b.initialPressure).toBe(banks(e, 'normal')[0].initialPressure);
      expect(b.volume).toBe(banks(e, 'normal')[0].volume / 2);
      expect(e.state.hpAir.banks[b.id].valve.pos).toBe(0);
    }
  });

  it('sopro normal preserva as ampolas mesmo com seus isolamentos abertos', () => {
    const e = buildScenario('submerso_50');
    for (const b of banks(e, 'emergency')) applyCommand(e, { type: 'hpBankValve', bank: b.id, open: true });
    const reserve = mass(e, 'emergency');
    const normal = mass(e, 'normal');
    applyCommand(e, { type: 'mbtBlow', tank: 'ALL', open: true });
    e.advanceSim(8);
    expect(mass(e, 'normal')).toBeLessThan(normal);
    expect(mass(e, 'emergency')).toBeCloseTo(reserve, 8);
    expect(Math.abs(e.outputs.massAudit)).toBeLessThan(1e-6);
  });

  it('emergência fecha suspiros, usa só as ampolas e pode ser encerrada', () => {
    const e = buildScenario('submerso_50');
    const normal = mass(e, 'normal');
    const reserve = mass(e, 'emergency');
    applyCommand(e, { type: 'mbtVent', tank: 'ALL', open: true });
    applyCommand(e, { type: 'emergencyBlow' });
    e.advanceSim(8);
    expect(mass(e, 'normal')).toBeCloseTo(normal, 8);
    expect(mass(e, 'emergency')).toBeLessThan(reserve);
    for (const t of Object.values(e.state.ballast)) {
      expect(t.vent.cmd).toBe(0);
      expect(t.blow.cmd).toBe(0);
      expect(t.mdotEmergencyBlow).toBeGreaterThan(0);
    }
    expect(Math.abs(e.outputs.massAudit)).toBeLessThan(1e-6);
    applyCommand(e, { type: 'emergencyBlow', open: false });
    e.advanceSim(3);
    const stopped = mass(e, 'emergency');
    e.advanceSim(2);
    expect(mass(e, 'emergency')).toBeCloseTo(stopped, 8);
    expect(e.state.hpAir.compressorCmd).toBe(false);
  });

  it('pressões de circuitos distintos não se equalizam', () => {
    const e = buildScenario('submerso_50');
    for (const b of banks(e, 'emergency')) {
      e.state.hpAir.banks[b.id].mass /= 2;
      e.state.hpAir.banks[b.id].valve.pos = e.state.hpAir.banks[b.id].valve.cmd = 1;
    }
    updateHpManifold(e.vessel.hpAir, e.state, context(e));
    expect(e.state.hpAir.manifoldPressure / 1e5).toBeCloseTo(250, 8);
    expect(e.state.hpAir.emergencyManifoldPressure / 1e5).toBeCloseTo(125, 8);
  });

  it('compressor recarrega ambos isolados, sem ultrapassar a pressão máxima', () => {
    const e = buildScenario('superficie');
    e.state.hpAir.compressorCmd = true;
    for (const b of e.vessel.hpAir.banks) {
      e.state.hpAir.banks[b.id].mass -= 0.01;
      e.state.hpAir.banks[b.id].valve.pos = e.state.hpAir.banks[b.id].valve.cmd = 0;
    }
    const result = updateCompressor(e.vessel.hpAir, e.state, context(e));
    expect(result.added).toBeCloseTo(0.04, 8);
    for (const b of e.vessel.hpAir.banks) expect(bankPressure(e.vessel.hpAir, b.id, e.state.hpAir.banks[b.id].mass)).toBeCloseTo(b.maxPressure, 6);
  });

  it('emergência solicita compressor automaticamente e prioriza sua reserva', () => {
    const e = buildScenario('superficie');
    for (const b of e.vessel.hpAir.banks) e.state.hpAir.banks[b.id].mass /= 2;
    const normal = mass(e, 'normal');
    const reserve = mass(e, 'emergency');
    applyCommand(e, { type: 'emergencyBlow' });
    const result = updateCompressor(e.vessel.hpAir, e.state, context(e));
    expect(e.state.hpAir.compressorCmd).toBe(false);
    expect(result.added).toBeCloseTo(e.vessel.hpAir.compressor.massFlow, 8);
    expect(result.power).toBe(e.vessel.hpAir.compressor.power);
    expect(mass(e, 'normal')).toBe(normal);
    expect(mass(e, 'emergency') - reserve).toBeCloseTo(result.added, 8);
  });

  it('no motor completo, o compressor alimenta a emergência e entra no balanço elétrico', () => {
    const e = buildScenario('superficie');
    applyCommand(e, { type: 'emergencyBlow' });
    e.advanceSim(5);
    expect(e.state.hpAir.compressorCmd).toBe(false);
    expect(e.state.hpAir.compressorRunning).toBe(true);
    expect(e.state.ledger.airCompressed).toBeGreaterThan(0);
    expect(e.state.electrical.loads.COMP).toBe(e.vessel.hpAir.compressor.power);
    expect(Object.values(e.state.ballast).some((t) => t.mdotEmergencyBlow > 0)).toBe(true);
    expect(Math.abs(e.outputs.massAudit)).toBeLessThan(1e-6);
  });

  it.each(['busPowered', 'airIntakeAvailable'] as const)('compressor não fornece ar sem %s', (prerequisite) => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'emergencyBlow' });
    for (const b of banks(e, 'emergency')) e.state.hpAir.banks[b.id].mass /= 2;
    const reserve = mass(e, 'emergency');
    const ctx = context(e);
    ctx[prerequisite] = false;
    expect(updateCompressor(e.vessel.hpAir, e.state, ctx)).toEqual({ added: 0, power: 0 });
    expect(mass(e, 'emergency')).toBe(reserve);
  });

  it('orifícios grandes não criam ar além da massa disponível nas reservas', () => {
    const e = buildScenario('submerso_50');
    const cfg = structuredClone(e.vessel.ballast.tanks[0]);
    cfg.blowArea = 1;
    const st = e.state.ballast[cfg.id];
    st.water = cfg.volume / 2;
    st.blow.pos = st.blow.cmd = st.emergencyBlow.pos = st.emergencyBlow.cmd = 1;
    const result = updateBallastTank(cfg, st, context(e), 250e5, 293.15, 250e5, 0.01, 0.02);
    expect(result.airDrawn).toBeCloseTo(0.01, 10);
    expect(result.emergencyAirDrawn).toBeCloseTo(0.02, 10);
    expect(st.air).toBeCloseTo(0.03, 10);
  });

  it('sessão antiga recebe reserva e válvulas novas; emergência salva continua exatamente', () => {
    const old = serializeEngine(buildScenario('submerso_50'), 'antigo');
    old.config.vessel.hpAir.banks = old.config.vessel.hpAir.banks.filter((b) => bankCircuit(b) === 'normal');
    delete (old.state.hpAir as Partial<typeof old.state.hpAir>).emergencyManifoldPressure;
    delete old.state.hpAir.banks.AE1;
    delete old.state.hpAir.banks.AE2;
    for (const t of old.config.vessel.ballast.tanks) delete (t as Partial<typeof t>).emergencyBlowValve;
    for (const st of Object.values(old.state.ballast)) {
      delete (st as Partial<typeof st>).emergencyBlow;
      delete (st as Partial<typeof st>).mdotEmergencyBlow;
    }
    const e = deserializeEngine(old);
    expect(banks(e, 'emergency')).toHaveLength(2);
    applyCommand(e, { type: 'emergencyBlow' });
    e.advanceSim(4);
    const restored = deserializeEngine(serializeEngine(e, 'emergência'));
    e.advanceSim(3);
    restored.advanceSim(3);
    expect(restored.state).toEqual(e.state);
    expect(Math.abs(e.outputs.massAudit)).toBeLessThan(1e-6);
  });
  it('falha hidráulica não impede o sopro de emergência; válvulas hidráulicas continuam paradas', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'failure', target: 'hydraulics', active: true });
    e.advanceSim(5);
    const reserve = mass(e, 'emergency');
    const vents = e.vessel.ballast.tanks.map((t) => e.state.ballast[t.id].vent.pos);
    applyCommand(e, { type: 'emergencyBlow', open: true });
    applyCommand(e, { type: 'mbtBlow', tank: 'ALL', open: true });
    e.advanceSim(8);
    for (const b of banks(e, 'emergency')) expect(e.state.hpAir.banks[b.id].valve.pos).toBe(1);
    for (const t of e.vessel.ballast.tanks) {
      expect(e.state.ballast[t.id].emergencyBlow.pos).toBe(1);
      expect(e.state.ballast[t.id].blow.pos).toBe(0); // sopro normal é hidráulico
    }
    expect(e.vessel.ballast.tanks.map((t) => e.state.ballast[t.id].vent.pos)).toEqual(vents);
    expect(reserve - mass(e, 'emergency')).toBeGreaterThan(100);
    expect(Math.abs(e.outputs.massAudit)).toBeLessThan(1e-6);
    // e fecha de novo sem hidráulica
    applyCommand(e, { type: 'emergencyBlow', open: false });
    e.advanceSim(4);
    for (const t of e.vessel.ballast.tanks) expect(e.state.ballast[t.id].emergencyBlow.pos).toBe(0);
  });

  it('válvula sem acionamento hidráulico não consome da planta', () => {
    const e = buildScenario('submerso_50');
    const t = e.vessel.ballast.tanks[0];
    const st = e.state.ballast[t.id];
    st.emergencyBlow.cmd = 1;
    expect(updateValve(t.emergencyBlowValve, st.emergencyBlow, 0.5, false)).toBe(0);
    expect(st.emergencyBlow.pos).toBeGreaterThan(0);
    st.blow.cmd = 1;
    expect(updateValve(t.blowValve, st.blow, 0.5, false)).toBe(0);
    expect(st.blow.pos).toBe(0);
    expect(updateValve(t.blowValve, st.blow, 0.5, true)).toBeGreaterThan(0);
  });
});
