import { KNOT, toKnots } from '../sim/units';

export const fmt = (x: number, d = 1): string => {
  if (!Number.isFinite(x)) return '—';
  const s = x.toFixed(d);
  return /^-0[.,]?0*$/.test(s) ? s.slice(1) : s;
};
export const fmtS = (x: number, d = 1): string => (Number.isFinite(x) ? (x > 0 ? '+' : '') + x.toFixed(d) : '—');
export const fmtInt = (x: number): string => (Number.isFinite(x) ? Math.round(x).toLocaleString('pt-BR') : '—');
export function fmtTime(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
export function fmtMass(kg: number): string {
  if (!Number.isFinite(kg)) return '—';
  const a = Math.abs(kg);
  if (a >= 10000) return (kg / 1000).toFixed(1) + ' t';
  if (a >= 1000) return (kg / 1000).toFixed(2) + ' t';
  return kg.toFixed(0) + ' kg';
}
export function fmtPower(w: number): string {
  if (!Number.isFinite(w)) return '—';
  const a = Math.abs(w);
  if (a >= 1e6) return (w / 1e6).toFixed(2) + ' MW';
  if (a >= 1e3) return (w / 1e3).toFixed(1) + ' kW';
  return w.toFixed(0) + ' W';
}
export function fmtForce(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(2) + ' MN';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + ' kN';
  return n.toFixed(0) + ' N';
}
export function fmtMoment(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(2) + ' MN·m';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + ' kN·m';
  return n.toFixed(0) + ' N·m';
}

/** Velocidade em m/s apresentada nas duas unidades náuticas e rodoviárias. */
export const fmtSpeed = (ms: number, digits = 1): string =>
  `${fmt(toKnots(ms), digits)} nós (${fmt(ms * 3.6, Math.max(1, digits))} km/h)`;

/** Valor já expresso em nós (sensores, métricas e histórico). */
export const fmtKnots = (knots: number, digits = 1): string => fmtSpeed(knots * KNOT, digits);
