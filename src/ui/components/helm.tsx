/**
 * CONTROLES VISUAIS DE GOVERNO (mouse e toque): manche (leme de direção +
 * lemes de ré), alavanca dos lemes de vante, alavanca do telégrafo e botão
 * giratório de referência. Cada controle mostra a posição COMANDADA (a peça
 * que se move) e a resposta REAL (marcador verde), lidas do estado. Enviam os
 * mesmos comandos do resto do simulador (participam da gravação).
 */
import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { TELEGRAPH } from './Controls';

const CMD = '#36c5f0';
const REAL = '#3ddc84';
const PWR = '#ffb347';

/** Arrasto com captura do ponteiro: entrega a posição normalizada (−1…1) no elemento. */
function useDrag(onMove: (fx: number, fy: number, first: boolean) => void, onEnd?: () => void) {
  const active = useRef(false);
  const el = useRef<Element | null>(null);
  const pos = (ev: RPointerEvent) => {
    const r = (el.current as Element).getBoundingClientRect();
    return [Math.max(-1, Math.min(1, ((ev.clientX - r.left) / r.width) * 2 - 1)), Math.max(-1, Math.min(1, ((ev.clientY - r.top) / r.height) * 2 - 1))] as const;
  };
  return {
    onPointerDown: (ev: RPointerEvent) => {
      el.current = ev.currentTarget;
      active.current = true;
      (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
      const [x, y] = pos(ev);
      onMove(x, y, true);
      ev.preventDefault();
    },
    onPointerMove: (ev: RPointerEvent) => {
      if (!active.current) return;
      const [x, y] = pos(ev);
      onMove(x, y, false);
    },
    onPointerUp: () => {
      if (!active.current) return;
      active.current = false;
      onEnd?.();
    },
    onPointerCancel: () => {
      active.current = false;
      onEnd?.();
    },
  };
}

/** Envia no máximo a cada `ms` e só quando o valor (arredondado) muda; o último valor é sempre enviado ao soltar. */
function useThrottledSend<T>(send: (v: T) => void, ms = 90) {
  const last = useRef<{ t: number; key: string; pending: T | null }>({ t: 0, key: '', pending: null });
  const flush = () => {
    const p = last.current.pending;
    if (p !== null) {
      last.current.pending = null;
      send(p);
    }
  };
  return {
    push: (v: T, key: string) => {
      const L = last.current;
      if (key === L.key) return;
      L.key = key;
      const now = performance.now();
      if (now - L.t >= ms) {
        L.t = now;
        L.pending = null;
        send(v);
      } else L.pending = v;
    },
    flush,
    reset: () => (last.current.key = ''),
  };
}

// ------------------------------------------------------------------ manche
export interface YokeProps {
  rudderCmd: number;
  rudderReal: number;
  rudderMax: number;
  sternCmd: number;
  sternReal: number;
  sternMax: number;
  onSet: (rudder: number, stern: number) => void;
}

/**
 * Manche: horizontal = leme de direção (BB ← → BE); vertical = lemes de ré
 * (empurrar para cima = DESCER, puxar para baixo = SUBIR), como no posto de
 * governo. A peça mostra o comandado; o anel verde mostra os lemes reais.
 */
export function Yoke(p: YokeProps) {
  const [drag, setDrag] = useState<{ r: number; s: number } | null>(null);
  const send = useThrottledSend<{ r: number; s: number }>((v) => p.onSet(v.r, v.s));
  const handlers = useDrag(
    (fx, fy) => {
      const r = Math.round(fx * p.rudderMax);
      const s = Math.round(fy * p.sternMax); // para baixo (puxar) = + = SUBIR
      setDrag({ r, s });
      send.push({ r, s }, `${r}|${s}`);
    },
    () => {
      send.flush();
      send.reset();
      setDrag(null);
    },
  );
  const r = drag ? drag.r : p.rudderCmd;
  const s = drag ? drag.s : p.sternCmd;
  const W = 300;
  const c = W / 2;
  const k = (W / 2 - 22) / 1;
  const cx = c + (r / p.rudderMax) * k;
  const cy = c + (s / p.sternMax) * k;
  const rx = c + (p.rudderReal / p.rudderMax) * k;
  const ry = c + (p.sternReal / p.sternMax) * k;
  const rot = (r / p.rudderMax) * 50;
  return (
    <svg viewBox={`0 0 ${W} ${W}`} className="helm-yoke" {...handlers} role="slider" aria-label="Manche: leme de direção e lemes de ré" aria-valuetext={`leme ${r}°, lemes de ré ${s}°`}>
      <rect x={6} y={6} width={W - 12} height={W - 12} rx={14} className="helm-pad" />
      {[-1, -0.5, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={c + f * k} y1={14} x2={c + f * k} y2={W - 14} className="helm-grid" />
          <line x1={14} y1={c + f * k} x2={W - 14} y2={c + f * k} className="helm-grid" />
        </g>
      ))}
      <line x1={c} y1={14} x2={c} y2={W - 14} className="helm-axis" />
      <line x1={14} y1={c} x2={W - 14} y2={c} className="helm-axis" />
      <text x={c} y={30} className="helm-lbl" textAnchor="middle">
        ▲ empurrar · DESCER
      </text>
      <text x={c} y={W - 20} className="helm-lbl" textAnchor="middle">
        ▼ puxar · SUBIR
      </text>
      <text x={22} y={c - 8} className="helm-lbl">
        ◀ BB
      </text>
      <text x={W - 22} y={c - 8} className="helm-lbl" textAnchor="end">
        BE ▶
      </text>
      {/* resposta real */}
      <line x1={cx} y1={cy} x2={rx} y2={ry} stroke={REAL} strokeDasharray="3 3" strokeWidth={1.5} />
      <circle cx={rx} cy={ry} r={11} fill="none" stroke={REAL} strokeWidth={3} />
      {/* manche (comandado) */}
      <g transform={`translate(${cx} ${cy}) rotate(${rot})`}>
        <rect x={-58} y={-7} width={116} height={14} rx={7} fill="#1b2b3e" stroke={CMD} strokeWidth={2.5} />
        <rect x={-66} y={-24} width={16} height={48} rx={7} fill={CMD} />
        <rect x={50} y={-24} width={16} height={48} rx={7} fill={CMD} />
        <circle r={9} fill="#0a121b" stroke={CMD} strokeWidth={2.5} />
      </g>
    </svg>
  );
}

// ------------------------------------------------------------------ alavanca vertical
export interface LeverProps {
  value: number; // comandado
  real: number;
  min: number;
  max: number;
  /** valores marcados (detentes) com rótulos */
  detents?: { v: number; label: string }[];
  /** arrastar só para os detentes */
  snap?: boolean;
  /** valor do topo da alavanca é max (true) ou min (false) */
  maxOnTop?: boolean;
  color?: string;
  height?: number;
  topLabel?: string;
  bottomLabel?: string;
  unit: string;
  ariaLabel: string;
  onSet: (v: number) => void;
}

export function Lever(p: LeverProps) {
  const [drag, setDrag] = useState<number | null>(null);
  const send = useThrottledSend<number>(p.onSet, 110);
  const H = p.height ?? 300;
  const W = p.detents ? 150 : 96;
  const top = 26;
  const bot = H - 26;
  const toY = (v: number) => {
    const f = (v - p.min) / (p.max - p.min);
    return p.maxOnTop === false ? top + f * (bot - top) : bot - f * (bot - top);
  };
  const fromY = (fy: number) => {
    const y = ((fy + 1) / 2) * H;
    let f = (y - top) / (bot - top);
    f = Math.max(0, Math.min(1, f));
    if (p.maxOnTop !== false) f = 1 - f;
    return p.min + f * (p.max - p.min);
  };
  const quant = (v: number) => {
    if (p.snap && p.detents?.length) return p.detents.reduce((a, d) => (Math.abs(d.v - v) < Math.abs(a - v) ? d.v : a), p.detents[0].v);
    return Math.round(v);
  };
  const handlers = useDrag(
    (_fx, fy) => {
      const v = quant(fromY(fy));
      setDrag(v);
      send.push(v, String(v));
    },
    () => {
      send.flush();
      send.reset();
      setDrag(null);
    },
  );
  const v = drag ?? p.value;
  const col = p.color ?? CMD;
  const tx = p.detents ? 52 : W / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="helm-lever" style={{ maxHeight: H }} {...handlers} role="slider" aria-label={p.ariaLabel} aria-valuenow={v} aria-valuemin={p.min} aria-valuemax={p.max}>
      <rect x={tx - 9} y={top - 8} width={18} height={bot - top + 16} rx={9} className="helm-track" />
      {p.topLabel && (
        <text x={tx} y={14} className="helm-lbl" textAnchor="middle">
          {p.topLabel}
        </text>
      )}
      {p.bottomLabel && (
        <text x={tx} y={H - 4} className="helm-lbl" textAnchor="middle">
          {p.bottomLabel}
        </text>
      )}
      {(p.detents ?? []).map((d) => (
        <g key={d.label}>
          <line x1={tx - 14} y1={toY(d.v)} x2={tx + 14} y2={toY(d.v)} className="helm-axis" />
          <text x={tx + 20} y={toY(d.v) + 4} className={`helm-det ${Math.round(v) === d.v ? 'on' : ''}`}>
            {d.label}
          </text>
        </g>
      ))}
      {!p.detents &&
        [p.min, (p.min + p.max) / 2, p.max].map((t) => (
          <g key={t}>
            <line x1={tx - 14} y1={toY(t)} x2={tx + 14} y2={toY(t)} className="helm-axis" />
            <text x={tx + 18} y={toY(t) + 4} className="helm-det">
              {Math.round(t)}
            </text>
          </g>
        ))}
      {/* real */}
      <path d={`M${tx - 22} ${toY(p.real)} l-9 -7 v14 z`} fill={REAL} />
      {/* punho (comandado) */}
      <rect x={tx - 20} y={toY(v) - 11} width={40} height={22} rx={8} fill={col} stroke="#0a121b" strokeWidth={2} />
      <text x={tx} y={toY(v) + 4} textAnchor="middle" className="helm-knobtxt">
        {Math.round(v)}
        {p.unit}
      </text>
    </svg>
  );
}

export const TELEGRAPH_DETENTS = TELEGRAPH.map((t) => ({ v: t.rpm, label: t.label }));

// ------------------------------------------------------------------ botão giratório
export interface KnobProps {
  value: number;
  /** graus de valor por grau de giro */
  scale: number;
  min?: number;
  max?: number;
  wrap?: number;
  unit: string;
  label: string;
  active?: boolean;
  onSet: (v: number) => void;
}

/** Botão giratório: gire (arrastando em volta do centro) para escolher; o valor é enviado ao soltar. */
export function Knob(p: KnobProps) {
  const [v, setV] = useState<number | null>(null);
  const prevAng = useRef(0);
  const acc = useRef(0);
  const ang = (fx: number, fy: number) => (Math.atan2(fx, -fy) * 180) / Math.PI;
  const clampWrap = (x: number) => {
    if (p.wrap) return ((x % p.wrap) + p.wrap) % p.wrap;
    return Math.max(p.min ?? -Infinity, Math.min(p.max ?? Infinity, x));
  };
  const handlers = useDrag(
    (fx, fy, first) => {
      const a = ang(fx, fy);
      if (first) {
        prevAng.current = a;
        acc.current = p.value;
        setV(p.value);
        return;
      }
      let d = a - prevAng.current;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      prevAng.current = a;
      acc.current = clampWrap(acc.current + d * p.scale);
      setV(Math.round(acc.current));
    },
    () => {
      const nv = Math.round(acc.current);
      if (nv !== Math.round(p.value)) p.onSet(nv);
      setV(null);
    },
  );
  const shown = v ?? p.value;
  const rot = p.wrap ? shown : ((shown - (p.min ?? 0)) / Math.max(1, (p.max ?? 100) - (p.min ?? 0))) * 300 - 150;
  return (
    <div className="helm-knob">
      <svg viewBox="0 0 120 120" {...handlers} role="slider" aria-label={p.label} aria-valuenow={Math.round(shown)}>
        <circle cx={60} cy={60} r={52} className="helm-pad" />
        {Array.from({ length: 24 }, (_, i) => (
          <line key={i} x1={60} y1={10} x2={60} y2={i % 6 ? 15 : 19} className="helm-grid" transform={`rotate(${i * 15} 60 60)`} />
        ))}
        <g transform={`rotate(${rot} 60 60)`}>
          <circle cx={60} cy={60} r={34} fill="#1b2b3e" stroke={p.active ? CMD : '#4b6584'} strokeWidth={3} />
          <rect x={57} y={28} width={6} height={18} rx={3} fill={p.active ? CMD : '#7f93a8'} />
        </g>
        <text x={60} y={66} textAnchor="middle" className="helm-knobval">
          {Math.round(shown)}
          {p.unit}
        </text>
      </svg>
      <span className="subtle">{p.label}</span>
    </div>
  );
}

export const HELM_COLORS = { CMD, REAL, PWR };
