/**
 * COSTA (terra, orla e relevo) — região da Baía de Sepetiba (ver coastData.ts).
 * Dados embutidos no aplicativo: funciona sem internet.
 *
 * Fornece, em latitude/longitude:
 *  - distância com sinal até a orla (m): + no mar, − em terra, obtida por
 *    transformada de distância (chanfro) sobre a máscara de 50 m e
 *    interpolação bilinear (a orla é a curva de distância zero);
 *  - altura do terreno em terra (m), da grade de 200 m, com rampa até zero
 *    na orla (praia), para o relevo ser contínuo com o fundo do mar.
 *
 * Fora da grade os valores da borda são estendidos (ao sul: mar aberto).
 * Tudo é calculado na primeira consulta (dezenas de milissegundos).
 */
import { COAST_ELEV_B64, COAST_MASK_B64, COAST_META as M } from './coastData';

function b64(s: string): Uint8Array {
  const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface Grids {
  land: Uint8Array;
  sdf: Float32Array;
  elev: Float32Array;
}

let grids: Grids | null = null;

function chamfer(src: Uint8Array, wantLand: boolean, nx: number, ny: number, cell: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(nx * ny);
  for (let i = 0; i < d.length; i++) d[i] = (src[i] === 1) === wantLand ? 0 : INF;
  const a = cell;
  const b = cell * Math.SQRT2;
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (y > 0) {
        v = Math.min(v, d[i - nx] + a);
        if (x > 0) v = Math.min(v, d[i - nx - 1] + b);
        if (x < nx - 1) v = Math.min(v, d[i - nx + 1] + b);
      }
      d[i] = v;
    }
  for (let y = ny - 1; y >= 0; y--)
    for (let x = nx - 1; x >= 0; x--) {
      const i = y * nx + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < nx - 1) v = Math.min(v, d[i + 1] + a);
      if (y < ny - 1) {
        v = Math.min(v, d[i + nx] + a);
        if (x < nx - 1) v = Math.min(v, d[i + nx + 1] + b);
        if (x > 0) v = Math.min(v, d[i + nx - 1] + b);
      }
      d[i] = v;
    }
  return d;
}

function build(): Grids {
  const { nx, ny, ex, ey, elevK, cell } = M;
  // máscara
  const bytes = b64(COAST_MASK_B64);
  const land = new Uint8Array(nx * ny);
  let p = 0;
  for (let y = 0; y < ny; y++) {
    let x = 0;
    let cur = 0;
    while (x < nx) {
      let n = 0;
      let shift = 0;
      for (;;) {
        const v = bytes[p++];
        n |= (v & 0x7f) << shift;
        if (!(v & 0x80)) break;
        shift += 7;
      }
      if (cur) land.fill(1, y * nx + x, y * nx + Math.min(nx, x + n));
      x += n;
      cur ^= 1;
    }
  }
  // distância com sinal: até a borda entre células (± meia célula)
  const toLand = chamfer(land, true, nx, ny, cell);
  const toSea = chamfer(land, false, nx, ny, cell);
  const sdf = new Float32Array(nx * ny);
  for (let i = 0; i < sdf.length; i++) sdf[i] = land[i] ? -(toSea[i] - cell / 2) : toLand[i] - cell / 2;
  // relevo
  const eb = b64(COAST_ELEV_B64);
  const elev = new Float32Array(ex * ey);
  let k = 0;
  for (let i = 0; i < eb.length && k < elev.length; i++) {
    const v = eb[i];
    if (v === 0) {
      k += eb[++i];
    } else {
      elev[k++] = (v / elevK) ** 2;
    }
  }
  return { land, sdf, elev };
}

function g(): Grids {
  if (!grids) grids = build();
  return grids;
}

/** bilinear numa grade de valores em centros de célula, com bordas estendidas */
function bilinear(arr: Float32Array, nx: number, ny: number, fx: number, fy: number): number {
  const x = Math.max(0, Math.min(nx - 1.000001, fx));
  const y = Math.max(0, Math.min(ny - 1.000001, fy));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const i = y0 * nx + x0;
  const a = arr[i] * (1 - tx) + arr[i + 1] * tx;
  const b = arr[i + nx] * (1 - tx) + arr[i + nx + 1] * tx;
  return a * (1 - ty) + b * ty;
}

export const COAST_BOUNDS = { lat0: M.lat0, lat1: M.lat1, lon0: M.lon0, lon1: M.lon1 };

/** Distância com sinal até a orla (m): + no mar, − em terra. */
export function coastSignedDistance(lat: number, lon: number): number {
  const G = g();
  const fx = (lon - M.lon0) / M.dlon - 0.5;
  const fy = (M.lat1 - lat) / M.dlat - 0.5;
  let d = bilinear(G.sdf, M.nx, M.ny, fx, fy);
  // ao sul da grade é mar aberto: a distância continua crescendo
  if (fy > M.ny - 1) d += (fy - (M.ny - 1)) * M.cell;
  return d;
}

/** Altura do terreno (m, ≥ 0) num ponto de terra; sd = distância com sinal (≤ 0 em terra). */
export function coastLandHeight(lat: number, lon: number, sd: number): number {
  const G = g();
  const F = M.elevFactor;
  const fx = (lon - M.lon0) / (M.dlon * F) - 0.5;
  const fy = (M.lat1 - lat) / (M.dlat * F) - 0.5;
  const h = Math.max(1.5, bilinear(G.elev, M.ex, M.ey, fx, fy));
  // praia: sobe de 0 na orla até a altura do terreno em ~150 m
  const t = Math.min(1, Math.max(0, -sd / 150));
  const ramp = t * t * (3 - 2 * t);
  return h * ramp + 0.01 * Math.max(0, -sd) * (1 - ramp);
}

/** Máscara terra/água (para desenhar o contorno no mapa). */
export function coastMask(): { land: Uint8Array; nx: number; ny: number; bounds: typeof COAST_BOUNDS } {
  return { land: g().land, nx: M.nx, ny: M.ny, bounds: COAST_BOUNDS };
}

/** Força a preparação dos dados (ex.: ao abrir a aba 3D com a costa ligada). */
export function coastReady(): void {
  g();
}
