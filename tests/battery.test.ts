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
