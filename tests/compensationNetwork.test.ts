/**
 * REDE DA COMPENSAÇÃO: as vazões por trecho (usadas pelos diagramas 2D e 3D)
 * seguem o estado do circuito — válvulas, bomba e sentido — e conservam massa.
 */
import { describe, it, expect } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import type { SimulationEngine } from '../src/sim/core/engine';
import { computeMassProps } from '../src/sim/physics/massProperties';
import { defaultVessel } from '../src/sim/config/defaultVessel';
import { upgradeCompensationLayout } from '../src/sim/config/compensationLayout';
import { compensationFlows, compensationNodes, manifoldSegments, type ManifoldSegment } from '../src/sim/systems/compensationNetwork';

// mesmo arranjo do diagrama 2D: bomba à esquerda, TB-BB, TC (central), TB-BE, admissão à direita
const X_PUMP = 0;
const X_BB = 10;
const X_TC = 20;
const X_BE = 30;
const X_INLET = 40;

function net(e: SimulationEngine) {
  const f = compensationFlows(e.vessel.compensation, e.state.compensation, e.vessel.heel, e.state.heel);
  const segs = manifoldSegments(compensationNodes(f, X_INLET, X_PUMP, { TBBB: X_BB, TC: X_TC, TBBE: X_BE }), f.tol);
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

  it('admitindo (V-AM e os três ramais abertos): da admissão para os três tanques, com conservação', () => {
    const e = buildScenario('submerso_50');
    for (const v of ['VC', 'VCBB', 'VCBE']) valve(e, v, true);
    valve(e, 'inlet', true);
    e.advanceSim(15);
    const { f, seg } = net(e);
    expect(f.qIn).toBeGreaterThan(1e-3);
    expect(f.tanks.TC).toBeGreaterThan(0);
    expect(f.tanks.TBBB).toBeGreaterThan(0);
    expect(f.tanks.TBBE).toBeGreaterThan(0);
    // ramais laterais simétricos; o central (maior) recebe mais
    expect(f.tanks.TBBB).toBeCloseTo(f.tanks.TBBE, 8);
    expect(f.tanks.TC).toBeGreaterThan(f.tanks.TBBB);
    // conservação: o que entra pela admissão vai para os tanques
    expect(f.tanks.TC + f.tanks.TBBB + f.tanks.TBBE).toBeCloseTo(f.qIn, 4);
    // sentido: x decrescente (da admissão, à direita, para os tanques)
    expect(seg('TBBE', 'inlet').q).toBeLessThan(0);
    expect(seg('TC', 'TBBE').q).toBeLessThan(0);
    expect(seg('TBBB', 'TC').q).toBeLessThan(0);
    // trecho da bomba parada fica sem vazão
    expect(seg('pump', 'TBBB').q).toBe(0);
  });

  it('esgotando (BC + V-DM, V-AM fechada): dos tanques para a bomba', () => {
    const e = buildScenario('submerso_50');
    for (const v of ['VC', 'VCBB', 'VCBE']) valve(e, v, true);
    valve(e, 'discharge', true);
    e.advanceSim(8);
    pump(e, true);
    e.advanceSim(15);
    const { f, seg } = net(e);
    expect(f.qOut).toBeGreaterThan(1e-3);
    expect(f.tanks.TC).toBeLessThan(0);
    expect(f.tanks.TBBB).toBeLessThan(0);
    expect(f.tanks.TBBE).toBeLessThan(0);
    expect(-(f.tanks.TC + f.tanks.TBBB + f.tanks.TBBE)).toBeCloseTo(f.qOut, 6);
    // sentido: para a bomba (x decrescente)
    expect(seg('pump', 'TBBB').q).toBeLessThan(0);
    expect(seg('pump', 'TBBB').q).toBeCloseTo(-f.qOut, 6);
    expect(seg('TC', 'TBBE').q).toBeLessThan(0);
    // admissão fechada: trecho até ela parado
    expect(seg('TBBE', 'inlet').q).toBe(0);
  });

  it('só o ramal central aberto: os tanques de banda e seus trechos ficam isolados', () => {
    const e = buildScenario('submerso_50');
    const bb0 = e.state.heel.tankA.mass;
    const be0 = e.state.heel.tankB.mass;
    valve(e, 'VC', true);
    valve(e, 'discharge', true);
    e.advanceSim(8);
    pump(e, true);
    e.advanceSim(15);
    const { f, seg } = net(e);
    expect(f.tanks.TBBB).toBe(0);
    expect(f.tanks.TBBE).toBe(0);
    expect(f.tanks.TC).toBeLessThan(0);
    expect(seg('TC', 'TBBE').q).toBe(0);
    expect(seg('TBBE', 'inlet').q).toBe(0);
    expect(seg('pump', 'TBBB').q).toBeLessThan(0);
    expect(e.state.heel.tankA.mass).toBe(bb0);
    expect(e.state.heel.tankB.mass).toBe(be0);
  });

  it('ramal de um bordo só: a compensação pelo TB-BE muda a banda', () => {
    const e = buildScenario('submerso_50');
    valve(e, 'VCBE', true);
    valve(e, 'inlet', true);
    e.advanceSim(60);
    expect(e.state.heel.tankB.mass).toBeGreaterThan(e.state.heel.tankA.mass + 100);
    // peso a boreste (y > 0) ⇒ CG desloca para boreste
    expect(computeMassProps(e.vessel, e.state, e.light, 1025).cg.y).toBeGreaterThan(0);
  });

  it('bomba com V-DM fechada (recalque bloqueado): sem vazão em lugar nenhum', () => {
    const e = buildScenario('submerso_50');
    valve(e, 'VC', true);
    valve(e, 'VCBB', true);
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
    for (const v of ['VC', 'VCBB', 'VCBE']) valve(e, v, true);
    valve(e, 'inlet', true);
    valve(e, 'discharge', true);
    e.advanceSim(8);
    pump(e, true);
    e.advanceSim(15);
    const { f, seg } = net(e);
    expect(f.qIn).toBeGreaterThan(0);
    expect(f.qOut).toBeGreaterThan(0);
    // o trecho junto à bomba leva exatamente a vazão de descarga para ela
    expect(seg('pump', 'TBBB').q).toBeCloseTo(-f.qOut, 6);
    // o trecho junto à admissão leva a vazão de admissão para dentro (a menos da
    // diferença entre a densidade do mar e a nominal, ~0,1 %)
    expect(Math.abs(seg('TBBE', 'inlet').q + f.qIn)).toBeLessThan(0.005 * f.qIn);
  });
});

describe('Compensação: sequência automática com os três tanques', () => {
  it('quantidade que cabe no central: só o TC é usado (banda inalterada)', () => {
    const e = buildScenario('submerso_50');
    const bb0 = e.state.heel.tankA.mass;
    const be0 = e.state.heel.tankB.mass;
    const tc0 = e.state.compensation.tanks.TC.mass;
    applyCommand(e, { type: 'dosing', system: 'compensation', mode: 'admitir', kg: 1500 });
    e.advanceSim(400);
    expect(e.state.compensation.dosing?.phase).toBe('concluido');
    expect(e.state.compensation.tanks.TC.mass - tc0).toBeGreaterThan(1300);
    expect(e.state.heel.tankA.mass).toBe(bb0);
    expect(e.state.heel.tankB.mass).toBe(be0);
  });

  it('quantidade maior que o espaço do central: os ramais de banda abrem, por igual', () => {
    const e = buildScenario('submerso_50');
    const room = e.vessel.compensation.tanks[0].capacity * 1025 - e.state.compensation.tanks.TC.mass;
    applyCommand(e, { type: 'dosing', system: 'compensation', mode: 'admitir', kg: room + 2000 });
    e.advanceSim(120);
    expect(e.state.compensation.tankValves.VCBB.pos).toBeGreaterThan(0.9);
    expect(e.state.compensation.tankValves.VCBE.pos).toBeGreaterThan(0.9);
    e.advanceSim(1800);
    expect(e.state.compensation.dosing?.phase).toBe('concluido');
    // banda preservada: os dois laterais receberam o mesmo
    expect(e.state.heel.tankA.mass).toBeCloseTo(e.state.heel.tankB.mass, 3);
    expect(e.state.heel.tankA.mass).toBeGreaterThan(e.vessel.heel.tankA.initialVolume * 1025 + 300);
    // válvulas fechadas ao final
    for (const id of ['VC', 'VCBB', 'VCBE']) expect(e.state.compensation.tankValves[id].pos).toBeLessThan(0.01);
  });
});

describe('Compensação: configurações antigas', () => {
  it('preferências salvas com TC-1/TC-2 passam ao arranjo de três tanques, mantendo a bomba', () => {
    const old = defaultVessel();
    old.compensation = {
      ...old.compensation,
      tanks: [
        { id: 'TC1', name: 'TC-1', capacity: 12, height: 1.4, center: { x: 6, y: 0, z: 2.3 }, initialVolume: 6 },
        { id: 'TC2', name: 'TC-2', capacity: 12, height: 1.4, center: { x: -1, y: 0, z: 2.3 }, initialVolume: 6 },
      ],
      tankValves: [old.compensation.tankValves[0], { ...old.compensation.tankValves[0], id: 'VC2' }],
      pump: { ...old.compensation.pump, ratedFlow: 0.02 },
    };
    delete old.compensation.heelBranches;
    const up = upgradeCompensationLayout(old);
    expect(up.compensation.tanks.map((t) => t.id)).toEqual(['TC']);
    expect(up.compensation.heelBranches?.map((b) => b.valve.id)).toEqual(['VCBB', 'VCBE']);
    expect(up.compensation.pump.ratedFlow).toBe(0.02);
    expect(up.heel.tankA.center.x).toBe(up.compensation.tanks[0].center.x);
  });
});
