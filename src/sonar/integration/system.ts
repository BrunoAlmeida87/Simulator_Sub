import type { SimulationEngine } from '../../sim/core/engine';
import { bearingRange } from '../../sim/geo';
import { initialSonar, push, angleDiff, sumDb, gaussian, wrap, type SonarState } from '../types';
import { ambientNoise } from '../acoustics/environment';
import { ownNoise } from '../sources/signatures';
import { receivePassive, sourcePath } from '../sensors/passive';
import { associate } from '../contacts/tracker';
import { classify } from '../classification/classify';
import { spectrum, demon } from '../dsp/fft';
import { synthesize, SAMPLE_RATE } from '../dsp/synthesis';
import { observer, worldSources } from './world';
export const receivedAudio = (s: SonarState): Float32Array | undefined => (s.audioSamples?.length ? Float32Array.from(s.audioSamples) : undefined);
export function updateSonar(e: SimulationEngine): void {
  const s = (e.state.sonar ??= initialSonar()),
    t = e.state.t;
  if (!s.settings.enabled || !e.state.electrical.energized) {
    s.pending = [];
    return;
  }
  // Spread expensive per-source propagation over fixed steps (10 sources/second).
  // Cursor/cache are serialized so save/restore and command replay stay deterministic.
  if (t - s.lastPathCheck >= 0.1 - 1e-7) {
    s.lastPathCheck = t;
    const own = observer(e),
      sources = worldSources(e).filter((c) => bearingRange(own, c).rng <= 45000);
    if (sources.length) {
      sourcePath(e, own, sources[s.pathCursor % sources.length]);
      s.pathCursor = (s.pathCursor + 1) % sources.length;
    }
    const ids = new Set(sources.map((c) => c.id));
    for (const id of Object.keys(s.paths)) if (!ids.has(id)) delete s.paths[id];
  }
  // Echo timing uses every fixed step, independently of the 1 Hz passive cadence.
  const arrived = s.pending.filter((p) => p.due <= t);
  for (const p of arrived) associate(s, p.measurement);
  if (arrived.length) {
    s.pending = s.pending.filter((p) => p.due > t);
    s.version++;
  }
  if (t - s.lastSample < 1 - 1e-7) return;
  s.lastSample = t;
  s.noise.ambient = ambientNoise(e.env.cfg.waves?.seaState ?? 0, s.settings.shipping, s.settings.biological);
  s.noise.own = ownNoise(e.state);
  s.noise.total = sumDb(s.noise.ambient, s.noise.own);
  const own = observer(e),
    sources = worldSources(e);
  const rx = receivePassive(e, own, sources, s),
    used = new Set<string>();
  for (const m of rx.detections) associate(s, m, used);
  s.tracks = s.tracks.filter((c) => t - c.lastSeen < 180);
  const signal = synthesize(rx.signals, t, s.seed);
  s.audioSamples = Array.from(signal);
  const lofar = spectrum(signal, SAMPLE_RATE),
    dem = demon(signal, SAMPLE_RATE);
  // Bin-reduce only for history/display; classification retains measured FFT peaks.
  const reduce = (bins: number[], size: number) => Array.from({ length: size }, (_, i) => Math.max(...bins.slice((i * bins.length) / size, ((i + 1) * bins.length) / size)));
  const frame = { t, observer: own, broadband: rx.broadband, lofar: reduce(lofar.bins, 256), demon: dem.bins, beam: rx.beam, snr: rx.snr, peaks: lofar.peaks, modulation: dem.peaks };
  // Temporal integration in linear power; no integration across different beams.
  const alpha = 1 - Math.exp(-1 / s.settings.integration),
    prev = s.frame;
  if (prev)
    for (const key of ['broadband', 'lofar', 'demon'] as const) {
      if (key !== 'broadband' && Math.abs(angleDiff(frame.beam, prev.beam)) > 2) continue;
      frame[key] = frame[key].map((v, i) => 10 * Math.log10(alpha * 10 ** (v / 10) + (1 - alpha) * 10 ** ((prev[key][i] ?? v) / 10)));
    }
  // Display precision is 0.1 dB; bound serialized history size without reducing FFT resolution.
  for (const key of ['broadband', 'lofar', 'demon'] as const) frame[key] = frame[key].map((v) => Math.round(v * 10) / 10 || 0);
  s.frame = frame;
  push(s.history, frame);
  const track = s.tracks.find((c) => c.id === s.settings.selected);
  if (track && t - track.lastSeen < 5 && rx.snr > 4) {
    const cls = classify(lofar.peaks);
    track.peaks = lofar.peaks;
    track.modulation = dem.peaks;
    track.classification = cls.category;
    track.confidence = cls.confidence;
  }
  // Explicit educational source mode: existing fast vessels emit every 30 s.
  if (s.settings.intercept && Math.floor(t / 30) > Math.floor(s.lastIntercept / 30)) {
    for (const c of sources.filter((c) => c.kind === 'patrulha')) {
      const br = bearingRange(own, c),
        path = s.paths[c.id];
      if (!path) continue;
      const snr = 190 - path.loss - s.noise.total;
      if (snr > 6) s.pending.push({ due: t + path.time, measurement: { t: t + path.time, bearing: wrap(br.brg + gaussian(s)), sigma: 1, snr, observer: own, mode: 'intercept' } });
    }
    s.lastIntercept = t;
  }
  s.version++;
}
