/**
 * TUBOS LANÇADORES E SALA DE TORPEDOS (torpedoTubes.ts): bocas atrás das portas do casco externo,
 * culatras dentro do casco resistente, tubos longos o bastante para a arma e nada do corte encostando
 * neles. Só desenho: a física não muda.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { tankSection } from '../src/sim/systems/tankShape';
import { buildScenario } from '../src/sim/scenarios';
import { SystemsVis } from '../src/render3d/Systems';
import { PRESSURE_HULL, pressureHullInner } from '../src/render3d/pressureHull';
import { TORPEDO_ROOM, TORPEDO_TUBES, TUBES, WEAPONS, breechCenter, doorCenter, doorOutline, domeCrossing, forwardDomeX, hullClearance, muzzleCenter, tubeAxis, tubeLength, type Vec3 } from '../src/render3d/torpedoTubes';

const e = buildScenario('superficie');
const R = e.geom.radiusAt;
const T = TORPEDO_TUBES;
const sys = new SystemsVis(e, null) as unknown as {
  tanks: { id: string; pick: THREE.Mesh }[];
  valves: { name: string; mesh: THREE.Object3D }[];
  pumps: { name: string; pos: THREE.Vector3 }[];
  pipePaths: THREE.Vector3[][];
  group: THREE.Object3D;
};
sys.group.updateMatrixWorld(true);
/** cena (x boreste, y cima, z popa) → corpo (x vante, y boreste, z para baixo) */
const body = (p: THREE.Vector3): Vec3 => ({ x: -p.z, y: p.x, z: -p.y });
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** distância de um ponto ao segmento do eixo do tubo (culatra → boca) */
function axisDistance(p: Vec3, t: (typeof TUBES)[number]): number {
  const b = breechCenter(t);
  const a = tubeAxis(t, R);
  const L = tubeLength(t, R);
  const s = Math.max(0, Math.min(L, (p.x - b.x) * a.x + (p.y - b.y) * a.y + (p.z - b.z) * a.z));
  return dist(p, { x: b.x + a.x * s, y: b.y + a.y * s, z: b.z + a.z * s });
}

/** pontos de cada tubulação do corte a cada 10 cm */
const pipeSamples = sys.pipePaths.map((pts) => {
  const out: Vec3[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const n = Math.max(1, Math.ceil(pts[k].distanceTo(pts[k + 1]) / 0.1));
    for (let j = 0; j <= n; j++) out.push(body(pts[k].clone().lerp(pts[k + 1], j / n)));
  }
  return out;
});

describe('tubos lançadores de torpedo', () => {
  it('seis tubos de 533 mm, ímpares a boreste, longos o bastante para a arma (6,4 m + folga)', () => {
    expect(TUBES.map((t) => t.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(TUBES.filter((t) => t.side === 'BE').map((t) => t.n)).toEqual([1, 3, 5]);
    expect(T.boreRadius * 2).toBeGreaterThan(T.caliber);
    for (const t of TUBES) expect(tubeLength(t, R), `tubo ${t.n}`).toBeGreaterThan(7.0);
  });

  it('os tubos são retos e paralelos ao eixo do casco (culatra e boca na mesma linha)', () => {
    for (const t of TUBES) {
      expect(tubeAxis(t, R)).toEqual({ x: 1, y: 0, z: 0 });
      const b = breechCenter(t);
      const m = muzzleCenter(t, R);
      expect(m.y).toBe(b.y);
      expect(m.z).toBe(b.z);
    }
  });

  it('as portas das bocas ficam no nariz da proa, sobre o casco, sem se encostar', () => {
    const outlines = TUBES.map((t) => doorOutline(t, R, 32));
    for (const [k, o] of outlines.entries()) {
      for (const p of o) {
        expect(Math.hypot(p.y, p.z), `porta ${TUBES[k].n}`).toBeCloseTo(R(p.x), 3);
        expect(p.x).toBeGreaterThan(e.vessel.hull.length / 2 - e.vessel.hull.bowLength);
      }
    }
    for (let a = 0; a < TUBES.length; a++)
      for (let b = a + 1; b < TUBES.length; b++) {
        const d = Math.hypot(TUBES[a].y - TUBES[b].y, TUBES[a].z - TUBES[b].z);
        expect(d, `portas ${TUBES[a].n} × ${TUBES[b].n}`).toBeGreaterThan(2 * TORPEDO_TUBES.doorRadius + 0.1);
      }
  });

  it('o casco externo do Blender (build_sx1.py) usa as mesmas posições dos tubos e o mesmo raio de porta', () => {
    const py = readFileSync(join(__dirname, '..', 'scripts', 'blender', 'build_sx1.py'), 'utf-8');
    const list = py.match(/TUBES_TT = \[(.*)\]/)![1];
    const tubes = [...list.matchAll(/\((\d+), (-?[\d.]+), (-?[\d.]+)\)/g)].map((m) => ({ n: Number(m[1]), y: Number(m[2]), z: Number(m[3]) }));
    expect(tubes).toEqual(TUBES.map((t) => ({ n: t.n, y: t.y, z: t.z })));
    expect(Number(py.match(/TUBE_DOOR_R = ([\d.]+)/)![1])).toBeCloseTo(TORPEDO_TUBES.doorRadius, 6);
  });

  it('a boca fica logo atrás da porta do casco externo e a parede não sai do casco', () => {
    for (const t of TUBES) {
      const m = muzzleCenter(t, R);
      const d = doorCenter(t, R);
      expect(m.x, `tubo ${t.n}`).toBeLessThan(d.x);
      expect(dist(m, d), `tubo ${t.n}`).toBeLessThan(1.0);
      // a porta do casco está no próprio casco externo
      expect(Math.hypot(d.y, d.z)).toBeCloseTo(R(d.x), 6);
      const L = tubeLength(t, R);
      for (let s = 0; s <= L; s += 0.1) expect(hullClearance(t, s, R), `tubo ${t.n} em s = ${s.toFixed(1)}`).toBeGreaterThan(0.02);
    }
  });

  it('a culatra fica dentro do casco resistente e o tubo atravessa a antepara de vante', () => {
    for (const t of TUBES) {
      const b = breechCenter(t);
      const rho = Math.hypot(b.y, b.z);
      expect(b.x).toBeLessThan(PRESSURE_HULL.fwd.base);
      expect(rho + T.outerRadius + 0.1).toBeLessThan(pressureHullInner(b.x, R));
      const s = domeCrossing(t, R);
      expect(s).toBeGreaterThan(0.5); // espaço para a culatra e as válvulas dentro do casco resistente
      const a = tubeAxis(t, R);
      const p = { x: b.x + a.x * s, y: b.y + a.y * s, z: b.z + a.z * s };
      expect(p.x).toBeCloseTo(forwardDomeX(Math.hypot(p.y, p.z)), 3);
    }
  });

  it('os tubos não se encostam (parede com parede)', () => {
    for (const t of TUBES)
      for (const u of TUBES) {
        if (u.n <= t.n) continue;
        const L = tubeLength(u, R);
        const b = breechCenter(u);
        const a = tubeAxis(u, R);
        let min = Infinity;
        for (let s = 0; s <= L; s += 0.05) min = Math.min(min, axisDistance({ x: b.x + a.x * s, y: b.y + a.y * s, z: b.z + a.z * s }, t));
        expect(min, `tubos ${t.n} × ${u.n}`).toBeGreaterThan(2 * T.outerRadius + 0.03);
      }
  });

  it('nada do corte encosta nos tubos (tubulações, válvulas, bombas e tanques internos)', () => {
    const bad: string[] = [];
    for (const t of TUBES) {
      pipeSamples.forEach((pts, i) => {
        if (pts.some((p) => axisDistance(p, t) < T.outerRadius + 0.11 + 0.08)) bad.push(`tubo ${t.n} × tubulação ${i + 1}`);
      });
      for (const v of sys.valves) if (axisDistance(body(v.mesh.position), t) < T.outerRadius + 0.35) bad.push(`tubo ${t.n} × ${v.name}`);
      for (const p of sys.pumps) if (axisDistance(body(p.pos), t) < T.outerRadius + 0.55) bad.push(`tubo ${t.n} × ${p.name}`);
      // tanques: os TLP-1 envolvem os tubos (como num submarino real); os internos não podem encostar
      for (const k of sys.tanks.filter((x) => !x.id.startsWith('TLP'))) {
        const box = new THREE.Box3().setFromObject(k.pick).expandByScalar(T.outerRadius + 0.05);
        const b = breechCenter(t);
        const a = tubeAxis(t, R);
        for (let s = -0.2; s <= tubeLength(t, R); s += 0.1) {
          const p = { x: b.x + a.x * s, y: b.y + a.y * s, z: b.z + a.z * s };
          if (box.containsPoint(new THREE.Vector3(p.y, -p.z, -p.x))) {
            bad.push(`tubo ${t.n} × tanque ${k.id}`);
            break;
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('sala de torpedos', () => {
  const S = TORPEDO_ROOM;
  const ttav = e.vessel.trim.tankA;

  it('o piso fica sobre o TT-AV e as estantes, os cilindros e as garrafas dentro do casco resistente', () => {
    expect(S.deck.z + S.deck.thickness).toBeLessThanOrEqual(ttav.center.z - ttav.height / 2 + 1e-9);
    expect(S.deck.x1).toBeLessThanOrEqual(T.breechX);
    const rIn = PRESSURE_HULL.innerRadius;
    for (const z of S.racks.tiers) expect(Math.hypot(S.racks.y + 0.4, z), `estante z = ${z}`).toBeLessThan(rIn);
    for (const z of T.rowZ) {
      expect(Math.hypot(S.flask.y + S.flask.radius, z)).toBeLessThan(rIn - 0.1);
      expect(Math.hypot(S.ejector.y + S.ejector.radius, z)).toBeLessThan(rIn - 0.1);
    }
    // as garrafas ficam a vante das estantes; os cilindros ao lado das culatras, sem encostar nelas
    expect(S.flask.x0).toBeGreaterThan(S.racks.x1);
    expect(S.ejector.y - S.ejector.radius).toBeGreaterThan(T.breechY + T.outerRadius + 0.1);
    expect(S.ejector.x1).toBeLessThan(forwardDomeX(S.ejector.y));
  });

  it('os tanques de compensação das armas (TCA) ficam sob o piso, entre o costado e o TT-AV, sem nada do corte dentro', () => {
    const bad: string[] = [];
    for (const t of WEAPONS.tca) {
      const sec = tankSection(t);
      const x0 = t.center.x - sec.length / 2;
      const x1 = t.center.x + sec.length / 2;
      expect(sec.zTop, t.id).toBeGreaterThanOrEqual(S.deck.z + S.deck.thickness);
      expect(x1, t.id).toBeLessThan(PRESSURE_HULL.fwd.base);
      // ao lado do TT-AV, sem sobrepor
      expect(Math.min(Math.abs(sec.y0), Math.abs(sec.y1)), t.id).toBeGreaterThan(ttav.width! / 2);
      const inside = (p: Vec3, m: number) => p.x > x0 - m && p.x < x1 + m && p.y > sec.y0 - m && p.y < sec.y1 + m && p.z > sec.zTop - m && p.z < sec.zBot + m;
      pipeSamples.forEach((pts, i) => pts.some((p) => inside(p, 0.08)) && bad.push(`${t.id} × tubulação ${i + 1}`));
      for (const v of sys.valves) if (inside(body(v.mesh.position), 0.2)) bad.push(`${t.id} × ${v.name}`);
      for (const p of sys.pumps) if (inside(body(p.pos), 0.4)) bad.push(`${t.id} × ${p.name}`);
      // tanques internos do corte (fora os próprios TCA)
      for (const k of sys.tanks.filter((x) => !x.id.startsWith('TLP') && !x.id.startsWith('TCA'))) {
        const box = new THREE.Box3().setFromObject(k.pick);
        const mine = new THREE.Box3(new THREE.Vector3(Math.min(sec.y0, sec.y1), -sec.zBot, -x1), new THREE.Vector3(Math.max(sec.y0, sec.y1), -sec.zTop, -x0));
        if (box.intersectsBox(mine.expandByScalar(-0.01))) bad.push(`${t.id} × tanque ${k.id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('nada do corte encosta nas garrafas, nos cilindros de ejeção e nas estantes', () => {
    const parts: { name: string; x0: number; x1: number; y: number; z: number; r: number }[] = [];
    for (const z of T.rowZ)
      for (const sd of [1, -1]) {
        parts.push({ name: `garrafa ${sd > 0 ? 'BE' : 'BB'} z=${z}`, x0: S.flask.x0, x1: S.flask.x1 + 0.4, y: sd * S.flask.y, z, r: S.flask.radius });
        parts.push({ name: `ejetor ${sd > 0 ? 'BE' : 'BB'} z=${z}`, x0: S.ejector.x0, x1: S.ejector.x1, y: sd * S.ejector.y, z, r: S.ejector.radius });
      }
    for (const z of S.racks.tiers) for (const sd of [1, -1]) parts.push({ name: `estante ${sd > 0 ? 'BE' : 'BB'} z=${z}`, x0: S.racks.x0, x1: S.racks.x1, y: sd * S.racks.y, z, r: 0.45 });
    const near = (p: Vec3, q: (typeof parts)[number], ext: number) => p.x > q.x0 - ext && p.x < q.x1 + ext && Math.hypot(p.y - q.y, p.z - q.z) < q.r + ext;
    const bad: string[] = [];
    for (const q of parts) {
      pipeSamples.forEach((pts, i) => pts.some((p) => near(p, q, 0.13)) && bad.push(`${q.name} × tubulação ${i + 1}`));
      for (const v of sys.valves) if (near(body(v.mesh.position), q, 0.35)) bad.push(`${q.name} × ${v.name}`);
      for (const p of sys.pumps) if (near(body(p.pos), q, 0.55)) bad.push(`${q.name} × ${p.name}`);
    }
    expect(bad).toEqual([]);
  });
});
