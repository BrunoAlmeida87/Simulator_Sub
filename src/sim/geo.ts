/**
 * GEOGRAFIA DO MAPA TÁTICO. A física usa coordenadas locais NED (m) a partir
 * da posição inicial; o mapa converte para latitude/longitude a partir de uma
 * ORIGEM geográfica (aproximação de plano tangente local, válida para
 * dezenas de km). Batimetria real não é modelada: a profundidade do fundo é a
 * do cenário.
 */
export interface LatLon {
  lat: number;
  lon: number;
}

const R_EARTH = 6371000;
export const NM = 1852;

/** Estaleiro e Base Naval — Ilha da Madeira, Itaguaí (RJ), Baía de Sepetiba: centro da bacia (imagem Sentinel-2, 2026). */
export const EBN_ITAGUAI: LatLon = { lat: -22.9305, lon: -43.8525 };
/** Ponto de partida padrão: a sul da base, na baía (aprox.). */
export const DEFAULT_ORIGIN: LatLon = { lat: -22.9455, lon: -43.8395 };

/** Ponto de partida alternativo em mar aberto, a sul da Restinga da Marambaia. */
export const OFFSHORE_ORIGIN: LatLon = { lat: -23.3, lon: -43.85 };

export function nedToLatLon(o: LatLon, n: number, e: number): LatLon {
  return { lat: o.lat + (n / R_EARTH) * (180 / Math.PI), lon: o.lon + (e / (R_EARTH * Math.cos((o.lat * Math.PI) / 180))) * (180 / Math.PI) };
}

export function latLonToNed(o: LatLon, p: LatLon): { n: number; e: number } {
  return { n: ((p.lat - o.lat) * Math.PI * R_EARTH) / 180, e: ((p.lon - o.lon) * Math.PI * R_EARTH * Math.cos((o.lat * Math.PI) / 180)) / 180 };
}

/** rumo verdadeiro (°) e distância (m) de a para b, no plano local */
export function bearingRange(a: { n: number; e: number }, b: { n: number; e: number }): { brg: number; rng: number } {
  const dn = b.n - a.n;
  const de = b.e - a.e;
  return { brg: ((Math.atan2(de, dn) * 180) / Math.PI + 360) % 360, rng: Math.hypot(dn, de) };
}

export function fmtDMS(v: number, pos: string, neg: string): string {
  const s = v < 0 ? neg : pos;
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return `${d}°${m.toFixed(3).padStart(6, '0')}′${s}`;
}
export const fmtLat = (lat: number) => fmtDMS(lat, 'N', 'S');
export const fmtLon = (lon: number) => fmtDMS(lon, 'E', 'W');

// ------------------------------------------------------------- contatos
export interface Contact {
  id: string;
  name: string;
  kind: 'mercante' | 'pesqueiro' | 'patrulha' | 'rebocador';
  n: number;
  e: number;
  course: number; // °
  speed: number; // m/s
}

interface ContactDef {
  id: string;
  name: string;
  kind: Contact['kind'];
  /** trecho percorrido em vaivém (m, relativo à origem) */
  a: { n: number; e: number };
  b: { n: number; e: number };
  speed: number;
  phase: number;
}

/**
 * Contatos de superfície FICTÍCIOS (cinemática simples, para o quadro tático).
 * As posições (n, e) são relativas a DEFAULT_ORIGIN (fixas na geografia).
 */
const CONTACTS: ContactDef[] = [
  // posições relativas à origem padrão (baía de Sepetiba); mar aberto a sul da Marambaia
  { id: 'M1', name: 'Graneleiro (fictício)', kind: 'mercante', a: { n: -62000, e: -12000 }, b: { n: -31000, e: 6000 }, speed: 5.5, phase: 0.15 },
  { id: 'M2', name: 'Porta-contêineres (fictício)', kind: 'mercante', a: { n: -58000, e: 40000 }, b: { n: -58000, e: -40000 }, speed: 7.5, phase: 0.6 },
  { id: 'P1', name: 'Pesqueiro (fictício)', kind: 'pesqueiro', a: { n: -26000, e: -9000 }, b: { n: -29000, e: 2000 }, speed: 2.0, phase: 0.3 },
  { id: 'R1', name: 'Rebocador (fictício)', kind: 'rebocador', a: { n: -3000, e: 2000 }, b: { n: -7000, e: 8000 }, speed: 3.0, phase: 0.5 },
  { id: 'RCON', name: 'Rebocador convencional (fictício)', kind: 'rebocador', a: { n: -2800, e: 2300 }, b: { n: -6800, e: 8300 }, speed: 3.0, phase: 0.5 },
  { id: 'RASD', name: 'Rebocador ASD (fictício)', kind: 'rebocador', a: { n: -3200, e: 1700 }, b: { n: -7200, e: 7700 }, speed: 3.0, phase: 0.5 },
  { id: 'RVOI', name: 'Rebocador trator Voith (fictício)', kind: 'rebocador', a: { n: -3400, e: 1400 }, b: { n: -7400, e: 7400 }, speed: 3.0, phase: 0.5 },
  { id: 'N1', name: 'Navio-patrulha (fictício)', kind: 'patrulha', a: { n: -40000, e: -14000 }, b: { n: -40000, e: 14000 }, speed: 6.0, phase: 0.8 },
];

/**
 * Contatos fictícios da Baía de Guanabara e da orla do Rio (trechos em
 * lat/lon, todos em água — ver tests/rio.test.ts). Só entram nas listas com a
 * origem perto do Rio (contactsLocal) e no mapa tático.
 */
const RIO_CONTACTS: { id: string; name: string; kind: Contact['kind']; a: LatLon; b: LatLon; speed: number; phase: number }[] = [
  { id: 'B1', name: 'Barca Rio–Niterói (fictícia)', kind: 'rebocador', a: { lat: -22.9025, lon: -43.1665 }, b: { lat: -22.8945, lon: -43.1295 }, speed: 6.5, phase: 0.2 },
  { id: 'M3', name: 'Graneleiro (fictício) — entrada da barra', kind: 'mercante', a: { lat: -23.02, lon: -43.12 }, b: { lat: -22.86, lon: -43.155 }, speed: 4.5, phase: 0.35 },
  { id: 'R2', name: 'Rebocador (fictício)', kind: 'rebocador', a: { lat: -22.893, lon: -43.158 }, b: { lat: -22.88, lon: -43.142 }, speed: 2.5, phase: 0.7 },
  { id: 'P2', name: 'Pesqueiro (fictício)', kind: 'pesqueiro', a: { lat: -23.0, lon: -43.19 }, b: { lat: -23.012, lon: -43.235 }, speed: 2.0, phase: 0.1 },
  { id: 'N2', name: 'Navio-patrulha (fictício)', kind: 'patrulha', a: { lat: -23.005, lon: -43.13 }, b: { lat: -23.005, lon: -43.245 }, speed: 5.0, phase: 0.55 },
];

/** origem perto do Rio de Janeiro (contatos da Guanabara e da orla) */
export function nearRio(o: LatLon): boolean {
  return o.lat > -23.3 && o.lat < -22.5 && o.lon > -43.75 && o.lon < -42.85;
}

/** contatos do Rio no instante t, com lat/lon */
export function rioContactsAt(t: number): (Contact & { lat: number; lon: number })[] {
  return RIO_CONTACTS.map((c) => {
    const A = latLonToNed(DEFAULT_ORIGIN, c.a);
    const B = latLonToNed(DEFAULT_ORIGIN, c.b);
    const dn = B.n - A.n;
    const de = B.e - A.e;
    const L = Math.hypot(dn, de);
    const period = (2 * L) / c.speed;
    const ph = (((t / period + c.phase) % 1) + 1) % 1;
    const fwd = ph < 0.5;
    const f = fwd ? ph * 2 : 2 - ph * 2;
    const dir = fwd ? 1 : -1;
    const n = A.n + dn * f;
    const e = A.e + de * f;
    const ll = nedToLatLon(DEFAULT_ORIGIN, n, e);
    return { id: c.id, name: c.name, kind: c.kind, n, e, course: ((Math.atan2(de * dir, dn * dir) * 180) / Math.PI + 360) % 360, speed: c.speed, lat: ll.lat, lon: ll.lon };
  });
}

/** Trechos (lat/lon) percorridos pelos contatos fixos — usados para o tráfego adicional não cruzar com eles. */
export function contactRoutes(): { a: LatLon; b: LatLon }[] {
  return [...CONTACTS.map((c) => ({ a: nedToLatLon(DEFAULT_ORIGIN, c.a.n, c.a.e), b: nedToLatLon(DEFAULT_ORIGIN, c.b.n, c.b.e) })), ...RIO_CONTACTS.map((c) => ({ a: c.a, b: c.b }))];
}

/** Área de exercícios fictícia (mar aberto a sul da Restinga da Marambaia). */
export const EXERCISE_AREA: LatLon[] = [
  { lat: -23.25, lon: -44.0 },
  { lat: -23.25, lon: -43.7 },
  { lat: -23.42, lon: -43.7 },
  { lat: -23.42, lon: -44.0 },
];

export function contactsAt(t: number): Contact[] {
  return CONTACTS.map((c) => {
    const dn = c.b.n - c.a.n;
    const de = c.b.e - c.a.e;
    const L = Math.hypot(dn, de);
    const period = (2 * L) / c.speed;
    const ph = (((t / period + c.phase) % 1) + 1) % 1;
    const fwd = ph < 0.5;
    const f = fwd ? ph * 2 : 2 - ph * 2;
    const dir = fwd ? 1 : -1;
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      n: c.a.n + dn * f,
      e: c.a.e + de * f,
      course: ((Math.atan2(de * dir, dn * dir) * 180) / Math.PI + 360) % 360,
      speed: c.speed,
    };
  });
}

/** Ponto de maior aproximação (CPA) entre o próprio navio e um contato. */
export function cpa(own: { n: number; e: number; vn: number; ve: number }, c: Contact): { tcpa: number; dcpa: number } {
  const rn = c.n - own.n;
  const re = c.e - own.e;
  const cv = { n: Math.cos((c.course * Math.PI) / 180) * c.speed, e: Math.sin((c.course * Math.PI) / 180) * c.speed };
  const vn = cv.n - own.vn;
  const ve = cv.e - own.ve;
  const v2 = vn * vn + ve * ve;
  const tc = v2 < 1e-6 ? 0 : -(rn * vn + re * ve) / v2;
  const t = Math.max(0, tc);
  return { tcpa: t, dcpa: Math.hypot(rn + vn * t, re + ve * t) };
}

/**
 * Contatos no referencial LOCAL (NED, m) de uma origem geográfica qualquer:
 * a mesma posição geográfica do quadro tático. Usado pelo mapa (tabela) e
 * pela cena 3D (navios), para os dois mostrarem o mesmo contato no mesmo
 * lugar, com o mesmo rumo e a mesma velocidade.
 */
export function contactsLocal(t: number, origin: LatLon): (Contact & { lat: number; lon: number })[] {
  const base = contactsAt(t).map((c) => {
    const ll = nedToLatLon(DEFAULT_ORIGIN, c.n, c.e);
    const p = latLonToNed(origin, ll);
    return { ...c, n: p.n, e: p.e, lat: ll.lat, lon: ll.lon };
  });
  if (!nearRio(origin)) return base;
  // no Rio: os navios da Guanabara e da orla (os de Sepetiba ficam longe, fora das listas)
  return rioContactsAt(t).map((c) => {
    const p = latLonToNed(origin, c);
    return { ...c, n: p.n, e: p.e };
  });
}
