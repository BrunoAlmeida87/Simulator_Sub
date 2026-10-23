/**
 * MODELO 3D .glb (subModel.ts): nomes fixos das peças, ligação ao estado e
 * mistura dos lemes de popa em X. Só visual: nada aqui toca a física.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SUB_PARTS, REQUIRED_PARTS, SubModelRig, sternFinAngle, mastLift, subModelLevel } from '../src/render3d/subModel';
import { buildScenario } from '../src/sim/scenarios';
import { periscopeHeadZ } from '../src/sim/systems/actuation';

const D = Math.PI / 180;

/** modelo mínimo com os nomes fixos (como sairia do Blender), popa em cruz */
function fakeModel(opts: { skip?: string } = {}): THREE.Group {
  const root = new THREE.Group();
  const box = () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  const add = (name: string, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    if (name === opts.skip) return null;
    const m = box();
    m.name = name;
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  add(SUB_PARTS.hull, 0, 0, 0);
  add(SUB_PARTS.sail, 0, 4, -9);
  add(SUB_PARTS.sailPlanePort, -1, 5.8, -10.5);
  add(SUB_PARTS.sailPlaneStbd, 1, 5.8, -10.5);
  const r = 1.8;
  add(SUB_PARTS.sternPlaneStbd, r, 0, 31.5);
  add(SUB_PARTS.sternPlanePort, -r, 0, 31.5);
  add(SUB_PARTS.rudderUpper, 0, r, 31.5);
  add(SUB_PARTS.rudderLower, 0, -r, 31.5);
  add(SUB_PARTS.propeller, 0, 0, 35.6);
  add(SUB_PARTS.snorkelMast, 0, 6, -8);
  const pm = add(SUB_PARTS.periscopeMast, 0, 5, -12);
  if (pm) add(SUB_PARTS.periscopeHead, 0, 2, 0, pm);
  return root;
}

describe('modelo 3D .glb — peças e mistura dos lemes', () => {
  it('em cruz reproduz o desenho atual (profundor em torno de +X, direção em torno de +Y)', () => {
    const gH = 12 * D;
    const gV = -7 * D;
    expect(sternFinAngle(0, gH, gV)).toBeCloseTo(gH); // BE: giro +X
    expect(sternFinAngle(Math.PI, gH, gV)).toBeCloseTo(-gH); // BB: eixo radial −X → −gH = +gH em X
    expect(sternFinAngle(Math.PI / 2, gH, gV)).toBeCloseTo(gV); // superior: giro +Y
    expect(sternFinAngle(-Math.PI / 2, gH, gV)).toBeCloseTo(-gV);
  });

  it('em X os quatro lemes dão a mesma força de profundor e de direção que a cruz de mesma área', () => {
    const phis = [45, 135, 225, 315].map((a) => a * D);
    for (const [gH, gV] of [
      [10 * D, 0],
      [0, 8 * D],
      [6 * D, -5 * D],
    ]) {
      // força normal de um leme ∝ área·θ, na direção (−sen φ, cos φ); X: 4 lemes de área A/2, cruz: 2 + 2 de área A/2
      let fy = 0;
      let fx = 0;
      for (const p of phis) {
        const th = sternFinAngle(p, gH, gV);
        fy += th * Math.cos(p);
        fx += -th * Math.sin(p);
      }
      expect(fy).toBeCloseTo(2 * gH, 9);
      expect(fx).toBeCloseTo(-2 * gV, 9);
    }
    // saturação: cada leme limitado ao máximo
    expect(Math.abs(sternFinAngle(45 * D, 25 * D, 30 * D, 25 * D))).toBeCloseTo(25 * D);
  });

  it('o modelo sem uma peça obrigatória é recusado (fica a reserva)', () => {
    for (const n of REQUIRED_PARTS) expect(() => new SubModelRig(fakeModel({ skip: n }))).toThrow(n);
    expect(() => new SubModelRig(fakeModel())).not.toThrow();
  });

  it('as peças seguem o estado: lemes, hélice, mastros e cabeça do periscópio', () => {
    const e = buildScenario('superficie');
    const v = e.vessel;
    const s = structuredClone(e.state);
    const rig = new SubModelRig(fakeModel());
    const get = (n: string) => rig.root.getObjectByName(n)!;
    const restSn = get(SUB_PARTS.snorkelMast).position.y;
    const restPm = get(SUB_PARTS.periscopeMast).position.y;
    s.snorkel.pos = 1;
    s.periscope = { cmd: true, pos: 1 };
    s.propulsion.shaftAngle = 0.7;
    rig.update(v, s, 10 * D, 0, 0, 25 * D, 90, true);
    // lemes de vela: os dois bordos giram igual em torno de +X
    for (const n of [SUB_PARTS.sailPlanePort, SUB_PARTS.sailPlaneStbd]) {
      const q = get(n).quaternion;
      const e2 = new THREE.Euler().setFromQuaternion(q);
      expect(e2.x).toBeCloseTo(10 * D);
      expect(e2.y).toBeCloseTo(0);
    }
    // hélice em torno do eixo longitudinal
    expect(new THREE.Euler().setFromQuaternion(get(SUB_PARTS.propeller).quaternion).z).toBeCloseTo(-0.7);
    // mastros sobem o curso da física
    expect(get(SUB_PARTS.snorkelMast).position.y - restSn).toBeCloseTo(v.hull.snorkelMast.extension);
    expect(get(SUB_PARTS.periscopeMast).position.y - restPm).toBeCloseTo(periscopeHeadZ(v, 0) - periscopeHeadZ(v, 1));
    expect(mastLift(v, s).snorkel).toBeCloseTo(v.hull.snorkelMast.extension);
    expect(new THREE.Euler().setFromQuaternion(get(SUB_PARTS.periscopeHead).quaternion).y).toBeCloseTo(-90 * D);
    // popa em cruz: profundor gira os dois lemes horizontais em torno de +X; direção gira os verticais em torno de +Y
    rig.update(v, s, 0, 10 * D, -6 * D, 25 * D, 0, false);
    const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 10 * D);
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -6 * D);
    for (const n of [SUB_PARTS.sternPlanePort, SUB_PARTS.sternPlaneStbd]) expect(get(n).quaternion.angleTo(qx)).toBeLessThan(1e-6);
    for (const n of [SUB_PARTS.rudderUpper, SUB_PARTS.rudderLower]) expect(get(n).quaternion.angleTo(qy)).toBeLessThan(1e-6);
    expect(get(SUB_PARTS.periscopeMast).visible).toBe(false);
  });

  it('casco externo, seleção e materiais próprios por cena', () => {
    const src = fakeModel();
    const a = new SubModelRig(src);
    const b = new SubModelRig(src);
    const names = a.shellMeshes.map((m) => m.name).sort();
    expect(names).toEqual([SUB_PARTS.hull, SUB_PARTS.sail].sort());
    const picks = a.pickables.map((p) => (p.userData.pick as { kind: string; id: string }).kind);
    expect(picks.filter((k) => k === 'fin')).toHaveLength(6);
    const ids = a.pickables.map((p) => (p.userData.pick as { id: string }).id);
    expect(ids.filter((i) => i === 'stern')).toHaveLength(2);
    expect(ids.filter((i) => i === 'rudder')).toHaveLength(2);
    expect(picks).toContain('prop');
    expect(picks).toContain('mast');
    // o corte troca o material de uma cena sem mexer na outra
    const ma = (a.root.getObjectByName(SUB_PARTS.hull) as THREE.Mesh).material;
    const mb = (b.root.getObjectByName(SUB_PARTS.hull) as THREE.Mesh).material;
    expect(ma).not.toBe(mb);
  });

  it('a qualidade gráfica escolhe a versão do arquivo', () => {
    expect(subModelLevel('baixa')).toBe('leve');
    expect(subModelLevel('media')).toBe('alta');
    expect(subModelLevel('alta')).toBe('alta');
  });
});
