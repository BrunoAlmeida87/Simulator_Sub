/**
 * Ferramentas de desenho dos painéis (canvas 2D): fundo de tela
 * multifunção, botões de toque, botões luminosos de painel físico,
 * mostradores analógicos, barras, mostradores digitais, símbolos de
 * diagrama (tubulação, válvula, bomba, tanque), rosa dos ventos e
 * indicadores de ângulo dos lemes. Cada botão registra a sua região clicável.
 */
import { fmtKnots } from '../../ui/format';
import type { DrawCtx } from './panel';

export const C = {
  bg: '#04101a',
  bg2: '#0a1a27',
  line: '#1e3c55',
  text: '#d4e8f6',
  dim: '#7593ab',
  cmd: '#36c5f0',
  real: '#3ddc84',
  warn: '#ffb020',
  alarm: '#ff4545',
  air: '#e8e2b0',
  water: '#2f8fe0',
  sea: '#1a6fc0',
  face: '#cfcbbd',
  faceDark: '#b9b5a6',
  ink: '#16181a',
};

export type G = CanvasRenderingContext2D;

export function font(g: G, size: number, weight: 'normal' | 'bold' = 'normal', mono = false): void {
  g.font = `${weight} ${Math.round(size)}px ${mono ? 'Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace' : 'Arial, "Liberation Sans", Helvetica, "DejaVu Sans", sans-serif'}`;
}

export function text(g: G, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', weight: 'normal' | 'bold' = 'normal', mono = false, maxW?: number): void {
  font(g, size, weight, mono);
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'middle';
  if (maxW) g.fillText(s, x, y, maxW);
  else g.fillText(s, x, y);
}

export function rrect(g: G, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const pad2 = (n: number) => String(Math.floor(n)).padStart(2, '0');
export const clockText = (t: number) => `${pad2(t / 3600)}:${pad2((t / 60) % 60)}:${pad2(t % 60)}`;

/** altura do cabeçalho das telas (px do canvas nominal) */
export const HEAD = 60;

/** fundo de tela multifunção: cabeçalho com título, relógio da simulação e moldura (letras grandes: legíveis de longe) */
export function screenBg(c: DrawCtx, title: string, sub?: string): number {
  const { g, W, H } = c;
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#071724');
  grd.addColorStop(1, C.bg);
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  const hh = HEAD;
  g.fillStyle = '#0d2537';
  g.fillRect(0, 0, W, hh);
  g.fillStyle = C.cmd;
  g.fillRect(0, hh - 3, W, 3);
  text(g, title, 14, hh / 2, 30, '#e9f6ff', 'left', 'bold', false, W - 190);
  if (sub) {
    const tw = g.measureText(title).width;
    const x = 14 + tw + 16;
    const room = W - x - 180;
    if (room > 120) text(g, sub, x, hh / 2 + 1, 19, C.dim, 'left', 'normal', false, room);
  }
  text(g, clockText(c.e.state.t), W - 12, hh / 2, 26, C.real, 'right', 'bold', true);
  g.strokeStyle = C.line;
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, W - 3, H - 3);
  return hh + 8;
}

export function box(g: G, x: number, y: number, w: number, h: number, title?: string): void {
  g.fillStyle = 'rgba(14,34,50,0.75)';
  rrect(g, x, y, w, h, 8);
  g.fill();
  g.strokeStyle = C.line;
  g.lineWidth = 1.5;
  g.stroke();
  if (title) text(g, title, x + 12, y + 17, 20, '#9fbcd4', 'left', 'bold', false, w - 24);
}

/** altura ocupada pelo título de um box */
export const BOX_T = 34;

export type Tone = 'cmd' | 'ok' | 'warn' | 'danger' | 'neutral';
const TONE: Record<Tone, string> = { cmd: C.cmd, ok: C.real, warn: C.warn, danger: C.alarm, neutral: '#9fb4c6' };

export interface BtnOpts {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  on?: boolean;
  tone?: Tone;
  tip: string;
  action?: () => void;
  disabled?: boolean;
  size?: number;
  /** cores próprias (etapas do lançamento: verde liberada, vermelha bloqueada…) e sem ação (só mostra o estado) */
  fill?: string;
  fg?: string;
  locked?: boolean;
}

/** botão de tela de toque */
export function button(c: DrawCtx, b: BtnOpts): void {
  const { g } = c;
  const col = TONE[b.tone ?? 'cmd'];
  const hov = c.hover === b.id && !b.disabled;
  rrect(g, b.x, b.y, b.w, b.h, Math.min(8, b.h / 4));
  g.fillStyle = b.fill ?? (b.disabled ? '#0c1620' : b.on ? col : hov ? '#1b3a52' : '#10283a');
  g.fill();
  g.lineWidth = hov && !b.locked ? 3 : 2;
  g.strokeStyle = b.disabled ? '#22333f' : hov && !b.locked ? '#ffffff' : col;
  g.stroke();
  const fs = b.size ?? Math.min(b.h * 0.44, 26);
  const fg = b.fg ?? (b.disabled ? '#3d5262' : b.on ? '#03121c' : '#e6f4ff');
  if (b.sub) {
    text(g, b.label, b.x + b.w / 2, b.y + b.h * 0.36, fs, fg, 'center', 'bold', false, b.w - 6);
    text(g, b.sub, b.x + b.w / 2, b.y + b.h * 0.73, Math.max(14, fs * 0.68), b.fg ?? (b.on ? '#06212f' : '#a9c3d6'), 'center', 'normal', false, b.w - 6);
  } else text(g, b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, fs, fg, 'center', 'bold', false, b.w - 6);
  c.hit({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, label: b.tip, action: b.disabled || b.locked ? undefined : b.action, disabled: b.disabled || b.locked });
}

export type LampColor = 'red' | 'green' | 'amber' | 'white' | 'blue';
const LAMP: Record<LampColor, [string, string]> = {
  red: ['#5a1a18', '#ff3b30'],
  green: ['#1b4a26', '#38f06a'],
  amber: ['#5a4010', '#ffb300'],
  white: ['#5c5c56', '#fffbe8'],
  blue: ['#18305a', '#4aa8ff'],
};

/** lâmpada indicadora redonda (painel físico) */
export function lamp(c: DrawCtx, x: number, y: number, r: number, lit: boolean, color: LampColor): void {
  const on = lit || c.ui.lampTest;
  const [off, onc] = LAMP[color];
  const { g } = c;
  g.fillStyle = '#2a2c2e';
  g.beginPath();
  g.arc(x, y, r + 3, 0, Math.PI * 2);
  g.fill();
  const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  grd.addColorStop(0, on ? '#ffffff' : off);
  grd.addColorStop(0.35, on ? onc : off);
  grd.addColorStop(1, on ? onc : '#111');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  if (on && c.glow) {
    const gg = c.glow;
    const gr = gg.createRadialGradient(x, y, 0, x, y, r * 1.6);
    gr.addColorStop(0, onc);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    gg.fillStyle = gr;
    gg.beginPath();
    gg.arc(x, y, r * 1.6, 0, Math.PI * 2);
    gg.fill();
  }
}

export interface LampBtnOpts {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  lit: boolean;
  color: LampColor;
  tip: string;
  action?: () => void;
  blink?: boolean;
}

/** botão luminoso quadrado (painel físico): a lente acende na cor indicada */
export function lampButton(c: DrawCtx, b: LampBtnOpts): void {
  const { g } = c;
  const blinkOff = b.blink && Math.floor(c.now * 2.5) % 2 === 0;
  const on = (b.lit && !blinkOff) || c.ui.lampTest;
  const [off, onc] = LAMP[b.color];
  const hov = c.hover === b.id;
  // bisel
  g.fillStyle = hov ? '#55595e' : '#303336';
  rrect(g, b.x, b.y, b.w, b.h, 5);
  g.fill();
  g.fillStyle = '#121314';
  rrect(g, b.x + 4, b.y + 4, b.w - 8, b.h - 8, 3);
  g.fill();
  const lx = b.x + 7;
  const ly = b.y + 7;
  const lw = b.w - 14;
  const lh = b.h - 14;
  const grd = g.createLinearGradient(lx, ly, lx, ly + lh);
  grd.addColorStop(0, on ? '#ffffff' : off);
  grd.addColorStop(0.25, on ? onc : off);
  grd.addColorStop(1, on ? onc : '#151515');
  g.fillStyle = grd;
  g.fillRect(lx, ly, lw, lh);
  const fs = b.sub ? Math.min(lh * 0.34, 22) : Math.min(lh * 0.46, 24);
  const ink = on ? '#101010' : '#d8d8d0';
  if (b.sub) {
    text(g, b.label, b.x + b.w / 2, ly + lh * 0.36, fs, ink, 'center', 'bold', false, lw - 4);
    text(g, b.sub, b.x + b.w / 2, ly + lh * 0.72, fs * 0.8, ink, 'center', 'normal', false, lw - 4);
  } else text(g, b.label, b.x + b.w / 2, ly + lh / 2 + 1, fs, ink, 'center', 'bold', false, lw - 4);
  if (on && c.glow) {
    c.glow.fillStyle = onc;
    c.glow.fillRect(lx, ly, lw, lh);
    font(c.glow, fs, 'bold');
    c.glow.fillStyle = 'rgba(0,0,0,0.75)';
    c.glow.textAlign = 'center';
    c.glow.textBaseline = 'middle';
    if (b.sub) {
      c.glow.fillText(b.label, b.x + b.w / 2, ly + lh * 0.36, lw - 4);
    } else c.glow.fillText(b.label, b.x + b.w / 2, ly + lh / 2 + 1, lw - 4);
  }
  if (hov) {
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3;
    rrect(g, b.x - 2, b.y - 2, b.w + 4, b.h + 4, 6);
    g.stroke();
  }
  c.hit({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, label: b.tip, action: b.action });
}

/** face pintada de painel físico com parafusos nos cantos */
export function faceBg(c: DrawCtx, color = C.face): void {
  const { g, W, H } = c;
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, color);
  grd.addColorStop(1, shade(color, -12));
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 4;
  g.strokeRect(2, 2, W - 4, H - 4);
  for (const [x, y] of [
    [14, 14],
    [W - 14, 14],
    [14, H - 14],
    [W - 14, H - 14],
  ]) {
    g.fillStyle = '#8f8b80';
    g.beginPath();
    g.arc(x, y, 6, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#555';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x - 4, y);
    g.lineTo(x + 4, y);
    g.stroke();
  }
}

/** escurece/clareia uma cor hexadecimal (#rrggbb) */
export function shade(hex: string, d: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + d));
  const gg = Math.max(0, Math.min(255, ((n >> 8) & 255) + d));
  const b = Math.max(0, Math.min(255, (n & 255) + d));
  return `rgb(${r},${gg},${b})`;
}

/** rótulo gravado (placa preta com letras brancas) sobre face de painel */
export function plate(g: G, s: string, x: number, y: number, w: number, h: number, size?: number): void {
  g.fillStyle = '#1a1c1e';
  rrect(g, x, y, w, h, 3);
  g.fill();
  text(g, s, x + w / 2, y + h / 2 + 1, size ?? h * 0.58, '#f1efe6', 'center', 'bold', false, w - 6);
}

export interface DialOpts {
  value: number;
  min: number;
  max: number;
  major: number;
  minor?: number;
  label: string;
  unit: string;
  /** segundo ponteiro (valor ordenado) */
  ordered?: number | null;
  /** faixa vermelha a partir de */
  redFrom?: number;
  /** faixa amarela a partir de */
  amberFrom?: number;
  /** ângulo varrido (graus) */
  sweep?: number;
  dark?: boolean;
  digits?: number;
  /** números da escala divididos por (ex.: 10) */
  scaleDiv?: number;
}

/** mostrador analógico (ponteiro), face branca de instrumento ou escura de tela */
export function dial(g: G, cx: number, cy: number, r: number, o: DialOpts): void {
  const sweep = ((o.sweep ?? 270) * Math.PI) / 180;
  const a0 = Math.PI / 2 + (2 * Math.PI - sweep) / 2;
  const ang = (v: number) => a0 + ((Math.max(o.min, Math.min(o.max, v)) - o.min) / (o.max - o.min)) * sweep;
  const dark = !!o.dark;
  // caixa
  g.fillStyle = dark ? '#0b0f13' : '#2b2d2f';
  g.beginPath();
  g.arc(cx, cy, r * 1.08, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = dark ? '#071119' : '#f4f2ea';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  const ink = dark ? '#cfe6f5' : '#141414';
  // faixas
  const band = (from: number, to: number, col: string) => {
    g.strokeStyle = col;
    g.lineWidth = r * 0.07;
    g.beginPath();
    g.arc(cx, cy, r * 0.86, ang(from), ang(to));
    g.stroke();
  };
  if (o.amberFrom !== undefined) band(o.amberFrom, o.redFrom ?? o.max, '#e8a000');
  if (o.redFrom !== undefined) band(o.redFrom, o.max, '#d62a1e');
  // escala
  const minor = o.minor ?? o.major / 5;
  g.strokeStyle = ink;
  for (let v = o.min; v <= o.max + 1e-9; v += minor) {
    const a = ang(v);
    const isMaj = Math.abs((v - o.min) / o.major - Math.round((v - o.min) / o.major)) < 1e-6;
    const r1 = r * (isMaj ? 0.74 : 0.8);
    g.lineWidth = isMaj ? r * 0.025 : r * 0.012;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    g.lineTo(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9);
    g.stroke();
    if (isMaj) {
      const lv = o.scaleDiv ? v / o.scaleDiv : v;
      text(g, String(Math.round(lv * 10) / 10), cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, r * 0.13, ink, 'center', 'bold');
    }
  }
  text(g, o.label, cx, cy - r * 0.22, r * 0.12, dark ? C.dim : '#333', 'center', 'bold', false, r * 0.85);
  text(g, o.unit, cx, cy + r * 0.3, r * 0.11, dark ? C.dim : '#444', 'center');
  const needle = (v: number, col: string, wd: number, len: number) => {
    const a = ang(v);
    g.strokeStyle = col;
    g.lineWidth = wd;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - Math.cos(a) * r * 0.12, cy - Math.sin(a) * r * 0.12);
    g.lineTo(cx + Math.cos(a) * r * len, cy + Math.sin(a) * r * len);
    g.stroke();
    g.lineCap = 'butt';
  };
  if (o.ordered !== null && o.ordered !== undefined) needle(o.ordered, '#1e88e5', r * 0.035, 0.82);
  needle(o.value, dark ? '#ffffff' : '#c62828', r * 0.05, 0.86);
  g.fillStyle = dark ? '#cfe6f5' : '#222';
  g.beginPath();
  g.arc(cx, cy, r * 0.07, 0, Math.PI * 2);
  g.fill();
  if (o.digits !== undefined) {
    g.fillStyle = dark ? '#000' : '#101418';
    const displayWidth = r * (o.unit === 'nós' ? 1.7 : 0.68);
    g.fillRect(cx - displayWidth / 2, cy + r * 0.44, displayWidth, r * 0.22);
    text(g, o.unit === 'nós' ? fmtKnots(o.value, o.digits) : o.value.toFixed(o.digits), cx, cy + r * 0.555, r * (o.unit === 'nós' ? 0.11 : 0.17), '#7dff9c', 'center', 'bold', true);
  }
}

/** mostrador digital (LCD verde) */
export function digital(g: G, x: number, y: number, w: number, h: number, s: string, color = '#7dff9c', label?: string): void {
  g.fillStyle = '#020806';
  rrect(g, x, y, w, h, 4);
  g.fill();
  g.strokeStyle = '#2a3a33';
  g.lineWidth = 2;
  g.stroke();
  if (label) {
    text(g, label, x + 8, y + 12, Math.max(13, Math.min(16, h * 0.22)), '#7fa293', 'left', 'bold', false, w - 16);
    text(g, s, x + w - 10, y + h * 0.6, h * 0.56, color, 'right', 'bold', true, w - 16);
  } else text(g, s, x + w - 10, y + h / 2 + 1, h * 0.62, color, 'right', 'bold', true, w - 16);
}

/** barra horizontal com fração */
export function hbar(g: G, x: number, y: number, w: number, h: number, frac: number, color: string, mark?: number): void {
  g.fillStyle = '#0a1520';
  g.fillRect(x, y, w, h);
  g.fillStyle = color;
  g.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  if (mark !== undefined) {
    g.fillStyle = '#fff';
    g.fillRect(x + w * Math.max(0, Math.min(1, mark)) - 1, y - 3, 3, h + 6);
  }
  g.strokeStyle = C.line;
  g.lineWidth = 1.5;
  g.strokeRect(x, y, w, h);
}

/** tubulação do diagrama; com vazão, traços animados no sentido indicado */
export function pipe(g: G, pts: [number, number][], color: string, w: number, flow = 0, now = 0): void {
  g.strokeStyle = '#0a1a24';
  g.lineWidth = w + 4;
  g.lineJoin = 'round';
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.strokeStyle = flow ? color : shade(color.startsWith('#') ? color : '#335566', -60);
  g.lineWidth = w;
  g.stroke();
  if (flow) {
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = Math.max(2, w * 0.35);
    g.setLineDash([10, 14]);
    g.lineDashOffset = -Math.sign(flow) * ((now * 60) % 24);
    g.stroke();
    g.setLineDash([]);
  }
}

/** símbolo de válvula (gravata): verde = aberta, cinza = fechada, vermelho = travada, âmbar = em curso */
export function valveSym(g: G, x: number, y: number, s: number, status: string, vertical = false): void {
  const col = status === 'ABERTA' ? C.real : status === 'TRAVADA' ? C.alarm : status === 'FECHADA' ? '#53667a' : C.warn;
  g.save();
  g.translate(x, y);
  if (vertical) g.rotate(Math.PI / 2);
  g.fillStyle = status === 'FECHADA' ? '#1a2a38' : col;
  g.strokeStyle = col;
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(-s, -s * 0.7);
  g.lineTo(s, s * 0.7);
  g.lineTo(s, -s * 0.7);
  g.lineTo(-s, s * 0.7);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
}

/** símbolo de bomba (círculo com triângulo), girando quando em operação */
export function pumpSym(g: G, x: number, y: number, r: number, speed: number, failed: boolean, now: number): void {
  const col = failed ? C.alarm : speed > 0.05 ? C.real : '#53667a';
  g.fillStyle = '#0d1d2a';
  g.strokeStyle = col;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.save();
  g.translate(x, y);
  g.rotate(speed > 0.05 ? now * 6 * speed : 0);
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(r * 0.6, 0);
  g.lineTo(-r * 0.35, -r * 0.5);
  g.lineTo(-r * 0.35, r * 0.5);
  g.closePath();
  g.fill();
  g.restore();
}

/** tanque com nível de água */
export function tankSym(g: G, x: number, y: number, w: number, h: number, frac: number, label: string, sub?: string, airFrac?: number): void {
  g.fillStyle = '#0b1722';
  rrect(g, x, y, w, h, 6);
  g.fill();
  const f = Math.max(0, Math.min(1, frac));
  if (airFrac !== undefined) {
    g.fillStyle = 'rgba(232,226,176,0.35)';
    g.fillRect(x + 2, y + 2, w - 4, (h - 4) * (1 - f));
  }
  const grd = g.createLinearGradient(0, y, 0, y + h);
  grd.addColorStop(0, '#3fa0f0');
  grd.addColorStop(1, '#14518c');
  g.fillStyle = grd;
  g.fillRect(x + 2, y + 2 + (h - 4) * (1 - f), w - 4, (h - 4) * f);
  g.strokeStyle = '#7fa6c4';
  g.lineWidth = 2;
  rrect(g, x, y, w, h, 6);
  g.stroke();
  text(g, label, x + w / 2, y - 14, Math.min(22, w * 0.2), C.text, 'center', 'bold');
  text(g, `${Math.round(f * 100)}%`, x + w / 2, y + h / 2, Math.min(24, w * 0.22, h * 0.45), '#ffffff', 'center', 'bold', true);
  if (sub) text(g, sub, x + w / 2, y + h + 15, Math.min(17, w * 0.16), '#a9c3d6', 'center');
}

/** rosa dos ventos com rumo atual (proa para cima) e marca do rumo ordenado */
export function compass(g: G, cx: number, cy: number, r: number, hdg: number, ordered: number | null, rot?: number): void {
  g.fillStyle = '#06121b';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = C.line;
  g.lineWidth = 2;
  g.stroke();
  const toA = (b: number) => ((b - hdg - 90) * Math.PI) / 180;
  for (let b = 0; b < 360; b += 5) {
    const a = toA(b);
    const maj = b % 30 === 0;
    const r1 = r * (maj ? 0.82 : b % 10 === 0 ? 0.88 : 0.92);
    g.strokeStyle = maj ? '#e9f6ff' : '#6f8da5';
    g.lineWidth = maj ? 2.5 : 1.2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    g.lineTo(cx + Math.cos(a) * r * 0.97, cy + Math.sin(a) * r * 0.97);
    g.stroke();
    if (maj) {
      const lbl = b === 0 ? 'N' : b === 90 ? 'L' : b === 180 ? 'S' : b === 270 ? 'O' : String(b / 10).padStart(2, '0');
      text(g, lbl, cx + Math.cos(a) * r * 0.68, cy + Math.sin(a) * r * 0.68, r * (b % 90 === 0 ? 0.13 : 0.1), b % 90 === 0 ? C.warn : '#cfe6f5', 'center', 'bold');
    }
  }
  if (ordered !== null) {
    const a = toA(ordered);
    g.fillStyle = C.cmd;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r * 0.99, cy + Math.sin(a) * r * 0.99);
    g.lineTo(cx + Math.cos(a + 0.07) * r * 0.86, cy + Math.sin(a + 0.07) * r * 0.86);
    g.lineTo(cx + Math.cos(a - 0.07) * r * 0.86, cy + Math.sin(a - 0.07) * r * 0.86);
    g.closePath();
    g.fill();
  }
  // linha de fé (proa)
  g.strokeStyle = C.warn;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx, cy - r * 1.04);
  g.lineTo(cx, cy - r * 0.55);
  g.stroke();
  if (rot !== undefined && Math.abs(rot) > 0.02) {
    // taxa de guinada: arco
    g.strokeStyle = C.real;
    g.lineWidth = 5;
    g.beginPath();
    const k = Math.max(-1, Math.min(1, rot / 1.5)) * 0.9;
    g.arc(cx, cy, r * 0.5, -Math.PI / 2, -Math.PI / 2 + k, k < 0);
    g.stroke();
  }
}

/**
 * Indicador de ângulo de leme (semicírculo): comandado (ciano) e real
 * (verde). `max` = batente; rótulos nos extremos.
 */
export function angleArc(g: G, cx: number, cy: number, r: number, cmdA: number, real: number, max: number, left: string, right: string, title: string, vertical = false): void {
  g.save();
  g.translate(cx, cy);
  if (vertical) g.rotate(-Math.PI / 2);
  const toA = (v: number) => -Math.PI / 2 + (Math.max(-max, Math.min(max, v)) / max) * (Math.PI * 0.42);
  g.strokeStyle = '#2a4a63';
  g.lineWidth = r * 0.16;
  g.beginPath();
  g.arc(0, 0, r, toA(-max), toA(max));
  g.stroke();
  for (let v = -max; v <= max + 1e-6; v += max / (max >= 30 ? 6 : 5)) {
    const a = toA(v);
    g.strokeStyle = '#9fb4c6';
    g.lineWidth = Math.abs(v) < 1e-6 ? 3 : 1.5;
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
    g.lineTo(Math.cos(a) * r * 1.12, Math.sin(a) * r * 1.12);
    g.stroke();
  }
  // comandado
  const ac = toA(cmdA);
  g.fillStyle = C.cmd;
  g.beginPath();
  g.moveTo(Math.cos(ac) * r * 1.22, Math.sin(ac) * r * 1.22);
  g.lineTo(Math.cos(ac + 0.06) * r * 1.42, Math.sin(ac + 0.06) * r * 1.42);
  g.lineTo(Math.cos(ac - 0.06) * r * 1.42, Math.sin(ac - 0.06) * r * 1.42);
  g.closePath();
  g.fill();
  // real
  const ar = toA(real);
  g.strokeStyle = C.real;
  g.lineWidth = r * 0.07;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(Math.cos(ar) * r * 1.05, Math.sin(ar) * r * 1.05);
  g.stroke();
  g.lineCap = 'butt';
  g.fillStyle = '#cfe6f5';
  g.beginPath();
  g.arc(0, 0, r * 0.08, 0, Math.PI * 2);
  g.fill();
  g.restore();
  if (vertical) {
    text(g, left, cx - r * 0.25, cy - r * 1.32, Math.max(18, r * 0.22), '#a9c3d6', 'center', 'bold');
    text(g, right, cx - r * 0.25, cy + r * 1.32, Math.max(18, r * 0.22), '#a9c3d6', 'center', 'bold');
    if (title) text(g, title, cx - r * 0.2, cy - r * 1.32, Math.max(20, r * 0.24), C.text, 'center', 'bold');
    text(g, `${Math.abs(real).toFixed(1)}°`, cx + r * 0.22, cy + r * 0.0, Math.max(26, r * 0.32), C.real, 'left', 'bold', true);
  } else {
    text(g, left, cx - r * 1.08, cy - r * 0.2, Math.max(20, r * 0.2), '#a9c3d6', 'center', 'bold');
    text(g, right, cx + r * 1.08, cy - r * 0.2, Math.max(20, r * 0.2), '#a9c3d6', 'center', 'bold');
    if (title) text(g, title, cx, cy - r * 1.55, Math.max(20, r * 0.2), C.text, 'center', 'bold');
    text(g, `${Math.abs(real).toFixed(1)}°`, cx, cy + r * 0.32, Math.max(28, r * 0.28), C.real, 'center', 'bold', true);
  }
}

/** silhueta do submarino inclinada (indicador de pitch/banda) */
export function subSilhouette(g: G, cx: number, cy: number, len: number, angDeg: number, color: string, front = false): void {
  g.save();
  g.translate(cx, cy);
  g.rotate((-angDeg * Math.PI) / 180);
  g.fillStyle = color;
  if (front) {
    g.beginPath();
    g.arc(0, 0, len * 0.22, 0, Math.PI * 2);
    g.fill();
    g.fillRect(-len * 0.05, -len * 0.42, len * 0.1, len * 0.22);
    g.fillRect(-len * 0.38, -len * 0.02, len * 0.76, len * 0.04);
  } else {
    const h = len * 0.12;
    g.beginPath();
    g.ellipse(0, 0, len / 2, h / 2, 0, 0, Math.PI * 2);
    g.fill();
    g.fillRect(len * 0.08, -h * 1.25, len * 0.14, h * 0.9);
    g.fillRect(-len * 0.52, -h * 0.9, len * 0.04, h * 1.8);
  }
  g.restore();
}

/** passos +/− para ajustar um valor (botões de toque em fila) */
export function stepper(c: DrawCtx, id: string, x: number, y: number, h: number, steps: number[], cur: number, fmtV: (v: number) => string, set: (v: number) => void, what: string, bw = 54): number {
  let xx = x;
  for (const s of steps.filter((v) => v < 0)) {
    button(c, { id: `${id}${s}`, x: xx, y, w: bw, h, label: String(s), tip: `${what}: ${s > 0 ? '+' : ''}${s} → ${fmtV(cur + s)}`, action: () => set(cur + s), tone: 'neutral', size: Math.min(24, h * 0.46) });
    xx += bw + 6;
  }
  digital(c.g, xx, y, 132, h, fmtV(cur));
  xx += 138;
  for (const s of steps.filter((v) => v > 0)) {
    button(c, { id: `${id}+${s}`, x: xx, y, w: bw, h, label: `+${s}`, tip: `${what}: +${s} → ${fmtV(cur + s)}`, action: () => set(cur + s), tone: 'neutral', size: Math.min(24, h * 0.46) });
    xx += bw + 6;
  }
  return xx;
}
