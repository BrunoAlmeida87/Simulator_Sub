/**
 * Gráfico de tendência em canvas, com cursor sincronizado entre gráficos
 * e marcadores de comandos do operador.
 */
import { useEffect, useRef, useState } from 'react';
import type { HistoryRecorder } from '../../sim/history';
import { CHANNELS } from '../../sim/history';

type Listener = () => void;
const cursor = { t: null as number | null, listeners: new Set<Listener>() };
function setCursor(t: number | null) {
  cursor.t = t;
  cursor.listeners.forEach((l) => l());
}

export interface ChartSeries {
  id: string;
  color: string;
  dashed?: boolean;
}

export function StripChart(props: {
  history: HistoryRecorder;
  series: ChartSeries[];
  window: number; // s
  height?: number;
  invert?: boolean;
  title: string;
  markers?: { t: number; text: string }[];
  yMin?: number;
  yMax?: number;
  minSpan?: number;
  version: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [, force] = useState(0);
  const H = props.height ?? 140;

  useEffect(() => {
    const l = () => force((x) => x + 1);
    cursor.listeners.add(l);
    return () => {
      cursor.listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver((ents) => {
      for (const e of ents) setWidth(Math.max(200, Math.floor(e.contentRect.width)));
    });
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const h = props.history;
  const n = h.count;
  const tEnd = n ? h.t[h.idx(n - 1)] : 0;
  const tStart = Math.max(n ? h.t[h.idx(0)] : 0, tEnd - props.window);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr;
    cv.height = H * dpr;
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, H);
    g.fillStyle = '#0a121b';
    g.fillRect(0, 0, width, H);
    const L = 46;
    const R = 8;
    const T = 6;
    const B = 18;
    const pw = width - L - R;
    const ph = H - T - B;
    // faixa vertical
    let lo = Infinity;
    let hi = -Infinity;
    let k0 = 0;
    for (let k = 0; k < n; k++) {
      if (h.t[h.idx(k)] >= tStart) {
        k0 = k;
        break;
      }
    }
    for (const s of props.series) {
      const d = h.data[s.id];
      for (let k = k0; k < n; k++) {
        const v = d[h.idx(k)];
        if (Number.isFinite(v)) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    if (props.yMin !== undefined) lo = Math.min(lo, props.yMin);
    if (props.yMax !== undefined) hi = Math.max(hi, props.yMax);
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    const minSpan = props.minSpan ?? 1e-3;
    if (hi - lo < minSpan) {
      const mid = 0.5 * (hi + lo);
      hi = mid + minSpan / 2;
      lo = mid - minSpan / 2;
    }
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    const X = (t: number) => L + ((t - tStart) / Math.max(1, tEnd - tStart || props.window)) * pw;
    const Y = (v: number) => (props.invert ? T + ((v - lo) / (hi - lo)) * ph : T + ph - ((v - lo) / (hi - lo)) * ph);
    // grade
    g.strokeStyle = '#1a2a3d';
    g.lineWidth = 1;
    g.fillStyle = '#7f93a8';
    g.font = '10px ui-monospace, monospace';
    const nice = (x: number) => {
      const p = Math.pow(10, Math.floor(Math.log10(x)));
      const f = x / p;
      return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
    };
    const stepY = nice((hi - lo) / 4);
    for (let v = Math.ceil(lo / stepY) * stepY; v <= hi; v += stepY) {
      const yy = Y(v);
      g.beginPath();
      g.moveTo(L, yy);
      g.lineTo(L + pw, yy);
      g.stroke();
      const dec = Math.max(0, Math.min(4, Math.ceil(-Math.log10(stepY) - 1e-9)));
      const txt = v.toFixed(dec);
      g.fillText(/^-0[.]?0*$/.test(txt) ? txt.slice(1) : txt, 2, yy + 3);
    }
    const span = Math.max(1, tEnd - tStart);
    const stepT = nice(span / 6);
    for (let t = Math.ceil(tStart / stepT) * stepT; t <= tEnd; t += stepT) {
      const xx = X(t);
      g.beginPath();
      g.moveTo(xx, T);
      g.lineTo(xx, T + ph);
      g.stroke();
      const mm = Math.floor(t / 60);
      const ss = Math.round(t % 60);
      g.fillText(`${mm}:${String(ss).padStart(2, '0')}`, xx - 12, H - 5);
    }
    // marcadores de comandos
    if (props.markers) {
      g.strokeStyle = 'rgba(255,179,71,0.35)';
      g.setLineDash([3, 3]);
      for (const m of props.markers) {
        if (m.t < tStart || m.t > tEnd) continue;
        const xx = X(m.t);
        g.beginPath();
        g.moveTo(xx, T);
        g.lineTo(xx, T + ph);
        g.stroke();
      }
      g.setLineDash([]);
    }
    // séries
    for (const s of props.series) {
      const d = h.data[s.id];
      g.strokeStyle = s.color;
      g.lineWidth = 1.6;
      g.setLineDash(s.dashed ? [5, 4] : []);
      g.beginPath();
      let pen = false;
      for (let k = k0; k < n; k++) {
        const i = h.idx(k);
        const v = d[i];
        if (!Number.isFinite(v)) {
          pen = false;
          continue;
        }
        const xx = X(h.t[i]);
        const yy = Y(v);
        if (!pen) {
          g.moveTo(xx, yy);
          pen = true;
        } else g.lineTo(xx, yy);
      }
      g.stroke();
    }
    g.setLineDash([]);
    // cursor
    if (cursor.t !== null && cursor.t >= tStart && cursor.t <= tEnd) {
      const xx = X(cursor.t);
      g.strokeStyle = '#d8e4f0';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(xx, T);
      g.lineTo(xx, T + ph);
      g.stroke();
    }
    g.strokeStyle = '#2c4260';
    g.strokeRect(L, T, pw, ph);
  });

  const onMove = (ev: React.MouseEvent | React.TouchEvent) => {
    const cv = ref.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const cx = 'touches' in ev ? ev.touches[0].clientX : (ev as React.MouseEvent).clientX;
    const x = cx - rect.left;
    const L = 46;
    const pw = rect.width - L - 8;
    const t = tStart + ((x - L) / pw) * Math.max(1, tEnd - tStart);
    setCursor(t >= tStart && t <= tEnd ? t : null);
  };

  const label = (id: string) => CHANNELS.find((c) => c.id === id);
  return (
    <div className="chart-wrap" ref={wrap}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 3 }}>
        <b style={{ fontSize: 11.5, color: '#b9cde2', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{props.title}</b>
        <div className="legend">
          {props.series.map((s) => {
            const c = label(s.id);
            const v = cursor.t !== null ? h.valueAt(s.id, cursor.t) : n ? h.data[s.id][h.idx(n - 1)] : NaN;
            return (
              <span key={s.id}>
                <i style={{ background: s.color }} />
                {c?.label}: <b className="mono" style={{ color: '#d8e4f0' }}>{Number.isFinite(v) ? v.toFixed(Math.abs(v) >= 100 ? 0 : 2) : '—'}</b> {c?.unit}
              </span>
            );
          })}
        </div>
      </div>
      <canvas ref={ref} style={{ height: H }} onMouseMove={onMove} onMouseLeave={() => setCursor(null)} onTouchMove={onMove} />
    </div>
  );
}
