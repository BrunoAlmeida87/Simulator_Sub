import { describe, it, expect } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import type { CargoLoad } from '../src/sim/core/state';
import { serializeEngine, deserializeEngine } from '../src/sim/persistence';

const cargo = (x = 20): CargoLoad => ({ id: 'test', name: 'Carga de ensaio', category: 'carga', quantity: 2, unitMass: 500, position: { x, y: 0, z: 1 } });
describe('Cargas e resposta hidrostática', () => {
  it('embarque, movimento e desembarque conservam o balanço sem recalibrar o casco', () => {
    const e = buildScenario('superficie');
    const mass = e.outputs.mp.mass;
    const light = structuredClone(e.light);
    const initialCargo = e.state.ledger.cargoIn ?? 0;
    applyCommand(e, { type: 'cargoUpsert', load: cargo() }); e.computeOutputs();
    expect(e.outputs.mp.mass - mass).toBeCloseTo(1000, 6);
    const forwardCG = e.outputs.mp.cg.x;
    applyCommand(e, { type: 'cargoUpsert', load: cargo(-20) }); e.computeOutputs();
    expect(e.outputs.mp.mass - mass).toBeCloseTo(1000, 6);
    expect(e.outputs.mp.cg.x).toBeLessThan(forwardCG);
    expect(e.state.ledger.cargoIn! - initialCargo).toBe(1000);
    expect(e.light).toEqual(light);
    const loaded = deserializeEngine(serializeEngine(e, 'Carga'));
    expect(loaded.state.cargoLoads).toEqual(e.state.cargoLoads);
    expect(loaded.outputs.mp.mass).toBeCloseTo(e.outputs.mp.mass, 6);
    applyCommand(e, { type: 'cargoRemove', id: 'test' }); e.computeOutputs();
    expect(e.outputs.mp.mass).toBeCloseTo(mass, 6);
    expect(e.state.ledger.cargoIn ?? 0).toBe(initialCargo);
  });
  it('inclina a proa com carga na vante na superfície e responde mais submerso', () => {
    const surface = buildScenario('superficie');
    const submerged = buildScenario('pairando');
    surface.env.setSeaState(0); submerged.env.setSeaState(0);
    const responses: number[] = [];
    for (const e of [surface, submerged]) {
      const before = e.outputs.euler.pitch;
      applyCommand(e, { type: 'cargoUpsert', load: cargo() }); e.computeOutputs();
      expect(e.outputs.staticPitchMoment).toBeLessThan(-100000);
      e.advanceSim(30);
      responses.push(e.outputs.euler.pitch - before);
      expect(e.outputs.euler.pitch).toBeLessThan(before);
      expect(Number.isFinite(e.outputs.mp.mass)).toBe(true);
      expect(Math.abs(e.outputs.massAudit)).toBeLessThan(5);
    }
    expect(Math.abs(responses[0])).toBeGreaterThan(0.001);
    expect(Math.abs(responses[1])).toBeGreaterThan(Math.abs(responses[0]));
    expect(surface.outputs.pitchStiffness).toBeGreaterThan(submerged.outputs.pitchStiffness);
  });
  it('soma cargas independentes e preserva a continuação física ao salvar', () => {
    const e = buildScenario('pairando');
    const initialMass = e.outputs.mp.mass;
    applyCommand(e, { type: 'cargoUpsert', load: cargo() });
    applyCommand(e, { type: 'cargoUpsert', load: { ...cargo(-10), id: 'people', category: 'pessoas', quantity: 10, unitMass: 85 } });
    e.computeOutputs();
    expect(e.outputs.mp.mass - initialMass).toBeCloseTo(1850, 6);
    const loaded = deserializeEngine(serializeEngine(e, 'Continuação'));
    e.advanceSim(5); loaded.advanceSim(5);
    expect(loaded.state.body).toEqual(e.state.body);
    expect(e.state.cargoLoads).toHaveLength(2);
  });
  it('rejeita massas inválidas e posições fora do casco sem alterar balanço', () => {
    const e = buildScenario('superficie');
    for (const load of [ { ...cargo(), unitMass: NaN }, { ...cargo(), quantity: -1 }, cargo(100), { ...cargo(), position: { x: 0, y: 10, z: 0 } } ]) {
      applyCommand(e, { type: 'cargoUpsert', load });
    }
    expect(e.state.cargoLoads ?? []).toEqual([]);
  });
  it('cargas laterais produzem banda para o bordo carregado na superfície e submerso', () => {
    for (const scenario of ['superficie', 'pairando']) {
      for (const y of [-1.5, 1.5]) {
        const e = buildScenario(scenario);
        const before = e.outputs.euler.roll;
        const load = { ...cargo(0), position: { x: 0, y, z: 1 } };
        applyCommand(e, { type: 'cargoUpsert', load }); e.computeOutputs();
        expect(e.outputs.staticRollMoment * y).toBeGreaterThan(0);
        e.advanceSim(20);
        expect((e.outputs.euler.roll - before) * y).toBeGreaterThan(0.01);
      }
    }
  });
  it('aceita salvamentos antigos sem cargas adicionais', () => {
    const e = buildScenario('pairando');
    const f = serializeEngine(e, 'Antigo'); delete f.state.cargoLoads;
    expect(deserializeEngine(f).outputs.mp.mass).toBeCloseTo(e.outputs.mp.mass, 6);
  });
});

describe('Painel de cargas: nomes, modelos e posição', () => {
  it('gera o próximo nome livre e ignora a própria carga em edição', async () => {
    const { nextCargoName } = await import('../src/ui/components/cargoUi');
    const l = (id: string, name: string): CargoLoad => ({ ...cargo(), id, name });
    expect(nextCargoName('Torpedo', [])).toBe('Torpedo 1');
    expect(nextCargoName('Torpedo', [l('a', 'Torpedo 1'), l('b', 'torpedo 2')])).toBe('Torpedo 3');
    expect(nextCargoName('Torpedo', [l('a', 'Torpedo 1')], 'a')).toBe('Torpedo 1');
    expect(nextCargoName('  ', [])).toBe('Carga 1');
  });
  it('leva qualquer clique para dentro do casco e o comando aceita a posição', async () => {
    const { clampInHull, insideHull, CARGO_MODELS, compartmentOf } = await import('../src/ui/components/cargoUi');
    const e = buildScenario('superficie');
    let n = 0;
    for (let x = -40; x <= 40; x += 2.7)
      for (const y of [-5, -1.5, 0, 2.2, 6])
        for (const z of [-5, -1.5, 0, 2, 6]) {
          const p = clampInHull(e, { x, y, z });
          expect(insideHull(e, p)).toBe(true);
          applyCommand(e, { type: 'cargoUpsert', load: { ...cargo(), id: 'c' + n++, quantity: 1, unitMass: 1, position: p } });
        }
    expect(e.state.cargoLoads).toHaveLength(n);
    for (const m of CARGO_MODELS) {
      const p = clampInHull(e, m.position);
      expect(p).toEqual(m.position); // modelos já ficam dentro do casco
      applyCommand(e, { type: 'cargoUpsert', load: { id: m.id, name: m.base, category: m.category, quantity: m.quantity, unitMass: m.unitMass, position: p } });
      expect(e.state.cargoLoads!.some((l) => l.id === m.id)).toBe(true);
    }
    expect(compartmentOf(e, 17)).toBe('Compartimento de vante');
    expect(compartmentOf(e, 30)).toMatch(/^Proa/);
    expect(compartmentOf(e, -25)).toMatch(/^Popa/);
  });
});
