/**
 * VENTO APARENTE (efeito visual): vento real pelo estado do mar, no sentido
 * das ondas; com o submarino avançando, o vento aparente vem da proa.
 */
import { describe, it, expect } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { WIND_BY_SEA_STATE, apparentWind, trueWind } from '../src/render3d/WindFx';

describe('Vento aparente', () => {
  it('parado, o vento aparente é o vento real (do estado do mar, no sentido das ondas)', () => {
    const e = buildScenario('superficie');
    applyCommand(e, { type: 'seaState', value: 3 });
    const t = trueWind(e);
    expect(t.speed).toBeCloseTo(WIND_BY_SEA_STATE[3], 6);
    const dir = e.env.cfg.waves!.direction;
    expect(Math.atan2(t.e, t.n)).toBeCloseTo((dir * Math.PI) / 180, 6);
    const before = JSON.stringify(e.state);
    const a = apparentWind(e);
    expect(JSON.stringify(e.state)).toBe(before);
    // parado: a velocidade própria é desprezível
    expect(Math.hypot(e.outputs.velNED.x, e.outputs.velNED.y)).toBeLessThan(0.05);
    expect(a.speed).toBeCloseTo(t.speed, 1);
  });
  it('avançando em mar calmo, o vento aparente vem da proa e cresce com a velocidade', () => {
    const e = buildScenario('superficie_avante');
    applyCommand(e, { type: 'seaState', value: 0 });
    e.advanceSim(5);
    const v = Math.hypot(e.outputs.velNED.x, e.outputs.velNED.y);
    expect(v).toBeGreaterThan(1);
    const a = apparentWind(e);
    expect(Math.abs(a.fromRel)).toBeLessThan(25);
    expect(a.speed).toBeGreaterThan(v - WIND_BY_SEA_STATE[0] - 1e-6);
    expect(a.speed).toBeLessThan(v + WIND_BY_SEA_STATE[0] + 1e-6);
  });
});
