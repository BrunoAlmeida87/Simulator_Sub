/**
 * Regras de layout da tela Operação (fase C), puras para poder testar:
 *  - console compacto quando falta altura (ou por escolha do operador);
 *  - largura do painel de sistemas ajustável, com limites.
 */

export type ConsoleMode = 'auto' | 'completo' | 'compacto';

/** abaixo desta altura da área da tela (px) o console vira uma linha no modo automático */
export const COMPACT_BELOW = 560;

export function isCompact(mode: ConsoleMode, opsHeight: number): boolean {
  if (mode === 'compacto') return true;
  if (mode === 'completo') return false;
  return opsHeight > 0 && opsHeight < COMPACT_BELOW;
}

export const SIDE_MIN = 340;
export const SIDE_MAX = 560;

/** largura do painel limitada a [340, 560] px e a no máximo 45 % da janela (o 3D precisa de espaço) */
export function clampSideWidth(w: number, viewportWidth: number): number {
  const max = Math.max(SIDE_MIN, Math.min(SIDE_MAX, Math.round(viewportWidth * 0.45)));
  return Math.round(Math.max(SIDE_MIN, Math.min(max, w)));
}
