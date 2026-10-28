import { describe, expect, it } from 'vitest';
import { cavitationIntensity, sedimentIntensity } from '../src/render3d/underwaterFxModel';
import { UnderwaterFx } from '../src/render3d/UnderwaterFx';
import { buildScenario } from '../src/sim/scenarios';
import { qFromEuler } from '../src/sim/core/math';

describe('Efeitos submersos', () => {
  const cav = (depth: number, rpm: number) => cavitationIntensity(101325 + 1025 * 9.81 * depth, 1025, 22, (rpm * Math.PI) / 30, 1.98, 5);
  it('pressão inibe cavitação e rotação a intensifica, inclusive a ré', () => {
    expect(cav(10, 160)).toBeGreaterThan(0);
    expect(cav(80, 160)).toBe(0);
    expect(cav(10, 80)).toBe(0);
    expect(cav(0, 0)).toBe(0);
    expect(cav(10, -160)).toBe(cav(10, 160));
  });
  it('sedimento depende de proximidade e agitação, com pulso de impacto', () => {
    expect(sedimentIntensity(7, 8, 10, 0)).toBe(0);
    expect(sedimentIntensity(1, 5, 0, 0)).toBeGreaterThan(sedimentIntensity(4, 5, 0, 0));
    expect(sedimentIntensity(1, 0, 6, 0)).toBeGreaterThan(0);
    expect(sedimentIntensity(0, 0, 0, 0)).toBe(0);
    expect(sedimentIntensity(0, 0, 0, 0.5)).toBe(1);
  });
  it('pausa, troca de cenário, camadas e passagem de tempo respeitam o estado', () => {
    const e = buildScenario('submerso_50');
    e.env.setSeaState(0);
    e.state.body.pos.z = 10;
    e.state.propulsion.omega = (160 * Math.PI) / 30;
    const fx = new UnderwaterFx();
    const tick = () => fx.update(e, 0.1, 0, 0, e.state.t, 500, true);
    const count = () => (fx.group.children[0] as any).geometry.drawRange.count as number;
    tick();
    e.state.t += 0.1;
    tick();
    expect(count()).toBeGreaterThan(0);
    const n = count();
    tick();
    expect(count()).toBe(n);
    e.state.propulsion.omega = 0;
    e.state.t += 2;
    tick();
    expect(count()).toBe(0);
    fx.update(e, 0, 0, 0, e.state.t, 500, false);
    expect(fx.group.visible).toBe(false);
    e.state.t = 0;
    tick();
    expect(count()).toBe(0);
  });
  it('emite na quilha inclinada sem alterar estado e não gera poeira eterna em repouso', () => {
    const e = buildScenario('submerso_50');
    e.env.cfg.geo = undefined;
    e.env.cfg.bottom = { baseDepth: 52, slopeNorth: 0, slopeEast: 0, roughness: 0, wavelength: 1800 };
    e.state.body.pos.z = 49;
    e.state.body.quat = qFromEuler(0, 0.05, 0);
    e.state.body.vel = { x: 0, y: 0, z: 0 };
    e.state.propulsion.omega = 0;
    e.state.propulsion.thrust = 0;
    const fx = new UnderwaterFx();
    fx.update(e, 0, 0, 0, e.state.t, 500, true);
    e.state.t += 0.1;
    const before = JSON.stringify(e.state);
    fx.update(e, 0.1, 0, 0, e.state.t, 500, true);
    expect(JSON.stringify(e.state)).toBe(before);
    expect((fx.group.children[0] as any).geometry.drawRange.count).toBeGreaterThan(0);
    e.state.t += 20;
    fx.update(e, 20, 0, 0, e.state.t, 500, true);
    expect((fx.group.children[0] as any).geometry.drawRange.count).toBe(0);
  });
});
