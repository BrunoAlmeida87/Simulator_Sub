/**
 * ILUMINAÇÃO DA CENA 3D (apenas visual). Três perfis:
 *  - natural: a água escurece com a profundidade como no mar (casco escuro
 *    sobre fundo escuro);
 *  - clara (padrão): água mais clara, luz suave presa à câmera e contorno do
 *    casco realçado — o submarino se destaca do fundo em qualquer cota;
 *  - estudio: luz forte presa à câmera, para projetor ou sala clara.
 * Nada aqui altera a física.
 */
import * as THREE from 'three';

export type SceneLighting = 'natural' | 'clara' | 'estudio';

/** cor da água: [na superfície, no limite profundo, profundidade (m) em que chega ao limite] */
export type WaterGrad = [number, number, number];
export interface WaterPalette {
  up: WaterGrad;
  horizon: WaterGrad;
  down: WaterGrad;
}

export interface LightingProfile {
  /** exposição debaixo d'água e acima d'água */
  exposureUnder: number;
  exposureAbove: number;
  /** luz presa à câmera (direcional e ambiente), debaixo d'água; acima d'água vale a metade */
  camKey: number;
  camFill: number;
  /** realce do contorno do casco (0 = desligado) */
  rim: number;
  water: WaterPalette;
  hull: { color: number; emissive: number };
}

export const LIGHTING: Record<SceneLighting, LightingProfile> = {
  natural: {
    exposureUnder: 0.62,
    exposureAbove: 0.62,
    camKey: 0,
    camFill: 0,
    rim: 0,
    water: { up: [0x4a9bc4, 0x06243a, 250], horizon: [0x0e4566, 0x020a12, 200], down: [0x041a2a, 0x000306, 120] },
    hull: { color: 0x3a4654, emissive: 0x0e1923 },
  },
  clara: {
    exposureUnder: 0.85,
    exposureAbove: 0.7,
    camKey: 0.9,
    camFill: 0.3,
    rim: 0.45,
    water: { up: [0x62b4da, 0x2a6a8e, 400], horizon: [0x23739c, 0x134a6a, 320], down: [0x124560, 0x0a2e44, 260] },
    hull: { color: 0x46525f, emissive: 0x142230 },
  },
  estudio: {
    exposureUnder: 1,
    exposureAbove: 0.78,
    camKey: 1.5,
    camFill: 0.4,
    rim: 0.25,
    water: { up: [0x7cc4e2, 0x3c88ae, 500], horizon: [0x3a8db5, 0x286f95, 500], down: [0x1f5a7c, 0x16465f, 400] },
    hull: { color: 0x4d5c6c, emissive: 0x1d2c3a },
  },
};

/** cor da água na profundidade da câmera */
export function waterColor(g: WaterGrad, depth: number, out: THREE.Color): THREE.Color {
  return out.set(g[0]).lerp(new THREE.Color(g[1]), Math.min(1, depth / g[2]));
}

/** uniformes do realce de contorno (compartilhados pelos materiais do casco) */
export interface RimUniforms {
  uRim: { value: number };
  uRimColor: { value: THREE.Color };
}

/**
 * Realce de contorno (luz de recorte): soma ao brilho próprio do material
 * uma faixa clara onde a superfície fica de lado para a câmera, para a
 * silhueta escura do casco se destacar da água escura. Encadeia com outra
 * modificação de shader já presente (ex.: cáusticas).
 */
export function addRim(mat: THREE.MeshStandardMaterial, u: RimUniforms): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uRim = u.uRim;
    sh.uniforms.uRimColor = u.uRimColor;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uRim;\nuniform vec3 uRimColor;').replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
if (uRim > 0.0) {
  float rimF = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
  totalEmissiveRadiance += uRimColor * (pow(rimF, 2.5) * uRim);
}`,
    );
  };
  mat.customProgramCacheKey = () => 'rim|' + prev.toString();
}
