/**
 * ARQUIVOS DO MODELO 3D (public/models/sx1-alta.glb e sx1-leve.glb), feitos por
 * scripts/blender/build_sx1.py + otimizar.mjs. Confere o contrato com subModel.ts:
 * nomes fixos, pivôs na posição de repouso do desenho atual, casco igual a radiusAt
 * (o corte com os tanques depende disso), compressão e limites de tamanho.
 * Só visual: nada aqui toca a física.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { NodeIO, ImageUtils, type Document, type Node as GNode } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { REQUIRED_PARTS, SUB_PARTS, SubModelRig } from '../src/render3d/subModel';
import { defaultVessel } from '../src/sim/config/defaultVessel';
import { buildHullGeometry } from '../src/sim/physics/hullGeometry';
import { periscopeHeadZ, periscopeCfg } from '../src/sim/systems/actuation';

const v = defaultVessel();
const geom = buildHullGeometry(v.hull);
const R = v.hull.diameter / 2;
const file = (n: string) => join(__dirname, '..', 'public', 'models', `sx1-${n}.glb`);

const docs: Record<string, Document> = {};
beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  for (const n of ['alta', 'leve']) docs[n] = await io.read(file(n));
});

const world = (n: GNode) => new THREE.Matrix4().fromArray(n.getWorldMatrix());
const nodeByName = (d: Document, name: string) =>
  d
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === name);

/** pivôs esperados (espaço da cena: X boreste, Y cima, Z popa), iguais ao desenho atual em SubmarineScene */
function expectedPivots(): Record<string, [number, number, number]> {
  const bow = v.fins.find((f) => f.id === 'bow')!.position;
  const xs = v.fins.find((f) => f.id === 'stern')!.position.x;
  const r0 = geom.radiusAt(xs) - 0.1;
  const w = v.hull.sail.width / 2;
  const sn = v.hull.snorkelMast;
  const pc = periscopeCfg(v);
  const periY = -periscopeHeadZ(v, 0) - pc.extension / 2 - 0.65;
  return {
    [SUB_PARTS.sailPlaneStbd]: [w, -bow.z, -bow.x],
    [SUB_PARTS.sailPlanePort]: [-w, -bow.z, -bow.x],
    [SUB_PARTS.sternPlaneStbd]: [r0, 0, -xs],
    [SUB_PARTS.sternPlanePort]: [-r0, 0, -xs],
    [SUB_PARTS.rudderUpper]: [0, r0, -xs],
    [SUB_PARTS.rudderLower]: [0, -r0, -xs],
    [SUB_PARTS.propeller]: [0, 0, v.hull.length / 2 + 0.6],
    [SUB_PARTS.snorkelMast]: [0, R + v.hull.sail.height - sn.extension / 2, -sn.x],
    [SUB_PARTS.periscopeMast]: [0, periY, -pc.x],
    [SUB_PARTS.periscopeHead]: [0, periY + pc.extension / 2 + 0.3, -pc.x],
  };
}

describe.each(['alta', 'leve'])('modelo 3D sx1-%s.glb', (nivel) => {
  it('existe, é comprimido (meshopt + WebP) e cabe no limite', () => {
    expect(existsSync(file(nivel))).toBe(true);
    expect(statSync(file(nivel)).size).toBeLessThanOrEqual((nivel === 'alta' ? 6 : 2) * 1024 * 1024);
    const ext = docs[nivel]
      .getRoot()
      .listExtensionsUsed()
      .map((e) => e.extensionName);
    expect(ext).toContain('EXT_meshopt_compression');
    expect(ext).toContain('EXT_texture_webp');
    const maxTex = nivel === 'alta' ? 2048 : 1024;
    for (const t of docs[nivel].getRoot().listTextures()) {
      const size = ImageUtils.getSize(t.getImage()!, t.getMimeType());
      expect(t.getMimeType()).toBe('image/webp');
      expect(Math.max(...size!)).toBeLessThanOrEqual(maxTex);
    }
  });

  it('tem todas as peças com os nomes fixos e os pivôs na posição de repouso do desenho atual', () => {
    const d = docs[nivel];
    for (const n of [...REQUIRED_PARTS, SUB_PARTS.periscopeHead]) expect(nodeByName(d, n), n).toBeDefined();
    expect(nodeByName(d, SUB_PARTS.periscopeHead)!.getParentNode()?.getName()).toBe(SUB_PARTS.periscopeMast);
    for (const [name, p] of Object.entries(expectedPivots())) {
      const n = nodeByName(d, name)!;
      const m = world(n);
      const pos = new THREE.Vector3().setFromMatrixPosition(m);
      expect(pos.distanceTo(new THREE.Vector3(...p)), name).toBeLessThan(0.002);
      // pivô sem rotação nem escala (a cena gira em torno da origem da peça)
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      m.decompose(new THREE.Vector3(), q, s);
      expect(q.angleTo(new THREE.Quaternion()), name).toBeLessThan(1e-6);
      expect(s.distanceTo(new THREE.Vector3(1, 1, 1)), name).toBeLessThan(1e-6);
    }
  });

  it('a superfície do casco segue radiusAt (proa elíptica, corpo cilíndrico, popa parabólica)', () => {
    const n = nodeByName(docs[nivel], SUB_PARTS.hull)!;
    const m = world(n);
    const pos = n.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!;
    const el: number[] = [];
    const p = new THREE.Vector3();
    let worst = 0;
    let xmin = Infinity;
    let xmax = -Infinity;
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, el);
      p.set(el[0], el[1], el[2]).applyMatrix4(m);
      const x = -p.z; // proa = −Z da cena
      const r = Math.hypot(p.x, p.y);
      xmin = Math.min(xmin, x);
      xmax = Math.max(xmax, x);
      if (Math.abs(x) > v.hull.length / 2 - 1e-3 && r < v.hull.tailRadius + 0.01) continue; // ponta da proa e tampa da popa
      worst = Math.max(worst, Math.abs(r - geom.radiusAt(x)));
    }
    expect(worst).toBeLessThan(0.01);
    expect(xmax).toBeCloseTo(v.hull.length / 2, 2);
    expect(xmin).toBeCloseTo(-v.hull.length / 2, 2);
  });

  it('a hierarquia funciona no SubModelRig (peças, seleção e casco externo)', () => {
    // reconstrói os nós do arquivo em Three (malhas como caixas: só a hierarquia importa aqui)
    const root = new THREE.Group();
    const build = (gn: GNode, parent: THREE.Object3D) => {
      const o = gn.getMesh() ? new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial()) : new THREE.Object3D();
      o.name = gn.getName();
      o.position.fromArray(gn.getTranslation());
      o.quaternion.fromArray(gn.getRotation());
      o.scale.fromArray(gn.getScale());
      parent.add(o);
      for (const c of gn.listChildren()) build(c, o);
    };
    for (const gn of docs[nivel].getRoot().listScenes()[0].listChildren()) build(gn, root);
    const rig = new SubModelRig(root);
    const ids = rig.pickables.map((o) => (o.userData.pick as { id: string }).id).sort();
    expect(ids).toEqual(['bow', 'bow', 'prop', 'rudder', 'rudder', 'snorkel', 'stern', 'stern']);
    expect(rig.shellMeshes.length).toBeGreaterThan(5);
    // peças móveis não entram no casco externo
    for (const m of rig.shellMeshes) expect(m.name.startsWith('SX1_Leme') || m.name.startsWith('SX1_Helice') || m.name.startsWith('SX1_Mastro')).toBe(false);
  });
});
