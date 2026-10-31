/**
 * ARQUIVOS DOS MODELOS DO MÍSSIL E DA FRAGATA (public/models/sx1-sm39.glb e sx1-fragata.glb), feitos por
 * scripts/blender/build_sm39.py, build_fragata.py + otimizar.mjs. Confere o contrato com MissileVis.ts:
 * nomes fixos, eixo para −z, medidas (cápsula 5,8 m × 533 mm; míssil 4,69 m; fragata ≈ 109 m), forma
 * "Recolhida" das asas e o radar giratório da fragata. Só visual: nada aqui toca a física.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { NodeIO, type Document, type Node as GNode } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { SM39_PARTS } from '../src/render3d/MissileVis';
import { defaultWeapons } from '../src/sim/config/defaultVessel';
import { FRIGATE } from '../src/sim/systems/missiles';

const file = (n: string) => join(__dirname, '..', 'public', 'models', `sx1-${n}.glb`);
const docs: Record<string, Document> = {};
beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  for (const n of ['sm39', 'fragata']) docs[n] = await io.read(file(n));
});
const node = (d: Document, name: string) =>
  d
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === name);

/** caixa (espaço da cena) das malhas abaixo de um nó */
function bounds(n: GNode): THREE.Box3 {
  const box = new THREE.Box3();
  const visit = (x: GNode) => {
    const mesh = x.getMesh();
    if (mesh) {
      const m = new THREE.Matrix4().fromArray(x.getWorldMatrix());
      for (const p of mesh.listPrimitives()) {
        const a = p.getAttribute('POSITION')!;
        const v = new THREE.Vector3();
        const el: number[] = [];
        for (let i = 0; i < a.getCount(); i += 3) {
          a.getElement(i, el);
          box.expandByPoint(v.set(el[0], el[1], el[2]).applyMatrix4(m));
        }
      }
    }
    x.listChildren().forEach(visit);
  };
  visit(n);
  return box;
}

describe('modelo do SM39 na cápsula VSM', () => {
  it('tem as peças com os nomes fixos', () => {
    for (const name of Object.values(SM39_PARTS)) expect(node(docs.sm39, name), name).toBeTruthy();
  });

  it('cápsula de 5,8 m × 533 mm com o eixo em −z; míssil de 4,69 m dentro dela', () => {
    const M = defaultWeapons().missile!;
    const cap = bounds(node(docs.sm39, SM39_PARTS.root)!).getSize(new THREE.Vector3());
    expect(cap.z).toBeGreaterThan(M.length - 0.1);
    expect(cap.z).toBeLessThan(M.length + 0.1);
    // a malha base das asas é a aberta (a forma "Recolhida" entra pela influência do morph): a largura é a do casco
    const shell = bounds(node(docs.sm39, SM39_PARTS.casing)!).getSize(new THREE.Vector3());
    expect(Math.max(shell.x, shell.y)).toBeLessThan(0.62);
    expect(Math.max(shell.x, shell.y)).toBeGreaterThan(0.5);
    const mis = bounds(node(docs.sm39, SM39_PARTS.body)!).getSize(new THREE.Vector3());
    expect(mis.z).toBeGreaterThan(M.missileLength - 0.1);
    expect(mis.z).toBeLessThan(M.missileLength + 0.1);
    // nariz à vante (−z)
    const nose = bounds(node(docs.sm39, SM39_PARTS.nose)!);
    expect(nose.getCenter(new THREE.Vector3()).z).toBeLessThan(-2);
  });

  it('asas e aletas com a forma "Recolhida" (morph) para caber na cápsula', () => {
    const n = node(docs.sm39, SM39_PARTS.surfaces)!;
    let targets = 0;
    n.traverse((x) =>
      x
        .getMesh()
        ?.listPrimitives()
        .forEach((p) => (targets += p.listTargets().length)),
    );
    expect(targets).toBeGreaterThan(0);
    // abertas: envergadura ≈ 1,1 m (bem maior que o furo do tubo)
    const span = bounds(n).getSize(new THREE.Vector3());
    expect(Math.max(span.x, span.y)).toBeGreaterThan(0.9);
  });

  it('arquivo leve (≤ 1 MB, comprimido)', () => {
    expect(statSync(file('sm39')).size).toBeLessThan(1024 * 1024);
    expect(
      docs.sm39
        .getRoot()
        .listExtensionsUsed()
        .map((e) => e.extensionName),
    ).toContain('EXT_meshopt_compression');
  });
});

describe('modelo da fragata classe Tamandaré', () => {
  it('casco ≈ 109 m com a proa em −z, linha d’água em y = 0 e radar giratório', () => {
    const root = node(docs.fragata, 'Fragata')!;
    const b = bounds(root);
    const size = b.getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThan(FRIGATE.L - 2);
    expect(size.z).toBeLessThan(FRIGATE.L + 5);
    expect(size.x).toBeLessThan(FRIGATE.B + 1);
    expect(b.min.y).toBeCloseTo(-FRIGATE.draft, 0);
    // bulbo e proa à vante (−z): a ponta de vante passa de −53 m
    expect(b.min.z).toBeLessThan(-53);
    expect(node(docs.fragata, 'Fragata_Radar')).toBeTruthy();
    expect(statSync(file('fragata')).size).toBeLessThan(2.5 * 1024 * 1024);
  });
});
