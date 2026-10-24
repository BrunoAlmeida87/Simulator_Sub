/**
 * Imagens do teste visual: leitura/gravação de PNG, redução, checagem de cena em branco e comparação com tolerância.
 * Sem navegador: dá para testar rápido (tests/visualCompare.test.mjs).
 */
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/** tolerâncias padrão (ver docs/OPERACAO.md): pixel, fração da imagem toda, fração de uma janela, lado da janela */
export const DEFAULTS = { threshold: 0.1, maxDiff: 0.01, maxWindow: 0.35, window: 16 };

export const decode = (buf) => PNG.sync.read(buf);
export const encode = (png) => PNG.sync.write(png, { colorType: 2, deflateLevel: 9 });

/** média 2×2: reduz o ruído da renderização por software e o peso das referências */
export function downscale2(src) {
  const w = src.width >> 1;
  const h = src.height >> 1;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        const i = (2 * y * src.width + 2 * x) * 4 + c;
        out.data[(y * w + x) * 4 + c] = (src.data[i] + src.data[i + 4] + src.data[i + src.width * 4] + src.data[i + src.width * 4 + 4] + 2) >> 2;
      }
  return out;
}

/** cena em branco: quase uma cor só (desvio-padrão do brilho baixo ou poucas cores distintas) na região dada */
export function blankStats(png, rect) {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(png.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(png.height, Math.ceil(rect.y + rect.height));
  let n = 0;
  let sum = 0;
  let sum2 = 0;
  const colors = new Set();
  for (let y = y0; y < y1; y += 2)
    for (let x = x0; x < x1; x += 2) {
      const i = (y * png.width + x) * 4;
      const l = 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
      n++;
      sum += l;
      sum2 += l * l;
      colors.add(((png.data[i] >> 3) << 10) | ((png.data[i + 1] >> 3) << 5) | (png.data[i + 2] >> 3));
    }
  const mean = sum / Math.max(1, n);
  const std = Math.sqrt(Math.max(0, sum2 / Math.max(1, n) - mean * mean));
  return { std, colors: colors.size, blank: std < 3 || colors.size < 16 };
}

/**
 * Compara duas imagens do mesmo tamanho. Devolve a fração de pixels diferentes na imagem toda (`ratio`), a maior fração
 * dentro de uma janela `window`×`window` (`windowRatio`: pega mancha localizada que a média esconderia), a imagem de diferença
 * e se passou nos limites `threshold`/`maxDiff`/`maxWindow`.
 */
export function compare(ref, act, opts = {}, mask) {
  const cfg = { ...DEFAULTS, ...opts };
  const { width: w, height: h } = ref;
  const diff = new PNG({ width: w, height: h });
  const base = { threshold: cfg.threshold, ignoreMask: mask };
  const total = pixelmatch(ref.data, act.data, diff.data, w, h, base);
  const win = Math.min(cfg.window, w, h);
  const inWindow = pixelmatch(ref.data, act.data, null, w, h, { ...base, windowSize: win });
  const px = w * h - (mask ? mask.reduce((a, v) => a + (v ? 1 : 0), 0) : 0);
  const ratio = total / Math.max(1, px);
  const windowRatio = inWindow / (win * win);
  return { total, ratio, windowRatio, diff, pass: ratio <= cfg.maxDiff && windowRatio <= cfg.maxWindow };
}
