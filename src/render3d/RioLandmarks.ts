/**
 * MARCOS DO RIO DE JANEIRO (só visual): Cristo Redentor no Corcovado, Ponte
 * Rio–Niterói e os nomes dos lugares da orla e da baía (camada
 * "Identificações"). O relevo e a imagem da cidade vêm do terreno
 * (terrainAssets.ts); aqui ficam as estruturas que o relevo de 30 m não
 * mostra. Posições geográficas reais; a ponte segue o traçado da imagem
 * Sentinel-2 (05/08/2024). Os pilares não entram na física.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { latLonToNed, type LatLon } from '../sim/geo';
import { fineHeight } from './terrainAssets';
import type { Label3D } from './SubmarineScene';

/** traçado da ponte (lat, lon) e altura do tabuleiro (m) — vão central com 72 m livres sobre o canal */
const BRIDGE: [number, number, number][] = [
  [-22.87063, -43.20366, 10],
  [-22.86899, -43.20152, 14],
  [-22.8678, -43.19901, 18],
  [-22.86734, -43.19437, 24],
  [-22.86879, -43.17971, 42],
  [-22.87043, -43.15955, 66],
  [-22.87116, -43.1529, 76],
  [-22.87182, -43.14611, 64],
  [-22.87248, -43.13552, 30],
  [-22.87458, -43.1193, 10],
];

const CHRIST: LatLon = { lat: -22.951916, lon: -43.210487 };

/** nomes na orla e na baía: [nome, lat, lon, altura do rótulo acima do relevo (m)] */
const PLACES: [string, number, number, number][] = [
  ['Pão de Açúcar', -22.9486, -43.1566, 60],
  ['Morro da Urca', -22.9497, -43.1652, 40],
  ['Corcovado — Cristo Redentor', -22.9519, -43.2105, 70],
  ['Pedra da Gávea', -22.9978, -43.2847, 50],
  ['Morro Dois Irmãos', -22.9876, -43.24, 40],
  ['Fortaleza de Santa Cruz', -22.9397, -43.1337, 30],
  ['Escola Naval (Villegagnon)', -22.9135, -43.16, 25],
  ['Ilha Fiscal', -22.8967, -43.1665, 20],
  ['Arsenal de Marinha — Ilha das Cobras', -22.8955, -43.1705, 25],
  ['Base de Submarinos — Ilha de Mocanguê', -22.8722, -43.1352, 25],
  ['Ponte Rio–Niterói', -22.8706, -43.1585, 95],
  ['Aeroporto Santos Dumont', -22.9105, -43.1631, 20],
  ['Niterói', -22.905, -43.105, 40],
  ['Leme', -22.9632, -43.1693, 30],
  ['Copacabana', -22.9711, -43.1863, 30],
  ['Ipanema', -22.9868, -43.2049, 30],
  ['Leblon', -22.9871, -43.2236, 30],
  ['São Conrado', -22.9993, -43.2627, 30],
  ['Barra da Tijuca', -23.0097, -43.3561, 30],
  ['Recreio — Pontal', -23.0322, -43.4706, 30],
  ['Ilhas Cagarras', -23.0287, -43.2003, 20],
  ['Ilha do Governador', -22.8, -43.2, 30],
  ['Pedra Branca', -22.933, -43.465, 60],
  ['Pico da Tijuca', -22.9355, -43.2867, 50],
];

/** caixa da região (só aparece com a costa ligada e a origem perto do Rio) */
const NEAR = { lat0: -23.3, lat1: -22.5, lon0: -43.75, lon1: -42.85 };

function christStatue(): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.7, emissive: 0x2a2924 });
  const rock = new THREE.MeshStandardMaterial({ color: 0x5f6458, roughness: 0.95 });
  const conc = new THREE.MeshStandardMaterial({ color: 0xbdb7a8, roughness: 0.85 });
  const m = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(geo, mat);
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  // topo do morro (rocha) sob o mirante: une a estátua ao relevo mesmo com a malha distante mais grosseira
  m(new THREE.CylinderGeometry(14, 60, 90, 18), rock, 0, -45, 0);
  // mirante e pedestal (8 m)
  m(new THREE.BoxGeometry(26, 2.5, 22), conc, 0, 1.25, 0);
  m(new THREE.BoxGeometry(9.5, 8, 9.5), conc, 0, 6.5, 0);
  // estátua (30 m): manto, ombros, braços abertos (28 m) e cabeça
  const robe = m(new THREE.CylinderGeometry(2.1, 3.1, 21, 16), stone, 0, 10.5 + 10.5, 0);
  robe.scale.z = 0.75;
  m(new THREE.BoxGeometry(5.2, 3.2, 3.0), stone, 0, 10.5 + 22.4, 0);
  m(new THREE.BoxGeometry(28, 1.6, 1.9), stone, 0, 10.5 + 23.2, 0);
  // mangas caindo dos braços
  for (const s of [-1, 1]) m(new THREE.BoxGeometry(5.5, 2.6, 1.5), stone, s * 10.5, 10.5 + 22.1, 0);
  m(new THREE.CylinderGeometry(0.9, 1.1, 1.4, 12), stone, 0, 10.5 + 24.6, 0);
  const head = m(new THREE.SphereGeometry(1.5, 16, 12), stone, 0, 10.5 + 26.3, 0);
  head.scale.y = 1.25;
  return g;
}

function bridgeGeometry(anchor: LatLon): { deck: THREE.BufferGeometry; piers: { x: number; z: number; h: number; big: boolean }[] } {
  const P = BRIDGE.map(([lat, lon, h]) => {
    const q = latLonToNed(anchor, { lat, lon });
    return { x: q.e, z: -q.n, h };
  });
  const parts: THREE.BufferGeometry[] = [];
  const piers: { x: number; z: number; h: number; big: boolean }[] = [];
  let acc = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i];
    const b = P[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(L / 40));
    for (let k = 0; k < n; k++) {
      const f0 = k / n;
      const f1 = (k + 1) / n;
      const x0 = a.x + (b.x - a.x) * f0;
      const z0 = a.z + (b.z - a.z) * f0;
      const x1 = a.x + (b.x - a.x) * f1;
      const z1 = a.z + (b.z - a.z) * f1;
      const h0 = a.h + (b.h - a.h) * f0;
      const h1 = a.h + (b.h - a.h) * f1;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const box = new THREE.BoxGeometry(len + 0.6, 4.2, 26);
      const ang = Math.atan2(-(z1 - z0), x1 - x0);
      const pitch = Math.atan2(h1 - h0, len);
      box.rotateZ(pitch);
      box.rotateY(ang);
      box.translate((x0 + x1) / 2, (h0 + h1) / 2 + 2.1, (z0 + z1) / 2);
      parts.push(box);
      // pilares: a cada ~80 m nos acessos; vãos de 200–300 m no trecho alto do canal
      const step = h0 > 55 ? 240 : 80;
      const s0 = acc + len * k;
      if (Math.floor((s0 + len) / step) > Math.floor(s0 / step)) piers.push({ x: x0, z: z0, h: h0, big: h0 > 45 });
    }
    acc += L;
  }
  return { deck: mergeGeometries(parts, false)!, piers };
}

export class RioLandmarks {
  readonly group = new THREE.Group();
  private christ: THREE.Group;
  private bridge: THREE.Group;
  private bridgeAnchor: LatLon = { lat: BRIDGE[0][0], lon: BRIDGE[0][1] };

  constructor() {
    this.group.name = 'Marcos do Rio';
    this.christ = christStatue();
    this.group.add(this.christ);
    // ponte: tabuleiro e pilares (instanciados)
    this.bridge = new THREE.Group();
    const { deck, piers } = bridgeGeometry(this.bridgeAnchor);
    const conc = new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.85 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x5c6a73, roughness: 0.6, metalness: 0.3 });
    const deckMesh = new THREE.Mesh(deck, steel);
    this.bridge.add(deckMesh);
    const pg = new THREE.CylinderGeometry(1, 1, 1, 10);
    pg.translate(0, 0.5, 0);
    const inst = new THREE.InstancedMesh(pg, conc, piers.length * 2);
    const m4 = new THREE.Matrix4();
    let i = 0;
    for (const p of piers) {
      const r = p.big ? 4.5 : 2.2;
      const h = p.h + 12; // até o fundo raso
      for (const s of [-1, 1]) {
        m4.makeScale(r, h, r).setPosition(p.x, -12, p.z + s * 6.5);
        inst.setMatrixAt(i++, m4);
      }
    }
    inst.count = i;
    this.bridge.add(inst);
    this.group.add(this.bridge);
    this.group.visible = false;
  }

  /**
   * Posiciona (origem flutuante: pn/pe) e mostra só perto do Rio com a costa
   * ligada. A estátua espera o relevo fino para pousar no topo do Corcovado.
   */
  update(origin: LatLon | null, pn: number, pe: number, show: boolean): void {
    const near = !!origin && origin.lat > NEAR.lat0 && origin.lat < NEAR.lat1 && origin.lon > NEAR.lon0 && origin.lon < NEAR.lon1;
    this.group.visible = show && near;
    if (!this.group.visible || !origin) return;
    const place = (o: THREE.Object3D, ll: LatLon, y: number) => {
      const q = latLonToNed(origin, ll);
      o.position.set(q.e - pe, y, -(q.n - pn));
    };
    const h = fineHeight(CHRIST.lat, CHRIST.lon);
    this.christ.visible = h !== null;
    if (h !== null) place(this.christ, CHRIST, h + 2);
    place(this.bridge, this.bridgeAnchor, 0);
  }

  /** nomes dos lugares (até ~18 km da câmera) */
  label(origin: LatLon | null, pn: number, pe: number, cam: THREE.Vector3, lbl: Label3D[], proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean }): void {
    if (!this.group.visible || !origin) return;
    const v = new THREE.Vector3();
    for (const [name, lat, lon, up] of PLACES) {
      const q = latLonToNed(origin, { lat, lon });
      const x = q.e - pe;
      const z = -(q.n - pn);
      const d = Math.hypot(x - cam.x, z - cam.z);
      if (d > 18000) continue;
      const y = (fineHeight(lat, lon) ?? 10) + up;
      const p = proj(v.set(x, y, z));
      lbl.push({ id: 'rio-' + name, text: name, ...p, small: true, prio: 3, color: '#ffe9a8' });
    }
  }
}
