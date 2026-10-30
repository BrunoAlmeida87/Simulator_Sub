import { useEffect, useRef, useState } from 'react';
import { receivedAudio } from '../integration/system';
import type { SonarState } from '../types';
import { SAMPLE_RATE, audioResample } from '../dsp/synthesis';
/** Plays the actual received synthetic waveform used by DSP, never target identity. */
export function Aural({ state, running, timeScale }: { state: SonarState; running: boolean; timeScale: number }) {
  const audio = useRef<{ ctx: AudioContext; gain: GainNode; hi: BiquadFilterNode; lo: BiquadFilterNode; source: AudioBufferSourceNode | null }>();
  const [on, setOn] = useState(false),
    [volume, setVolume] = useState(0.2),
    [low, setLow] = useState(20),
    [high, setHigh] = useState(900),
    [error, setError] = useState('');
  useEffect(
    () => () => {
      void audio.current?.ctx.close();
      audio.current = undefined;
    },
    [],
  );
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    a.gain.gain.setTargetAtTime(on && running ? volume : 0, a.ctx.currentTime, 0.04);
    a.hi.frequency.value = low;
    a.lo.frequency.value = high;
    if (!on || !running) return;
    const samples = receivedAudio(state);
    if (!samples) {
      setError('Aguarde uma aquisição para escutar o feixe.');
      return;
    }
    try {
      const pcm = audioResample(samples);
      const buffer = a.ctx.createBuffer(1, pcm.length, SAMPLE_RATE * 4);
      buffer.copyToChannel(new Float32Array(pcm), 0);
      a.source?.stop();
      a.source?.disconnect();
      const source = a.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = Math.min(4, Math.max(0.5, timeScale));
      source.connect(a.hi);
      source.start();
      a.source = source;
    } catch {
      a.gain.gain.value = 0;
      setOn(false);
      setError('Não foi possível reproduzir o áudio neste navegador.');
    }
  }, [on, running, volume, low, high, state.frame?.t, state.settings.selected, timeScale]);
  async function toggle() {
    try {
      if (!audio.current) {
        const ctx = new AudioContext(),
          gain = ctx.createGain(),
          hi = ctx.createBiquadFilter(),
          lo = ctx.createBiquadFilter();
        gain.gain.value = 0;
        hi.type = 'highpass';
        lo.type = 'lowpass';
        hi.connect(lo);
        lo.connect(gain);
        gain.connect(ctx.destination);
        audio.current = { ctx, gain, hi, lo, source: null };
      }
      await audio.current.ctx.resume();
      setOn(!on);
      setError('');
    } catch {
      setError('Web Audio indisponível neste ambiente.');
    }
  }
  return (
    <div className="acoustic-controls">
      <button className={`btn ${on ? 'on' : ''}`} onClick={() => void toggle()}>
        {on ? 'Silenciar áudio' : 'Escutar feixe'}
      </button>
      <label>
        Volume <input aria-label="Volume sonar" type="range" min="0" max="0.8" step="0.01" value={volume} onChange={(e) => setVolume(+e.target.value)} />
      </label>
      <label>
        Passa-altas (Hz)
        <input type="number" min="10" max={high - 10} value={low} onChange={(e) => setLow(Math.max(10, Math.min(high - 10, +e.target.value)))} />
      </label>
      <label>
        Passa-baixas (Hz)
        <input type="number" min={low + 10} max="1000" value={high} onChange={(e) => setHigh(Math.max(low + 10, Math.min(1000, +e.target.value)))} />
      </label>
      {error && <span role="status">{error}</span>}
      <span className="subtle">Áudio do feixe recebido · pausa acompanha o motor · taxa sonora limitada a ×4.</span>
    </div>
  );
}
