import { describe, expect, it } from 'vitest';
import { bearingTrace, bearingX, trackColor } from '../src/sonar/display/bearingTraces';
import type { Measurement } from '../src/sonar/types';
const row = (t: number, bearing: number): Measurement => ({ t, bearing, sigma: 1, snr: 15, mode: 'passive', observer: { n: 0, e: 0, vn: 0, ve: 0, depth: 50, heading: 0 } });
describe('histórico multitrilha de marcações', () => {
  it('coloca o norte no centro e mantém 359°/0° contínuos nesse eixo', () => {
    expect(bearingX(0, 0)).toBe(0.5);
    expect(bearingX(180, 0)).toBe(0);
    const p = bearingTrace([row(0, 359), row(1, 0), row(2, 1)], 2, 30, 0, false);
    expect(p.segments).toHaveLength(1);
    expect(p.observations[2].point.y).toBe(0);
    expect(p.observations[0].point.y).toBeCloseTo(2 / 30);
  });
  it('divide a passagem pelo corte de 180° nas duas bordas, interpolando o mesmo instante', () => {
    for (const pair of [
      [179, 181],
      [181, 179],
    ]) {
      const p = bearingTrace(
        pair.map((b, i) => row(i, b)),
        1,
        30,
        0,
        false,
      );
      expect(p.segments).toHaveLength(2);
      expect(p.segments[0].at(-1)!.y).toBeCloseTo(p.segments[1][0].y);
      expect(p.segments[0].at(-1)!.x + p.segments[1][0].x).toBe(1);
      for (const segment of p.segments) for (let i = 1; i < segment.length; i++) expect(Math.abs(segment[i].x - segment[i - 1].x)).toBeLessThan(0.02);
    }
    expect(bearingTrace([row(0, 359), row(1, 1)], 1, 30, 180, false).segments).toHaveLength(2);
  });
  it('interrompe perda de contato e exclui medidas antigas ou futuras', () => {
    const p = bearingTrace([row(0, 20), row(20, 22), row(21, 23), row(45, 24), row(46, 25), row(70, 30)], 50, 35);
    expect(p.observations.map((o) => o.measurement.t)).toEqual([20, 21, 45, 46]);
    expect(p.segments).toHaveLength(2);
    expect(bearingTrace([], 50, 30).segments).toEqual([]);
  });
  it('suaviza circularmente só o desenho, preservando medidas e seleção originais', () => {
    const rows = [row(0, 359), row(1, 1)],
      original = structuredClone(rows);
    const smooth = bearingTrace(rows, 1, 30, 0, true),
      raw = bearingTrace(rows, 1, 30, 0, false);
    expect(smooth.observations[1].point.x).toBeCloseTo(0.5);
    expect(raw.observations[1].point.x).toBeCloseTo(181 / 360);
    expect(smooth.observations[1].measurement).toBe(rows[1]);
    expect(rows).toEqual(original);
  });
  it('mantém uma cor estável por ID, inclusive com 48 contatos e mudança de ordem', () => {
    const ids = Array.from({ length: 48 }, (_, i) => `S${String(i + 1).padStart(3, '0')}`);
    const colors = new Map(ids.map((id) => [id, trackColor(id)]));
    expect(new Set(colors.values()).size).toBe(48);
    expect(ids.reverse().every((id) => trackColor(id) === colors.get(id))).toBe(true);
  });
});
