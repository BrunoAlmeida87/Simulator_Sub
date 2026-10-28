/**
 * Reflexo do céu no submarino (subEnvironment.ts): cores por situação, chave de
 * refazer o mapa e intensidade. Só visual: nada aqui toca a física.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { envColors, envIntensity, envKey, SubEnvironment } from '../src/render3d/subEnvironment';
import { computeDaylight, skyPalette, DEFAULT_DAYLIGHT } from '../src/render3d/daylight';

function palAt(hour: number) {
  const dl = computeDaylight({ ...DEFAULT_DAYLIGHT, sunHour: hour });
  const pal = { fog: new THREE.Color(), zenith: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), sun: new THREE.Color() };
  skyPalette(dl, true, pal);
  return { dl, p: { zenith: pal.zenith, fog: pal.fog, sun: pal.sun, sunDir: dl.sunDir, sunK: dl.sunK, day: dl.day } };
}

describe('reflexo do céu no submarino', () => {
  it('acima d’água: céu em cima mais claro que o mar embaixo, sol na direção da cena', () => {
    const { dl, p } = palAt(10);
    const c = envColors('acima', p);
    expect(c.up.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(c.down.getHSL({ h: 0, s: 0, l: 0 }).l);
    expect(c.horizon.r + c.horizon.g + c.horizon.b).toBeGreaterThan(c.down.r + c.down.g + c.down.b);
    expect(c.sunDir.angleTo(dl.sunDir)).toBeLessThan(1e-6);
    expect(c.sun.r).toBeGreaterThan(0);
  });

  it('submerso: luz vem de cima, sem sol direto; sem água: estúdio neutro', () => {
    const { p } = palAt(10);
    const u = envColors('submerso', { ...p, uwUp: new THREE.Color(0.2, 0.5, 0.7), uwHorizon: new THREE.Color(0.05, 0.2, 0.3) });
    expect(u.up.b).toBeGreaterThan(u.down.b);
    expect(u.sun.r + u.sun.g + u.sun.b).toBe(0);
    const s = envColors('seco', p);
    expect(s.up.r).toBeGreaterThan(s.down.r);
  });

  it('a chave só muda quando a mudança é visível (o mapa não é refeito a cada quadro)', () => {
    const { p } = palAt(10);
    const a = envColors('acima', p);
    const b = envColors('acima', { ...p, zenith: p.zenith.clone().offsetHSL(0, 0, 0.001) });
    expect(envKey(a)).toBe(envKey(b));
    const late = envColors('acima', palAt(17.5).p);
    expect(envKey(a)).not.toBe(envKey(late));
  });

  it('intensidade: forte de dia, fraca à noite e debaixo d’água', () => {
    expect(envIntensity('acima', 1, 1)).toBeGreaterThan(envIntensity('acima', 0, 1));
    expect(envIntensity('acima', 0, 1)).toBeGreaterThan(0);
    expect(envIntensity('submerso', 1, 0.2)).toBeLessThan(envIntensity('acima', 1, 1));
    // sem água: estúdio fixo (não depende da hora do dia)
    expect(envIntensity('seco', 0, 0)).toBe(envIntensity('seco', 1, 1));
    expect(envIntensity('seco', 0, 0)).toBeGreaterThan(1);
  });

  it('sem WebGL (testes, servidor) não gera mapa nem quebra', () => {
    const env = new SubEnvironment(null);
    expect(env.update(envColors('acima', palAt(10).p), 0)).toBe(false);
    expect(env.texture).toBeNull();
    env.dispose();
  });
});
