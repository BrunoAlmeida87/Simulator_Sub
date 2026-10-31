/**
 * GEOMETRIA DOS TUBOS LANÇADORES (pura, sem Three.js): tubos retos, paralelos ao eixo do casco.
 *
 * Cada tubo vai da culatra (face da porta interna, dentro do casco resistente) até a boca, onde a
 * parede externa do tubo chega a `muzzleClearance` do casco externo na proa elíptica. A porta do
 * casco externo (escotilha da boca) é o recorte do cilindro do tubo no casco: o centro fica onde o
 * eixo do tubo encontra o casco e o contorno é oval, porque a proa se fecha em volta do tubo.
 *
 * Usado pela física (posição da arma, da água do tubo e do ponto de lançamento), pelo interior do
 * Blender (exportar_interior.ts) e pelo casco externo (build_sx1.py repete as posições; o teste
 * tests/torpedoTubes.test.ts confere). Coordenadas do corpo: x vante, y boreste, z para baixo (m).
 */
import type { TorpedoTubeConfig, WeaponsConfig } from '../config/types';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

type RadiusAt = (x: number) => number;

/** distância do eixo do tubo ao eixo do casco (m) */
export const tubeRho = (t: Pick<TorpedoTubeConfig, 'y' | 'z'>) => Math.hypot(t.y, t.z);

/** x da proa em que o raio do casco externo vale rho (procura a vante de x0; o raio cai em direção à ponta). */
export function hullXAtRadius(R: RadiusAt, rho: number, x0: number): number {
  let lo = x0;
  let hi = x0;
  while (R(hi) > rho && hi < x0 + 60) hi += 0.5;
  if (R(lo) <= rho) return lo;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (R(mid) > rho) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Folga entre a parede externa do tubo, a s metros da culatra, e o casco externo (m; negativa = fura o casco). */
export function hullClearance(w: WeaponsConfig, t: TorpedoTubeConfig, s: number, R: RadiusAt): number {
  return R(w.breechX + s) - (tubeRho(t) + w.outerRadius);
}

const lengthCache = new WeakMap<RadiusAt, WeakMap<TorpedoTubeConfig, { w: WeaponsConfig; L: number }>>();

/** Comprimento do tubo (culatra → boca): a boca fica o mais à vante possível sem a parede sair do casco externo. */
export function tubeLength(w: WeaponsConfig, t: TorpedoTubeConfig, R: RadiusAt): number {
  let byTube = lengthCache.get(R);
  if (!byTube) lengthCache.set(R, (byTube = new WeakMap()));
  const hit = byTube.get(t);
  if (hit && hit.w === w) return hit.L;
  const L = hullXAtRadius(R, tubeRho(t) + w.outerRadius + w.muzzleClearance, w.breechX) - w.breechX;
  byTube.set(t, { w, L });
  return L;
}

/** x da boca do tubo (face de vante, onde fica a porta da boca). */
export const muzzleX = (w: WeaponsConfig, t: TorpedoTubeConfig, R: RadiusAt) => w.breechX + tubeLength(w, t, R);

/** Centro da face da culatra (porta interna). */
export const breechCenter = (w: WeaponsConfig, t: TorpedoTubeConfig): Vec3 => ({ x: w.breechX, y: t.y, z: t.z });

/** Centro da boca do tubo. */
export const muzzleCenter = (w: WeaponsConfig, t: TorpedoTubeConfig, R: RadiusAt): Vec3 => ({ x: muzzleX(w, t, R), y: t.y, z: t.z });

/** Centro da porta do casco externo: onde o eixo do tubo encontra o casco. */
export const doorCenter = (w: WeaponsConfig, t: TorpedoTubeConfig, R: RadiusAt): Vec3 => ({ x: hullXAtRadius(R, tubeRho(t), w.breechX), y: t.y, z: t.z });

/**
 * Contorno da porta do casco externo: o círculo de raio r em volta do eixo do tubo projetado ao
 * longo de x até o casco (n pontos, começando no ponto de cima e girando para boreste).
 */
export function doorOutline(w: WeaponsConfig, t: TorpedoTubeConfig, R: RadiusAt, r: number, n = 24): Vec3[] {
  const out: Vec3[] = [];
  for (let k = 0; k < n; k++) {
    const th = (2 * Math.PI * k) / n;
    const y = t.y + r * Math.sin(th);
    const z = t.z - r * Math.cos(th);
    out.push({ x: hullXAtRadius(R, Math.hypot(y, z), w.breechX), y, z });
  }
  return out;
}

/** Posição do centro da arma estivada no tubo (cauda junto à culatra, 15 cm de folga); length = comprimento da arma (padrão: F21). */
export const stowedWeaponX = (w: WeaponsConfig, length = w.weapon.length) => w.breechX + 0.15 + length / 2;

/** Percurso da arma dentro do tubo até a cauda passar a boca (m). */
export const ejectTravel = (w: WeaponsConfig, t: TorpedoTubeConfig, R: RadiusAt) => muzzleX(w, t, R) - (w.breechX + 0.15);

/** Volume interno do tubo (m³). */
export const boreVolume = (w: WeaponsConfig, t: TorpedoTubeConfig, R: RadiusAt) => Math.PI * w.boreRadius * w.boreRadius * tubeLength(w, t, R);
