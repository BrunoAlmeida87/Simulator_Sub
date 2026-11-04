import { Environment, defaultEnvironment } from '../../sim/environment/environment';
import { traceRay } from '../acoustics/propagation';
import { speedAt } from '../acoustics/environment';
import { clamp, type Observer, type RayPoint } from '../types';

/**
 * Laboratório acústico: corte vertical (distância × profundidade) com água em camadas e fundo plano.
 * Usa o MESMO traçador de raios do sonar (traceRay) com um ambiente próprio — é uma bancada de
 * experimentos, não altera a simulação.
 */
export interface LabSetup {
  /** água com 1500 m/s em todas as profundidades (raios retos) */
  uniform: boolean;
  surfaceTemperature: number;
  deepTemperature: number;
  thermoclineDepth: number;
  thermoclineThickness: number;
  bottomDepth: number;
  subDepth: number;
  targetRange: number;
  targetDepth: number;
  /** largura do corte (m) */
  range: number;
}

export interface LabRay {
  angle: number;
  points: RayPoint[];
  /** profundidade "desdobrada" (método das imagens): contínua através das reflexões */
  u: number[];
  /** cos do ângulo do raio em cada ponto */
  cos: number[];
  /** perdas além do espalhamento (absorção + reflexões), dB */
  extra: number[];
  /** comprimento percorrido, m */
  len: number[];
  /** faixa de imagem do trecho que começa em cada ponto */
  k: number[];
  /** reflexões acumuladas (superfície, fundo) até cada ponto */
  ns: number[];
  nb: number[];
}

export type PathKind = 'direto' | 'superfície' | 'fundo' | 'várias';

export interface Arrival {
  time: number;
  loss: number;
  surface: number;
  bottom: number;
  kind: PathKind;
  /** índice do raio (no leque de ida) mais próximo deste caminho */
  ray: number;
}

export interface LabField {
  cols: number;
  rows: number;
  /** perda de transmissão (dB) pelo melhor caminho; Infinity = nenhum raio */
  loss: Float32Array;
  /** perda pelo melhor caminho SEM reflexão no fundo; Infinity = zona de sombra */
  direct: Float32Array;
}

export interface LabResult {
  setup: LabSetup;
  depth: number;
  rays: LabRay[];
  /** leque de raios saindo do alvo em direção ao submarino (eco), em distância medida a partir do alvo */
  back: LabRay[];
  field: LabField;
  /** 1 = água sem som direto útil (zona de sombra) */
  shadowMask: Uint8Array;
  arrivals: Arrival[];
  profile: { z: number; c: number; t: number }[];
  cSub: number;
  cTarget: number;
  /** gradiente dc/dz (m/s por m) logo abaixo do submarino */
  gradient: number;
  shadow: { r: number; z: number; cells: number } | null;
  /** primeira chegada no alvo (s) e eco de volta no submarino pelo caminho mais forte (s) */
  firstArrival: number | null;
  /** caminho mais forte até o alvo (define o eco) */
  strongest: Arrival | null;
  echoTime: number | null;
  /** distância que o operador calcula com o tempo do eco e a velocidade do som local */
  measuredRange: number | null;
  echoExcess: number | null;
  timeEnd: number;
}

/** termos da equação do sonar ativo usados no laboratório (os mesmos de sensors/active.ts) */
export const SONAR_EQ = { source: 210, target: 15, noise: 55, reverb: 10, threshold: 6 };

export const LAB_DEFAULT: LabSetup = {
  uniform: false,
  surfaceTemperature: 27,
  deepTemperature: 9,
  thermoclineDepth: 60,
  thermoclineThickness: 8,
  bottomDepth: 400,
  subDepth: 25,
  targetRange: 5500,
  targetDepth: 180,
  range: 8000,
};

export interface LabPreset {
  id: string;
  label: string;
  /** o que observar — uma frase */
  note: string;
  setup: Partial<LabSetup>;
}

export const LAB_PRESETS: LabPreset[] = [
  {
    id: 'uniforme',
    label: 'Água uniforme',
    note: 'Mesma velocidade em toda a água: o som anda em linha reta e a frente de onda é um círculo que se reflete na superfície e no fundo.',
    setup: { uniform: true, bottomDepth: 300, subDepth: 100, targetRange: 1500, targetDepth: 200, range: 2000 },
  },
  {
    id: 'camada',
    label: 'Esconder-se abaixo da camada',
    note: 'Você está acima da termoclina; o alvo, abaixo dela. Os raios dobram na camada e abrem uma zona de sombra: o ping não alcança o alvo. Arraste o alvo para cima ou para perto e veja o eco voltar.',
    setup: { uniform: false, surfaceTemperature: 27, deepTemperature: 9, thermoclineDepth: 60, thermoclineThickness: 8, bottomDepth: 400, subDepth: 25, targetRange: 5500, targetDepth: 180, range: 8000 },
  },
  {
    id: 'canal',
    label: 'Canal de superfície',
    note: 'Camada de mistura profunda e você dentro dela: o som fica preso perto da superfície e vai longe com pouca perda.',
    setup: { uniform: false, surfaceTemperature: 22, deepTemperature: 10, thermoclineDepth: 140, thermoclineThickness: 12, bottomDepth: 600, subDepth: 40, targetRange: 9000, targetDepth: 40, range: 12000 },
  },
  {
    id: 'abaixo',
    label: 'Ping abaixo da camada',
    note: 'Agora você está abaixo da termoclina: o som se curva para baixo antes de subir, e quem está perto da superfície fica na sombra.',
    setup: { uniform: false, surfaceTemperature: 26, deepTemperature: 10, thermoclineDepth: 60, thermoclineThickness: 12, bottomDepth: 500, subDepth: 160, targetRange: 5000, targetDepth: 25, range: 8000 },
  },
  {
    id: 'raso',
    label: 'Águas rasas',
    note: 'Fundo a 60 m: o som vai e volta entre superfície e fundo, e cada batida no fundo custa energia.',
    setup: { uniform: false, surfaceTemperature: 23, deepTemperature: 20, thermoclineDepth: 30, thermoclineThickness: 10, bottomDepth: 60, subDepth: 30, targetRange: 3000, targetDepth: 40, range: 5000 },
  },
];

export function sanitize(s: LabSetup): LabSetup {
  const bottomDepth = clamp(s.bottomDepth, 30, 1500);
  const range = clamp(s.range, 1000, 30000);
  return {
    ...s,
    surfaceTemperature: clamp(s.surfaceTemperature, -1, 32),
    deepTemperature: clamp(s.deepTemperature, -1, 32),
    thermoclineDepth: clamp(s.thermoclineDepth, 5, 800),
    thermoclineThickness: clamp(s.thermoclineThickness, 3, 200),
    bottomDepth,
    range,
    subDepth: clamp(s.subDepth, 2, bottomDepth - 2),
    targetDepth: clamp(s.targetDepth, 2, bottomDepth - 2),
    targetRange: clamp(s.targetRange, range * 0.05, range * 0.98),
  };
}

/** Ambiente do laboratório: a temperatura vem do mesmo perfil (tanh) do Environment da simulação,
 * tabelada para o traçado de raios ficar rápido o bastante para arrastar com o mouse. */
let envCache: { key: string; env: Environment } | null = null;
function labEnvironment(s: LabSetup): Environment {
  const key = [s.surfaceTemperature, s.deepTemperature, s.thermoclineDepth, s.thermoclineThickness].join('|');
  if (envCache?.key === key) return envCache.env;
  const cfg = defaultEnvironment();
  cfg.surfaceTemperature = s.surfaceTemperature;
  cfg.deepTemperature = s.deepTemperature;
  cfg.thermoclineDepth = s.thermoclineDepth;
  cfg.thermoclineThickness = s.thermoclineThickness;
  cfg.salinity = cfg.deepSalinity = 35;
  cfg.geo = { ...cfg.geo!, coast: false };
  const real = new Environment(cfg);
  const STEP = 0.25,
    N = Math.ceil(1600 / STEP) + 1;
  const table = Float64Array.from({ length: N }, (_, i) => real.temperatureAt(i * STEP));
  const temp = (z: number) => {
    const f = clamp(z, 0, (N - 1) * STEP) / STEP,
      i = Math.min(N - 2, Math.floor(f));
    return table[i] + (table[i + 1] - table[i]) * (f - i);
  };
  // speedAt/traceRay só leem temperatura e salinidade
  const env = { cfg, temperatureAt: temp, salinityAt: () => 35 } as unknown as Environment;
  envCache = { key, env };
  return env;
}

/** Profundidade desdobrada a partir dos eventos de reflexão (superfície em 0, fundo plano em D). */
function unfold(points: RayPoint[], D: number): Pick<LabRay, 'u' | 'k' | 'ns' | 'nb'> {
  let k = 0,
    ns = 0,
    nb = 0;
  const out: Pick<LabRay, 'u' | 'k' | 'ns' | 'nb'> = { u: [], k: [], ns: [], nb: [] };
  for (const p of points) {
    if (p.event === 'surface') {
      k += mod(k) === 0 ? -1 : 1;
      ns++;
    } else if (p.event === 'bottom') {
      k += mod(k) === 0 ? 1 : -1;
      nb++;
    }
    out.u.push(mod(k) === 0 ? k * D + p.z : (k + 1) * D - p.z);
    out.k.push(k);
    out.ns.push(ns);
    out.nb.push(nb);
  }
  return out;
}

const mod = (k: number) => ((k % 2) + 2) % 2;
export const physical = (u: number, k: number, D: number) => (mod(k) === 0 ? u - k * D : (k + 1) * D - u);
const unfolded = (z: number, k: number, D: number) => (mod(k) === 0 ? z + k * D : (k + 1) * D - z);

export const ANGLE_SPAN = 85;
/** Ângulos do leque: mais densos perto da horizontal (os raios que ficam presos nas camadas são quase horizontais). */
export function fanAngle(i: number, count: number): number {
  const x = -1 + (2 * i) / (count - 1);
  return ANGLE_SPAN * Math.sign(x) * Math.abs(x) ** 1.5;
}

function fan(env: Environment, s: LabSetup, depth: number, range: number, count: number): { rays: LabRay[] } {
  const origin: Observer = { n: 0, e: 0, depth, heading: 0, vn: 0, ve: 0 };
  const D = s.bottomDepth;
  const floor = () => D;
  const step = clamp(range / 400, 4, 40);
  const rays: LabRay[] = [];
  for (let i = 0; i < count; i++) {
    const angle = fanAngle(i, count);
    // raios íngremes batem muitas vezes entre superfície e fundo: param depois de ~15 idas e voltas (já perderam > 90 dB)
    const tan = Math.abs(Math.tan((angle * Math.PI) / 180));
    const reach = Math.min(range, Math.max(3 * D, (30 * D) / Math.max(0.02, tan)));
    const ray = traceRay(env, origin, 0, (angle * Math.PI) / 180, reach, 1000, s.uniform, floor, true, step);
    const p = ray.points;
    const len: number[] = [0],
      cos: number[] = [],
      extra: number[] = [0];
    for (let j = 1; j < p.length; j++) {
      const seg = Math.hypot(p[j].r - p[j - 1].r, p[j].z - p[j - 1].z);
      len.push(len[j - 1] + seg);
      extra.push(p[j].loss - 20 * Math.log10(Math.max(1, len[j])));
      cos.push(seg > 1e-9 ? (p[j].r - p[j - 1].r) / seg : 1);
    }
    cos.push(cos[cos.length - 1] ?? Math.cos((angle * Math.PI) / 180));
    rays.push({ angle, points: p, cos, extra, len, ...unfold(p, D) });
  }
  return { rays };
}

/** Amostra de um raio na distância r (raios só avançam em r). */
interface Sample {
  u: number;
  k: number;
  ns: number;
  nb: number;
  t: number;
  cos: number;
  extra: number;
  len: number;
}
function sampleAt(ray: LabRay, r: number, hint = { i: 0 }): Sample | null {
  const p = ray.points;
  if (p.length < 2 || r > p[p.length - 1].r + 1e-6 || r < p[0].r) return null;
  let i = hint.i;
  while (i < p.length - 2 && p[i + 1].r < r) i++;
  hint.i = i;
  const j = i + 1,
    a = p[i],
    b = p[j];
  const f = b.r - a.r > 1e-9 ? clamp((r - a.r) / (b.r - a.r), 0, 1) : 0;
  const lerp = (x: number[]) => x[i] + (x[j] - x[i]) * f;
  return { u: lerp(ray.u), k: ray.k[i], ns: ray.ns[i], nb: ray.nb[i], t: a.t + (b.t - a.t) * f, cos: ray.cos[i], extra: lerp(ray.extra), len: lerp(ray.len) };
}

/**
 * Perda de transmissão de um tubo de raios (entre dois raios vizinhos): a energia lançada entre os dois
 * ângulos se espalha pela largura do tubo. Água uniforme → 20·log(distância). Tubo que se abre (raios que
 * divergem na camada) → perda grande; cáusticas limitadas a 6 dB acima do esférico.
 */
function tubeLoss(r: number, a: Sample, b: Sample, angA: number, angB: number): number {
  const width = Math.abs(b.u - a.u);
  const dTheta = Math.max(1e-6, (Math.abs(angB - angA) * Math.PI) / 180);
  const c0 = Math.cos((((angA + angB) / 2) * Math.PI) / 180);
  const cos = (a.cos + b.cos) / 2;
  const spread = 10 * Math.log10(Math.max(1, (r * width * cos) / (dTheta * Math.max(0.05, c0))));
  const spherical = 20 * Math.log10(Math.max(1, (a.len + b.len) / 2));
  return Math.max(spread, spherical - 6) + (a.extra + b.extra) / 2;
}

/** Reflexões do trecho do tubo na faixa k (cada raio sabe quantas vezes já refletiu). */
function counts(k: number, a: Sample, b: Sample): { surface: number; bottom: number } {
  if (k === a.k && k !== b.k) return { surface: a.ns, bottom: a.nb };
  if (k === b.k && k !== a.k) return { surface: b.ns, bottom: b.nb };
  return { surface: Math.max(a.ns, b.ns), bottom: Math.max(a.nb, b.nb) };
}

/** Percorre o intervalo desdobrado [ua, ub] faixa por faixa (cada faixa = um conjunto de reflexões). */
function eachCell(ua: number, ub: number, D: number, fn: (k: number, z0: number, z1: number) => void): void {
  const lo = Math.min(ua, ub),
    hi = Math.max(ua, ub);
  for (let k = Math.floor(lo / D); k * D <= hi; k++) {
    const u0 = Math.max(lo, k * D),
      u1 = Math.min(hi, (k + 1) * D);
    if (u1 < u0) continue;
    const z0 = physical(u0, k, D),
      z1 = physical(u1, k, D);
    fn(k, Math.min(z0, z1), Math.max(z0, z1));
  }
}

const COLS = 200,
  ROWS = 100;
/** Margem acima do espalhamento esférico para ainda contar como "som direto" (acima disso: sombra). */
export const SHADOW_EXCESS = 10;

function buildField(rays: LabRay[], s: LabSetup): LabField {
  const D = s.bottomDepth;
  const loss = new Float32Array(COLS * ROWS).fill(Infinity),
    direct = new Float32Array(COLS * ROWS).fill(Infinity);
  const hints = rays.map(() => ({ i: 0 }));
  const dz = D / ROWS;
  for (let c = 0; c < COLS; c++) {
    const r = ((c + 0.5) / COLS) * s.range;
    const samples = rays.map((ray, i) => sampleAt(ray, r, hints[i]));
    for (let i = 0; i + 1 < rays.length; i++) {
      const a = samples[i],
        b = samples[i + 1];
      if (!a || !b) continue;
      const l = tubeLoss(r, a, b, rays[i].angle, rays[i + 1].angle);
      if (l > 160) continue;
      eachCell(a.u, b.u, D, (k, z0, z1) => {
        const { bottom } = counts(k, a, b);
        // células cujo centro está dentro do tubo (ou a mais próxima, para tubos finos)
        let r0 = Math.ceil(z0 / dz - 0.5),
          r1 = Math.floor(z1 / dz - 0.5);
        if (r1 < r0) r0 = r1 = Math.floor((z0 + z1) / 2 / dz);
        r0 = clamp(r0, 0, ROWS - 1);
        r1 = clamp(r1, 0, ROWS - 1);
        for (let row = r0; row <= r1; row++) {
          const idx = row * COLS + c;
          if (l < loss[idx]) loss[idx] = l;
          if (bottom === 0 && l < direct[idx]) direct[idx] = l;
        }
      });
    }
  }
  return { cols: COLS, rows: ROWS, loss, direct };
}

/** Caminhos que chegam a (r, z): direto, reflexo na superfície, no fundo… (um por conjunto de reflexões). */
export function arrivalsAt(rays: LabRay[], D: number, r: number, z: number): Arrival[] {
  const samples = rays.map((ray) => sampleAt(ray, r));
  const found: Arrival[] = [];
  for (let i = 0; i + 1 < rays.length; i++) {
    const a = samples[i],
      b = samples[i + 1];
    if (!a || !b) continue;
    const lo = Math.min(a.u, b.u),
      hi = Math.max(a.u, b.u);
    eachCell(a.u, b.u, D, (k) => {
      const ut = unfolded(z, k, D);
      if (ut < lo || ut > hi) return;
      const f = hi - lo > 1e-9 ? (ut - a.u) / (b.u - a.u) : 0.5;
      const { surface, bottom } = counts(k, a, b);
      const kind: PathKind = surface + bottom === 0 ? 'direto' : surface + bottom > 1 ? 'várias' : surface ? 'superfície' : 'fundo';
      found.push({ time: a.t + (b.t - a.t) * f, loss: tubeLoss(r, a, b, rays[i].angle, rays[i + 1].angle), surface, bottom, kind, ray: f < 0.5 ? i : i + 1 });
    });
  }
  found.sort((p, q) => p.loss - q.loss);
  const best = found[0]?.loss ?? Infinity;
  const unique: Arrival[] = [];
  for (const p of found) {
    if (p.loss > best + 25 || unique.length >= 6) break;
    if (!unique.some((q) => q.surface === p.surface && q.bottom === p.bottom && Math.abs(q.time - p.time) < 0.02)) unique.push(p);
  }
  return unique.sort((p, q) => p.time - q.time);
}

/** Som direto útil numa célula: caminho sem fundo com perda até SHADOW_EXCESS dB acima do esférico. */
function litDirect(field: LabField, s: LabSetup, idx: number): boolean {
  const c = idx % field.cols,
    row = (idx - c) / field.cols;
  const r = ((c + 0.5) / field.cols) * s.range,
    z = ((row + 0.5) / field.rows) * s.bottomDepth;
  return field.direct[idx] <= 20 * Math.log10(Math.max(1, Math.hypot(r, z - s.subDepth))) + SHADOW_EXCESS;
}

/** Água sem som direto útil (máscara) e a maior região contínua (zona de sombra, com posição do rótulo). */
function findShadow(field: LabField, s: LabSetup): { mask: Uint8Array; label: LabResult['shadow'] } {
  const { cols, rows } = field;
  const mask = new Uint8Array(cols * rows);
  const start = Math.ceil(cols * 0.03);
  for (let i = 0; i < cols * rows; i++) if (i % cols >= start && !litDirect(field, s, i)) mask[i] = 1;
  const seen = new Uint8Array(cols * rows);
  let best: number[] | null = null;
  for (let i = 0; i < cols * rows; i++) {
    if (seen[i] || !mask[i]) continue;
    const stack = [i],
      cells: number[] = [];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      cells.push(j);
      const c = j % cols,
        r = (j - c) / cols;
      const next = [c + 1 < cols ? j + 1 : -1, c > 0 ? j - 1 : -1, r + 1 < rows ? j + cols : -1, r > 0 ? j - cols : -1];
      for (const n of next)
        if (n >= 0 && mask[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
    }
    if (!best || cells.length > best.length) best = cells;
  }
  if (!best || best.length < cols * rows * 0.02) return { mask, label: null };
  let sc = 0,
    sr = 0;
  for (const j of best) {
    sc += j % cols;
    sr += Math.floor(j / cols);
  }
  sc /= best.length;
  sr /= best.length;
  // ponto da região mais perto do centroide (o centroide pode cair fora de uma região curva)
  let pick = best[0],
    d = Infinity;
  for (const j of best) {
    const dd = ((j % cols) - sc) ** 2 + (Math.floor(j / cols) - sr) ** 2;
    if (dd < d) {
      d = dd;
      pick = j;
    }
  }
  return { mask, label: { r: (((pick % cols) + 0.5) / cols) * s.range, z: ((Math.floor(pick / cols) + 0.5) / rows) * s.bottomDepth, cells: best.length } };
}

/** Cache por partes: arrastar o alvo não refaz o leque do submarino, e vice-versa. */
const cache: { fwdKey?: string; fwd?: ReturnType<typeof fan>; field?: LabField; shadow?: ReturnType<typeof findShadow>; backKey?: string; back?: ReturnType<typeof fan> } = {};

/** rayCount menor (ex.: 91) = rascunho rápido enquanto o usuário arrasta. */
export function computeLab(input: LabSetup, rayCount = 181): LabResult {
  const s = sanitize(input);
  const env = labEnvironment(s);
  const profileKey = [s.uniform, s.surfaceTemperature, s.deepTemperature, s.thermoclineDepth, s.thermoclineThickness, s.bottomDepth].join('|');
  const fwdKey = [profileKey, s.subDepth, s.range, rayCount].join('|');
  if (cache.fwdKey !== fwdKey) {
    cache.fwd = fan(env, s, s.subDepth, s.range, rayCount);
    cache.field = buildField(cache.fwd.rays, s);
    cache.shadow = findShadow(cache.field, s);
    cache.fwdKey = fwdKey;
  }
  const backCount = Math.max(45, Math.round(rayCount / 2));
  const backKey = [profileKey, s.targetDepth, s.targetRange, backCount].join('|');
  if (cache.backKey !== backKey) {
    cache.back = fan(env, s, s.targetDepth, s.targetRange * 1.02, backCount);
    cache.backKey = backKey;
  }
  const { rays } = cache.fwd!;
  const field = cache.field!;
  const arrivals = arrivalsAt(rays, s.bottomDepth, s.targetRange, s.targetDepth);
  const speed = (z: number) => speedAt(env, z, s.uniform);
  const profile = Array.from({ length: 121 }, (_, i) => {
    const z = (i / 120) * s.bottomDepth;
    return { z, c: speed(z), t: env.temperatureAt(z) };
  });
  const cSub = speed(s.subDepth),
    cTarget = speed(s.targetDepth);
  const gradient = (speed(s.subDepth + 10) - cSub) / 10;
  const strongest = arrivals.reduce<Arrival | null>((m, a) => (!m || a.loss < m.loss ? a : m), null);
  const echoTime = strongest ? 2 * strongest.time : null;
  const echoExcess = strongest ? SONAR_EQ.source - 2 * strongest.loss + SONAR_EQ.target - SONAR_EQ.noise - SONAR_EQ.reverb : null;
  const cMin = Math.min(...profile.map((p) => p.c));
  return {
    setup: s,
    depth: s.bottomDepth,
    rays,
    back: cache.back!.rays,
    field,
    shadowMask: cache.shadow!.mask,
    arrivals,
    profile,
    cSub,
    cTarget,
    gradient,
    shadow: cache.shadow!.label,
    firstArrival: arrivals[0]?.time ?? null,
    strongest,
    echoTime,
    measuredRange: echoTime === null ? null : (cSub * echoTime) / 2,
    echoExcess,
    timeEnd: Math.max((s.range / cMin) * 1.03, (echoTime ?? 0) + 0.5),
  };
}

export interface FrontPoint {
  r: number;
  z: number;
  u: number;
  i: number;
  extra: number;
  len: number;
}

/** Posição de um raio num instante t (para desenhar a frente de onda). */
export function pointAtTime(ray: LabRay, t: number): FrontPoint | null {
  const p = ray.points;
  if (p.length < 2 || t > p[p.length - 1].t || t < 0) return null;
  let lo = 0,
    hi = p.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = p[lo],
    b = p[hi];
  const f = b.t - a.t > 1e-9 ? (t - a.t) / (b.t - a.t) : 0;
  const lerp = (x: number[]) => x[lo] + (x[hi] - x[lo]) * f;
  return { r: a.r + (b.r - a.r) * f, z: a.z + (b.z - a.z) * f, u: lerp(ray.u), i: lo, extra: lerp(ray.extra), len: lerp(ray.len) };
}

/** Perda de um trecho da frente de onda entre dois raios vizinhos (mesma ideia do tubo de raios). */
export function frontLoss(a: FrontPoint, b: FrontPoint, angA: number, angB: number): number {
  const width = Math.hypot(b.r - a.r, b.u - a.u);
  const r = Math.max(1, (a.r + b.r) / 2);
  const dTheta = Math.max(1e-6, (Math.abs(angB - angA) * Math.PI) / 180);
  const c0 = Math.max(0.05, Math.cos((((angA + angB) / 2) * Math.PI) / 180));
  const spread = 10 * Math.log10(Math.max(1, (r * width) / (dTheta * c0)));
  const spherical = 20 * Math.log10(Math.max(1, (a.len + b.len) / 2));
  return Math.max(spread, spherical - 6) + (a.extra + b.extra) / 2;
}

/** Caminhos até o alvo com som direto útil (sem passar pelo fundo). */
export function directArrivals(res: LabResult): Arrival[] {
  const s = res.setup;
  const spherical = 20 * Math.log10(Math.hypot(s.targetRange, s.targetDepth - s.subDepth));
  return res.arrivals.filter((a) => a.bottom === 0 && a.loss <= spherical + SHADOW_EXCESS);
}

/** Situação do alvo em palavras. */
export function targetStatus(res: LabResult): { tone: 'ok' | 'weak' | 'none'; text: string } {
  const heard = res.echoExcess !== null && res.echoExcess >= SONAR_EQ.threshold;
  if (!res.arrivals.length) return { tone: 'none', text: 'Nenhum raio chega ao alvo: ele está na zona de sombra. Não há eco.' };
  if (!directArrivals(res).length)
    return heard
      ? { tone: 'weak', text: 'Alvo na zona de sombra: o som direto quase não chega, mas o refletido no fundo produz um eco fraco.' }
      : { tone: 'none', text: 'Alvo na zona de sombra: só chega som muito espalhado ou refletido no fundo, fraco demais para um eco detectável.' };
  return heard ? { tone: 'ok', text: 'O ping alcança o alvo e o eco volta acima do ruído.' } : { tone: 'weak', text: 'O som chega ao alvo, mas o eco volta abaixo do ruído (longe demais).' };
}

/** Explicação curta da curvatura dos raios: na profundidade do submarino e na termoclina. */
export function bendingText(res: LabResult): string {
  const s = res.setup;
  if (s.uniform) return 'Velocidade igual em toda a água: os raios seguem retos e a frente de onda é um círculo.';
  const g = res.gradient;
  const here =
    g < -0.03
      ? 'Logo abaixo de você o som fica mais lento (água mais fria): os raios que descem se curvam ainda mais para baixo.'
      : g > 0.005
        ? 'Na sua camada o som fica um pouco mais rápido com a profundidade: os raios quase horizontais se curvam para cima e ficam presos perto da superfície.'
        : 'Na sua profundidade a velocidade quase não muda: os raios seguem quase retos.';
  const layer = Math.abs(s.surfaceTemperature - s.deepTemperature) >= 2 && s.thermoclineDepth < s.bottomDepth;
  if (!layer || Math.abs(s.subDepth - s.thermoclineDepth) < s.thermoclineThickness) return here;
  const colder = s.deepTemperature < s.surfaceTemperature;
  if (s.subDepth < s.thermoclineDepth)
    return `${here} Mais abaixo, na termoclina, a água ${colder ? 'esfria e o som fica mais lento: os raios que descem dobram para baixo' : 'esquenta e o som fica mais rápido: os raios que descem voltam para cima'}.`;
  return `${here} Acima de você, na termoclina, a água ${colder ? 'é mais quente e o som mais rápido: os raios que sobem dobram de volta para baixo' : 'é mais fria e o som mais lento: os raios que sobem seguem para a superfície'}.`;
}
