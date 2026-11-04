import { clamp } from '../types';
import { frontLoss, physical, pointAtTime, type FrontPoint, type LabRay, type LabResult } from './model';

/** Desenho do laboratório acústico (canvas 2D). Só lê o resultado do modelo. */
export interface LabGeo {
  w: number;
  h: number;
  x0: number;
  x1: number;
  y0: number;
  yb: number;
  px0: number;
  px1: number;
  range: number;
  D: number;
}

export interface LabShow {
  front: boolean;
  rays: boolean;
  field: boolean;
  shadow: boolean;
}

export const LAB_COLORS = { front: '#8af4ff', echo: '#ff7ad9', ray: '#a9dbe8', thermo: '#c9a6ff', sub: '#d9f6ff', target: '#ffd0f1' };

export function labGeometry(w: number, h: number, res: LabResult): LabGeo {
  const narrow = w < 560;
  const P = clamp(w * 0.17, narrow ? 64 : 92, 190);
  const x0 = narrow ? 40 : 52;
  const x1 = w - P - (narrow ? 8 : 16);
  return { w, h, x0, x1, y0: 28, yb: h - 42, px0: x1 + (narrow ? 8 : 16), px1: w - 8, range: res.setup.range, D: res.depth };
}
export const gx = (g: LabGeo, r: number) => g.x0 + (r / g.range) * (g.x1 - g.x0);
export const gy = (g: LabGeo, z: number) => g.y0 + (z / g.D) * (g.yb - g.y0);
export const rOf = (g: LabGeo, x: number) => ((x - g.x0) / (g.x1 - g.x0)) * g.range;
export const zOf = (g: LabGeo, y: number) => ((y - g.y0) / (g.yb - g.y0)) * g.D;

const fmtKm = (m: number) => {
  const k = m / 1000;
  const d = k >= 10 || Number.isInteger(k) ? 0 : Number.isInteger(k * 10) ? 1 : 2;
  return `${k.toFixed(d).replace('.', ',')} km`;
};
export const fmt = (v: number, d = 0) => v.toFixed(d).replace('.', ',');

/** cor da intensidade do som (perda de transmissão) — escala azul → ciano → branco */
function ramp(loss: number): [number, number, number] {
  // escura de propósito: a frente de onda, os raios e o eco ficam por cima
  const v = clamp((108 - loss) / 50, 0, 1);
  const stops: [number, [number, number, number]][] = [
    [0, [5, 14, 24]],
    [0.4, [9, 44, 64]],
    [0.75, [20, 92, 118]],
    [1, [58, 150, 170]],
  ];
  for (let i = 1; i < stops.length; i++)
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1],
        [b, cb] = stops[i];
      const f = (v - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
    }
  return stops[stops.length - 1][1];
}

function niceStep(span: number, target: number): number {
  const raw = span / target,
    p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= raw) ?? 10 * p;
}

/** Camada fixa (muda só com o resultado ou o tamanho): água, intensidade, sombra, superfície, fundo, eixos, perfil. */
export function drawStatic(ctx: CanvasRenderingContext2D, g: LabGeo, res: LabResult, show: LabShow): void {
  const { w, h, x0, x1, y0, yb } = g;
  const s = res.setup;
  ctx.clearRect(0, 0, w, h);
  // céu e água
  const sky = ctx.createLinearGradient(0, 0, 0, y0);
  sky.addColorStop(0, '#0b1a26');
  sky.addColorStop(1, '#16344a');
  ctx.fillStyle = sky;
  ctx.fillRect(x0, 0, x1 - x0, y0);
  ctx.fillStyle = '#061420';
  ctx.fillRect(x0, y0, x1 - x0, yb - y0);
  const { cols, rows, loss } = res.field;
  if (show.field) {
    const img = new ImageData(cols, rows);
    for (let i = 0; i < cols * rows; i++) {
      const [r, gg, b] = loss[i] === Infinity ? [6, 18, 28] : ramp(loss[i]);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = gg;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    const off = document.createElement('canvas');
    off.width = cols;
    off.height = rows;
    off.getContext('2d')!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, x0, y0, x1 - x0, yb - y0);
  } else {
    const water = ctx.createLinearGradient(0, y0, 0, yb);
    water.addColorStop(0, '#0d3247');
    water.addColorStop(1, '#061420');
    ctx.fillStyle = water;
    ctx.fillRect(x0, y0, x1 - x0, yb - y0);
  }
  if (show.shadow) drawShadow(ctx, g, res);
  // superfície
  ctx.strokeStyle = '#9fd3ee';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = x0; x <= x1; x += 4) ctx.lineTo(x, y0 - 1.5 * Math.sin(x * 0.09));
  ctx.stroke();
  ctx.fillStyle = '#8fb6cc';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('superfície', x0 + 4, y0 - 8);
  // fundo
  const sed = ctx.createLinearGradient(0, yb, 0, yb + 14);
  sed.addColorStop(0, '#6b5d44');
  sed.addColorStop(1, '#2c271e');
  ctx.fillStyle = sed;
  ctx.fillRect(x0, yb, x1 - x0, 14);
  ctx.fillStyle = '#cdbb98';
  ctx.textAlign = 'right';
  ctx.fillText(`fundo ${fmt(s.bottomDepth)} m`, x1 - 4, yb + 11);
  // termoclina
  if (!s.uniform && s.thermoclineDepth < s.bottomDepth) {
    const y = gy(g, s.thermoclineDepth);
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = LAB_COLORS.thermo;
    const th = Math.max(2, gy(g, s.thermoclineDepth + s.thermoclineThickness) - y);
    ctx.fillRect(x0, y - th, x1 - x0, 2 * th);
    ctx.restore();
    ctx.strokeStyle = LAB_COLORS.thermo;
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = LAB_COLORS.thermo;
    ctx.textAlign = 'right';
    ctx.fillText(`termoclina ${fmt(s.thermoclineDepth)} m`, x1 - 4, y - 5);
  }
  // eixos
  ctx.fillStyle = '#7f9db0';
  ctx.strokeStyle = 'rgba(160,200,220,0.12)';
  ctx.lineWidth = 1;
  const rs = niceStep(s.range, w < 560 ? 4 : 8);
  ctx.textAlign = 'center';
  for (let r = 0; r <= s.range + 1; r += rs) {
    const x = gx(g, r);
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, yb);
    ctx.stroke();
    ctx.fillText(r === 0 ? '0' : fmtKm(r), x, yb + 28);
  }
  const zs = niceStep(s.bottomDepth, 5);
  ctx.textAlign = 'right';
  for (let z = 0; z <= s.bottomDepth + 0.1; z += zs) {
    const y = gy(g, z);
    ctx.fillText(`${fmt(z)} m`, x0 - 6, y + 4);
  }
  // exagero vertical
  const ex = s.range / (x1 - x0) / (s.bottomDepth / (yb - y0));
  ctx.textAlign = 'right';
  ctx.fillStyle = '#6f8fa3';
  const exText = ex >= 10 ? fmt(ex) : fmt(ex, 1);
  ctx.fillText(w < 560 ? `prof. ×${exText}` : `distância ${fmtKm(s.range)} · profundidade ampliada ×${exText}`, x1, 13);
  drawProfile(ctx, g, res);
}

function drawShadow(ctx: CanvasRenderingContext2D, g: LabGeo, res: LabResult): void {
  const { cols, rows } = res.field;
  const mask = res.shadowMask;
  if (!mask.some((v) => v)) return;
  const { x0, x1, y0, yb } = g;
  const W = Math.max(1, Math.round(x1 - x0)),
    H = Math.max(1, Math.round(yb - y0));
  const m = document.createElement('canvas');
  m.width = cols;
  m.height = rows;
  const img = new ImageData(cols, rows);
  for (let i = 0; i < cols * rows; i++) img.data[i * 4 + 3] = mask[i] ? 255 : 0;
  m.getContext('2d')!.putImageData(img, 0, 0);
  const layer = document.createElement('canvas');
  layer.width = W;
  layer.height = H;
  const lc = layer.getContext('2d')!;
  lc.imageSmoothingEnabled = true;
  lc.drawImage(m, 0, 0, W, H);
  lc.globalCompositeOperation = 'source-in';
  lc.fillStyle = 'rgba(2,6,12,0.55)';
  lc.fillRect(0, 0, W, H);
  lc.globalCompositeOperation = 'source-atop';
  lc.strokeStyle = 'rgba(190,205,225,0.28)';
  lc.lineWidth = 1;
  lc.beginPath();
  for (let d = -H; d < W; d += 9) {
    lc.moveTo(d, H);
    lc.lineTo(d + H, 0);
  }
  lc.stroke();
  ctx.drawImage(layer, x0, y0);
  if (res.shadow) {
    const x = gx(g, res.shadow.r),
      y = gy(g, res.shadow.z);
    const title = 'ZONA DE SOMBRA',
      sub = 'o som direto não chega aqui';
    ctx.font = 'bold 12px system-ui, sans-serif';
    const titleW = ctx.measureText(title).width;
    ctx.font = '11px system-ui, sans-serif';
    const tw = Math.max(titleW, ctx.measureText(sub).width) + 16;
    const bx = clamp(x - tw / 2, x0 + 2, x1 - tw - 2),
      by = clamp(y - 18, y0 + 2, yb - 38);
    ctx.fillStyle = 'rgba(3,10,18,0.82)';
    ctx.strokeStyle = 'rgba(200,215,235,0.45)';
    ctx.beginPath();
    ctx.roundRect(bx, by, tw, 36, 6);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e6eef7';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(title, bx + tw / 2, by + 15);
    ctx.fillStyle = '#a9bccd';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(sub, bx + tw / 2, by + 29);
  }
}

/** Painel do perfil de velocidade do som, à direita, com o mesmo eixo de profundidade. */
function drawProfile(ctx: CanvasRenderingContext2D, g: LabGeo, res: LabResult): void {
  const { px0, px1, y0, yb } = g;
  const s = res.setup;
  ctx.fillStyle = '#081723';
  ctx.fillRect(px0, y0, px1 - px0, yb - y0);
  ctx.strokeStyle = '#244657';
  ctx.strokeRect(px0 + 0.5, y0 + 0.5, px1 - px0 - 1, yb - y0 - 1);
  const cs = res.profile.map((p) => p.c);
  let lo = Math.min(...cs),
    hi = Math.max(...cs);
  if (hi - lo < 10) {
    const m = (hi + lo) / 2;
    lo = m - 5;
    hi = m + 5;
  }
  lo -= (hi - lo) * 0.12;
  hi += (hi - lo) * 0.12;
  const cx = (c: number) => px0 + 6 + ((c - lo) / (hi - lo)) * (px1 - px0 - 12);
  ctx.strokeStyle = '#e8fbff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  res.profile.forEach((p, i) => (i ? ctx.lineTo(cx(p.c), gy(g, p.z)) : ctx.moveTo(cx(p.c), gy(g, p.z))));
  ctx.stroke();
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = '#9ec3d6';
  ctx.textAlign = 'center';
  const narrow = px1 - px0 < 120;
  ctx.fillText(narrow ? 'som (m/s)' : 'velocidade do som', (px0 + px1) / 2, y0 - 8);
  ctx.fillStyle = '#7f9db0';
  if (narrow) {
    ctx.fillText(`${fmt(lo)}–${fmt(hi)}`, (px0 + px1) / 2, yb + 13);
  } else {
    ctx.textAlign = 'left';
    ctx.fillText(`${fmt(lo)}`, px0 + 2, yb + 13);
    ctx.textAlign = 'right';
    ctx.fillText(`${fmt(hi)} m/s`, px1 - 2, yb + 13);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#6f8fa3';
    ctx.fillText('← mais lento · mais rápido →', (px0 + px1) / 2, yb + 28);
  }
  // marcas: submarino e alvo
  const mark = (z: number, c: number, color: string) => {
    const y = gy(g, z);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx(c), y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  };
  mark(s.subDepth, res.cSub, LAB_COLORS.front);
  mark(s.targetDepth, res.cTarget, LAB_COLORS.echo);
}

/** alça da termoclina no perfil (arrastável) */
export function thermoHandle(g: LabGeo, res: LabResult): { x: number; y: number } | null {
  if (res.setup.uniform) return null;
  return { x: (g.px0 + g.px1) / 2, y: gy(g, res.setup.thermoclineDepth) };
}

function drawSub(ctx: CanvasRenderingContext2D, x: number, y: number, dir: 1 | -1, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, 0, 15, 4.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(1, -9, 6, 6, 1.5);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-15, 0);
  ctx.lineTo(-19, -4);
  ctx.lineTo(-19, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Liga os pontos de vários raios no mesmo instante: a frente de onda, com brilho pela energia do trecho. */
function strokeFront(ctx: CanvasRenderingContext2D, g: LabGeo, rays: LabRay[], t: number, color: string, gain: number, width: number, mapR: (r: number) => number, D: number): void {
  const pts: (FrontPoint | null)[] = rays.map((ray) => pointAtTime(ray, t));
  const losses = new Float64Array(rays.length).fill(Infinity);
  let best = Infinity;
  for (let i = 0; i + 1 < rays.length; i++) {
    const a = pts[i],
      b = pts[i + 1];
    if (!a || !b) continue;
    losses[i] = frontLoss(a, b, rays[i].angle, rays[i + 1].angle);
    best = Math.min(best, losses[i]);
  }
  // brilho relativo à parte mais forte da frente (os ecos múltiplos mais fracos esmaecem),
  // com uma queda suave pela distância (o som enfraquece ao se espalhar)
  const overall = clamp((128 - best) / 45, 0.35, 1);
  const buckets: number[][][] = Array.from({ length: 8 }, () => []);
  for (let i = 0; i + 1 < rays.length; i++) {
    const a = pts[i],
      b = pts[i + 1];
    if (!a || !b) continue;
    const l = losses[i];
    const alpha = clamp(((best + 22 - l) / 22) * overall * gain, 0, 1);
    if (alpha < 0.05) continue;
    const ka = rays[i].k[a.i],
      kb = rays[i + 1].k[b.i];
    const seg: number[] = [gx(g, mapR(a.r)), gy(g, a.z)];
    if (ka !== kb) {
      if (Math.abs(ka - kb) > 1) continue;
      // o trecho atravessa uma reflexão: passa pelo ponto da superfície/fundo
      const uB = Math.max(ka, kb) * D;
      const f = clamp((uB - a.u) / (b.u - a.u || 1), 0, 1);
      seg.push(gx(g, mapR(a.r + (b.r - a.r) * f)), gy(g, physical(uB, ka, D)));
    }
    seg.push(gx(g, mapR(b.r)), gy(g, b.z));
    buckets[Math.min(7, Math.floor(alpha * 8))].push(seg);
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  for (const pass of [
    { w: width * 3.2, a: 0.22 },
    { w: width, a: 1 },
  ]) {
    ctx.lineWidth = pass.w;
    buckets.forEach((segs, k) => {
      if (!segs.length) return;
      ctx.globalAlpha = ((k + 0.5) / 8) * pass.a;
      ctx.beginPath();
      for (const s of segs) {
        ctx.moveTo(s[0], s[1]);
        for (let j = 2; j < s.length; j += 2) ctx.lineTo(s[j], s[j + 1]);
      }
      ctx.stroke();
    });
  }
  ctx.restore();
}

/** índices de raios para desenhar (um a cada ~1,5°, até 18°: os que mostram a curvatura) */
export function raySubset(rays: LabRay[]): number[] {
  const out: number[] = [];
  for (let a = -18; a <= 18.01; a += 1.5) {
    let best = 0,
      d = Infinity;
    rays.forEach((r, i) => {
      if (Math.abs(r.angle - a) < d) {
        d = Math.abs(r.angle - a);
        best = i;
      }
    });
    if (!out.includes(best)) out.push(best);
  }
  return out;
}

export interface LabFrame {
  t: number;
  overview: boolean;
  hover: { x: number; y: number } | null;
  drag: string | null;
}

/** Camada animada: raios até o instante t, isócronas, frente de onda, eco, ícones. */
export function drawDynamic(ctx: CanvasRenderingContext2D, g: LabGeo, res: LabResult, show: LabShow, f: LabFrame, subset: number[]): void {
  const s = res.setup;
  const { x0, x1, y0, yb } = g;
  const t = f.t;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0 - 4, x1 - x0, yb - y0 + 4);
  ctx.clip();
  if (show.rays) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = LAB_COLORS.ray;
    // trecho até a primeira batida no fundo bem visível; depois dela, fraco (o fundo absorve)
    const strong = new Path2D(),
      weak = new Path2D();
    for (const i of subset) {
      const ray = res.rays[i],
        p = ray.points;
      let path = strong;
      for (let j = 0; j < p.length; j++) {
        if (p[j].t > t) {
          const q = pointAtTime(ray, t);
          if (q && j > 0) path.lineTo(gx(g, q.r), gy(g, q.z));
          break;
        }
        const x = gx(g, p[j].r),
          y = gy(g, p[j].z);
        if (j === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
        if (path === strong && ray.nb[j] > 0) {
          path = weak;
          path.moveTo(x, y);
        }
        if (p[j].loss > 105) break;
      }
    }
    ctx.globalAlpha = 0.3;
    ctx.stroke(strong);
    ctx.globalAlpha = 0.08;
    ctx.stroke(weak);
    // caminho mais forte até o alvo (depois que a frente passa por ele)
    if (res.strongest && t >= res.strongest.time) {
      const p = res.rays[res.strongest.ray].points;
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = LAB_COLORS.echo;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      for (let j = 0; j < p.length && p[j].r <= s.targetRange + 1; j++) (j ? ctx.lineTo : ctx.moveTo).call(ctx, gx(g, p[j].r), gy(g, p[j].z));
      ctx.lineTo(gx(g, s.targetRange), gy(g, s.targetDepth));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }
  if (show.front) {
    // isócronas: onde estava a frente a cada segundo
    ctx.font = '10px system-ui, sans-serif';
    for (let sec = 1; sec < t - 0.05; sec++) {
      strokeFront(ctx, g, res.rays, sec, LAB_COLORS.front, 0.22, 0.8, (r) => r, s.bottomDepth);
    }
    if (!f.overview) {
      // rastro curto atrás da frente, para dar a sensação de movimento
      const wake = Math.min(0.2, s.range / 1500 / 40);
      for (let k = 3; k >= 1; k--) strokeFront(ctx, g, res.rays, t - (wake * k) / 3, LAB_COLORS.front, 0.18 * (4 - k), 1.6, (r) => r, s.bottomDepth);
      strokeFront(ctx, g, res.rays, t, LAB_COLORS.front, 1, 2.6, (r) => r, s.bottomDepth);
    }
    // eco: frente saindo do alvo de volta ao submarino
    if (res.strongest && res.echoTime !== null && t > res.strongest.time && !f.overview) {
      const tau = t - res.strongest.time;
      const gain = clamp(0.35 + (res.echoExcess ?? -20) / 25, 0.25, 1.2);
      if (tau <= res.strongest.time + 0.6) strokeFront(ctx, g, res.back, tau, LAB_COLORS.echo, gain, 2, (r) => s.targetRange - r, s.bottomDepth);
    }
  }
  ctx.restore();
  // rótulos das isócronas
  if (show.front) {
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(160,236,248,0.75)';
    ctx.textAlign = 'center';
    for (let sec = 1; sec < t - 0.05; sec++) {
      const ray = res.rays[res.rays.length >> 1];
      const q = pointAtTime(ray, sec);
      if (q && gx(g, q.r) < x1 - 12) ctx.fillText(`${sec} s`, gx(g, q.r), y0 + 12);
    }
  }
  // alvo
  const tx = gx(g, s.targetRange),
    ty = gy(g, s.targetDepth);
  if (res.strongest && Math.abs(t - res.strongest.time) < 0.6 && !f.overview) {
    const k = (t - res.strongest.time + 0.6) / 1.2;
    ctx.strokeStyle = LAB_COLORS.echo;
    ctx.globalAlpha = 1 - k;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tx, ty, 8 + k * 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  drawSub(ctx, tx, ty, -1, LAB_COLORS.target);
  // submarino
  const sx = gx(g, 0),
    sy = gy(g, s.subDepth);
  if (res.echoTime !== null && t >= res.echoTime && t < res.echoTime + 1.4 && !f.overview) {
    const k = (t - res.echoTime) / 1.4;
    ctx.strokeStyle = LAB_COLORS.echo;
    ctx.globalAlpha = 1 - k;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(sx, sy, 10 + k * 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  drawSub(ctx, sx + 4, sy, 1, LAB_COLORS.sub);
  // rótulos dos ícones
  ctx.font = '11px system-ui, sans-serif';
  const label = (text: string, x: number, y: number, align: CanvasTextAlign, color: string) => {
    ctx.textAlign = align;
    const w = ctx.measureText(text).width;
    const bx = align === 'left' ? x : x - w;
    ctx.fillStyle = 'rgba(3,10,18,0.7)';
    ctx.fillRect(bx - 3, y - 11, w + 6, 15);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    return { x0: bx - 3, x1: bx + w + 3, y0: y - 11, y1: y + 4 };
  };
  const subBox = label(`você · ${fmt(s.subDepth)} m`, sx + 22, sy - 8, 'left', LAB_COLORS.sub);
  const tText = `alvo · ${fmtKm(s.targetRange)} · ${fmt(s.targetDepth)} m`;
  const tw = ctx.measureText(tText).width;
  const tLeft = tx - 24 - tw > x0 + 4;
  // se encostar no rótulo do submarino, o do alvo vai para baixo do ícone
  const lx0 = tLeft ? tx - 24 - tw : tx + 24,
    lx1 = lx0 + tw;
  const clash = lx0 < subBox.x1 + 4 && lx1 > subBox.x0 - 4 && Math.abs(ty - sy) < 18;
  label(tText, tLeft ? tx - 24 : tx + 24, clash ? ty + 22 : ty - 8, tLeft ? 'right' : 'left', LAB_COLORS.target);
  // alça da termoclina no perfil
  const th = thermoHandle(g, res);
  if (th) {
    ctx.fillStyle = f.drag === 'thermo' ? '#ffffff' : LAB_COLORS.thermo;
    ctx.strokeStyle = '#1b0f2b';
    ctx.beginPath();
    ctx.arc(th.x, th.y, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1b0f2b';
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('↕', th.x, th.y + 3);
  }
  // mira do ponteiro
  if (f.hover && !f.drag && f.hover.x > x0 && f.hover.x < x1 && f.hover.y > y0 && f.hover.y < yb) {
    ctx.strokeStyle = 'rgba(220,240,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(f.hover.x, y0);
    ctx.lineTo(f.hover.x, yb);
    ctx.moveTo(x0, f.hover.y);
    ctx.lineTo(x1, f.hover.y);
    ctx.stroke();
  }
}

/** valor do campo sob o ponteiro (para a leitura em texto) */
export function probe(g: LabGeo, res: LabResult, x: number, y: number): { r: number; z: number; loss: number; shadow: boolean } | null {
  if (x < g.x0 || x > g.x1 || y < g.y0 || y > g.yb) return null;
  const r = rOf(g, x),
    z = zOf(g, y);
  const { cols, rows, loss } = res.field;
  const c = clamp(Math.floor((r / res.setup.range) * cols), 0, cols - 1),
    row = clamp(Math.floor((z / res.depth) * rows), 0, rows - 1);
  return { r, z, loss: loss[row * cols + c], shadow: !!res.shadowMask[row * cols + c] };
}
