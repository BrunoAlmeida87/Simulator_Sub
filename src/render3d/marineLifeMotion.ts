/**
 * Fauna decorativa, amostrada pelo tempo da simulação e por células do mundo.
 * Aleatoriedade estável: pausa, replay, troca de aba e segunda janela mostram
 * os mesmos peixes, sem escrever no estado físico nem acumular partículas.
 */
import type { Environment } from '../sim/environment/environment';

export type FishDensity = 'desligada' | 'discreta' | 'moderada' | 'abundante';
export interface MarineLifeSettings {
  fishDensity: FishDensity;
  fishJumps: boolean;
  fishUnderwater: boolean;
}
export const DEFAULT_MARINE_LIFE: MarineLifeSettings = { fishDensity: 'discreta', fishJumps: true, fishUnderwater: true };
/** nadadores soltos (até 4 por célula) + saltadores + cardumes (até 24 peixes por célula), nas 9 células */
export const MAX_FISH = 9 * (4 + 1 + 24);
/** chance de cada célula ter um cardume e tamanho máximo do cardume, por densidade */
const SCHOOL: Record<Exclude<FishDensity, 'desligada'>, { chance: number; min: number; max: number }> = {
  discreta: { chance: 0.4, min: 7, max: 12 },
  moderada: { chance: 0.65, min: 9, max: 16 },
  abundante: { chance: 0.9, min: 12, max: 24 },
};
/** chance de cada célula ter o nadador extra (aumento leve: cerca de +30 % no discreto e +10 % no moderado) */
const EXTRA_SWIMMER = 0.3;
const CELL = 90;
const TAU = Math.PI * 2;

export interface FishPose {
  n: number;
  e: number;
  y: number;
  heading: number;
  pitch: number;
  length: number;
  phase: number;
  tint: number;
  habitat: 'agua' | 'fundo' | 'salto';
  /** peixe de cardume (pequeno, nada junto com os outros) */
  school?: boolean;
}

/** Hash inteiro independente da ordem de amostragem e do gerador da física. */
function random(a: number, b: number, salt: number): number {
  let x = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(salt, 1274126177);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * Limite fixo: por célula, 1 nadador (+1 com chance de 30 %) no discreto e 2 (+1 com 30 %) no moderado —
 * até 27 e 36 peixes nas 9 células; saltos raros. Cada nadador tem posição e órbita próprias (sem cardumes artificiais).
 */
export function sampleMarineLife(env: Environment, time: number, pn: number, pe: number, settings: MarineLifeSettings, out: FishPose[] = []): FishPose[] {
  out.length = 0;
  if (settings.fishDensity === 'desligada' || (!settings.fishJumps && !settings.fishUnderwater)) return out;
  const t = Math.max(0, time);
  const cn = Math.floor(pn / CELL);
  const ce = Math.floor(pe / CELL);
  // o último nadador de cada célula é o "extra", presente só em parte das células
  const swimmers = settings.fishDensity === 'abundante' ? 4 : settings.fishDensity === 'moderada' ? 3 : 2;
  for (let i = cn - 1; i <= cn + 1; i++) {
    for (let j = ce - 1; j <= ce + 1; j++) {
      for (let slot = 0; slot <= swimmers; slot++) {
        const jump = slot === swimmers;
        if (jump ? !settings.fishJumps : !settings.fishUnderwater) continue;
        // O saltador tem identidade própria, independente da densidade.
        const seed = jump ? 100 : slot * 20;
        const rnd = (k: number) => random(i, j, seed + k);
        if (!jump && slot === swimmers - 1 && rnd(14) > EXTRA_SWIMMER) continue;
        let n = (i + 0.25 + rnd(1) * 0.5) * CELL;
        let e = (j + 0.25 + rnd(2) * 0.5) * CELL;
        let heading = rnd(3) * TAU;
        let pitch = 0;
        let height = 0;
        const phase = t * (5 + rnd(4) * 4) + rnd(5) * TAU;
        const habitat = jump ? 'salto' : rnd(6) < 0.45 ? 'fundo' : 'agua';
        if (jump) {
          // Em cada janela há uma chance de salto em um instante imprevisível.
          const epoch = Math.floor(t / 70);
          const chance = random(i, j, 300 + epoch * 3);
          if (chance > (settings.fishDensity === 'discreta' ? 0.24 : 0.42)) continue;
          const start = random(i, j, 301 + epoch * 3) * 64 + 2;
          const duration = 1.5 + rnd(7) * 0.7;
          const u = (t - epoch * 70 - start) / duration;
          if (u < 0 || u > 1) continue;
          heading = random(i, j, 302 + epoch * 3) * TAU;
          const travel = 4 + rnd(8) * 4;
          n += Math.cos(heading) * (u - 0.5) * travel;
          e += Math.sin(heading) * (u - 0.5) * travel;
          const apex = 1.4 + rnd(9) * 1.6;
          height = -0.9 + 4 * apex * u * (1 - u);
          pitch = Math.atan2(4 * apex * (1 - 2 * u), travel);
        } else {
          // Órbitas lentas de raios, velocidades e sentidos diferentes.
          const radius = 8 + rnd(7) * 16;
          const sign = rnd(8) < 0.5 ? -1 : 1;
          const angle = heading + sign * t * (0.025 + rnd(9) * 0.035);
          n += Math.cos(angle) * radius;
          e += Math.sin(angle) * radius;
          heading = angle + (sign * Math.PI) / 2;
        }
        const bottom = env.bottomDepthAt(n, e);
        if (!Number.isFinite(bottom) || bottom < 5) continue;
        const surface = env.waves.elevation(n, e, t);
        if (bottom + surface < 4) continue;
        let y: number;
        if (jump) y = surface + height;
        else {
          const depth = habitat === 'fundo' ? bottom - (2.5 + rnd(10) * 4) : Math.min(bottom - 3, 6 + rnd(10) * 65);
          y = Math.max(-bottom + 1.5, Math.min(surface - 1.5, -depth + Math.sin(t * 0.6 + rnd(11) * TAU) * 0.4));
        }
        const distance = Math.hypot(n - pn, e - pe);
        // Desaparecimento suave antes de sair da vizinhança de células.
        const fade = Math.max(0, Math.min(1, (85 - distance) / 20));
        if (fade <= 0) continue;
        out.push({ n, e, y, heading, pitch, length: (0.65 + rnd(12) * 0.9) * fade, phase, tint: rnd(13), habitat });
      }
      // cardume: peixes pequenos nadando juntos numa órbita lenta, com posições estáveis dentro do grupo
      if (settings.fishUnderwater) sampleSchool(env, t, i, j, pn, pe, SCHOOL[settings.fishDensity], out);
    }
  }
  return out;
}

function sampleSchool(env: Environment, t: number, i: number, j: number, pn: number, pe: number, cfg: { chance: number; min: number; max: number }, out: FishPose[]): void {
  const rnd = (k: number) => random(i, j, 500 + k);
  if (rnd(0) > cfg.chance) return;
  const count = cfg.min + Math.floor(rnd(1) * (cfg.max - cfg.min + 1));
  const radius = 10 + rnd(2) * 18;
  const sign = rnd(3) < 0.5 ? -1 : 1;
  const angle = rnd(4) * TAU + sign * t * (0.04 + rnd(5) * 0.04);
  const cn = (i + 0.3 + rnd(6) * 0.4) * CELL + Math.cos(angle) * radius;
  const ce = (j + 0.3 + rnd(7) * 0.4) * CELL + Math.sin(angle) * radius;
  const heading = angle + (sign * Math.PI) / 2;
  const bottom = env.bottomDepthAt(cn, ce);
  if (!Number.isFinite(bottom) || bottom < 6) return;
  const surface = env.waves.elevation(cn, ce, t);
  if (bottom + surface < 5) return;
  const depth = Math.min(bottom - 3, 4 + rnd(8) * 40);
  const tint = rnd(9);
  const ch = Math.cos(heading);
  const sh = Math.sin(heading);
  for (let k = 0; k < count; k++) {
    const r = (q: number) => random(i * 31 + k, j, 700 + q);
    // posição no grupo (m): ao longo, ao lado e na vertical, com um vaivém lento
    const along = (r(0) - 0.5) * 7 + Math.sin(t * 0.7 + r(3) * TAU) * 0.5;
    const side = (r(1) - 0.5) * 5 + Math.cos(t * 0.5 + r(4) * TAU) * 0.4;
    const up = (r(2) - 0.5) * 2.6;
    const n = cn + ch * along - sh * side;
    const e = ce + sh * along + ch * side;
    const bt = env.bottomDepthAt(n, e);
    if (!Number.isFinite(bt) || bt < 5) continue;
    const sf = env.waves.elevation(n, e, t);
    const y = Math.max(-bt + 1.5, Math.min(sf - 1.5, -depth + up));
    const distance = Math.hypot(n - pn, e - pe);
    const fade = Math.max(0, Math.min(1, (85 - distance) / 20));
    if (fade <= 0) continue;
    out.push({
      n,
      e,
      y,
      heading: heading + (r(5) - 0.5) * 0.25,
      pitch: 0,
      length: (0.28 + r(6) * 0.2) * fade,
      phase: t * (9 + r(7) * 4) + r(8) * TAU,
      tint: Math.min(1, tint * 0.4 + r(9) * 0.15),
      habitat: 'agua',
      school: true,
    });
  }
}
