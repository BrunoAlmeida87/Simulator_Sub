/** Plotting operates on received measurements only; no engine/world access. */
import { angleDiff, wrap, type Measurement, type TmaMotion } from '../types';
import { solveTma } from './solve';
export const positionAt = (m: TmaMotion, t: number) => ({ n: m.n + m.vn * (t - m.t), e: m.e + m.ve * (t - m.t) });
export const measuredPosition = (m: Measurement) => ({ n: m.observer.n + Math.cos((m.bearing * Math.PI) / 180) * m.range!, e: m.observer.e + Math.sin((m.bearing * Math.PI) / 180) * m.range! });
export function predictedBearing(motion: TmaMotion, m: Measurement): number {
  const p = positionAt(motion, m.t);
  return wrap((Math.atan2(p.e - m.observer.e, p.n - m.observer.n) * 180) / Math.PI);
}
export function bearingResidual(motion: TmaMotion, rows: Measurement[]): number {
  return rows.length ? Math.sqrt(rows.reduce((sum, m) => sum + angleDiff(predictedBearing(motion, m), m.bearing) ** 2, 0) / rows.length) : 0;
}
export interface PlotEstimate {
  motion?: TmaMotion;
  kind: 'manual' | 'passive' | 'active' | 'none';
  uncertainty: number;
  residual?: number;
  reason: string;
}
export function estimateMotion(rows: Measurement[], manual?: TmaMotion): PlotEstimate {
  if (manual) return { motion: manual, kind: 'manual', uncertainty: 0, residual: bearingResidual(manual, rows), reason: 'Hipótese do operador · ajuste o alvo e o vetor no gráfico.' };
  const passive = solveTma(rows);
  if (passive.observable && passive.motion) return { motion: passive.motion, kind: 'passive', uncertainty: passive.uncertainty!, residual: passive.residual, reason: 'Solução por marcações e manobra do próprio navio.' };
  // Collapse multipath returns from the same ping, using the first arrived range.
  const active: Measurement[] = [];
  for (const m of rows) if (m.mode === 'active' && m.range !== undefined && m.t - (active.at(-1)?.t ?? -Infinity) > 3) active.push(m);
  if (active.length < 2 || active.at(-1)!.t - active[0].t < 10) return { kind: 'none', uncertainty: 0, reason: active.length ? 'Eco localizado. Emita outro ping após 10 s para estimar o movimento.' : passive.reason };
  const t = active.at(-1)!.t;
  let sw = 0,
    st = 0,
    stt = 0,
    sn = 0,
    se = 0,
    stn = 0,
    ste = 0;
  for (const m of active) {
    const p = measuredPosition(m),
      dt = m.t - t;
    const sigma = Math.hypot(m.rangeSigma ?? 50, (m.range! * m.sigma * Math.PI) / 180),
      w = 1 / Math.max(10, sigma) ** 2;
    sw += w;
    st += w * dt;
    stt += w * dt * dt;
    sn += w * p.n;
    se += w * p.e;
    stn += w * dt * p.n;
    ste += w * dt * p.e;
  }
  const det = sw * stt - st * st;
  if (det <= 1e-15) return { kind: 'none', uncertainty: 0, reason: 'Ecos muito próximos no tempo; aguarde outra emissão.' };
  const motion = { t, n: (sn * stt - stn * st) / det, e: (se * stt - ste * st) / det, vn: (sw * stn - st * sn) / det, ve: (sw * ste - st * se) / det };
  const residual = bearingResidual(motion, rows);
  if (Math.hypot(motion.vn, motion.ve) > 25 || residual > 8) return { kind: 'none', uncertainty: 0, reason: 'Ecos e marcações inconsistentes. Colete novas observações.' };
  const last = active.at(-1)!;
  return { motion, kind: 'active', residual, uncertainty: Math.max(50, last.rangeSigma ?? 50, (last.range! * last.sigma * Math.PI) / 180), reason: 'Movimento estimado por ecos recebidos · incerteza indicativa.' };
}
/** Unwrap around 0° so north crossings remain continuous in the history plot. */
export function unwrapBearings(rows: Measurement[]): number[] {
  return rows.reduce<number[]>((out, m, i) => {
    out.push(i ? out[i - 1] + angleDiff(m.bearing, rows[i - 1].bearing) : m.bearing);
    return out;
  }, []);
}
export function seedHypothesis(rows: Measurement[], range = 2500): TmaMotion | undefined {
  const last = rows.at(-1);
  if (!last) return;
  const p = measuredPosition({ ...last, range: last.range ?? range });
  return { ...p, t: last.t, vn: 0, ve: 0 };
}
export const timeLabel = (t: number) =>
  `${Math.floor(t / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(t % 60)
    .toString()
    .padStart(2, '0')}`;
