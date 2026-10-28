/**
 * TEXTO FORMATADO das apresentações do Estúdio — marcação simples, digitável
 * e segura (nada de HTML):
 *
 *   **negrito**   *itálico*   __sublinhado__   ==realce==
 *   [azul]texto colorido[/azul]   (cores da linguagem visual do simulador)
 *   # Título grande     ## Subtítulo     - item de lista
 *   linha em branco = novo parágrafo; quebra de linha simples = nova linha
 *
 * Os valores ao vivo ({prof}, {Δpeso}…) são substituídos antes (variables.ts).
 * Módulo puro: o desenho em React está em components/RichText.tsx.
 */

/** cores disponíveis (mesmas cores das categorias de tanques e dos vetores) */
export const TEXT_COLORS: Record<string, { css: string; hint: string }> = {
  azul: { css: '#5aa9ff', hint: 'lastro principal (TLP)' },
  verde: { css: '#22d47a', hint: 'compensação' },
  laranja: { css: '#ffa62b', hint: 'trim' },
  roxo: { css: '#c77dff', hint: 'banda' },
  vermelho: { css: '#ff6b6b', hint: 'peso' },
  ciano: { css: '#49dcff', hint: 'empuxo' },
  amarelo: { css: '#ffe14d', hint: 'resultante' },
  branco: { css: '#ffffff', hint: 'destaque neutro' },
  cinza: { css: '#9fb2c6', hint: 'texto secundário' },
  magenta: { css: '#ff7ad1', hint: 'cargas deslocadas' },
};

export interface Inline {
  text: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  mark?: boolean;
  color?: string;
}

export type BlockKind = 'p' | 'h1' | 'h2' | 'li';

export interface Block {
  kind: BlockKind;
  /** linhas do bloco (quebras simples dentro do parágrafo) */
  lines: Inline[][];
}

const COLOR_RE = Object.keys(TEXT_COLORS).join('|');
const TOKEN = new RegExp(`(\\*\\*|__|==|\\*|\\[(?:${COLOR_RE})\\]|\\[\\/(?:${COLOR_RE})?\\])`, 'g');

/** Estilos de uma linha: marcadores alternam o estilo; o que ficar aberto vale até o fim do bloco. */
function parseInline(src: string, state: Omit<Inline, 'text'>, colors: string[]): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const color = colors.length ? colors[colors.length - 1] : undefined;
    const prev = out[out.length - 1];
    if (prev && prev.b === state.b && prev.i === state.i && prev.u === state.u && prev.mark === state.mark && prev.color === color) prev.text += text;
    else out.push({ text, ...state, color });
  };
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(src))) {
    push(src.slice(last, m.index));
    last = m.index + m[0].length;
    const t = m[0];
    if (t === '**') state.b = !state.b || undefined;
    else if (t === '*') state.i = !state.i || undefined;
    else if (t === '__') state.u = !state.u || undefined;
    else if (t === '==') state.mark = !state.mark || undefined;
    else if (t.startsWith('[/')) colors.pop();
    else colors.push(TEXT_COLORS[t.slice(1, -1)].css);
  }
  push(src.slice(last));
  return out;
}

/** Converte o texto marcado em blocos (parágrafos, títulos e itens de lista). */
export function parseRich(src: string): Block[] {
  const raw: { kind: BlockKind; lines: string[] }[] = [];
  let para: { kind: BlockKind; lines: string[] } | null = null;
  for (const l of String(src ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')) {
    const line = l.trimEnd();
    if (!line.trim()) {
      para = null;
      continue;
    }
    const h = /^(#{1,2})\s+(.*)$/.exec(line);
    const li = /^\s*[-•]\s+(.*)$/.exec(line);
    if (h) raw.push({ kind: h[1].length === 1 ? 'h1' : 'h2', lines: [h[2]] });
    else if (li) raw.push({ kind: 'li', lines: [li[1]] });
    else if (para) {
      para.lines.push(line);
      continue;
    } else raw.push((para = { kind: 'p', lines: [line] }));
    if (h || li) para = null;
  }
  // os estilos continuam entre as linhas do mesmo bloco, mas não atravessam blocos
  return raw.map((b) => {
    const st: Omit<Inline, 'text'> = {};
    const colors: string[] = [];
    return { kind: b.kind, lines: b.lines.map((l) => parseInline(l, st, colors)) };
  });
}

/** Texto sem marcação (para o roteiro em texto e para títulos de janela). */
export function plainText(src: string): string {
  return parseRich(src)
    .map((b) => (b.kind === 'li' ? '• ' : '') + b.lines.map((l) => l.map((x) => x.text).join('')).join('\n'))
    .join('\n');
}
