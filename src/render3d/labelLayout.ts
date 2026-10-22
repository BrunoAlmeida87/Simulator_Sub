/** Posicionamento em pixels: rótulos fora do casco, dos controles e uns dos outros. */
import type { Label3D } from './SubmarineScene';

export interface LabelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface MeasuredLabel extends Label3D {
  width: number;
  height: number;
}
export interface PlacedLabel {
  id: string;
  x: number;
  y: number;
  rect: LabelRect;
}

export const overlaps = (a: LabelRect, b: LabelRect): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function layoutLabels(labels: MeasuredLabel[], width: number, height: number, obstacles: LabelRect[] = [], hull: LabelRect | null = null): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const margin = 8;
  const gap = 8;
  for (const l of [...labels].sort((a, b) => (a.prio ?? 1) - (b.prio ?? 1))) {
    const w = l.width + gap;
    const h = l.height + gap;
    if (w > width - margin * 2 || h > height - margin * 2) continue;
    const x = clamp(l.x, margin + w / 2, width - margin - w / 2);
    const blocked = l.callout && hull ? [...obstacles, hull] : obstacles;
    const candidates: { x: number; y: number }[] = [];
    if (l.callout) {
      const top = (hull?.y0 ?? l.y) - gap - h / 2;
      const bottom = (hull?.y1 ?? l.y) + gap + h / 2;
      const above = l.y <= (hull ? (hull.y0 + hull.y1) / 2 : l.y);
      // Deslocamentos em ambos os eixos mantêm visíveis os grupos de garrafas
      // mesmo quando suas âncoras se projetam no mesmo ponto.
      for (let row = 0; row < Math.ceil(height / h); row++) {
        for (const y of above ? [top - row * h, bottom + row * h] : [bottom + row * h, top - row * h]) {
          for (const dx of [0, -w, w, -w * 2, w * 2]) candidates.push({ x: clamp(x + dx, margin + w / 2, width - margin - w / 2), y });
        }
      }
      // Nas vistas de frente/topo, o espaço livre pode estar nas laterais.
      if (hull)
        for (const xx of [hull.x0 - gap - w / 2, hull.x1 + gap + w / 2]) {
          for (let row = 0; row < Math.ceil(height / h); row++) for (const sign of [-1, 1]) candidates.push({ x: xx, y: l.y + sign * row * h });
        }
    } else {
      for (let row = 0; row < 13; row++) {
        const dy = row ? Math.ceil(row / 2) * h * (row % 2 ? -1 : 1) : 0;
        for (const dx of [0, -w, w]) candidates.push({ x: clamp(x + dx, margin + w / 2, width - margin - w / 2), y: l.y + dy });
      }
    }
    for (const c of candidates) {
      const rect = { x0: c.x - w / 2, x1: c.x + w / 2, y0: c.y - h / 2, y1: c.y + h / 2 };
      if (rect.x0 < margin || rect.y0 < margin || rect.x1 > width - margin || rect.y1 > height - margin) continue;
      if (blocked.some((r) => overlaps(rect, r)) || placed.some((p) => overlaps(rect, p.rect))) continue;
      placed.push({ id: l.id, ...c, rect });
      break;
    }
  }
  return placed;
}
