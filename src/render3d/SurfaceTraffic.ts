import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { contactsAt, DEFAULT_ORIGIN, latLonToNed, nedToLatLon, type Contact, type LatLon } from '../sim/geo';
import { MODEL_ASSETS, modelUrl, disposeModel, type ModelId } from './modelAssets';

/** IDs estáveis do quadro tático; os demais contatos mantêm sua representação no mapa. */
export const CONTACT_MODELS: Readonly<Record<string, ModelId>> = {
  M1: 'graneleiro', M2: 'carga', R1: 'rebocador', R2: 'convencional', R3: 'asd', R4: 'voith',
};

/** Mesmo referencial geográfico usado pelo mapa, com origem flutuante do submarino. */
export function surfacePose(contact: Contact, origin: LatLon, own: { n: number; e: number }) {
  const local = latLonToNed(origin, nedToLatLon(DEFAULT_ORIGIN, contact.n, contact.e));
  return { x: local.e - own.e, z: -(local.n - own.n), yaw: -THREE.MathUtils.degToRad(contact.course) };
}

export class SurfaceTraffic {
  readonly group = new THREE.Group();
  private vessels = new Map<string, THREE.Group>();
  private disposed = false;

  constructor(onError: (message: string) => void) {
    const loader = new GLTFLoader();
    for (const [contactId, modelId] of Object.entries(CONTACT_MODELS)) {
      const asset = MODEL_ASSETS.find((item) => item.id === modelId)!;
      loader.load(modelUrl(asset.file), (gltf) => {
        if (this.disposed) { disposeModel(gltf.scene); return; }
        const vessel = gltf.scene;
        vessel.name = contactId;
        // Não aparece na origem enquanto aguarda a primeira atualização de posição.
        vessel.visible = false;
        this.vessels.set(contactId, vessel);
        this.group.add(vessel);
      }, undefined, () => {
        if (!this.disposed) onError(`Não foi possível carregar ${asset.name}. Reabra a tela para tentar novamente.`);
      });
    }
  }

  update(time: number, origin: LatLon, own: { n: number; e: number }, visible: boolean): void {
    this.group.visible = visible;
    for (const contact of contactsAt(time)) {
      const vessel = this.vessels.get(contact.id);
      if (!vessel) continue;
      const pose = surfacePose(contact, origin, own);
      vessel.position.set(pose.x, 0, pose.z);
      vessel.rotation.y = pose.yaw;
      vessel.visible = true;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    this.vessels.forEach(disposeModel);
    this.vessels.clear();
    this.group.clear();
  }
}
