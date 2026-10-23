/**
 * CARGAS DESLOCÁVEIS A BORDO (torpedos, tripulantes, mantimentos): desenho
 * de cada carga na posição simulada, contorno na posição de estiva e, com os
 * vetores de trim, o binário do deslocamento (+P na posição atual, −P na
 * estiva). Aparece no corte do casco (tanques) ou com os vetores de trim.
 * As peças têm cores reais (torpedos, tripulantes, caixas); o rosa identifica
 * o contorno da carga, a posição de estiva, o caminho e os rótulos.
 * Valores de sim/forceVectors.ts → trimBalance (só leitura).
 */
import * as THREE from 'three';
import type { SimulationEngine } from '../sim/core/engine';
import { trimBalance } from '../sim/forceVectors';
import { Arrow3D } from './ForceArrows';
import type { SceneLayers } from './layers';
import type { Label3D } from './SubmarineScene';

const b2l = (x: number, y: number, z: number) => new THREE.Vector3(y, -z, -x);
/** cor das cargas deslocadas (mesma família do peso deslocável) */
export const CARGO_COLOR = 0xff5ec4;
export const CARGO_CSS = '#ff7ad1';
const M_PER_T = 1.3;
const fmtT = (kg: number) => `${(kg / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 1 })} t`;
const fmtX = (x: number) => x.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

interface LoadMesh {
  id: string;
  group: THREE.Group;
  /** contorno rosa em volta da carga (identificação através dos tanques) */
  frame: THREE.LineSegments;
  ghost: THREE.LineSegments;
  path: THREE.Line;
  plus: Arrow3D;
  minus: Arrow3D;
  /** pernas e braços dos tripulantes (balançam enquanto andam) */
  limbs: { obj: THREE.Object3D; sign: number; amp: number }[];
  /** altura do desenho (m), para posicionar rótulos */
  top: number;
}

const std = (color: number, p: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...p });

/** perfil de revolução do torpedo (raio × posição ao longo do eixo, da ponta para a cauda) */
function torpedoProfile(L: number, r: number): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const nose = 0.9;
  const tail = 1.3;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    // ogiva: raio cresce como um quarto de elipse
    pts.push(new THREE.Vector2(r * Math.sqrt(1 - (1 - t) * (1 - t)) + 1e-3, -L / 2 + nose * t));
  }
  pts.push(new THREE.Vector2(r, L / 2 - tail));
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    // cauda: afina até ~40 % do raio
    pts.push(new THREE.Vector2(r * (1 - 0.6 * t * t), L / 2 - tail + tail * t));
  }
  pts.push(new THREE.Vector2(1e-3, L / 2));
  return pts;
}

/** torpedo de 533 mm × 6,4 m (eixo em z local; a ponta aponta para −z = vante) */
function torpedo(): THREE.Group {
  const g = new THREE.Group();
  const L = 6.4;
  const r = 0.267;
  const body = std(0x3f4b45, { metalness: 0.55, roughness: 0.4 });
  const head = std(0xd98a1a, { metalness: 0.3, roughness: 0.45 });
  const dark = std(0x1d2226, { metalness: 0.6, roughness: 0.35 });
  const prof = new THREE.LatheGeometry(torpedoProfile(L, r), 24);
  prof.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(prof, body));
  // cabeça de exercício (laranja) e faixa amarela
  const capG = new THREE.LatheGeometry(torpedoProfile(L, r * 1.004).slice(0, 11), 24);
  capG.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(capG, head));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, 0.12, 24), std(0xffd23f));
  band.rotation.x = Math.PI / 2;
  band.position.z = -L / 2 + 1.5;
  g.add(band);
  // aletas cruzadas e hélices contrarrotativas
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.55), dark);
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    fin.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, L / 2 - 0.45);
    fin.rotation.z = a - Math.PI / 2;
    g.add(fin);
  }
  for (const [dz, rot] of [
    [0.05, 0],
    [0.16, Math.PI / 6],
  ] as const) {
    for (let k = 0; k < 3; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.17, 0.05), dark);
      const a = rot + (k * 2 * Math.PI) / 3;
      blade.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, L / 2 + dz);
      blade.rotation.z = a - Math.PI / 2;
      g.add(blade);
    }
  }
  return g;
}

/** tripulante de 1,75 m: pernas, tronco, braços, cabeça e boné (de frente para vante) */
function crewman(limbs: LoadMesh['limbs'], k: number): THREE.Group {
  const g = new THREE.Group();
  const navy = std(0x1f3150);
  const shirt = std(k % 4 === 0 ? 0x8fa9c8 : 0x2f4f78);
  const skin = std(k % 3 === 0 ? 0x8d5a3b : k % 3 === 1 ? 0xc68e66 : 0xe0b48f);
  const boot = std(0x15181c);
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, -0.05, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.82, 8), navy);
    leg.position.y = -0.41;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.26), boot);
    foot.position.set(0, -0.84, -0.05);
    hip.add(leg, foot);
    g.add(hip);
    limbs.push({ obj: hip, sign: side, amp: 0.45 });
    const sh = new THREE.Group();
    sh.position.set(side * 0.26, 0.5, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.62, 8), shirt);
    arm.position.y = -0.31;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), skin);
    hand.position.y = -0.65;
    sh.add(arm, hand);
    g.add(sh);
    limbs.push({ obj: sh, sign: -side, amp: 0.35 });
  }
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.38, 4, 10), shirt);
  torso.scale.set(1, 1, 0.65);
  torso.position.y = 0.27;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8), skin);
  neck.position.y = 0.63;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), skin);
  head.position.y = 0.76;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.125, 0.07, 14), navy);
  cap.position.y = 0.86;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 0.1), navy);
  visor.position.set(0, 0.83, -0.13);
  g.add(torso, neck, head, cap, visor);
  return g;
}

/** desenho de uma carga (centrado na origem do grupo; x do corpo = −z local) */
function buildLoad(category: string, quantity: number, limbs: LoadMesh['limbs']): { g: THREE.Group; size: THREE.Vector3 } {
  const g = new THREE.Group();
  if (category === 'torpedos') {
    // torpedos lado a lado sobre um carrinho de transferência
    for (let i = 0; i < quantity; i++) {
      const t = torpedo();
      t.position.x = (i - (quantity - 1) / 2) * 0.64;
      g.add(t);
    }
    const steel = std(0x6b737c, { metalness: 0.5, roughness: 0.45 });
    for (const z of [-1.8, 1.4]) {
      const cradle = new THREE.Mesh(new THREE.BoxGeometry(quantity * 0.64 + 0.1, 0.12, 0.25), steel);
      cradle.position.set(0, -0.31, z);
      g.add(cradle);
    }
    return { g, size: new THREE.Vector3(quantity * 0.64 + 0.3, 0.8, 7) };
  }
  if (category === 'pessoas') {
    // tripulantes em duas colunas, andando para vante
    const cols = 2;
    const rows = Math.ceil(quantity / cols);
    for (let i = 0; i < quantity; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const p = crewman(limbs, i);
      p.position.set((c - (cols - 1) / 2) * 0.7 + ((r % 2) - 0.5) * 0.08, 0.02, (r - (rows - 1) / 2) * 0.62);
      g.add(p);
    }
    return { g, size: new THREE.Vector3(1.5, 1.85, rows * 0.62 + 0.4) };
  }
  // mantimentos/equipamentos: caixas de papelão e engradados sobre um palete
  const pallet = std(0xa77c4e, { roughness: 0.85 });
  const per = 6;
  const cols = Math.ceil(quantity / per);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.12, cols * 0.58 + 0.12), pallet);
  base.position.y = -0.46;
  g.add(base);
  const tape = std(0xd9c9a3, { roughness: 0.7 });
  for (let i = 0; i < quantity; i++) {
    const k = i % per;
    const y = (k % 3) - 1;
    const lev = Math.floor(k / 3);
    const c = Math.floor(i / per);
    const crate = i % 4 === 3;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.4, 0.52), std(crate ? 0x8a6a3c : [0xb98d5a, 0xc49a66, 0xad8350][i % 3], { roughness: 0.9 }));
    box.position.set(y * 0.56, -0.2 + lev * 0.42, (c - (cols - 1) / 2) * 0.58);
    g.add(box);
    // fita (caixa) ou ripas (engradado)
    const strip = new THREE.Mesh(new THREE.BoxGeometry(crate ? 0.54 : 0.1, 0.012, 0.54), crate ? std(0x5d4626) : tape);
    strip.position.set(box.position.x, box.position.y + 0.206, box.position.z);
    g.add(strip);
  }
  return { g, size: new THREE.Vector3(1.85, 1.05, cols * 0.58 + 0.2) };
}

export class CargoVis {
  /** filhos do grupo do submarino */
  readonly local = new THREE.Group();
  /** setas no mundo (verticais) */
  readonly world = new THREE.Group();
  private loads: LoadMesh[] = [];

  constructor(e: SimulationEngine) {
    const frameMat = new THREE.LineBasicMaterial({ color: CARGO_COLOR, transparent: true, opacity: 0.7, depthTest: false, toneMapped: false });
    const ghostMat = new THREE.LineBasicMaterial({ color: CARGO_COLOR, transparent: true, opacity: 0.55, depthTest: false, toneMapped: false });
    const pathMat = new THREE.LineDashedMaterial({ color: 0xff9be0, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.85, depthTest: false, toneMapped: false });
    for (const l of e.vessel.mass.shiftLoads ?? []) {
      const limbs: LoadMesh['limbs'] = [];
      const { g, size } = buildLoad(l.category, l.quantity, limbs);
      // peças com cores reais e profundidade normal; o rosa fica no contorno, no caminho e nos rótulos
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)), frameMat);
      frame.renderOrder = 9;
      g.add(frame);
      const ghost = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)), ghostMat);
      ghost.renderOrder = 9;
      ghost.position.copy(b2l(l.home.x, l.home.y, l.home.z));
      const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), pathMat);
      path.renderOrder = 9;
      const plus = new Arrow3D(CARGO_COLOR, 0.22);
      const minus = new Arrow3D(CARGO_COLOR, 0.22);
      this.local.add(g, ghost, path);
      this.world.add(plus.group, minus.group);
      this.loads.push({ id: l.id, group: g, frame, ghost, path, plus, minus, limbs, top: size.y / 2 });
    }
    this.local.visible = false;
    this.world.visible = false;
  }

  update(e: SimulationEngine, sub: THREE.Object3D, layers: SceneLayers, labels: Label3D[], proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean }): void {
    const vec = layers.trimVectors;
    this.local.visible = vec || layers.tanks;
    this.world.visible = vec;
    if (!this.local.visible) return;
    const tb = trimBalance(e);
    const up = new THREE.Vector3(0, 1, 0);
    const down = new THREE.Vector3(0, -1, 0);
    for (const m of this.loads) {
      const l = tb.loads.find((x) => x.id === m.id);
      if (!l) continue;
      m.group.position.copy(b2l(l.x, l.y, l.z));
      const shifted = Math.abs(l.x - l.xHome) > 0.3;
      const moving = Math.abs(l.xCmd - l.x) > 0.05;
      // tripulantes andando: pernas e braços balançam (fase pelo tempo de simulação)
      const ph = moving ? Math.sin(e.state.t * 5.5) : 0;
      for (const lb of m.limbs) lb.obj.rotation.x = ph * lb.sign * lb.amp;
      m.ghost.visible = shifted;
      m.path.visible = shifted;
      if (shifted) {
        const pos = m.path.geometry.getAttribute('position') as THREE.BufferAttribute;
        const a = b2l(l.xHome, l.y, l.z - m.top - 0.35);
        const b = b2l(l.x, l.y, l.z - m.top - 0.35);
        pos.setXYZ(0, a.x, a.y, a.z);
        pos.setXYZ(1, b.x, b.y, b.z);
        pos.needsUpdate = true;
        m.path.geometry.computeBoundingSphere();
        m.path.computeLineDistances();
      }
      // binário: +P na posição atual, −P (tracejado, para cima) na estiva
      if (vec) {
        const L = (l.mass / 1000) * M_PER_T;
        const p0 = sub.localToWorld(b2l(l.x, l.y, l.z - m.top - 0.2));
        m.plus.set(p0, down, shifted ? L : 0);
        const p1 = sub.localToWorld(b2l(l.xHome, l.y, l.z - m.top - 0.2));
        m.minus.set(p1.clone().add(new THREE.Vector3(0, -L, 0)), up, shifted ? L : 0, true);
      } else {
        m.plus.set(new THREE.Vector3(), up, 0);
        m.minus.set(new THREE.Vector3(), up, 0);
      }
      if (!layers.labels) continue;
      const anchor = sub.localToWorld(b2l(l.x, l.y, l.z - m.top - 0.6));
      const qty = `${l.quantity} × ${fmtT(l.mass / l.quantity).replace(' t', '')} t`;
      labels.push({
        id: 'cg_' + l.id,
        callout: !vec,
        text: `${l.name}: ${fmtT(l.mass)}`,
        sub: shifted || moving ? `${qty} · x ${fmtX(l.xHome)} → ${fmtX(moving ? l.xCmd : l.x)} m${moving ? ' · em movimento' : ''}` : `${qty} · na estiva (x ${fmtX(l.xHome)} m)`,
        color: CARGO_CSS,
        small: !shifted && !moving,
        prio: shifted || moving ? 1 : 2,
        ...proj(anchor),
      });
    }
  }
}
