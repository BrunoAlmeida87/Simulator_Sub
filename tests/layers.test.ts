/**
 * CAMADAS: qualquer combinação é possível (inclusive nenhuma), os rótulos de
 * bateria e de ar comprimido têm camada própria e mostram valores do modelo.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { SystemsVis } from '../src/render3d/Systems';
import { LAYER_GROUPS, LAYER_INFO, allLayersOff, allLayersOn, defaultLayers, toggleLayerGroup, type SceneLayers } from '../src/render3d/layers';
import type { Label3D } from '../src/render3d/SubmarineScene';
import { bankPressure } from '../src/sim/systems/hpAir';

const KEYS = Object.keys(LAYER_INFO) as (keyof typeof LAYER_INFO)[];

function labelsFor(layers: Partial<SceneLayers>, e = buildScenario('submerso_50')) {
  const vis = new SystemsVis(e, null);
  const sub = new THREE.Group();
  sub.add(vis.group);
  const out: Label3D[] = [];
  const proj = () => ({ x: 10, y: 10, visible: true });
  vis.update(e, sub, { ...defaultLayers(), ...layers }, 0, out, proj);
  return { out, vis, e };
}

describe('Camadas: marcar e desmarcar todas', () => {
  it('“Desmarcar todas” desliga todas, inclusive sem água e iluminação', () => {
    const p = allLayersOff(KEYS);
    for (const k of KEYS) expect(p[k]).toBe(false);
  });
  it('“Marcar todas” liga as de informação, sem tirar a água nem mudar a luz', () => {
    const p = allLayersOn(KEYS);
    expect(p.noWater).toBeUndefined();
    expect(p.presLight).toBeUndefined();
    for (const k of KEYS) if (!LAYER_INFO[k].mode) expect(p[k]).toBe(true);
    expect(p.hiddenVectors).toEqual([]);
  });
  it('o casco não entra em marcar/desmarcar (é o próprio submarino)', () => {
    expect('hull' in allLayersOff(KEYS)).toBe(false);
    expect(defaultLayers().hull).toBe(true);
  });
});

describe('Camadas no 3D (valores do modelo)', () => {
  it('tudo desligado: nenhum rótulo', () => {
    const { out } = labelsFor({ ...allLayersOff(KEYS), tanks: false });
    expect(out).toEqual([]);
  });

  it('bateria: camada própria, só com o corte, com a carga do modelo', () => {
    const none = labelsFor({ ...allLayersOff(KEYS), batteryInfo: true });
    expect(none.out.find((l) => l.id === 'pwB')).toBeUndefined();
    const cut = labelsFor({ ...allLayersOff(KEYS), tanks: true, batteryInfo: true });
    const b = cut.out.find((l) => l.id === 'pwB');
    expect(b?.text).toBe(`Bateria ${(cut.e.state.electrical.soc * 100).toFixed(0)} %`);
    expect(b?.callout).toBe(true);
    // identificações desligadas não afetam a bateria, e vice-versa
    const off = labelsFor({ ...allLayersOff(KEYS), tanks: true, labels: true, batteryInfo: false });
    expect(off.out.find((l) => l.id === 'pwB')).toBeUndefined();
  });

  it('ar comprimido: pressão e massa de cada grupo vêm do modelo e acompanham o consumo', () => {
    const e = buildScenario('submerso_50');
    const first = labelsFor({ ...allLayersOff(KEYS), tanks: true, airInfo: true }, e).out.filter((l) => l.id.startsWith('air'));
    expect(first.length).toBe(e.vessel.hpAir.banks.length);
    for (const b of e.vessel.hpAir.banks) {
      const l = first.find((x) => x.id === 'air' + b.id)!;
      expect(l.callout).toBe(true);
      const p = bankPressure(e.vessel.hpAir, b.id, e.state.hpAir.banks[b.id].mass) / 1e5;
      expect(l.text).toBe(`${b.id} · ${p.toFixed(0)} bar`);
      expect(l.sub).toContain(`${e.state.hpAir.banks[b.id].mass.toFixed(0)} kg de ar`);
    }
    // sopro de emergência: a massa cai e o rótulo acompanha
    applyCommand(e, { type: 'emergencyBlow' });
    e.advanceSim(20);
    const after = labelsFor({ ...allLayersOff(KEYS), tanks: true, airInfo: true }, e).out.filter((l) => l.id.startsWith('air'));
    const b0 = e.vessel.hpAir.banks.find((b) => b.purpose === 'emergency')!;
    const p1 = bankPressure(e.vessel.hpAir, b0.id, e.state.hpAir.banks[b0.id].mass) / 1e5;
    expect(after.find((x) => x.id === 'air' + b0.id)!.text).toBe(`${b0.id} · ${p1.toFixed(0)} bar`);
    expect(p1).toBeLessThan(249);
    const normal = e.vessel.hpAir.banks.find((b) => b.purpose !== 'emergency')!;
    expect(bankPressure(e.vessel.hpAir, normal.id, e.state.hpAir.banks[normal.id].mass) / 1e5).toBeCloseTo(250, 8);
  });

  it('filtro de tanques vazio = nenhum tanque nem circuito no corte', () => {
    const { vis } = labelsFor({ tanks: true, pipes: true, tankFilter: [] });
    // visível de fato: o objeto e todos os seus pais
    const shown = (o: THREE.Object3D | null): boolean => !o || (o.visible && shown(o.parent));
    const anyVisible = (g: THREE.Object3D) => {
      let n = 0;
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && shown(o) && o.userData.pick && ['tank', 'hp', 'battery', 'generator'].includes(o.userData.pick.kind)) n++;
      });
      return n;
    };
    expect(anyVisible(vis.group)).toBe(0);
  });
});

describe('Camadas em grupos', () => {
  it('toda camada está em exatamente um grupo', () => {
    const all = LAYER_GROUPS.flatMap((g) => g.keys);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...KEYS].sort());
  });
  it('o clique no grupo liga as camadas de informação ou desliga o grupo; o grupo só de modos (Ambiente) também liga', () => {
    const vet = LAYER_GROUPS.find((g) => g.id === 'vetores')!.keys;
    expect(toggleLayerGroup(vet, {})).toEqual({ vectors: true, hydroVectors: true, trimVectors: true, hiddenVectors: [] });
    expect(toggleLayerGroup(vet, { hydroVectors: true })).toEqual({ vectors: false, hydroVectors: false, trimVectors: false });
    const amb = LAYER_GROUPS.find((g) => g.id === 'amb')!.keys;
    expect(toggleLayerGroup(amb, {})).toEqual({ fog: true, noWater: true, presLight: true });
    expect(toggleLayerGroup(['noWater'], {})).toEqual({ noWater: true });
    expect(toggleLayerGroup(amb, { noWater: true })).toEqual({ fog: false, noWater: false, presLight: false });
  });
});
