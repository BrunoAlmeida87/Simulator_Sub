/**
 * FUNDO DO MAR: modo uniforme (padrão de 300 m) e modo relevo; a mesma
 * função alimenta a física (contato), o ecobatímetro e o desenho 3D.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildScenario } from '../src/sim/scenarios';
import { defaultSimConfig } from '../src/sim/config/defaultVessel';
import { deserializeEngine } from '../src/sim/persistence';
import { applyCommand } from '../src/sim/commands';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
/** fórmula do relevo das versões anteriores (para conferir que não mudou) */
function oldRelief(b: { baseDepth: number; slopeNorth: number; slopeEast: number; roughness: number; wavelength: number }, n: number, e: number): number {
  const k = (2 * Math.PI) / Math.max(50, b.wavelength);
  const r = 0.6 * Math.sin(k * n + 0.7) * Math.cos(0.8 * k * e - 0.3) + 0.3 * Math.sin(2.3 * k * e + 1.9) + 0.1 * Math.cos(3.7 * k * (n + e));
  return Math.max(8, b.baseDepth + (b.slopeNorth * n) / 1000 + (b.slopeEast * e) / 1000 + b.roughness * r);
}

describe('Fundo do mar configurável', () => {
  it('padrão de sessões novas: uniforme, 300 m em qualquer posição', () => {
    const c = defaultSimConfig();
    expect(c.environment.bottom.mode).toBe('uniforme');
    expect(c.environment.bottom.baseDepth).toBe(300);
    const e = buildScenario('submerso_50', c);
    for (const [n, ea] of [
      [0, 0],
      [5000, -3000],
      [-20000, 12000],
    ])
      expect(e.env.bottomDepthAt(n, ea)).toBe(300);
    expect(e.outputs.bottomDepth).toBe(300);
    // ecobatímetro = distância do casco ao fundo calculado
    e.advanceSim(5);
    expect(e.state.sensors.ECO.value).toBeCloseTo(e.outputs.altitude, 6);
    expect(e.outputs.altitude).toBeCloseTo(300 - Math.max(e.outputs.depthKeel, e.state.body.pos.z + e.vessel.hull.diameter / 2), 6);
  });

  it('“Águas rasas” mantém o relevo do cenário (95 m, declive e ondulações)', () => {
    const e = buildScenario('aguas_rasas');
    const b = e.config.environment.bottom;
    expect(b.mode).toBe('relevo');
    expect(e.env.bottomDepthAt(0, 0)).toBeCloseTo(oldRelief(b, 0, 0), 9);
    expect(e.env.bottomDepthAt(1000, 0)).not.toBeCloseTo(e.env.bottomDepthAt(0, 0), 1);
  });

  it('arquivos salvos antigos continuam com o fundo em relevo de 420 m', () => {
    const raw = fixture('estado-v1-submerso50.json');
    const e = deserializeEngine(raw);
    expect(e.config.environment.bottom.mode).toBe('relevo');
    const p = e.state.body.pos;
    expect(e.env.bottomDepthAt(p.x, p.y)).toBeCloseTo(oldRelief(raw.config.environment.bottom, p.x, p.y), 9);
  });

  it('o contato com o fundo usa a mesma profundidade (fundo uniforme raso)', () => {
    const c = defaultSimConfig();
    c.environment.bottom.baseDepth = 120; // pairando começa a ~80 m
    c.environment.waves = { seaState: 0, direction: 0, seed: 1 };
    const e = buildScenario('pairando', c);
    // pesado: desce até tocar o fundo
    applyCommand(e, { type: 'dosing', system: 'compensation', mode: 'admitir', kg: 6000 });
    let touched = false;
    for (let i = 0; i < 900 && !touched; i++) {
      e.advanceSim(1);
      touched = e.state.contact;
    }
    expect(touched).toBe(true);
    expect(e.outputs.altitude).toBeLessThan(0.5);
    expect(e.outputs.depthKeel).toBeGreaterThan(118);
    expect(e.outputs.depthKeel).toBeLessThan(121);
  });
});
