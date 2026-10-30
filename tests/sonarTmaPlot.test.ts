import { describe, it, expect } from 'vitest';
import { estimateMotion, positionAt, predictedBearing, seedHypothesis, unwrapBearings } from '../src/sonar/tma/plotModel';
import { solveTma } from '../src/sonar/tma/solve';
import { wrap, values, initialSonar, type Measurement, type Observer, type TmaMotion } from '../src/sonar/types';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { sonarDelta, applySonarDelta } from '../src/sonar/integration/sync';
import { serializeEngine, deserializeEngine } from '../src/sim/persistence';
const own: Observer = { n: 500, e: -200, depth: 80, heading: 0, vn: 3, ve: 0 };
const target: TmaMotion = { t: 0, n: 3500, e: 1800, vn: 2, ve: -1 };
function observation(t: number, active = false): Measurement {
  const observer = { ...own, n: own.n + Math.min(t, 120) * 3, e: own.e + Math.max(0, t - 120) * 4 },
    p = positionAt(target, t);
  return {
    t,
    observer,
    bearing: wrap((Math.atan2(p.e - observer.e, p.n - observer.n) * 180) / Math.PI),
    sigma: 0.4,
    snr: 20,
    mode: active ? 'active' : 'passive',
    ...(active ? { range: Math.hypot(p.n - observer.n, p.e - observer.e), rangeSigma: 25 } : {}),
  };
}
describe('TMA gráfico baseado em medições', () => {
  it('projeta a solução passiva na posição correta e reproduz marcações após a manobra', () => {
    const rows = Array.from({ length: 121 }, (_, i) => observation(i * 2));
    const solved = solveTma(rows),
      estimated = estimateMotion(rows);
    expect(estimated.kind).toBe('passive');
    expect(solved.motion).toBeDefined();
    expect(positionAt(estimated.motion!, 300).n).toBeCloseTo(4100, 3);
    expect(positionAt(estimated.motion!, 300).e).toBeCloseTo(1500, 3);
    for (const row of rows) expect(predictedBearing(estimated.motion!, row)).toBeCloseTo(row.bearing, 4);
  });
  it('um único eco localiza a observação, mas não inventa um vetor de velocidade', () => {
    const rows = [observation(20, true)];
    expect(estimateMotion(rows).motion).toBeUndefined();
    const seed = seedHypothesis(rows)!;
    expect(seed.n).toBeCloseTo(3540, 6);
    expect(seed.e).toBeCloseTo(1780, 6);
    expect(seed.vn).toBe(0);
    expect(estimateMotion([observation(0)]).motion).toBeUndefined();
  });
  it('estima movimento com ecos espaçados, descartando retornos multipercurso do mesmo ping', () => {
    const rows = [observation(10, true), { ...observation(10.2, true), range: 8000 }, observation(40, true), observation(70, true)];
    // Multipath still contributes a bearing but is not an independent range fix.
    const estimated = estimateMotion(rows);
    expect(estimated.kind).toBe('active');
    expect(estimated.motion!.vn).toBeCloseTo(2, 6);
    expect(estimated.motion!.ve).toBeCloseTo(-1, 6);
    expect(positionAt(estimated.motion!, 90).e).toBeCloseTo(1710, 6);
    expect(estimated.uncertainty).toBeGreaterThan(0);
  });
  it('mantém continuidade no gráfico ao cruzar o norte e distingue hipótese manual de solução', () => {
    const rows = [358, 359, 0, 1, 359].map((bearing, t) => ({ ...observation(t), bearing }));
    expect(unwrapBearings(rows)).toEqual([358, 359, 360, 361, 359]);
    const plot = estimateMotion(rows, target);
    expect(plot.kind).toBe('manual');
    expect(plot.residual).toBeGreaterThan(10);
    expect(plot.uncertainty).toBe(0); // no confidence ellipse fabricated for a user guess
  });
  it('registra, replica, restaura e remove a hipótese sem mudar a pose do submarino', () => {
    const e = buildScenario('pairando');
    applyCommand(e, { type: 'sonar', action: 'mark', bearing: 62 });
    const s = e.state.sonar!,
      track = s.tracks[0],
      body = structuredClone(e.state.body);
    const motion = { ...target, t: e.state.t, n: e.state.body.pos.x + 2000, e: e.state.body.pos.y + 500 };
    applyCommand(e, { type: 'sonar', action: 'tma', id: track.id, motion });
    expect(track.tma).toEqual(motion);
    expect(e.state.body).toEqual(body);
    expect(e.state.commands.at(-1)?.text).toContain('TMA');
    const mirrored = applySonarDelta(initialSonar(), sonarDelta(s, -1, null));
    expect(mirrored.tracks[0].tma).toEqual(motion);
    expect(values(mirrored.tracks[0].history)).toEqual(values(track.history));
    expect(deserializeEngine(JSON.parse(JSON.stringify(serializeEngine(e, 'TMA')))).state.sonar!.tracks[0].tma).toEqual(motion);
    applyCommand(e, { type: 'sonar', action: 'tma', id: track.id, motion: { ...motion, vn: NaN } });
    expect(track.tma).toEqual(motion);
    applyCommand(e, { type: 'sonar', action: 'tma', id: track.id, motion: null });
    expect(track.tma).toBeUndefined();
  });
});
