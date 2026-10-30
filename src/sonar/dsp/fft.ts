import type { Spectrum } from '../types';
/** Radix-2 FFT, Hann window, one-sided amplitude dBFS. */
export function spectrum(signal: ArrayLike<number>, sampleRate: number): Spectrum {
  const n = signal.length;
  if (n < 4 || n & (n - 1)) throw new Error('FFT requer potência de 2 ≥ 4');
  const re = new Float64Array(n),
    im = new Float64Array(n);
  let windowSum = 0;
  for (let i = 0, j = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    windowSum += w;
    re[j] = signal[i] * w;
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let start = 0; start < n; start += len)
      for (let j = 0; j < len / 2; j++) {
        const c = Math.cos(angle * j),
          s = Math.sin(angle * j),
          a = start + j,
          b = a + len / 2;
        const tr = re[b] * c - im[b] * s,
          ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
  }
  const bins = Array.from({ length: n / 2 }, (_, i) => 20 * Math.log10(Math.max(1e-6, (Math.hypot(re[i], im[i]) * 2) / windowSum)));
  return { bins, binHz: sampleRate / n, peaks: peaks(bins, sampleRate / n) };
}
export function peaks(bins: number[], binHz: number): number[] {
  const floor = [...bins].sort((a, b) => a - b)[Math.floor(bins.length / 2)];
  return bins
    .map((v, i) => ({ v, i }))
    .filter(({ v, i }) => i > 1 && i < bins.length - 1 && v > floor + 12 && v > bins[i - 1] && v > bins[i + 1])
    .sort((a, b) => b.v - a.v)
    .slice(0, 8)
    .map((p) => p.i * binHz);
}
/** DEMON: square-law envelope of high-pass carrier, block RMS, detrend, FFT.
 * Estimates modulation, not a unique blade count. */
export function demon(signal: ArrayLike<number>, sampleRate: number): Spectrum {
  const block = 8,
    n = signal.length / block,
    env = new Float64Array(n);
  let previous = signal[0],
    hp = 0;
  const rc = 1 / (2 * Math.PI * 180),
    alpha = rc / (rc + 1 / sampleRate);
  for (let i = 0; i < signal.length; i++) {
    hp = alpha * (hp + signal[i] - previous);
    previous = signal[i];
    env[Math.floor(i / block)] += (hp * hp) / block;
  }
  let mean = 0;
  for (let i = 0; i < n; i++) {
    env[i] = Math.sqrt(env[i]);
    mean += env[i] / n;
  }
  for (let i = 0; i < n; i++) env[i] -= mean;
  return spectrum(env, sampleRate / block);
}
