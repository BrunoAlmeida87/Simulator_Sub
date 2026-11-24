/**
 * DISCRIÇÃO — exposição dos mastros, aeronave de patrulha com radar e contra-detecção acústica.
 *
 *  - Taxa de indiscrição: fração da última hora com algum mastro (ou o casco) fora d'água.
 *  - Aeronave de patrulha (exercício): orbita um ponto; o radar detecta o que está exposto com uma taxa
 *      λ = taxa·fator_do_alvo·(1 − r/R_radar)²/(1 + 0,4·estado do mar)   (por segundo; P = 1 − e^{−λ·dt})
 *    fator: casco na superfície 3, snorkel 1, periscópio 0,4. O MAGE intercepta o radar antes (alcance maior).
 *    Detectado, a aeronave marca a posição (datum) e passa a orbitar sobre ela.
 *  - Contra-detecção: nível irradiado estimado = ruído próprio + 64 dB (ilustrativo); alcance em que o sonar
 *    passivo do oponente (DI, DT) ouviria o SX-1 com TL = 20·log r + α·r (α = 0,07 dB/km).
 * Nada disso altera a dinâmica. Valores fictícios — ver docs/PARAMETROS.md.
 */
import type { VesselConfig } from '../config/types';
import { defaultStealth } from '../config/extSystems';
import type { SimState } from '../core/state';
import { initStealth } from '../core/extState';
import type { MastExposure } from './masts';

/** ruído próprio (escala do sonar) → nível irradiado estimado (dB re 1 µPa a 1 m) */
export const RADIATED_OFFSET = 64;

export function indiscretionRatio(s: SimState): number {
  const st = s.stealth;
  if (!st) return 0;
  const sum = st.bins.reduce((a, b) => a + b, 0);
  return Math.min(1, sum / Math.max(1, Math.min(3600, s.t)));
}

/** alcance (m) em que um sonar passivo (DI, DT) ouve uma fonte de nível SL com ruído ambiente NL */
export function counterDetectionRange(sl: number, nl: number, di: number, dt: number): number {
  const tlMax = sl - nl + di - dt;
  if (tlMax <= 0) return 0;
  const tl = (r: number) => 20 * Math.log10(Math.max(1, r)) + (0.07 * r) / 1000;
  let lo = 1,
    hi = 300000;
  if (tl(hi) <= tlMax) return hi;
  for (let i = 0; i < 60; i++) {
    const m = 0.5 * (lo + hi);
    if (tl(m) > tlMax) hi = m;
    else lo = m;
  }
  return lo;
}

function rand(st: { seed: number }): number {
  let x = st.seed >>> 0 || 1;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  st.seed = x;
  return x / 4294967296;
}

const wrap360 = (a: number) => ((a % 360) + 360) % 360;
const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

export function spawnAircraft(cfg: VesselConfig, s: SimState, range: number, bearing: number): void {
  const st = (s.stealth ??= initStealth(s.rng.seed));
  const a = (bearing * Math.PI) / 180;
  const cn = s.body.pos.x + range * Math.cos(a);
  const ce = s.body.pos.y + range * Math.sin(a);
  const R = (cfg.stealth ?? defaultStealth()).aircraft.orbitRadius;
  st.aircraft = { n: cn + R, e: ce, heading: 90, cn, ce, detectedAt: null, datum: null, esmWarned: false };
}

export function aircraftRange(s: SimState): number {
  const a = s.stealth?.aircraft;
  return a ? Math.hypot(a.n - s.body.pos.x, a.e - s.body.pos.y) : Infinity;
}

export function updateStealth(cfg: VesselConfig, s: SimState, exposure: MastExposure, dt: number, seaState: number, log: (t: string, g: string) => void): void {
  const st = (s.stealth ??= initStealth(s.rng.seed));
  const sc = (cfg.stealth ?? defaultStealth()).aircraft;
  // exposição por minuto (última hora)
  st.binT += dt;
  if (st.binT >= 60) {
    st.binT -= 60;
    st.binIndex = (st.binIndex + 1) % st.bins.length;
    st.bins[st.binIndex] = 0;
  }
  if (exposure.any) st.bins[st.binIndex] += dt;
  st.exposed = exposure.list;
  // aeronave
  const ac = st.aircraft;
  if (!ac) return;
  const cn = ac.datum ? ac.datum.n : ac.cn;
  const ce = ac.datum ? ac.datum.e : ac.ce;
  const R = ac.datum ? 2000 : sc.orbitRadius;
  const dn = ac.n - cn,
    de = ac.e - ce;
  const r = Math.hypot(dn, de);
  const radial = (Math.atan2(de, dn) * 180) / Math.PI;
  // órbita no sentido horário: tangente = radial + 90°, corrigida pelo erro de raio
  const corr = Math.max(-60, Math.min(60, ((r - R) / R) * 90));
  const want = wrap360(radial + 90 + corr + (r > 3 * R ? 90 - corr : 0));
  const turn = Math.max(-3 * dt, Math.min(3 * dt, wrap180(want - ac.heading)));
  ac.heading = wrap360(ac.heading + turn);
  const h = (ac.heading * Math.PI) / 180;
  ac.n += sc.speed * Math.cos(h) * dt;
  ac.e += sc.speed * Math.sin(h) * dt;
  const dist = Math.hypot(ac.n - s.body.pos.x, ac.e - s.body.pos.y);
  if (exposure.any && dist < sc.esmRange && !ac.esmWarned) {
    ac.esmWarned = true;
    log(`MAGE: radar de aeronave de patrulha interceptado a ${(dist / 1000).toFixed(0)} km — recolher os mastros`, 'Discrição');
  }
  if (!exposure.any) ac.esmWarned = false;
  if (exposure.any && dist < sc.radarRange) {
    const factor = (exposure.surfaced ? 3 : 0) + (exposure.snorkel ? 1 : 0) + (exposure.periscope ? 0.4 : 0);
    const lambda = (sc.detectRate * factor * (1 - dist / sc.radarRange) ** 2) / (1 + 0.4 * seaState);
    if (rand(st) < 1 - Math.exp(-lambda * dt)) {
      if (ac.detectedAt === null || s.t - ac.detectedAt > 120) {
        st.detections++;
        log(`DETECTADO pela aeronave de patrulha (radar) a ${(dist / 1000).toFixed(1)} km — exposto: ${exposure.list.join(', ')}`, 'Discrição');
      }
      ac.detectedAt = s.t;
      ac.datum = { n: s.body.pos.x, e: s.body.pos.y };
    }
  }
}
