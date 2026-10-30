import { angleDiff, ring, push, type Measurement, type SonarState, type Track } from '../types';
/** Association uses only measured bearing/time. Crossing tracks can be ambiguous. */
export function associate(s: SonarState, m: Measurement, used = new Set<string>()): Track {
  const gate = Math.max(4, Math.min(12, m.sigma * 3));
  let track = s.tracks
    .filter((c) => !used.has(c.id) && m.t - c.lastSeen < 45 && Math.abs(angleDiff(c.bearing, m.bearing)) < gate)
    .sort((a, b) => Math.abs(angleDiff(a.bearing, m.bearing)) - Math.abs(angleDiff(b.bearing, m.bearing)))[0];
  if (!track) {
    track = {
      id: `S${String(s.nextId++).padStart(3, '0')}`,
      bearing: m.bearing,
      snr: m.snr,
      sigma: m.sigma,
      lastSeen: m.t,
      mode: m.mode,
      history: ring(180),
      classification: 'Indeterminado',
      confidence: 0,
      peaks: [],
      modulation: [],
    };
    s.tracks.push(track);
    if (s.tracks.length > 48) s.tracks.splice(0, s.tracks.length - 48);
  }
  Object.assign(track, { bearing: m.bearing, snr: m.snr, sigma: m.sigma, lastSeen: m.t, mode: m.mode });
  if (m.range !== undefined) Object.assign(track, { range: m.range, rangeSigma: m.rangeSigma, rangeTime: m.t });
  push(track.history, m);
  used.add(track.id);
  return track;
}
