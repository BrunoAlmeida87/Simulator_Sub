/**
 * EFEITOS DE SUPERFÍCIE E DE MOVIMENTO — todos acionados pelo estado físico:
 *
 *  - esteira persistente: faixa de espuma fixa no MUNDO deixada pela popa;
 *    intensidade pela velocidade real U no instante em que foi gerada, largura
 *    crescente e decaimento com a idade (em tempo de simulação). Ao reduzir a
 *    propulsão o casco continua avançando (inércia) e a esteira continua a ser
 *    gerada enquanto U > 0;
 *  - onda de proa e braços de Kelvin: partículas emitidas na proa (∝ U²) que se
 *    afastam lateralmente a 0,36·U (meio-ângulo ≈ 19,5°);
 *  - rastro do hélice: jato ∝ √(T/ρA) a partir do disco do hélice — some quando
 *    o empuxo vai a zero, mesmo com o submarino ainda em movimento;
 *  - jato de ar dos suspiros acima da água (∝ vazão de ar) e espuma onde as
 *    bolhas chegam à superfície;
 *  - ASPIRAÇÃO do snorkel: com o mastro içado e o diesel ligado, um leve fluxo
 *    de ar convergindo para a cabeça do mastro (∝ carga dos geradores). A
 *    descarga não sai pelo mastro: vai em bolhas atrás da vela (cena).
 */
import { snorkelIntake } from '../sim/systems/exhaust';
import * as THREE from 'three';
import type { SimulationEngine } from '../sim/core/engine';
import type { WaveField } from '../sim/environment/waves';
import { qToMat3 } from '../sim/core/math';

interface FxP {
  n: number;
  e: number;
  d: number; // profundidade (+ para baixo); NaN = presa à superfície
  vn: number;
  ve: number;
  vd: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  alpha: number;
  surface: boolean;
  drag: number;
}

const VS = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
  vA = aAlpha;
}`;
const FS = /* glsl */ `
uniform sampler2D map;
uniform vec3 color;
varying float vA;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  if (t.a * vA < 0.01) discard;
  gl_FragColor = vec4(color, t.a * vA);
}`;

class PointPool {
  readonly points: THREE.Points;
  readonly list: FxP[] = [];
  private pos: THREE.BufferAttribute;
  private size: THREE.BufferAttribute;
  private alpha: THREE.BufferAttribute;
  readonly mat: THREE.ShaderMaterial;
  constructor(
    readonly max: number,
    color: number,
    map: THREE.Texture | null,
  ) {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.Float32BufferAttribute(new Float32Array(max * 3), 3);
    this.size = new THREE.Float32BufferAttribute(new Float32Array(max), 1);
    this.alpha = new THREE.Float32BufferAttribute(new Float32Array(max), 1);
    g.setAttribute('position', this.pos);
    g.setAttribute('aSize', this.size);
    g.setAttribute('aAlpha', this.alpha);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: { map: { value: map }, color: { value: new THREE.Color(color) }, uScale: { value: 400 } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }
  add(p: Partial<FxP> & { n: number; e: number }): void {
    if (this.list.length >= this.max) return;
    this.list.push({ d: 0, vn: 0, ve: 0, vd: 0, life: 0, max: 5, size: 1, grow: 0, alpha: 1, surface: true, drag: 0, ...p });
  }
  /** avança (dt de simulação) e escreve as posições relativas à origem flutuante */
  update(dt: number, pn: number, pe: number, w: WaveField, t: number): void {
    const L = this.list;
    if (dt > 0) {
      let j = 0;
      for (let i = 0; i < L.length; i++) {
        const p = L[i];
        p.life += dt;
        if (p.life >= p.max) continue;
        const k = Math.exp(-p.drag * dt);
        p.vn *= k;
        p.ve *= k;
        if (p.drag > 0 && !p.surface) p.vd *= Math.exp(-0.5 * p.drag * dt);
        p.n += p.vn * dt;
        p.e += p.ve * dt;
        if (!p.surface) {
          p.vd += 9.81 * dt * (p.drag > 0 ? 0 : 1);
          p.d += p.vd * dt;
          // jato de ar: cai de volta na água
          if (p.vd > 0 && p.d > -w.elevation(p.n, p.e, t)) continue;
        }
        L[j++] = p;
      }
      L.length = j;
    }
    const n = L.length;
    for (let i = 0; i < this.max; i++) {
      if (i >= n) {
        this.pos.setXYZ(i, 0, -1e5, 0);
        this.alpha.setX(i, 0);
        continue;
      }
      const p = L[i];
      const y = p.surface ? w.elevation(p.n, p.e, t) + 0.12 : -p.d;
      this.pos.setXYZ(i, p.e - pe, y, -(p.n - pn));
      const age = p.life / p.max;
      this.size.setX(i, p.size + p.grow * p.life);
      this.alpha.setX(i, p.alpha * Math.min(1, p.life * 4) * (1 - age) * (1 - age));
    }
    this.pos.needsUpdate = true;
    this.size.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
  clear(): void {
    this.list.length = 0;
  }
}

interface WakeSample {
  n: number;
  e: number;
  t: number;
  amp: number;
  dist: number;
  hx: number; // direção lateral (n, e)
  hy: number;
}

function foamTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = 'rgba(255,255,255,0)';
  g.fillRect(0, 0, 256, 256);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * 256;
    const y = rnd() * 256;
    const r = 2 + rnd() * 10;
    const a = 0.25 + rnd() * 0.55;
    for (const [dx, dy] of [
      [0, 0],
      [256, 0],
      [-256, 0],
      [0, 256],
      [0, -256],
    ]) {
      const grd = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      grd.addColorStop(0, `rgba(255,255,255,${a})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x + dx, y + dy, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MAX_WAKE = 700;

export class SurfaceFx {
  readonly group = new THREE.Group();
  private foam: PointPool; // proa, Kelvin, espuma de bolhas
  private wash: PointPool; // rastro do hélice na superfície
  private jet: PointPool; // rastro do hélice submerso
  private spray: PointPool; // jato dos suspiros
  private intake: PointPool; // ar aspirado pela cabeça do snorkel (diesel em carga)
  private wake: WakeSample[] = [];
  private wakeMesh: THREE.Mesh;
  private wPos: THREE.BufferAttribute;
  private wCol: THREE.BufferAttribute;
  private wUv: THREE.BufferAttribute;
  private lastWake: { n: number; e: number; dist: number } | null = null;

  /** scale < 1 reduz o número máximo de partículas (qualidade gráfica baixa) */
  constructor(dot: THREE.Texture | null, scale = 1) {
    const n = (k: number) => Math.max(100, Math.round(k * scale));
    this.foam = new PointPool(n(1800), 0xffffff, dot);
    this.wash = new PointPool(n(900), 0xe6fff6, dot);
    this.jet = new PointPool(n(700), 0xbfe6ff, dot);
    this.spray = new PointPool(n(900), 0xffffff, dot);
    this.intake = new PointPool(n(500), 0xeef6ff, dot);
    this.group.add(this.intake.points);
    this.group.add(this.foam.points, this.wash.points, this.jet.points, this.spray.points);
    const g = new THREE.BufferGeometry();
    // 3 vértices por amostra (borda, centro, borda): bordas transparentes, centro denso
    this.wPos = new THREE.Float32BufferAttribute(new Float32Array(MAX_WAKE * 3 * 3), 3);
    this.wCol = new THREE.Float32BufferAttribute(new Float32Array(MAX_WAKE * 3 * 4), 4);
    this.wUv = new THREE.Float32BufferAttribute(new Float32Array(MAX_WAKE * 3 * 2), 2);
    const idx: number[] = [];
    for (let i = 0; i < MAX_WAKE - 1; i++) {
      const a = 3 * i;
      const b = a + 3;
      idx.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
    }
    g.setIndex(idx);
    g.setAttribute('position', this.wPos);
    g.setAttribute('color', this.wCol);
    g.setAttribute('uv', this.wUv);
    const mat = new THREE.MeshBasicMaterial({ map: foamTexture() ?? undefined, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.wakeMesh = new THREE.Mesh(g, mat);
    this.wakeMesh.frustumCulled = false;
    this.wakeMesh.renderOrder = 3;
    this.group.add(this.wakeMesh);
  }

  reset(): void {
    this.wake = [];
    this.lastWake = null;
    this.foam.clear();
    this.wash.clear();
    this.jet.clear();
    this.spray.clear();
    this.intake.clear();
  }

  /** espuma da descarga do diesel: as bolhas chegam juntas e deixam manchas mais duradouras (o rastro atrás da vela) */
  exhaustFoam(n: number, e: number): void {
    this.foam.add({ n, e, max: 12 + Math.random() * 10, size: 1.6, grow: 0.42, alpha: 0.5, drag: 0.6, vn: (Math.random() - 0.5) * 0.5, ve: (Math.random() - 0.5) * 0.5 });
  }

  /** espuma onde uma bolha chega à superfície */
  bubbleSurfaced(n: number, e: number): void {
    if (Math.random() < 0.5) this.foam.add({ n, e, max: 6 + Math.random() * 5, size: 1.4, grow: 0.35, alpha: 0.55, drag: 1, vn: (Math.random() - 0.5) * 0.6, ve: (Math.random() - 0.5) * 0.6 });
  }

  update(e: SimulationEngine, step: number, pn: number, pe: number, t: number, pixelScale: number, enabled: boolean): void {
    this.group.visible = enabled;
    for (const p of [this.foam, this.wash, this.jet, this.spray, this.intake]) p.mat.uniforms.uScale.value = pixelScale;
    const s = e.state;
    const v = e.vessel;
    const w = e.env.waves;
    const L = v.hull.length;
    const R0 = v.hull.diameter / 2;
    const u = s.body.vel.x;
    const U = Math.abs(u);
    const psi = (e.outputs.euler.heading * Math.PI) / 180;
    const fn = Math.cos(psi); // vante (n, e)
    const fe = Math.sin(psi);
    const ln = -fe; // boreste
    const le = fn;
    const pos = s.body.pos;
    const R = qToMat3(s.body.quat);
    const toW = (bx: number, by: number, bz: number) => ({
      n: pos.x + R[0] * bx + R[1] * by + R[2] * bz,
      e: pos.y + R[3] * bx + R[4] * by + R[5] * bz,
      d: pos.z + R[6] * bx + R[7] * by + R[8] * bz,
    });
    const rel = (p: { n: number; e: number; d: number }) => p.d + w.elevation(p.n, p.e, t); // profundidade abaixo da superfície local
    const rnd = () => Math.random() - 0.5;
    if (enabled && step > 0) {
      // ---- esteira persistente (popa)
      const stern = toW(-L / 2 + 4, 0, 0);
      const sternTop = rel(stern) - R0;
      const sink = Math.max(0, Math.min(1, 1 - (sternTop - 0.5) / 5));
      const amp = sink * Math.min(1, Math.max(0, (U - 0.25) / 3.5)) ** 0.8;
      const last = this.lastWake;
      const dd = last ? Math.hypot(stern.n - last.n, stern.e - last.e) : Infinity;
      if (dd > 2.2 && amp > 0.02) {
        const dist = (last?.dist ?? 0) + (Number.isFinite(dd) ? dd : 0);
        if (!last && this.wake.length) {
          // novo trecho: separadores transparentes (sem faixa ligando os trechos)
          const pl = this.wake[this.wake.length - 1];
          this.wake.push({ ...pl, amp: 0 }, { n: stern.n, e: stern.e, t: s.t, amp: 0, dist, hx: ln, hy: le });
        }
        this.wake.push({ n: stern.n, e: stern.e, t: s.t, amp, dist, hx: ln, hy: le });
        this.lastWake = { n: stern.n, e: stern.e, dist };
        if (this.wake.length > MAX_WAKE - 1) this.wake.splice(0, this.wake.length - (MAX_WAKE - 1));
      } else if (amp <= 0.02 && dd > 2.2) this.lastWake = null;
      // ---- proa: almofada de espuma e braços de Kelvin
      const bowP = toW(L / 2 - 4, 0, 0);
      const bowTop = rel(bowP) - R0;
      const bowSink = Math.max(0, Math.min(1, 1 - (bowTop + 0.3) / 3.5));
      const fr = U * U;
      const nBow = bowSink * Math.min(70, fr * 3.2) * step;
      for (let k = Math.floor(nBow) + (Math.random() < nBow % 1 ? 1 : 0); k > 0; k--) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const xb = L / 2 - 2 - Math.random() * 7;
        const rb = e.geom.radiusAt(xb) + 0.3;
        const p = toW(xb, side * rb, 0);
        const vl = side * U * 0.36 * (0.85 + 0.3 * Math.random());
        this.foam.add({ n: p.n, e: p.e, vn: ln * vl + rnd() * 0.3, ve: le * vl + rnd() * 0.3, max: 9 + U * 2 + Math.random() * 5, size: 0.9 + U * 0.12, grow: 0.08, alpha: 0.42, drag: 0.02 });
      }
      const nCush = bowSink * Math.min(50, U * 9) * step;
      for (let k = Math.floor(nCush) + (Math.random() < nCush % 1 ? 1 : 0); k > 0; k--) {
        const p = toW(L / 2 - 1.5 - Math.random() * 2.5, rnd() * 2.2, 0);
        this.foam.add({ n: p.n, e: p.e, vn: fn * u * 0.6 + rnd() * 1.2, ve: fe * u * 0.6 + rnd() * 1.2, max: 1.4 + Math.random() * 1.4, size: 1.4, grow: 0.7, alpha: 0.7, drag: 0.8 });
      }
      // ---- hélice: jato ∝ √(T/ρA)
      const T = s.propulsion.thrust;
      const Rp = v.propulsion.propeller.diameter / 2;
      const Ap = Math.PI * Rp * Rp;
      const vj = Math.sign(T) * Math.sqrt(Math.abs(T) / (1025 * Ap));
      const prop = toW(-L / 2 - 0.8, 0, 0);
      const propRel = rel(prop);
      const Tn = Math.min(1, Math.abs(T) / 120e3);
      if (Math.abs(T) > 2e3) {
        // na superfície: borbulhão de espuma
        if (propRel < Rp + 3.5) {
          const nW = Math.min(60, 10 + Tn * 60) * step * Math.max(0, Math.min(1, 1 - (propRel - Rp) / 3.5));
          for (let k = Math.floor(nW) + (Math.random() < nW % 1 ? 1 : 0); k > 0; k--) {
            const vb = -(vj * 1.6 + 0.8 * Math.sign(vj)) + u;
            this.wash.add({ n: prop.n + rnd() * 2.5, e: prop.e + rnd() * 2.5, vn: fn * vb + ln * rnd() * 1.4, ve: fe * vb + le * rnd() * 1.4, max: 5 + Math.random() * 5, size: 1.5, grow: 0.45, alpha: 0.6, drag: 0.35 });
          }
        }
        // submerso: turbulência do jato (referência visual de movimento)
        if (propRel > Rp + 1) {
          const nJ = Math.min(40, 6 + Tn * 40) * step;
          for (let k = Math.floor(nJ) + (Math.random() < nJ % 1 ? 1 : 0); k > 0; k--) {
            const a = Math.random() * Math.PI * 2;
            const r = Rp * (0.4 + 0.6 * Math.random());
            const p = toW(-L / 2 - 1.2, Math.cos(a) * r, Math.sin(a) * r);
            const vb = -(vj * 1.8) * (0.7 + 0.6 * Math.random()) + u * 0.2;
            this.jet.add({ n: p.n, e: p.e, d: p.d, vn: fn * vb, ve: fe * vb, vd: 0, max: 5 + Math.random() * 3, size: 0.5, grow: 0.08, alpha: 0.55, drag: 0.45, surface: false });
          }
        }
      }
      // ---- aspiração do snorkel: ar puxado para a cabeça do mastro (efeito leve, ∝ carga do diesel)
      {
        const k = snorkelIntake(v, s);
        if (k > 0) {
          const m = v.hull.snorkelMast;
          const top = R0 + v.hull.sail.height - 0.5 + s.snorkel.pos * m.extension;
          const head = toW(m.x, 0, -top + 0.1);
          if (rel(head) < -0.2) {
            const k0 = Math.min(45, 8 + k * 16) * step;
            for (let j = Math.floor(k0) + (Math.random() < k0 % 1 ? 1 : 0); j > 0; j--) {
              // nasce num anel em volta da cabeça e converge para a entrada de ar
              const a = Math.random() * Math.PI * 2;
              const r = 1.6 + Math.random() * 2.2;
              const up = (Math.random() - 0.3) * 1.6;
              const life = 0.7 + Math.random() * 0.5;
              const on = Math.cos(a) * r;
              const oe = Math.sin(a) * r;
              this.intake.add({
                n: head.n + on,
                e: head.e + oe,
                d: head.d - up,
                // velocidade para chegar à cabeça no fim da vida + o avanço do submarino (acompanha o mastro)
                vn: -on / life + fn * u,
                ve: -oe / life + fe * u,
                vd: up / life,
                max: life,
                size: 0.95,
                grow: -0.55,
                alpha: 0.3 + 0.1 * Math.min(1, k),
                drag: 0.001,
                surface: false,
              });
            }
          }
        }
      }
      // ---- suspiros acima da água: jato de ar/borrifo
      for (const t0 of v.ballast.tanks) {
        const st = s.ballast[t0.id];
        if (st.mdotVent < 0.05) continue;
        const r = e.geom.radiusAt(t0.center.x);
        const side = t0.center.y < 0 ? -1 : 1;
        const out = toW(t0.center.x + (t0.center.x > 0 ? 0.8 : -0.8), side * r * 0.27, -r - 0.2);
        if (rel(out) > 0) continue; // submerso: bolhas (tratadas pela cena)
        const k0 = Math.min(90, st.mdotVent * 8) * step;
        const vUp = 4 + 7 * Math.min(1, Math.sqrt(st.mdotVent / 12));
        for (let k = Math.floor(k0) + (Math.random() < k0 % 1 ? 1 : 0); k > 0; k--) {
          this.spray.add({
            n: out.n + rnd() * 0.5,
            e: out.e + rnd() * 0.5,
            d: out.d,
            vn: rnd() * 1.6 + fn * u,
            ve: rnd() * 1.6 + fe * u,
            vd: -vUp * (0.75 + 0.5 * Math.random()),
            max: 4,
            size: 1.1,
            grow: 0.9,
            alpha: 0.85,
            drag: 0,
            surface: false,
          });
        }
      }
    }
    this.foam.update(step, pn, pe, w, t);
    this.wash.update(step, pn, pe, w, t);
    this.jet.update(step, pn, pe, w, t);
    this.spray.update(step, pn, pe, w, t);
    this.intake.update(step, pn, pe, w, t);
    this.updateWakeMesh(e, pn, pe, t);
  }

  private updateWakeMesh(e: SimulationEngine, pn: number, pe: number, t: number): void {
    const w = e.env.waves;
    const now = e.state.t;
    const TAU = 50;
    // descarta amostras apagadas
    let k0 = 0;
    while (k0 < this.wake.length && this.wake[k0].amp * Math.exp(-(now - this.wake[k0].t) / TAU) < 0.015) k0++;
    if (k0 > 0) this.wake.splice(0, k0);
    const W = this.wake;
    const n = W.length;
    const P = this.wPos;
    const C = this.wCol;
    const U = this.wUv;
    for (let i = 0; i < MAX_WAKE; i++) {
      if (i >= n) {
        for (let j = 0; j < 3; j++) {
          P.setXYZ(3 * i + j, 0, -1e5, 0);
          C.setXYZW(3 * i + j, 1, 1, 1, 0);
        }
        continue;
      }
      const sm = W[i];
      const age = Math.max(0, now - sm.t);
      const a = sm.amp * Math.exp(-age / TAU) * Math.min(1, age * 1.5 + 0.35);
      const half = Math.min(24, 2.2 + age * (0.12 + 0.25 * sm.amp));
      const y = w.elevation(sm.n, sm.e, t) + 0.07;
      const x0 = sm.e - pe;
      const z0 = -(sm.n - pn);
      // direção lateral no plano (n,e) → cena (e, −n)
      const dx = sm.hy * half;
      const dz = -sm.hx * half;
      P.setXYZ(3 * i, x0 - dx, y, z0 - dz);
      P.setXYZ(3 * i + 1, x0, y, z0);
      P.setXYZ(3 * i + 2, x0 + dx, y, z0 + dz);
      const core = Math.min(1, a * 1.4);
      C.setXYZW(3 * i, 1, 1, 1, 0);
      C.setXYZW(3 * i + 1, 1, 1, 1, core);
      C.setXYZW(3 * i + 2, 1, 1, 1, 0);
      const vv = sm.dist / 10;
      const uu = Math.max(1, half / 5);
      U.setXY(3 * i, 0, vv);
      U.setXY(3 * i + 1, uu / 2, vv);
      U.setXY(3 * i + 2, uu, vv);
    }
    // última amostra "pendurada" na popa: a faixa nunca se descola do casco
    P.needsUpdate = true;
    C.needsUpdate = true;
    U.needsUpdate = true;
    this.wakeMesh.geometry.setDrawRange(0, Math.max(0, (n - 1) * 12));
    this.wakeMesh.visible = n > 1;
  }
}
