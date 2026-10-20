/**
 * ESTALEIRO E BASE NAVAL DA ILHA DA MADEIRA (Itaguaí) — modelo 3D leve.
 *
 * Contornos (aterro, cais, quebra-mares, shiplift) vêm de
 * src/sim/environment/shipyard.ts — os MESMOS que a física e o mapa usam;
 * por isso as paredes e taludes desenhados coincidem com o que o casco sente.
 * Galpões, tanques, guindastes e o píer do Porto Sudeste são apenas visuais
 * (posições e tamanhos estimados de imagem de satélite e fotografias).
 *
 * Referencial local: x = leste, z = −norte, y = altura (m), a partir de
 * SHIPYARD_ANCHOR; a cena desloca o grupo para a origem flutuante.
 * As peças são agrupadas por material (poucas chamadas de desenho).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bufferOutline, MOUND_CREST, MOUND_SLOPE, QUAY_TOP, shipyardLocal, type V2 } from '../sim/environment/shipyard';
import { latLonToNed, type LatLon } from '../sim/geo';
import type { Label3D } from './SubmarineScene';

type Detail = 'baixa' | 'media' | 'alta';

// ------------------------------------------------------------------ texturas
function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function rnd(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff);
}

/** concreto do pátio: placas de 8 m com juntas e manchas (textura cobre 32 m) */
const concreteTex = () =>
  canvasTex(256, (g, S) => {
    const r = rnd(7);
    g.fillStyle = '#c9c6bd';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      const v = 180 + Math.floor(r() * 40);
      g.fillStyle = `rgba(${v},${v - 3},${v - 10},0.25)`;
      g.fillRect(r() * S, r() * S, 2 + r() * 10, 2 + r() * 10);
    }
    g.strokeStyle = 'rgba(90,88,82,0.55)';
    g.lineWidth = 1.2;
    for (let k = 0; k <= 4; k++) {
      g.beginPath();
      g.moveTo((k * S) / 4, 0);
      g.lineTo((k * S) / 4, S);
      g.moveTo(0, (k * S) / 4);
      g.lineTo(S, (k * S) / 4);
      g.stroke();
    }
  });

/** pedras do enrocamento (textura cobre 12 m) */
const rockTex = () =>
  canvasTex(256, (g, S) => {
    const r = rnd(11);
    g.fillStyle = '#6f6c66';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
      const v = 95 + Math.floor(r() * 90);
      g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      g.beginPath();
      const x = r() * S;
      const y = r() * S;
      const rad = 6 + r() * 16;
      g.ellipse(x, y, rad, rad * (0.6 + r() * 0.4), r() * Math.PI, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(30,30,28,0.5)';
      g.stroke();
    }
  });

/** chapa ondulada clara dos galpões (nervuras a cada 1 m; textura cobre 8 m) */
const metalTex = () =>
  canvasTex(128, (g, S) => {
    g.fillStyle = '#dfe2e5';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = 'rgba(120,128,138,0.35)';
      g.fillRect((i * S) / 8, 0, 3, S);
    }
    g.fillStyle = 'rgba(80,90,100,0.18)';
    g.fillRect(0, S * 0.92, S, S * 0.08);
  });

/** prédio administrativo: faixas de janelas (andar de 4 m; textura cobre 8 m) */
const officeTex = () =>
  canvasTex(128, (g, S) => {
    g.fillStyle = '#eceae4';
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#4a5a6a';
    for (let f = 0; f < 2; f++) for (let w = 0; w < 4; w++) g.fillRect(w * (S / 4) + 4, f * (S / 2) + 14, S / 4 - 8, S / 2 - 30);
  });

// ------------------------------------------------------------------ geometria auxiliar
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: V2) => Math.hypot(a[0], a[1]);
const nrm = (a: V2): V2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};

/** (leste, norte) → vetor da cena */
const W3 = (p: V2, y: number) => new THREE.Vector3(p[0], y, -p[1]);

/** laje vertical: polígono extrudado de y0 até y1 (UV em metros) */
function slab(poly: V2[], y0: number, y1: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, steps: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

/** talude: contornos em alturas decrescentes ligados por faixas; topo plano no primeiro */
function loft(levels: { ring: V2[]; y: number }[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const push = (p: V2, y: number) => {
    pos.push(p[0], y, -p[1]);
    uv.push((p[0] + p[1] * 0.3) / 12, (y * 1.6 + p[1] * 0.2) / 12);
  };
  for (let l = 0; l + 1 < levels.length; l++) {
    const A = levels[l];
    const B = levels[l + 1];
    const m = A.ring.length;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      push(A.ring[i], A.y);
      push(B.ring[i], B.y);
      push(A.ring[j], A.y);
      push(A.ring[j], A.y);
      push(B.ring[i], B.y);
      push(B.ring[j], B.y);
    }
  }
  // topo
  const top = levels[0];
  const tri = THREE.ShapeUtils.triangulateShape(
    top.ring.map((p) => new THREE.Vector2(p[0], p[1])),
    [],
  );
  for (const [a, b, c] of tri) for (const k of [a, b, c]) push(top.ring[k], top.y);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** caixa com UV em metros (textura de parede repetida pelo tamanho real) */
function box(L: number, H: number, W: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(L, H, W);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const dims: [number, number][] = [
    [W, H],
    [W, H],
    [L, W],
    [L, W],
    [L, H],
    [L, H],
  ];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) uv.setXY(f * 4 + k, uv.getX(f * 4 + k) * dims[f][0], uv.getY(f * 4 + k) * dims[f][1]);
  return g;
}

/** posiciona uma geometria: centro (leste, norte), base em y, eixo maior no rumo (graus) */
function place(g: THREE.BufferGeometry, c: V2, y: number, bearingDeg: number): THREE.BufferGeometry {
  g.rotateY(Math.PI / 2 - (bearingDeg * Math.PI) / 180);
  g.translate(c[0], y, -c[1]);
  return g;
}

/** acumulador de peças por material */
class Bins {
  private m = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, g: THREE.BufferGeometry): void {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') ng.deleteAttribute(k);
    if (!ng.getAttribute('normal')) ng.computeVertexNormals();
    if (!ng.getAttribute('uv')) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((ng.getAttribute('position').count * 2) | 0), 2));
    ng.clearGroups();
    (this.m.get(mat) ?? this.m.set(mat, []).get(mat)!).push(ng);
  }
  build(parent: THREE.Object3D): void {
    for (const [mat, list] of this.m) {
      const g = mergeGeometries(list, false);
      if (!g) continue;
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      parent.add(mesh);
    }
  }
}

// ------------------------------------------------------------------ modelo
export class ShipyardModel {
  readonly group = new THREE.Group();
  private detailGroup = new THREE.Group();
  private mats: THREE.Material[] = [];
  private texs: THREE.Texture[] = [];
  /** ponto do rótulo (local) */
  private labelAt = new THREE.Vector3();

  constructor(readonly detail: Detail) {
    this.group.name = 'estaleiro';
    this.group.add(this.detailGroup);
    this.build();
  }

  private mat(p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, ...p });
    this.mats.push(m);
    return m;
  }

  private tex(t: THREE.Texture | null, rep: number): THREE.Texture | null {
    if (!t) return null;
    t.repeat.set(rep, rep);
    this.texs.push(t);
    return t;
  }

  private build(): void {
    const L = shipyardLocal();
    const hi = this.detail !== 'baixa';
    const concreteTop = this.mat({ color: 0xffffff, map: this.tex(concreteTex(), 1 / 32) });
    const wall = this.mat({ color: 0x8f8d86, roughness: 0.95 });
    const rock = this.mat({ color: 0xffffff, map: this.tex(rockTex(), 1), roughness: 1, side: THREE.DoubleSide });
    const metal = this.mat({ color: 0xffffff, map: this.tex(metalTex(), 1 / 8), metalness: 0.15, roughness: 0.6 });
    const office = this.mat({ color: 0xffffff, map: this.tex(officeTex(), 1 / 8) });
    const roof = this.mat({ color: 0xaeb5bc, metalness: 0.2, roughness: 0.55 });
    const door = this.mat({ color: 0x39414b, roughness: 0.6, metalness: 0.3 });
    const winch = this.mat({ color: 0x2fb5aa, roughness: 0.5 });
    const steel = this.mat({ color: 0x5a5e63, roughness: 0.6, metalness: 0.5 });
    const liftDeck = this.mat({ color: 0x6f757c, roughness: 0.7, metalness: 0.4 });
    const hull = this.mat({ color: 0x1b1e21, roughness: 0.75, metalness: 0.1 });
    const white = this.mat({ color: 0xeeeeea, roughness: 0.5 });
    const craneMat = this.mat({ color: 0xe8b21e, roughness: 0.5, metalness: 0.3 });
    const rust = this.mat({ color: 0x8a6f5a, roughness: 0.8, metalness: 0.3 });
    const lamp = new THREE.MeshBasicMaterial({ color: 0xfff1c4 });
    this.mats.push(lamp);
    const B = new Bins();
    const D = new Bins(); // detalhes (somem de longe)

    // aterro: topo de concreto e paredes até abaixo do fundo dragado
    const plat = slab(L.platform, -30, QUAY_TOP);
    const platTop = plat.clone();
    // separa topo (grupo 0 da extrusão) e lados (grupo 1)
    const split = (g: THREE.BufferGeometry, group: number) => {
      const ng = g.index ? g.toNonIndexed() : g;
      const grp = g.groups[group];
      const out = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv']) {
        const a = ng.getAttribute(k) as THREE.BufferAttribute;
        out.setAttribute(k, new THREE.BufferAttribute((a.array as Float32Array).slice(grp.start * a.itemSize, (grp.start + grp.count) * a.itemSize), a.itemSize));
      }
      return out;
    };
    B.add(concreteTop, split(platTop, 0));
    B.add(wall, split(plat, 1));

    // molhes: cais (paredes verticais) e enrocamento (taludes 1:1,5, crista a +5 m)
    for (const m of L.moles) {
      if (m.kind === 'cais') {
        const g = slab(m.ring, -30, QUAY_TOP);
        B.add(concreteTop, split(g, 0));
        B.add(wall, split(g, 1));
      } else {
        const r1 = m.width / 2;
        const r0 = Math.max(1.5, r1 - MOUND_CREST * MOUND_SLOPE);
        const levels = [
          { ring: bufferOutline(m.pts, r0), y: MOUND_CREST },
          { ring: m.ring, y: 0 },
          { ring: bufferOutline(m.pts, r1 + 3 * MOUND_SLOPE), y: -3 },
        ];
        B.add(rock, loft(levels));
        // pista de concreto sobre a crista
        if (r0 > 3) {
          const road = slab(bufferOutline(m.pts, Math.min(3, r0 - 0.5)), MOUND_CREST - 0.5, MOUND_CREST + 0.25);
          B.add(concreteTop, split(road, 0));
        }
      }
    }

    // shiplift: dois píeres com 17 guinchos cada e a plataforma de içamento entre eles
    {
      const s = L.shiplift;
      const ax = sub(s.tip, s.root);
      const Ls = len(ax);
      const u = nrm(ax);
      const v: V2 = [-u[1], u[0]];
      const brg = (Math.atan2(u[0], u[1]) * 180) / Math.PI;
      const mid: V2 = [(s.root[0] + s.tip[0]) / 2, (s.root[1] + s.tip[1]) / 2];
      const pierW = (s.width - 20) / 2;
      for (const side of [-1, 1]) {
        const c: V2 = [mid[0] + v[0] * side * (10 + pierW / 2), mid[1] + v[1] * side * (10 + pierW / 2)];
        const g = place(box(Ls, QUAY_TOP + 30, pierW), c, -30 + (QUAY_TOP + 30) / 2, brg);
        B.add(concreteTop, g);
        if (hi)
          for (let k = 0; k < 17; k++) {
            const t = -Ls / 2 + 6 + (k * (Ls - 12)) / 16;
            const wc: V2 = [c[0] + u[0] * t + v[0] * side * (pierW / 2 - 3.2), c[1] + u[1] * t + v[1] * side * (pierW / 2 - 3.2)];
            D.add(winch, place(box(4.2, 3.2, 4.6), wc, QUAY_TOP + 1.6, brg));
          }
      }
      // plataforma (110 × 20 m) içada ao nível do cais, com berço e um submarino
      const deck = place(box(Math.min(110, Ls - 4), 1.2, 19.6), mid, QUAY_TOP - 0.6, brg);
      B.add(liftDeck, deck);
      const subL = 71.6;
      const R = 3.1;
      const yC = QUAY_TOP + 1.2 + R;
      for (const t of [-22, -8, 8, 22]) B.add(steel, place(box(2, 1.6, 5), [mid[0] + u[0] * t, mid[1] + u[1] * t], QUAY_TOP + 0.8, brg));
      // casco (cápsula ao longo do eixo do shiplift, proa para a bacia)
      const body = new THREE.CapsuleGeometry(R, subL - 2 * R, 8, 20);
      body.rotateZ(Math.PI / 2);
      B.add(hull, place(body, mid, yC, brg));
      const sail = place(box(9, 6, 2.4), [mid[0] + u[0] * 14, mid[1] + u[1] * 14], yC + R + 2.6, brg);
      B.add(hull, sail);
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        const fin = new THREE.BoxGeometry(5, 0.4, 9);
        fin.rotateX(a);
        B.add(hull, place(fin, [mid[0] - u[0] * (subL / 2 - 4), mid[1] - u[1] * (subL / 2 - 4)], yC, brg));
      }
      // trilhos de transferência para os galpões
      for (const off of [-6, 0, 6]) {
        const c: V2 = [s.root[0] - u[0] * 70 + v[0] * off, s.root[1] - u[1] * 70 + v[1] * off];
        D.add(steel, place(box(140, 0.25, 0.6), c, QUAY_TOP + 0.12, brg));
      }
    }

    // galpões e prédios
    for (const b of L.buildings) {
      const isOffice = b.id.startsWith('admin') || b.id.startsWith('apoio') || b.id === 'portaria';
      const tent = b.id === 'tenda';
      if (tent) {
        const t = new THREE.CylinderGeometry(b.width / 2, b.width / 2, b.length, 16, 1, false, 0, Math.PI);
        t.rotateZ(Math.PI / 2);
        t.rotateY(Math.PI / 2);
        t.scale(1, b.height / (b.width / 2), 1);
        B.add(white, place(t, b.c, QUAY_TOP, b.bearing + 90));
        continue;
      }
      B.add(isOffice ? office : metal, place(box(b.length, b.height, b.width), b.c, QUAY_TOP + b.height / 2, b.bearing));
      B.add(roof, place(box(b.length + 1.2, 1.2, b.width + 1.2), b.c, QUAY_TOP + b.height + 0.4, b.bearing));
      if (!isOffice) {
        // portão grande na face sudoeste (lado da bacia)
        const rad = (b.bearing * Math.PI) / 180;
        const c: V2 = [b.c[0] - Math.sin(rad) * (b.length / 2 + 0.2), b.c[1] - Math.cos(rad) * (b.length / 2 + 0.2)];
        B.add(door, place(box(0.4, b.height * 0.78, b.width * 0.62), c, QUAY_TOP + (b.height * 0.78) / 2, b.bearing));
      }
      if (b.id === 'principal') this.labelAt.copy(W3(b.c, QUAY_TOP + b.height + 14));
    }

    // tanques de combustível
    for (const t of L.tanks) {
      B.add(white, place(new THREE.CylinderGeometry(6, 6, 11, 24), t, QUAY_TOP + 5.5, 0));
      D.add(steel, place(new THREE.CylinderGeometry(6.1, 6.1, 0.6, 24), t, QUAY_TOP + 11, 0));
    }

    if (hi) {
      // postes de iluminação ao longo do cais interno
      const cais = L.moles.find((m) => m.kind === 'cais');
      if (cais)
        for (let i = 0; i + 1 < cais.pts.length; i++) {
          const a = cais.pts[i];
          const b = cais.pts[i + 1];
          const n = Math.max(1, Math.floor(len(sub(b, a)) / 45));
          for (let k = 0; k < n; k++) {
            const f = (k + 0.5) / n;
            const p: V2 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
            D.add(steel, place(new THREE.CylinderGeometry(0.18, 0.25, 14, 6), p, QUAY_TOP + 7, 0));
            D.add(lamp, place(box(1.8, 0.4, 0.8), p, QUAY_TOP + 14, 0));
          }
        }
      // guindastes portuários móveis (amarelos) junto ao cais interno e à raiz do shiplift
      const cranes: { p: V2; brg: number }[] = [];
      if (cais) cranes.push({ p: cais.pts[Math.floor(cais.pts.length / 2)], brg: 180 });
      cranes.push({ p: [L.shiplift.root[0] + 30, L.shiplift.root[1] + 25], brg: 250 });
      for (const c of cranes) {
        D.add(craneMat, place(box(10, 4, 10), c.p, QUAY_TOP + 2, c.brg));
        D.add(craneMat, place(box(3, 26, 3), c.p, QUAY_TOP + 17, c.brg));
        const boom = box(40, 1.6, 1.6);
        boom.translate(20, 0, 0);
        boom.rotateZ(0.45);
        D.add(craneMat, place(boom, c.p, QUAY_TOP + 27, c.brg));
      }
    }

    // Porto Sudeste (vizinho a oeste): ponte de acesso e píer de minério sobre estacas
    {
      const seg = (a: V2, b: V2, w: number, top: number, mat: THREE.Material, piles: boolean) => {
        const d = sub(b, a);
        const l = len(d);
        const brg = (Math.atan2(d[0], d[1]) * 180) / Math.PI;
        const c: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        B.add(mat, place(box(l, 1.6, w), c, top - 0.8, brg));
        if (piles && hi)
          for (let t = 0; t <= l; t += 28) {
            const p: V2 = [a[0] + (d[0] * t) / l, a[1] + (d[1] * t) / l];
            D.add(steel, place(new THREE.CylinderGeometry(0.6, 0.6, top + 18, 6), p, (top - 18) / 2 - 0.8, 0));
          }
      };
      const tr = L.sudeste.trestle;
      const pr = L.sudeste.pier;
      seg(tr[0], tr[1], 9, 12, rust, true);
      seg(pr[0], pr[1], 24, 9, concreteTop, true);
      // galeria do transportador sobre a ponte e carregador de navios
      seg(tr[0], tr[1], 4, 15.5, rust, false);
      const mid: V2 = [(pr[0][0] + pr[1][0]) / 2, (pr[0][1] + pr[1][1]) / 2];
      const d = nrm(sub(pr[1], pr[0]));
      const brg = (Math.atan2(d[0], d[1]) * 180) / Math.PI;
      B.add(rust, place(box(14, 18, 14), mid, 9 + 9, brg));
      const arm = box(48, 3, 3);
      arm.translate(-20, 0, 0);
      B.add(rust, place(arm, mid, 9 + 20, brg + 90));
    }

    B.build(this.group);
    D.build(this.detailGroup);
  }

  /**
   * Posiciona o modelo na origem flutuante (pn, pe = posição do submarino) e
   * esconde os detalhes de longe. Devolve a distância horizontal (m) da câmera.
   */
  place(origin: LatLon, pn: number, pe: number, cam: THREE.Vector3): number {
    const a = latLonToNed(origin, shipyardLocal().anchor);
    this.group.position.set(a.e - pe, 0, -(a.n - pn));
    const dist = Math.hypot(cam.x - this.group.position.x, cam.z - this.group.position.z);
    this.group.visible = dist < 16000;
    this.detailGroup.visible = dist < 3500;
    return dist;
  }

  label(labels: Label3D[], proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean }, dist: number): void {
    if (!this.group.visible || dist > 9000) return;
    const p = this.labelAt.clone().add(this.group.position);
    labels.push({ id: 'estaleiro', text: 'Estaleiro e Base Naval — Itaguaí', sub: `${(dist / 1852).toFixed(1)} mn`, color: '#ffd166', small: true, prio: 2, ...proj(p) });
  }

  dispose(): void {
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
    for (const m of this.mats) m.dispose();
    for (const t of this.texs) t.dispose();
  }
}
