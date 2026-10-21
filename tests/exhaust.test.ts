/**
 * DESCARGA DOS DIESEL-GERADORES: o caminho (mastro × dispersores) e a
 * existência da descarga seguem a lógica operacional do simulador, sem
 * alterá-la. Bolhas só quando há descarga pelos dispersores.
 */
import { describe, it, expect } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { dieselExhaust, disperserOutlets } from '../src/sim/systems/exhaust';
import type { SimulationEngine } from '../src/sim/core/engine';

const startGens = (e: SimulationEngine) => {
  for (const g of e.vessel.electrical.generators) applyCommand(e, { type: 'generator', id: g.id, run: true });
};

describe('Descarga dos diesel-geradores', () => {
  it('parados: nenhuma descarga', () => {
    const e = buildScenario('superficie');
    e.advanceSim(5);
    expect(dieselExhaust(e.vessel, e.state).route).toBeNull();
  });

  it('na superfície com o mastro recolhido: geradores em carga e descarga pelos dispersores', () => {
    const e = buildScenario('superficie');
    expect(e.state.snorkel.pos).toBeLessThan(0.5);
    startGens(e);
    e.advanceSim(60);
    const ex = dieselExhaust(e.vessel, e.state);
    expect(ex.running).toBe(e.vessel.electrical.generators.length);
    expect(ex.route).toBe('dispersores');
    expect(ex.load).toBeGreaterThan(0);
    // as saídas ficam logo atrás da vela, abaixo da linha d'água com o submarino na superfície
    for (const o of disperserOutlets(e.vessel, e.geom.radiusAt)) {
      expect(o.x).toBeLessThan(e.vessel.hull.sail.xAft);
      expect(o.x).toBeGreaterThan(e.vessel.hull.sail.xAft - 3);
      expect(e.state.body.pos.z + o.z).toBeGreaterThan(0.3);
    }
    // mais geradores → descarga mais intensa
    applyCommand(e, { type: 'generator', id: e.vessel.electrical.generators[0].id, run: false });
    e.advanceSim(5);
    const one = dieselExhaust(e.vessel, e.state);
    expect(one.running).toBe(e.vessel.electrical.generators.length - 1);
    expect(one.load).toBeLessThan(ex.load);
    // desligados: a descarga para
    startGens(e);
    for (const g of e.vessel.electrical.generators) applyCommand(e, { type: 'generator', id: g.id, run: false });
    e.advanceSim(5);
    expect(dieselExhaust(e.vessel, e.state).route).toBeNull();
  });

  it('na cota periscópica com o snorkel içado: descarga pelo mastro (não pelos dispersores)', () => {
    const e = buildScenario('cota_periscopica');
    // mar calmo: com ondas, cristas cobrem a cabeça e os geradores alternam PARTINDO/SEM AR (lógica original)
    applyCommand(e, { type: 'seaState', value: 0 });
    applyCommand(e, { type: 'snorkel', raise: true });
    e.advanceSim(40);
    startGens(e);
    e.advanceSim(60);
    const ex = dieselExhaust(e.vessel, e.state);
    expect(ex.route).toBe('mastro');
  });

  it('submerso com o mastro recolhido: geradores "SEM AR", sem descarga (a lógica não foi alterada)', () => {
    const e = buildScenario('submerso_50');
    startGens(e);
    e.advanceSim(30);
    for (const g of e.vessel.electrical.generators) expect(e.state.electrical.generators[g.id].status).toBe('SEM AR');
    expect(dieselExhaust(e.vessel, e.state).route).toBeNull();
  });
});
