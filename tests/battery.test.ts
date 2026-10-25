/** Limites da bateria nos extremos de carga (auditoria A02). */
import { describe, expect, it } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import type { SimulationEngine } from '../src/sim/core/engine';

function withGenerators(soc: number): SimulationEngine {
  const e = buildScenario('superficie');
  e.state.electrical.soc = soc;
  applyCommand(e, { type: 'generator', id: 'GD1', run: true });
  applyCommand(e, { type: 'generator', id: 'GD2', run: true });
  e.advanceSim(40); // partida de 30 s
  return e;
}

describe('Bateria nos limites de carga', () => {
  it('vazia: os geradores recarregam e mantêm o barramento', () => {
    const e = withGenerators(0);
    const el = e.state.electrical;
    expect(el.energized).toBe(true);
    expect(el.current).toBeLessThan(-1000);
    expect(el.soc).toBeGreaterThan(0);
  });

  it('cheia: não aceita recarga e os geradores só cobrem a carga', () => {
    const e = withGenerators(1);
    const el = e.state.electrical;
    expect(el.soc).toBeLessThanOrEqual(1);
    expect(Math.abs(el.current)).toBeLessThan(5);
    // só a pequena recarga do que a bateria gastou durante a partida dos geradores
    expect(el.generation).toBeGreaterThanOrEqual(el.totalLoad - 1);
    expect(el.generation).toBeLessThan(el.totalLoad + 5000);
  });

  it('perto de cheia a recarga é reduzida, e o SoC nunca passa de 100 %', () => {
    const e = withGenerators(0.95);
    const half = -e.state.electrical.current;
    expect(half).toBeGreaterThan(1000);
    expect(half).toBeLessThan(e.vessel.electrical.battery.maxChargeCurrent * 0.6);
    for (let i = 0; i < 10; i++) {
      e.advanceSim(60);
      expect(e.state.electrical.soc).toBeLessThanOrEqual(1);
    }
    expect(-e.state.electrical.current).toBeLessThan(half);
  });

  it('vazia e sem geração: barramento desenergizado, sem corrente nem SoC negativo', () => {
    const e = buildScenario('submerso_50');
    e.state.electrical.soc = 0;
    e.advanceSim(2);
    const el = e.state.electrical;
    expect(el.energized).toBe(false);
    expect(el.current).toBe(0);
    expect(el.soc).toBe(0);
  });

  it('descarga não leva o SoC abaixo de zero num passo', () => {
    const e = buildScenario('submerso_50');
    e.state.electrical.soc = 1e-4 + 5e-4;
    applyCommand(e, { type: 'telegraph', rpm: 200 });
    for (let i = 0; i < 2000; i++) {
      e.step();
      expect(e.state.electrical.soc).toBeGreaterThanOrEqual(0);
    }
  });
});

import { updateElectrical } from '../src/sim/systems/electrical';
import type { StepContext } from '../src/sim/core/context';

describe('Balanço elétrico: demanda pedida × atendida (auditoria A01)', () => {
  it('sobrecarga sem geração: a parte não atendida aparece e o balanço fecha', () => {
    const e = buildScenario('submerso_50');
    const s = e.state;
    const L = s.ledger;
    const before = { req: L.loadRequested ?? 0, served: L.loadEnergy, un: L.loadUnserved ?? 0 };
    const dt = 0.02;
    updateElectrical(e.vessel.electrical, s, { dt } as StepContext, { teste: 10e6 }, 0, 0);
    const req = (L.loadRequested ?? 0) - before.req;
    const served = L.loadEnergy - before.served;
    const un = (L.loadUnserved ?? 0) - before.un;
    expect(req).toBeCloseTo(10e6 * dt, 3);
    expect(served).toBeLessThan(5e6 * dt);
    expect(un).toBeGreaterThan(5e6 * dt);
    expect(req - served - un).toBeCloseTo(0, 3);
    expect(s.electrical.unservedPower).toBeGreaterThan(5e6);
    expect(s.electrical.chargeLimited).toBe(true);
  });

  it('operação normal: demanda totalmente atendida', () => {
    const e = buildScenario('submerso_50');
    e.advanceSim(30);
    expect(e.state.electrical.unservedPower).toBe(0);
    expect(e.state.ledger.loadUnserved).toBe(0);
    expect(e.state.ledger.loadRequested).toBeGreaterThan(0);
  });

  it('barramento desenergizado: toda a demanda fica sem atender', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'breaker', closed: false });
    e.advanceSim(2);
    expect(e.state.electrical.energized).toBe(false);
    expect(e.state.electrical.unservedPower).toBeCloseTo(e.state.electrical.totalLoad, 6);
  });
});
