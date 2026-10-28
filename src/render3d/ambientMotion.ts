/** Corrente decorativa: não aplica forças à simulação. Coordenadas NED. */
export interface AmbientSettings {
  ambientMotion: 'desligado' | 'suave' | 'moderado';
  currentDirection: number; // rumo para onde a corrente visual segue
  bottomLifeDensity: 'desligada' | 'discreta' | 'moderada' | 'abundante';
}
export const DEFAULT_AMBIENT: AmbientSettings = { ambientMotion: 'suave', currentDirection: 70, bottomLifeDensity: 'moderada' };
export const ambientStrength = (s: AmbientSettings) => (s.ambientMotion === 'moderado' ? 1 : s.ambientMotion === 'suave' ? 0.5 : 0);
export function ambientRandom(a: number, b: number, salt = 1): number {
  let x = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(salt, 1274126177);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
/** Deriva dominante (0,09/0,18 m/s) com variação espacial e oscilação rasa. */
export function ambientFlow(n: number, e: number, depth: number, t: number, settings: AmbientSettings) {
  const k = ambientStrength(settings),
    a = (settings.currentDirection * Math.PI) / 180;
  const phase = n * 0.019 + e * 0.013;
  const speed = k * (0.18 + 0.045 * Math.sin(t * 0.13 + phase));
  const sway = k * (0.015 + 0.09 * Math.exp(-Math.max(0, depth) / 25)) * Math.sin(t * 0.42 + phase);
  return { n: Math.cos(a) * speed - Math.sin(a) * sway, e: Math.sin(a) * speed + Math.cos(a) * sway };
}
const wrap = (x: number, width: number) => (((x % width) + width) % width) - width / 2;
/** Campo determinístico, independente de FPS/câmera/gerador aleatório da física. */
export function suspensionParticle(i: number, t: number, pn: number, pe: number, pd: number, settings: AmbientSettings) {
  const rnd = (salt: number) => ambientRandom(i, 71, salt);
  const k = ambientStrength(settings),
    a = (settings.currentDirection * Math.PI) / 180;
  const phase = rnd(4) * Math.PI * 2;
  const rate = 0.18 * k * (0.8 + rnd(5) * 0.4);
  const dn = wrap(rnd(1) * 140 + Math.cos(a) * rate * t - pn, 140);
  const de = wrap(rnd(2) * 140 + Math.sin(a) * rate * t - pe, 140);
  const dd = wrap(rnd(3) * 60 + k * t * (0.008 + rnd(6) * 0.012) - pd, 60);
  const depth = pd + dd;
  const sway = k * (0.1 + 0.65 * Math.exp(-Math.max(0, depth) / 25)) * Math.sin(t * (0.24 + rnd(7) * 0.2) + phase);
  const fade = Math.max(0, Math.min(1, (70 - Math.abs(dn)) / 9, (70 - Math.abs(de)) / 9, (30 - Math.abs(dd)) / 5));
  return {
    n: pn + dn - Math.sin(a) * sway,
    e: pe + de + Math.cos(a) * sway,
    d: depth + k * 0.12 * Math.sin(t * 0.3 + phase),
    fade,
    size: rnd(8) < 0.92 ? 0.07 + rnd(9) * 0.12 : 0.22 + rnd(9) * 0.16,
    alpha: 0.2 + rnd(10) * 0.35,
  };
}

export interface BottomItem {
  n: number;
  e: number;
  depth: number;
  scale: number;
  heading: number;
  tint: number;
  kind: 'rock' | 'sponge' | 'grass';
}
export const BOTTOM_CELL = 24;
export const MAX_BOTTOM_ITEMS = 81 * 12;
/** Ilhas de objetos com areia livre entre elas; identidade estável por célula. */
export function sampleBottom(bottom: (n: number, e: number) => number, pn: number, pe: number, density: AmbientSettings['bottomLifeDensity']): BottomItem[] {
  if (density === 'desligada') return [];
  const out: BottomItem[] = [],
    cn = Math.floor(pn / BOTTOM_CELL),
    ce = Math.floor(pe / BOTTOM_CELL);
  const probability = density === 'discreta' ? 0.3 : density === 'moderada' ? 0.55 : 0.8;
  for (let i = cn - 4; i <= cn + 4; i++)
    for (let j = ce - 4; j <= ce + 4; j++) {
      const rnd = (s: number) => ambientRandom(i, j, s);
      if (rnd(1) > probability) continue;
      const centerN = (i + 0.2 + rnd(2) * 0.6) * BOTTOM_CELL;
      const centerE = (j + 0.2 + rnd(3) * 0.6) * BOTTOM_CELL;
      for (let z = 0; z < 12; z++) {
        const r = (s: number) => rnd(20 + z * 11 + s);
        const n = centerN + (r(1) - 0.5) * 11,
          e = centerE + (r(2) - 0.5) * 11;
        const depth = bottom(n, e);
        if (!Number.isFinite(depth) || depth < 4) continue;
        // Pelo menos duas rochas por grupo; esponjas também em água profunda.
        const kind = z < 3 ? 'rock' : z < 5 ? 'sponge' : 'grass';
        if (kind === 'grass' && depth > 40) continue;
        out.push({ n, e, depth, kind, scale: kind === 'rock' ? 0.5 + r(3) * 1.8 : kind === 'sponge' ? 0.25 + r(3) * 0.7 : 0.6 + r(3) * 1.2, heading: r(4) * Math.PI * 2, tint: r(5) });
      }
    }
  return out;
}
