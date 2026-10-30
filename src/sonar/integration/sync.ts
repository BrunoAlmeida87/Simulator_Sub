import { push, values, ring, type AcousticFrame, type SonarState, type Track, type Measurement } from '../types';
export interface SonarDelta {
  state: Omit<SonarState, 'history' | 'pending' | 'ping' | 'paths' | 'tracks'>;
  tracks: (Omit<Track, 'history'> & { measurements: Measurement[] })[];
  frames: AcousticFrame[];
  ping?: SonarState['ping'];
}
/** Bounded incremental history transport. Future detections and source-path cache stay on master. */
export function sonarDelta(s: SonarState, after: number, pingStart: number | null): SonarDelta {
  const { history, pending: _pending, paths: _paths, ping, tracks, ...state } = s;
  return {
    state,
    tracks: tracks.map(({ history, ...track }) => ({ ...track, measurements: values(history).filter((m) => m.t >= after) })),
    frames: values(history).filter((f) => f.t > after),
    ...((ping?.start ?? null) !== pingStart ? { ping } : {}),
  };
}
export function applySonarDelta(s: SonarState, delta: SonarDelta): SonarState {
  const last = s.frame?.t ?? -1;
  if (s.history.capacity !== delta.state.settings.historySeconds) {
    const frames = values(s.history).slice(-delta.state.settings.historySeconds);
    s.history = ring(delta.state.settings.historySeconds);
    for (const f of frames) push(s.history, f);
  }
  for (const frame of delta.frames) if (frame.t > last) push(s.history, frame);
  const tracks = delta.tracks.map(({ measurements, ...track }) => {
    const history = s.tracks.find((t) => t.id === track.id)?.history ?? ring<Measurement>(180);
    const known = new Set(values(history).map((m) => `${m.t}/${m.bearing}/${m.mode}`));
    for (const m of measurements) {
      const key = `${m.t}/${m.bearing}/${m.mode}`;
      if (!known.has(key)) {
        push(history, m);
        known.add(key);
      }
    }
    return { ...track, history };
  });
  return { ...s, ...delta.state, tracks, pending: [], ...(delta.ping !== undefined ? { ping: delta.ping } : {}) };
}
