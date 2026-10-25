/** Cálculo de compensação: viabilidade inclui o momento de banda (auditoria A06). */
import { describe, expect, it } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { solveNeutralCompensation } from '../src/sim/equilibrium';

const lateral = (mass: number, y: number) => ({ id: 'teste', name: 'Carga lateral', category: 'carga' as const, quantity: 1, unitMass: mass, position: { x: 0, y, z: 0 } });

describe('Cálculo de compensação', () => {
  it('condição padrão: viável, sem limites e com resíduos pequenos nos três graus', () => {
    const e = buildScenario('submerso_50');
    const sol = solveNeutralCompensation(e, e.state.body.pos.z, false);
    expect(sol.ok).toBe(true);
    expect(sol.limits).toEqual([]);
    expect(Math.abs(sol.residualKg)).toBeLessThan(5);
    expect(Math.abs(sol.residualRollMoment)).toBeLessThan(1000);
  });

  it('carga lateral pequena: os tanques de banda corrigem', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'cargoUpsert', load: lateral(300, 2) });
    const sol = solveNeutralCompensation(e, e.state.body.pos.z, false);
    expect(sol.ok).toBe(true);
    expect(Math.abs(sol.residualRollMoment)).toBeLessThan(1000);
  });

  it('carga lateral além da capacidade de banda: não é declarada viável e informa o limite', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'cargoUpsert', load: lateral(9000, 3) });
    const sol = solveNeutralCompensation(e, e.state.body.pos.z, false);
    expect(Math.abs(sol.residualKg)).toBeLessThan(5); // a massa ainda fecha
    expect(sol.ok).toBe(false);
    expect(sol.limits).toContain('banda');
    expect(Math.abs(sol.residualRollMoment)).toBeGreaterThan(1e5);
    expect(sol.message).toMatch(/banda/);
  });
});
