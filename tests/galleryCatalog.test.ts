import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { extraGalleryModels, needsBlender } from '../scripts/assets/gallery_catalog.mjs';

const newModels = [
  'fragata_tamandare.glb',
  'sm39_exocet.glb',
  'SM39_exocet_collection.glb',
  'SM_39VSM.glb',
];

describe('Galeria automática de modelos', () => {
  it('inclui os GLB recém-adicionados sem uma entrada manual no código', () => {
    const files = readdirSync('public/models');
    const assets = extraGalleryModels(files);
    expect(assets.map((asset) => asset.file)).toEqual(expect.arrayContaining(newModels));
    expect(assets.every((asset) => asset.name.length > 0)).toBe(true);
    expect(assets.some((asset) => asset.file === 'sx1-interior.glb')).toBe(false);
    expect(needsBlender(files)).toBe(false);
    expect(extraGalleryModels([...files, 'novo_modelo.glb']).some((asset) => asset.name === 'Novo Modelo')).toBe(true);
    expect(needsBlender([...files, 'novo_modelo.blend'])).toBe(true);
  });

  it.each(newModels)('%s contém geometria que o visualizador consegue abrir', async (file) => {
    const data = readFileSync(new URL(`../public/models/${file}`, import.meta.url));
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    expect(bounds.isEmpty()).toBe(false);
    expect(bounds.getSize(new THREE.Vector3()).length()).toBeGreaterThan(0);
  });
});
