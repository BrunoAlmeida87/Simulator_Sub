import { useEffect, useRef, useState } from 'react';
import { values, type SonarState } from '../types';
/** Audible cues follow real emissions/arrived measurements, never the visual replay. */
export function PingAudio({ state, time }: { state: SonarState; time: number }) {
  const audio = useRef<AudioContext | null>(null),
    heard = useRef(time),
    ping = useRef<number | undefined>(state.ping?.start);
  const [enabled, setEnabled] = useState(false),
    [error, setError] = useState('');
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  useEffect(() => {
    const ctx = audio.current;
    const tone = (hz: number, duration: number) => {
      if (!ctx || ctx.state !== 'running') return;
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain(),
        now = ctx.currentTime;
      oscillator.frequency.setValueAtTime(hz, now);
      oscillator.frequency.exponentialRampToValueAtTime(hz * 0.75, now + duration);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.07, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(now + duration);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    };
    if (enabled && state.ping?.start !== ping.current && state.ping) tone(980, 0.6);
    const echo = state.tracks.some((t) => values(t.history).some((m) => m.mode === 'active' && m.t > heard.current && m.t <= time));
    if (enabled && echo) tone(660, 0.25);
    heard.current = time;
    ping.current = state.ping?.start;
  }, [state.version, state, time, enabled]);
  return (
    <button
      className={enabled ? 'active' : ''}
      aria-pressed={enabled}
      title={error || 'Som da emissão e dos ecos recebidos, no tempo da simulação'}
      onClick={async () => {
        try {
          if (!audio.current) audio.current = new AudioContext();
          await audio.current.resume();
          heard.current = time;
          ping.current = state.ping?.start;
          setEnabled(!enabled);
        } catch {
          setError('Áudio indisponível');
        }
      }}
    >
      {error || (enabled ? '♪ Ping sonoro ligado' : '♪ Som de ping')}
    </button>
  );
}
