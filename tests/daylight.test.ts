/**
 * SOL E LUZES (efeito visual): caminho do sol pela hora do dia, padrão igual
 * ao sol que a cena sempre usou, noite com luar, luzes de navegação nos
 * setores do RIPEAM e preferências saneadas.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_DAYLIGHT, computeDaylight, navLightsOn, sunAngles } from '../src/render3d/daylight';
import { relBearing, sectorVisible, shipNavLights, submarineNavLights } from '../src/render3d/NavLights';
import { graphics } from '../src/ui/graphics';

describe('Sol pela hora do dia', () => {
  it('o padrão reproduz o sol baixo de nordeste que a cena sempre usou', () => {
    const d = computeDaylight(DEFAULT_DAYLIGHT);
    const before = new THREE.Vector3(0.62, 0.22, -0.6).normalize();
    expect((d.sunDir.angleTo(before) * 180) / Math.PI).toBeLessThan(1.5);
    // de dia: luz cheia, sem tom de entardecer, sem luar, claridade normal debaixo d'água
    expect(d.day).toBe(1);
    expect(d.sunK).toBe(1);
    expect(d.warm).toBe(0);
    expect(d.moonK).toBe(0);
    expect(d.under).toBe(1);
  });

  it('nasce a leste às 6 h, passa ao norte ao meio-dia (67°) e se põe a oeste às 18 h', () => {
    const r6 = sunAngles(6);
    expect(Math.abs(r6.el)).toBeLessThan(0.5);
    expect(r6.az).toBeCloseTo(90, 0);
    const r12 = sunAngles(12);
    expect(r12.el).toBeCloseTo(67, 0);
    expect(Math.min(r12.az, 360 - r12.az)).toBeLessThan(0.5);
    const r18 = sunAngles(18);
    expect(Math.abs(r18.el)).toBeLessThan(0.5);
    expect(r18.az).toBeCloseTo(270, 0);
    // o giro muda de onde vem a luz, não a altura
    const t = sunAngles(9, 40);
    expect(t.el).toBeCloseTo(sunAngles(9).el, 6);
    expect(t.az).toBeCloseTo((sunAngles(9).az + 40) % 360, 6);
  });

  it('à noite: luar opcional, lua oposta ao sol e luzes de navegação automáticas', () => {
    const night = computeDaylight({ ...DEFAULT_DAYLIGHT, sunHour: 22 });
    expect(night.day).toBeLessThan(0.01);
    expect(night.night).toBe(1);
    expect(night.moonK).toBe(1);
    expect(night.moonDir.y).toBeGreaterThan(0);
    expect(navLightsOn(DEFAULT_DAYLIGHT, night)).toBe(true);
    expect(navLightsOn(DEFAULT_DAYLIGHT, computeDaylight({ ...DEFAULT_DAYLIGHT, sunHour: 12 }))).toBe(false);
    expect(navLightsOn({ ...DEFAULT_DAYLIGHT, navLights: 'ligadas' }, computeDaylight({ ...DEFAULT_DAYLIGHT, sunHour: 12 }))).toBe(true);
    expect(navLightsOn({ ...DEFAULT_DAYLIGHT, navLights: 'desligadas' }, night)).toBe(false);
    const dark = computeDaylight({ ...DEFAULT_DAYLIGHT, sunHour: 22, moonlight: false });
    expect(dark.moonK).toBe(0);
    expect(dark.under).toBeLessThan(night.under);
  });

  it('água escura reduz a claridade debaixo d’água também de dia', () => {
    const d = computeDaylight({ ...DEFAULT_DAYLIGHT, darkWater: true });
    expect(d.under).toBeLessThan(0.15);
    expect(d.day).toBe(1);
  });
});

describe('Luzes de navegação (setores do RIPEAM)', () => {
  const at = (rel: number) => new THREE.Vector3(Math.sin((rel * Math.PI) / 180) * 100, 0, -Math.cos((rel * Math.PI) / 180) * 100);
  it('marcação relativa: proa 0°, boreste +90°, popa 180°', () => {
    expect(relBearing([0, 0, 0], at(0))).toBeCloseTo(0, 6);
    expect(relBearing([0, 0, 0], at(90))).toBeCloseTo(90, 6);
    expect(relBearing([0, 0, 0], at(-60))).toBeCloseTo(-60, 6);
  });
  it('mastro para vante, bordos de cada lado e alcançado pela popa', () => {
    expect(sectorVisible('mastro', 0)).toBe(1);
    expect(sectorVisible('mastro', 100)).toBe(1);
    expect(sectorVisible('mastro', 150)).toBe(0);
    expect(sectorVisible('popa', 180)).toBe(1);
    expect(sectorVisible('popa', 90)).toBe(0);
    expect(sectorVisible('be', 45)).toBe(1);
    expect(sectorVisible('be', -45)).toBe(0);
    expect(sectorVisible('bb', -45)).toBe(1);
    expect(sectorVisible('bb', 45)).toBe(0);
    expect(sectorVisible('amarela', 123)).toBe(1);
  });
  it('submarino e navios: encarnada a BB, verde a BE; submarino com a amarela', () => {
    const sub = submarineNavLights(70, 3.1, { xFwd: 18, xAft: 9, width: 2.4, height: 6 });
    expect(sub.find((l) => l.kind === 'bb')!.pos[0]).toBeLessThan(0);
    expect(sub.find((l) => l.kind === 'be')!.pos[0]).toBeGreaterThan(0);
    expect(sub.some((l) => l.kind === 'amarela')).toBe(true);
    const ship = shipNavLights(190, 32, 7);
    expect(ship.filter((l) => l.kind === 'mastro')).toHaveLength(2);
    expect(ship.find((l) => l.kind === 'popa')!.pos[2]).toBeGreaterThan(0);
  });
});

describe('Preferências de sol e luzes', () => {
  it('valores fora da faixa são limitados e tipos errados ignorados', () => {
    graphics.set({ sunHour: 99, sunTurn: -999 }, false);
    expect(graphics.get().sunHour).toBe(24);
    expect(graphics.get().sunTurn).toBe(-180);
    graphics.set({ navLights: 'piscando' as never, subLights: 'sim' as never }, false);
    expect(graphics.get().navLights).toBe(DEFAULT_DAYLIGHT.navLights);
    expect(graphics.get().subLights).toBe(false);
    graphics.set({ ...DEFAULT_DAYLIGHT }, false);
    expect(graphics.get().sunHour).toBe(7);
  });
});
