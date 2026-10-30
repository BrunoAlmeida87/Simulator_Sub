import type { SimulationEngine } from '../../sim/core/engine';
import { bearingRange, type Contact } from '../../sim/geo';
import { angleDiff, clamp, gaussian, random, wrap, type Observer, type SonarState, type Measurement, type CachedPath } from '../types';
import { pathEstimate } from '../acoustics/propagation';
import { signature } from '../sources/signatures';
import type { SignalSource } from '../dsp/synthesis';
export function sourcePath(e: SimulationEngine, own: Observer, c: Contact): CachedPath {
  const paths = e.state.sonar!.paths;
  const br = bearingRange(own, c),
    setting = e.state.sonar!.settings;
  const key = JSON.stringify([e.env.cfg, setting.homogeneous, Math.round(own.depth / 10), Math.round(own.n / 200), Math.round(own.e / 200)]);
  let p = paths[c.id];
  if (!p || e.state.t - p.at >= 5 || e.state.t < p.at || p.key !== key) {
    const path = pathEstimate(e.env, own, br.brg, br.rng, 3, setting.homogeneous);
    p = { loss: path.loss, time: path.time, coverage: path.coverage, at: e.state.t, key };
    paths[c.id] = p;
  }
  return p;
}
export function receivePassive(e: SimulationEngine, own: Observer, sources: Contact[], s: SonarState): { broadband: number[]; detections: Measurement[]; signals: SignalSource[]; beam: number; snr: number } {
  const bins = 180,
    energy = new Float64Array(bins);
  const selected = s.tracks.find((c) => c.id === s.settings.selected && e.state.t - c.lastSeen < 45);
  const beam = selected?.bearing ?? s.settings.beam;
  const signals: SignalSource[] = [];
  let beamSnr = -30;
  for (const c of sources) {
    const br = bearingRange(own, c);
    if (br.rng > 45000) continue;
    const relative = Math.abs(angleDiff(br.brg, own.heading));
    if (relative > s.settings.coverage / 2) continue;
    const sig = signature(c, s.settings.sourceOverrides[c.id]),
      path = s.paths[c.id];
    if (!path) continue;
    // Gradual aft baffle attenuation and time integration gain, not a speed cutoff.
    const baffle = 16 * Math.exp(-(((relative - 180) / 25) ** 2));
    const snr = sig.level - path.loss - s.noise.total - baffle + Math.min(8, 5 * Math.log10(s.settings.integration));
    for (let i = 0; i < bins; i++) energy[i] += 10 ** (clamp(snr, -60, 45) / 10) * Math.exp(-0.5 * (angleDiff(i * 2, br.brg) / 2.5) ** 2);
    const separation = Math.abs(angleDiff(beam, br.brg));
    const beamGain = Math.exp(-0.5 * (separation / 6) ** 2);
    if (beamGain > 0.001) {
      const a = (br.brg * Math.PI) / 180,
        h = (c.course * Math.PI) / 180;
      const radial = (c.speed * Math.cos(h) - own.vn) * Math.cos(a) + (c.speed * Math.sin(h) - own.ve) * Math.sin(a);
      signals.push({ signature: sig, amplitude: Math.min(0.4, 0.018 * 10 ** (clamp(snr, -40, 35) / 20)) * beamGain, doppler: 1500 / (1500 + radial) });
      beamSnr = Math.max(beamSnr, snr + 20 * Math.log10(beamGain));
    }
  }
  const broadband = Array.from(energy, (v, i) => (Math.abs(angleDiff(i * 2, own.heading)) > s.settings.coverage / 2 ? -60 : 10 * Math.log10(1 + v) + gaussian(s) * 0.8));
  const detections: Measurement[] = [];
  for (let i = 0; i < bins; i++) {
    const level = broadband[i];
    if (level < 6 || level < broadband[(i + bins - 1) % bins] || level <= broadband[(i + 1) % bins]) continue;
    if (random(s) > 1 / (1 + Math.exp(-(level - 6) / 2))) continue;
    const sigma = Math.hypot(0.6, clamp(8 / Math.sqrt(10 ** (level / 10)), 0.3, 4));
    detections.push({ t: e.state.t, bearing: wrap(i * 2 + gaussian(s) * sigma), sigma, snr: level, observer: { ...own }, mode: 'passive' });
  }
  // Non-maximum suppression: one unresolved main lobe must not create multiple tracks.
  const resolved: Measurement[] = [];
  for (const d of detections.sort((a, b) => b.snr - a.snr)) if (!resolved.some((m) => Math.abs(angleDiff(m.bearing, d.bearing)) < 6)) resolved.push(d);
  return { broadband, detections: resolved, signals, beam, snr: beamSnr };
}
