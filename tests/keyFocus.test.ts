/**
 * Atalhos de teclado × foco (src/ui/keyFocus.ts): depois de um clique num botão
 * os atalhos continuam valendo (Espaço pausa em vez de repetir o clique); quem
 * chegou ao botão pelo Tab aciona o botão com Espaço/Enter; campos ficam com a tecla.
 */
import { describe, it, expect } from 'vitest';
import { classifyFocus, shortcutAction } from '../src/ui/keyFocus';

/** elemento falso: closest responde se está dentro de um botão */
const el = (tagName: string, inButton = false, isContentEditable = false) => ({ tagName, isContentEditable, closest: () => (inButton ? {} : null) });

describe('Foco e atalhos de teclado', () => {
  it('classifica o foco', () => {
    expect(classifyFocus(null, false)).toBe('outro');
    expect(classifyFocus(el('BODY'), true)).toBe('outro');
    expect(classifyFocus(el('INPUT'), false)).toBe('campo');
    expect(classifyFocus(el('select'), false)).toBe('campo');
    expect(classifyFocus(el('TEXTAREA'), true)).toBe('campo');
    expect(classifyFocus(el('DIV', false, true), false)).toBe('campo');
    expect(classifyFocus(el('BUTTON', true), false)).toBe('botao-mouse');
    expect(classifyFocus(el('SPAN', true), true)).toBe('botao-teclado'); // texto dentro de um botão
  });

  it('botão clicado com o mouse: Espaço e as teclas de atalho vão para a App', () => {
    for (const k of [' ', 'w', 's', 'a', 'd', 'q', 'e', '+', '-', '2', 'i']) expect(shortcutAction('botao-mouse', k)).toBe('atalho');
  });

  it('botão alcançado pelo Tab: Espaço/Enter acionam o botão; as outras teclas são atalhos', () => {
    expect(shortcutAction('botao-teclado', ' ')).toBe('nativo');
    expect(shortcutAction('botao-teclado', 'Enter')).toBe('nativo');
    expect(shortcutAction('botao-teclado', '2')).toBe('atalho');
    expect(shortcutAction('botao-teclado', 'w')).toBe('atalho');
  });

  it('campo de texto fica com todas as teclas; fora de botões e campos, tudo é atalho', () => {
    for (const k of [' ', 'w', '2', 'Enter']) {
      expect(shortcutAction('campo', k)).toBe('nativo');
      expect(shortcutAction('outro', k)).toBe('atalho');
    }
  });
});
