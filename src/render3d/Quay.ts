/**
 * CAIS da base (Ilha da Madeira, Itaguaí) — modelo 3D leve: plataforma sobre
 * estacas, defensas, cabeços, postes de iluminação, guindaste e galpão em
 * terra. Posição e direção em src/sim/geo.ts (QUAY), na orla da costa do
 * simulador. APENAS VISUAL: não colide com o submarino.
 */
import * as THREE from 'three';
import { latLonToNed, QUAY, type LatLon } from '../sim/geo';
import type { Environment } from '../sim/environment/environment';

const m = (c: number, r = 0.8, mt = 0.1) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt });

export function buildQuay(): THREE.Group {
  const g = new THREE.Group();
  const L = QUAY.length;
  const W = QUAY.width;
  const top = 3.2; // m acima do nível do mar
  const concrete = m(0xb9b6ad, 0.9);
  const dark = m(0x2a2d31, 0.7);
  const yellow = m(0xe6c229, 0.6);
  // plataforma: do ponto x = −25 (em terra) até L (mar); eixo local +z = para o mar
  const deck = new THREE.Mesh(new THREE.BoxGeometry(W, 1.4, L + 25), concrete);
  deck.position.set(0, top - 0.7, (L - 25) / 2);
  g.add(deck);
  // faixa amarela de borda
  for (const s of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, L), yellow);
    edge.position.set(s * (W / 2 - 0.6), top + 0.06, L / 2);
    g.add(edge);
  }
  // estacas
  const pileGeo = new THREE.CylinderGeometry(0.45, 0.45, 22, 10);
  for (let z = 8; z <= L; z += 14)
    for (const x of [-W / 2 + 1.5, 0, W / 2 - 1.5]) {
      const p = new THREE.Mesh(pileGeo, dark);
      p.position.set(x, top - 1.4 - 11, z);
      g.add(p);
    }
  // defensas (pneus/cilindros) e cabeços
  const fender = new THREE.CylinderGeometry(0.7, 0.7, 2.2, 12);
  const bollard = new THREE.CylinderGeometry(0.35, 0.45, 0.8, 10);
  for (let z = 12; z <= L - 4; z += 18)
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(fender, m(0x151515, 0.95));
      f.rotation.z = Math.PI / 2;
      f.position.set(s * (W / 2 + 0.6), top - 1.2, z);
      g.add(f);
      const b = new THREE.Mesh(bollard, dark);
      b.position.set(s * (W / 2 - 1.6), top + 0.4, z + 6);
      g.add(b);
    }
  // postes de iluminação
  const pole = new THREE.CylinderGeometry(0.15, 0.2, 12, 8);
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
  for (let z = 20; z <= L; z += 50) {
    const p = new THREE.Mesh(pole, m(0x8a8f96, 0.5, 0.4));
    p.position.set(0, top + 6, z);
    g.add(p);
    const l = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 0.6), lamp);
    l.position.set(0, top + 12, z);
    g.add(l);
  }
  // guindaste sobre trilhos
  const crane = new THREE.Group();
  const cm = m(0xc0392b, 0.6, 0.3);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 22, 1.2), cm);
    leg.position.set(s * 7, 11, 0);
    crane.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(16, 2, 2), cm);
  beam.position.set(0, 22, 0);
  crane.add(beam);
  const boom = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 34), cm);
  boom.position.set(-7, 23.5, 14);
  crane.add(boom);
  crane.position.set(0, top, L * 0.45);
  g.add(crane);
  // galpão em terra (grupo assentado no terreno por placeQuay)
  const onLand = new THREE.Group();
  onLand.name = 'emTerra';
  g.add(onLand);
  const shed = new THREE.Mesh(new THREE.BoxGeometry(60, 14, 34), m(0xd5d8dc, 0.8));
  shed.position.set(-10, top + 7, -50);
  onLand.add(shed);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(62, 1.2, 36), m(0x5d6d7e, 0.7));
  roof.position.set(-10, top + 14.6, -50);
  onLand.add(roof);
  const office = new THREE.Mesh(new THREE.BoxGeometry(18, 9, 14), m(0xecf0f1, 0.8));
  office.position.set(32, top + 4.5, -40);
  onLand.add(office);
  // base de concreto do pátio (cobre a diferença até o terreno)
  const yard = new THREE.Mesh(new THREE.BoxGeometry(110, 30, 70), concrete);
  yard.position.set(5, top - 15, -45);
  onLand.add(yard);
  return g;
}

/** Posiciona o cais no referencial local (origem flutuante no submarino). */
export function placeQuay(q: THREE.Group, origin: LatLon, env: Environment, pn: number, pe: number): void {
  const r = latLonToNed(origin, QUAY.root);
  const b = (QUAY.bearing * Math.PI) / 180;
  // terreno na raiz (o galpão fica no chão)
  const ground = Math.max(0, -env.bottomDepthAt(r.n - Math.cos(b) * 50, r.e - Math.sin(b) * 50));
  q.position.set(r.e - pe, 0, -(r.n - pn));
  // eixo local +z do modelo → direção do cais (rumo QUAY.bearing)
  q.rotation.set(0, Math.PI - b, 0);
  q.userData.ground = ground;
  const land = q.getObjectByName('emTerra');
  if (land) land.position.y = Math.max(0, ground - 3.2);
}
