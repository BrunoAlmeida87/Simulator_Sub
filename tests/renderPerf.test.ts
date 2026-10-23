/**
 * Escala de resolução, ajuste automático e medidor de quadros (só visual).
 */
import { describe, it, expect } from 'vitest';
import { AdaptiveScale, AUTO_STEPS, FrameMeter, RenderPerf, formatPerf, parseRenderScale } from '../src/render3d/renderPerf';

/** simula `seconds` de quadros: o tempo de quadro vem de `cost(scale)` (ms), limitado por baixo por 16,7 ms (vsync) */
function run(a: AdaptiveScale, seconds: number, cost: (scale: number) => number, t0 = 0): number {
  let t = t0;
  while (t < t0 + seconds * 1000) {
    const dt = Math.max(1000 / 60, cost(a.scale));
    t += dt;
    a.update(dt, t);
  }
  return t;
}

describe('Ajuste automático da resolução', () => {
  it('começa em 100 % e fica nele quando o desenho é leve', () => {
    const a = new AdaptiveScale();
    run(a, 60, () => 8);
    expect(a.scale).toBe(1);
  });

  it('desce até o tempo de quadro caber quando a carga é pesada (custo ∝ pixels)', () => {
    const a = new AdaptiveScale();
    run(a, 40, (s) => 44 * s * s); // 44 ms a 100 %: 75 % → 24,8 ms
    expect(a.scale).toBeLessThanOrEqual(0.75);
    expect(a.scale).toBeGreaterThanOrEqual(0.6);
    expect(44 * a.scale * a.scale).toBeLessThan(26);
  });

  it('sobe de volta quando a carga diminui', () => {
    const a = new AdaptiveScale();
    const t = run(a, 40, (s) => 44 * s * s);
    expect(a.scale).toBeLessThan(1);
    run(a, 120, () => 8, t);
    expect(a.scale).toBe(1);
  });

  it('não derruba a resolução quando o limite não são os pixels (tela/navegador a 30 fps)', () => {
    const a = new AdaptiveScale();
    run(a, 90, () => 33);
    // desce no máximo um degrau de teste e volta; não vai para o mínimo
    expect(a.scale).toBeGreaterThanOrEqual(AUTO_STEPS[AUTO_STEPS.length - 2]);
  });

  it('ignora intervalos enormes (aba oculta)', () => {
    const a = new AdaptiveScale();
    for (let i = 0; i < 50; i++) expect(a.update(5000, i * 5000)).toBe(false);
    expect(a.scale).toBe(1);
  });

  it('startNear escolhe o degrau mais próximo', () => {
    const a = new AdaptiveScale();
    a.startNear(0.75);
    expect(a.scale).toBe(0.75);
    a.startNear(0.5);
    expect(a.scale).toBe(0.5);
  });
});

describe('Medidor de quadros', () => {
  it('calcula fps e ms médios', () => {
    const m = new FrameMeter();
    let updated = false;
    for (let i = 0; i < 40; i++) updated = m.add(20) || updated;
    expect(updated).toBe(true);
    expect(m.ms).toBeCloseTo(20, 5);
    expect(m.fps).toBeCloseTo(50, 5);
  });
});

describe('RenderPerf', () => {
  it('usa a escala fixa escolhida e só ajusta no modo automático', () => {
    const p = new RenderPerf();
    let t = 1000;
    for (let i = 0; i < 200; i++) {
      t += 50;
      expect(p.frame(t, 0.5).scale).toBe(0.5);
    }
    // voltando ao automático parte do degrau próximo (50 %) e sobe com folga
    for (let i = 0; i < 4000; i++) {
      t += 10;
      p.frame(t, 'auto');
    }
    expect(p.scale).toBe(1);
  });

  it('formatPerf traz fps, resolução e contadores', () => {
    const txt = formatPerf(59.6, 16.8, { width: 1280, height: 800, scale: 0.75, calls: 120, triangles: 85000, geometries: 90, textures: 30 }, true);
    expect(txt).toContain('60 fps');
    expect(txt).toContain('1280×800 (75 % auto)');
    expect(txt).toContain('120 chamadas');
    expect(txt).toContain('85 mil triângulos');
  });
});

describe('Preferência', () => {
  it('aceita só os valores previstos', () => {
    expect(parseRenderScale('auto', 1)).toBe('auto');
    expect(parseRenderScale(0.75, 1)).toBe(0.75);
    expect(parseRenderScale(0.3, 1)).toBe(1);
    expect(parseRenderScale('x', 'auto')).toBe('auto');
  });
});
