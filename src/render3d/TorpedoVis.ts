/**
 * TORPEDOS NA CENA 3D (só lê o estado; nada aqui altera a física).
 *
 *  - no submarino: a arma em cada tubo carregado (vista no corte) e, no disparo, correndo pelo tubo
 *    até sair pela boca (percurso `eject` da física);
 *  - no mar: cada torpedo lançado (state.weapons.runs) na posição e no rumo da física, com as duas
 *    hélices girando, esteira de bolhas, bolhas do lançamento junto à boca e o fio de guiagem até o
 *    submarino; no fim da corrida a arma de exercício sobe e flutua de ponta para cima;
 *  - `focus`: o torpedo acompanhado pela vista "Torpedo".
 *
 * Modelo: public/models/sx1-f21.glb (scripts/blender/build_f21.py); sem o arquivo, o desenho simples
 * de CargoVis.ts. Eixo da arma = −z local (ponta para vante), origem no meio do comprimento.
 */
import * as THREE from 'three';
import type { SimulationEngine } from '../sim/core/engine';
import type { TorpedoRun } from '../sim/core/state';
import { muzzleX, stowedWeaponX } from '../sim/systems/torpedoTubes';
import { torpedo as fallbackTorpedo } from './CargoVis';
import { loadSubModel } from './subModel';
import type { Label3D } from './SubmarineScene';

/** corpo (x vante, y boreste, z para baixo) → local do submarino */
const b2l = (x: number, y: number, z: number) => new THREE.Vector3(y, -z, -x);

export const TORPEDO_PARTS = { root: 'F21', body: 'F21_Corpo', propFwd: 'F21_Helice_Vante', propAft: 'F21_Helice_Re' } as const;

export function torpedoModelUrl(): string {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';
  return `${base}models/sx1-f21.glb`;
}

interface Inst {
  root: THREE.Group;
  props: { obj: THREE.Object3D; dir: number }[];
  mats: THREE.Material[];
}

const PHASE_TXT: Record<TorpedoRun['phase'], string> = {
  afastamento: 'afastamento',
  guiado: 'guiado pelo fio',
  busca: 'corrida',
  ataque: 'ATAQUE',
  flutuando: 'fim de corrida',
  recolher: 'flutuando (recolher)',
};

const WAKE_N = 420;
const BURST_N = 260;

class Bubbles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private head = 0;
  private seed = 1;
  constructor(
    private n: number,
    dot: THREE.Texture | null,
    size: number,
  ) {
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, map: dot ?? undefined, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 11;
  }
  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647 - 0.5;
  }
  emit(p: THREE.Vector3, spread: number, up: number, life: number, drift?: THREE.Vector3): void {
    const i = this.head;
    this.head = (this.head + 1) % this.n;
    this.pos[i * 3] = p.x + this.rnd() * spread;
    this.pos[i * 3 + 1] = p.y + this.rnd() * spread;
    this.pos[i * 3 + 2] = p.z + this.rnd() * spread;
    this.vel[i * 3] = (drift?.x ?? 0) + this.rnd() * 0.3;
    this.vel[i * 3 + 1] = up * (0.6 + this.rnd() * 0.6);
    this.vel[i * 3 + 2] = (drift?.z ?? 0) + this.rnd() * 0.3;
    this.life[i] = life;
    this.max[i] = life;
  }
  /** avança as bolhas (dt em s), desloca pela origem flutuante e limita à superfície */
  step(dt: number, shift: THREE.Vector3, surfaceY: number): void {
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      if (this.life[i] <= 0) {
        this.col[k] = this.col[k + 1] = this.col[k + 2] = 0;
        continue;
      }
      this.life[i] -= dt;
      this.pos[k] += this.vel[k] * dt - shift.x;
      this.pos[k + 1] = Math.min(surfaceY, this.pos[k + 1] + this.vel[k + 1] * dt - shift.y);
      this.pos[k + 2] += this.vel[k + 2] * dt - shift.z;
      const f = Math.max(0, this.life[i] / this.max[i]);
      const c = 0.85 * Math.min(1, f * 1.6);
      this.col[k] = c * 0.85;
      this.col[k + 1] = c * 0.95;
      this.col[k + 2] = c;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
  active(): boolean {
    for (let i = 0; i < this.n; i++) if (this.life[i] > 0) return true;
    return false;
  }
}

interface RunVis {
  inst: Inst;
  wake: Bubbles;
  wire: THREE.Line;
  wireAttr: THREE.BufferAttribute;
  emitAcc: number;
  pitch: number;
}

const WIRE_MAX = 600;

/** Torpedo acompanhado pela vista "Torpedo": o último lançado ainda em corrida (ou o último de todos). */
export function focusRun(e: SimulationEngine): TorpedoRun | null {
  const runs = e.state.weapons?.runs ?? [];
  let best: TorpedoRun | null = null;
  for (const r of runs) if (r.phase !== 'recolher' && (!best || r.tFire >= best.tFire)) best = r;
  return best ?? runs[runs.length - 1] ?? null;
}

/** Posição na cena (origem flutuante no submarino) e direção da arma acompanhada, interpoladas no passo. */
export function torpedoPose(e: SimulationEngine, pn: number, pe: number, a: number): { pos: THREE.Vector3; dir: THREE.Vector3; run: TorpedoRun } | null {
  const r = focusRun(e);
  if (!r) return null;
  const hd = (r.heading * Math.PI) / 180;
  const dir = new THREE.Vector3(Math.sin(hd), 0, -Math.cos(hd));
  const pos = new THREE.Vector3(r.e - pe, -r.d, -(r.n - pn)).addScaledVector(dir, -r.speed * (1 - a) * e.config.settings.dt);
  if (r.phase === 'recolher' || (r.phase === 'flutuando' && r.d < 3)) pos.y = Math.max(pos.y, -2.2);
  return { pos, dir, run: r };
}

export class TorpedoVis {
  /** no submarino (filho do grupo do casco) */
  readonly local = new THREE.Group();
  /** no mar (cena) */
  readonly world = new THREE.Group();
  /** torpedo acompanhado pela vista "Torpedo": posição na cena e direção (null = nenhum) */
  focus: { id: string; pos: THREE.Vector3; dir: THREE.Vector3; n: number; e: number } | null = null;
  private src: THREE.Object3D | null = null;
  private tubes: (Inst | null)[] = [];
  private runs = new Map<string, RunVis>();
  private burst: Bubbles;
  private lastOrigin = new THREE.Vector3();
  private clip: THREE.Plane[] | null = null;
  private wireMat = new THREE.LineBasicMaterial({ color: 0xd8e2ea, transparent: true, opacity: 0.55, depthWrite: false });

  constructor(
    private dot: THREE.Texture | null,
    renderer: THREE.WebGLRenderer | null,
  ) {
    this.burst = new Bubbles(BURST_N, dot, 0.45);
    this.world.add(this.burst.points);
    if (renderer)
      loadSubModel(torpedoModelUrl(), renderer)
        .then((src) => {
          this.src = src;
          this.rebuild();
        })
        .catch(() => undefined);
  }

  private make(): Inst {
    let root: THREE.Group;
    const props: Inst['props'] = [];
    if (this.src) {
      root = new THREE.Group();
      const c = this.src.clone(true);
      root.add(c);
      const f = c.getObjectByName(TORPEDO_PARTS.propFwd);
      const a = c.getObjectByName(TORPEDO_PARTS.propAft);
      if (f) props.push({ obj: f, dir: 1 });
      if (a) props.push({ obj: a, dir: -1 });
    } else root = fallbackTorpedo();
    // materiais próprios (o corte aplica o plano do meio casco aberto às armas dos tubos)
    const mats: THREE.Material[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
      for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.push(x);
      m.castShadow = m.receiveShadow = false;
    });
    return { root, props, mats };
  }

  /** troca os desenhos simples pelo modelo assim que ele carrega */
  private rebuild(): void {
    for (const t of this.tubes) if (t) this.local.remove(t.root);
    this.tubes = [];
    for (const r of this.runs.values()) this.world.remove(r.inst.root);
    for (const [id, r] of this.runs) {
      r.inst = this.make();
      this.world.add(r.inst.root);
      this.runs.set(id, r);
    }
  }

  /** plano do meio casco aberto (as armas nos tubos são cortadas junto com o casco) */
  setClip(plane: THREE.Plane | null): void {
    if ((this.clip?.[0] ?? null) === plane) return;
    this.clip = plane ? [plane] : null;
    for (const t of this.tubes) if (t) for (const m of t.mats) m.clippingPlanes = this.clip;
  }

  /**
   * a: fração do passo (interpolação); step: tempo de simulação decorrido no quadro (s);
   * inside: o corte está à vista (armas dentro dos tubos visíveis).
   */
  update(
    e: SimulationEngine,
    sub: THREE.Object3D,
    pn: number,
    pe: number,
    on: boolean,
    inside: boolean,
    a: number,
    step: number,
    surfaceY: (n: number, ee: number) => number,
    labels: Label3D[] | null,
    proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean },
  ): void {
    const s = e.state;
    const w = e.vessel.weapons;
    const ws = s.weapons;
    this.local.visible = on;
    this.world.visible = on;
    const shift = new THREE.Vector3(pe, 0, -pn).sub(this.lastOrigin);
    this.lastOrigin.set(pe, 0, -pn);
    if (!w || !ws || !on) {
      this.focus = null;
      return;
    }
    const R = e.geom.radiusAt;
    const dt = e.config.settings.dt;
    // ---- armas nos tubos
    w.tubes.forEach((tc, i) => {
      const t = ws.tubes[i];
      const show = t.weapon && (inside || t.eject !== null);
      let inst = this.tubes[i] ?? null;
      if (show && !inst) {
        inst = this.make();
        for (const m of inst.mats) m.clippingPlanes = this.clip;
        this.tubes[i] = inst;
        this.local.add(inst.root);
      }
      if (!inst) return;
      inst.root.visible = show;
      if (!show) return;
      inst.root.position.copy(b2l(stowedWeaponX(w) + (t.eject ?? 0), tc.y, tc.z));
      // no disparo, as bolhas do ar de lançamento saem pela boca
      if (t.eject !== null && step > 0) {
        sub.updateMatrixWorld();
        const m = sub.localToWorld(b2l(muzzleX(w, tc, R) + 0.4, tc.y, tc.z));
        for (let k = 0; k < 12; k++) this.burst.emit(m, 0.9, 1.4, 4 + Math.random() * 3);
      }
    });
    // ---- torpedos lançados
    const alive = new Set<string>();
    let focus: TorpedoRun | null = null;
    for (const r of ws.runs) {
      alive.add(r.id);
      let v = this.runs.get(r.id);
      if (!v) {
        const inst = this.make();
        const wake = new Bubbles(WAKE_N, this.dot, 0.32);
        const g = new THREE.BufferGeometry();
        const wireAttr = new THREE.BufferAttribute(new Float32Array(WIRE_MAX * 3), 3);
        g.setAttribute('position', wireAttr);
        const wire = new THREE.Line(g, this.wireMat);
        wire.frustumCulled = false;
        this.world.add(inst.root, wake.points, wire);
        v = { inst, wake, wire, wireAttr, emitAcc: 0, pitch: 0 };
        this.runs.set(r.id, v);
        // bolhas do lançamento junto à boca
        const p0 = new THREE.Vector3(r.e - pe, -r.d, -(r.n - pn));
        for (let k = 0; k < 120; k++) this.burst.emit(p0, 1.4, 1.2, 5 + Math.random() * 4);
      }
      if (r.phase !== 'recolher' && (!focus || r.tFire >= focus.tFire)) focus = r;
      // pose interpolada no passo
      const back = (1 - a) * dt;
      const hd = (r.heading * Math.PI) / 180;
      const fwd = new THREE.Vector3(Math.sin(hd), 0, -Math.cos(hd));
      const pos = new THREE.Vector3(r.e - pe, -r.d, -(r.n - pn)).addScaledVector(fwd, -r.speed * back);
      const surf = surfaceY(r.n, r.e);
      const floating = r.phase === 'recolher' || (r.phase === 'flutuando' && r.d < 3);
      let pitchTarget = 0;
      if (floating) pitchTarget = (70 * Math.PI) / 180;
      else if (Math.abs(r.presets.depth - r.d) > 0.5) pitchTarget = Math.atan2(Math.sign(r.d - r.presets.depth) * e.vessel.weapons!.weapon.depthRate, Math.max(1, r.speed));
      v.pitch += (pitchTarget - v.pitch) * Math.min(1, (floating ? 0.8 : 3) * Math.max(step, 1 / 60));
      if (floating) pos.y = surf - 2.2 + 0.15 * Math.sin(s.t * 1.3 + r.tube);
      const root = v.inst.root;
      root.position.copy(pos);
      root.rotation.set(0, 0, 0);
      root.rotateY(-hd);
      root.rotateX(v.pitch);
      // hélices contrarrotativas
      for (const p of v.inst.props) p.obj.rotation.z += p.dir * r.speed * 1.6 * Math.min(step, 0.1);
      // esteira de bolhas atrás da cauda (mais densa com a velocidade)
      if (step > 0 && r.speed > 0.5 && !floating) {
        v.emitAcc += step * Math.min(40, 4 + r.speed * 1.6);
        const tail = pos.clone().addScaledVector(fwd, -3.4);
        while (v.emitAcc >= 1) {
          v.emitAcc -= 1;
          v.wake.emit(tail, 0.35, 0.25, 9 + Math.random() * 5, fwd.clone().multiplyScalar(-0.4));
        }
      }
      v.wake.step(step, shift, Math.min(0, surf));
      // fio de guiagem: da boca do tubo pela derrota até a arma
      v.wire.visible = r.wire;
      if (r.wire) {
        const tc = w.tubes.find((x) => x.n === r.tube) ?? w.tubes[0];
        sub.updateMatrixWorld();
        const m = sub.localToWorld(b2l(muzzleX(w, tc, R), tc.y, tc.z));
        const pts = r.track;
        const stride = Math.max(1, Math.ceil(pts.length / (WIRE_MAX - 2)));
        let k = 0;
        v.wireAttr.setXYZ(k++, m.x, m.y, m.z);
        for (let j = 0; j < pts.length && k < WIRE_MAX - 1; j += stride) v.wireAttr.setXYZ(k++, pts[j].e - pe, -pts[j].d - 0.4, -(pts[j].n - pn));
        v.wireAttr.setXYZ(k++, pos.x, pos.y, pos.z);
        v.wire.geometry.setDrawRange(0, k);
        v.wireAttr.needsUpdate = true;
      }
      if (labels) {
        const pp = proj(pos.clone().add(new THREE.Vector3(0, 2.2, 0)));
        const rng = r.tgt ? ` · alvo ${(r.tgt.range / 1000).toFixed(1)} km` : '';
        labels.push({
          id: 'torp_' + r.id,
          text: `Torpedo ${r.id}`,
          sub: `${PHASE_TXT[r.phase]}${r.phase === 'recolher' ? '' : ` · ${(r.speed / 0.5144).toFixed(0)} nós · ${r.d.toFixed(0)} m${rng}`}`,
          color: r.hit ? '#7dffa8' : '#ffb347',
          small: true,
          prio: 1,
          x: pp.x,
          y: pp.y,
          visible: pp.visible,
        });
      }
    }
    this.burst.step(step, shift, 0);
    for (const [id, v] of this.runs)
      if (!alive.has(id)) {
        this.world.remove(v.inst.root, v.wake.points, v.wire);
        v.wake.points.geometry.dispose();
        v.wire.geometry.dispose();
        this.runs.delete(id);
      }
    if (focus) {
      const v = this.runs.get(focus.id)!;
      const hd = (focus.heading * Math.PI) / 180;
      this.focus = { id: focus.id, pos: v.inst.root.position.clone(), dir: new THREE.Vector3(Math.sin(hd), 0, -Math.cos(hd)), n: focus.n, e: focus.e };
    } else this.focus = null;
  }
}
