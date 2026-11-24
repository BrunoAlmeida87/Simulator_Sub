/**
 * NAVEGAÇÃO ESTIMADA COM CORREÇÃO DE POSIÇÃO.
 *
 * A posição estimada (s.nav.drNorth/drEast) integra a velocidade do Doppler EM RELAÇÃO À ÁGUA com a atitude
 * medida (sensors.ts). Sem corrente, o erro vem só do ruído dos sensores; com corrente, a posição estimada
 * "deriva" com ela (o Doppler não mede a corrente). A incerteza indicada cresce com a distância e o tempo
 * desde a última correção:
 *
 *   σ = √(σ₀² + (0,01·distância)² + (0,05 m/s·Δt)²)        (0,05 m/s ≈ 0,1 nó de corrente desconhecida)
 *
 * Correção por GPS: só com uma antena fora d'água (periscópio/snorkel içados ou na superfície). A posição
 * estimada passa à verdadeira com um erro gaussiano de σ₀ = 10 m. Pode ser automática (a cada 60 s exposto).
 */
import type { SimState } from '../core/state';
import { initNavFix } from '../core/extState';
import type { MastExposure } from './masts';

/** incerteza indicada da posição estimada (1σ, m) */
export function navUncertainty(s: SimState): number {
  const nf = s.navFix;
  if (!nf) return 0;
  const dist = Math.max(0, s.nav.distance - nf.distAtFix);
  const dt = Math.max(0, s.t - nf.lastFix);
  return Math.sqrt(nf.sigma0 * nf.sigma0 + (0.01 * dist) ** 2 + (0.05 * dt) ** 2);
}

/** erro real da posição estimada (m) — só para o modo engenharia e as telas didáticas */
export function navError(s: SimState): number {
  return Math.hypot(s.nav.drNorth - s.body.pos.x, s.nav.drEast - s.body.pos.y);
}

/** gaussiano determinístico (Box–Muller sobre um hash do instante e do número da correção) */
function gauss(seed: number): number {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  const next = () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return (x + 0.5) / 4294967296;
  };
  const u = next(),
    v = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** aplica uma correção de GPS (a posição estimada vai à verdadeira ± σ₀) */
export function applyGpsFix(s: SimState): void {
  const nf = (s.navFix ??= initNavFix(s.t, s.nav.distance));
  const k = Math.round(s.t * 50) * 31 + nf.fixes * 7919;
  s.nav.drNorth = s.body.pos.x + nf.sigma0 * gauss(k);
  s.nav.drEast = s.body.pos.y + nf.sigma0 * gauss(k + 1);
  nf.lastFix = s.t;
  nf.distAtFix = s.nav.distance;
  nf.fixes++;
  nf.lastKind = 'GPS';
}

/** correção automática (a cada 60 s com antena fora d'água) */
export function updateNavFix(s: SimState, exposure: MastExposure, log: (t: string, g: string) => void): void {
  const nf = (s.navFix ??= initNavFix(s.t, s.nav.distance));
  if (nf.autoFix && exposure.any && s.t - nf.lastFix >= 60) {
    const before = navError(s);
    applyGpsFix(s);
    log(`Correção de posição por GPS (automática): erro de ${before.toFixed(0)} m eliminado`, 'Navegação');
  }
}
