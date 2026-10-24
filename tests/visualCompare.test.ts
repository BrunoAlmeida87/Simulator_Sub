/**
 * Comparação de imagens do teste visual (scripts/visual/imagem.mjs): calibra as tolerâncias com ruído sintético de
 * rasterização (não passa a falso alarme) e confere que regressões de verdade (mancha, bloco, cena em branco) são pegas.
 * Usa uma das referências guardadas como imagem de partida. Não abre navegador.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { DEFAULTS, blankStats, compare, decode, downscale2 } from '../scripts/visual/imagem.mjs';

const base = () => decode(readFileSync(new URL('./visual/referencias/03-zoomout-sepetiba.png', import.meta.url)));

function clone(img: PNG): PNG {
  const c = new PNG({ width: img.width, height: img.height });
  c.data.set(img.data);
  return c;
}

/** gerador pseudoaleatório fixo (o teste precisa ser reproduzível) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addNoise(img: PNG, amp: number, seed: number): PNG {
  const r = rng(seed);
  const c = clone(img);
  for (let i = 0; i < c.data.length; i += 4) for (let k = 0; k < 3; k++) c.data[i + k] = Math.max(0, Math.min(255, c.data[i + k] + Math.round((r() * 2 - 1) * amp)));
  return c;
}

function fillBlock(img: PNG, x0: number, y0: number, w: number, h: number, rgb: number[]): PNG {
  const c = clone(img);
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * c.width + x) * 4;
      c.data[i] = rgb[0];
      c.data[i + 1] = rgb[1];
      c.data[i + 2] = rgb[2];
    }
  return c;
}

describe('Teste visual — comparação com tolerância', () => {
  it('imagem idêntica: nenhuma diferença', () => {
    const ref = base();
    const r = compare(ref, clone(ref));
    expect(r.total).toBe(0);
    expect(r.pass).toBe(true);
  });

  it('ruído de rasterização (±6 níveis por canal em todos os pixels) não dá falso alarme', () => {
    const ref = base();
    const r = compare(ref, addNoise(ref, 6, 1));
    expect(r.ratio).toBeLessThan(DEFAULTS.maxDiff / 5);
    expect(r.pass).toBe(true);
  });

  it('pequena mudança global de brilho (+4 níveis) não dá falso alarme', () => {
    const ref = base();
    const c = clone(ref);
    for (let i = 0; i < c.data.length; i += 4) for (let k = 0; k < 3; k++) c.data[i + k] = Math.min(255, c.data[i + k] + 4);
    expect(compare(ref, c).pass).toBe(true);
  });

  it('bloco de 60×60 com outra cor (artefato visível) é pego', () => {
    const ref = base();
    const r = compare(ref, fillBlock(ref, 200, 150, 60, 60, [255, 0, 255]));
    expect(r.pass).toBe(false);
  });

  it('mancha pequena (24×24, ~0,2 % da imagem) passa na média mas é pega pela janela', () => {
    const ref = base();
    const r = compare(ref, fillBlock(ref, 300, 200, 24, 24, [255, 255, 0]));
    expect(r.ratio).toBeLessThan(DEFAULTS.maxDiff);
    expect(r.windowRatio).toBeGreaterThan(DEFAULTS.maxWindow);
    expect(r.pass).toBe(false);
  });

  it('imagem em branco é detectada; a cena real não', () => {
    const ref = base();
    const branca = clone(ref);
    branca.data.fill(255);
    const area = { x: 0, y: 0, width: ref.width, height: ref.height };
    expect(blankStats(branca, area).blank).toBe(true);
    expect(blankStats(ref, area).blank).toBe(false);
  });

  it('downscale2 reduz pela metade e faz a média', () => {
    const img = new PNG({ width: 4, height: 2 });
    img.data.fill(0);
    for (let c = 0; c < 4; c++) {
      img.data[c] = 100; // (0,0)
      img.data[4 + c] = 200; // (1,0)
    }
    const d = downscale2(img);
    expect([d.width, d.height]).toEqual([2, 1]);
    expect(d.data[0]).toBe(75);
  });

  it('a máscara ignora a região (relógios, números que mudam)', () => {
    const ref = base();
    const alt = fillBlock(ref, 10, 10, 40, 20, [0, 255, 0]);
    const mask = new Uint8Array(ref.width * ref.height);
    for (let y = 10; y < 30; y++) for (let x = 10; x < 50; x++) mask[y * ref.width + x] = 1;
    expect(compare(ref, alt, {}, mask).total).toBe(0);
  });
});
