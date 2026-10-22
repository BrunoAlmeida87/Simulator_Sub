/**
 * FORMA DOS TANQUES INTERNOS: a seção acompanha o casco resistente (fundo e
 * costado abaulados) e o nível/centroide da água seguem essa seção.
 */
import { describe, it, expect } from 'vitest';
import { defaultVessel } from '../src/sim/config/defaultVessel';
import { tankFill, tankOutline, tankSection } from '../src/sim/systems/tankShape';
import type { InternalTankConfig } from '../src/sim/config/types';

const v = defaultVessel();
const tanks: InternalTankConfig[] = [...v.compensation.tanks, v.heel.tankA, v.heel.tankB, v.trim.tankA, v.trim.tankB];

describe('Tanques internos com seção do casco', () => {
  it('o tanque central de compensação é um só e o maior do conjunto', () => {
    expect(v.compensation.tanks).toHaveLength(1);
    expect(v.compensation.tanks[0].capacity).toBeGreaterThan(4 * v.heel.tankA.capacity);
  });

  it('contorno dentro do casco resistente e fundo abaulado', () => {
    for (const t of tanks) {
      const R = t.hullRadius!;
      for (const [y, z] of tankOutline(t)) expect(Math.hypot(y, z)).toBeLessThanOrEqual(R + 1e-6);
      // o fundo toca o casco (ponto do contorno sobre o círculo)
      expect(Math.max(...tankOutline(t).map(([y, z]) => Math.hypot(y, z)))).toBeGreaterThan(R - 0.02);
    }
    // tanques centrais: no fundo a seção é mais estreita que no teto (curvatura do casco)
    const tc = v.compensation.tanks[0];
    expect(tankFill(tc, 0.02 * tc.capacity).yb - tankFill(tc, 0.02 * tc.capacity).ya).toBeLessThan(0.8 * (tc.width ?? 0));
  });

  it('volume: nível sobe com o volume e o centroide fica dentro da seção', () => {
    for (const t of tanks) {
      const s = tankSection(t);
      expect(s.length * s.area).toBeCloseTo(t.capacity, 6);
      let last = Infinity;
      for (let f = 0; f <= 1.0001; f += 0.1) {
        const r = tankFill(t, f * t.capacity);
        expect(r.levelZ).toBeLessThanOrEqual(last + 1e-9);
        last = r.levelZ;
        expect(Math.hypot(r.y, r.z)).toBeLessThanOrEqual(t.hullRadius! + 1e-9);
        expect(r.z).toBeGreaterThanOrEqual(r.levelZ - 1e-9);
      }
      expect(tankFill(t, t.capacity).levelZ).toBeCloseTo(s.zTop, 6);
    }
  });

  it('tanques de banda: a água se junta do lado de dentro (onde o casco curva) e o centroide vai para fora ao encher', () => {
    const be = v.heel.tankB;
    const low = tankFill(be, 0.1 * be.capacity);
    const full = tankFill(be, be.capacity);
    expect(low.y).toBeLessThan(full.y);
    expect(full.y).toBeGreaterThan(1.9);
  });

  it('sem hullRadius o tanque continua prismático (configurações antigas)', () => {
    const t: InternalTankConfig = { id: 'X', name: 'X', capacity: 12, height: 1.4, center: { x: 6, y: 0, z: 2.3 }, initialVolume: 6 };
    const r = tankFill(t, 6);
    expect(r.levelZ).toBeCloseTo(2.3, 9);
    expect(r.z).toBeCloseTo(2.3 + 0.35, 9);
    expect(r.y).toBe(0);
  });
});
