/**
 * TEXTURAS PROCEDURAIS da sala de comando (desenhadas em canvas, sem
 * arquivos externos): piso de tábuas (como nas salas de controle modernas),
 * pintura metálica com leve granulação, frente de bastidores eletrônicos com
 * LEDs, revestimento aluminizado dos dutos, tecido azul das cadeiras e chapas
 * do teto. Apenas visual.
 */
import * as THREE from 'three';

/** gerador pseudoaleatório determinístico (as texturas saem sempre iguais) */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeat: [number, number] = [1, 1], srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** granulação suave sobre uma cor de base (pintura) */
function grain(g: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number): void {
  const r = rng(seed);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/** libera as texturas (ao destruir a cena) */
export function disposeRoomTextures(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

/** pintura metálica (consoles, anteparas): cor de base + granulação + leves manchas */
export function paintTexture(color: string, seed = 1, rep: [number, number] = [1, 1]): THREE.Texture {
  return cached(`paint:${color}:${seed}:${rep}`, () => {
    const [c, g] = canvas(256, 256);
    g.fillStyle = color;
    g.fillRect(0, 0, 256, 256);
    const r = rng(seed);
    for (let i = 0; i < 18; i++) {
      g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${0.015 + r() * 0.03})`;
      g.beginPath();
      g.ellipse(r() * 256, r() * 256, 20 + r() * 60, 10 + r() * 40, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    grain(g, 256, 256, 10, seed + 7);
    return tex(c, rep);
  });
}

/** piso: tábuas de madeira/vinílico marrom com juntas escuras (como na foto de referência) */
export function deckTexture(): THREE.Texture {
  return cached('deck', () => {
    const W = 512;
    const H = 512;
    const [c, g] = canvas(W, H);
    const r = rng(42);
    const plankH = 64;
    for (let row = 0; row < H / plankH; row++) {
      let x = -r() * 200;
      while (x < W) {
        const len = 180 + r() * 220;
        const base = 92 + r() * 26;
        g.fillStyle = `rgb(${base + 8},${base * 0.66},${base * 0.42})`;
        g.fillRect(x, row * plankH, len, plankH);
        // veios
        for (let k = 0; k < 9; k++) {
          g.strokeStyle = `rgba(40,22,10,${0.08 + r() * 0.12})`;
          g.lineWidth = 0.6 + r() * 1.4;
          g.beginPath();
          const y0 = row * plankH + r() * plankH;
          g.moveTo(x, y0);
          for (let t = 0; t <= 1; t += 0.1) g.lineTo(x + len * t, y0 + Math.sin(t * 6 + k) * (2 + r() * 3));
          g.stroke();
        }
        g.fillStyle = 'rgba(20,12,6,0.85)';
        g.fillRect(x + len - 2, row * plankH, 2, plankH);
        x += len;
      }
      g.fillStyle = 'rgba(18,10,5,0.9)';
      g.fillRect(0, row * plankH + plankH - 2, W, 2);
    }
    grain(g, W, H, 14, 3);
    return tex(c, [3, 7]);
  });
}

/** frente de bastidor eletrônico: grades de ventilação, módulos, LEDs verdes/âmbar e puxadores */
export function rackTexture(seed = 5): THREE.Texture {
  return cached(`rack:${seed}`, () => {
    const W = 256;
    const H = 512;
    const [c, g] = canvas(W, H);
    const r = rng(seed);
    g.fillStyle = '#1d2024';
    g.fillRect(0, 0, W, H);
    let y = 10;
    while (y < H - 20) {
      const h = [36, 48, 64, 90][Math.floor(r() * 4)];
      g.fillStyle = r() > 0.5 ? '#25292e' : '#2b3035';
      g.fillRect(10, y, W - 20, h - 4);
      g.strokeStyle = '#0d0f11';
      g.strokeRect(10.5, y + 0.5, W - 21, h - 5);
      const kind = r();
      if (kind < 0.35) {
        // grade de ventilação
        g.fillStyle = '#0c0d0f';
        for (let k = 0; k < (h - 14) / 5; k++) g.fillRect(24, y + 6 + k * 5, W - 48, 2);
      } else {
        // LEDs e chaves
        const n = 3 + Math.floor(r() * 8);
        for (let k = 0; k < n; k++) {
          const col = r() > 0.82 ? '#ffb020' : r() > 0.1 ? '#36e27a' : '#ff3030';
          g.fillStyle = col;
          g.beginPath();
          g.arc(26 + k * 18, y + 12, 3, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = '#9aa3ad';
        g.font = '9px Arial';
        g.fillText(['PWR', 'CPU', 'NET', 'I/O', 'SYNC', 'COM'][Math.floor(r() * 6)], 26, y + h - 12);
        g.fillStyle = '#5d646c';
        g.fillRect(W - 40, y + 8, 14, h - 20);
      }
      // puxadores
      g.fillStyle = '#7c848c';
      g.fillRect(14, y + h / 2 - 8, 4, 12);
      g.fillRect(W - 18, y + h / 2 - 8, 4, 12);
      y += h;
    }
    return tex(c);
  });
}

/** máscara emissiva do bastidor (só os LEDs brilham) — mesma geometria da textura */
export function rackGlowTexture(seed = 5): THREE.Texture {
  return cached(`rackglow:${seed}`, () => {
    const W = 256;
    const H = 512;
    const [c, g] = canvas(W, H);
    const r = rng(seed);
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    let y = 10;
    while (y < H - 20) {
      const h = [36, 48, 64, 90][Math.floor(r() * 4)];
      r();
      const kind = r();
      if (kind >= 0.35) {
        const n = 3 + Math.floor(r() * 8);
        for (let k = 0; k < n; k++) {
          const col = r() > 0.82 ? '#ffb020' : r() > 0.1 ? '#36e27a' : '#ff3030';
          g.fillStyle = col;
          g.beginPath();
          g.arc(26 + k * 18, y + 12, 3.4, 0, Math.PI * 2);
          g.fill();
        }
        r();
      }
      y += h;
    }
    return tex(c);
  });
}

/** revestimento isolante aluminizado dos dutos de ventilação (faixas e costuras) */
export function foilTexture(): THREE.Texture {
  return cached('foil', () => {
    const [c, g] = canvas(256, 256);
    const grd = g.createLinearGradient(0, 0, 256, 0);
    grd.addColorStop(0, '#9aa0a6');
    grd.addColorStop(0.5, '#cfd3d6');
    grd.addColorStop(1, '#8d939a');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    const r = rng(9);
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = `rgba(${r() > 0.5 ? '255,255,255' : '40,44,48'},${0.05 + r() * 0.08})`;
      g.lineWidth = 1 + r() * 3;
      g.beginPath();
      const x = r() * 256;
      g.moveTo(x, 0);
      g.bezierCurveTo(x + r() * 30 - 15, 80, x + r() * 30 - 15, 170, x + r() * 20 - 10, 256);
      g.stroke();
    }
    g.fillStyle = 'rgba(60,64,70,0.55)';
    g.fillRect(0, 0, 256, 5);
    g.fillRect(0, 128, 256, 3);
    grain(g, 256, 256, 12, 11);
    return tex(c);
  });
}

/** tecido das cadeiras (azul) */
export function fabricTexture(color = '#2a5aa8'): THREE.Texture {
  return cached(`fabric:${color}`, () => {
    const [c, g] = canvas(128, 128);
    g.fillStyle = color;
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 2) {
      g.fillStyle = `rgba(0,0,0,${y % 4 ? 0.08 : 0.02})`;
      g.fillRect(0, y, 128, 1);
    }
    for (let x = 0; x < 128; x += 2) {
      g.fillStyle = `rgba(255,255,255,${x % 4 ? 0.04 : 0.0})`;
      g.fillRect(x, 0, 1, 128);
    }
    grain(g, 128, 128, 16, 21);
    return tex(c, [2, 2]);
  });
}

/** forro/teto escuro com chapas perfuradas */
export function ceilingTexture(): THREE.Texture {
  return cached('ceiling', () => {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#3b4046';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 6; y < 256; y += 10) for (let x = 6 + ((y / 10) % 2) * 5; x < 256; x += 10) g.fillRect(x, y, 3, 3);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, 0, 256, 3);
    g.fillRect(0, 0, 3, 256);
    grain(g, 256, 256, 10, 13);
    return tex(c, [6, 10]);
  });
}

/** isolamento do casco (anteparas laterais): painéis claros com juntas */
export function hullLiningTexture(): THREE.Texture {
  return cached('lining', () => {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#c9cdc9';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, 0, 256, 2);
    g.fillRect(0, 0, 2, 256);
    const r = rng(17);
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(0,0,0,${0.01 + r() * 0.03})`;
      g.fillRect(r() * 256, r() * 256, 2 + r() * 30, 1 + r() * 4);
    }
    // parafusos
    g.fillStyle = 'rgba(60,60,60,0.5)';
    for (const [x, y] of [
      [10, 10],
      [246, 10],
      [10, 246],
      [246, 246],
    ])
      g.fillRect(x - 2, y - 2, 4, 4);
    grain(g, 256, 256, 9, 19);
    return tex(c, [14, 3]);
  });
}

/** chapa de piso antiderrapante (plataforma do periscópio, degraus) */
export function treadTexture(): THREE.Texture {
  return cached('tread', () => {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#5d636a';
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 16)
      for (let x = 0; x < 128; x += 16) {
        g.save();
        g.translate(x + 8, y + 8);
        g.rotate(((x + y) / 16) % 2 ? Math.PI / 4 : -Math.PI / 4);
        g.fillStyle = '#7b828a';
        g.fillRect(-6, -1.5, 12, 3);
        g.restore();
      }
    grain(g, 128, 128, 14, 23);
    return tex(c, [3, 3]);
  });
}

/** placa de identificação gravada (texto branco sobre preto ou preto sobre metal) */
export function labelTexture(text: string, opts: { bg?: string; fg?: string; w?: number; h?: number; size?: number } = {}): THREE.Texture {
  const w = opts.w ?? 512;
  const h = opts.h ?? 96;
  return cached(`label:${text}:${opts.bg}:${opts.fg}:${w}x${h}`, () => {
    const [c, g] = canvas(w, h);
    g.fillStyle = opts.bg ?? '#16191c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 3;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = opts.fg ?? '#f2f2ea';
    g.font = `bold ${opts.size ?? Math.round(h * 0.42)}px Arial`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2, w - 20);
    const t = tex(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}
