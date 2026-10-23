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

/** amostras do arco e máximo de marcas de grau */
const ARC_N = 64;
const MAX_TICKS = 30;

/** geometria plana (plano z = 0 do transferidor) com n vértices, atualizada no lugar */
function plane(n: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * n), 3).setUsage(THREE.DynamicDrawUsage));
  g.setDrawRange(0, 0);
  return g;
}

const basic = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });

export class PitchAngle {
  readonly group = new THREE.Group();
  /** plano do transferidor: x = proa na horizontal, y = para cima */
  private frame = new THREE.Group();
  private axis: THREE.Mesh;
  // arco, marcas e setor: buffers alocados uma vez e só atualizados (sem criar geometria a cada quadro)
  private arc = plane(2 * (ARC_N + 1));
  private ticks = plane(6 * (MAX_TICKS + 1));
  private fan = plane(3 * ARC_N);
  private axisMat = basic(C_AXIS);
  private arcMat = basic(C_AXIS);
  private fanMat = basic(C_AXIS, 0.22);
  private builtTh = NaN;
  private arcMesh: THREE.Mesh;
  private tickMesh: THREE.Mesh;
  private fanMesh: THREE.Mesh;

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
    // faixa do arco: dois triângulos por amostra (vértices interno/externo alternados)
    const idx: number[] = [];
    for (let i = 0; i < ARC_N; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    this.arc.setIndex(idx);
    this.fanMesh = new THREE.Mesh(this.fan, this.fanMat);
    this.arcMesh = new THREE.Mesh(this.arc, this.arcMat);
    this.tickMesh = new THREE.Mesh(this.ticks, this.arcMat);
    this.frame.add(this.fanMesh, this.arcMesh, this.tickMesh);
    this.frame.traverse((o) => {
      o.renderOrder = 23;
      o.frustumCulled = false;
    });
    this.group.add(this.frame);
    this.group.visible = false;
  }

  /** arco (faixa plana), marcas a cada grau (maiores a cada 5°) e setor de 0 a th (rad), nos buffers fixos */
  private build(th: number): void {
    this.builtTh = th;
    const on = Math.abs(th) >= 0.02 * DEG;
    const ap = this.arc.getAttribute('position') as THREE.BufferAttribute;
    const fp = this.fan.getAttribute('position') as THREE.BufferAttribute;
    const tp = this.ticks.getAttribute('position') as THREE.BufferAttribute;
    let prevX = R;
    let prevY = 0;
    for (let i = 0; i <= ARC_N; i++) {
      const a = (th * i) / ARC_N;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      ap.setXYZ(2 * i, (R - 0.22) * c, (R - 0.22) * sn, 0);
      ap.setXYZ(2 * i + 1, (R + 0.22) * c, (R + 0.22) * sn, 0);
      if (i > 0) {
        const k = 3 * (i - 1);
        fp.setXYZ(k, 0, 0, 0);
        fp.setXYZ(k + 1, prevX, prevY, 0);
        fp.setXYZ(k + 2, R * c, R * sn, 0);
      }
      prevX = R * c;
      prevY = R * sn;
    }
    const nT = on ? Math.min(MAX_TICKS, Math.floor(Math.abs(th) / DEG + 1e-6)) : -1;
    for (let d = 0; d <= nT; d++) {
      const a = Math.sign(th) * d * DEG;
      const half = d % 5 === 0 ? 2.5 : 1.3;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      // retângulo radial de R − half a R + half, 0,16 m de largura
      const w = 0.08;
      const pts: [number, number][] = [
        [R - half, -w],
        [R + half, -w],
        [R + half, w],
        [R - half, w],
      ].map(([r, t]) => [r * c - t * sn, r * sn + t * c]);
      const k = 6 * d;
      for (const [j, q] of [0, 1, 2, 0, 2, 3].entries()) tp.setXYZ(k + j, pts[q][0], pts[q][1], 0);
    }
    for (const a of [ap, fp, tp]) a.needsUpdate = true;
    this.arc.setDrawRange(0, on ? 6 * ARC_N : 0);
    this.fan.setDrawRange(0, on ? 3 * ARC_N : 0);
    this.ticks.setDrawRange(0, 6 * (nT + 1));
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
