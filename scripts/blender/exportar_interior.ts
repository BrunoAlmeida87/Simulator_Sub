/**
 * Exporta o ARRANJO INTERNO do corte publicado (src/render3d/Systems.ts) para o Blender:
 * tanques (forma exata), tubulações (trajetos e diâmetros), válvulas (posição e orientação),
 * bombas, aberturas para o mar, garrafas de ar AP, bateria e geradores, e os trajetos das
 * partículas de escoamento. Assim o modelo interno (build_sx1_interior.py) fica nas mesmas
 * posições do simulador, e um corte futuro com o .glb pode reaproveitar os mesmos caminhos.
 *
 * Uso: npx vite-node scripts/blender/exportar_interior.ts [saida.json]
 * Saída padrão: build/modelo/interior.json (coordenadas do Blender: +X boreste, +Y proa, +Z cima).
 */
import * as THREE from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildScenario } from '../../src/sim/scenarios';
import { SystemsVis } from '../../src/render3d/Systems';
import { TANK_STYLE } from '../../src/render3d/layers';
import { PRESSURE_HULL } from '../../src/render3d/pressureHull';

const out = process.argv[2] ?? join('build', 'modelo', 'interior.json');
const e = buildScenario('superficie');
const sv = new SystemsVis(e, null);
sv.group.updateMatrixWorld(true);

/** cena (X boreste, Y cima, Z popa) → Blender (X boreste, Y proa, Z cima), com 4 casas */
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const toB = (v: THREE.Vector3) => [r4(v.x), r4(-v.z), r4(v.y)];
const hex = (c: THREE.Color) => '#' + c.getHexString();

// acesso aos campos internos (só leitura): o arranjo é o mesmo que o site desenha
const S = sv as unknown as {
  tanks: { id: string; cat: keyof typeof TANK_STYLE; name: string; short: string; cap: number; pick: THREE.Mesh }[];
  pipePaths: THREE.Vector3[][];
  pipeMats: { mat: THREE.MeshBasicMaterial; owners: string[]; mesh: THREE.Mesh }[];
  valves: { mesh: THREE.Group; name: string; owners: string[]; directional?: boolean }[];
  pumps: { name: string; owners: string[]; pos: THREE.Vector3 }[];
  ports: { out: THREE.Vector3; base: THREE.Vector3; owners: string[]; mesh: THREE.Mesh }[];
  streams: { pts: THREE.Vector3[]; color: THREE.Color; owners: string[] }[];
  hpBottles: { id: string; grp: THREE.Group }[];
  batt: THREE.Mesh[];
  gens: { mesh: THREE.Mesh; id: string }[];
};

const tanks = S.tanks.map((t) => {
  const g = t.pick.geometry.index ? t.pick.geometry.toNonIndexed() : t.pick.geometry;
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  const verts: number[][] = [];
  for (let i = 0; i < pos.count; i++) verts.push(toB(v.fromBufferAttribute(pos, i).applyMatrix4(t.pick.matrixWorld)));
  return { id: t.id, nome: t.name, curto: t.short, categoria: t.cat, cor: TANK_STYLE[t.cat].css, capacidade: t.cap, triangulos: verts };
});

const pipes = S.pipePaths.map((pts, i) => {
  const pm = S.pipeMats[i];
  const radius = (pm.mesh.geometry as THREE.TubeGeometry).parameters.radius;
  return { pontos: pts.map(toB), raio: r4(radius), cor: hex(pm.mat.color), sistemas: pm.owners };
});

const valves = S.valves.map((vv) => {
  const m = vv.mesh;
  // eixo x local = eixo do tubo; y local = haste
  const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(m.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(m.quaternion);
  const toDir = (d: THREE.Vector3) => [r4(d.x), r4(-d.z), r4(d.y)];
  return { nome: vv.name, sistemas: vv.owners, sistema: (m.userData.pick as { sys: string }).sys, centro: toB(m.position), eixo: toDir(ax), haste: toDir(up) };
});

const pumps = S.pumps.map((p) => ({ nome: p.name, sistemas: p.owners, centro: toB(p.pos) }));
const ports = S.ports.map((p) => ({ base: toB(p.base), saida: [r4(p.out.x), r4(-p.out.z), r4(p.out.y)], sistemas: p.owners, cor: hex((p.mesh.material as THREE.MeshBasicMaterial).color) }));
const streams = S.streams.map((s) => ({ pontos: s.pts.map(toB), cor: hex(s.color), sistemas: s.owners }));

const bottles = S.hpBottles.flatMap((b) =>
  b.grp.children.map((bottle) => {
    bottle.updateMatrixWorld(true);
    const body = bottle.children[0] as THREE.Mesh;
    body.geometry.computeBoundingBox();
    const bb = body.geometry.boundingBox!;
    const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(bottle.getWorldQuaternion(new THREE.Quaternion()));
    return {
      grupo: b.id,
      centro: toB(bottle.getWorldPosition(new THREE.Vector3())),
      eixo: [r4(ax.x), r4(-ax.z), r4(ax.y)],
      comprimento: r4(bb.max.y - bb.min.y),
      raio: r4(bb.max.x),
      cor: hex((body.material as THREE.MeshStandardMaterial).color),
      emergencia: b.id.startsWith('AE'),
    };
  }),
);

const box = (m: THREE.Mesh) => {
  const p = (m.geometry as THREE.BoxGeometry).parameters;
  // caixa: largura (x da cena = boreste), altura (y), comprimento (z = popa)
  return { centro: toB(m.getWorldPosition(new THREE.Vector3())), tamanho: [r4(p.width), r4(p.depth), r4(p.height)] };
};
const battery = S.batt.map(box);
const generators = S.gens.map((g) => ({ id: g.id, ...box(g.mesh) }));

const v = e.vessel;
const doc = {
  gerado: 'scripts/blender/exportar_interior.ts a partir de src/render3d/Systems.ts (cenário superficie)',
  casco: {
    comprimento: v.hull.length,
    diametro: v.hull.diameter,
    proa: v.hull.bowLength,
    popa: v.hull.sternLength,
    raioPonta: v.hull.tailRadius,
    raioResistente: PRESSURE_HULL.innerRadius,
    cascoResistente: PRESSURE_HULL,
  },
  tanques: tanks,
  tubos: pipes,
  valvulas: valves,
  bombas: pumps,
  aberturas: ports,
  escoamentos: streams,
  garrafas: bottles,
  bateria: battery,
  geradores: generators,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(doc));
console.log(
  `interior: ${tanks.length} tanques, ${pipes.length} tubos, ${valves.length} válvulas, ${pumps.length} bombas, ${ports.length} aberturas, ${bottles.length} garrafas, ${battery.length} bateria, ${generators.length} geradores → ${out}`,
);
