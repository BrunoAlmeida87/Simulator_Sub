/**
 * TUBOS LANÇADORES DE TORPEDO E SALA DE TORPEDOS (só desenho, por enquanto).
 *
 * Seis tubos de 533 mm na proa, como nos Scorpène: as bocas ficam atrás das seis portas do casco
 * externo (scripts/blender/build_sx1.py, "SX1_Casco_PortasTubos": 3 por bordo, x 32,55…33,35 m,
 * a 104°, 124° e 144° do topo) e as culatras dentro do casco resistente, na sala de torpedos, logo
 * a ré da antepara de vante. Cada tubo atravessa o TLP-1 e a antepara resistente (anel de passagem).
 *
 * Disparo por ar comprimido: em cada tubo, uma garrafa de lançamento (ar AP) e uma válvula de disparo
 * acionam o cilindro de ejeção, que empurra água para a culatra e expulsa a arma. As estantes da sala
 * guardam as armas de reserva; o piso fica sobre o tanque de trim de vante (TT-AV).
 *
 * A física não muda nesta etapa (os dois "Torpedos de reserva" continuam sendo a carga deslocável de
 * defaultVessel.ts). Usado pelo interior do Blender (exportar_interior.ts → build_sx1_interior.py);
 * o teste tests/torpedoTubes.test.ts confere o encaixe no casco e a folga para o resto do corte.
 * Coordenadas do corpo: x para vante, y para boreste, z para baixo (m).
 */
import { PRESSURE_HULL } from './pressureHull';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type TubeSide = 'BE' | 'BB';

export interface TorpedoTubeDef {
  /** número do tubo: ímpares a boreste, pares a bombordo; 1–2 em cima, 5–6 embaixo */
  n: number;
  side: TubeSide;
  /** fileira: 0 = de cima, 1 = do meio, 2 = de baixo */
  row: number;
  /** ângulo da porta no casco externo, a partir do topo (graus, positivo para o bordo do tubo) */
  doorAngle: number;
}

export const TORPEDO_TUBES = {
  /** calibre da arma (m) */
  caliber: 0.533,
  /** raio do furo do tubo (m): 556 mm de diâmetro, folga para os patins da arma */
  boreRadius: 0.278,
  /** raio externo do tubo (m): parede de 32 mm */
  outerRadius: 0.31,
  /** face da culatra (x, m): porta interna, dentro do casco resistente */
  breechX: 24.1,
  /** posição lateral das culatras (|y|, m) e altura das três fileiras (z, m; para baixo) */
  breechY: 0.7,
  rowZ: [-0.6, 0.2, 1.0],
  /** portas do casco externo: faixa x (m) e meia-abertura angular (graus) (build_sx1.py) */
  door: { x0: 32.55, x1: 33.35, halfAngle: 8.5 },
  /** ângulos das portas (graus a partir do topo), da fileira de cima para a de baixo */
  doorAngles: [104, 124, 144],
  /** folga mínima entre o tubo e o casco externo na boca (m) */
  muzzleClearance: 0.03,
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
export const TUBES: TorpedoTubeDef[] = [0, 1, 2].flatMap((row) => (['BE', 'BB'] as TubeSide[]).map((side, k) => ({ n: row * 2 + k + 1, side, row, doorAngle: TORPEDO_TUBES.doorAngles[row] })));

const sgn = (s: TubeSide) => (s === 'BE' ? 1 : -1);
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const unit = (a: Vec3): Vec3 => {
  const l = len(a);
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** Centro da porta do tubo no casco externo. */
export function doorCenter(t: TorpedoTubeDef, outerRadiusAt: (x: number) => number): Vec3 {
  const D = TORPEDO_TUBES.door;
  const x = (D.x0 + D.x1) / 2;
  const r = outerRadiusAt(x);
  const a = (t.doorAngle * Math.PI) / 180;
  return { x, y: sgn(t.side) * r * Math.sin(a), z: -r * Math.cos(a) };
}

/** Centro da face da culatra (porta interna). */
export function breechCenter(t: TorpedoTubeDef): Vec3 {
  const T = TORPEDO_TUBES;
  return { x: T.breechX, y: sgn(t.side) * T.breechY, z: T.rowZ[t.row] };
}

/** Direção do eixo do tubo (da culatra para a boca, unitária). */
export function tubeAxis(t: TorpedoTubeDef, outerRadiusAt: (x: number) => number): Vec3 {
  return unit(sub(doorCenter(t, outerRadiusAt), breechCenter(t)));
}

/** Dois vetores perpendiculares ao eixo (para percorrer a parede do tubo). */
function ring(a: Vec3): [Vec3, Vec3] {
  const ref = Math.abs(a.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const u = unit(cross(a, ref));
  return [u, cross(a, u)];
}

/** Folga entre a parede externa do tubo, na distância s da culatra, e o casco externo (m; negativa = fura o casco). */
export function hullClearance(t: TorpedoTubeDef, s: number, outerRadiusAt: (x: number) => number): number {
  const a = tubeAxis(t, outerRadiusAt);
  const [u, w] = ring(a);
  const c = add(breechCenter(t), a, s);
  let worst = Infinity;
  for (let k = 0; k < 24; k++) {
    const th = (2 * Math.PI * k) / 24;
    const p = add(add(c, u, Math.cos(th) * TORPEDO_TUBES.outerRadius), w, Math.sin(th) * TORPEDO_TUBES.outerRadius);
    worst = Math.min(worst, outerRadiusAt(p.x) - Math.hypot(p.y, p.z));
  }
  return worst;
}

/** Comprimento do tubo (culatra → boca): a boca fica o mais à vante possível sem a parede sair do casco externo. */
export function tubeLength(t: TorpedoTubeDef, outerRadiusAt: (x: number) => number): number {
  const total = len(sub(doorCenter(t, outerRadiusAt), breechCenter(t)));
  let lo = 0;
  let hi = total;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (hullClearance(t, mid, outerRadiusAt) >= TORPEDO_TUBES.muzzleClearance) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Centro da boca do tubo (face de vante, onde fica a porta externa do tubo). */
export function muzzleCenter(t: TorpedoTubeDef, outerRadiusAt: (x: number) => number): Vec3 {
  return add(breechCenter(t), tubeAxis(t, outerRadiusAt), tubeLength(t, outerRadiusAt));
}

/** x da face externa da antepara resistente de vante (domo elíptico) à distância rho do eixo do casco. */
export function forwardDomeX(rho: number): number {
  const P = PRESSURE_HULL;
  const rb = P.innerRadius + P.thickness;
  const q = Math.min(1, rho / rb);
  return P.fwd.base + P.fwd.depth * Math.sqrt(1 - q * q);
}

/** Distância (da culatra, ao longo do eixo) em que o tubo atravessa a antepara resistente de vante. */
export function domeCrossing(t: TorpedoTubeDef, outerRadiusAt: (x: number) => number): number {
  const a = tubeAxis(t, outerRadiusAt);
  const b = breechCenter(t);
  let lo = 0;
  let hi = tubeLength(t, outerRadiusAt);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const p = add(b, a, mid);
    if (p.x < forwardDomeX(Math.hypot(p.y, p.z))) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Arranjo completo, gravado no JSON do interior (exportar_interior.ts) para o Blender. */
export function torpedoLayout(outerRadiusAt: (x: number) => number) {
  return {
    ...TORPEDO_TUBES,
    sala: TORPEDO_ROOM,
    tubos: TUBES.map((t) => ({
      ...t,
      nome: `Tubo ${t.n} (${t.side})`,
      culatra: breechCenter(t),
      boca: muzzleCenter(t, outerRadiusAt),
      porta: doorCenter(t, outerRadiusAt),
      eixo: tubeAxis(t, outerRadiusAt),
      comprimento: tubeLength(t, outerRadiusAt),
      antepara: domeCrossing(t, outerRadiusAt),
    })),
  };
}
