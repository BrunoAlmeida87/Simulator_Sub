/**
 * Hidrostática com imersão parcial (Princípio de Arquimedes).
 *
 * Para cada fatia circular (raio r, centro no eixo em x_i), a superfície livre
 * (plano z_NED = 0) corta a seção ao longo de uma reta. Sendo n = (R₃₂, R₃₃) a
 * projeção do eixo vertical do mundo no plano da seção, a distância assinada
 * do centro à linha d'água é  s = −z_c / |n|.  A área imersa é o segmento
 * circular além da corda:
 *
 *    A(s) = r²·acos(s/r) − s·√(r² − s²)          (s ∈ [−r, r])
 *    centróide ao longo de n̂:  c = (2/3)·(r² − s²)^{3/2} / A
 *
 * Volume imerso V = Σ A_i·Δx; centro de carena B = Σ A_i·Δx·c_i / V.
 * O resultado é exato para fatias normais ao eixo e vale para quaisquer
 * ângulos de pitch e banda (incluindo a condição de superfície).
 */
import type { Mat3, Vec3 } from '../core/math';
import type { HullGeometry } from './hullGeometry';

export interface HydrostaticResult {
  volume: number; // m³ imerso (antes da compressibilidade)
  center: Vec3; // centro de carena (corpo)
  immersedFraction: number; // V_imerso / V_envelope
  sliceImmersion: Float64Array; // fração imersa de cada fatia (0..1)
  waterplaneDepthAxis: number; // profundidade do eixo a meia-nau
}

/**
 * eta (opcional): elevação da superfície (m, + para cima) sobre cada fatia —
 * mar com ondas (aproximação de Froude–Krylov hidrostática por fatia).
 */
export function computeHydrostatics(geom: HullGeometry, pos: Vec3, R: Mat3, out?: Float64Array, eta?: Float64Array): HydrostaticResult {
  const slices = geom.slices;
  const imm = out && out.length === slices.length ? out : new Float64Array(slices.length);
  // componentes verticais (z mundo) dos eixos do corpo: linha 3 de R
  const rzx = R[6];
  const rzy = R[7];
  const rzz = R[8];
  const nLen = Math.sqrt(rzy * rzy + rzz * rzz);
  const ny = nLen > 1e-9 ? rzy / nLen : 0;
  const nz = nLen > 1e-9 ? rzz / nLen : 1;
  let vol = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = 0; i < slices.length; i++) {
    const sl = slices[i];
    const r = sl.r;
    if (r <= 0) {
      imm[i] = 0;
      continue;
    }
    const zc = pos.z + rzx * sl.x + (eta ? eta[i] : 0); // profundidade do centro da fatia abaixo da superfície local
    let area: number;
    let cOff: number; // deslocamento do centróide ao longo de n̂
    if (nLen < 1e-6) {
      // fatia horizontal (submarino vertical): tudo ou nada
      if (zc > 0) {
        area = Math.PI * r * r;
        cOff = 0;
      } else {
        area = 0;
        cOff = 0;
      }
    } else {
      const s = -zc / nLen;
      if (s <= -r) {
        area = Math.PI * r * r;
        cOff = 0;
      } else if (s >= r) {
        area = 0;
        cOff = 0;
      } else {
        const root = Math.sqrt(r * r - s * s);
        area = r * r * Math.acos(s / r) - s * root;
        cOff = area > 1e-12 ? ((2 / 3) * root * root * root) / area : r;
      }
    }
    const full = Math.PI * r * r;
    imm[i] = area / full;
    const dv = area * sl.dx;
    vol += dv;
    mx += dv * sl.x;
    my += dv * ny * cOff;
    mz += dv * nz * cOff;
  }
  const center: Vec3 = vol > 1e-9 ? { x: mx / vol, y: my / vol, z: mz / vol } : { x: geom.centroidX, y: 0, z: 0 };
  return {
    volume: vol,
    center,
    immersedFraction: vol / geom.volume,
    sliceImmersion: imm,
    waterplaneDepthAxis: pos.z,
  };
}
