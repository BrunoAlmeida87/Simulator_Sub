/**
 * FOCO E ATALHOS DE TECLADO. Depois de um clique num botão o foco fica nele, e
 * o navegador repete o clique com Espaço/Enter. Para os atalhos da App (Espaço
 * executa/pausa, W/S/A/D/Q/E lemes, +/- telégrafo, 0–8 telas) valerem sempre:
 * - foco num campo de texto/seleção: a tecla é do campo (nenhum atalho);
 * - botão alcançado pelo Tab: Espaço/Enter acionam o botão (acessibilidade);
 * - botão clicado com o mouse: os atalhos valem, e o botão perde o foco antes
 *   de Espaço, para não repetir o último clique.
 * Módulo sem React; tests/keyFocus.test.ts confere as decisões.
 */

export type KeyFocus = 'campo' | 'botao-teclado' | 'botao-mouse' | 'outro';

/** elemento mínimo usado aqui (no navegador é o Element do evento) */
interface FocusLike {
  tagName: string;
  isContentEditable?: boolean;
  closest?: (sel: string) => unknown;
}

const FIELD_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
export const BUTTON_SELECTOR = 'button, [role="button"]';

/** onde está o foco quando a tecla chega */
export function classifyFocus(t: FocusLike | null | undefined, viaKeyboard: boolean): KeyFocus {
  if (!t || !t.tagName) return 'outro';
  if (FIELD_TAGS.has(t.tagName.toUpperCase()) || t.isContentEditable) return 'campo';
  if (t.closest?.(BUTTON_SELECTOR)) return viaKeyboard ? 'botao-teclado' : 'botao-mouse';
  return 'outro';
}

/** 'nativo': deixa a tecla para o elemento em foco; 'atalho': a App trata a tecla */
export function shortcutAction(focus: KeyFocus, key: string): 'nativo' | 'atalho' {
  if (focus === 'campo') return 'nativo';
  if (focus === 'botao-teclado' && (key === ' ' || key === 'Enter')) return 'nativo';
  return 'atalho';
}

// ---- modalidade do foco: Tab (teclado) × ponteiro (mouse, toque, caneta)
let viaKeyboard = false;
let installed = false;

/** passa a acompanhar como o foco foi movido (uma vez por janela) */
export function installFocusTracking(w: Window = window): void {
  if (installed) return;
  installed = true;
  w.addEventListener('pointerdown', () => (viaKeyboard = false), true);
  w.addEventListener(
    'keydown',
    (ev) => {
      if (ev.key === 'Tab') viaKeyboard = true;
    },
    true,
  );
}

/** o foco atual veio do teclado (Tab)? */
export const focusFromKeyboard = (): boolean => viaKeyboard;
