/**
 * ARTE DA VELA — emblema e inscrição pintados nos dois lados da vela.
 * Desenhados em canvas (texturas), usados pelo modelo 3D e pela
 * pré-visualização nas Configurações. Puramente visual.
 */

export type EmblemKind = 'vasco' | 'nenhum' | 'personalizado';

/** Aparência visual do submarino (identificação + detalhe gráfico). */
export interface Appearance {
  name: string;
  sailText: string;
  sailTextColor: string;
  emblem: EmblemKind;
  emblemImage: string | null;
  finColor: string;
  textures: 'alta' | 'normal';
}

export const DEFAULT_APPEARANCE: Appearance = {
  name: 'S50 Vasco da Gama',
  sailText: 'S50',
  sailTextColor: '#d4161c',
  emblem: 'vasco',
  emblemImage: null,
  finColor: '#e8892b',
  textures: 'alta',
};

/**
 * Emblema ESTILIZADO inspirado no do Club de Regatas Vasco da Gama: escudo
 * preto com borda branca, faixa diagonal branca e a cruz vermelha (cruz da
 * Ordem de Cristo, a “Cruz de Malta” vascaína). Desenho simplificado; a
 * imagem oficial pode ser carregada como emblema personalizado.
 * (cx, cy) = centro; h = altura total.
 */
export function drawVascoEmblem(g: CanvasRenderingContext2D, cx: number, cy: number, h: number): void {
  const w = h * 0.8;
  const top = cy - h / 2;
  const shield = () => {
    g.beginPath();
    g.moveTo(cx - w / 2, top);
    g.lineTo(cx + w / 2, top);
    g.lineTo(cx + w / 2, top + h * 0.52);
    g.bezierCurveTo(cx + w / 2, top + h * 0.8, cx + w * 0.18, top + h * 0.92, cx, top + h);
    g.bezierCurveTo(cx - w * 0.18, top + h * 0.92, cx - w / 2, top + h * 0.8, cx - w / 2, top + h * 0.52);
    g.closePath();
  };
  g.save();
  // sombra/contorno externo branco
  shield();
  g.fillStyle = '#0b0b0b';
  g.fill();
  g.save();
  shield();
  g.clip();
  // faixa diagonal branca (do alto à esquerda para baixo à direita)
  g.translate(cx, cy);
  g.rotate(Math.PI / 4.2);
  g.fillStyle = '#f4f4f4';
  g.fillRect(-h, -h * 0.15, 2 * h, h * 0.3);
  g.restore();
  // cruz pátea vermelha com cruz interna branca
  const s = h * 0.2;
  g.save();
  g.translate(cx, cy + h * 0.02);
  g.fillStyle = '#d4161c';
  g.strokeStyle = '#0b0b0b';
  g.lineWidth = h * 0.012;
  for (let k = 0; k < 4; k++) {
    g.save();
    g.rotate((k * Math.PI) / 2);
    g.beginPath();
    g.moveTo(-s * 0.16, 0);
    g.lineTo(-s * 0.58, -s);
    g.quadraticCurveTo(0, -s * 0.84, s * 0.58, -s);
    g.lineTo(s * 0.16, 0);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
  g.strokeStyle = '#ffffff';
  g.lineWidth = h * 0.028;
  g.beginPath();
  g.moveTo(0, -s * 0.78);
  g.lineTo(0, s * 0.78);
  g.moveTo(-s * 0.78, 0);
  g.lineTo(s * 0.78, 0);
  g.stroke();
  g.restore();
  // bordas
  shield();
  g.lineWidth = h * 0.045;
  g.strokeStyle = '#f4f4f4';
  g.stroke();
  g.restore();
}

const imgCache = new Map<string, HTMLImageElement>();

/** Carrega (com cache) a imagem do emblema personalizado. */
export function emblemImage(src: string | null, onLoad?: () => void): HTMLImageElement | null {
  if (!src || typeof Image === 'undefined') return null;
  let im = imgCache.get(src);
  if (!im) {
    im = new Image();
    im.src = src;
    imgCache.set(src, im);
  }
  if (!im.complete && onLoad) im.addEventListener('load', onLoad, { once: true });
  return im.complete && im.naturalWidth > 0 ? im : null;
}

/** Ajusta o tamanho da fonte para o texto caber na largura dada. */
function fitFont(g: CanvasRenderingContext2D, text: string, maxW: number, maxH: number, weight = '800'): number {
  let size = maxH;
  for (let i = 0; i < 30; i++) {
    g.font = `${weight} ${size}px "Arial Black", "Segoe UI", Arial, sans-serif`;
    if (g.measureText(text).width <= maxW) break;
    size *= 0.92;
  }
  return size;
}

/**
 * Decalque de um lado da vela (fundo transparente). Proporção 2:1 (largura
 * ao longo do casco × altura). bowRight = a proa fica à direita neste lado
 * (boreste visto de fora); o emblema vai para o lado da proa.
 */
export function drawSailDecal(canvas: HTMLCanvasElement, a: Appearance, bowRight: boolean, onImage?: () => void): void {
  const W = canvas.width;
  const H = canvas.height;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, W, H);
  const hasEmblem = a.emblem !== 'nenhum';
  const eh = H * 0.62;
  const ew = eh * 0.85;
  const ex = bowRight ? W - ew / 2 - W * 0.04 : ew / 2 + W * 0.04;
  const ey = H * 0.4;
  if (hasEmblem) {
    const img = a.emblem === 'personalizado' ? emblemImage(a.emblemImage, onImage) : null;
    if (a.emblem === 'personalizado' && img) {
      const k = Math.min(ew / img.naturalWidth, eh / img.naturalHeight);
      const iw = img.naturalWidth * k;
      const ih = img.naturalHeight * k;
      g.drawImage(img, ex - iw / 2, ey - ih / 2, iw, ih);
    } else if (a.emblem === 'vasco' || !img) drawVascoEmblem(g, ex, ey, eh);
  }
  const text = a.sailText.trim();
  if (text) {
    const area = hasEmblem ? W - ew - W * 0.12 : W * 0.9;
    const cx = hasEmblem ? (bowRight ? (W - ew - W * 0.06) / 2 : ew + W * 0.06 + area / 2) : W / 2;
    const size = fitFont(g, text, area, H * 0.62);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // contorno escuro fino para destacar sobre o casco
    g.lineWidth = Math.max(2, size * 0.05);
    g.strokeStyle = 'rgba(20,20,20,0.85)';
    g.strokeText(text, cx, H * 0.42);
    g.fillStyle = a.sailTextColor;
    g.fillText(text, cx, H * 0.42);
  }
}
