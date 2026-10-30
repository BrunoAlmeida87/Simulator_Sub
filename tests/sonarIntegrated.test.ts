import { describe, it, expect } from 'vitest';
import { Environment, defaultEnvironment } from '../src/sim/environment/environment';
import { soundSpeed, speedAt, absorption } from '../src/sonar/acoustics/environment';
import { pathEstimate, traceRay, propagation } from '../src/sonar/acoustics/propagation';
import { spectrum, demon } from '../src/sonar/dsp/fft';
import { synthesize, audioResample, SAMPLE_RATE } from '../src/sonar/dsp/synthesis';
import { LIBRARY, ownNoise } from '../src/sonar/sources/signatures';
import { angleDiff, initialSonar, push, ring, values, type Measurement, type Observer } from '../src/sonar/types';
import { solveTma } from '../src/sonar/tma/solve';
import { associate } from '../src/sonar/contacts/tracker';
import { buildScenario } from '../src/sim/scenarios';
import { SimRunner } from '../src/sim/core/runner';
import { applyCommand } from '../src/sim/commands';
import { updateSonar } from '../src/sonar/integration/system';
import { emitPing } from '../src/sonar/sensors/active';
import { worldSources, observer } from '../src/sonar/integration/world';
import { serializeEngine, deserializeEngine } from '../src/sim/persistence';
import { applySonarDelta, sonarDelta } from '../src/sonar/integration/sync';
const own: Observer = { n: 0, e: 0, depth: 50, heading: 0, vn: 0, ve: 0 };
function flat() {
  const cfg = defaultEnvironment();
  cfg.geo = { ...cfg.geo!, coast: false };
  cfg.bottom.mode = 'uniforme';
  cfg.bottom.baseDepth = 500;
  return new Environment(cfg);
}
function engine() {
  const e = buildScenario('pairando');
  e.env.cfg.geo!.coast = false;
  e.env.cfg.bottom.mode = 'uniforme';
  e.env.cfg.bottom.baseDepth = 500;
  const c = worldSources(e)[0];
  e.state.body.pos = { x: c.n - 700, y: c.e, z: 40 };
  e.computeOutputs();
  return e;
}

describe('acústica integrada', () => {
  it('velocidade, pressão e absorção têm tendências físicas coerentes', () => {
    expect(soundSpeed(10, 35, 0)).toBeCloseTo(1489.8034, 3);
    expect(soundSpeed(20, 35, 0)).toBeGreaterThan(soundSpeed(10, 35, 0));
    expect(soundSpeed(10, 35, 1000)).toBeGreaterThan(soundSpeed(10, 35, 0));
    expect(absorption(10000)).toBeGreaterThan(absorption(1000));
    expect(speedAt(flat(), 200, true)).toBe(1500);
  });
  it('raio homogêneo horizontal mantém profundidade e tempo r/c', () => {
    const r = traceRay(flat(), own, 0, 0, 1500, 1000, true),
      end = r.points.at(-1)!;
    expect(end.r).toBe(1500);
    expect(end.z).toBe(50);
    expect(end.t).toBeCloseTo(1, 2);
    expect(end.loss).toBeGreaterThan(63);
  });
  it('refração real, reflexão de superfície e fundo sem atravessar o relevo', () => {
    const env = flat();
    const refracted = traceRay(env, { ...own, depth: 80 }, 0, 0, 1000);
    expect(refracted.points[10].z).toBeGreaterThan(80);
    const ray = traceRay(env, own, 0, 0.7, 4000, 1000, true);
    expect(ray.points.some((p) => p.event === 'bottom')).toBe(true);
    expect(ray.points.some((p) => p.event === 'surface')).toBe(true);
    expect(ray.points.every((p) => p.z >= 0 && p.z <= 500)).toBe(true);
  });
  it('trajeto interrompido por terra não vira percurso curto de baixa perda', () => {
    const env = flat();
    env.bottomDepthAt = (n) => (n > 50 ? -10 : 500);
    expect(pathEstimate(env, own, 0, 1000, 3, true).loss).toBeGreaterThan(150);
  });
  it('a qualidade visual não altera o cálculo de detecção', () => {
    const e = engine(),
      before = pathEstimate(e.env, observer(e), 0, 700, 3);
    propagation(e.env, observer(e), 0, 1000, 8);
    propagation(e.env, observer(e), 0, 1000, 128);
    expect(pathEstimate(e.env, observer(e), 0, 700, 3)).toEqual(before);
  });
  it('FFT recupera o tom de um sinal amostrado e DEMON a modulação do portador', () => {
    const input = Float32Array.from({ length: 4096 }, (_, i) => Math.sin((2 * Math.PI * 128 * i) / 2048));
    const fft = spectrum(input, 2048);
    expect(fft.peaks[0]).toBe(128);
    expect(fft.bins[256]).toBeCloseTo(0, 2);
    const sig = { ...LIBRARY.mercante, shaftHz: 2, blades: 5, tones: [] };
    const x = synthesize([{ signature: sig, amplitude: 0.5, doppler: 1 }], 0, 17);
    expect(demon(x, SAMPLE_RATE).peaks.some((f) => Math.abs(f - 10) < 0.6)).toBe(true);
  });
  it('áudio reamostrado mantém duração e frequência e é aceito pela Web Audio', () => {
    const x = Float32Array.from({ length: 4096 }, (_, i) => Math.sin((2 * Math.PI * 128 * i) / SAMPLE_RATE));
    const pcm = audioResample(x);
    expect(pcm.length / (SAMPLE_RATE * 4)).toBe(x.length / SAMPLE_RATE);
    expect(SAMPLE_RATE * 4).toBeGreaterThanOrEqual(8000);
    expect(spectrum(pcm, SAMPLE_RATE * 4).peaks[0]).toBe(128);
  });
  it('ruído próprio cresce gradualmente com velocidade, diesel e bombas', () => {
    const e = engine(),
      s = e.state;
    s.body.vel = { x: 0, y: 0, z: 0 };
    s.propulsion.omega = 0;
    const low = ownNoise(s);
    s.body.vel.x = 3;
    const medium = ownNoise(s);
    s.body.vel.x = 6;
    const high = ownNoise(s);
    expect(medium).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(medium);
    Object.values(s.electrical.generators)[0].status = 'EM CARGA';
    expect(ownNoise(s)).toBeGreaterThan(high);
  });
  it('cascata acompanha a pausa e passo único; não depende da aba', () => {
    const r = new SimRunner(engine());
    r.frame(1);
    expect(r.engine.state.sonar!.history.size).toBe(0);
    r.stepOnce(50);
    expect(r.engine.state.sonar!.history.size).toBe(1);
    r.frame(1);
    expect(r.engine.state.sonar!.history.size).toBe(1);
    expect(r.engine.state.sonar!.tracks.length).toBeGreaterThan(0);
    for (const t of r.engine.state.sonar!.tracks) {
      expect(t.id).toMatch(/^S\d+$/);
      expect(t.range).toBeUndefined();
      expect(t).not.toHaveProperty('name');
      expect(t).not.toHaveProperty('n');
      expect(t).not.toHaveProperty('sourceId');
    }
  });
  it('associa usando apenas marcação medida, inclusive no cruzamento 359°/0°', () => {
    const s = initialSonar(),
      m: Measurement = { t: 1, bearing: 359, sigma: 1, snr: 10, observer: own, mode: 'passive' };
    const id = associate(s, m).id;
    expect(associate(s, { ...m, t: 2, bearing: 1 }).id).toBe(id);
    expect(angleDiff(1, 359)).toBe(2);
  });
  it('eco só produz distância após a chegada e o replay não muda a física', () => {
    const e = engine();
    expect(emitPing(e)).toBe(true);
    const s = e.state.sonar!;
    expect(s.pending.length).toBeGreaterThan(0);
    expect(s.tracks.length).toBe(0);
    const due = Math.min(...s.pending.map((p) => p.due));
    e.state.t = due - 0.001;
    updateSonar(e);
    expect(s.tracks.some((c) => c.range !== undefined)).toBe(false);
    e.state.t = due + 0.001;
    updateSonar(e);
    expect(s.tracks.some((c) => c.range !== undefined)).toBe(true);
    const snap = JSON.stringify(e.state.body);
    const p = s.ping!;
    p.propagation.rays.forEach((r) => r.points.filter((q) => q.t < 1));
    expect(JSON.stringify(e.state.body)).toBe(snap);
    expect(s.tracks.find((c) => c.range !== undefined)!.range).toBeGreaterThan(500);
  });
  it('salvamento JSON preserva histórico, semente e ecos pendentes; saves antigos migram', () => {
    const e = engine();
    e.state.t = 1;
    updateSonar(e);
    emitPing(e);
    const saved = JSON.parse(JSON.stringify(serializeEngine(e, 'sonar'))),
      loaded = deserializeEngine(saved);
    expect(loaded.state.sonar).toEqual(e.state.sonar);
    delete saved.state.sonar;
    expect(deserializeEngine(saved).state.sonar?.history.size).toBe(0);
  });
  it('histórico circular e transporte incremental são limitados, sem ecos futuros', () => {
    const r = ring<number>(3);
    for (let i = 0; i < 9; i++) push(r, i);
    expect(values(r)).toEqual([6, 7, 8]);
    expect(r.data.length).toBe(3);
    const e = engine();
    e.state.t = 1;
    updateSonar(e);
    const s = e.state.sonar!;
    const d = sonarDelta(s, -1, null);
    expect(d.state).not.toHaveProperty('pending');
    expect(d.state).not.toHaveProperty('history');
    let target = applySonarDelta(initialSonar(), d);
    target = applySonarDelta(target, d);
    expect(target.history.size).toBe(1);
  });
  it('aquisição não consome o RNG da física nem altera a pose', () => {
    const e = engine();
    e.state.t = 1;
    const body = structuredClone(e.state.body),
      seed = e.state.rng.seed;
    updateSonar(e);
    expect(e.state.body).toEqual(body);
    expect(e.state.rng.seed).toBe(seed);
  });
  it('comandos têm validação numérica e são registrados', () => {
    const e = engine();
    applyCommand(e, { type: 'sonar', action: 'settings', patch: { rayCount: 9999, range: NaN, coverage: 5 } });
    expect(e.state.sonar!.settings.rayCount).toBe(512);
    expect(e.state.sonar!.settings.range).toBe(6000);
    expect(e.state.sonar!.settings.coverage).toBe(30);
    expect(e.state.commands.at(-1)?.group).toBe('Sonar');
  });
});

describe('TMA apenas por marcações', () => {
  const history = (maneuver: boolean): Measurement[] =>
    Array.from({ length: 121 }, (_, i) => {
      const t = i * 2,
        n = t <= 120 ? t * 3 : 360,
        east = t > 120 && maneuver ? (t - 120) * 4 : 0;
      const o = { ...own, n: maneuver ? n : t * 3, e: east };
      const tn = 3000 + t * 2,
        te = 2000 - t;
      return { t, bearing: ((Math.atan2(te - o.e, tn - o.n) * 180) / Math.PI + 360) % 360, sigma: 0.4, snr: 20, observer: o, mode: 'passive' };
    });
  it('não inventa distância com uma medição ou observador em movimento retilíneo', () => {
    expect(solveTma(history(false).slice(0, 1)).observable).toBe(false);
    expect(solveTma(history(false)).observable).toBe(false);
  });
  it('recupera movimento constante após manobra observável', () => {
    const h = history(true),
      sol = solveTma(h);
    expect(sol.observable, sol.reason).toBe(true);
    expect(sol.speed).toBeCloseTo(Math.sqrt(5), 2);
    const o = h.at(-1)!.observer;
    expect(sol.range).toBeCloseTo(Math.hypot(3480 - o.n, 1760 - o.e), 0);
    expect(sol.uncertainty).toBeGreaterThan(0);
  });
});

describe('limites e operação do sonar', () => {
  it('reduz a memória preservando as amostras recentes e replica o limite na segunda janela', () => {
    const e = engine();
    for (let t = 1; t <= 45; t++) {
      e.state.t = t;
      updateSonar(e);
    }
    const mirror = structuredClone(e.state.sonar!);
    applyCommand(e, { type: 'sonar', action: 'settings', patch: { historySeconds: 30 } });
    expect(e.state.sonar!.history.size).toBe(30);
    expect(values(e.state.sonar!.history)[0].t).toBe(16);
    const result = applySonarDelta(mirror, sonarDelta(e.state.sonar!, 45, null));
    expect(result.history.capacity).toBe(30);
    expect(values(result.history).map((f) => f.t)).toEqual(values(e.state.sonar!.history).map((f) => f.t));
  });
  it('não emite sem energia e não publica um eco ainda pendente', () => {
    const e = engine();
    e.state.electrical.energized = false;
    expect(emitPing(e)).toBe(false);
    e.state.electrical.energized = true;
    emitPing(e);
    const s = e.state.sonar!;
    const delta = sonarDelta(s, -1, null);
    expect(delta.state).not.toHaveProperty('pending');
    expect(delta.state).not.toHaveProperty('paths');
    expect(delta.tracks).toHaveLength(0);
    expect(delta.ping?.echoPaths.length).toBeGreaterThan(0); // separate diagnostic snapshot
  });
  it('mantém o histórico de trilhas sem duplicar medições reenviadas', () => {
    const e = engine();
    e.state.t = 1;
    updateSonar(e);
    const s = e.state.sonar!;
    const first = sonarDelta(s, -1, null);
    let remote = applySonarDelta(initialSonar(), first);
    const sizes = remote.tracks.map((t) => t.history.size);
    remote = applySonarDelta(remote, first);
    expect(remote.tracks.map((t) => t.history.size)).toEqual(sizes);
  });
});

describe('configuração científica de fontes', () => {
  it('aplica uma assinatura individual sem alterar rotas nem nomes operacionais', () => {
    const e = engine(),
      source = worldSources(e)[0],
      before = structuredClone(e.state.body);
    applyCommand(e, { type: 'sonar', action: 'source', id: source.id, patch: { level: 180, shaftHz: 3.5, blades: 4, tones: [100, 200, 2000] } });
    expect(e.state.sonar!.settings.sourceOverrides[source.id]).toEqual({ level: 180, shaftHz: 3.5, blades: 4, tones: [100, 200] });
    expect(worldSources(e)[0]).toEqual(source);
    expect(e.state.body).toEqual(before);
    applyCommand(e, { type: 'sonar', action: 'source', id: source.id, patch: null });
    expect(e.state.sonar!.settings.sourceOverrides[source.id]).toBeUndefined();
  });
});
