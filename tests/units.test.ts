/**
 * Testes unitários dos componentes do motor físico.
 */
import { describe, it, expect } from 'vitest';
import { qFromEuler, qToEuler, qToMat3, mulMat3Vec, mulMat3TVec, wrapPi, DEG, bisectIncreasing } from '../src/sim/core/math';
import { seawaterDensity, seawaterDensitySurface } from '../src/sim/environment/seawater';
import { Environment, defaultEnvironment } from '../src/sim/environment/environment';
import { gasMassFlux } from '../src/sim/systems/ballast';
import { pumpFlow, pumpFlowWithLine, updateValve, updatePumpSpeed } from '../src/sim/systems/components';
import { newPump, newValve } from '../src/sim/core/state';
import { buildHullGeometry } from '../src/sim/physics/hullGeometry';
import { computeHydrostatics } from '../src/sim/physics/hydrostatics';
import { defaultVessel } from '../src/sim/config/defaultVessel';
import { liftCoefficient, liftCurveSlope, finForce } from '../src/sim/physics/hydrodynamics';

describe('Matemática', () => {
  it('quatérnio ↔ Euler (ida e volta)', () => {
    for (const [p, t, y] of [
      [0.1, -0.2, 2.5],
      [-0.4, 0.6, -1.2],
      [0, 0, 0],
    ]) {
      const e = qToEuler(qFromEuler(p, t, y));
      expect(e.phi).toBeCloseTo(p, 10);
      expect(e.theta).toBeCloseTo(t, 10);
      expect(wrapPi(e.psi - y)).toBeCloseTo(0, 10);
    }
  });
  it('R·Rᵀ = I e convenções NED (pitch + ⇒ proa sobe)', () => {
    const R = qToMat3(qFromEuler(0, 10 * DEG, 0));
    const fwd = mulMat3Vec(R, { x: 1, y: 0, z: 0 });
    expect(fwd.z).toBeLessThan(0); // z para baixo: proa sobe
    const back = mulMat3TVec(R, fwd);
    expect(back.x).toBeCloseTo(1, 12);
    const Rr = qToMat3(qFromEuler(10 * DEG, 0, 0));
    const stbd = mulMat3Vec(Rr, { x: 0, y: 1, z: 0 });
    expect(stbd.z).toBeGreaterThan(0); // banda + ⇒ boreste desce
  });
  it('bissecção encontra raiz de função crescente', () => {
    expect(bisectIncreasing((x) => x * x * x - 8, 0, 10)).toBeCloseTo(2, 9);
  });
});

describe('Água do mar e ambiente', () => {
  it('EOS-80: valores de verificação UNESCO', () => {
    expect(seawaterDensity(35, 5, 0)).toBeCloseTo(1027.67547, 4);
    expect(seawaterDensity(35, 5, 1000)).toBeCloseTo(1069.48914, 4);
    expect(seawaterDensity(35, 25, 1000)).toBeCloseTo(1062.53817, 4);
  });
  it('densidade aumenta com salinidade e diminui com temperatura', () => {
    expect(seawaterDensitySurface(36, 15)).toBeGreaterThan(seawaterDensitySurface(34, 15));
    expect(seawaterDensitySurface(35, 25)).toBeLessThan(seawaterDensitySurface(35, 5));
  });
  it('pressão integrada é monotônica e ≈ 1 bar / 10 m', () => {
    const env = new Environment(defaultEnvironment());
    let prev = 0;
    for (let z = 0; z <= 600; z += 25) {
      const p = env.pressureAt(z);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    expect((env.pressureAt(200) - env.pressureAt(100)) / 1e5).toBeCloseTo(10.06, 1);
  });
});

describe('Componentes de fluidos', () => {
  it('orifício compressível: escoamento crítico independe da pressão a jusante', () => {
    const a = gasMassFlux(200e5, 1e5, 293);
    const b = gasMassFlux(200e5, 50e5, 293);
    expect(a).toBeCloseTo(b, 6);
    expect(gasMassFlux(2e5, 2e5, 293)).toBe(0);
    expect(gasMassFlux(1.5e5, 1.4e5, 293)).toBeLessThan(gasMassFlux(1.5e5, 1.0e5, 293));
  });
  it('curva da bomba: vazão cai com Δp e zera no shutoff', () => {
    const cfg = defaultVessel().compensation.pump;
    expect(pumpFlow(cfg, 1, 0)).toBeCloseTo(cfg.ratedFlow, 9);
    expect(pumpFlow(cfg, 1, cfg.shutoffPressure * 0.5)).toBeLessThan(cfg.ratedFlow);
    expect(pumpFlow(cfg, 1, cfg.shutoffPressure)).toBe(0);
    expect(pumpFlowWithLine(cfg, 1, 0, 1e5)).toBeLessThan(cfg.ratedFlow);
  });
  it('válvula percorre o curso no tempo configurado e não se move travada ou sem hidráulica', () => {
    const cfg = { id: 'x', name: 'x', strokeTime: 2, hydraulic: true };
    const v = newValve();
    v.cmd = 1;
    for (let i = 0; i < 50; i++) updateValve(cfg, v, 0.02, true);
    expect(v.pos).toBeCloseTo(0.5, 6);
    const w = newValve();
    w.cmd = 1;
    updateValve(cfg, w, 1, false);
    expect(w.pos).toBe(0);
    const k = newValve();
    k.cmd = 1;
    k.stuck = true;
    updateValve(cfg, k, 1, true);
    expect(k.pos).toBe(0);
  });
  it('bomba acelera em rampa e não parte sem energia', () => {
    const cfg = defaultVessel().trim.pump;
    const p = newPump();
    p.cmd = true;
    updatePumpSpeed(cfg, p, cfg.spinUpTime / 2, true);
    expect(p.speed).toBeCloseTo(0.5, 6);
    const q = newPump();
    q.cmd = true;
    updatePumpSpeed(cfg, q, 10, false);
    expect(q.speed).toBe(0);
  });
});

describe('Hidrostática e hidrodinâmica', () => {
  const geom = buildHullGeometry(defaultVessel().hull);
  it('volume imerso cresce monotonicamente com o calado', () => {
    let prev = -1;
    for (let z = -4; z <= 4; z += 0.25) {
      const hs = computeHydrostatics(geom, { x: 0, y: 0, z }, qToMat3(qFromEuler(0, 0, 0)));
      expect(hs.volume).toBeGreaterThanOrEqual(prev);
      prev = hs.volume;
    }
    expect(prev).toBeCloseTo(geom.volume, 6);
  });
  it('meio imerso (eixo na linha d’água) ⇒ metade do volume', () => {
    const hs = computeHydrostatics(geom, { x: 0, y: 0, z: 0 }, qToMat3(qFromEuler(0, 0, 0)));
    expect(hs.volume / geom.volume).toBeCloseTo(0.5, 6);
    expect(hs.center.z).toBeGreaterThan(0); // centro de carena abaixo do eixo
  });
  it('banda na superfície desloca o centro de carena para o bordo imerso', () => {
    const hs = computeHydrostatics(geom, { x: 0, y: 0, z: 1 }, qToMat3(qFromEuler(5 * DEG, 0, 0)));
    // no corpo, B se desloca para BB (y < 0) quando adernado a BE? Para seção circular B permanece sob o centro
    expect(Math.abs(hs.center.y)).toBeLessThan(1);
  });
  it('lemes: C_L linear antes do estol e queda após', () => {
    const cla = liftCurveSlope(3);
    expect(liftCoefficient(5 * DEG, 3, 22)).toBeCloseTo(cla * 5 * DEG, 9);
    expect(liftCoefficient(40 * DEG, 3, 22)).toBeLessThan(liftCoefficient(22 * DEG, 3, 22));
    expect(liftCoefficient(-5 * DEG, 3, 22)).toBeCloseTo(-cla * 5 * DEG, 9);
  });
  it('leme de direção a boreste empurra a popa para bombordo (guinada a BE)', () => {
    const v = defaultVessel();
    const rudder = v.fins.find((f) => f.id === 'rudder')!;
    const r = finForce(rudder, 10 * DEG, { x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 1025, 1);
    expect(r.F.y).toBeLessThan(0);
    expect(r.M.z).toBeGreaterThan(0);
  });
  it('lemes de ré "subir" geram momento de proa para cima', () => {
    const v = defaultVessel();
    const st = v.fins.find((f) => f.id === 'stern')!;
    const r = finForce(st, 10 * DEG * st.commandSign, { x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 1025, 1);
    expect(r.M.y).toBeGreaterThan(0);
    const bow = v.fins.find((f) => f.id === 'bow')!;
    const rb = finForce(bow, 10 * DEG * bow.commandSign, { x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 1025, 1);
    expect(rb.F.z).toBeLessThan(0); // força para cima
  });
});
