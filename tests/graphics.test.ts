/**
 * PREFERÊNCIAS GRÁFICAS: iluminação da cena (apenas visual) — padrão "clara",
 * valores inválidos ignorados e perfis completos.
 */
import { describe, it, expect } from 'vitest';
import { graphics, LIGHTINGS } from '../src/ui/graphics';
import { LIGHTING } from '../src/render3d/lighting';
import type { SceneLighting } from '../src/render3d/lighting';

describe('Iluminação da cena', () => {
  it('padrão clara; aceita só os perfis conhecidos', () => {
    expect(graphics.get().lighting).toBe('clara');
    graphics.set({ lighting: 'natural' }, false);
    expect(graphics.get().lighting).toBe('natural');
    graphics.set({ lighting: 'xyz' as SceneLighting }, false);
    expect(graphics.get().lighting).toBe('natural');
    graphics.set({ lighting: 'clara' }, false);
  });

  it('cada perfil tem exposição, luzes e cores da água; natural sem luz extra', () => {
    for (const k of LIGHTINGS) {
      const p = LIGHTING[k];
      expect(p.exposureUnder).toBeGreaterThan(0);
      expect(p.water.horizon[2]).toBeGreaterThan(0);
    }
    expect(LIGHTING.natural.camKey + LIGHTING.natural.camFill + LIGHTING.natural.rim).toBe(0);
    expect(LIGHTING.clara.exposureUnder).toBeGreaterThan(LIGHTING.natural.exposureUnder);
  });
});
