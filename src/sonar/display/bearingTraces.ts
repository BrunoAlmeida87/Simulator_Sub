import { angleDiff, wrap, type Measurement } from '../types';
const COLORS = ['#ff7865', '#57e6ee', '#bd8bff', '#e8ec62', '#f373cd', '#79e5ac', '#ffbb69', '#88baff'];
/** Stable by anonymous track ID, independent of list sorting or selected contact. */
export function trackColor(id: string): string {
  const serial = /^S(\d+)$/.exec(id);
  const index = serial ? Math.max(0, Number(serial[1]) - 1) : [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
  return COLORS[index] ?? `hsl(${(index * 137.508) % 360} 80% 72%)`;
}
export const bearingX = (bearing: number, center: number): number => wrap(bearing - center + 180) / 360;
export interface TracePoint {
  x: number;
  y: number;
}
export interface BearingTrace {
  segments: TracePoint[][];
  observations: { point: TracePoint; measurement: Measurement }[];
}
/** Screen-only circular averaging; original measurements remain unchanged.
 * Split angular seams and acquisition gaps rather than draw fictitious diagonals. */
export function bearingTrace(rows: Measurement[], now: number, seconds: number, center = 0, smooth = true): BearingTrace {
  const segments: TracePoint[][] = [],
    observations: BearingTrace['observations'] = [];
  let current: TracePoint[] = [],
    recent: Measurement[] = [],
    previous: Measurement | undefined;
  for (const m of rows) {
    if (m.t > now || m.t < now - seconds) continue;
    if (previous && (m.t - previous.t > 10 || m.t < previous.t)) {
      current = [];
      recent = [];
    }
    recent = [...recent.filter((p) => m.t - p.t <= 5), m].slice(-5);
    const bearing = smooth ? wrap(m.bearing + recent.reduce((sum, p) => sum + angleDiff(p.bearing, m.bearing), 0) / recent.length) : m.bearing;
    const point = { x: bearingX(bearing, center), y: (now - m.t) / seconds },
      last = current.at(-1);
    if (last && Math.abs(point.x - last.x) > 0.5) {
      const forward = point.x < last.x,
        edge = forward ? 1 : 0;
      const unwrapped = point.x + (forward ? 1 : -1),
        f = (edge - last.x) / (unwrapped - last.x);
      const y = last.y + (point.y - last.y) * f;
      current.push({ x: edge, y });
      current = [{ x: 1 - edge, y }];
      segments.push(current);
    }
    if (!current.length) segments.push(current);
    current.push(point);
    observations.push({ point, measurement: m });
    previous = m;
  }
  return { segments, observations };
}
