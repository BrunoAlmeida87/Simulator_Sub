/**
 * Cargas a bordo deslocáveis (torpedos, tripulantes, mantimentos): massa total
 * constante, momento de trim = Σ m·Δx, pitch submerso coerente com W·BG,
 * comando registrado e arquivos antigos sem as cargas.
 */
import { describe, it, expect } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { trimBalance } from '../src/sim/forceVectors';
import { serializeEngine, deserializeEngine } from '../src/sim/persistence';

const stop = (e: ReturnType<typeof buildScenario>) => {
  applyCommand(e, { type: 'telegraph', rpm: 0 });
  applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'MANUAL' });
  applyCommand(e, { type: 'surface', id: 'bow', angle: 0 });
  applyCommand(e, { type: 'surface', id: 'stern', angle: 0 });
};

describe('Cargas deslocáveis a bordo', () => {
  it('na estiva fazem parte da condição de projeto: massa e centro de gravidade iguais aos de antes', () => {
    const e = buildScenario('pairando');
    e.computeOutputs();
    const cfg = structuredClone(e.config);
    delete cfg.vessel.mass.shiftLoads;
    const s = structuredClone(e.state);
    delete s.shiftLoads;
    const f = deserializeEngine({ ...serializeEngine(e, 'x'), config: cfg, state: s });
    f.computeOutputs();
    expect(e.outputs.mp.mass).toBeCloseTo(f.outputs.mp.mass, 3);
    expect(e.outputs.mp.cg.x).toBeCloseTo(f.outputs.mp.cg.x, 6);
    expect(e.outputs.mp.cg.z).toBeCloseTo(f.outputs.mp.cg.z, 6);
    expect(f.outputs.euler.pitch).toBeCloseTo(e.outputs.euler.pitch, 6);
  });

  it('deslocar não muda a massa; o momento é Σ m·Δx e o pitch de equilíbrio segue M ÷ (W·BG)', () => {
    const e = buildScenario('pairando');
    stop(e);
    e.advanceSim(2);
    const m0 = e.outputs.mp.mass;
    applyCommand(e, { type: 'shiftLoad', id: 'torpedos', x: 22 });
    applyCommand(e, { type: 'shiftLoad', id: 'tripulantes', x: 15 });
    applyCommand(e, { type: 'shiftLoad', id: 'mantimentos', x: 12 });
    // anda com velocidade limitada (torpedos 0,25 m/s)
    e.advanceSim(10);
    expect(e.state.shiftLoads!.torpedos.x).toBeLessThan(16);
    e.advanceSim(80);
    const tb = trimBalance(e);
    // (outros sistemas variam alguns gramas no período)
    expect(e.outputs.mp.mass).toBeCloseTo(m0, -1);
    expect(tb.loads.every((l) => Math.abs(l.x - l.xCmd) < 1e-9)).toBe(true);
    expect(tb.loadsTm).toBeCloseTo(-(3.2 * 9 + 1.36 * 25 + 0.6 * 15), 6);
    const wbg = e.outputs.pitchStiffness / e.env.cfg.gravity / 1000;
    expect(tb.pitchEq).toBeCloseTo((Math.asin(tb.loadsTm / wbg) * 180) / Math.PI, 0);
    expect(tb.pitchEq).toBeLessThan(-5.5);
    expect(tb.pitchEq).toBeGreaterThan(-6.5);
    expect(e.state.commands.some((c) => /Torpedos de reserva/.test(c.text))).toBe(true);
    // a transferência de trim calculada anula o momento
    expect(tb.compensate.dir).toBe('AtoB');
    expect(tb.compensate.kg).toBeCloseTo((Math.abs(tb.loadsTm) * 1000) / tb.arm, 3);
  });

  it('volta à estiva, limites do trilho e comando inválido recusado sem alterar o estado', () => {
    const e = buildScenario('pairando');
    applyCommand(e, { type: 'shiftLoad', id: 'tripulantes', x: 99 });
    expect(e.state.shiftLoads!.tripulantes.xCmd).toBe(22);
    applyCommand(e, { type: 'shiftLoad', id: 'ALL', home: true });
    expect(e.state.shiftLoads!.tripulantes.xCmd).toBe(-10);
    const before = JSON.stringify(e.state.shiftLoads);
    applyCommand(e, { type: 'shiftLoad', id: 'piano', x: 3 });
    applyCommand(e, { type: 'shiftLoad', id: 'torpedos' });
    expect(JSON.stringify(e.state.shiftLoads)).toBe(before);
  });

  it('referência dos vetores de trim: a água transferida passa a contar a partir do comando', () => {
    const e = buildScenario('pairando');
    applyCommand(e, { type: 'dosing', system: 'trim', mode: 'transferir', kg: 300, dir: 'AtoB' });
    e.advanceSim(60);
    expect(Math.abs(trimBalance(e).tanks.momentTm)).toBeGreaterThan(5);
    applyCommand(e, { type: 'trimReference' });
    expect(trimBalance(e).tanks.momentTm).toBeCloseTo(0, 6);
  });

  it('salvar e carregar mantém a posição das cargas', () => {
    const e = buildScenario('pairando');
    applyCommand(e, { type: 'shiftLoad', id: 'mantimentos', x: 5 });
    e.advanceSim(5);
    const f = deserializeEngine(JSON.parse(JSON.stringify(serializeEngine(e, 'x'))));
    expect(f.state.shiftLoads).toEqual(e.state.shiftLoads);
  });
});
