/**
 * TRÁFEGO MARÍTIMO ADICIONAL (fictício) — navios além dos contatos fixos da
 * mesa tática, em quantidade escolhida pelo operador.
 *
 * Cada navio percorre em vaivém um trecho reto, como os contatos fixos
 * (cinemática simples, função do tempo de simulação: pausa, replay e a
 * segunda janela mostram o mesmo). Os trechos são sorteados de forma estável
 * em volta da origem geográfica do cenário e só são aceitos se:
 *  - todo o trecho (e uma margem lateral) tem água com profundidade para o
 *    calado do navio, segundo o fundo SIMULADO (costa, estaleiro, relevo);
 *  - não passa a menos de 500 m da origem (posição inicial do submarino);
 *  - fica afastado de todos os outros trechos (fixos e adicionais), de modo
 *    que dois navios nunca se sobrepõem.
 * Posições em latitude/longitude: o mapa e a cena 3D mostram o mesmo navio
 * no mesmo lugar. Nada aqui altera a física.
 */
import type { Contact, LatLon } from './geo';
import type { Environment } from './environment/environment';
import { contactRoutes, latLonToNed, nedToLatLon } from './geo';

export const MAX_TRAFFIC = 20;

export interface TrafficRoute {
  id: string;
  name: string;
  kind: Contact['kind'];
  a: LatLon;
  b: LatLon;
  /** referencial em que o trecho é reto (origem do sorteio): o movimento é calculado nele */
  frame: LatLon;
  speed: number; // m/s
  phase: number; // 0..1
}

interface KindSpec {
  kind: Contact['kind'];
  w: number; // peso no sorteio
  name: string;
  minDepth: number; // m (calado + folga)
  speed: [number, number]; // m/s
  len: [number, number]; // comprimento do trecho, m
  sep: number; // afastamento mínimo de outros trechos, m
}

const KINDS: KindSpec[] = [
  { kind: 'pesqueiro', w: 0.4, name: 'Pesqueiro', minDepth: 6, speed: [1.0, 3.0], len: [800, 2500], sep: 300 },
  { kind: 'mercante', w: 0.3, name: 'Mercante', minDepth: 18, speed: [4.5, 7.5], len: [3000, 7000], sep: 700 },
  { kind: 'rebocador', w: 0.15, name: 'Rebocador', minDepth: 6, speed: [2.0, 4.0], len: [1000, 3000], sep: 300 },
  { kind: 'patrulha', w: 0.15, name: 'Patrulha', minDepth: 8, speed: [4.0, 7.0], len: [2000, 5000], sep: 500 },
];

/** área de sorteio em volta da origem (dentro do alcance de desenho padrão, 12 km) */
const R_MIN = 1200;
const R_MAX = 9000;
const CLEAR_ORIGIN = 500;

/** Hash inteiro estável (independe do gerador da física). */
function rnd(a: number, b: number, c: number): number {
  let x = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

type P = { n: number; e: number };

function segPointDist(p: P, a: P, b: P): number {
  const dn = b.n - a.n;
  const de = b.e - a.e;
  const L2 = dn * dn + de * de;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.n - a.n) * dn + (p.e - a.e) * de) / L2)) : 0;
  return Math.hypot(p.n - a.n - dn * t, p.e - a.e - de * t);
}

function segsCross(a: P, b: P, c: P, d: P): boolean {
  const o = (p: P, q: P, r: P) => (q.e - p.e) * (r.n - p.n) - (q.n - p.n) * (r.e - p.e);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** menor distância entre dois trechos */
export function segSegDist(a: P, b: P, c: P, d: P): number {
  if (segsCross(a, b, c, d)) return 0;
  return Math.min(segPointDist(a, c, d), segPointDist(b, c, d), segPointDist(c, a, b), segPointDist(d, a, b));
}

/**
 * Sorteia `count` trechos válidos. `depthAt(n, e)` é a profundidade do fundo
 * simulado no referencial local da origem (m; ≤ 0 = terra).
 */
export function buildTraffic(origin: LatLon, count: number, depthAt: (n: number, e: number) => number): TrafficRoute[] {
  const want = Math.max(0, Math.min(MAX_TRAFFIC, Math.round(count)));
  const out: TrafficRoute[] = [];
  if (!want) return out;
  // semente da região (mesma origem → mesmos navios)
  const sa = Math.round(origin.lat * 1e4);
  const sb = Math.round(origin.lon * 1e4);
  const taken: { a: P; b: P; sep: number }[] = contactRoutes().map((r) => ({ a: latLonToNed(origin, r.a), b: latLonToNed(origin, r.b), sep: 700 }));
  let tries = 0;
  for (let k = 0; out.length < want && tries < want * 60; k++, tries++) {
    const r = (i: number) => rnd(sa + k * 7919, sb, i);
    let u = r(1);
    const spec = KINDS.find((s) => (u -= s.w) < 0) ?? KINDS[0];
    const ang = r(2) * Math.PI * 2;
    const rad = Math.sqrt(R_MIN * R_MIN + r(3) * (R_MAX * R_MAX - R_MIN * R_MIN));
    const c = { n: Math.cos(ang) * rad, e: Math.sin(ang) * rad };
    const hdg = r(4) * Math.PI * 2;
    const len = spec.len[0] + r(5) * (spec.len[1] - spec.len[0]);
    const a = { n: c.n - (Math.cos(hdg) * len) / 2, e: c.e - (Math.sin(hdg) * len) / 2 };
    const b = { n: c.n + (Math.cos(hdg) * len) / 2, e: c.e + (Math.sin(hdg) * len) / 2 };
    // água em todo o trecho, com margem lateral de 60 m
    let ok = true;
    const side = { n: -Math.sin(hdg) * 60, e: Math.cos(hdg) * 60 };
    for (let i = 0; i <= 16 && ok; i++) {
      const f = i / 16;
      const p = { n: a.n + (b.n - a.n) * f, e: a.e + (b.e - a.e) * f };
      for (const s of [-1, 0, 1]) {
        const d = depthAt(p.n + side.n * s, p.e + side.e * s);
        if (!Number.isFinite(d) || d < spec.minDepth) {
          ok = false;
          break;
        }
      }
    }
    if (!ok) continue;
    if (segPointDist({ n: 0, e: 0 }, a, b) < CLEAR_ORIGIN) continue;
    if (taken.some((t) => segSegDist(a, b, t.a, t.b) < Math.max(spec.sep, t.sep))) continue;
    taken.push({ a, b, sep: spec.sep });
    // mercantes: graneleiros e porta-contêineres (modelos 3D diferentes)
    const base = spec.kind === 'mercante' ? (r(8) < 0.5 ? 'Porta-contêineres' : 'Graneleiro') : spec.name;
    const nth = out.filter((x) => x.name.startsWith(base + ' ')).length + 1;
    out.push({
      id: `T${String(out.length + 1).padStart(2, '0')}`,
      name: `${base} ${nth} (fictício)`,
      kind: spec.kind,
      a: nedToLatLon(origin, a.n, a.e),
      b: nedToLatLon(origin, b.n, b.e),
      frame: { ...origin },
      speed: spec.speed[0] + r(6) * (spec.speed[1] - spec.speed[0]),
      phase: r(7),
    });
  }
  return out;
}

const cache = new Map<string, TrafficRoute[]>();

/** Mesmo que buildTraffic, com cache por origem, quantidade e chave do fundo (costa ligada, relevo…). */
export function trafficRoutes(origin: LatLon, count: number, envKey: string, depthAt: (n: number, e: number) => number): TrafficRoute[] {
  const key = `${origin.lat.toFixed(5)}|${origin.lon.toFixed(5)}|${count}|${envKey}`;
  let r = cache.get(key);
  if (!r) {
    if (cache.size > 16) cache.clear();
    r = buildTraffic(origin, count, depthAt);
    cache.set(key, r);
  }
  return r;
}

/** Tráfego para o ambiente simulado (fundo, costa e estruturas do motor atual). */
export function trafficForEnv(env: Environment, origin: LatLon, count: number): TrafficRoute[] {
  if (count <= 0) return [];
  const g = env.cfg.geo;
  const key = JSON.stringify([g?.coast ?? false, g?.shelfWidth ?? 0, env.cfg.bottom]);
  return trafficRoutes(origin, count, key, (n, e) => env.bottomDepthAt(n, e));
}

/** Posição de cada navio adicional no instante t, no referencial local de `origin`. */
export function trafficAt(t: number, routes: TrafficRoute[], origin: LatLon): (Contact & { lat: number; lon: number })[] {
  return routes.map((c) => {
    // movimento no referencial do sorteio; depois convertido (como os contatos fixos)
    const A = latLonToNed(c.frame, c.a);
    const B = latLonToNed(c.frame, c.b);
    const dn = B.n - A.n;
    const de = B.e - A.e;
    const L = Math.hypot(dn, de);
    const period = (2 * L) / c.speed;
    const ph = (((t / period + c.phase) % 1) + 1) % 1;
    const fwd = ph < 0.5;
    const f = fwd ? ph * 2 : 2 - ph * 2;
    const dir = fwd ? 1 : -1;
    const ll = nedToLatLon(c.frame, A.n + dn * f, A.e + de * f);
    const { n, e } = latLonToNed(origin, ll);
    return { id: c.id, name: c.name, kind: c.kind, n, e, course: ((Math.atan2(de * dir, dn * dir) * 180) / Math.PI + 360) % 360, speed: c.speed, lat: ll.lat, lon: ll.lon };
  });
}
