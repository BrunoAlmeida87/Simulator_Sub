import { describe, expect, it } from 'vitest';
import { defaultSimConfig } from '../src/sim/config/defaultVessel';
import { createState } from '../src/sim/core/initialState';
import { SimulationEngine } from '../src/sim/core/engine';
import { applyCommand } from '../src/sim/commands';
import { qFromEuler, qToMat3 } from '../src/sim/core/math';
import { RHO_NOMINAL, type StepContext } from '../src/sim/core/context';
import { updateCompensation } from '../src/sim/systems/internalTanks';
import { buildCompensationCircuit, findPumpRoutes, circuitEdgeFlow } from '../src/sim/systems/compensationCircuit';
import { solveNeutralCompensation } from '../src/sim/equilibrium';
import { serializeEngine, deserializeEngine } from '../src/sim/persistence';

function fixture() {
  const config = defaultSimConfig();
  const e = new SimulationEngine(config, createState(config, { depth: 50, heading: 0 }, 'teste', true));
  const s = e.state;
  const v = e.vessel;
  const tanks = [{ cfg: v.heel.tankA, st: s.heel.tankA }, { cfg: v.compensation.tanks.find(t => t.id === 'TC0')!, st: s.compensation.tanks.TC0 }, { cfg: v.heel.tankB, st: s.heel.tankB }];
  tanks.forEach(t => { t.st.mass = 2 * RHO_NOMINAL; });
  const tr = s.compensation.transfer!;
  const ctx: StepContext = { cfg: v, env: e.env, geom: e.geom, dt: 0.02, t: 0, R: qToMat3(qFromEuler(0, 0, 0)), pos: s.body.pos, depthOf: p => 50 + p.z,
    busPowered: true, hydraulicFactor: 1, rhoLocal: RHO_NOMINAL, seaTempK: 293, airIntakeAvailable: false, hydraulicDemand: 0, log: () => {} };
  const step = (seconds = 10) => {
    for (let i = 0; i < seconds / ctx.dt; i++) updateCompensation(v.compensation, s.compensation, ctx, [tanks[0], tanks[2]]);
  };
  return { e, s, v, tanks, tr, ctx, step };
}

describe('Transferência de banda BB ↔ central ↔ BE', () => {
  for (const [a, b] of [[0, 1], [1, 0], [0, 2], [2, 0], [1, 2], [2, 1]]) {
    it(`transfere ${a} → ${b} conservando massa e sem troca com o mar`, () => {
      const f = fixture();
      applyCommand(f.e, { type: 'compensationRoute', source: f.tanks[a].cfg.id, destination: f.tanks[b].cfg.id });
      applyCommand(f.e, { type: 'compensationTransferPump', run: true });
      const before = f.tanks.map(t => t.st.mass);
      f.step();
      expect(f.tanks[a].st.mass).toBeLessThan(before[a]);
      expect(f.tanks[b].st.mass).toBeGreaterThan(before[b]);
      expect(f.tanks.reduce((sum, t) => sum + t.st.mass, 0)).toBeCloseTo(before.reduce((sum, m) => sum + m, 0), 8);
      expect(f.s.compensation.qIn).toBe(0);
      expect(f.s.compensation.qOut).toBe(0);
      expect(f.tr.pump.power).toBeGreaterThan(2000);
    });
  }
  it('VDC bloqueia durante o curso e inverte o fluxo após o alinhamento', () => {
    const f = fixture();
    applyCommand(f.e, { type: 'compensationTransferPump', run: true }); f.step();
    expect(f.tr.flow).toBeGreaterThan(0);
    applyCommand(f.e, { type: 'compensationDirection', reverse: true }); f.step(1);
    expect(f.tr.flow).toBeCloseTo(0, 12);
    f.step(3); expect(f.tr.flow).toBeLessThan(0);
  });
  it('não troca o par com a bomba em funcionamento e preserva seleção no salvamento', () => {
    const f = fixture();
    applyCommand(f.e, { type: 'compensationTransferPump', run: true });
    applyCommand(f.e, { type: 'compensationRoute', source: 'TC0', destination: f.v.heel.tankB.id });
    expect(f.tr.source).toBe(f.v.heel.tankA.id);
    const restored = deserializeEngine(serializeEngine(f.e, 'transferência'));
    expect(restored.state.compensation.transfer).toEqual(f.tr);
  });
  it('respeita origem vazia e destino cheio sem ultrapassar capacidades', () => {
    const f = fixture();
    f.tanks[0].st.mass = 0;
    applyCommand(f.e, { type: 'compensationTransferPump', run: true }); f.step();
    expect(f.tr.flow).toBeCloseTo(0, 12); expect(f.tr.pump.noSuction).toBe(true);
    f.tanks[0].st.mass = 20;
    f.tanks[2].st.mass = f.tanks[2].cfg.capacity * RHO_NOMINAL - 2;
    f.step();
    expect(f.tanks[2].st.mass).toBeCloseTo(f.tanks[2].cfg.capacity * RHO_NOMINAL, 8);
    expect(f.tanks[0].st.mass).toBeGreaterThanOrEqual(0);
    expect(f.tr.flow).toBeCloseTo(0, 12);
  });
  it('aguarda o isolamento real do mar, inclusive se a válvula ficar travada aberta', () => {
    const f = fixture();
    f.s.compensation.inlet.pos = 1; f.s.compensation.inlet.stuck = true;
    applyCommand(f.e, { type: 'compensationTransferPump', run: true }); f.step();
    expect(f.tr.flow).toBeCloseTo(0, 12); expect(f.tr.pump.deadhead).toBe(true);
  });
  it('para por falta de energia ou falha e respeita VDC travada', () => {
    const f = fixture();
    applyCommand(f.e, { type: 'compensationTransferPump', run: true });
    f.ctx.busPowered = false; f.step(); expect(f.tr.flow).toBeCloseTo(0, 12);
    f.ctx.busPowered = true;
    applyCommand(f.e, { type: 'failure', target: 'pump:compensationTransfer', active: true });
    f.step(); expect(f.tr.flow).toBeCloseTo(0, 12);
    applyCommand(f.e, { type: 'failure', target: 'pump:compensationTransfer', active: false });
    f.tr.direction.pos = 0.5;
    applyCommand(f.e, { type: 'failure', target: 'valve:compensation:direction', active: true });
    f.step(); expect(f.tr.flow).toBeCloseTo(0, 12);
  });
  it('preserva a água do central no cálculo de neutralidade e nas dosagens automáticas', () => {
    const f = fixture();
    const before = f.s.compensation.tanks.TC0.mass;
    solveNeutralCompensation(f.e, 50, true);
    expect(f.s.compensation.tanks.TC0.mass).toBe(before);
    applyCommand(f.e, { type: 'dosing', system: 'compensation', mode: 'admitir', kg: 100 });
    f.step();
    expect(f.s.compensation.tanks.TC0.mass).toBe(before);
    expect(f.s.compensation.tankValves.VC0.pos).toBe(0);
  });
  it('integra a transferência à banda, ao consumo elétrico e ao balanço de massa', () => {
    const f = fixture();
    f.e.computeOutputs();
    const before = f.tanks.reduce((sum, t) => sum + t.st.mass, 0);
    applyCommand(f.e, { type: 'compensationTransferPump', run: true });
    for (let i = 0; i < 3000; i++) f.e.step();
    expect(f.s.heel.tankB.mass).toBeGreaterThan(f.s.heel.tankA.mass);
    expect(f.tanks.reduce((sum, t) => sum + t.st.mass, 0)).toBeCloseTo(before, 7);
    expect(f.e.outputs.mp.cg.y).toBeGreaterThan(0);
    expect(Math.abs(f.e.outputs.euler.roll)).toBeGreaterThan(0.01);
    expect(f.s.electrical.loads.BTC).toBeGreaterThan(0);
  });
});


describe('Topologia hidráulica compartilhada pelos diagramas e pela física', () => {
  for (const [a, b] of [[0, 1], [1, 0], [0, 2], [2, 0], [1, 2], [2, 1]]) {
    for (const reverse of [false, true]) {
      it(`par ${a}/${b}, inversão ${reverse}: caminho único atravessa sucção, bomba, descarga e VDC`, () => {
        const f = fixture();
        const ids = f.tanks.map(t => t.cfg.id);
        f.tr.source = ids[a]; f.tr.destination = ids[b];
        f.tr.direction.pos = reverse ? 1 : 0;
        f.tr.valveA.pos = f.tr.valveB.pos = 1;
        const circuit = buildCompensationCircuit(f.s.compensation, ids);
        expect(circuit.route?.source).toBe(ids[reverse ? b : a]);
        expect(circuit.route?.destination).toBe(ids[reverse ? a : b]);
        const steps = circuit.route!.steps.map(s => s.edge);
        expect(steps).toContain('suction'); expect(steps).toContain('pump'); expect(steps).toContain('discharge');
        expect(steps).toContain(reverse ? 'B:T' : 'A:T');
        expect(steps).toContain(reverse ? 'P:A' : 'P:B');
        const third = ids.find(id => id !== ids[a] && id !== ids[b])!;
        expect(circuitEdgeFlow(circuit, `${third}:A`, 0.01)).toBe(0);
        expect(circuitEdgeFlow(circuit, `${third}:B`, 0.01)).toBe(0);
        // Interromper qualquer trecho do caminho deve impedir a transferência.
        for (const id of steps) {
          const disconnected = circuit.edges.map(edge => edge.id === id ? { ...edge, open: false } : edge);
          expect(findPumpRoutes(disconnected, ids)).toHaveLength(0);
        }
      });
    }
  }
  it('VDC 4/2 inverte entre os dois fins de curso e Parar BTC interrompe a transferência', () => {
    const f = fixture();
    applyCommand(f.e, { type: 'compensationTransferPump', run: true }); f.step();
    expect(f.tr.flow).toBeGreaterThan(0);
    applyCommand(f.e, { type: 'compensationDirection', position: 'inversa' });
    f.step(1.5);
    const transit = buildCompensationCircuit(f.s.compensation, f.tanks.map(t => t.cfg.id));
    expect(transit.position).toBe('transito');
    expect(transit.route).toBeNull(); expect(f.tr.pump.flow).toBe(0);
    expect(f.tr.direction.cmd).toBe(1);
    f.step(4);
    expect(f.tr.pump.flow).toBeGreaterThan(0); expect(f.tr.flow).toBeLessThan(0);
    expect(f.tr.pump.speed).toBe(1);
    applyCommand(f.e, { type: 'compensationTransferPump', run: false }); f.step(4);
    expect(f.tr.flow).toBe(0); expect(f.tr.pump.speed).toBe(0);
    expect(f.tr.valveA.pos).toBe(0); expect(f.tr.valveB.pos).toBe(0);
    expect(f.tr.direction.pos).toBe(1);
    const stopped = f.tanks.map(t => t.st.mass);
    f.step(4); expect(f.tanks.map(t => t.st.mass)).toEqual(stopped);
    applyCommand(f.e, { type: 'compensationDirection', position: 'direta' }); f.step(4);
    expect(f.tr.direction.pos).toBe(0);
  });
  it('um estado salvo com comando de centro fechado é recuperado com a bomba desligada', () => {
    const f = fixture();
    f.tr.direction.pos = f.tr.direction.cmd = 0.5;
    f.tr.pump.cmd = true;
    f.tr.valveA.pos = f.tr.valveB.pos = 1;
    const before = f.tanks.map(t => t.st.mass);
    f.step(4);
    expect(f.tr.direction.cmd).toBe(0); expect(f.tr.direction.pos).toBe(0);
    expect(f.tr.pump.cmd).toBe(false); expect(f.tr.pump.speed).toBe(0);
    expect(f.tanks.map(t => t.st.mass)).toEqual(before);
  });
});
