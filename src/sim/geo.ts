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

/** Estaleiro e Base Naval — Ilha da Madeira, Itaguaí (RJ), Baía de Sepetiba (aprox.). */
export const EBN_ITAGUAI: LatLon = { lat: -22.9318, lon: -43.8368 };
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
  { id: 'R2', name: 'Rebocador convencional (fictício)', kind: 'rebocador', a: { n: -2800, e: 2300 }, b: { n: -6800, e: 8300 }, speed: 3.0, phase: 0.5 },
  { id: 'R3', name: 'Rebocador ASD (fictício)', kind: 'rebocador', a: { n: -3200, e: 1700 }, b: { n: -7200, e: 7700 }, speed: 3.0, phase: 0.5 },
  { id: 'R4', name: 'Rebocador trator Voith (fictício)', kind: 'rebocador', a: { n: -3400, e: 1400 }, b: { n: -7400, e: 7400 }, speed: 3.0, phase: 0.5 },
  { id: 'N1', name: 'Navio-patrulha (fictício)', kind: 'patrulha', a: { n: -40000, e: -14000 }, b: { n: -40000, e: 14000 }, speed: 6.0, phase: 0.8 },
];

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
