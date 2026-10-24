/**
 * ARRANJO DO CORTE (Systems.ts) × CASCO RESISTENTE (pressureHull.ts): bombas, válvulas e
 * tubulações ficam dentro do casco resistente (só os tubos ao mar o atravessam) e nenhuma
 * válvula ou bomba fica dentro do volume de um tanque. Só desenho: a física não muda.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildScenario } from '../src/sim/scenarios';
import { SystemsVis } from '../src/render3d/Systems';
import { PRESSURE_HULL, insidePressureHullX, pressureHullInner } from '../src/render3d/pressureHull';
import { SHAFT_LINE, shaftEnvelope } from '../src/render3d/shaftLine';

const e = buildScenario('superficie');
const sys = new SystemsVis(e, null) as unknown as {
  tanks: { id: string; cat: string; pick: THREE.Mesh }[];
  valves: { name: string; mesh: THREE.Object3D; owners: string[] }[];
  pumps: { name: string; pos: THREE.Vector3 }[];
  pipePaths: THREE.Vector3[][];
};
(sys as unknown as { group: THREE.Object3D }).group.updateMatrixWorld(true);
/** cena (x boreste, y cima, z popa) → corpo (x vante, y boreste, z para baixo) */
const body = (p: THREE.Vector3) => ({ x: -p.z, y: p.x, z: -p.y });
const radial = (p: THREE.Vector3) => Math.hypot(p.x, p.y);
const rIn = (x: number) => pressureHullInner(x, e.geom.radiusAt);

/** meia-extensão das peças a partir do centro (válvula com flanges e volante; bomba com base e saídas) */
const VALVE_EXT = 0.35;
const PUMP_EXT = 0.55;

describe('corte: peças dentro do casco resistente', () => {
  it('válvulas e bombas cabem dentro do casco resistente (fora das regiões dos TLP)', () => {
    const bad: string[] = [];
    for (const v of sys.valves) {
      const b = body(v.mesh.position);
      if (insidePressureHullX(b.x) && radial(v.mesh.position) + VALVE_EXT > rIn(b.x)) bad.push(`${v.name} (r = ${radial(v.mesh.position).toFixed(2)} m)`);
    }
    for (const p of sys.pumps) {
      const b = body(p.pos);
      if (insidePressureHullX(b.x) && radial(p.pos) + PUMP_EXT > rIn(b.x)) bad.push(`${p.name} (r = ${radial(p.pos).toFixed(2)} m)`);
    }
    expect(bad).toEqual([]);
  });

  it('tubulações dentro do casco resistente (só os tubos ao mar atravessam até o casco externo)', () => {
    const bad: string[] = [];
    sys.pipePaths.forEach((pts, i) => {
      for (const p of pts) {
        const b = body(p);
        if (!insidePressureHullX(b.x)) continue;
        const r = radial(p);
        if (r >= e.geom.radiusAt(b.x)) continue; // ponto no mar (fora do casco externo): tubo de admissão/descarga
        if (r + 0.06 > rIn(b.x) + 0.0) bad.push(`tubo ${i + 1} em x = ${b.x.toFixed(1)} (r = ${r.toFixed(2)} m)`);
      }
    });
    expect(bad).toEqual([]);
  });

  it('nenhuma válvula ou bomba dentro do volume de um tanque', () => {
    const boxes = sys.tanks.map((t) => ({ id: t.id, box: new THREE.Box3().setFromObject(t.pick).expandByScalar(-0.02) }));
    const bad: string[] = [];
    // a válvula do próprio tanque (suspiro e sopro no topo do TLP) pode ficar no volume dele
    for (const v of sys.valves) for (const b of boxes) if (b.box.containsPoint(v.mesh.position) && !v.owners.includes(b.id)) bad.push(`${v.name} em ${b.id}`);
    for (const p of sys.pumps) for (const b of boxes) if (b.box.containsPoint(p.pos)) bad.push(`${p.name} em ${b.id}`);
    expect(bad).toEqual([]);
  });

  it('os tanques de lastro ficam fora do casco resistente; os internos, dentro', () => {
    for (const t of e.vessel.ballast.tanks) {
      const box = new THREE.Box3().setFromObject(sys.tanks.find((x) => x.id === t.id)!.pick);
      const xs = [-box.max.z, -box.min.z];
      if (t.center.x > 0) expect(Math.min(...xs), t.id).toBeGreaterThan(PRESSURE_HULL.fwd.base + PRESSURE_HULL.fwd.depth);
      else expect(Math.max(...xs), t.id).toBeLessThan(PRESSURE_HULL.aft.base - PRESSURE_HULL.aft.depth);
    }
    for (const t of sys.tanks.filter((x) => x.cat !== 'lastro')) {
      const box = new THREE.Box3().setFromObject(t.pick);
      expect(-box.max.z, t.id).toBeGreaterThan(PRESSURE_HULL.aft.base);
      expect(-box.min.z, t.id).toBeLessThan(PRESSURE_HULL.fwd.base);
    }
  });
});

describe('corte × linha de eixo (motor, mancal de escora, eixo)', () => {
  const gens = (sys as unknown as { gens: { mesh: THREE.Mesh }[] }).gens.map((g) => new THREE.Box3().setFromObject(g.mesh));
  const batt = (sys as unknown as { batt: THREE.Mesh[] }).batt.map((m) => new THREE.Box3().setFromObject(m));
  const tankBoxes = sys.tanks.map((t) => ({ id: t.id, box: new THREE.Box3().setFromObject(t.pick) }));
  /** distância mínima do eixo do casco a uma caixa da cena, considerando só as fatias x em que a envoltória existe */
  const boxClash = (b: THREE.Box3) => {
    const x0 = -b.max.z;
    const x1 = -b.min.z;
    // seção da caixa no plano transversal (y boreste = x da cena, z para baixo = −y da cena)
    const dy = Math.max(0, b.min.x, -b.max.x);
    const dz = Math.max(0, b.min.y, -b.max.y);
    const d = Math.hypot(dy, dz);
    // folga: 5 cm do motor e do mancal; 2 cm no trecho só do eixo (passa entre as metades do TLP-2)
    for (let x = x0; x <= x1; x += 0.05) {
      const env = shaftEnvelope(x);
      if (env > 0 && d < env + (env === SHAFT_LINE.shaftRadius ? 0.02 : 0.05)) return true;
    }
    return false;
  };

  it('o motor e o mancal ficam dentro do casco resistente; o eixo vai do motor ao hélice', () => {
    const S = SHAFT_LINE;
    expect(insidePressureHullX(S.motor.aft) && insidePressureHullX(S.motor.fwd)).toBe(true);
    expect(insidePressureHullX(S.thrustBearing.x)).toBe(true);
    expect(S.motor.radius).toBeLessThan(rIn(S.motor.aft) - 0.5);
    // ponta de ré: face de vante do cubo do hélice (o hélice fica 0,6 m a ré do fim do casco)
    expect(S.aftEnd).toBeCloseTo(-(e.vessel.hull.length / 2 + 0.6) + 0.75, 6);
    // o eixo passa entre as duas metades do TLP-2 (folga de cada lado do plano de simetria)
    for (const t of e.vessel.ballast.tanks.filter((x) => x.center.x < 0)) {
      const b = tankBoxes.find((x) => x.id === t.id)!.box;
      expect(Math.min(Math.abs(b.min.x), Math.abs(b.max.x)), t.id).toBeGreaterThan(S.shaftRadius);
    }
  });

  it('nada do corte encosta na linha de eixo (tanques, geradores, bateria, válvulas, bombas e tubos)', () => {
    const bad: string[] = [];
    for (const t of tankBoxes) if (boxClash(t.box)) bad.push(`tanque ${t.id}`);
    gens.forEach((g, i) => boxClash(g) && bad.push(`gerador ${i + 1}`));
    batt.forEach((g, i) => boxClash(g) && bad.push(`bateria ${i + 1}`));
    for (const v of sys.valves) {
      const b = body(v.mesh.position);
      if (shaftEnvelope(b.x) > 0 && Math.hypot(b.y, b.z) < shaftEnvelope(b.x) + VALVE_EXT) bad.push(v.name);
    }
    for (const p of sys.pumps) {
      const b = body(p.pos);
      if (shaftEnvelope(b.x) > 0 && Math.hypot(b.y, b.z) < shaftEnvelope(b.x) + PUMP_EXT) bad.push(p.name);
    }
    sys.pipePaths.forEach((pts, i) => {
      for (let k = 0; k < pts.length - 1; k++) {
        const n = Math.max(1, Math.ceil(pts[k].distanceTo(pts[k + 1]) / 0.1));
        for (let j = 0; j <= n; j++) {
          const b = body(pts[k].clone().lerp(pts[k + 1], j / n));
          if (shaftEnvelope(b.x) > 0 && Math.hypot(b.y, b.z) < shaftEnvelope(b.x) + 0.11) {
            bad.push(`tubo ${i + 1} em x = ${b.x.toFixed(1)}`);
            return;
          }
        }
      }
    });
    expect(bad).toEqual([]);
  });
});
