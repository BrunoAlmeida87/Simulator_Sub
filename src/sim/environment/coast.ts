/**
 * COSTA (terra, orla e relevo) — duas regiões com dados embutidos (funciona
 * sem internet): Baía de Sepetiba (coastData.ts) e Rio de Janeiro — Baía de
 * Guanabara e orla do Leme ao Pontal (coastDataRio.ts). Cada ponto usa a
 * região que o contém (na faixa comum, a oeste/leste de 43,53° O); fora delas,
 * a mais próxima, com os valores da borda estendidos.
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
import { COAST_ELEV_B64, COAST_MASK_B64, COAST_META } from './coastData';
import { COAST_RIO_ELEV_B64, COAST_RIO_MASK_B64, COAST_RIO_META } from './coastDataRio';

interface Meta {
  lat0: number;
  lat1: number;
  lon0: number;
  lon1: number;
  dlat: number;
  dlon: number;
  nx: number;
  ny: number;
  cell: number;
  elevFactor: number;
  ex: number;
  ey: number;
  elevK: number;
}

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

function build(M: Meta, maskB64: string, elevB64: string): Grids {
  const { nx, ny, ex, ey, elevK, cell } = M;
  // máscara
  const bytes = b64(maskB64);
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
  const eb = b64(elevB64);
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

/** região de dados da costa (grades preparadas na primeira consulta) */
class CoastRegion {
  private grids: Grids | null = null;
  constructor(
    readonly id: string,
    readonly name: string,
    readonly M: Meta,
    private maskB64: string,
    private elevB64: string,
  ) {}
  g(): Grids {
    if (!this.grids) this.grids = build(this.M, this.maskB64, this.elevB64);
    return this.grids;
  }
  get bounds() {
    return { lat0: this.M.lat0, lat1: this.M.lat1, lon0: this.M.lon0, lon1: this.M.lon1 };
  }
  contains(lat: number, lon: number): boolean {
    const M = this.M;
    return lat >= M.lat0 && lat <= M.lat1 && lon >= M.lon0 && lon <= M.lon1;
  }
  /** distância (graus aproximados, com cos da latitude) até a caixa da região */
  distance(lat: number, lon: number): number {
    const M = this.M;
    const dy = lat < M.lat0 ? M.lat0 - lat : lat > M.lat1 ? lat - M.lat1 : 0;
    const dx = (lon < M.lon0 ? M.lon0 - lon : lon > M.lon1 ? lon - M.lon1 : 0) * Math.cos((lat * Math.PI) / 180);
    return Math.hypot(dx, dy);
  }
  signedDistance(lat: number, lon: number): number {
    const M = this.M;
    const G = this.g();
    const fx = (lon - M.lon0) / M.dlon - 0.5;
    const fy = (M.lat1 - lat) / M.dlat - 0.5;
    let d = bilinear(G.sdf, M.nx, M.ny, fx, fy);
    // ao sul da grade é mar aberto: a distância continua crescendo
    if (fy > M.ny - 1) d += (fy - (M.ny - 1)) * M.cell;
    return d;
  }
  landHeight(lat: number, lon: number, sd: number): number {
    const M = this.M;
    const G = this.g();
    const F = M.elevFactor;
    const fx = (lon - M.lon0) / (M.dlon * F) - 0.5;
    const fy = (M.lat1 - lat) / (M.dlat * F) - 0.5;
    const h = Math.max(1.5, bilinear(G.elev, M.ex, M.ey, fx, fy));
    // praia: sobe de 0 na orla até a altura do terreno em ~150 m
    const t = Math.min(1, Math.max(0, -sd / 150));
    const ramp = t * t * (3 - 2 * t);
    return h * ramp + 0.01 * Math.max(0, -sd) * (1 - ramp);
  }
}

const SEPETIBA = new CoastRegion('sepetiba', 'Baía de Sepetiba', COAST_META, COAST_MASK_B64, COAST_ELEV_B64);
const RIO = new CoastRegion('rio', 'Rio de Janeiro — Baía de Guanabara e orla', COAST_RIO_META, COAST_RIO_MASK_B64, COAST_RIO_ELEV_B64);
/** regiões com costa (Sepetiba primeiro: valores e limites de antes) */
export const COAST_REGIONS: readonly CoastRegion[] = [SEPETIBA, RIO];
/** divisa na faixa comum às duas grades (Barra de Guaratiba) */
const SPLIT_LON = -43.53;

function regionFor(lat: number, lon: number): CoastRegion {
  const inS = SEPETIBA.contains(lat, lon);
  const inR = RIO.contains(lat, lon);
  if (inS && inR) return lon < SPLIT_LON ? SEPETIBA : RIO;
  if (inS) return SEPETIBA;
  if (inR) return RIO;
  return SEPETIBA.distance(lat, lon) <= RIO.distance(lat, lon) ? SEPETIBA : RIO;
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

/** limites da grade da região de Sepetiba (a primeira região; compatibilidade) */
export const COAST_BOUNDS = SEPETIBA.bounds;

/** Distância com sinal até a orla (m): + no mar, − em terra. */
export function coastSignedDistance(lat: number, lon: number): number {
  return regionFor(lat, lon).signedDistance(lat, lon);
}

/** Altura do terreno (m, ≥ 0) num ponto de terra; sd = distância com sinal (≤ 0 em terra). */
export function coastLandHeight(lat: number, lon: number, sd: number): number {
  return regionFor(lat, lon).landHeight(lat, lon, sd);
}

/** Máscara terra/água da região de Sepetiba (para desenhar o contorno no mapa). */
export function coastMask(): { land: Uint8Array; nx: number; ny: number; bounds: typeof COAST_BOUNDS } {
  return { land: SEPETIBA.g().land, nx: SEPETIBA.M.nx, ny: SEPETIBA.M.ny, bounds: COAST_BOUNDS };
}

/** Máscaras de todas as regiões (mapa tático). */
export function coastMasks(): { id: string; land: Uint8Array; nx: number; ny: number; bounds: { lat0: number; lat1: number; lon0: number; lon1: number } }[] {
  return COAST_REGIONS.map((r) => ({ id: r.id, land: r.g().land, nx: r.M.nx, ny: r.M.ny, bounds: r.bounds }));
}

/** Força a preparação dos dados (ex.: ao abrir a aba 3D com a costa ligada). */
export function coastReady(): void {
  SEPETIBA.g();
}

/** Região da costa que contém o ponto (ou null fora de todas). */
export function coastRegionAt(lat: number, lon: number): string | null {
  const inS = SEPETIBA.contains(lat, lon);
  const inR = RIO.contains(lat, lon);
  if (!inS && !inR) return null;
  return regionFor(lat, lon).id;
}
