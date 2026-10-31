/**
 * SUBMARINOS INIMIGOS E EXPLOSÕES NA CENA 3D (só lê o estado; nada aqui altera a física).
 *
 *  - cada submarino inimigo (state.weapons.enemies) na posição, rumo e cota da física: casco escuro com
 *    faixa vermelha, vela, lemes em cruz e hélice girando; quando atingido, o casco se parte em dois,
 *    embica e afunda soltando bolhas;
 *  - cada explosão (state.weapons.explosions): clarão, bolha de gás pulsando, onda de choque, estilhaços e,
 *    perto da superfície, a coluna d'água. Tudo é função da idade da explosão (tempo de simulação), então
 *    pausa, avanço e a segunda janela mostram o mesmo quadro.
 *
 * Eixo do modelo: −z para vante (proa), como o torpedo; origem no meio do comprimento.
 */
import * as THREE from 'three';
import type { SimulationEngine } from '../sim/core/engine';
import type { EnemySub, Explosion } from '../sim/core/state';
import { Bubbles } from './TorpedoVis';
import type { Label3D } from './SubmarineScene';

const L = 62; // comprimento (m)
const D = 6.6; // diâmetro (m)
const SPLIT = -L * 0.08; // ponto em que o casco se parte (z local)
const EXP_LIFE = 24; // duração do efeito (s)

/** posição do inimigo na cena (origem flutuante no submarino) */
export const enemyScenePos = (x: { n: number; e: number; d: number }, pn: number, pe: number) => new THREE.Vector3(x.e - pe, -x.d, -(x.n - pn));

/** inimigo acompanhado pela vista "Alvo": o alvo do último torpedo em corrida, senão o último acrescentado */
export function focusEnemy(e: SimulationEngine): EnemySub | null {
  const ws = e.state.weapons;
  const list = ws?.enemies ?? [];
  if (!list.length) return null;
  const runs = [...(ws?.runs ?? [])].sort((a, b) => b.tFire - a.tFire);
  for (const r of runs) {
    const x = list.find((k) => k.id === r.target || k.id === r.hit?.target);
    if (x) return x;
  }
  return list.filter((k) => k.sunk === null).at(-1) ?? list.at(-1) ?? null;
}

function hullProfile(): THREE.Vector2[] {
  // perfil de revolução (raio × posição ao longo do eixo, da popa para a proa)
  const pts: THREE.Vector2[] = [];
  const r = D / 2;
  for (let i = 0; i <= 40; i++) {
    const u = i / 40; // 0 popa … 1 proa
    let rr: number;
    if (u < 0.28) rr = r * Math.pow(Math.sin((u / 0.28) * (Math.PI / 2)), 0.9) * (0.15 + 0.85 * (u / 0.28) ** 0.4);
    else if (u > 0.88) rr = r * Math.sqrt(Math.max(0, 1 - ((u - 0.88) / 0.12) ** 2));
    else rr = r;
    pts.push(new THREE.Vector2(Math.max(0.05, rr), (u - 0.5) * L));
  }
  return pts;
}

interface EnemyModel {
  root: THREE.Group;
  fore: THREE.Group;
  aft: THREE.Group;
  prop: THREE.Object3D;
  glow: THREE.Mesh;
}

function buildEnemy(): EnemyModel {
  const dark = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.55, metalness: 0.35 });
  const red = new THREE.MeshStandardMaterial({ color: 0x9e1b1b, roughness: 0.6, metalness: 0.2, emissive: 0x2a0000 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 0.4, metalness: 0.8 });
  const root = new THREE.Group();
  const fore = new THREE.Group();
  const aft = new THREE.Group();
  root.add(fore, aft);
  // casco de revolução, cortado no ponto de ruptura (as duas metades)
  const prof = hullProfile();
  const cut = (keepFore: boolean) => prof.filter((p) => (keepFore ? p.y >= SPLIT - 0.01 : p.y <= SPLIT + 0.01));
  for (const [g, keep] of [
    [fore, true],
    [aft, false],
  ] as const) {
    const lathe = new THREE.LatheGeometry(cut(keep), 36);
    lathe.rotateX(-Math.PI / 2); // eixo y → −z (proa para −z)
    const m = new THREE.Mesh(lathe, dark);
    g.add(m);
    // metade de baixo do casco cilíndrico em vermelho (de −0,38 L a +0,22 L, partida em SPLIT)
    const z0 = keep ? -0.38 * L : SPLIT;
    const z1 = keep ? SPLIT : 0.22 * L;
    const band = new THREE.CylinderGeometry(D / 2 + 0.03, D / 2 + 0.03, z1 - z0, 36, 1, true, -Math.PI / 2, Math.PI);
    band.rotateX(Math.PI / 2);
    const stripe = new THREE.Mesh(band, red);
    stripe.position.z = (z0 + z1) / 2;
    g.add(stripe);
  }
  // vela (na metade de vante), com lemes de vela
  const sail = new THREE.Mesh(new THREE.BoxGeometry(1.6, 4.8, 9), dark);
  sail.position.set(0, D / 2 + 2.1, -L * 0.18);
  const sailTop = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 9, 16, 1), dark);
  sailTop.rotation.x = Math.PI / 2;
  sailTop.position.set(0, D / 2 + 4.5, -L * 0.18);
  const sailFin = new THREE.Mesh(new THREE.BoxGeometry(7, 0.25, 1.8), dark);
  sailFin.position.set(0, D / 2 + 2.6, -L * 0.18 - 1.6);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.5, 8), metal);
  mast.position.set(0, D / 2 + 6, -L * 0.18 - 2);
  fore.add(sail, sailTop, sailFin, mast);
  // lemes em cruz e hélice (metade de ré)
  const finGeo = new THREE.BoxGeometry(0.3, 5.4, 3.4);
  for (let k = 0; k < 4; k++) {
    const f = new THREE.Mesh(finGeo, dark);
    const a = (k * Math.PI) / 2;
    f.position.set(Math.sin(a) * 2.4, Math.cos(a) * 2.4, L * 0.41);
    f.rotation.z = -a;
    aft.add(f);
  }
  const prop = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), metal);
  prop.add(hub);
  for (let k = 0; k < 7; k++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.2, 0.12), metal);
    b.position.y = 1.2;
    const arm = new THREE.Group();
    arm.add(b);
    arm.rotation.z = (k / 7) * Math.PI * 2;
    b.rotation.y = 0.5;
    prop.add(arm);
  }
  prop.position.z = L / 2 + 0.6;
  aft.add(prop);
  // halo vermelho fraco (ajuda a achar o alvo na água turva)
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.scale.set(D * 1.4, D * 1.4, L * 0.75);
  root.add(glow);
  root.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = false) : undefined));
  return { root, fore, aft, prop, glow };
}

/** pseudoaleatório determinístico (mesmas partículas a cada quadro) */
function hash(i: number, k: number): number {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const DEBRIS = 700;
const SPRAY = 500;

class ExplosionFx {
  readonly group = new THREE.Group();
  private flash: THREE.Mesh;
  private gas: THREE.Mesh;
  private shock: THREE.Mesh;
  private ring: THREE.Mesh;
  private light: THREE.PointLight;
  private debris: THREE.Points;
  private spray: THREE.Points;
  private dPos: Float32Array;
  private dCol: Float32Array;
  private sPos: Float32Array;
  private sCol: Float32Array;

  constructor(dot: THREE.Texture | null) {
    const add = (color: number, opacity: number, side: THREE.Side = THREE.FrontSide) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side });
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), add(0xfff2b0, 1));
    this.gas = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 20),
      new THREE.MeshStandardMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.2, emissive: 0xff7a1a, emissiveIntensity: 1, depthWrite: false }),
    );
    this.shock = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), add(0x9fd8ff, 0.25, THREE.BackSide));
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;
    this.light = new THREE.PointLight(0xffa040, 0, 600, 1.2);
    const pts = (n: number, size: number) => {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const p = new THREE.Points(g, new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, map: dot ?? undefined, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      p.frustumCulled = false;
      p.renderOrder = 12;
      return { p, pos, col };
    };
    const d = pts(DEBRIS, 1.6);
    const s = pts(SPRAY, 2.4);
    this.debris = d.p;
    this.dPos = d.pos;
    this.dCol = d.col;
    this.spray = s.p;
    this.sPos = s.pos;
    this.sCol = s.col;
    this.group.add(this.flash, this.gas, this.shock, this.ring, this.light, this.debris, this.spray);
  }

  /** age: segundos desde a explosão; p: ponto da explosão na cena; surf: altura da superfície ali */
  update(age: number, p: THREE.Vector3, surf: number): void {
    const on = age >= 0 && age < EXP_LIFE;
    this.group.visible = on;
    if (!on) return;
    const depth = Math.max(0, surf - p.y);
    // clarão (0,6 s)
    const fl = Math.max(0, 1 - age / 0.6);
    this.flash.visible = fl > 0;
    this.flash.position.copy(p);
    this.flash.scale.setScalar(4 + 22 * Math.min(1, age / 0.18));
    (this.flash.material as THREE.MeshBasicMaterial).opacity = fl * fl;
    this.light.position.copy(p);
    this.light.intensity = 9000 * Math.exp(-age * 2.2);
    // bolha de gás: cresce, colapsa e pulsa enquanto sobe (período ≈ 1,4 s)
    const T = 1.4;
    const cyc = age / T;
    const amp = Math.pow(0.45, Math.floor(cyc));
    const rGas = Math.max(0, 16 * amp * Math.sin(Math.PI * (cyc % 1)));
    const rise = Math.min(depth, 2.5 * age + 0.6 * age * age);
    this.gas.visible = age < 9 && rGas > 0.3;
    this.gas.position.set(p.x, p.y + rise, p.z);
    this.gas.scale.setScalar(rGas);
    const gm = this.gas.material as THREE.MeshStandardMaterial;
    gm.emissiveIntensity = Math.max(0, 1.6 - age * 0.9);
    gm.opacity = 0.42 * Math.max(0, 1 - age / 9);
    // onda de choque (esfera que se expande e some)
    const sk = age / 2.2;
    this.shock.visible = sk < 1;
    this.shock.position.copy(p);
    this.shock.scale.setScalar(5 + 230 * sk);
    (this.shock.material as THREE.MeshBasicMaterial).opacity = 0.32 * (1 - sk) * (1 - sk);
    // estilhaços e bolhas: lançados em todas as direções, freados pela água; as bolhas sobem, o metal desce
    for (let i = 0; i < DEBRIS; i++) {
      const u = hash(i, 1) * 2 - 1;
      const th = hash(i, 2) * Math.PI * 2;
      const sq = Math.sqrt(1 - u * u);
      const v0 = 12 + 38 * hash(i, 3);
      const k = 1.6;
      const r = (v0 * (1 - Math.exp(-k * age))) / k;
      const metal = i % 5 === 0;
      const buoy = metal ? -1.6 * age : 1.4 * age + 0.25 * age * age;
      const k3 = i * 3;
      this.dPos[k3] = p.x + sq * Math.cos(th) * r;
      this.dPos[k3 + 1] = Math.min(surf, p.y + u * r * 0.8 + buoy);
      this.dPos[k3 + 2] = p.z + sq * Math.sin(th) * r;
      const life = metal ? 10 : 6 + 10 * hash(i, 4);
      const f = Math.max(0, 1 - age / life);
      const hot = Math.max(0, 1 - age / 1.2);
      this.dCol[k3] = f * (metal ? 0.35 + 0.65 * hot : 0.75 + 0.25 * hot);
      this.dCol[k3 + 1] = f * (metal ? 0.25 + 0.4 * hot : 0.82);
      this.dCol[k3 + 2] = f * (metal ? 0.2 : 0.9 - 0.5 * hot);
    }
    (this.debris.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.debris.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    // superfície: coluna d'água e anel de espuma (só com a explosão perto da superfície)
    const near = depth < 90;
    const delay = depth / 40; // a bolha leva um tempo para chegar à superfície
    const sa = age - delay;
    const strength = Math.max(0, 1 - depth / 90);
    this.spray.visible = near && sa > 0;
    this.ring.visible = near && sa > 0 && sa < 14;
    if (near && sa > 0) {
      this.ring.position.set(p.x, surf + 0.15, p.z);
      this.ring.scale.setScalar(6 + 9 * sa);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.75 * Math.max(0, 1 - sa / 14);
      const hMax = 20 + 90 * strength;
      for (let i = 0; i < SPRAY; i++) {
        const th = hash(i, 5) * Math.PI * 2;
        const rr = (0.2 + hash(i, 6)) * (4 + 14 * strength);
        const vy = Math.sqrt(2 * 9.81 * hMax) * (0.4 + 0.6 * hash(i, 7));
        const y = vy * sa - 4.9 * sa * sa;
        const out = rr * (1 + 0.5 * sa);
        const k3 = i * 3;
        this.sPos[k3] = p.x + Math.cos(th) * out;
        this.sPos[k3 + 1] = surf + Math.max(0, y);
        this.sPos[k3 + 2] = p.z + Math.sin(th) * out;
        const f = y > 0 ? Math.min(1, 0.4 + strength) : Math.max(0, 0.5 - (sa - (2 * vy) / 9.81) * 0.2);
        this.sCol[k3] = this.sCol[k3 + 1] = this.sCol[k3 + 2] = f * 0.95;
      }
      (this.spray.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.spray.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}

interface EnemyInst {
  m: EnemyModel;
  bubbles: Bubbles;
  acc: number;
}

export class EnemyVis {
  readonly group = new THREE.Group();
  private enemies = new Map<string, EnemyInst>();
  private fx = new Map<string, ExplosionFx>();
  private lastOrigin = new THREE.Vector3();
  /** intensidade do tremor de câmera (0…1) da explosão mais recente, pela distância */
  shake = 0;

  constructor(private dot: THREE.Texture | null) {}

  update(
    e: SimulationEngine,
    pn: number,
    pe: number,
    on: boolean,
    step: number,
    camera: THREE.Camera,
    surfaceY: (n: number, ee: number) => number,
    labels: Label3D[] | null,
    proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean },
  ): void {
    const ws = e.state.weapons;
    this.group.visible = on;
    const shift = new THREE.Vector3(pe, 0, -pn).sub(this.lastOrigin);
    this.lastOrigin.set(pe, 0, -pn);
    this.shake = 0;
    if (!on || !ws) return;
    const t = e.state.t;
    // ---- submarinos inimigos
    const alive = new Set<string>();
    for (const x of ws.enemies ?? []) {
      alive.add(x.id);
      let v = this.enemies.get(x.id);
      if (!v) {
        v = { m: buildEnemy(), bubbles: new Bubbles(360, this.dot, 0.55), acc: 0 };
        this.group.add(v.m.root, v.bubbles.points);
        this.enemies.set(x.id, v);
      }
      const pos = enemyScenePos(x, pn, pe);
      const root = v.m.root;
      root.position.copy(pos);
      root.rotation.set(0, 0, 0);
      root.rotateY((-x.course * Math.PI) / 180);
      root.rotateX((-x.pitch * Math.PI) / 180);
      v.m.prop.rotation.z += x.speed * 0.8 * Math.min(step, 0.1);
      const sunkAge = x.sunk === null ? -1 : t - x.sunk;
      v.m.glow.visible = x.sunk === null;
      // casco partido: as metades se afastam e giram em sentidos opostos
      const br = sunkAge < 0 ? 0 : Math.min(1, sunkAge / 10);
      v.m.fore.position.set(0, -1.5 * br, -4 * br);
      v.m.fore.rotation.set((-14 * br * Math.PI) / 180, 0, (6 * br * Math.PI) / 180);
      v.m.aft.position.set(0, -3 * br, 5 * br);
      v.m.aft.rotation.set((22 * br * Math.PI) / 180, 0, (-9 * br * Math.PI) / 180);
      // bolhas: do casco rompido (muitas) e da hélice (poucas, com velocidade)
      if (step > 0) {
        const rate = sunkAge >= 0 ? Math.max(4, 60 * Math.exp(-sunkAge / 25)) : x.speed > 0.5 ? 6 : 0;
        v.acc += step * rate;
        const fwd = new THREE.Vector3(Math.sin((x.course * Math.PI) / 180), 0, -Math.cos((x.course * Math.PI) / 180));
        while (v.acc >= 1) {
          v.acc -= 1;
          const at = sunkAge >= 0 ? pos.clone().addScaledVector(fwd, SPLIT * -1 + (Math.random() - 0.5) * 8) : pos.clone().addScaledVector(fwd, -L / 2 - 1);
          v.bubbles.emit(at, sunkAge >= 0 ? 3 : 1, sunkAge >= 0 ? 2.2 : 0.4, 10 + Math.random() * 8);
        }
      }
      v.bubbles.step(step, shift, Math.min(0, surfaceY(x.n, x.e)));
      if (labels) {
        const pp = proj(pos.clone().add(new THREE.Vector3(0, 9, 0)));
        const rng = Math.hypot(x.n - pn, x.e - pe);
        labels.push({
          id: 'ini_' + x.id,
          text: x.name,
          sub: x.sunk !== null ? 'ATINGIDO — afundando' : `${(rng / 1000).toFixed(1)} km · ${x.d.toFixed(0)} m · ${(x.speed / 0.5144).toFixed(0)} nós${x.evading ? ' · FUGINDO' : ''}`,
          color: x.sunk !== null ? '#ff8a80' : '#ff5257',
          small: true,
          prio: 1,
          x: pp.x,
          y: pp.y,
          visible: pp.visible,
        });
      }
    }
    for (const [id, v] of this.enemies)
      if (!alive.has(id)) {
        this.group.remove(v.m.root, v.bubbles.points);
        v.bubbles.points.geometry.dispose();
        this.enemies.delete(id);
      }
    // ---- explosões
    const seen = new Set<string>();
    for (const x of ws.explosions ?? []) {
      // as explosões dos mísseis (no ar ou em terra) ficam com MissileVis
      if (x.kind === 'missil') continue;
      seen.add(x.id);
      let fx = this.fx.get(x.id);
      if (!fx) {
        fx = new ExplosionFx(this.dot);
        this.group.add(fx.group);
        this.fx.set(x.id, fx);
      }
      const age = t - x.t;
      const p = enemyScenePos(x, pn, pe);
      fx.update(age, p, surfaceY(x.n, x.e));
      if (age >= 0 && age < 3) {
        const dist = camera.position.distanceTo(p);
        this.shake = Math.max(this.shake, Math.max(0, 1 - age / 3) * Math.min(1, 300 / Math.max(30, dist)));
      }
      if (labels && age >= 0 && age < 12) {
        const pp = proj(p.clone().add(new THREE.Vector3(0, 22, 0)));
        labels.push({ id: 'exp_' + x.id, text: '💥 EXPLOSÃO', sub: `torpedo ${x.id}`, color: '#ffb347', small: true, prio: 0, x: pp.x, y: pp.y, visible: pp.visible });
      }
    }
    for (const [id, fx] of this.fx)
      if (!seen.has(id)) {
        this.group.remove(fx.group);
        this.fx.delete(id);
      }
  }
}

export type { Explosion };
