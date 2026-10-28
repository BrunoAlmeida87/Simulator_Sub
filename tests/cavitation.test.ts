import { describe, expect, it } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { cavitationLevel, cavitationSamples, cavitationReferenceDepth } from '../src/sim/systems/cavitation';
import { acknowledgeAlarm, visibleAlarms, ALARM_DEFS } from '../src/sim/systems/alarms';
import { qFromEuler } from '../src/sim/core/math';

function setup() {
  const e = buildScenario('submerso_50');
  e.env.setSeaState(0);
  e.state.body.pos.z = 12;
  e.state.propulsion.omega = (160 * Math.PI) / 30;
  e.state.body.vel.x = 14 * 0.514444;
  return e;
}

describe('Cavitação compartilhada e alerta', () => {
  it('mesmas amostras para gráfico e supervisão, com atitude e partes emersas', () => {
    const e = setup();
    e.state.body.quat = qFromEuler(0.15, 0.08, 0.7);
    expect(cavitationLevel(e.vessel, e.state, e.env)).toBe(Math.max(...cavitationSamples(e.vessel, e.state, e.env).map((p) => p.intensity)));
    e.state.body.pos.z = -100;
    expect(cavitationLevel(e.vessel, e.state, e.env)).toBe(0);
    e.state.body.pos.z = 80;
    expect(cavitationLevel(e.vessel, e.state, e.env)).toBe(0);
  });
  it('confirma no motor sem cena 3D, reconhece e normaliza ao aprofundar', () => {
    const e = setup();
    const tick = (n: number, depth: number) => {
      for (let i = 0; i < n; i++) {
        e.state.body.pos.z = depth;
        e.state.propulsion.omega = (160 * Math.PI) / 30;
        e.step();
      }
    };
    tick(20, 12);
    expect(e.state.alarms.runtime.CAVITATION.active).toBe(false);
    tick(40, 12);
    expect(e.state.alarms.runtime.CAVITATION.active).toBe(true);
    expect(e.state.alarms.log.filter((a) => a.id === 'CAVITATION' && a.event === 'ATIVADO')).toHaveLength(1);
    tick(2, 80);
    expect(e.state.alarms.runtime.CAVITATION.active).toBe(false);
    expect(visibleAlarms(e.state).some((a) => a.def.id === 'CAVITATION')).toBe(true);
    acknowledgeAlarm(e.state, 'CAVITATION');
    expect(visibleAlarms(e.state).some((a) => a.def.id === 'CAVITATION')).toBe(false);
  });
  it('usa histerese e não aciona com hélice parada', () => {
    const e = setup();
    e.state.propulsion.omega = 0;
    expect(cavitationLevel(e.vessel, e.state, e.env)).toBe(0);
    const def = ALARM_DEFS.find((a) => a.id === 'CAVITATION')!;
    const c = { s: e.state, cavitation: 0.03 } as Parameters<typeof def.cond>[0];
    expect(def.cond(c)).toBe(false);
    e.state.alarms.runtime.CAVITATION = { active: true, acked: false, since: 0, pending: 1 };
    expect(def.cond(c)).toBe(true);
    c.cavitation = 0.01;
    expect(def.cond(c)).toBe(false);
  });
  it('referências se adaptam à hélice e crescem com rpm', () => {
    const e = setup();
    const low = cavitationReferenceDepth(e.vessel, e.env, 80, 6)!;
    const high = cavitationReferenceDepth(e.vessel, e.env, 160, 14)!;
    expect(low).toBeCloseTo(3.6, 0);
    expect(high).toBeCloseTo(38.2, 0);
    e.vessel.propulsion.propeller.diameter = 3;
    expect(cavitationReferenceDepth(e.vessel, e.env, 160, 14)).toBeLessThan(high);
    expect(cavitationReferenceDepth(e.vessel, e.env, 0, 14)).toBeNull();
  });
});
