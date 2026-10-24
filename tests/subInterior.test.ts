/**
 * MODELO INTERNO (public/models/sx1-interior.glb), feito por scripts/blender/build_sx1_interior.py
 * a partir do arranjo do corte publicado (src/render3d/Systems.ts). Ainda não é carregado pelo
 * site: o teste garante que o arquivo continua batendo com o corte, para a futura vista em corte.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { buildScenario } from '../src/sim/scenarios';
import { SystemsVis } from '../src/render3d/Systems';

const file = join(__dirname, '..', 'public', 'models', 'sx1-interior.glb');
let doc: Document;
const e = buildScenario('superficie');
const sys = new SystemsVis(e, null) as unknown as { tanks: { id: string }[]; valves: { name: string; mesh: THREE.Object3D }[]; pumps: unknown[]; pipePaths: unknown[] };

beforeAll(async () => {
  await MeshoptDecoder.ready;
  doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read(file);
});

const nodes = () => doc.getRoot().listNodes();
const byPrefix = (p: string) => nodes().filter((n) => n.getName().startsWith(p) && !n.getName().endsWith('_Malha') && n.getParentNode()?.getName().startsWith(p) !== true);

describe('modelo interno sx1-interior.glb', () => {
  it('existe, é comprimido (meshopt) e cabe no limite', () => {
    expect(statSync(file).size).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(
      doc
        .getRoot()
        .listExtensionsUsed()
        .map((x) => x.extensionName),
    ).toContain('EXT_meshopt_compression');
  });

  it('tem as mesmas peças do corte publicado (tanques, válvulas, bombas, tubulações)', () => {
    for (const t of sys.tanks)
      expect(
        nodes().some((n) => n.getName() === `SX1I_Tanque_${t.id}`),
        t.id,
      ).toBe(true);
    const valves = byPrefix('SX1I_Valvula_');
    expect(valves.length).toBe(sys.valves.length);
    expect(byPrefix('SX1I_Bomba_').length).toBe(sys.pumps.length);
    expect(byPrefix('SX1I_Tubo_').length).toBe(sys.pipePaths.length);
  });

  it('cada válvula fica na posição do corte e guarda o nome em extras (userData no site)', () => {
    const m = new THREE.Matrix4();
    for (const n of byPrefix('SX1I_Valvula_')) {
      const ex = n.getExtras() as { nome: string };
      const v = sys.valves.find((x) => x.name === ex.nome && !(x as { used?: boolean }).used) as { name: string; mesh: THREE.Object3D; used?: boolean };
      expect(v, ex.nome).toBeDefined();
      v.used = true;
      const p = new THREE.Vector3().setFromMatrixPosition(m.fromArray(n.getWorldMatrix()));
      expect(p.distanceTo(v.mesh.position), ex.nome).toBeLessThan(0.002);
    }
  });

  it('nós só com translação (a compressão não mexe nos pivôs) e peças móveis com eixo de giro', () => {
    for (const n of nodes()) {
      const q = n.getRotation();
      const s = n.getScale();
      expect(Math.abs(q[3]), n.getName()).toBeGreaterThan(1 - 1e-6);
      if (!n.getName().endsWith('_Malha')) expect(s, n.getName()).toEqual([1, 1, 1]);
    }
    const wheels = nodes().filter((n) => n.getName().endsWith('_Volante'));
    const rotors = nodes().filter((n) => n.getName().endsWith('_Rotor'));
    expect(wheels.length).toBeGreaterThan(20);
    expect(rotors.length).toBe(sys.pumps.length);
    for (const w of [...wheels, ...rotors]) expect((w.getExtras() as { eixo_giro?: number[] }).eixo_giro, w.getName()).toHaveLength(3);
  });

  it('casco resistente com anteparas: tanques de lastro (TLP) fora dele, os demais tanques dentro', () => {
    const fwd = nodes()
      .find((n) => n.getName() === 'SX1I_Antepara_Vante')!
      .getExtras() as { y_apice: number };
    const aft = nodes()
      .find((n) => n.getName() === 'SX1I_Antepara_Re')!
      .getExtras() as { y_apice: number };
    const hull = nodes()
      .find((n) => n.getName() === 'SX1I_CascoResistente')!
      .getExtras() as { raio_interno: number };
    expect(hull.raio_interno).toBeCloseTo(2.9, 6); // mesmo raio da física (hullRadius dos tanques internos)
    /** extensão longitudinal (proa = +Y no Blender = −Z na cena) de um tanque no arquivo */
    const span = (id: string) => {
      const n = nodes().find((x) => x.getName() === `SX1I_Tanque_${id}_Malha`)!;
      const m = new THREE.Matrix4().fromArray(n.getWorldMatrix());
      const pos = n.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!;
      const el: number[] = [];
      const p = new THREE.Vector3();
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, el);
        const x = -p.set(el[0], el[1], el[2]).applyMatrix4(m).z;
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
      return { lo, hi };
    };
    const v = e.vessel;
    for (const t of v.ballast.tanks) {
      const s = span(t.id);
      if (t.center.x > 0) expect(s.lo, t.id).toBeGreaterThan(fwd.y_apice);
      else expect(s.hi, t.id).toBeLessThan(aft.y_apice);
    }
    for (const t of [...v.compensation.tanks, v.trim.tankA, v.trim.tankB, v.heel.tankA, v.heel.tankB]) {
      const s = span(t.id);
      expect(s.lo, t.id).toBeGreaterThan(aft.y_apice);
      expect(s.hi, t.id).toBeLessThan(fwd.y_apice);
    }
  });
});
