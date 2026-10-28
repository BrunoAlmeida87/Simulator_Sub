/**
 * FORMA DOS TANQUES INTERNOS — seção transversal que acompanha o casco
 * resistente: o retângulo (largura × altura em torno do centro) recortado
 * pelo círculo de raio hullRadius em torno do eixo. O fundo (e, nos tanques
 * laterais, o costado) fica abaulado como o casco. O tanque é prismático ao
 * longo de x, com comprimento L = capacidade / área da seção.
 *
 * Nível e centroide da água são obtidos por faixas horizontais da seção:
 *   A(h) = Σ w(z)·dz (do fundo até o nível),  ȳ = Σ w·y_m·dz / A,  z̄ = Σ w·z·dz / A
 * Sem hullRadius (configurações antigas) a seção é retangular (nível linear).
 * Coordenadas do corpo: y para boreste, z para baixo.
 */
import type { InternalTankConfig } from '../config/types';

export interface TankSection {
  y0: number;
  y1: number;
  /** z do teto (menor z) */
  zTop: number;
  /** z do ponto mais baixo da seção (maior z) */
  zBot: number;
  R: number | null;
  /** área da seção (m²) e comprimento do tanque (m) */
  area: number;
  length: number;
  /** faixas do fundo para o teto: z central, largura, y médio; acumulados de área e momentos */
  dz: number;
  strips: { z: number; ya: number; yb: number }[];
  cumA: number[];
  cumMy: number[];
  cumMz: number[];
}

const NSTRIP = 96;
const cache = new WeakMap<InternalTankConfig, TankSection>();

/** Limites em y da seção na cota z (ya > yb ⇒ vazio). */
function spanAt(y0: number, y1: number, R: number | null, z: number): [number, number] {
  if (R === null) return [y0, y1];
  const h = Math.sqrt(Math.max(0, R * R - z * z));
  return [Math.max(y0, -h), Math.min(y1, h)];
}

export function tankSection(cfg: InternalTankConfig): TankSection {
  const hit = cache.get(cfg);
  if (hit) return hit;
  const R = cfg.hullRadius ?? null;
  const W = cfg.width ?? (R === null ? 1 : 2);
  const y0 = cfg.center.y - W / 2;
  const y1 = cfg.center.y + W / 2;
  const zTop = cfg.center.z - cfg.height / 2;
  let zBot = cfg.center.z + cfg.height / 2;
  if (R !== null) {
    const yMin = y0 <= 0 && y1 >= 0 ? 0 : Math.min(Math.abs(y0), Math.abs(y1));
    zBot = Math.min(zBot, Math.sqrt(Math.max(0, R * R - yMin * yMin)));
  }
  const dz = (zBot - zTop) / NSTRIP;
  const strips: TankSection['strips'] = [];
  const cumA = [0];
  const cumMy = [0];
  const cumMz = [0];
  for (let i = 0; i < NSTRIP; i++) {
    const z = zBot - (i + 0.5) * dz; // do fundo para cima
    const [ya, yb] = spanAt(y0, y1, R, z);
    strips.push({ z, ya, yb });
    const w = Math.max(0, yb - ya);
    cumA.push(cumA[i] + w * dz);
    cumMy.push(cumMy[i] + w * dz * (ya + yb) * 0.5);
    cumMz.push(cumMz[i] + w * dz * z);
  }
  const area = R === null ? cfg.capacity / cfg.height : cumA[NSTRIP];
  const sec: TankSection = { y0, y1, zTop, zBot, R, area, length: R === null ? W : cfg.capacity / Math.max(1e-6, area), dz, strips, cumA, cumMy, cumMz };
  cache.set(cfg, sec);
  return sec;
}

export interface TankFill {
  /** z da superfície livre (corpo) */
  levelZ: number;
  /** centroide da água (y, z), corpo */
  y: number;
  z: number;
  /** largura da superfície livre e seus limites em y */
  ya: number;
  yb: number;
}

/** Nível e centroide da água para um volume (m³). */
export function tankFill(cfg: InternalTankConfig, volume: number): TankFill {
  const s = tankSection(cfg);
  const frac = Math.max(0, Math.min(1, volume / cfg.capacity));
  if (s.R === null) {
    const h = frac * cfg.height;
    return { levelZ: s.zBot - h, y: cfg.center.y, z: s.zBot - h / 2, ya: s.y0, yb: s.y1 };
  }
  const target = frac * s.area;
  const n = s.strips.length;
  let k = 0;
  while (k < n - 1 && s.cumA[k + 1] < target) k++;
  const dA = s.cumA[k + 1] - s.cumA[k];
  const f = dA > 1e-12 ? Math.max(0, Math.min(1, (target - s.cumA[k]) / dA)) : 0;
  const A = s.cumA[k] + f * dA;
  const st = s.strips[k];
  const levelZ = s.zBot - (k + f) * s.dz;
  const [ya, yb] = spanAt(s.y0, s.y1, s.R, levelZ);
  if (A < 1e-9) {
    const b = s.strips[0];
    return { levelZ: s.zBot, y: (b.ya + b.yb) / 2, z: s.zBot, ya: b.ya, yb: b.yb };
  }
  const my = s.cumMy[k] + f * (s.cumMy[k + 1] - s.cumMy[k]);
  const mz = s.cumMz[k] + f * dA * (st.z + 0.5 * s.dz * (1 - f));
  return { levelZ, y: my / A, z: mz / A, ya, yb };
}

/** Contorno da seção (y, z) no sentido horário visto de vante: costado de boreste de cima para baixo, depois bombordo de baixo para cima. */
export function tankOutline(cfg: InternalTankConfig, n = 40): [number, number][] {
  const s = tankSection(cfg);
  const right: [number, number][] = [];
  const left: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    // mais pontos junto ao fundo, onde o casco curva
    const t = i / n;
    const z = s.zTop + (s.zBot - s.zTop) * (1 - (1 - t) ** 1.6);
    const [ya, yb] = spanAt(s.y0, s.y1, s.R, Math.min(z, s.zBot - 1e-6));
    right.push([yb, z]);
    left.push([ya, z]);
  }
  return [...right, ...left.reverse()];
}
