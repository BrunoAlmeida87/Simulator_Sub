import { describe, expect, it } from 'vitest';
import { changeObjectType, contactPoint, echoTime, makeContact, passiveLevel, pointContact } from '../src/sim/sonar';

describe('modelo geométrico do sonar', () => {
  it('mede o tempo do eco pela ida e volta', () => {
    expect(echoTime(1500, 1500)).toBe(2);
    expect((echoTime(3000, 1500) * 1500) / 2).toBe(3000);
  });

  it('converte marcação e distância para o plano e de volta', () => {
    for (const bearing of [0, 90, 180, 270, 347]) {
      const p = contactPoint({ bearing, range: 2450 }, 6000);
      const got = pointContact(p.x, p.y, 6000);
      expect(got.bearing).toBeCloseTo(bearing, 8);
      expect(got.range).toBeCloseTo(2450, 8);
    }
  });

  it('objetos silenciosos retornam eco ativo, mas não aparecem na escuta passiva', () => {
    const rock = makeContact('C', 'rock', 278, 4400);
    expect(rock.reflectivity).toBeGreaterThan(0);
    expect(passiveLevel(rock, 6000)).toBe(0);
    const sub = changeObjectType(rock, 'submarine');
    expect(sub.range).toBe(rock.range);
    expect(sub.noise).toBeGreaterThan(0);
    expect(passiveLevel(sub, 6000)).toBeGreaterThan(0);
  });
});
