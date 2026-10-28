import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MODEL_ASSETS, disposeModel } from '../src/render3d/modelAssets';
import { CONTACT_MODELS, surfacePose } from '../src/render3d/SurfaceTraffic';
import { contactsAt, DEFAULT_ORIGIN, OFFSHORE_ORIGIN, latLonToNed, nedToLatLon } from '../src/sim/geo';
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

describe('Contatos 3D e mapa tático', () => {
  it('associa todos os modelos de superfície a contatos existentes', () => {
    const contacts = contactsAt(0);
    for (const [id, modelId] of Object.entries(CONTACT_MODELS)) {
      expect(contacts.some((contact) => contact.id === id)).toBe(true);
      expect(MODEL_ASSETS.some((asset) => asset.id === modelId)).toBe(true);
    }
    expect(new Set(Object.values(CONTACT_MODELS)).size).toBe(6);
  });
  it.each([DEFAULT_ORIGIN, OFFSHORE_ORIGIN])('mantém a posição do mapa ao mudar a origem: %o', (origin) => {
    const own = { n: 120, e: -250 };
    for (const contact of contactsAt(125)) {
      const pose = surfacePose(contact, origin, own);
      const expected = latLonToNed(origin, nedToLatLon(DEFAULT_ORIGIN, contact.n, contact.e));
      expect(pose.x).toBeCloseTo(expected.e - own.e, 6);
      expect(pose.z).toBeCloseTo(-(expected.n - own.n), 6);
      const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), pose.yaw);
      expect(forward.x).toBeCloseTo(Math.sin(THREE.MathUtils.degToRad(contact.course)), 6);
      expect(forward.z).toBeCloseTo(-Math.cos(THREE.MathUtils.degToRad(contact.course)), 6);
    }
  });
});
