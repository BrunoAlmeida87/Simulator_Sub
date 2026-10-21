/**
 * REDE DA COMPENSAÇÃO: as vazões por trecho (usadas pelos diagramas 2D e 3D)
 * seguem o estado do circuito — válvulas, bomba e sentido — e conservam massa.
 */
import { describe, it, expect } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import type { SimulationEngine } from '../src/sim/core/engine';
import { compensationFlows, compensationNodes, manifoldSegments, type ManifoldSegment } from '../src/sim/systems/compensationNetwork';

// mesmo arranjo do diagrama 2D: bomba à esquerda, tanques, admissão à direita
const X_PUMP = 0;
const X_TC2 = 10;
const X_TC1 = 20;
const X_INLET = 30;

function net(e: SimulationEngine) {
  const f = compensationFlows(e.vessel.compensation, e.state.compensation);
  const segs = manifoldSegments(compensationNodes(f, X_INLET, X_PUMP, { TC1: X_TC1, TC2: X_TC2 }), f.tol);
  const seg = (a: string, b: string) => segs.find((s: ManifoldSegment) => (s.from.id === a && s.to.id === b) || (s.from.id === b && s.to.id === a))!;
  return { f, segs, seg };
}

const valve = (e: SimulationEngine, v: string, open: boolean) => applyCommand(e, { type: 'valve', system: 'compensation', valve: v, open });
const pump = (e: SimulationEngine, run: boolean) => applyCommand(e, { type: 'pump', system: 'compensation', run });

describe('Compensação: vazões por trecho seguem o circuito', () => {
  it('tudo fechado: nenhum trecho com vazão', () => {
    const e = buildScenario('submerso_50');
    e.advanceSim(5);
    const { segs, f } = net(e);
    expect(f.qIn).toBe(0);
    expect(f.qOut).toBe(0);
    for (const s of segs) expect(s.q).toBe(0);
  });

  it('admitindo (V-AM e VC-1/VC-2 abertas): da admissão para os tanques, com conservação', () => {
    const e = buildScenario('submerso_50');
    valve(e, 'VC1', true);
    valve(e, 'VC2', true);
    valve(e, 'inlet', true);
    e.advanceSim(15);
    const { f, seg } = net(e);
    expect(f.qIn).toBeGreaterThan(1e-3);
    expect(f.tanks.TC1).toBeGreaterThan(0);
    expect(f.tanks.TC2).toBeGreaterThan(0);
    // conservação: o que entra pela admissão vai para os tanques
    expect(f.tanks.TC1 + f.tanks.TC2).toBeCloseTo(f.qIn, 4);
    // sentido: x decrescente (da admissão, à direita, para os tanques)
    expect(seg('TC1', 'inlet').q).toBeLessThan(0);
    expect(seg('TC2', 'TC1').q).toBeLessThan(0);
    // trecho da bomba parada fica sem vazão
    expect(seg('pump', 'TC2').q).toBe(0);
  });

  it('esgotando (BC + V-DM, V-AM fechada): dos tanques para a bomba', () => {
    const e = buildScenario('submerso_50');
    valve(e, 'VC1', true);
    valve(e, 'VC2', true);
    valve(e, 'discharge', true);
    e.advanceSim(8);
    pump(e, true);
    e.advanceSim(15);
    const { f, seg } = net(e);
    expect(f.qOut).toBeGreaterThan(1e-3);
    expect(f.tanks.TC1).toBeLessThan(0);
    expect(f.tanks.TC2).toBeLessThan(0);
    expect(-(f.tanks.TC1 + f.tanks.TC2)).toBeCloseTo(f.qOut, 6);
    // sentido: para a bomba (x decrescente)
    expect(seg('pump', 'TC2').q).toBeLessThan(0);
    expect(seg('pump', 'TC2').q).toBeCloseTo(-f.qOut, 6);
    expect(seg('TC2', 'TC1').q).toBeLessThan(0);
    // admissão fechada: trecho até ela parado
    expect(seg('TC1', 'inlet').q).toBe(0);
  });

  it('VC-1 fechada: o ramal e o trecho isolados não têm vazão', () => {
    const e = buildScenario('submerso_50');
    valve(e, 'VC2', true);
    valve(e, 'discharge', true);
    e.advanceSim(8);
    pump(e, true);
    e.advanceSim(15);
    const { f, seg } = net(e);
    expect(f.tanks.TC1).toBe(0);
    expect(f.tanks.TC2).toBeLessThan(0);
    expect(seg('TC2', 'TC1').q).toBe(0);
    expect(seg('TC1', 'inlet').q).toBe(0);
    expect(seg('pump', 'TC2').q).toBeLessThan(0);
  });

  it('bomba com V-DM fechada (recalque bloqueado): sem vazão em lugar nenhum', () => {
    const e = buildScenario('submerso_50');
    valve(e, 'VC1', true);
    valve(e, 'VC2', true);
    e.advanceSim(6);
    pump(e, true);
    e.advanceSim(10);
    const { f, segs } = net(e);
    expect(e.state.compensation.pump.deadhead).toBe(true);
    expect(f.qOut).toBe(0);
    for (const s of segs) expect(s.q).toBe(0);
  });

  it('admissão e bomba ao mesmo tempo: o excesso passa direto da admissão para a bomba', () => {
    const e = buildScenario('submerso_50');
    valve(e, 'VC1', true);
    valve(e, 'VC2', true);
    valve(e, 'inlet', true);
    valve(e, 'discharge', true);
    e.advanceSim(8);
    pump(e, true);
    e.advanceSim(15);
    const { f, seg } = net(e);
    expect(f.qIn).toBeGreaterThan(0);
    expect(f.qOut).toBeGreaterThan(0);
    // o trecho junto à bomba leva exatamente a vazão de descarga para ela
    expect(seg('pump', 'TC2').q).toBeCloseTo(-f.qOut, 6);
    // o trecho junto à admissão leva a vazão de admissão para dentro (a menos da
    // diferença entre a densidade do mar e a nominal, ~0,1 %)
    expect(Math.abs(seg('TC1', 'inlet').q + f.qIn)).toBeLessThan(0.005 * f.qIn);
  });
});
