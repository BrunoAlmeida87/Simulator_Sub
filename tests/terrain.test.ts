/** Os níveis distantes da costa não podem criar um falso fundo sobre o nível próximo. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TerrainLayer, type TerrainDetail } from '../src/render3d/Terrain';
import { Environment, defaultEnvironment } from '../src/sim/environment/environment';

function flatEnvironment() {
  const cfg = defaultEnvironment();
  // Fundo plano isola o recobrimento dos níveis da geometria da orla.
  return new Environment({ ...cfg, bottom: { ...cfg.bottom, mode: 'uniforme', baseDepth: 30 } });
}

function surfaceBelow(layer: TerrainLayer, x = 0, z = 0): number {
  layer.group.updateMatrixWorld(true);
  const meshes: THREE.Object3D[] = [];
  layer.group.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o);
  });
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
  const hits = ray.intersectObjects(meshes, false);
  expect(hits.length).toBeGreaterThan(0);
  return hits[0].point.y;
}

describe('Terreno da costa sem encobrir o corte do submarino', () => {
  it.each<TerrainDetail>(['baixa', 'media', 'alta'])('acima d’água: o fundo próximo prevalece com detalhe %s', (detail) => {
    const layer = new TerrainLayer(detail, () => {});
    try {
      layer.update(flatEnvironment(), 0, 0, true);
      layer.setVisible(true, true);
      // Antes havia um plano opaco a −3,2 m por cima do fundo a −30 m.
      expect(surfaceBelow(layer)).toBeCloseTo(-30, 5);
    } finally {
      layer.dispose();
    }
  });

  it('mantém o recorte alinhado quando os níveis se recentram em momentos diferentes', () => {
    const layer = new TerrainLayer('baixa', () => {});
    const env = flatEnvironment();
    try {
      for (const e of [0, 800, 1800, 3600, 7000, 16000]) {
        layer.update(env, 0, e, true);
        layer.setVisible(true, true);
        expect(surfaceBelow(layer)).toBeCloseTo(-30, 5);
      }
    } finally {
      layer.dispose();
    }
  });

  it('preserva o terreno distante e o fundo quando a câmera entra na água', () => {
    const layer = new TerrainLayer('media', () => {});
    try {
      layer.update(flatEnvironment(), 0, 0, true);
      layer.setVisible(true, true);
      expect(surfaceBelow(layer, 4000)).toBeCloseTo(-3.2, 5);
      layer.setVisible(true, false);
      expect(surfaceBelow(layer)).toBeCloseTo(-30, 5);
    } finally {
      layer.dispose();
    }
  });
});
