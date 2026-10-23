/**
 * VETORES DE TRIM (camada própria, liga/desliga separadamente):
 *  - peso deslocável: bloco sobre o trilho na posição simulada;
 *  - binário do deslocamento: +P na posição atual e −P (seta para cima,
 *    translúcida) na posição neutra;
 *  - tanques de trim: variação de peso em TT-AV e TT-AR em relação à
 *    condição inicial (seta para baixo = mais água, para cima = menos);
 *  - arco: momento líquido das cargas deslocadas (sentido proa ↑ / proa ↓)
 *    e pitch atual × de equilíbrio estático.
 * Valores de sim/forceVectors.ts → trimBalance (estado do último passo).
 */
import * as THREE from 'three';
import type { SimulationEngine } from '../sim/core/engine';
import { trimBalance } from '../sim/forceVectors';
import { Arrow3D } from './ForceArrows';
import type { SceneLayers } from './layers';
import type { Label3D } from './SubmarineScene';

const b2l = (x: number, y: number, z: number) => new THREE.Vector3(y, -z, -x);
const C_DEMO = 0xff5ec4;
const C_DEMO_CSS = '#ff7ad1';
const C_TRIM = 0xffa62b;
const C_TRIM_CSS = '#ffb54d';
const C_NET_CSS = '#ffffff';
/** escala dos vetores de trim: 1,3 m por tonelada */
const M_PER_T = 1.3;
const fmtT = (kg: number) => `${(kg / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} t`;
const fmtTm = (tm: number) => `${tm < 0 ? '−' : ''}${Math.abs(tm).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} t·m`;

function arc(R: number, from: number, to: number, color: number): THREE.Group {
  // p(φ) = (0, R sen φ, −R cos φ) no plano vertical longitudinal (local); φ crescente = proa para cima
  const pts: THREE.Vector3[] = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const f = from + ((to - from) * i) / N;
    pts.push(new THREE.Vector3(0, R * Math.sin(f), -R * Math.cos(f)));
  }
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.22, 8, false), mat);
  const end = pts[N];
  const tan = end.clone().sub(pts[N - 1]).normalize();
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.8, 14), mat);
  head.position.copy(end).add(tan.clone().multiplyScalar(0.6));
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
  const g = new THREE.Group();
  g.add(tube, head);
  g.traverse((o) => (o.renderOrder = 22));
  return g;
}

/** textura de lingotes de chumbo empilhados, com moldura rosa */
function ingotTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2b3036';
  g.fillRect(0, 0, 256, 128);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 8 + col * 61 + (row % 2) * 14 - 7;
      const y = 8 + row * 29;
      const grd = g.createLinearGradient(0, y, 0, y + 24);
      grd.addColorStop(0, '#9aa3ad');
      grd.addColorStop(1, '#5d656e');
      g.fillStyle = grd;
      g.fillRect(x, y, 54, 24);
      g.strokeStyle = '#1b1f24';
      g.lineWidth = 2;
      g.strokeRect(x, y, 54, 24);
    }
  }
  g.strokeStyle = '#ff5ec4';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 248, 120);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class TrimVis {
  /** filhos do grupo do submarino (bloco, trilho, arcos) */
  readonly local = new THREE.Group();
  /** setas no mundo (verticais) */
  readonly world = new THREE.Group();
  readonly block: THREE.Mesh;
  private rail: THREE.Line;
  private plus = new Arrow3D(C_DEMO, 0.26);
  private minus = new Arrow3D(C_DEMO, 0.26);
  private ghost: THREE.Mesh;
  private tA = new Arrow3D(C_TRIM, 0.24);
  private tB = new Arrow3D(C_TRIM, 0.24);
  private arcUp: THREE.Group;
  private arcDown: THREE.Group;
  private arcOk: THREE.Mesh;
  private R: number;

  constructor(e: SimulationEngine) {
    const dw = e.vessel.mass.demoWeight;
    // lingotes de chumbo empilhados (textura), com borda rosa: o rosa identifica o peso deslocável
    const ingots = ingotTexture();
    const blockMat = new THREE.MeshStandardMaterial({ color: ingots ? 0xffffff : C_DEMO, map: ingots ?? undefined, emissive: C_DEMO, emissiveIntensity: 0.12, metalness: 0.55, roughness: 0.45, transparent: true, depthTest: false, depthWrite: false });
    this.block = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 2.2), blockMat);
    this.block.renderOrder = 9;
    this.block.userData.pick = { kind: 'demoWeight', id: 'demoWeight' };
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 2.2), new THREE.MeshBasicMaterial({ color: C_DEMO, wireframe: true, transparent: true, opacity: 0.5, depthTest: false, toneMapped: false }));
    this.ghost.renderOrder = 9;
    const z = dw ? dw.z : 1.7;
    const rg = new THREE.BufferGeometry().setFromPoints([b2l(dw?.xMin ?? -25, 0, z + 0.55), b2l(dw?.xMax ?? 25, 0, z + 0.55)]);
    this.rail = new THREE.Line(rg, new THREE.LineBasicMaterial({ color: 0xff9be0, transparent: true, opacity: 0.8, depthTest: false, toneMapped: false }));
    this.rail.renderOrder = 9;
    this.local.add(this.block, this.ghost, this.rail);
    // arcos do momento acima da vela
    const v = e.vessel;
    this.R = v.hull.diameter / 2 + v.hull.sail.height + 3.5;
    const a0 = (25 * Math.PI) / 180;
    const a1 = (155 * Math.PI) / 180;
    this.arcUp = arc(this.R, a0, a1, 0xffffff); // proa para cima: ponta na ré
    this.arcDown = arc(this.R, a1, a0, 0xffffff); // proa para baixo: ponta na vante
    this.arcOk = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.18, 8, 32), new THREE.MeshBasicMaterial({ color: 0x3ddc84, depthTest: false, transparent: true, toneMapped: false }));
    this.arcOk.renderOrder = 22;
    this.local.add(this.arcUp, this.arcDown, this.arcOk);
    this.world.add(this.plus.group, this.minus.group, this.tA.group, this.tB.group);
    this.local.visible = false;
    this.world.visible = false;
  }

  update(e: SimulationEngine, sub: THREE.Object3D, layers: SceneLayers, labels: Label3D[], proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean }): void {
    const on = layers.trimVectors;
    const dw = e.vessel.mass.demoWeight;
    const tb = trimBalance(e);
    // o bloco aparece no corte (tanques) ou com os vetores de trim
    this.local.visible = on || layers.tanks;
    this.world.visible = on;
    const showBlock = !!tb.demo && tb.demo.mass > 0 && !!dw;
    this.block.visible = showBlock;
    // sem parcela deslocada (massa 0) o trilho também some: não confunde com as cargas a bordo
    this.rail.visible = showBlock;
    this.ghost.visible = showBlock && on && Math.abs(tb.demo!.x - tb.demo!.xNeutral) > 0.3;
    this.arcUp.visible = false;
    this.arcDown.visible = false;
    this.arcOk.visible = false;
    if (tb.demo && dw) {
      const s = Math.max(0.5, Math.cbrt(tb.demo.mass / 5000));
      this.block.scale.setScalar(s);
      this.ghost.scale.setScalar(s);
      this.block.position.copy(b2l(tb.demo.x, dw.y, dw.z));
      this.ghost.position.copy(b2l(tb.demo.xNeutral, dw.y, dw.z));
    }
    const up = new THREE.Vector3(0, 1, 0);
    const down = new THREE.Vector3(0, -1, 0);
    const lw = (x: number, z: number) => sub.localToWorld(b2l(x, 0, z));
    if (!on) {
      for (const a of [this.plus, this.minus, this.tA, this.tB]) a.set(new THREE.Vector3(), up, 0);
      if (showBlock && layers.tanks && layers.labels && Math.abs(tb.demo!.x - tb.demo!.xNeutral) > 0.3) labels.push({ id: 'dwB', callout: true, text: `Peso deslocável ${fmtT(tb.demo!.mass)}`, color: C_DEMO_CSS, small: true, prio: 2, ...proj(sub.localToWorld(this.block.position.clone().add(new THREE.Vector3(0, 1.2, 0)))) });
      return;
    }
    // binário do peso deslocado
    if (tb.demo && dw && tb.demo.mass > 0) {
      const L = (tb.demo.mass / 1000) * M_PER_T;
      const shifted = Math.abs(tb.demo.x - tb.demo.xNeutral) > 0.3;
      const p0 = lw(tb.demo.x, dw.z + 0.5);
      this.plus.set(p0, down, L);
      const p1 = lw(tb.demo.xNeutral, dw.z + 0.5 + 0);
      this.minus.set(p1.clone().add(new THREE.Vector3(0, -L, 0)), up, shifted ? L : 0, true);
      if (layers.labels) {
        labels.push({ id: 'dwP', text: `+P ${fmtT(tb.demo.mass)} (peso deslocado)`, sub: `x = ${tb.demo.x.toFixed(1)} m${Math.abs(tb.demo.xCmd - tb.demo.x) > 0.05 ? ' · em movimento' : ''}`, color: C_DEMO_CSS, prio: 0, ...proj(this.plus.tip()) });
        if (shifted) labels.push({ id: 'dwM', text: `−P (posição original)`, color: C_DEMO_CSS, small: true, prio: 1, ...proj(p1.clone().add(new THREE.Vector3(0, -L - 1.5, 0))) });
      }
    } else {
      this.plus.set(new THREE.Vector3(), up, 0);
      this.minus.set(new THREE.Vector3(), up, 0);
    }
    // variação de peso nos tanques de trim
    const tanks: [Arrow3D, number, number, number, string][] = [
      [this.tA, tb.tanks.dA, tb.tanks.xA, tb.tanks.zA, 'TT-AV'],
      [this.tB, tb.tanks.dB, tb.tanks.xB, tb.tanks.zB, 'TT-AR'],
    ];
    for (const [a, dm, x, z, name] of tanks) {
      const L = (Math.abs(dm) / 1000) * M_PER_T;
      if (Math.abs(dm) < 50) {
        a.set(new THREE.Vector3(), up, 0);
        continue;
      }
      const base = lw(x, z + 0.8);
      if (dm > 0) a.set(base, down, L);
      else a.set(base.clone().add(new THREE.Vector3(0, -L, 0)), up, L);
      if (layers.labels) labels.push({ id: 'tv' + name, text: `${name} ${dm > 0 ? '+' : '−'}${fmtT(Math.abs(dm))}`, color: C_TRIM_CSS, small: true, prio: 1, ...proj(dm > 0 ? a.tip() : base.clone().add(new THREE.Vector3(0, -L - 1.2, 0))) });
    }
    // momento líquido
    const shiftTm = (tb.demo?.momentTm ?? 0) + tb.loadsTm;
    const ref = Math.max(5, Math.abs(shiftTm) * 0.05);
    const top = lw(2, -this.R - 1.5);
    let txt: string;
    if (Math.abs(tb.netTm) <= ref && (Math.abs(shiftTm) > ref || Math.abs(tb.tanks.momentTm) > ref)) {
      this.arcOk.visible = true;
      this.arcOk.position.copy(b2l(2, 0, -this.R));
      txt = 'Trim compensado: momentos se anulam';
    } else if (Math.abs(tb.netTm) > 1) {
      const noseUp = tb.netTm > 0;
      (noseUp ? this.arcUp : this.arcDown).visible = true;
      txt = `Momento de trim ${fmtTm(tb.netTm)} (proa ${noseUp ? '↑' : '↓'})`;
    } else txt = 'Sem momento de trim';
    if (layers.labels)
      labels.push({
        id: 'tmN',
        text: txt,
        sub: `${Math.abs(tb.loadsTm) > 0.05 ? `cargas ${fmtTm(tb.loadsTm)} · ` : ''}${Math.abs(tb.demo?.momentTm ?? 0) > 0.05 || Math.abs(tb.loadsTm) <= 0.05 ? `peso ${fmtTm(tb.demo?.momentTm ?? 0)} · ` : ''}tanques de trim ${fmtTm(tb.tanks.momentTm)} · θ ${tb.pitch.toFixed(1)}° (equilíbrio ${tb.pitchEq.toFixed(1)}°)`,
        color: C_NET_CSS,
        prio: 0,
        ...proj(top),
      });
  }
}
