/**
 * PREFERÊNCIAS GRÁFICAS: iluminação da cena (apenas visual) — padrão "clara",
 * valores inválidos ignorados e perfis completos.
 */
import { describe, it, expect, vi } from 'vitest';
import { graphics, LIGHTINGS } from '../src/ui/graphics';
import { LIGHTING } from '../src/render3d/lighting';
import type { SceneLighting } from '../src/render3d/lighting';
import type { FishDensity } from '../src/render3d/marineLifeMotion';

describe('Preferências da vida marinha', () => {
  it('usa intensidade discreta e persiste as opções; aceita sincronização sem salvar', () => {
    const original = { ...graphics.get() };
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem });
    try {
      expect(original.fishDensity).toBe('discreta');
      expect(original.fishJumps && original.fishUnderwater).toBe(true);
      graphics.set({ fishDensity: 'moderada', fishJumps: false, fishUnderwater: true });
      const saved = JSON.parse(setItem.mock.calls.find(([key]) => key === 'sx1.graphics.v1')![1]);
      expect(saved).toMatchObject({ fishDensity: 'moderada', fishJumps: false, fishUnderwater: true });
      graphics.set({ fishDensity: 'desligada' }, false);
      setItem.mockClear();
      graphics.set(saved, false);
      expect(graphics.get().fishDensity).toBe('moderada');
      expect(setItem).not.toHaveBeenCalled();
      graphics.set({ fishDensity: 'invalida' as FishDensity }, false);
      expect(graphics.get().fishDensity).toBe('moderada');
      // Mensagens/preferências antigas, sem os novos campos, continuam válidas.
      graphics.set({ lighting: 'clara' }, false);
      expect(graphics.get().fishJumps).toBe(false);
    } finally {
      graphics.set(original, false);
      vi.unstubAllGlobals();
    }
  });
});

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
