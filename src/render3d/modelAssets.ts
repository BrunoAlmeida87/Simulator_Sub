import * as THREE from 'three';

/** Arquivos exportados dos originais Blender; escala e origem preservadas. */
export const MODEL_ASSETS = [
  { id: 'graneleiro', name: 'Navio graneleiro', file: 'graneleiro.glb' },
  { id: 'carga', name: 'Navio cargueiro', file: 'carga.glb' },
  { id: 'rebocador', name: 'Rebocador', file: 'rebocador.glb' },
  { id: 'asd', name: 'Rebocador ASD', file: 'rebocador_asd.glb' },
  { id: 'voith', name: 'Rebocador trator Voith', file: 'rebocador_trator_voith.glb' },
  { id: 'convencional', name: 'Rebocador convencional', file: 'rebocador_convencional.glb' },
  { id: 'frota', name: 'Frota de rebocadores', file: 'rebocadores_frota.glb' },
  { id: 'f21', name: 'Torpedo F21 — modelo visual', file: 'torpedo_f21.glb' },
] as const;
export type ModelId = (typeof MODEL_ASSETS)[number]['id'];
export function modelUrl(file: string): string {
  return `${import.meta.env.BASE_URL}models/${file}`;
}

/** Usar apenas em instâncias com recursos próprios (sem geometria compartilhada). */
export function disposeModel(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}
