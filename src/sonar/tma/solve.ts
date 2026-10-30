import { angleDiff, type Measurement, type TmaMotion, wrap } from '../types';
export interface Solution {
  observable: boolean;
  reason: string;
  range?: number;
  course?: number;
  speed?: number;
  uncertainty?: number;
  residual?: number;
  motion?: TmaMotion;
}
/** Weighted bearing-only least squares: cross(LOS, target0 + velocity*t - own)=0.
 * Column-normalized normal matrix with pivot conditioning; own maneuver required. */
export function solveTma(history: Measurement[]): Solution {
  const rows = history.filter((m) => m.mode === 'passive');
  const no = (reason: string): Solution => ({ observable: false, reason });
  if (rows.length < 12 || rows[rows.length - 1].t - rows[0].t < 30) return no('Histórico insuficiente: ≥12 medições e ≥30 s.');
  const first = rows[0],
    last = rows[rows.length - 1],
    span = last.t - first.t;
  const dn = last.observer.n - first.observer.n,
    de = last.observer.e - first.observer.e;
  const maneuver = Math.max(...rows.map((m) => Math.hypot(m.observer.n - first.observer.n - (dn * (m.t - first.t)) / span, m.observer.e - first.observer.e - (de * (m.t - first.t)) / span)));
  if (maneuver < 40) return no('Ambiguidade de distância: manobre o observador para criar paralaxe.');
  const A = Array.from({ length: 4 }, () => [0, 0, 0, 0, 0]);
  for (const m of rows) {
    const a = (m.bearing * Math.PI) / 180,
      x = (m.t - first.t) / span,
      v = [-Math.sin(a), Math.cos(a), -x * Math.sin(a), x * Math.cos(a)];
    const b = v[0] * (m.observer.n - first.observer.n) + v[1] * (m.observer.e - first.observer.e),
      w = 1 / Math.max(0.2, m.sigma) ** 2;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) A[i][j] += w * v[i] * v[j];
      A[i][4] += w * v[i] * b;
    }
  }
  const scale = Array.from({ length: 4 }, (_, i) => Math.sqrt(A[i][i]));
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) A[i][j] /= scale[i] * scale[j];
    A[i][4] /= scale[i];
  }
  let smallest = 1;
  for (let i = 0; i < 4; i++) {
    let pivot = i;
    for (let k = i + 1; k < 4; k++) if (Math.abs(A[k][i]) > Math.abs(A[pivot][i])) pivot = k;
    [A[i], A[pivot]] = [A[pivot], A[i]];
    const p = A[i][i];
    smallest = Math.min(smallest, Math.abs(p));
    if (Math.abs(p) < 1e-5) return no('Geometria mal condicionada; solução não observável.');
    for (let j = i; j < 5; j++) A[i][j] /= p;
    for (let k = 0; k < 4; k++)
      if (k !== i) {
        const f = A[k][i];
        for (let j = i; j < 5; j++) A[k][j] -= f * A[i][j];
      }
  }
  const [n, e, vnSpan, veSpan] = A.map((r, i) => r[4] / scale[i]);
  const rn = n + vnSpan - dn,
    re = e + veSpan - de,
    range = Math.hypot(rn, re),
    speed = Math.hypot(vnSpan, veSpan) / span;
  const residual = Math.sqrt(
    rows.reduce((sum, m) => {
      const x = (m.t - first.t) / span;
      const predicted = wrap((Math.atan2(e + veSpan * x - (m.observer.e - first.observer.e), n + vnSpan * x - (m.observer.n - first.observer.n)) * 180) / Math.PI);
      return sum + angleDiff(predicted, m.bearing) ** 2;
    }, 0) / rows.length,
  );
  if (!Number.isFinite(range) || range > 100000 || speed > 25 || residual > 8) return no('Solução inconsistente; continue coletando medições.');
  const uncertainty = Math.max(range * 0.1, (range * Math.max(0.2, residual) * Math.PI) / 180 / Math.sqrt(smallest * rows.length));
  if (uncertainty > range * 0.75) return no('Incerteza de distância elevada; amplie a manobra.');
  return {
    observable: true,
    motion: { t: last.t, n: first.observer.n + n + vnSpan, e: first.observer.e + e + veSpan, vn: vnSpan / span, ve: veSpan / span },
    reason: 'Estimativa LS; velocidade constante, associação e erros correlacionados limitam a confiança.',
    range,
    course: wrap((Math.atan2(veSpan, vnSpan) * 180) / Math.PI),
    speed,
    uncertainty,
    residual,
  };
}
