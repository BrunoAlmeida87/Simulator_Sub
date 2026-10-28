/** GLBs compartilhados por camada: uma transferência por modelo, cópias leves por contato. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Contact } from '../sim/geo';
import { MODEL_ASSETS, modelUrl, disposeModel, type ModelId } from './modelAssets';

export function assetForContact(c: Pick<Contact, 'kind' | 'name'>): ModelId | null {
  if (c.kind === 'mercante') return /cont[eê]iner|cargueiro/i.test(c.name) ? 'carga' : 'graneleiro';
  if (c.kind !== 'rebocador' || /barca/i.test(c.name)) return null;
  if (/convencional/i.test(c.name)) return 'convencional';
  if (/\basd\b/i.test(c.name)) return 'asd';
  if (/voith|trator/i.test(c.name)) return 'voith';
  return 'rebocador';
}

export class ImportedShips {
  private pending = new Map<ModelId, Promise<THREE.Group | null>>();
  private roots: THREE.Group[] = [];
  private disposed = false;

  async instance(id: ModelId): Promise<THREE.Group | null> {
    if (this.disposed || typeof window === 'undefined') return null;
    let pending = this.pending.get(id);
    if (!pending) {
      const asset = MODEL_ASSETS.find((a) => a.id === id)!;
      pending = new GLTFLoader().loadAsync(modelUrl(asset.file)).then(({ scene }) => {
        if (this.disposed) { disposeModel(scene); return null; }
        this.roots.push(scene);
        return scene;
      }).catch((error: unknown) => {
        if (!this.disposed) console.warn(`Modelo ${asset.name} indisponível; mantendo modelo simplificado.`, error);
        return null;
      });
      this.pending.set(id, pending);
    }
    const root = await pending;
    return !this.disposed && root ? root.clone(true) : null;
  }

  dispose(): void {
    this.disposed = true;
    this.roots.forEach(disposeModel);
    this.roots = [];
    this.pending.clear();
  }
}
