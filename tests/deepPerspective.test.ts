/**
 * Perspectiva profunda (só visual): ao abrir a lente, a câmera se aproxima na
 * mesma proporção — o alvo fica do mesmo tamanho no quadro e a diferença de
 * tamanho entre o que está perto e longe (proa × popa) aumenta.
 */
import { describe, it, expect } from 'vitest';
import { BASE_FOV, DEEP_FOVS, DEEP_VIEWS, dollyRatio, dollyPoint } from '../src/render3d/deepPerspective';
import { graphics } from '../src/ui/graphics';
import { normalizePresentation } from '../src/ui/presBuilder/model';

/** fração da altura do quadro ocupada por um objeto de tamanho h a uma distância d, com campo de visão fov */
const frac = (h: number, d: number, fov: number) => h / (2 * d * Math.tan((fov * Math.PI) / 360));

describe('Perspectiva profunda', () => {
  it('mesmo tamanho do alvo no quadro, câmera mais perto', () => {
    const d0 = 100;
    for (const fov of Object.values(DEEP_FOVS)) {
      const k = dollyRatio(BASE_FOV, fov);
      expect(k).toBeLessThan(1);
      expect(frac(10, d0 * k, fov)).toBeCloseTo(frac(10, d0, BASE_FOV), 10);
    }
    expect(dollyRatio(50, 50)).toBe(1);
    expect(dollyPoint({ x: 10, y: 4, z: -2 }, { x: 0, y: 0, z: 0 }, 0.5)).toEqual({ x: 5, y: 2, z: -1 });
  });

  it('a diferença entre perto e longe cresce (proa maior que a popa)', () => {
    // câmera a 100 m do centro, na direção da proa, casco de 66 m: proa a 67 m, popa a 133 m
    const ratio = (d: number) => (d + 33) / (d - 33); // tamanho aparente da proa / popa
    const normal = ratio(100);
    const forte = ratio(100 * dollyRatio(BASE_FOV, DEEP_FOVS.forte));
    expect(normal).toBeCloseTo(1.99, 1);
    expect(forte).toBeGreaterThan(3.5);
  });

  it('vale para as vistas de 3ª pessoa; calado, navio, perspectiva e 1ª pessoa ficam de fora', () => {
    for (const v of ['superficie', 'submerso', 'tanques', 'forcas', 'piloto', 'perseguicao', 'fixa', 'livre'] as const) expect(DEEP_VIEWS.has(v), v).toBe(true);
    for (const v of ['calado', 'navio', 'perspectiva', 'periscopio', 'passadico', 'drone'] as const) expect(DEEP_VIEWS.has(v), v).toBe(false);
  });

  it('preferência gráfica: desligada por padrão, intensidade validada; etapas do Estúdio guardam liga/desliga/manter', () => {
    expect(graphics.get().deepPersp).toBe(false);
    graphics.set({ deepPersp: true, deepLevel: 'forte' }, false);
    expect(graphics.get().deepLevel).toBe('forte');
    graphics.set({ deepLevel: 'enorme' as never }, false);
    expect(graphics.get().deepLevel).toBe('forte');
    graphics.set({ deepPersp: false, deepLevel: 'media' }, false);
    const p = normalizePresentation({ steps: [{ visual: { persp: true } }, { visual: { persp: 'x' } }, {}] });
    expect(p.steps.map((s) => s.visual.persp)).toEqual([true, null, null]);
  });
});
