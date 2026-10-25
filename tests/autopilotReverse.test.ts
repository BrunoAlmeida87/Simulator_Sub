/** Piloto automático em marcha a ré e comutação sem salto (auditoria A05/A09). */
import { describe, expect, it } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { bumplessInit, depthPitchSign, updateAutopilot, type ApReadings } from '../src/sim/systems/autopilot';
import { hullForces } from '../src/sim/physics/hydrodynamics';

const readings = (o: Partial<ApReadings>): ApReadings => ({ heading: 90, yawRate: 0, depth: 50, depthRate: 0, pitch: 0, pitchRate: 0, speed: 4, ...o });

describe('Comutação para AUTO sem salto', () => {
  for (const speed of [4, -2]) {
    it(`rumo em curva (u = ${speed} m/s): o leme continua onde estava`, () => {
      const e = buildScenario('submerso_50');
      const s = e.state;
      s.surfaces.rudder.cmd = 5;
      const r = readings({ speed, yawRate: 0.1 });
      bumplessInit(s, 'heading', r);
      s.autopilot.headingMode = 'AUTO';
      updateAutopilot(e.vessel, s, r, 0);
      expect(s.surfaces.rudder.cmd).toBeCloseTo(5, 6);
    });
    it(`pitch e profundidade (u = ${speed} m/s): os lemes de ré continuam onde estavam`, () => {
      const e = buildScenario('submerso_50');
      const s = e.state;
      s.surfaces.stern.cmd = 3;
      const r = readings({ speed, pitch: 1.2, pitchRate: 0.2 });
      bumplessInit(s, 'pitch', r);
      s.autopilot.pitchMode = 'AUTO';
      updateAutopilot(e.vessel, s, r, 0);
      expect(s.surfaces.stern.cmd).toBeCloseTo(3, 6);

      s.autopilot.pitchMode = 'MANUAL';
      s.surfaces.stern.cmd = 4;
      const rz = readings({ speed, depth: 50.4, depthRate: 0.1, pitch: -0.5 });
      bumplessInit(s, 'depth', rz);
      s.autopilot.depthMode = 'AUTO';
      updateAutopilot(e.vessel, s, rz, 0);
      expect(s.surfaces.stern.cmd).toBeCloseTo(4, 6);
    });
  }
});

describe('Piloto em marcha a ré', () => {
  it('a malha de profundidade inverte o pitch ordenado em ré, continuamente', () => {
    expect(depthPitchSign(3)).toBe(1);
    expect(depthPitchSign(0)).toBe(1);
    expect(depthPitchSign(-0.125)).toBeCloseTo(0.5, 12);
    expect(depthPitchSign(-0.5)).toBe(-1);
    expect(depthPitchSign(-3)).toBe(-1);
  });

  it('anti-windup: com o leme saturado em ré, a integral de rumo não cresce no sentido da saturação', () => {
    const e = buildScenario('submerso_50');
    const s = e.state;
    s.autopilot.headingMode = 'AUTO';
    s.autopilot.headingSet = 180;
    s.autopilot.iHeading = 0;
    updateAutopilot(e.vessel, s, readings({ speed: -4, heading: 90 }), 0.02);
    expect(Math.abs(s.surfaces.rudder.cmd)).toBeGreaterThan(19);
    expect(s.autopilot.iHeading).toBe(0);
  });

  it('mantém a cota a 50 m andando a ré', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'telegraph', rpm: -60 });
    applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
    applyCommand(e, { type: 'setpoint', channel: 'depth', value: 50 });
    let worst = 0;
    for (let t = 0; t < 300; t += 5) {
      e.advanceSim(5);
      worst = Math.max(worst, Math.abs(e.outputs.depthKeel - 50));
    }
    expect(e.state.body.vel.x).toBeLessThan(-2);
    expect(worst).toBeLessThan(1);
    expect(Math.abs(e.outputs.euler.pitch)).toBeLessThan(3);
  });

  it('muda de cota andando a ré: sobe com a proa para baixo e desce com a proa para cima', () => {
    for (const target of [45, 60]) {
      const e = buildScenario('submerso_50');
      applyCommand(e, { type: 'telegraph', rpm: -60 });
      applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
      e.advanceSim(120);
      applyCommand(e, { type: 'setpoint', channel: 'depth', value: target });
      e.advanceSim(40);
      // no meio da manobra: pitch no sentido certo para a ré
      expect(Math.sign(e.outputs.euler.pitch)).toBe(target < 50 ? -1 : 1);
      e.advanceSim(200);
      expect(Math.abs(e.outputs.depthKeel - target)).toBeLessThan(1);
    }
  });

  it('sustentação do casco em ré se opõe à velocidade transversal (não injeta energia)', () => {
    const e = buildScenario('submerso_50');
    for (const u of [4, -4]) {
      const vel = { x: u, y: 0.1, z: 0.2 };
      const imm = new Float64Array(e.geom.slices.length).fill(1);
      const hf = hullForces(e.vessel, e.geom, vel, { x: 0, y: 0, z: 0 }, 1025, imm, 1, e.state.body.pos.z);
      expect(hf.lift.F.z * vel.z + hf.lift.F.y * vel.y).toBeLessThan(0);
    }
  });
});
