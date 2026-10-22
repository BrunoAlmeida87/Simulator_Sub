/**
 * VISTAS EM 1ª PESSOA E DRONE (só visual): passadiço no alto da vela
 * (altura do olho, vela alagada, binóculo 7×50, contatos à vista), folga da
 * cabeça do periscópio sobre a onda e o voo da câmera drone (fixa no mundo,
 * velocidade proporcional à altura, nunca abaixo do terreno/fundo).
 */
import { describe, it, expect } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { DEFAULT_ORIGIN } from '../src/sim/geo';
import { BINO_FOV, BINO_MAG, NAKED_FOV, bridgeFelt, bridgeState, bridgeVisible } from '../src/render3d/bridge';
import { TARGET_HEIGHT, horizonRange, periHeadAbove, periHeadClearance } from '../src/render3d/controlRoom/periscope';
import { DRONE_CLEAR, DRONE_MAX_UP, droneClearance, droneIdle, droneSpeed, droneStart, droneStep } from '../src/render3d/drone';

const ACTS = { geoOrigin: () => DEFAULT_ORIGIN, traffic: () => 0 };

describe('Passadiço (alto da vela)', () => {
  it('na superfície o olho fica ~8 m acima d’água e vê os contatos dentro do horizonte', () => {
    const e = buildScenario('superficie');
    const b = bridgeState(e);
    expect(b.flooded).toBe(false);
    expect(b.eye).toBeGreaterThan(6);
    expect(b.eye).toBeLessThan(11);
    expect(b.sailTop).toBeGreaterThan(4);
    for (const c of bridgeVisible(e, ACTS, 0)) {
      expect(c.rng).toBeLessThan(horizonRange(b.eye, TARGET_HEIGHT[c.kind]));
      const off = ((((c.brg - e.outputs.euler.heading + 180) % 360) + 360) % 360) - 180;
      expect(c.off).toBeCloseTo(off, 6);
    }
  });
  it('submerso a vela está alagada: o passadiço não vê nada', () => {
    const e = buildScenario('submerso_50');
    const b = bridgeState(e);
    expect(b.flooded).toBe(true);
    expect(b.sailTop).toBeLessThan(-30);
    expect(bridgeVisible(e, ACTS, 0)).toEqual([]);
  });
  it('binóculo 7×: o campo encolhe 7 vezes (em tangente) e o observador sente só parte do balanço', () => {
    expect(Math.tan((NAKED_FOV * Math.PI) / 360) / Math.tan((BINO_FOV * Math.PI) / 360)).toBeCloseTo(BINO_MAG, 6);
    // olhando pela proa o caturro vira elevação; pelo través, o balanço vira elevação
    expect(bridgeFelt(0, 4, 0).pitch).toBeGreaterThan(0);
    expect(bridgeFelt(0, 4, 0).pitch).toBeLessThan(4);
    expect(bridgeFelt(90, 0, 4).pitch).toBeLessThan(0);
    expect(Math.abs(bridgeFelt(90, 4, 0).pitch)).toBeLessThan(1e-9);
  });
});

describe('Periscópio: folga da cabeça sobre a onda', () => {
  it('mar calmo: a folga é a altura da cabeça menos a janela; com ondas ela oscila em torno disso', () => {
    const e = buildScenario('superficie');
    expect(periHeadClearance(e)).toBeNull();
    e.state.periscope = { cmd: true, pos: 1 };
    e.env.setSeaState(0, 0);
    const h = periHeadAbove(e)!;
    expect(periHeadClearance(e)!).toBeCloseTo(h - 0.3, 0);
    e.env.setSeaState(5, 0);
    const vals = Array.from({ length: 40 }, (_, i) => periHeadClearance(e, i * 0.7)!);
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.5);
  });
});

describe('Drone (câmera livre)', () => {
  const flat = () => -20; // fundo a 20 m
  it('começa acima e atrás do submarino, olhando para ele', () => {
    const p = droneStart(1000, 500, 5, 90);
    expect(p.up).toBeGreaterThan(20);
    expect(p.e).toBeLessThan(500); // rumo 090: atrás = a oeste
    expect(Math.abs(p.n - 1000)).toBeLessThan(1e-6);
    expect(p.pitch).toBeLessThan(0);
  });
  it('voa no referencial do mundo (avante = rumo da visada) e não depende do submarino', () => {
    const p = { n: 0, e: 0, up: 100, yaw: 90, pitch: 0 };
    const v = droneStep(p, { ...droneIdle(), f: 1 }, 1, flat);
    expect(p.e).toBeCloseTo(v, 6);
    expect(Math.abs(p.n)).toBeLessThan(1e-6);
    const q = { n: 0, e: 0, up: 100, yaw: 0, pitch: 0 };
    droneStep(q, { ...droneIdle(), s: 1 }, 1, flat); // lateral à direita do rumo 000 = leste
    expect(q.e).toBeGreaterThan(0);
  });
  it('a velocidade cresce com a altura (cruza quilômetros do alto) e Shift multiplica', () => {
    expect(droneSpeed(1000, false, 1)).toBeGreaterThan(50 * droneSpeed(5, false, 1));
    expect(droneSpeed(100, true, 1)).toBeCloseTo(4 * droneSpeed(100, false, 1), 6);
    expect(droneSpeed(1e6, true, 10)).toBeLessThanOrEqual(5000);
    expect(droneClearance(50, 30)).toBe(20); // sobre a terra
    expect(droneClearance(-5, -20)).toBe(5); // debaixo d'água: superfície mais perto que o fundo
  });
  it('nunca entra no terreno nem no fundo e respeita o teto', () => {
    const p = { n: 0, e: 0, up: 10, yaw: 0, pitch: 0 };
    for (let i = 0; i < 50; i++) droneStep(p, { ...droneIdle(), u: -1 }, 0.25, flat);
    expect(p.up).toBeCloseTo(-20 + DRONE_CLEAR, 6);
    const hill = () => 300;
    droneStep(p, droneIdle(), 0.1, hill);
    expect(p.up).toBeCloseTo(300 + DRONE_CLEAR, 6);
    for (let i = 0; i < 200; i++) droneStep(p, { ...droneIdle(), u: 1, fast: true }, 0.25, flat);
    expect(p.up).toBe(DRONE_MAX_UP);
  });
});
