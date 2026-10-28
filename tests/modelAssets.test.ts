import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MODEL_ASSETS, disposeModel } from '../src/render3d/modelAssets';
import { ImportedShips, assetForContact } from '../src/render3d/ImportedShips';
import { ShipsLayer } from '../src/render3d/Ships';
import { buildScenario } from '../src/sim/scenarios';
import { DEFAULT_ORIGIN } from '../src/sim/geo';
import { contactsAt } from '../src/sim/geo';
import manifest from '../public/models/manifest.json';

describe('Modelos exportados do Blender', () => {
  it.each(MODEL_ASSETS)('$name carrega com materiais, escala e geometria finita', async (asset) => {
    const buffer = readFileSync(new URL(`../public/models/${asset.file}`, import.meta.url));
    const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const gltf = await new GLTFLoader().parseAsync(data, '');
    try {
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      const source = manifest.assets.find((item) => item.file === asset.file)!;
      expect(source).toBeDefined();
      expect(buffer.length).toBe(source.bytes);
      const original = readFileSync(new URL(`../assets/blender/${source.source}`, import.meta.url));
      expect(createHash('sha256').update(original).digest('hex')).toBe(source.sha256);
      expect(bounds.isEmpty()).toBe(false);
      bounds.min.toArray().forEach((value, i) => expect(value).toBeCloseTo(source.bounds.min[i], 3));
      bounds.max.toArray().forEach((value, i) => expect(value).toBeCloseTo(source.bounds.max[i], 3));
      expect(bounds.getSize(new THREE.Vector3()).length()).toBeLessThan(200);
      let meshes = 0;
      gltf.scene.traverse((object) => {
        expect(object).not.toBeInstanceOf(THREE.Camera);
        expect(object).not.toBeInstanceOf(THREE.Light);
        if (!(object instanceof THREE.Mesh)) return;
        meshes++;
        expect(object.material).toBeDefined();
        const positions = object.geometry.getAttribute('position');
        expect(positions.array.every(Number.isFinite)).toBe(true);
        const indices = object.geometry.getIndex();
        if (indices) expect(indices.array.every((index: number) => index < positions.count)).toBe(true);
      });
      expect(meshes).toBeGreaterThan(0);
    } finally { disposeModel(gltf.scene); }
  });
});

describe('Modelos importados nos contatos existentes', () => {
  it('associa os seis navios aos GLBs correspondentes', () => {
    const expected: Record<string, string> = { M1: 'graneleiro', M2: 'carga', R1: 'rebocador', RCON: 'convencional', RASD: 'asd', RVOI: 'voith' };
    for (const [id, model] of Object.entries(expected)) {
      const contact = contactsAt(0).find((c) => c.id === id)!;
      expect(contact).toBeDefined();
      expect(assetForContact(contact)).toBe(model);
      expect(MODEL_ASSETS.some((asset) => asset.id === model)).toBe(true);
    }
  });
  it('preserva as representações dos demais tipos e das barcas', () => {
    expect(assetForContact({ kind: 'pesqueiro', name: 'Pesqueiro' })).toBeNull();
    expect(assetForContact({ kind: 'patrulha', name: 'Patrulha' })).toBeNull();
    expect(assetForContact({ kind: 'rebocador', name: 'Barca Rio–Niterói' })).toBeNull();
  });
});


it('troca os modelos simplificados sem duplicar contatos nem remover esteiras e luzes', async () => {
  const roots: THREE.Group[] = [];
  const mock = vi.spyOn(ImportedShips.prototype, 'instance').mockImplementation(async () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 10), new THREE.MeshStandardMaterial()));
    roots.push(root);
    return root;
  });
  const layer = new ShipsLayer();
  try {
    const engine = buildScenario('superficie');
    layer.update(engine, 0, 0, 0, DEFAULT_ORIGIN, 100, true, null, () => ({ x: 0, y: 0, visible: true }));
    await Promise.resolve();
    const imported = layer.group.children.flatMap((ship) => ship.children.filter((child) => child.userData.modelAsset));
    expect(imported).toHaveLength(6);
    expect(layer.group.children).toHaveLength(contactsAt(0).length);
    for (const ship of layer.group.children.filter((ship) => ship.children.some((child) => child.userData.modelAsset))) {
      expect(ship.children).toHaveLength(3); // modelo importado, esteira e luzes
      const model = ship.children.find((child) => child.userData.modelAsset)!;
      const length = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).z;
      expect(length).toBeGreaterThan(0);
    }
  } finally {
    layer.dispose();
    roots.forEach(disposeModel);
    mock.mockRestore();
  }
});
