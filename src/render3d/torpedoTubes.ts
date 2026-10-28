/**
 * TUBOS LANÇADORES DE TORPEDO E SALA DE TORPEDOS (desenho).
 *
 * Seis tubos de 533 mm na proa, RETOS e paralelos ao eixo do casco, em duas colunas de três (ímpares a
 * boreste, pares a bombordo). As culatras ficam dentro do casco resistente, na sala de torpedos, logo a
 * ré da antepara de vante; cada tubo atravessa a antepara resistente e o TLP-1 e termina junto ao casco
 * externo na proa elíptica, onde fica a porta da boca (oval: o recorte do tubo no casco). As posições e
 * a geometria vêm da física (src/sim/systems/torpedoTubes.ts e vessel.weapons de defaultVessel.ts).
 *
 * Disparo por ar comprimido: em cada tubo, uma garrafa de lançamento (ar AP) e uma válvula de disparo
 * acionam o cilindro de ejeção, que empurra água para a culatra e expulsa a arma. As estantes da sala
 * guardam as armas de reserva; o piso fica sobre o tanque de trim de vante (TT-AV) e sobre os tanques de
 * compensação das armas (TCA, desenhados no corte por Systems.ts).
 *
 * Usado pelo interior do Blender (exportar_interior.ts → build_sx1_interior.py); o casco externo
 * (build_sx1.py) repete as posições dos tubos. O teste tests/torpedoTubes.test.ts confere o encaixe.
 * Coordenadas do corpo: x para vante, y para boreste, z para baixo (m).
 */
import type { TorpedoTubeConfig } from '../sim/config/types';
import { defaultWeapons } from '../sim/config/defaultVessel';
import * as G from '../sim/systems/torpedoTubes';
import { PRESSURE_HULL } from './pressureHull';

export type Vec3 = G.Vec3;
export type TubeSide = 'BE' | 'BB';
export type TorpedoTubeDef = TorpedoTubeConfig;

/** configuração dos tubos (a mesma do navio padrão da física) */
export const WEAPONS = defaultWeapons();

export const TORPEDO_TUBES = {
  /** calibre da arma (m) */
  caliber: WEAPONS.weapon.diameter,
  /** raio do furo do tubo (m): 556 mm de diâmetro, folga para os patins da arma */
  boreRadius: WEAPONS.boreRadius,
  /** raio externo do tubo (m): parede de 32 mm */
  outerRadius: WEAPONS.outerRadius,
  /** face da culatra (x, m): porta interna, dentro do casco resistente */
  breechX: WEAPONS.breechX,
  /** posição lateral das culatras (|y|, m) e altura das três fileiras (z, m; para baixo) */
  breechY: Math.abs(WEAPONS.tubes[0].y),
  rowZ: [0, 1, 2].map((r) => WEAPONS.tubes.find((t) => t.row === r)!.z),
  /** folga mínima entre o tubo e o casco externo na boca (m) */
  muzzleClearance: WEAPONS.muzzleClearance,
  /** raio da porta da boca no casco externo (m) */
  doorRadius: WEAPONS.boreRadius + 0.02,
} as const;

export const TORPEDO_ROOM = {
  /** piso da sala de torpedos sobre o TT-AV (a ré dele ficam o carrinho das armas de reserva e as estantes): x, altura (z) e espessura */
  deck: { x0: 19.4, x1: 24.1, z: 1.47, thickness: 0.025 },
  /** estantes laterais: trecho x, posição lateral (|y|) e altura das armas em cada nível (z) */
  racks: { x0: 15.4, x1: 21.3, y: 1.95, tiers: [0.95, 0.15] },
  /** cilindros de ejeção (um por tubo, ao lado da culatra): trecho x, |y| e raio */
  ejector: { x0: 22.7, x1: 24.0, y: 1.55, radius: 0.22 },
  /** garrafas de lançamento (ar AP): trecho x, |y| e raio */
  flask: { x0: 21.6, x1: 23.0, y: 2.15, radius: 0.17 },
  /** trilhos de içamento no teto: trecho x, |y| e altura (z) */
  hoist: { x0: 15.4, x1: 24.0, y: 0.7, z: -1.95 },
} as const;

/** Os seis tubos: 1, 3, 5 a boreste e 2, 4, 6 a bombordo, de cima para baixo. */
export const TUBES: TorpedoTubeDef[] = WEAPONS.tubes;

type RadiusAt = (x: number) => number;

/** Centro da porta da boca no casco externo (onde o eixo do tubo encontra o casco). */
export const doorCenter = (t: TorpedoTubeDef, R: RadiusAt): Vec3 => G.doorCenter(WEAPONS, t, R);

/** Centro da face da culatra (porta interna). */
export const breechCenter = (t: TorpedoTubeDef): Vec3 => G.breechCenter(WEAPONS, t);

/** Direção do eixo do tubo: paralelo ao eixo do casco, para vante. */
export const tubeAxis = (_t: TorpedoTubeDef, _R: RadiusAt): Vec3 => ({ x: 1, y: 0, z: 0 });

/** Folga entre a parede externa do tubo, na distância s da culatra, e o casco externo (m; negativa = fura o casco). */
export const hullClearance = (t: TorpedoTubeDef, s: number, R: RadiusAt) => G.hullClearance(WEAPONS, t, s, R);

/** Comprimento do tubo (culatra → boca). */
export const tubeLength = (t: TorpedoTubeDef, R: RadiusAt) => G.tubeLength(WEAPONS, t, R);

/** Centro da boca do tubo. */
export const muzzleCenter = (t: TorpedoTubeDef, R: RadiusAt): Vec3 => G.muzzleCenter(WEAPONS, t, R);

/** Contorno da porta da boca no casco externo. */
export const doorOutline = (t: TorpedoTubeDef, R: RadiusAt, n = 24) => G.doorOutline(WEAPONS, t, R, TORPEDO_TUBES.doorRadius, n);

/** x da face externa da antepara resistente de vante (domo elíptico) à distância rho do eixo do casco. */
export function forwardDomeX(rho: number): number {
  const P = PRESSURE_HULL;
  const rb = P.innerRadius + P.thickness;
  const q = Math.min(1, rho / rb);
  return P.fwd.base + P.fwd.depth * Math.sqrt(1 - q * q);
}

/** Distância (da culatra, ao longo do eixo) em que o tubo atravessa a antepara resistente de vante. */
export const domeCrossing = (t: TorpedoTubeDef, _R?: RadiusAt) => forwardDomeX(G.tubeRho(t)) - WEAPONS.breechX;

/** Arranjo completo, gravado no JSON do interior (exportar_interior.ts) para o Blender. */
export function torpedoLayout(R: RadiusAt) {
  return {
    ...TORPEDO_TUBES,
    sala: TORPEDO_ROOM,
    arma: { comprimento: WEAPONS.weapon.length, diametro: WEAPONS.weapon.diameter, estiva: G.stowedWeaponX(WEAPONS) },
    tubos: TUBES.map((t) => ({
      ...t,
      nome: `Tubo ${t.n} (${t.side})`,
      culatra: breechCenter(t),
      boca: muzzleCenter(t, R),
      porta: doorCenter(t, R),
      eixo: tubeAxis(t, R),
      comprimento: tubeLength(t, R),
      antepara: domeCrossing(t, R),
    })),
  };
}
