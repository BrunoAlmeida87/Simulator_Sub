import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_AMBIENT, ambientFlow, suspensionParticle, sampleBottom, MAX_BOTTOM_ITEMS } from '../src/render3d/ambientMotion';
import { graphics } from '../src/ui/graphics';

describe('Ambiente submerso', () => {
  it('move partículas com navio parado; pausa/replay/janelas repetem o mesmo instante', () => {
    const sample = (t: number) => suspensionParticle(81, t, 0, 0, 25, DEFAULT_AMBIENT);
    expect(sample(10)).toEqual(sample(10));
    expect(sample(11)).not.toEqual(sample(10));
    const p = sample(10),
      q = sample(10.01);
    expect(Math.hypot(q.n - p.n, q.e - p.e, q.d - p.d)).toBeLessThan(0.02);
    const off = { ...DEFAULT_AMBIENT, ambientMotion: 'desligado' as const };
    expect(suspensionParticle(81, 10, 0, 0, 25, off)).toEqual(suspensionParticle(81, 20, 0, 0, 25, off));
  });
  it('origem flutuante não arrasta partículas com a câmera/submarino', () => {
    const a = suspensionParticle(81, 10, 0, 0, 25, DEFAULT_AMBIENT);
    const b = suspensionParticle(81, 10, 0.1, 0.1, 25, DEFAULT_AMBIENT);
    expect(a.n).toBeCloseTo(b.n, 8);
    expect(a.e).toBeCloseTo(b.e, 8);
  });
  it('corrente respeita direção, intensidade e desligado', () => {
    const a = ambientFlow(0, 0, 50, 0, { ...DEFAULT_AMBIENT, currentDirection: 0 });
    const b = ambientFlow(0, 0, 50, 0, { ...DEFAULT_AMBIENT, currentDirection: 90 });
    expect(a.n).toBeGreaterThan(0);
    expect(a.e).toBe(0);
    expect(b.e).toBeGreaterThan(0);
    expect(b.n).toBeCloseTo(0);
    expect(ambientFlow(10, 20, 50, 8, { ...DEFAULT_AMBIENT, ambientMotion: 'desligado' })).toEqual({ n: 0, e: 0 });
  });
  it('objetos fixos e limitados, sem plantas profundas nem objetos em terra', () => {
    const a = sampleBottom(() => 25, 0, 0, 'moderada');
    expect(a).toEqual(sampleBottom(() => 25, 0, 0, 'moderada'));
    expect(a.length).toBeLessThanOrEqual(MAX_BOTTOM_ITEMS);
    expect(a.some((p) => p.kind === 'grass')).toBe(true);
    expect(sampleBottom(() => 100, 0, 0, 'abundante').some((p) => p.kind === 'grass')).toBe(false);
    expect(sampleBottom(() => -1, 0, 0, 'abundante')).toEqual([]);
    expect(sampleBottom(() => 25, 0, 0, 'desligada')).toEqual([]);
    const b = sampleBottom(() => 25, 24, 0, 'moderada');
    expect(b.filter((p) => Math.abs(p.n) < 50 && Math.abs(p.e) < 50)).toEqual(a.filter((p) => Math.abs(p.n) < 50 && Math.abs(p.e) < 50));
  });
  it('preferências persistem e sincronizam; versões antigas preservam os padrões', () => {
    const original = { ...graphics.get() },
      setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem });
    try {
      graphics.set({ ambientMotion: 'moderado', currentDirection: 180, bottomLifeDensity: 'discreta' });
      const saved = JSON.parse(setItem.mock.calls.find(([key]) => key === 'sx1.graphics.v1')![1]);
      expect(saved).toMatchObject({ ambientMotion: 'moderado', currentDirection: 180, bottomLifeDensity: 'discreta' });
      graphics.set(original, false);
      graphics.set(saved, false);
      expect(graphics.get().currentDirection).toBe(180);
      graphics.set({ lighting: 'clara' }, false);
      expect(graphics.get().ambientMotion).toBe('moderado');
      graphics.set({ currentDirection: NaN }, false);
      expect(graphics.get().currentDirection).toBe(180);
    } finally {
      graphics.set(original, false);
      vi.unstubAllGlobals();
    }
  });
});

import { DepthRefs } from '../src/render3d/DepthRefs';
import { Environment, defaultEnvironment } from '../src/sim/environment/environment';
import type { Points, BufferAttribute } from 'three';
it('faixas de profundidade também derivam horizontalmente e congelam em pausa', () => {
  const refs = new DepthRefs(null), env = new Environment(defaultEnvironment());
  const sample = (t: number) => {
    refs.update(env,0,0,50,0,60,6,true,t,DEFAULT_AMBIENT);
    return Array.from(((refs.group.children[0] as Points).geometry.getAttribute('position') as BufferAttribute).array);
  };
  const a=sample(10), b=sample(15);
  expect(a).not.toEqual(b);expect(sample(15)).toEqual(b);
  expect(a.filter((_,i)=>i%3===1)).toEqual(b.filter((_,i)=>i%3===1));
  refs.dispose();
});
