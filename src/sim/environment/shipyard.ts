/**
 * ESTALEIRO E BASE NAVAL (Ilha da Madeira, Itaguaí) na FÍSICA: aterro, cais,
 * quebra-mares de enrocamento, shiplift e área dragada (dados em
 * shipyardData.ts). Faz parte da costa: só vale com a costa ligada.
 *
 * Tudo é convertido uma vez para metros (leste, norte) a partir de uma
 * âncora, com a mesma projeção de geo.ts. A cena 3D e o mapa usam estes
 * mesmos contornos — o que se vê é o que o casco sente.
 *
 *  - aterro, cais e shiplift: paredes verticais, topo a +3 m;
 *  - enrocamento: crista a +5 m e talude 1:1,5;
 *  - fora das estruturas o fundo sobe até elas com o mesmo talude 1:1,5
 *    (pé do enrocamento, margem do aterro), suavizado até INFLUENCE m, e
 *    nunca fica mais raso que a área dragada (bacia, entrada e aproximação:
 *    SHIPYARD_DATA.dredgeDepth).
 */
import { latLonToNed, nedToLatLon, type LatLon } from '../geo';
import { SHIPYARD_DATA, type MoleKind } from './shipyardData';

export const QUAY_TOP = 3; // m acima do nível médio do mar
export const MOUND_CREST = 5; // m
export const MOUND_SLOPE = 1.5; // horizontal : vertical
/** alcance (m) da influência das estruturas no fundo; sem efeito além disso */
export const INFLUENCE = 300;

export type V2 = [number, number]; // [leste, norte] em metros

export interface ShipyardLocal {
  anchor: LatLon;
  platform: V2[];
  /** ring = contorno na linha d'água (mesmo polígono desenhado no 3D e no mapa) */
  moles: { id: string; name: string; kind: MoleKind; width: number; pts: V2[]; ring: V2[] }[];
  shiplift: { root: V2; tip: V2; width: number };
  dredge: V2[];
  dredgeDepth: number;
  buildings: { id: string; name: string; c: V2; length: number; width: number; height: number; bearing: number }[];
  tanks: V2[];
  sudeste: { trestle: V2[]; pier: V2[] };
  /** caixa envolvente (m) com margem */
  box: { e0: number; e1: number; n0: number; n1: number };
}

/** âncora: centro aproximado da bacia */
export const SHIPYARD_ANCHOR: LatLon = { lat: -22.9305, lon: -43.8525 };

let local: ShipyardLocal | null = null;

/** Geometria em metros (leste, norte) a partir de SHIPYARD_ANCHOR. */
export function shipyardLocal(): ShipyardLocal {
  if (local) return local;
  const a = SHIPYARD_ANCHOR;
  const v = (p: LatLon): V2 => {
    const r = latLonToNed(a, p);
    return [r.e, r.n];
  };
  const d = SHIPYARD_DATA;
  const platform = d.platform.map(v);
  const moles = d.moles.map((m) => {
    const pts = m.pts.map(v);
    return { id: m.id, name: m.name, kind: m.kind, width: m.width, pts, ring: bufferOutline(pts, m.width / 2) };
  });
  const all = [...platform, ...moles.flatMap((m) => m.pts), v(d.shiplift.root), v(d.shiplift.tip)];
  const M = INFLUENCE;
  local = {
    anchor: a,
    platform,
    moles,
    shiplift: { root: v(d.shiplift.root), tip: v(d.shiplift.tip), width: d.shiplift.width },
    dredge: d.dredge.map(v),
    dredgeDepth: d.dredgeDepth,
    buildings: d.buildings.map((b) => ({ id: b.id, name: b.name, c: v(b.center), length: b.length, width: b.width, height: b.height, bearing: b.bearing })),
    tanks: d.tanks.map(v),
    sudeste: { trestle: d.sudeste.trestle.map(v), pier: d.sudeste.pier.map(v) },
    box: {
      e0: Math.min(...all.map((p) => p[0])) - M,
      e1: Math.max(...all.map((p) => p[0])) + M,
      n0: Math.min(...all.map((p) => p[1])) - M,
      n1: Math.max(...all.map((p) => p[1])) + M,
    },
  };
  return local;
}

const sub2 = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const nrm2 = (a: V2): V2 => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};

/**
 * Contorno a uma distância r de uma polilinha (juntas em meia-esquadria e
 * pontas arredondadas). Mesmo número de pontos para qualquer r — permite
 * ligar contornos de alturas diferentes (taludes).
 */
export function bufferOutline(pts: V2[], r: number, capSegs = 8): V2[] {
  const n = pts.length;
  const left: V2[] = [];
  const right: V2[] = [];
  for (let i = 0; i < n; i++) {
    const dp = i > 0 ? nrm2(sub2(pts[i], pts[i - 1])) : null;
    const dn = i < n - 1 ? nrm2(sub2(pts[i + 1], pts[i])) : null;
    let nv: V2;
    let k = 1;
    if (dp && dn) {
      const t = nrm2([dp[0] + dn[0], dp[1] + dn[1]]);
      nv = [-t[1], t[0]];
      k = 1 / Math.max(0.4, nv[0] * -dn[1] + nv[1] * dn[0]);
    } else {
      const d = (dp ?? dn)!;
      nv = [-d[1], d[0]];
    }
    left.push([pts[i][0] + nv[0] * r * k, pts[i][1] + nv[1] * r * k]);
    right.push([pts[i][0] - nv[0] * r * k, pts[i][1] - nv[1] * r * k]);
  }
  const out: V2[] = [...left];
  const cap = (c: V2, d: V2) => {
    const a0 = Math.atan2(d[0], -d[1]); // ângulo da normal esquerda de d
    for (let j = 1; j < capSegs; j++) {
      const a = a0 - (j * Math.PI) / capSegs;
      out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
    }
  };
  cap(pts[n - 1], nrm2(sub2(pts[n - 1], pts[n - 2])));
  for (let i = n - 1; i >= 0; i--) out.push(right[i]);
  cap(pts[0], nrm2(sub2(pts[0], pts[1])));
  return out;
}

/** distância de um ponto ao segmento ab */
function segDist(px: number, py: number, a: V2, b: V2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2)) : 0;
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
}

/** distância com sinal até o retângulo de eixo ab e largura w (pontas retas) */
export function boxSd(px: number, py: number, a: V2, b: V2, w: number): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  const qx = (px - a[0]) * ux + (py - a[1]) * uy - L / 2;
  const qy = -(px - a[0]) * uy + (py - a[1]) * ux;
  const ax = Math.abs(qx) - L / 2;
  const ay = Math.abs(qy) - w / 2;
  return Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) + Math.min(Math.max(ax, ay), 0);
}

export function polylineDist(px: number, py: number, pts: V2[]): number {
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(px, py, pts[i], pts[i + 1]));
  return d;
}

export function insidePolygon(px: number, py: number, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface ShipyardSample {
  /** distância com sinal até a estrutura mais próxima (m; − sobre a estrutura) */
  sd: number;
  /** altura da estrutura no ponto (m), quando sd ≤ 0 */
  height: number;
  /** profundidade dragada mínima no ponto (0 fora da área dragada) */
  dredge: number;
}

/**
 * Profundidade máxima (m) a uma distância sd > 0 das estruturas: talude
 * 1:1,5 junto delas, crescendo até o infinito em INFLUENCE (contínua).
 */
export function approachDepth(sd: number): number {
  if (sd >= INFLUENCE) return Infinity;
  const q = sd / INFLUENCE;
  return sd / MOUND_SLOPE / (1 - q * q);
}

/** polígono pronto para consultas rápidas (coordenadas em vetores e caixa envolvente) */
interface FastPoly {
  xs: Float64Array;
  ys: Float64Array;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function fastPoly(p: V2[]): FastPoly {
  const xs = Float64Array.from(p.map((q) => q[0]));
  const ys = Float64Array.from(p.map((q) => q[1]));
  return { xs, ys, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/**
 * Distância com sinal até o polígono (− dentro). Se o ponto estiver fora da
 * caixa envolvente a mais de `skip` metros, devolve +Infinity sem calcular
 * (não pode ser a estrutura mais próxima).
 */
function fastSd(x: number, y: number, P: FastPoly, skip: number): number {
  const dx0 = x < P.x0 ? P.x0 - x : x > P.x1 ? x - P.x1 : 0;
  const dy0 = y < P.y0 ? P.y0 - y : y > P.y1 ? y - P.y1 : 0;
  const outside = dx0 > 0 || dy0 > 0;
  if (outside && dx0 * dx0 + dy0 * dy0 >= skip * skip) return Infinity;
  const xs = P.xs;
  const ys = P.ys;
  const n = xs.length;
  let best = Infinity;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = xs[j];
    const ay = ys[j];
    const bx = xs[i];
    const by = ys[i];
    const ex = bx - ax;
    const ey = by - ay;
    const L2 = ex * ex + ey * ey;
    let t = L2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = x - ax - t * ex;
    const qy = y - ay - t * ey;
    const d2 = qx * qx + qy * qy;
    if (d2 < best) best = d2;
    if (!outside && ay > y !== by > y && x < (ex * (y - ay)) / ey + ax) inside = !inside;
  }
  const d = Math.sqrt(best);
  return inside ? -d : d;
}

interface FastSet {
  platform: FastPoly;
  moles: { P: FastPoly; mound: boolean }[];
  dredge: FastPoly;
  /** conversão rápida lat/lon → metros (mesma de geo.latLonToNed) */
  kLat: number;
  kLon: number;
}
let fast: FastSet | null = null;
function fastSet(): FastSet {
  if (fast) return fast;
  const L = shipyardLocal();
  const R = 6371000;
  fast = {
    platform: fastPoly(L.platform),
    moles: L.moles.map((m) => ({ P: fastPoly(m.ring), mound: m.kind === 'enrocamento' })),
    dredge: fastPoly(L.dredge),
    kLat: (Math.PI * R) / 180,
    kLon: (Math.PI * R * Math.cos((L.anchor.lat * Math.PI) / 180)) / 180,
  };
  return fast;
}

/** Estruturas do estaleiro no ponto, ou null longe delas. */
export function shipyardAt(lat: number, lon: number): ShipyardSample | null {
  const L = shipyardLocal();
  const F = fastSet();
  const x = (lon - L.anchor.lon) * F.kLon;
  const y = (lat - L.anchor.lat) * F.kLat;
  const b = L.box;
  if (x < b.e0 || x > b.e1 || y < b.n0 || y > b.n1) return null;
  const sl = L.shiplift;
  let sd = boxSd(x, y, sl.root, sl.tip, sl.width);
  let height = sd <= 0 ? QUAY_TOP : 0;
  const s0 = fastSd(x, y, F.platform, Math.abs(sd));
  if (s0 <= 0) height = Math.max(height, QUAY_TOP);
  if (s0 < sd) sd = s0;
  for (const m of F.moles) {
    const s = fastSd(x, y, m.P, Math.abs(sd));
    if (s <= 0) height = Math.max(height, m.mound ? Math.min(MOUND_CREST, -s / MOUND_SLOPE) : QUAY_TOP);
    if (s < sd) sd = s;
  }
  // área dragada: só o "dentro/fora" (caixa primeiro)
  const D = F.dredge;
  const inDredge = x >= D.x0 && x <= D.x1 && y >= D.y0 && y <= D.y1 && fastSd(x, y, D, 0) <= 0;
  return { sd, height, dredge: inDredge ? L.dredgeDepth : 0 };
}

/** retângulo (4 cantos) de centro c, comprimento ao longo do rumo e largura */
export function rectCorners(c: V2, length: number, width: number, bearingDeg: number): V2[] {
  const b = (bearingDeg * Math.PI) / 180;
  const u: V2 = [Math.sin(b), Math.cos(b)];
  const v: V2 = [-u[1], u[0]];
  const h = length / 2;
  const w = width / 2;
  return [
    [c[0] + u[0] * h + v[0] * w, c[1] + u[1] * h + v[1] * w],
    [c[0] - u[0] * h + v[0] * w, c[1] - u[1] * h + v[1] * w],
    [c[0] - u[0] * h - v[0] * w, c[1] - u[1] * h - v[1] * w],
    [c[0] + u[0] * h - v[0] * w, c[1] + u[1] * h - v[1] * w],
  ];
}

/** Contornos em lat/lon para o mapa tático (os mesmos da física e do 3D). */
export function shipyardOutlines(): {
  platform: LatLon[];
  moles: { name: string; kind: MoleKind; ring: LatLon[] }[];
  shiplift: LatLon[];
  dredge: LatLon[];
  buildings: { name: string; ring: LatLon[] }[];
  sudeste: LatLon[][];
} {
  const L = shipyardLocal();
  const g = (p: V2): LatLon => nedToLatLon(L.anchor, p[1], p[0]);
  const s = L.shiplift;
  const ax = sub2(s.tip, s.root);
  const brg = (Math.atan2(ax[0], ax[1]) * 180) / Math.PI;
  return {
    platform: L.platform.map(g),
    moles: L.moles.map((m) => ({ name: m.name, kind: m.kind, ring: m.ring.map(g) })),
    shiplift: rectCorners([(s.root[0] + s.tip[0]) / 2, (s.root[1] + s.tip[1]) / 2], Math.hypot(ax[0], ax[1]), s.width, brg).map(g),
    dredge: L.dredge.map(g),
    buildings: L.buildings.map((b) => ({ name: b.name, ring: rectCorners(b.c, b.length, b.width, b.bearing).map(g) })),
    sudeste: [L.sudeste.trestle.map(g), L.sudeste.pier.map(g)],
  };
}
