/**
 * VETORES DE FORÇA sobre o submarino: peso (em G), empuxo (em B), resultante
 * vertical E − P (com ampliação visual declarada) e, opcionalmente, empuxo do
 * hélice, resistência da água e forças dos lemes. Valores e pontos de
 * aplicação vêm das saídas do último passo do motor (forceVectors.ts).
 */
import * as THREE from 'three';
import type { SimulationEngine } from '../sim/core/engine';
import { autoGain, hydroArrows, toTf, verticalBalance } from '../sim/forceVectors';
import { FORCE_STYLE, type SceneLayers } from './layers';
import type { Label3D } from './SubmarineScene';

const UP = new THREE.Vector3(0, 1, 0);

export class Arrow3D {
  readonly group = new THREE.Group();
  private shaft: THREE.Mesh;
  private head: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  constructor(color: number, private radius = 0.32) {
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    const sg = new THREE.CylinderGeometry(1, 1, 1, 14);
    sg.translate(0, 0.5, 0);
    const hg = new THREE.ConeGeometry(1, 1, 18);
    hg.translate(0, 0.5, 0);
    this.shaft = new THREE.Mesh(sg, this.mat);
    this.head = new THREE.Mesh(hg, this.mat);
    this.shaft.renderOrder = 20;
    this.head.renderOrder = 20;
    this.group.add(this.shaft, this.head);
    this.group.visible = false;
  }
  /** origem e direção no mundo (cena), comprimento em m */
  set(origin: THREE.Vector3, dir: THREE.Vector3, len: number, dashed = false): void {
    if (!(len > 0.05) || dir.lengthSq() < 1e-12) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const r = this.radius;
    const headLen = Math.min(len * 0.45, Math.max(1.1, r * 4.5));
    const shaftLen = Math.max(0, len - headLen);
    this.shaft.scale.set(r, Math.max(1e-3, shaftLen), r);
    this.shaft.visible = shaftLen > 0.01;
    this.head.position.y = shaftLen;
    this.head.scale.set(r * 2.6, headLen, r * 2.6);
    this.group.position.copy(origin);
    this.group.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
    this.mat.opacity = dashed ? 0.55 : 0.95;
  }
  tip(): THREE.Vector3 {
    const len = this.head.position.y + this.head.scale.y;
    return new THREE.Vector3(0, len, 0).applyQuaternion(this.group.quaternion).add(this.group.position);
  }
  get visible(): boolean {
    return this.group.visible;
  }
}

function pointMarker(color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95, toneMapped: false, fog: false }));
  m.renderOrder = 21;
  return m;
}

const fmtTf = (N: number, g: number) => {
  const t = toTf(N, g);
  const a = Math.abs(t);
  return `${t < 0 ? '−' : ''}${a >= 100 ? a.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : a.toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} tf`;
};
const fmtKn = (N: number) => `${(N / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} kN`;

export interface ForceScaleInfo {
  metersPerTf: number;
  gain: number;
  hydroMetersPerKn: number;
}

export class ForceArrows {
  readonly group = new THREE.Group();
  private weight = new Arrow3D(FORCE_STYLE.weight.color);
  private buoy = new Arrow3D(FORCE_STYLE.buoyancy.color);
  private net = new Arrow3D(FORCE_STYLE.net.color, 0.38);
  private gMark = pointMarker(FORCE_STYLE.weight.color);
  private bMark = pointMarker(FORCE_STYLE.buoyancy.color);
  private hydro: Record<string, Arrow3D> = {};
  /** escala fixa: o peso de referência (condição inicial) vale 14 m */
  private metersPerN: number;
  readonly hydroMetersPerN = 3e-4; // 30 m por 100 kN
  info: ForceScaleInfo = { metersPerTf: 0, gain: 1, hydroMetersPerKn: 0.3 };

  constructor(e: SimulationEngine) {
    const w = Math.max(1, e.outputs.forces.weightForce);
    this.metersPerN = 14 / w;
    this.info.metersPerTf = this.metersPerN * e.env.cfg.gravity * 1000;
    this.group.add(this.weight.group, this.buoy.group, this.net.group, this.gMark, this.bMark);
    for (const id of ['prop', 'drag', 'bow', 'stern', 'rudder']) {
      const a = new Arrow3D(id === 'prop' ? 0x7dffb0 : id === 'drag' ? 0xff9a5c : FORCE_STYLE.hydro.color, 0.22);
      this.hydro[id] = a;
      this.group.add(a.group);
    }
  }

  update(e: SimulationEngine, sub: THREE.Object3D, cam: THREE.Camera, layers: SceneLayers, labels: Label3D[], proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean }): void {
    const showV = layers.vectors;
    const showH = layers.hydroVectors;
    this.group.visible = showV || showH;
    const b2w = (p: { x: number; y: number; z: number }) => sub.localToWorld(new THREE.Vector3(p.y, -p.z, -p.x));
    const vb = verticalBalance(e);
    const g = vb.g;
    const down = new THREE.Vector3(0, -1, 0);
    const up = new THREE.Vector3(0, 1, 0);
    this.gMark.visible = showV;
    this.bMark.visible = showV;
    if (!showV) {
      this.weight.set(new THREE.Vector3(), up, 0);
      this.buoy.set(new THREE.Vector3(), up, 0);
      this.net.set(new THREE.Vector3(), up, 0);
    } else {
      const G = b2w(vb.cg);
      const B = b2w(vb.cb);
      this.gMark.position.copy(G);
      this.bMark.position.copy(B);
      this.weight.set(G, down, vb.weightN * this.metersPerN);
      this.buoy.set(B, up, vb.buoyancyN * this.metersPerN);
      const gain = layers.resultantGain === 'auto' ? autoGain(vb.netN, this.metersPerN, 8) : layers.resultantGain;
      this.info.gain = gain;
      // resultante desenhada ao lado (deslocada no plano da tela), paralela a P e E
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
      const mid = G.clone().lerp(B, 0.5).add(right.multiplyScalar(8));
      const netLen = Math.abs(vb.netN) * this.metersPerN * gain;
      this.net.set(mid, vb.netN >= 0 ? up : down, Math.min(40, netLen));
      if (layers.labels) {
        const lw = proj(this.weight.tip());
        labels.push({ id: 'fP', text: `Peso P = ${fmtTf(vb.weightN, g)}`, sub: `m = ${(vb.massKg / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t · em G`, color: FORCE_STYLE.weight.css, prio: 0, ...lw });
        const lb = proj(this.buoy.tip());
        labels.push({
          id: 'fE',
          text: `Empuxo E = ${fmtTf(vb.buoyancyN, g)}`,
          sub: `V = ${vb.displacedM3.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m³ · ${(vb.immersedFraction * 100).toFixed(1)} % imerso · em B`,
          color: FORCE_STYLE.buoyancy.css,
          prio: 0,
          ...lb,
        });
        const eq = Math.abs(toTf(vb.netN, g)) < 0.05;
        const ln = proj(this.net.visible ? this.net.tip().add(new THREE.Vector3(0, vb.netN >= 0 ? 2 : -2, 0)) : mid);
        labels.push({
          id: 'fR',
          text: eq ? 'Resultante E − P ≈ 0 (equilíbrio)' : `Resultante E − P = ${fmtTf(vb.netN, g)} ${vb.netN > 0 ? '↑' : '↓'}`,
          sub: eq ? 'P e E se anulam' : gain > 1 ? `vetor ampliado ×${gain.toLocaleString('pt-BR')}` : 'escala 1:1 com P e E',
          prio: 0,
          color: FORCE_STYLE.net.css,
          ...ln,
        });
        labels.push({ id: 'fG', text: 'G', color: FORCE_STYLE.weight.css, small: true, prio: 1, ...proj(G) });
        labels.push({ id: 'fB', text: 'B', color: FORCE_STYLE.buoyancy.css, small: true, prio: 1, ...proj(B) });
      }
    }
    const ha = showH ? hydroArrows(e) : [];
    const seen = new Set<string>();
    for (const h of ha) {
      const a = this.hydro[h.id];
      if (!a) continue;
      seen.add(h.id);
      const len = Math.min(30, h.magnitudeN * this.hydroMetersPerN);
      // NED → cena: (e, −d, −n)
      const dir = new THREE.Vector3(h.forceNED.y, -h.forceNED.z, -h.forceNED.x);
      const o = b2w(h.origin);
      if (h.id === 'drag') o.add(dir.clone().normalize().multiplyScalar(-Math.min(len, 30)));
      a.set(o, dir, len < 0.4 ? 0 : len);
      if (layers.labels && a.visible) labels.push({ id: 'h' + h.id, text: `${h.label}: ${fmtKn(h.magnitudeN)}`, color: h.id === 'prop' ? '#7dffb0' : h.id === 'drag' ? '#ff9a5c' : FORCE_STYLE.hydro.css, small: true, prio: 1, ...proj(h.id === 'drag' ? o : a.tip()) });
    }
    for (const id in this.hydro) if (!seen.has(id)) this.hydro[id].set(new THREE.Vector3(), up, 0);
  }
}
