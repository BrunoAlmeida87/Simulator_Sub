/**
 * ÂNGULO DE PITCH (camada própria): transferidor no plano vertical do
 * submarino — linha horizontal de referência (0°, tracejada), eixo
 * longitudinal do casco, arco entre os dois com marcas a cada grau e o valor
 * de θ. As linhas são faixas com espessura (visíveis de longe, em projetor).
 * Usa o pitch calculado (outputs.euler.pitch); só leitura.
 */
import * as THREE from 'three';
import type { SimulationEngine } from '../sim/core/engine';
import type { Label3D } from './SubmarineScene';

const DEG = Math.PI / 180;
/** comprimento de cada lado das linhas (m, a partir do centro) */
const HALF = 48;
/** raio do arco (m, no lado da proa) */
const R = 40;
const C_AXIS = 0xffb347;
const C_AXIS_CSS = '#ffc266';
const C_LEVEL = 0x3ddc84;
const C_LEVEL_CSS = '#5fe39a';
/** pitch mostrado como nivelado (|θ| abaixo disto arredonda para 0,0°) */
export const LEVEL_TOL = 0.05;

/** descrição do pitch para os rótulos */
export function pitchText(pitch: number): { value: string; sense: string; level: boolean } {
  const level = Math.abs(pitch) < LEVEL_TOL;
  const v = level ? 0 : pitch;
  const value = `θ = ${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}°`;
  return { value, sense: level ? 'nivelado: proa e popa na mesma profundidade' : pitch < 0 ? 'proa abaixo da horizontal' : 'proa acima da horizontal', level };
}

const basic = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });

export class PitchAngle {
  readonly group = new THREE.Group();
  /** plano do transferidor: x = proa na horizontal, y = para cima */
  private frame = new THREE.Group();
  private axis: THREE.Mesh;
  private arc: THREE.Mesh | null = null;
  private ticks: THREE.Mesh | null = null;
  private fan: THREE.Mesh | null = null;
  private axisMat = basic(C_AXIS);
  private arcMat = basic(C_AXIS);
  private fanMat = basic(C_AXIS, 0.22);
  private builtTh = NaN;

  constructor() {
    // horizontal: traços de 2,4 m a cada 4 m
    const dash = new THREE.BoxGeometry(2.4, 0.28, 0.28);
    const dashMat = basic(0xffffff, 0.9);
    for (let x = -HALF; x <= HALF - 2; x += 4) {
      const m = new THREE.Mesh(dash, dashMat);
      m.position.x = x + 1.2;
      this.frame.add(m);
    }
    this.axis = new THREE.Mesh(new THREE.BoxGeometry(2 * HALF, 0.34, 0.34), this.axisMat);
    this.frame.add(this.axis);
    this.frame.traverse((o) => {
      o.renderOrder = 23;
      o.frustumCulled = false;
    });
    this.group.add(this.frame);
    this.group.visible = false;
  }

  /** arco, marcas e setor de 0 a th (rad); refeitos só quando o ângulo muda */
  private build(th: number): void {
    for (const m of [this.arc, this.ticks, this.fan]) {
      if (m) {
        this.frame.remove(m);
        m.geometry.dispose();
      }
    }
    this.arc = this.ticks = this.fan = null;
    this.builtTh = th;
    if (Math.abs(th) < 0.02 * DEG) return;
    const N = Math.max(4, Math.ceil(Math.abs(th) / DEG) * 4);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i++) {
      const a = (th * i) / N;
      pts.push(new THREE.Vector3(R * Math.cos(a), R * Math.sin(a), 0));
    }
    this.arc = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N * 2, 0.2, 6, false), this.arcMat);
    // marcas a cada grau (maiores a cada 5°)
    const geos: THREE.BufferGeometry[] = [];
    const nT = Math.min(30, Math.floor(Math.abs(th) / DEG + 1e-6));
    for (let d = 0; d <= nT; d++) {
      const a = Math.sign(th) * d * DEG;
      const g = new THREE.BoxGeometry(d % 5 === 0 ? 5 : 2.6, 0.16, 0.16);
      g.translate(R, 0, 0);
      g.rotateZ(a);
      geos.push(g);
    }
    this.ticks = new THREE.Mesh(mergeBoxes(geos), this.arcMat);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    for (const p of pts) shape.lineTo(p.x, p.y);
    shape.lineTo(0, 0);
    this.fan = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.fanMat);
    for (const m of [this.fan, this.arc, this.ticks]) {
      m.renderOrder = 23;
      m.frustumCulled = false;
      this.frame.add(m);
    }
  }

  /**
   * @param sub grupo do submarino (posição e atitude desenhadas; a proa é −z local)
   */
  update(on: boolean, e: SimulationEngine, sub: THREE.Object3D, labels: Label3D[], proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean }): void {
    this.group.visible = on;
    if (!on) return;
    const pitch = e.outputs.euler.pitch;
    const t = pitchText(pitch);
    const bow = new THREE.Vector3(0, 0, -1).applyQuaternion(sub.quaternion);
    const fwdH = bow.clone().setY(0);
    if (fwdH.lengthSq() < 1e-6) fwdH.set(0, 0, -1);
    fwdH.normalize();
    // ângulo desenhado (igual ao calculado, salvo a ampliação visual do trim); o rótulo mostra sempre o calculado
    const th = t.level ? 0 : Math.asin(Math.max(-1, Math.min(1, bow.y)));
    this.frame.position.copy(sub.position);
    this.frame.rotation.set(0, Math.atan2(-fwdH.z, fwdH.x), 0);
    this.axis.rotation.z = th;
    const col = t.level ? C_LEVEL : C_AXIS;
    this.axisMat.color.setHex(col);
    this.arcMat.color.setHex(col);
    this.fanMat.color.setHex(col);
    if (!(Math.abs(th - this.builtTh) < 0.01 * DEG)) this.build(th);
    this.frame.updateMatrixWorld();
    const at = (x: number, y: number) => this.frame.localToWorld(new THREE.Vector3(x, y, 0));
    const ca = Math.cos(th / 2);
    const sa = Math.sin(th / 2);
    labels.push({ id: 'pAng', big: true, text: t.value, sub: t.sense, color: t.level ? C_LEVEL_CSS : C_AXIS_CSS, prio: 0, ...proj(at((R + 9) * ca, (R + 9) * sa + (th < 0 ? -2.5 : 2.5))) });
    labels.push({ id: 'pAngH', text: 'horizontal (0°)', color: '#ffffff', small: true, prio: 2, ...proj(at(-HALF + 5, 2.4)) });
    if (!t.level) labels.push({ id: 'pAngA', text: 'eixo do casco', color: C_AXIS_CSS, small: true, prio: 2, ...proj(at(-(HALF - 5) * Math.cos(th), -(HALF - 5) * Math.sin(th) - 2.4)) });
  }
}

/** junta geometrias de caixa (só posições) numa só */
function mergeBoxes(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...(ng.getAttribute('position').array as Float32Array));
    if (ng !== g) ng.dispose();
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return out;
}
