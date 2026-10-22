/**
 * Piloto automático de profundidade — alocação entre lemes de ré e de vela.
 * Os lemes de ré (maior momento de caturro) fazem a mudança de cota pelo
 * ângulo; os lemes de vela (vante) só fazem o ajuste fino, com autoridade
 * reduzida. Abaixo da velocidade crítica dos lemes de ré a autoridade passa
 * para os de vela.
 */
import { describe, it, expect } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { uniformConfig } from '../src/sim/validation/suite';
import { AP_GAINS, lowSpeedShare } from '../src/sim/systems/autopilot';
import type { SimulationEngine } from '../src/sim/core/engine';
import { KNOT } from '../src/sim/units';

interface Run {
  bowRms: number;
  sternRms: number;
  bowPeak: number;
  sternPeak: number;
  overshoot: number;
  tReach: number;
  maxPitch: number;
}

function track(e: SimulationEngine, target: number, seconds: number): Run {
  const z0 = e.outputs.depthKeel;
  const dir = Math.sign(target - z0);
  const dt = e.config.settings.dt;
  const n = Math.round(seconds / dt);
  let b2 = 0;
  let s2 = 0;
  const r: Run = { bowRms: 0, sternRms: 0, bowPeak: 0, sternPeak: 0, overshoot: 0, tReach: NaN, maxPitch: 0 };
  for (let i = 0; i < n; i++) {
    e.step();
    const b = e.state.surfaces.bow.actual;
    const s = e.state.surfaces.stern.actual;
    b2 += b * b;
    s2 += s * s;
    r.bowPeak = Math.max(r.bowPeak, Math.abs(b));
    r.sternPeak = Math.max(r.sternPeak, Math.abs(s));
    r.maxPitch = Math.max(r.maxPitch, Math.abs(e.outputs.euler.pitch));
    const z = e.outputs.depthKeel;
    r.overshoot = Math.max(r.overshoot, dir * (z - target));
    if (Number.isNaN(r.tReach) && Math.abs(z - target) < 2 && Math.abs(e.outputs.verticalSpeed) < 0.1) r.tReach = (i + 1) * dt;
  }
  r.bowRms = Math.sqrt(b2 / n);
  r.sternRms = Math.sqrt(s2 / n);
  return r;
}

describe('Piloto de profundidade — alocação dos lemes', () => {
  it('na mudança de cota a 6 nós os lemes de ré fazem o trabalho e os de vela só o ajuste fino', () => {
    const e = buildScenario('submerso_50', uniformConfig());
    applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
    applyCommand(e, { type: 'autopilot', channel: 'heading', mode: 'AUTO' });
    applyCommand(e, { type: 'setpoint', channel: 'depth', value: 50 });
    e.advanceSim(60);
    for (const target of [100, 50]) {
      applyCommand(e, { type: 'setpoint', channel: 'depth', value: target });
      const r = track(e, target, 300);
      const tag = `${target} m: ré RMS ${r.sternRms.toFixed(2)}° pico ${r.sternPeak.toFixed(1)}° | vante RMS ${r.bowRms.toFixed(2)}° pico ${r.bowPeak.toFixed(1)}° | t ${r.tReach.toFixed(0)} s, sobrepasso ${r.overshoot.toFixed(2)} m, θmáx ${r.maxPitch.toFixed(1)}°`;
      console.log(tag);
      expect(r.sternRms, tag).toBeGreaterThan(1.5 * r.bowRms);
      expect(r.sternPeak, tag).toBeGreaterThan(2 * r.bowPeak);
      expect(r.bowPeak, tag).toBeLessThanOrEqual(AP_GAINS.bow.authority + 1e-9);
      expect(r.tReach, tag).toBeLessThan(200);
      expect(r.overshoot, tag).toBeLessThan(1);
      expect(r.maxPitch, tag).toBeLessThan(e.vessel.limits.maxPitch);
    }
  });

  it('na cota periscópica com mar 3 mantém a cota sem expor a vela; lemes de vela dentro da autoridade fina', () => {
    const c = uniformConfig();
    c.environment.waves = { seaState: 3, direction: 30, seed: 7 };
    const e = buildScenario('cota_periscopica', c);
    applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
    applyCommand(e, { type: 'setpoint', channel: 'depth', value: 15 });
    e.advanceSim(60);
    let maxErr = 0;
    let bowPeak = 0;
    for (let i = 0; i < 300; i++) {
      e.advanceSim(1);
      maxErr = Math.max(maxErr, Math.abs(e.outputs.depthKeel - 15));
      bowPeak = Math.max(bowPeak, Math.abs(e.state.surfaces.bow.actual));
    }
    expect(maxErr).toBeLessThan(0.5);
    expect(bowPeak).toBeLessThanOrEqual(AP_GAINS.bow.authority + 1e-9);
    expect(e.outputs.surfaced).toBe(false);
  });

  it('a autoridade passa para os lemes de vela só abaixo da velocidade crítica dos lemes de ré', () => {
    expect(lowSpeedShare(6 * KNOT)).toBe(0);
    expect(lowSpeedShare(4 * KNOT)).toBe(0);
    expect(lowSpeedShare(2.5 * KNOT)).toBe(1);
    expect(lowSpeedShare(-6 * KNOT)).toBe(0);
  });
});
