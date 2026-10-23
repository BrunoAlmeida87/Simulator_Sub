/**
 * CARGAS DESLOCÁVEIS A BORDO (torpedos, tripulantes, mantimentos): desenho
 * de cada carga na posição simulada, contorno na posição de estiva e, com os
 * vetores de trim, o binário do deslocamento (+P na posição atual, −P na
 * estiva). Aparece no corte do casco (tanques) ou com os vetores de trim.
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
  ghost: THREE.LineSegments;
  path: THREE.Line;
  plus: Arrow3D;
  minus: Arrow3D;
  /** altura do desenho (m), para posicionar rótulos */
  top: number;
}

/** desenho de uma carga (centrado na origem do grupo; x do corpo = −z local) */
function buildLoad(category: string, quantity: number, mat: THREE.Material): { g: THREE.Group; size: THREE.Vector3 } {
  const g = new THREE.Group();
  if (category === 'torpedos') {
    // torpedos de 533 mm × 6,4 m lado a lado
    const geo = new THREE.CylinderGeometry(0.27, 0.27, 6.4, 18);
    geo.rotateX(Math.PI / 2);
    const nose = new THREE.SphereGeometry(0.27, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    nose.rotateX(-Math.PI / 2);
    nose.translate(0, 0, -3.2);
    for (let i = 0; i < quantity; i++) {
      const y = (i - (quantity - 1) / 2) * 0.62;
      const t = new THREE.Mesh(geo, mat);
      const n = new THREE.Mesh(nose, mat);
      t.position.x = y;
      n.position.x = y;
      g.add(t, n);
    }
    return { g, size: new THREE.Vector3(quantity * 0.62 + 0.2, 0.7, 7) };
  }
  if (category === 'pessoas') {
    // tripulantes: corpo e cabeça, em duas colunas
    const body = new THREE.CapsuleGeometry(0.19, 0.85, 4, 10);
    const head = new THREE.SphereGeometry(0.14, 12, 8);
    const cols = 2;
    const rows = Math.ceil(quantity / cols);
    for (let i = 0; i < quantity; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = (c - (cols - 1) / 2) * 0.7;
      const z = (r - (rows - 1) / 2) * 0.62;
      const b = new THREE.Mesh(body, mat);
      b.position.set(x, -0.1, z);
      const h = new THREE.Mesh(head, mat);
      h.position.set(x, 0.62, z);
      g.add(b, h);
    }
    return { g, size: new THREE.Vector3(1.4, 1.75, rows * 0.62 + 0.3) };
  }
  // mantimentos/equipamentos: caixas empilhadas (3 de largura × 2 de altura)
  const box = new THREE.BoxGeometry(0.5, 0.42, 0.5);
  const per = 6;
  const cols = Math.ceil(quantity / per);
  for (let i = 0; i < quantity; i++) {
    const k = i % per;
    const y = (k % 3) - 1;
    const lev = Math.floor(k / 3);
    const c = Math.floor(i / per);
    const m = new THREE.Mesh(box, mat);
    m.position.set(y * 0.55, -0.22 + lev * 0.46, (c - (cols - 1) / 2) * 0.58);
    g.add(m);
  }
  return { g, size: new THREE.Vector3(1.7, 0.95, cols * 0.58 + 0.1) };
}

export class CargoVis {
  /** filhos do grupo do submarino */
  readonly local = new THREE.Group();
  /** setas no mundo (verticais) */
  readonly world = new THREE.Group();
  private loads: LoadMesh[] = [];

  constructor(e: SimulationEngine) {
    const mat = new THREE.MeshStandardMaterial({ color: CARGO_COLOR, emissive: CARGO_COLOR, emissiveIntensity: 0.45, roughness: 0.45, transparent: true, depthTest: false, depthWrite: false });
    const ghostMat = new THREE.LineBasicMaterial({ color: CARGO_COLOR, transparent: true, opacity: 0.55, depthTest: false, toneMapped: false });
    const pathMat = new THREE.LineDashedMaterial({ color: 0xff9be0, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.85, depthTest: false, toneMapped: false });
    for (const l of e.vessel.mass.shiftLoads ?? []) {
      const { g, size } = buildLoad(l.category, l.quantity, mat);
      g.traverse((o) => (o.renderOrder = 9));
      const ghost = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)), ghostMat);
      ghost.renderOrder = 9;
      ghost.position.copy(b2l(l.home.x, l.home.y, l.home.z));
      const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), pathMat);
      path.renderOrder = 9;
      const plus = new Arrow3D(CARGO_COLOR, 0.22);
      const minus = new Arrow3D(CARGO_COLOR, 0.22);
      this.local.add(g, ghost, path);
      this.world.add(plus.group, minus.group);
      this.loads.push({ id: l.id, group: g, ghost, path, plus, minus, top: size.y / 2 });
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
