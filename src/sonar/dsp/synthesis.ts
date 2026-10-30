import type { Signature } from '../sources/signatures';
import { random } from '../types';
export interface SignalSource {
  signature: Signature;
  amplitude: number;
  doppler: number;
}
export const SAMPLE_RATE = 2048;
export const SAMPLE_COUNT = 4096;
/** Deterministic waveform shared by FFT and aural playback. */
export function synthesize(sources: SignalSource[], t: number, seed: number, n = SAMPLE_COUNT, rate = SAMPLE_RATE): Float32Array {
  const out = new Float32Array(n),
    rng = { seed };
  let previousNoise = 0;
  for (let i = 0; i < n; i++) {
    const time = t + i / rate;
    let v = (random(rng) * 2 - 1) * 0.018;
    for (const src of sources) {
      const s = src.signature,
        d = src.doppler;
      const noise = random(rng) * 2 - 1;
      const carrier = noise - previousNoise;
      previousNoise = noise;
      const modulation = 1 + 0.65 * Math.cos(2 * Math.PI * s.shaftHz * s.blades * d * time) + 0.22 * Math.cos(2 * Math.PI * s.shaftHz * d * time);
      let value = carrier * modulation * 0.25;
      for (let j = 0; j < s.tones.length; j++) value += (0.35 / (1 + j * 0.3)) * Math.sin(2 * Math.PI * s.tones[j] * d * time + 0.02 * Math.sin(time * 1.3));
      v += src.amplitude * value;
    }
    out[i] = v;
  }
  return out;
}

/** Web Audio requires >=8 kHz buffers; preserve the DSP waveform's duration/pitch. */
export function audioResample(samples: Float32Array): Float32Array {
  const out = new Float32Array(samples.length * 4);
  for (let i = 0; i < out.length; i++) {
    const p = i / 4,
      k = Math.floor(p),
      f = p - k;
    out[i] = samples[k] * (1 - f) + samples[Math.min(samples.length - 1, k + 1)] * f;
  }
  return out;
}
