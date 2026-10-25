/** Sequência automática de compensação: capacidade e falta de progresso (auditoria A14). */
import { describe, expect, it } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { compensationBranches, compensationWater, tankCapacityMass } from '../src/sim/systems/internalTanks';
import type { SimulationEngine } from '../src/sim/core/engine';

const branches = (e: SimulationEngine) => compensationBranches(e.vessel.compensation, e.state.compensation, e.vessel.heel, e.state.heel);
const water = (e: SimulationEngine) => compensationWater(e.vessel.compensation, e.state.compensation, e.vessel.heel, e.state.heel);

describe('Dosagem de compensação', () => {
  it('tanques cheios: admissão não começa, informa o motivo e não abre a entrada do mar', () => {
    const e = buildScenario('pairando');
    for (const b of branches(e)) b.st.mass = tankCapacityMass(b.cfg);
    const m0 = water(e);
    applyCommand(e, { type: 'dosing', system: 'compensation', mode: 'admitir', kg: 100 });
    e.advanceSim(5);
    const d = e.state.compensation.dosing!;
    expect(d.active).toBe(false);
    expect(d.moved).toBe(0);
    expect(d.message).toMatch(/Sem espaço/);
    expect(e.state.compensation.inlet.pos).toBe(0);
    expect(water(e)).toBeCloseTo(m0, 6);
  });

  it('pedido maior que o espaço livre é limitado à capacidade e informado', () => {
    const e = buildScenario('pairando');
    const bs = branches(e);
    for (const b of bs) b.st.mass = tankCapacityMass(b.cfg);
    const main = bs.find((b) => !b.heel)!;
    main.st.mass -= 400;
    applyCommand(e, { type: 'dosing', system: 'compensation', mode: 'admitir', kg: 2000 });
    for (let i = 0; i < 60 / 0.02 && e.state.compensation.dosing!.active; i++) e.step();
    e.advanceSim(10);
    const d = e.state.compensation.dosing!;
    expect(d.active).toBe(false);
    expect(d.requested).toBe(2000);
    expect(d.target).toBeLessThanOrEqual(400.5);
    expect(d.moved).toBeGreaterThan(300);
    expect(d.moved).toBeLessThan(450);
    expect(d.message).toMatch(/limitado à capacidade/);
    expect(e.state.compensation.inlet.pos).toBe(0);
  });

  it('sem vazão durante o escoamento: encerra em 15 s, fecha o circuito e diz quanto faltou', () => {
    const e = buildScenario('pairando');
    applyCommand(e, { type: 'dosing', system: 'compensation', mode: 'admitir', kg: 1500 });
    let n = 0;
    while (e.state.compensation.dosing!.phase !== 'escoando' && n++ < 5000) e.step();
    expect(e.state.compensation.dosing!.phase).toBe('escoando');
    e.advanceSim(1);
    // entrada do mar travada fechada no meio da sequência
    e.state.compensation.inlet.pos = 0;
    e.state.compensation.inlet.stuck = true;
    e.advanceSim(25);
    const d = e.state.compensation.dosing!;
    expect(d.active).toBe(false);
    expect(d.message).toMatch(/Sem vazão por 15 s.*faltaram \d+ kg/);
    expect(d.moved).toBeLessThan(1500);
    expect(e.state.compensation.inlet.cmd).toBe(0);
    for (const b of branches(e)) expect(e.state.compensation.tankValves[b.valveId].cmd).toBe(0);
  });
});
