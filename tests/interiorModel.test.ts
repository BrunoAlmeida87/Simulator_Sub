/**
 * CORTE COM O INTERIOR DO BLENDER (interiorModel.ts): meio casco aberto do lado da câmera,
 * peças do arquivo ligadas ao corte (mesmos nomes) e ao estado. Só visual: nada aqui toca a física.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import * as THREE from 'three';
import { NodeIO, type Node as GNode } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { InteriorRig, blenderAxis, cutSide, setCutPlane, valveColor, wheelAngle } from '../src/render3d/interiorModel';
import { SystemsVis } from '../src/render3d/Systems';
import { buildScenario } from '../src/sim/scenarios';
import { defaultLayers } from '../src/render3d/layers';

/** cena do glTF reconstruída em Three (malhas como caixas; extras → userData, como faz o GLTFLoader) */
let src: THREE.Group;
beforeAll(async () => {
  await MeshoptDecoder.ready;
  const doc = await new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .read(join(__dirname, '..', 'public', 'models', 'sx1-interior.glb'));
  src = new THREE.Group();
  const build = (gn: GNode, parent: THREE.Object3D) => {
    const o = gn.getMesh() ? new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshStandardMaterial()) : new THREE.Object3D();
    o.name = gn.getName();
    o.userData = { ...(gn.getExtras() as Record<string, unknown>) };
    o.position.fromArray(gn.getTranslation());
    o.quaternion.fromArray(gn.getRotation());
    o.scale.fromArray(gn.getScale());
    parent.add(o);
    for (const c of gn.listChildren()) build(c, o);
  };
  for (const gn of doc.getRoot().listScenes()[0].listChildren()) build(gn, src);
});

describe('meio casco aberto', () => {
  it('some a metade do lado da câmera, com histerese no plano', () => {
    expect(cutSide(3, -1)).toBe(1);
    expect(cutSide(-3, 1)).toBe(-1);
    expect(cutSide(0.2, -1)).toBe(-1); // perto do plano: mantém o lado
    const sub = new THREE.Object3D();
    sub.position.set(10, -5, 3);
    sub.rotation.y = 0.7;
    const plane = setCutPlane(new THREE.Plane(), sub, 1); // câmera a boreste (x local > 0)
    const far = sub.localToWorld(new THREE.Vector3(-2, 0.5, 4));
    const near = sub.localToWorld(new THREE.Vector3(2, 0.5, 4));
    expect(plane.distanceToPoint(far)).toBeGreaterThan(0); // fica
    expect(plane.distanceToPoint(near)).toBeLessThan(0); // recortado
  });

  it('cor e giro do volante pela posição da válvula; eixos do Blender convertidos para a cena', () => {
    expect(valveColor({ cmd: 1, pos: 1, stuck: false })).toBe(0x3ddc84);
    expect(valveColor({ cmd: 0, pos: 0, stuck: false })).toBe(0xff4d4d);
    expect(valveColor({ cmd: 1, pos: 0.4, stuck: false })).toBe(0xffc040);
    expect(valveColor({ cmd: 1, pos: 0.4, stuck: true })).toBe(0xff00ff);
    expect(wheelAngle(0)).toBeCloseTo(0);
    expect(Math.abs(wheelAngle(1))).toBeCloseTo(3 * Math.PI);
    // +Y do Blender (proa) = −Z da cena; +Z do Blender (cima) = +Y da cena
    expect(blenderAxis([0, 1, 0]).distanceTo(new THREE.Vector3(0, 0, -1))).toBeLessThan(1e-9);
    expect(blenderAxis([0, 0, 1]).distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-9);
  });
});

describe('interior do arquivo ligado ao corte e ao estado', () => {
  const e = buildScenario('superficie');
  const sys = new SystemsVis(e, null);

  it('todas as válvulas e bombas do arquivo têm par no corte do site (mesmos nomes)', () => {
    const rig = new InteriorRig(src, sys.interiorLinks());
    expect(rig.unmatched).toEqual([]);
    const kinds = rig.pickables.map((o) => (o.userData.pick as { kind: string }).kind);
    expect(kinds.filter((k) => k === 'valve').length).toBe(sys.interiorLinks().valves.length);
    expect(kinds.filter((k) => k === 'pump').length).toBe(sys.interiorLinks().pumps.length);
    expect(kinds.filter((k) => k === 'tank').length).toBe(sys.interiorLinks().tanks.length);
    expect(kinds).toContain('prop');
    expect(kinds).toContain('battery');
  });

  it('volante pela válvula, rotor da bomba pela rotação, eixo e motor pelo ângulo do eixo', () => {
    const en = buildScenario('superficie');
    const rig = new InteriorRig(src, sys.interiorLinks());
    const vis = sys.visibility(defaultLayers());
    // suspiro do TLP-1 BB aberto
    en.state.ballast['TLP1BB'].vent = { cmd: 1, pos: 1, stuck: false };
    en.state.propulsion.shaftAngle = 1.1;
    en.state.compensation.pump = { ...en.state.compensation.pump, speed: 1, cmd: true };
    rig.update(en, vis, true, 0.1, false);
    const valve = rig.root.getObjectByName('SX1I_Valvula_Suspiro_TLP_1_BB')!;
    const wheel = valve.getObjectByName('SX1I_Valvula_Suspiro_TLP_1_BB_Volante')!;
    const wm = (wheel.getObjectByProperty('isMesh', true) as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(wm.color.getHex()).toBe(new THREE.Color(0x3ddc84).getHex());
    expect(wheel.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.5); // girou (1,5 volta = 3π ≡ π)
    const shaft = rig.root.getObjectByName('SX1I_Eixo')!;
    expect(shaft.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(1.1, 6);
    // rotor do motor gira junto com o eixo
    expect(rig.root.getObjectByName('SX1I_Motor_Rotor')!.quaternion.angleTo(shaft.quaternion)).toBeLessThan(1e-9);
    // bomba de compensação: rotor gira com a rotação
    const bc = rig.root.getObjectByName('SX1I_Bomba_BC_Rotor')!;
    expect(bc.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(1);
    // outra válvula fechada continua vermelha
    const closed = rig.root.getObjectByName('SX1I_Valvula_Sopro_TLP_1_BB_Volante')!;
    expect(((closed.getObjectByProperty('isMesh', true) as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex()).toBe(new THREE.Color(0xff4d4d).getHex());
  });

  it('filtro de tanques, destaque e camada de tubulações valem como no corte', () => {
    const rig = new InteriorRig(src, sys.interiorLinks());
    const node = (n: string) => rig.root.getObjectByName(n)!;
    const layers = { ...defaultLayers(), tanks: true, tankFilter: ['TC'] };
    rig.update(e, sys.visibility(layers), true, 0, true);
    expect(node('SX1I_Tanque_TC').visible).toBe(true);
    expect(node('SX1I_Tanque_TLP1BB').visible).toBe(false);
    expect(node('SX1I_Valvula_Suspiro_TLP_1_BB').visible).toBe(false); // lastro fora do filtro
    expect(node('SX1I_Bateria_1').visible).toBe(false); // energia sai com o filtro (como no corte)
    expect(node('SX1I_CascoResistente').visible).toBe(true); // estrutura fica
    // sem a camada de tubulações, tubos/válvulas/bombas somem; tanques e linha de eixo ficam
    rig.update(e, sys.visibility({ ...defaultLayers(), tanks: true }), false, 0, false);
    expect(node('SX1I_Valvula_Suspiro_TLP_1_BB').visible).toBe(false);
    expect(node('SX1I_Tubo_01').visible).toBe(false);
    expect(node('SX1I_Tanque_TLP1BB').visible).toBe(true);
    expect(node('SX1I_Eixo').visible).toBe(true);
    // destaque: peças de outros sistemas ficam apagadas
    rig.update(e, sys.visibility({ ...defaultLayers(), tanks: true, highlight: 'TC' }), true, 0, false);
    const tlpMat = (node('SX1I_Tanque_TLP1BB').getObjectByProperty('isMesh', true) as THREE.Mesh).material as THREE.Material;
    const tcMat = (node('SX1I_Tanque_TC').getObjectByProperty('isMesh', true) as THREE.Mesh).material as THREE.Material;
    expect(tlpMat.opacity).toBeLessThan(tcMat.opacity);
  });

  it('o plano de corte chega a todos os materiais do interior', () => {
    const rig = new InteriorRig(src, sys.interiorLinks());
    const plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    rig.setClip(plane);
    let n = 0;
    rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const x of Array.isArray(m.material) ? m.material : [m.material]) {
        expect(x.clippingPlanes?.[0]).toBe(plane);
        n++;
      }
    });
    expect(n).toBeGreaterThan(100);
  });
});
