import { describe, expect, it } from 'vitest';
import { layoutLabels, overlaps, type MeasuredLabel } from '../src/render3d/labelLayout';

const label = (id: string, extra: Partial<MeasuredLabel> = {}): MeasuredLabel => ({ id, text: id, x: 400, y: 300, width: 100, height: 24, visible: true, callout: true, ...extra });
const hull = { x0: 200, y0: 230, x1: 600, y1: 370 };

describe('Identificações fora do submarino', () => {
  it('separa tanques e grupos de ar com a mesma âncora, sem cobrir casco, controles ou outros textos', () => {
    const controls = { x0: 500, y0: 0, x1: 800, y1: 220 };
    const labels = [label('tank'), label('air1', { width: 280, height: 58 }), label('air2', { width: 280, height: 58 }), label('battery')];
    const placed = layoutLabels(labels, 800, 600, [controls], hull);
    expect(placed).toHaveLength(labels.length);
    for (const p of placed) {
      expect(overlaps(p.rect, hull)).toBe(false);
      expect(overlaps(p.rect, controls)).toBe(false);
      for (const other of placed) if (other.id !== p.id) expect(overlaps(p.rect, other.rect)).toBe(false);
    }
  });

  it('mantém textos longos inteiros dentro de uma tela estreita, mesmo junto às bordas', () => {
    const placed = layoutLabels([label('air', { width: 280, height: 70, x: 315, y: 200 })], 360, 480, [], { x0: 100, y0: 180, x1: 330, y1: 300 });
    expect(placed).toHaveLength(1);
    expect(placed[0].rect.x0).toBeGreaterThanOrEqual(8);
    expect(placed[0].rect.x1).toBeLessThanOrEqual(352);
    expect(placed[0].rect.y0).toBeGreaterThanOrEqual(8);
    expect(placed[0].rect.y1).toBeLessThanOrEqual(472);
  });

  it('usa as laterais quando a vista de frente ocupa toda a altura', () => {
    const tallHull = { x0: 300, y0: 0, x1: 500, y1: 600 };
    const placed = layoutLabels([label('air')], 800, 600, [], tallHull);
    expect(placed).toHaveLength(1);
    expect(overlaps(placed[0].rect, tallHull)).toBe(false);
  });

  it('preserva a prioridade das forças e omite o que não cabe, sem forçar sobreposição', () => {
    const placed = layoutLabels([label('secondary', { prio: 3, x: 80, y: 35 }), label('force', { callout: false, prio: 0, x: 80, y: 35 })], 160, 70);
    expect(placed.map((p) => p.id)).toEqual(['force']);
  });

  it('mantém G e B na posição física quando há espaço, sem afastá-los do modelo', () => {
    const placed = layoutLabels([label('G', { callout: false })], 800, 600, [], hull);
    expect(placed[0].x).toBe(400);
    expect(placed[0].y).toBe(300);
  });

  it('não desenha textos quando toda a área está ocupada ou o rótulo é maior que a tela', () => {
    expect(layoutLabels([label('air')], 800, 600, [{ x0: 0, y0: 0, x1: 800, y1: 600 }], hull)).toEqual([]);
    expect(layoutLabels([label('wide', { width: 900 })], 800, 600)).toEqual([]);
  });
});
