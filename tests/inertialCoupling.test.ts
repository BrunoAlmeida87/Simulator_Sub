/** Termos inerciais (Coriolis + massa adicional) não criam energia (auditoria A04). */
import { describe, expect, it } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { computeForces } from '../src/sim/physics/dynamics';

describe('Acoplamento inercial conservativo', () => {
  it('potência dos termos de Coriolis e Munk é nula para velocidades combinadas', () => {
    const e = buildScenario('submerso_50');
    e.computeOutputs();
    const fi = e.forceInputs(e.outputs.mp);
    const cases = [
      { vel: { x: 4, y: 0, z: 0.2 }, omega: { x: 0, y: -0.02, z: 0 } }, // caso do relatório
      { vel: { x: 3, y: -0.3, z: 0.4 }, omega: { x: 0.05, y: 0.03, z: -0.04 } },
      { vel: { x: -2, y: 0.5, z: -0.1 }, omega: { x: -0.1, y: 0.01, z: 0.06 } },
    ];
    for (const c of cases) {
      const f = computeForces({ pos: e.state.body.pos, quat: e.state.body.quat, ...c }, fi).coriolis;
      const power = f.F.x * c.vel.x + f.F.y * c.vel.y + f.F.z * c.vel.z + f.M.x * c.omega.x + f.M.y * c.omega.y + f.M.z * c.omega.z;
      const scale = Math.abs(f.M.y * c.omega.y) + Math.abs(f.F.z * c.vel.z) + 1;
      expect(Math.abs(power) / scale).toBeLessThan(1e-9);
    }
  });
});
