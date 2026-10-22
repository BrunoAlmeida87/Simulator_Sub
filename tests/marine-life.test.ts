import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Environment, defaultEnvironment } from '../src/sim/environment/environment';
import { MarineLife } from '../src/render3d/MarineLife';
import { DEFAULT_MARINE_LIFE, MAX_FISH, sampleMarineLife } from '../src/render3d/marineLifeMotion';

const config = defaultEnvironment();
config.waves = { seaState: 0, direction: 0, seed: 42 };
const env = new Environment(config);

describe('Vida marinha decorativa', () => {
  it('repete a mesma cena na pausa, no replay e em outra janela sem alterar o ambiente', () => {
    const before = JSON.stringify(env.cfg);
    const a = sampleMarineLife(env, 123.4, 15, -21, DEFAULT_MARINE_LIFE);
    sampleMarineLife(env, 987, 400, 700, DEFAULT_MARINE_LIFE);
    const b = sampleMarineLife(new Environment(structuredClone(config)), 123.4, 15, -21, DEFAULT_MARINE_LIFE);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
    expect(sampleMarineLife(env, 125, 15, -21, DEFAULT_MARINE_LIFE)).not.toEqual(a);
    expect(JSON.stringify(env.cfg)).toBe(before);
  });

  it('limita a população e mantém nadadores entre a superfície e o fundo variável', () => {
    const cfg = defaultEnvironment();
    cfg.bottom = { ...cfg.bottom, mode: 'relevo', baseDepth: 30, roughness: 20 };
    const relief = new Environment(cfg);
    const habitats = new Set<string>();
    for (let t = 0; t < 300; t += 7) {
      const fish = sampleMarineLife(relief, t, t - 100, -t, { ...DEFAULT_MARINE_LIFE, fishDensity: 'moderada', fishJumps: false });
      expect(fish.length).toBeLessThanOrEqual(MAX_FISH);
      for (const f of fish) {
        habitats.add(f.habitat);
        expect(f.y).toBeGreaterThanOrEqual(-relief.bottomDepthAt(f.n, f.e) + 1.49);
        expect(f.y).toBeLessThanOrEqual(relief.waves.elevation(f.n, f.e, t) - 1.49);
        expect(f.length).toBeGreaterThan(0);
        expect(f.length).toBeLessThanOrEqual(1.55);
      }
    }
    expect(habitats).toEqual(new Set(['agua', 'fundo']));
  });

  it('gera saltos raros, acima das ondas, e permite desligar cada comportamento', () => {
    let jumpFrames = 0;
    let highest = -Infinity;
    for (let t = 0; t < 700; t += 0.25) {
      const fish = sampleMarineLife(env, t, 0, 0, { ...DEFAULT_MARINE_LIFE, fishUnderwater: false });
      if (fish.length) jumpFrames++;
      for (const f of fish) {
        expect(f.habitat).toBe('salto');
        highest = Math.max(highest, f.y);
      }
    }
    expect(jumpFrames).toBeGreaterThan(0);
    expect(jumpFrames / 2800).toBeLessThan(0.15);
    expect(highest).toBeGreaterThan(0.5);
    expect(sampleMarineLife(env, 123, 0, 0, { ...DEFAULT_MARINE_LIFE, fishDensity: 'desligada' })).toEqual([]);
    expect(sampleMarineLife(env, 123, 0, 0, { ...DEFAULT_MARINE_LIFE, fishJumps: false, fishUnderwater: false })).toEqual([]);
    expect(sampleMarineLife(env, 123, 0, 0, { ...DEFAULT_MARINE_LIFE, fishJumps: false }).every((f) => f.habitat !== 'salto')).toBe(true);
  });

  it('não desenha fauna em terra ou em água rasa', () => {
    // O fundo uniforme tem mínimo de 8 m; valores costeiros podem ser negativos.
    const dry = new Environment(structuredClone(config));
    const bottom = vi.spyOn(dry, 'bottomDepthAt');
    for (const depth of [-20, 0, 2, 4.9]) {
      bottom.mockReturnValue(depth);
      for (let t = 0; t < 200; t++) expect(sampleMarineLife(dry, t, 0, 0, DEFAULT_MARINE_LIFE)).toEqual([]);
    }
    bottom.mockReturnValue(8);
    vi.spyOn(dry.waves, 'elevation').mockReturnValue(-6);
    expect(sampleMarineLife(dry, 24, 0, 0, DEFAULT_MARINE_LIFE)).toEqual([]);
    const coast = new Environment({ ...config, geo: { origin: { lat: -22.9, lon: -43.8 }, coast: true, shelfWidth: 1000 } });
    for (let t = 0; t < 50; t += 5) {
      for (const f of sampleMarineLife(coast, t, 0, 0, DEFAULT_MARINE_LIFE)) expect(coast.bottomDepthAt(f.n, f.e)).toBeGreaterThanOrEqual(5);
    }
  });

  it('preserva as posições do mundo ao cruzar células, sem peixes surgindo na borda', () => {
    const a = sampleMarineLife(env, 24, 89.999, 0, DEFAULT_MARINE_LIFE);
    const b = sampleMarineLife(env, 24, 90.001, 0, DEFAULT_MARINE_LIFE);
    expect(a.map(({ n, e }) => [n, e])).toEqual(b.map(({ n, e }) => [n, e]));
  });

  it('atualiza as instâncias, oculta no modo sem água e libera recursos ao fechar a cena', () => {
    const life = new MarineLife();
    life.update(env, 24, 0, 0, true);
    expect(life.group.visible).toBe(true);
    const bodies = life.group.children[0] as THREE.InstancedMesh;
    expect(bodies.count).toBeGreaterThan(0);
    const m = new THREE.Matrix4();
    bodies.getMatrixAt(0, m);
    expect(m.elements.every(Number.isFinite)).toBe(true);
    life.update(env, 24, 0, 0, false);
    expect(life.group.visible).toBe(false);
    life.settings = { ...DEFAULT_MARINE_LIFE, fishDensity: 'desligada' };
    life.update(env, 24, 0, 0, true);
    expect(life.group.visible).toBe(false);
    const dispose = vi.spyOn(bodies.geometry, 'dispose');
    life.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(life.group.children).toHaveLength(0);
  });
});
