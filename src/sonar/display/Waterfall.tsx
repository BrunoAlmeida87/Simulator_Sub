import { trackColor } from './bearingTraces';
import { useEffect, useRef } from 'react';
import { clamp, values, type SonarState } from '../types';
export type DisplayMode = 'broadband' | 'lofar' | 'demon';
interface Props {
  state: SonarState;
  mode: DisplayMode;
  gain: number;
  contrast: number;
  seconds: number;
  min: number;
  max: number;
  cursor: number | null;
  onCursor: (v: number) => void;
  onMark: (bearing: number) => void;
}
export function Waterfall({ state, mode, gain, contrast, seconds, min, max, cursor, onCursor, onMark }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current,
      g = el?.getContext('2d');
    if (!el || !g) return;
    const W = el.width,
      H = el.height,
      x0 = 52,
      top = 28,
      width = W - x0 - 15,
      height = H - 54;
    g.fillStyle = '#020d12';
    g.fillRect(0, 0, W, H);
    const all = values(state.history),
      latest = state.frame?.t ?? 0;
    const rows = all.filter((f) => latest - f.t <= seconds);
    const fullMax = mode === 'broadband' ? 360 : mode === 'lofar' ? 1024 : 128;
    for (const frame of rows) {
      const row = frame[mode],
        y = top + ((latest - frame.t) / seconds) * height;
      for (let x = 0; x < width; x++) {
        const freq = min + (x / width) * (max - min),
          bin = Math.min(row.length - 1, Math.floor((freq / fullMax) * row.length));
        const db = row[bin] ?? -100;
        const level = clamp(((db + gain + (mode === 'broadband' ? 0 : 65)) / (mode === 'broadband' ? 28 : 55) - 0.12) * contrast, 0, 1);
        g.fillStyle = `rgb(${Math.round(10 + 160 * level ** 3)},${Math.round(20 + 225 * level)},${Math.round(25 + 130 * level ** 2)})`;
        g.fillRect(x0 + x, y, 1, Math.max(1, height / seconds + 0.5));
      }
    }
    g.font = '12px monospace';
    g.strokeStyle = '#20333e';
    g.fillStyle = '#94b8c9';
    for (let i = 0; i <= 6; i++) {
      const x = x0 + (i / 6) * width;
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x, H - 26);
      g.stroke();
      g.textAlign = i === 6 ? 'right' : 'left';
      g.fillText(`${Math.round(min + (i / 6) * (max - min))}${mode === 'broadband' ? '°' : ''}`, x, 18);
    }
    g.textAlign = 'left';
    for (let i = 0; i <= 4; i++) g.fillText(`−${Math.round((i / 4) * seconds)}s`, 3, top + (i / 4) * height);
    if (mode === 'broadband')
      for (const track of state.tracks) {
        g.strokeStyle = trackColor(track.id);
        g.lineWidth = track.id === state.settings.selected ? 2.5 : 1;
        g.beginPath();
        let started = false,
          previous: { bearing: number; t: number } | null = null;
        for (const m of values(track.history)) {
          if (latest - m.t > seconds || m.bearing < min || m.bearing > max) {
            started = false;
            continue;
          }
          const x = x0 + ((m.bearing - min) / (max - min)) * width,
            y = top + ((latest - m.t) / seconds) * height;
          if (!started || (previous && (Math.abs(m.bearing - previous.bearing) > 180 || m.t - previous.t > 10))) g.moveTo(x, y);
          else g.lineTo(x, y);
          started = true;
          previous = m;
        }
        g.stroke();
        if (track.bearing >= min && track.bearing <= max) {
          g.fillStyle = g.strokeStyle;
          g.fillText(track.id, x0 + ((track.bearing - min) / (max - min)) * width, H - 8);
        }
      }
    g.lineWidth = 1;
    if (cursor !== null) {
      const x = x0 + ((cursor - min) / (max - min)) * width;
      g.strokeStyle = '#fff1b4';
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x, H - 26);
      g.stroke();
    }
    if (!rows.length) {
      g.fillStyle = '#a2bfcc';
      g.textAlign = 'center';
      g.fillText('Aguardando aquisição · execute a simulação', W / 2, H / 2);
    }
  }, [state.version, mode, gain, contrast, seconds, min, max, cursor, state]);
  const at = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const b = ev.currentTarget.getBoundingClientRect(),
      x = ((ev.clientX - b.left) * 900) / b.width;
    return clamp(min + ((x - 52) / 833) * (max - min), min, max);
  };
  return (
    <canvas
      ref={canvas}
      width={900}
      height={360}
      className="acoustic-waterfall"
      aria-label={`Cascata ${mode}, ${mode === 'broadband' ? 'marcação verdadeira' : 'frequência'} por tempo de simulação`}
      onPointerDown={(ev) => onCursor(at(ev))}
      onDoubleClick={(ev) => {
        if (mode === 'broadband') {
          const b = ev.currentTarget.getBoundingClientRect();
          onMark(clamp(min + ((((ev.clientX - b.left) * 900) / b.width - 52) / 833) * (max - min), 0, 359.9));
        }
      }}
    />
  );
}
export function InstantSpectrum({ bins, max }: { bins: number[]; max: number }) {
  const path = bins.map((v, i) => `${i ? 'L' : 'M'}${(i / bins.length) * 800},${100 - clamp((v + 80) / 80, 0, 1) * 90}`).join(' ');
  return (
    <svg viewBox="0 0 800 120" role="img" aria-label="Espectro instantâneo" className="acoustic-spectrum">
      <path d={path} fill="none" stroke="#70e2b5" strokeWidth="1.2" />
      <text x="2" y="116" fill="#9eb7c3" fontSize="12">
        0 Hz · −80 a 0 dBFS
      </text>
      <text x="720" y="116" fill="#9eb7c3" fontSize="12">
        {max} Hz
      </text>
    </svg>
  );
}
