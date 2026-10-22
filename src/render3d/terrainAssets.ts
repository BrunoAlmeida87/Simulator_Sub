/**
 * DADOS VISUAIS DA TERRA (só o desenho; a física usa coastData*.ts):
 *  - imagem de satélite em cor verdadeira — Sentinel-2 L2A de 05/08/2024
 *    (contém dados Copernicus Sentinel modificados, 2024), 22 m (Rio) e
 *    30 m (Sepetiba) por pixel;
 *  - relevo fino de 30 m — Copernicus DEM GLO-30 (DSM, © DLR/Airbus,
 *    Copernicus), em PNG de 8 bits com altura h = (v / K)² m.
 * Gerados por scripts/rio. São carregados sob demanda (só com a costa ligada),
 * do próprio site: funcionam sem internet externa.
 */
import * as THREE from 'three';
import rioSatUrl from './assets/terrain/rio_sat.jpg?url';
import rioDemUrl from './assets/terrain/rio_dem.png?url';
import sepSatUrl from './assets/terrain/sepetiba_sat.jpg?url';
import sepDemUrl from './assets/terrain/sepetiba_dem.png?url';

interface Box {
  lon0: number;
  lon1: number;
  lat0: number;
  lat1: number;
}

interface VisRegion {
  id: 'sepetiba' | 'rio';
  sat: Box & { url: string };
  dem: Box & { url: string; nx: number; ny: number; K: number };
  tex: THREE.Texture | null;
  heights: Float32Array | null;
}

const K = 6.095665907605407;
const REGIONS: VisRegion[] = [
  {
    id: 'sepetiba',
    sat: { url: sepSatUrl, lon0: -44.2, lon1: -43.49999434179589, lat0: -23.200197628458497, lat1: -22.8 },
    dem: { url: sepDemUrl, lon0: -44.2, lon1: -43.49999434179589, lat0: -23.200197628458497, lat1: -22.8, nx: 2391, ny: 1485, K },
    tex: null,
    heights: null,
  },
  {
    id: 'rio',
    sat: { url: rioSatUrl, lon0: -43.56, lon1: -42.99996738441841, lat0: -23.1000790513834, lat1: -22.64 },
    dem: { url: rioDemUrl, lon0: -43.56, lon1: -42.99988938816263, lat0: -23.1000251527129, lat1: -22.64, nx: 1915, ny: 1707, K },
    tex: null,
    heights: null,
  },
];

/** divisa entre as duas regiões na faixa comum (a mesma da física, em coast.ts) */
const SPLIT_LON = -43.53;

let started = false;
/** aumenta a cada dado carregado: o terreno se refaz */
export let terrainAssetsVersion = 0;
const listeners = new Set<() => void>();

function bump(): void {
  terrainAssetsVersion++;
  for (const l of listeners) l();
}

export function onTerrainAssets(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('falha ao carregar ' + url));
    im.src = url;
  });
}

/** inicia o carregamento (navegador, uma vez); sem navegador não faz nada */
export function requestTerrainAssets(maxTexture = 4096): void {
  if (started || typeof document === 'undefined' || typeof Image === 'undefined') return;
  started = true;
  for (const r of REGIONS) {
    loadImage(r.sat.url)
      .then((im) => {
        // reduz a imagem se a placa de vídeo não aceitar o tamanho
        let src: TexImageSource = im;
        if (im.width > maxTexture || im.height > maxTexture) {
          const k = maxTexture / Math.max(im.width, im.height);
          const c = document.createElement('canvas');
          c.width = Math.round(im.width * k);
          c.height = Math.round(im.height * k);
          c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
          src = c;
        }
        const t = new THREE.Texture(src as HTMLImageElement);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
        t.needsUpdate = true;
        r.tex = t;
        bump();
      })
      .catch(() => undefined);
    loadImage(r.dem.url)
      .then((im) => {
        const c = document.createElement('canvas');
        c.width = im.width;
        c.height = im.height;
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(im, 0, 0);
        const px = g.getImageData(0, 0, im.width, im.height).data;
        const h = new Float32Array(im.width * im.height);
        for (let i = 0; i < h.length; i++) h[i] = (px[i * 4] / r.dem.K) ** 2;
        r.dem.nx = im.width;
        r.dem.ny = im.height;
        r.heights = h;
        bump();
      })
      .catch(() => undefined);
  }
}

function regionAt(lat: number, lon: number): VisRegion | null {
  const inside = (b: Box) => lat >= b.lat0 && lat <= b.lat1 && lon >= b.lon0 && lon <= b.lon1;
  const s = inside(REGIONS[0].dem) ? REGIONS[0] : null;
  const r = inside(REGIONS[1].dem) ? REGIONS[1] : null;
  if (s && r) return lon < SPLIT_LON ? s : r;
  return s ?? r;
}

/** altura do relevo fino (m) no ponto, ou null sem dado (fora das regiões ou ainda carregando) */
export function fineHeight(lat: number, lon: number): number | null {
  const r = regionAt(lat, lon);
  if (!r || !r.heights) return null;
  const d = r.dem;
  const fx = ((lon - d.lon0) / (d.lon1 - d.lon0)) * d.nx - 0.5;
  const fy = ((d.lat1 - lat) / (d.lat1 - d.lat0)) * d.ny - 0.5;
  const x = Math.max(0, Math.min(d.nx - 1.001, fx));
  const y = Math.max(0, Math.min(d.ny - 1.001, fy));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const H = r.heights;
  const i = y0 * d.nx + x0;
  const a = H[i] * (1 - tx) + H[i + 1] * tx;
  const b = H[i + d.nx] * (1 - tx) + H[i + d.nx + 1] * tx;
  return a * (1 - ty) + b * ty;
}

/** coordenadas de textura do ponto nas duas imagens e o peso da imagem do Rio (0 = Sepetiba) */
export function satUv(lat: number, lon: number): { us: number; vs: number; ur: number; vr: number; rio: number; covered: boolean } {
  const S = REGIONS[0].sat;
  const R = REGIONS[1].sat;
  const us = (lon - S.lon0) / (S.lon1 - S.lon0);
  const vs = (lat - S.lat0) / (S.lat1 - S.lat0);
  const ur = (lon - R.lon0) / (R.lon1 - R.lon0);
  const vr = (lat - R.lat0) / (R.lat1 - R.lat0);
  const inS = us >= 0 && us <= 1 && vs >= 0 && vs <= 1 && !!REGIONS[0].tex;
  const inR = ur >= 0 && ur <= 1 && vr >= 0 && vr <= 1 && !!REGIONS[1].tex;
  const rio = inR && (!inS || lon >= SPLIT_LON) ? 1 : 0;
  return { us, vs, ur, vr, rio, covered: inS || inR };
}

/** texturas carregadas (ou null) */
export function satTextures(): { sepetiba: THREE.Texture | null; rio: THREE.Texture | null } {
  return { sepetiba: REGIONS[0].tex, rio: REGIONS[1].tex };
}
