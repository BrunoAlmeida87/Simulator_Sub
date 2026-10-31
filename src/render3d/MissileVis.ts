/**
 * MÍSSIL SM39, ALVOS DE SUPERFÍCIE E EM TERRA NA CENA 3D (só lê o estado; nada aqui altera a física).
 *
 *  - cada míssil (state.weapons.missiles): a cápsula VSM subindo com o rastro de bolhas do motor, o rompimento
 *    da superfície (coluna de borrifo e anel de espuma), o nariz ejetado girando no ar, o míssil saindo da
 *    cápsula com as asas abrindo (forma "Recolhida" do modelo), a cápsula caindo no mar, o acelerador (chama,
 *    clarão e fumaça branca densa), o cruzeiro rasante (chama pequena, fumaça fina e névoa levantada do mar),
 *    o impacto (bola de fogo, clarão, onda de choque, estilhaços e coluna de fumaça) ou a queda no mar;
 *  - cada fragata (state.weapons.hostiles, tipo 'fragata'): modelo da classe Tamandaré (public/models/sx1-fragata.glb),
 *    radar girando, esteira, incêndio e fumaça nos pontos de impacto, banda e afundamento;
 *  - cada alvo em terra: instalação fictícia (casamata, radome, antena, tanques) no relevo; destruída, vira escombros
 *    em chamas;
 *  - `focus`: o míssil acompanhado pelas vistas "Míssil" e "Míssil cinematográfica".
 *
 * Modelo do míssil: public/models/sx1-sm39.glb (scripts/blender/build_sm39.py, de SM_39VSM.blend). Eixo = −z local
 * (proa para vante), origem no meio da cápsula. Sem o arquivo, cilindros simples.
 */
import * as THREE from 'three';
import type { SimulationEngine } from '../sim/core/engine';
import type { Hostile, MissileRun } from '../sim/core/state';
import { FRIGATE, LAND_SITE, missileActive } from '../sim/systems/missiles';
import { Bubbles } from './TorpedoVis';
import { loadSubModel } from './subModel';
import type { Label3D } from './SubmarineScene';

export const SM39_PARTS = { root: 'SM39_VSM', casing: 'VSM_Casco', nose: 'VSM_Nariz', missile: 'SM39', body: 'SM39_Corpo', surfaces: 'SM39_Superficies' } as const;

const base = () => (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';
export const sm39ModelUrl = () => `${base()}models/sx1-sm39.glb`;
export const frigateModelUrl = () => `${base()}models/sx1-fragata.glb`;

const DEG = Math.PI / 180;
/** NED → cena (origem flutuante no submarino) */
export const nedToScene = (n: number, e: number, d: number, pn: number, pe: number) => new THREE.Vector3(e - pe, -d, -(n - pn));
/** direção de voo na cena: rumo (°) e ângulo de trajetória (°, + subindo) */
export const flightDir = (heading: number, pitch: number) => {
  const h = heading * DEG;
  const g = pitch * DEG;
  return new THREE.Vector3(Math.sin(h) * Math.cos(g), Math.sin(g), -Math.cos(h) * Math.cos(g));
};

const PHASE_TXT: Record<MissileRun['phase'], string> = {
  capsula: 'cápsula subindo',
  superficie: 'rompeu a superfície',
  separacao: 'separação',
  acelerador: 'ACELERADOR',
  cruzeiro: 'cruzeiro inercial',
  busca: 'autodiretor buscando',
  terminal: 'TERMINAL',
  subida: 'subida',
  mergulho: 'MERGULHO',
  impacto: 'IMPACTO',
  passagem: 'passagem (exercício)',
  caindo: 'sem combustível',
  perdido: 'caiu',
};

// ------------------------------------------------------------------ partículas (tamanho e cor por partícula)

const VERT = `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uViewH;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * projectionMatrix[1][1] * uViewH * 0.5 / max(0.5, -mv.z);
}`;
const FRAG = `
varying vec4 vColor;
uniform float uSoft;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float a = vColor.a * pow(1.0 - r, uSoft);
  gl_FragColor = vec4(vColor.rgb, a);
}`;

interface PEmit {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  spread?: number;
  life: number;
  size0: number;
  size1: number;
  c0: THREE.Color;
  c1?: THREE.Color;
  alpha: number;
  drag?: number;
  rise?: number;
  /** partícula presa acima da superfície (borrifo, fumaça) ou livre */
  floor?: number;
}

/** Nuvem de partículas com tamanho, cor e opacidade por partícula (fumaça, fogo, borrifo). */
export class Cloud {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private a0: Float32Array;
  private drag: Float32Array;
  private rise: Float32Array;
  private floor: Float32Array;
  private head = 0;
  private seed = 7;
  private mat: THREE.ShaderMaterial;
  constructor(
    private n: number,
    additive: boolean,
    soft = 1.4,
  ) {
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1);
    this.life = new Float32Array(n).fill(0);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.c0 = new Float32Array(n * 3);
    this.c1 = new Float32Array(n * 3);
    this.a0 = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.rise = new Float32Array(n);
    this.floor = new Float32Array(n).fill(-1e9);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uViewH: { value: 800 }, uSoft: { value: soft } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 13 : 12;
  }
  rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647 - 0.5;
  }
  emit(p: PEmit): void {
    const i = this.head;
    this.head = (this.head + 1) % this.n;
    const sp = p.spread ?? 0;
    this.pos[i * 3] = p.pos.x + this.rnd() * sp;
    this.pos[i * 3 + 1] = p.pos.y + this.rnd() * sp;
    this.pos[i * 3 + 2] = p.pos.z + this.rnd() * sp;
    this.vel[i * 3] = p.vel?.x ?? 0;
    this.vel[i * 3 + 1] = p.vel?.y ?? 0;
    this.vel[i * 3 + 2] = p.vel?.z ?? 0;
    this.age[i] = 0;
    this.life[i] = p.life * (0.8 + 0.4 * (this.rnd() + 0.5));
    this.s0[i] = p.size0;
    this.s1[i] = p.size1;
    const c1 = p.c1 ?? p.c0;
    this.c0[i * 3] = p.c0.r;
    this.c0[i * 3 + 1] = p.c0.g;
    this.c0[i * 3 + 2] = p.c0.b;
    this.c1[i * 3] = c1.r;
    this.c1[i * 3 + 1] = c1.g;
    this.c1[i * 3 + 2] = c1.b;
    this.a0[i] = p.alpha;
    this.drag[i] = p.drag ?? 0;
    this.rise[i] = p.rise ?? 0;
    this.floor[i] = p.floor ?? -1e9;
  }
  /** dt: tempo de simulação no quadro; shift: deslocamento da origem flutuante; wind: deriva (m/s) */
  step(dt: number, shift: THREE.Vector3, viewH: number, wind: THREE.Vector3): void {
    this.mat.uniforms.uViewH.value = viewH;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      const k4 = i * 4;
      if (this.age[i] >= this.life[i]) {
        this.col[k4 + 3] = 0;
        this.size[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const f = Math.min(1, this.age[i] / this.life[i]);
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[k] = this.vel[k] * dr + (wind.x - this.vel[k]) * (1 - dr) * 0.3;
      this.vel[k + 1] = this.vel[k + 1] * dr + this.rise[i] * dt;
      this.vel[k + 2] = this.vel[k + 2] * dr + (wind.z - this.vel[k + 2]) * (1 - dr) * 0.3;
      this.pos[k] += this.vel[k] * dt - shift.x;
      this.pos[k + 1] += this.vel[k + 1] * dt - shift.y;
      this.pos[k + 2] += this.vel[k + 2] * dt - shift.z;
      if (this.pos[k + 1] < this.floor[i]) {
        this.pos[k + 1] = this.floor[i];
        this.vel[k + 1] = 0;
      }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(f);
      this.col[k4] = this.c0[k] + (this.c1[k] - this.c0[k]) * f;
      this.col[k4 + 1] = this.c0[k + 1] + (this.c1[k + 1] - this.c0[k + 1]) * f;
      this.col[k4 + 2] = this.c0[k + 2] + (this.c1[k + 2] - this.c0[k + 2]) * f;
      // entra rápido e some devagar
      this.col[k4 + 3] = this.a0[i] * Math.min(1, f * 12) * (1 - f) * (1 - f * 0.3);
    }
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ------------------------------------------------------------------ modelos

interface MissileModel {
  /** cápsula (casco) com o nariz enquanto preso; o míssil enquanto dentro dela */
  capsule: THREE.Group;
  nose: THREE.Group;
  missile: THREE.Group;
  morph: THREE.Mesh[];
  flame: THREE.Mesh;
  glow: THREE.Sprite;
  capFlame: THREE.Mesh;
}

function cloneMats(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = m.receiveShadow = false;
  });
}

function flameMesh(len: number, r: number, color: number): THREE.Mesh {
  const g = new THREE.ConeGeometry(r, len, 16, 1, true);
  g.translate(0, -len / 2, 0);
  g.rotateX(-Math.PI / 2); // ponta para +z (para ré do modelo)
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  m.renderOrder = 14;
  return m;
}

function glowSprite(): THREE.Sprite {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let tex: THREE.Texture | null = null;
  if (c) {
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (g) {
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,240,200,1)');
      grd.addColorStop(0.25, 'rgba(255,170,60,0.7)');
      grd.addColorStop(1, 'rgba(255,90,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
      tex = new THREE.CanvasTexture(c);
    }
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex ?? undefined, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  s.renderOrder = 15;
  return s;
}

/** desenho reserva (sem o .glb): cápsula verde-oliva, míssil branco */
function fallbackParts(): { capsule: THREE.Group; nose: THREE.Group; missile: THREE.Group } {
  const olive = new THREE.MeshStandardMaterial({ color: 0x4b5534, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe9ece8, roughness: 0.45 });
  const capsule = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.266, 0.266, 5.05, 24), olive);
  body.rotation.x = Math.PI / 2;
  body.position.z = 0.37;
  capsule.add(body);
  const nose = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.SphereGeometry(0.266, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), olive);
  cone.rotation.x = -Math.PI / 2;
  cone.scale.y = 2.6;
  nose.add(cone);
  nose.position.z = -2.15;
  const missile = new THREE.Group();
  const mb = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 4.2, 20), white);
  mb.rotation.x = Math.PI / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.175, 0.5, 20), white);
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -2.35;
  missile.add(mb, tip);
  return { capsule, nose, missile };
}

function buildMissileModel(src: THREE.Object3D | null): MissileModel {
  let capsule: THREE.Group;
  let nose: THREE.Group;
  let missile: THREE.Group;
  const morph: THREE.Mesh[] = [];
  if (src) {
    const c = src.clone(true);
    cloneMats(c);
    const casing = c.getObjectByName(SM39_PARTS.casing);
    const n = c.getObjectByName(SM39_PARTS.nose);
    const m = c.getObjectByName(SM39_PARTS.missile);
    capsule = new THREE.Group();
    nose = new THREE.Group();
    missile = new THREE.Group();
    if (casing) capsule.add(casing);
    if (n) {
      // o nariz fica num grupo próprio com o pivô na junta
      nose.position.copy(n.position);
      n.position.set(0, 0, 0);
      nose.add(n);
    }
    if (m) {
      missile.position.copy(m.position);
      m.position.set(0, 0, 0);
      missile.add(m);
    }
    missile.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (mm.isMesh && mm.morphTargetInfluences && mm.morphTargetInfluences.length) {
        // cada instância tem a sua influência (a geometria é compartilhada)
        mm.morphTargetInfluences = [...mm.morphTargetInfluences];
        morph.push(mm);
      }
    });
  } else ({ capsule, nose, missile } = fallbackParts());
  capsule.add(nose);
  const flame = flameMesh(5, 0.22, 0xffb05a);
  flame.position.z = 2.4;
  missile.add(flame);
  const glow = glowSprite();
  glow.position.z = 2.6;
  missile.add(glow);
  const capFlame = flameMesh(2.4, 0.16, 0xffd28a);
  capFlame.position.z = 2.95;
  capsule.add(capFlame);
  return { capsule, nose, missile, morph, flame, glow, capFlame };
}

// ------------------------------------------------------------------ alvo em terra (instalação fictícia)

function buildLandSite(): THREE.Group {
  const g = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9a9a8e, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x4d5247, roughness: 0.8 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.5 });
  const red = new THREE.MeshStandardMaterial({ color: 0xa83228, roughness: 0.6 });
  const pad = new THREE.Mesh(new THREE.BoxGeometry(LAND_SITE.B + 12, 1.2, LAND_SITE.L + 12), dark);
  pad.position.y = -0.4;
  const bunker = new THREE.Mesh(new THREE.BoxGeometry(18, 7, 26), concrete);
  bunker.position.set(-6, 3.5, 2);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(20, 1, 28), dark);
  roof.position.set(-6, 7.3, 2);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 10, 12), concrete);
  tower.position.set(10, 5, -10);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4.2, 24, 16), white);
  dome.position.set(10, 12.5, -10);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 24, 8), red);
  mast.position.set(12, 12, 12);
  g.add(pad, bunker, roof, tower, dome, mast);
  for (const z of [10, 18]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 6, 20), white);
    tank.position.set(8, 3, z - 4);
    g.add(tank);
  }
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = false) : undefined));
  return g;
}

/** fragata simples (enquanto o .glb carrega ou sem ele): casco e superestrutura cinza */
function frigateFallback(): THREE.Group {
  const g = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0x7d858c, roughness: 0.7 });
  const sh = new THREE.Shape();
  const L = FRIGATE.L;
  const b = FRIGATE.B / 2;
  sh.moveTo(-b, -L / 2);
  sh.lineTo(-b, L * 0.2);
  sh.quadraticCurveTo(-b, L * 0.42, 0, L / 2);
  sh.quadraticCurveTo(b, L * 0.42, b, L * 0.2);
  sh.lineTo(b, -L / 2);
  sh.closePath();
  const hull = new THREE.ExtrudeGeometry(sh, { depth: 11, bevelEnabled: false });
  hull.rotateX(-Math.PI / 2);
  hull.translate(0, -FRIGATE.draft, 0);
  g.add(new THREE.Mesh(hull, grey));
  const sup = new THREE.Mesh(new THREE.BoxGeometry(12, 9, 40), grey);
  sup.position.set(0, 10, -2);
  const mast = new THREE.Mesh(new THREE.BoxGeometry(4, 12, 4), grey);
  mast.position.set(0, 20, -12);
  g.add(sup, mast);
  return g;
}

// ------------------------------------------------------------------ estado visual por objeto

interface RunVis {
  m: MissileModel;
  bubbles: Bubbles;
  acc: number;
  smokeAcc: number;
  sprayAcc: number;
  breach: boolean;
  nose: boolean;
  sep: boolean;
  splash: boolean;
  end: boolean;
  noseSplash: boolean;
  /** ângulo do nariz girando (visual) */
  spin: number;
  withModel: boolean;
}

interface HostVis {
  root: THREE.Group;
  model: THREE.Group;
  radar: THREE.Object3D | null;
  withModel: boolean;
  acc: number;
  fireAcc: number;
  light: THREE.PointLight;
  type: Hostile['type'];
  wreck: boolean;
}

interface BoomVis {
  ball: THREE.Sprite;
  flash: THREE.PointLight;
  ring: THREE.Mesh;
  done: boolean;
}

const C = {
  smokeW: new THREE.Color(0.93, 0.93, 0.92),
  smokeG: new THREE.Color(0.62, 0.62, 0.6),
  smokeD: new THREE.Color(0.12, 0.11, 0.1),
  smokeD2: new THREE.Color(0.32, 0.3, 0.29),
  fire: new THREE.Color(1, 0.62, 0.22),
  fireR: new THREE.Color(0.7, 0.12, 0.02),
  spray: new THREE.Color(0.94, 0.97, 1),
  foam: new THREE.Color(0.86, 0.91, 0.94),
  hot: new THREE.Color(1, 0.95, 0.75),
};

export interface MissileFocus {
  id: string;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  phase: MissileRun['phase'];
  tPhase: number;
  speed: number;
  n: number;
  e: number;
  alt: number;
  /** alvo na cena (fragata, submarino ou alvo em terra) e o ponto de busca */
  target: THREE.Vector3 | null;
  aim: THREE.Vector3 | null;
  /** cápsula (posição na cena) e instante do rompimento */
  capsule: THREE.Vector3;
  tBreach: number | null;
  tSep: number | null;
  /** o voo terminou (impacto ou queda) */
  ended: boolean;
}

/** Míssil acompanhado pelas vistas: o último lançado ainda em voo (ou o último de todos). */
export function focusMissile(e: SimulationEngine): MissileRun | null {
  const list = e.state.weapons?.missiles ?? [];
  let best: MissileRun | null = null;
  for (const r of list) if (missileActive(r) && (!best || r.tFire >= best.tFire)) best = r;
  return best ?? list[list.length - 1] ?? null;
}

/** Alvo de superfície/terra acompanhado pela vista "Alvo": o do último míssil, senão o último acrescentado. */
export function focusHostile(e: SimulationEngine): Hostile | null {
  const ws = e.state.weapons;
  const list = ws?.hostiles ?? [];
  if (!list.length) return null;
  const ms = [...(ws?.missiles ?? [])].sort((a, b) => b.tFire - a.tFire);
  for (const r of ms) {
    const x = list.find((k) => k.id === r.target || k.id === r.hit?.target);
    if (x) return x;
  }
  return list.filter((k) => k.sunk === null).at(-1) ?? list.at(-1) ?? null;
}

/** posição de um alvo hostil na cena (altura do terreno no alvo em terra; afundamento na fragata) */
export const hostileScenePos = (h: Hostile, pn: number, pe: number) => new THREE.Vector3(h.e - pe, h.type === 'terra' ? h.ground : -h.sink, -(h.n - pn));

/** Pose interpolada do míssil acompanhado (posição na cena e direção de voo) no instante do quadro. */
export function missilePose(e: SimulationEngine, pn: number, pe: number, a: number): { pos: THREE.Vector3; dir: THREE.Vector3; run: MissileRun } | null {
  const r = focusMissile(e);
  if (!r) return null;
  const dir = flightDir(r.heading, r.pitch);
  const pos = nedToScene(r.n, r.e, r.d, pn, pe);
  if (missileActive(r)) pos.addScaledVector(dir, -r.speed * (1 - a) * e.config.settings.dt);
  return { pos, dir, run: r };
}

export class MissileVis {
  readonly group = new THREE.Group();
  focus: MissileFocus | null = null;
  /** tremor de câmera do impacto (0…1) */
  shake = 0;
  private src: THREE.Object3D | null = null;
  private frigateSrc: THREE.Object3D | null = null;
  private runs = new Map<string, RunVis>();
  private hosts = new Map<string, HostVis>();
  private booms = new Map<string, BoomVis>();
  private smoke = new Cloud(2600, false, 1.1);
  private dark = new Cloud(1600, false, 1.0);
  private fire = new Cloud(1100, true, 1.6);
  private spray = new Cloud(1800, false, 1.3);
  private lastOrigin = new THREE.Vector3();
  private wind = new THREE.Vector3(1.5, 0, -0.6);

  constructor(
    private dot: THREE.Texture | null,
    renderer: THREE.WebGLRenderer | null,
  ) {
    this.group.add(this.smoke.points, this.dark.points, this.fire.points, this.spray.points);
    if (renderer) {
      loadSubModel(sm39ModelUrl(), renderer)
        .then((s) => {
          this.src = s;
          this.rebuild();
        })
        .catch(() => undefined);
      loadSubModel(frigateModelUrl(), renderer)
        .then((s) => {
          this.frigateSrc = s;
          for (const h of this.hosts.values()) if (h.type === 'fragata' && !h.withModel) this.useFrigateModel(h);
        })
        .catch(() => undefined);
    }
  }

  /** modelo do SM39 carregado (a cena dos tubos também usa a cápsula) */
  get model(): THREE.Object3D | null {
    return this.src;
  }

  private rebuild(): void {
    for (const [, v] of this.runs) {
      this.group.remove(v.m.capsule, v.m.missile, v.m.nose);
      v.m = buildMissileModel(this.src);
      v.withModel = true;
      v.nose = false;
      this.group.add(v.m.capsule, v.m.missile);
    }
  }

  private useFrigateModel(h: HostVis): void {
    if (!this.frigateSrc) return;
    h.root.remove(h.model);
    const c = this.frigateSrc.clone(true);
    cloneMats(c);
    h.model = c as THREE.Group;
    h.radar = c.getObjectByName('Fragata_Radar') ?? null;
    h.root.add(c);
    h.withModel = true;
  }

  update(
    e: SimulationEngine,
    pn: number,
    pe: number,
    on: boolean,
    step: number,
    camera: THREE.Camera,
    viewH: number,
    surfaceY: (n: number, ee: number) => number,
    labels: Label3D[] | null,
    proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean },
    a = 1,
  ): void {
    const ws = e.state.weapons;
    this.group.visible = on;
    const shift = new THREE.Vector3(pe, 0, -pn).sub(this.lastOrigin);
    this.lastOrigin.set(pe, 0, -pn);
    this.shake = 0;
    if (!on || !ws) {
      this.focus = null;
      return;
    }
    const t = e.state.t;
    const dt = e.config.settings.dt;
    const st = Math.min(step, 0.25);
    this.updateHostiles(e, ws.hostiles ?? [], pn, pe, st, t, surfaceY, labels, proj);
    // ---- mísseis
    const alive = new Set<string>();
    for (const r of ws.missiles ?? []) {
      alive.add(r.id);
      let v = this.runs.get(r.id);
      if (!v) {
        const m = buildMissileModel(this.src);
        v = { m, bubbles: new Bubbles(1400, this.dot, 0.26), acc: 0, smokeAcc: 0, sprayAcc: 0, breach: false, nose: false, sep: false, splash: false, end: false, noseSplash: false, spin: 0, withModel: !!this.src };
        this.group.add(m.capsule, m.missile, v.bubbles.points);
        this.runs.set(r.id, v);
      }
      this.updateRun(e, r, v, pn, pe, st, t, dt, surfaceY, labels, proj, a);
    }
    for (const [id, v] of this.runs)
      if (!alive.has(id)) {
        this.group.remove(v.m.capsule, v.m.missile, v.m.nose, v.bubbles.points);
        v.bubbles.points.geometry.dispose();
        this.runs.delete(id);
      }
    // ---- explosões dos mísseis
    const seen = new Set<string>();
    for (const x of ws.explosions ?? []) {
      if (x.kind !== 'missil') continue;
      seen.add(x.id);
      let b = this.booms.get(x.id);
      const age = t - x.t;
      const p = nedToScene(x.n, x.e, x.d, pn, pe);
      if (!b) {
        // bola de fogo: brilho radial suave (sem borda), que cresce, sobe e escurece
        const ball = glowSprite();
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        ring.rotation.x = -Math.PI / 2;
        const flash = new THREE.PointLight(0xffa040, 0, 2500, 1.4);
        b = { ball, ring, flash, done: false };
        this.group.add(ball, ring, flash);
        this.booms.set(x.id, b);
      }
      if (!b.done && age >= 0 && age < 1.5) {
        b.done = true;
        this.burst(p, x.d < -0.5 ? surfaceY(x.n, x.e) : p.y);
      }
      const on2 = age >= 0 && age < 4;
      b.ball.visible = on2;
      b.ring.visible = age >= 0 && age < 3;
      b.flash.position.copy(p);
      b.flash.intensity = age >= 0 ? 60000 * Math.exp(-age * 3) : 0;
      if (on2) {
        const k = Math.min(1, age / 0.35);
        b.ball.position.copy(p).add(new THREE.Vector3(0, 4 * age, 0));
        b.ball.scale.setScalar(10 + 55 * k);
        const mat = b.ball.material as THREE.SpriteMaterial;
        mat.opacity = Math.max(0, 1 - age / 1.6);
        mat.color.setRGB(1, 0.75 - 0.35 * Math.min(1, age), 0.4 - 0.35 * Math.min(1, age));
      }
      if (b.ring.visible) {
        b.ring.position.set(p.x, Math.max(p.y - 2, surfaceY(x.n, x.e) + 0.2), p.z);
        b.ring.scale.setScalar(4 + 70 * age);
        (b.ring.material as THREE.MeshBasicMaterial).opacity = 0.6 * Math.max(0, 1 - age / 3);
      }
      if (age >= 0 && age < 3) {
        const dist = camera.position.distanceTo(p);
        this.shake = Math.max(this.shake, Math.max(0, 1 - age / 3) * Math.min(1, 500 / Math.max(40, dist)));
      }
      if (labels && age >= 0 && age < 10) {
        const pp = proj(p.clone().add(new THREE.Vector3(0, 30, 0)));
        labels.push({ id: 'mexp_' + x.id, text: '💥 IMPACTO', sub: `míssil ${x.id}`, color: '#ffb347', small: true, prio: 0, x: pp.x, y: pp.y, visible: pp.visible });
      }
    }
    for (const [id, b] of this.booms)
      if (!seen.has(id)) {
        this.group.remove(b.ball, b.ring, b.flash);
        b.ring.geometry.dispose();
        this.booms.delete(id);
      }
    for (const c of [this.smoke, this.dark, this.fire, this.spray]) c.step(st, shift, viewH, this.wind);
    // ---- foco das câmeras
    const fr = focusMissile(e);
    if (fr) {
      const v = this.runs.get(fr.id);
      const pos = v ? (fr.phase === 'capsula' || fr.phase === 'superficie' ? v.m.capsule.position.clone() : v.m.missile.position.clone()) : nedToScene(fr.n, fr.e, fr.d, pn, pe);
      const tgtH = fr.target ? ws.hostiles?.find((k) => k.id === fr.target) : undefined;
      const tgtE = fr.target ? ws.enemies?.find((k) => k.id === fr.target) : undefined;
      const target = tgtH ? hostileScenePos(tgtH, pn, pe) : tgtE ? nedToScene(tgtE.n, tgtE.e, 0, pn, pe) : fr.tgt ? nedToScene(fr.tgt.n, fr.tgt.e, -fr.tgt.alt, pn, pe) : null;
      this.focus = {
        id: fr.id,
        pos,
        dir: flightDir(fr.heading, fr.pitch),
        phase: fr.phase,
        tPhase: fr.tPhase,
        speed: fr.speed,
        n: fr.n,
        e: fr.e,
        alt: -fr.d,
        target,
        aim: fr.aim ? nedToScene(fr.aim.n, fr.aim.e, 0, pn, pe) : null,
        capsule: nedToScene(fr.vsm.n, fr.vsm.e, fr.vsm.d, pn, pe),
        tBreach: fr.vsm.tBreach,
        tSep: fr.vsm.tSep,
        ended: !missileActive(fr),
      };
    } else this.focus = null;
  }

  /** bola de fogo, estilhaços, fumaça preta e borrifo no impacto */
  private burst(p: THREE.Vector3, surf: number): void {
    const r = () => this.fire.rnd();
    for (let i = 0; i < 260; i++) {
      const v = new THREE.Vector3(r(), r() + 0.35, r()).normalize().multiplyScalar(12 + 40 * (r() + 0.5));
      this.fire.emit({ pos: p, vel: v, spread: 3, life: 1.1, size0: 7, size1: 14, c0: C.hot, c1: C.fireR, alpha: 0.95, drag: 2.2, rise: 3 });
    }
    for (let i = 0; i < 160; i++) {
      const v = new THREE.Vector3(r(), r() * 0.6 + 0.6, r()).multiplyScalar(18);
      this.dark.emit({ pos: p, vel: v, spread: 6, life: 30, size0: 10, size1: 48, c0: C.smokeD, c1: C.smokeD2, alpha: 0.85, drag: 0.6, rise: 0.9, floor: surf + 2 });
    }
    // estilhaços incandescentes (caem)
    for (let i = 0; i < 120; i++) {
      const v = new THREE.Vector3(r(), r() + 0.5, r()).normalize().multiplyScalar(30 + 50 * (r() + 0.5));
      this.fire.emit({ pos: p, vel: v, life: 2.5, size0: 1.2, size1: 0.6, c0: C.hot, c1: C.fire, alpha: 1, drag: 0.3, rise: -9.8, floor: surf });
    }
    // água levantada
    if (p.y - surf < 25)
      for (let i = 0; i < 160; i++) {
        const a = (i / 160) * Math.PI * 2;
        const v = new THREE.Vector3(Math.cos(a) * 9, 22 + 18 * (r() + 0.5), Math.sin(a) * 9);
        this.spray.emit({ pos: new THREE.Vector3(p.x, surf + 0.5, p.z), vel: v, spread: 8, life: 4, size0: 4, size1: 9, c0: C.spray, alpha: 0.8, drag: 0.2, rise: -9.8, floor: surf });
      }
  }

  private updateRun(
    e: SimulationEngine,
    r: MissileRun,
    v: RunVis,
    pn: number,
    pe: number,
    st: number,
    t: number,
    dt: number,
    surfaceY: (n: number, ee: number) => number,
    labels: Label3D[] | null,
    proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean },
    a: number,
  ): void {
    const M = e.vessel.weapons?.missile;
    const c = r.vsm;
    const active = missileActive(r);
    const inCapsule = c.tSep === null;
    // ---- cápsula
    const capPos = nedToScene(c.n, c.e, c.d, pn, pe);
    const capDir = flightDir(c.heading, c.pitch);
    const capActive = c.tSplash === null || c.d < 35;
    // pose interpolada no passo (a: fração do passo já decorrida)
    if (c.tSplash === null) capPos.addScaledVector(capDir, -c.speed * (1 - a) * dt);
    const cap = v.m.capsule;
    cap.visible = capActive;
    cap.position.copy(capPos);
    cap.rotation.set(0, 0, 0);
    cap.rotateY(-c.heading * DEG);
    cap.rotateX(c.pitch * DEG + (c.tSplash !== null ? 0 : 0));
    const surf = surfaceY(c.n, c.e);
    // motor da cápsula: na água bolhas; no ar chama e fumaça (até a separação)
    const motorOn = r.phase === 'capsula' ? t - r.tFire >= (M?.vsm.ignition ?? 1.5) : r.phase === 'superficie';
    v.m.capFlame.visible = motorOn && capPos.y > surf;
    v.m.capFlame.scale.set(1, 1, 0.8 + 0.4 * Math.random());
    if (st > 0 && motorOn) {
      const tail = capPos.clone().addScaledVector(capDir, -3.1);
      if (capPos.y < surf) {
        v.acc += st * 260;
        while (v.acc >= 1) {
          v.acc -= 1;
          v.bubbles.emit(tail, 0.35, 1.2, 5 + Math.random() * 4, capDir.clone().multiplyScalar(-3));
        }
      } else {
        v.smokeAcc += st * 60;
        while (v.smokeAcc >= 1) {
          v.smokeAcc -= 1;
          this.smoke.emit({ pos: tail, vel: capDir.clone().multiplyScalar(-6), spread: 0.4, life: 7, size0: 1.2, size1: 7, c0: C.smokeW, c1: C.smokeG, alpha: 0.7, drag: 1.2, rise: 0.5, floor: surf });
        }
      }
    } else if (st > 0 && r.phase === 'capsula' && capPos.y < surf) {
      // antes da ignição: bolhas do ar da ejeção
      v.acc += st * 20;
      while (v.acc >= 1) {
        v.acc -= 1;
        v.bubbles.emit(capPos, 0.6, 1.0, 5, undefined);
      }
    }
    v.bubbles.step(st, new THREE.Vector3(), Math.min(0, surf));
    // rompimento da superfície: coluna de borrifo e anel de espuma
    if (c.tBreach !== null && !v.breach) {
      v.breach = true;
      const at = new THREE.Vector3(capPos.x, surf, capPos.z);
      // gotas: coluna que acompanha a cápsula e cai de volta
      for (let i = 0; i < 260; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.random();
        const vel = capDir
          .clone()
          .multiplyScalar(4 + 12 * Math.random())
          .add(new THREE.Vector3(Math.cos(a) * 3.5 * rr, 3 + 9 * Math.random(), Math.sin(a) * 3.5 * rr));
        this.spray.emit({ pos: at, vel, spread: 0.6, life: 2.6, size0: 0.35, size1: 0.6, c0: C.spray, alpha: 0.95, drag: 0.25, rise: -9.8, floor: surf });
      }
      // névoa leve e anel de espuma
      for (let i = 0; i < 18; i++)
        this.spray.emit({
          pos: at,
          vel: capDir
            .clone()
            .multiplyScalar(3)
            .add(new THREE.Vector3(this.spray.rnd() * 3, 2 + 2 * Math.random(), this.spray.rnd() * 3)),
          spread: 1.5,
          life: 3.5,
          size0: 1.5,
          size1: 5,
          c0: C.spray,
          alpha: 0.28,
          drag: 1.2,
          floor: surf,
        });
      for (let i = 0; i < 70; i++) {
        const a = (i / 70) * Math.PI * 2;
        this.spray.emit({ pos: at, vel: new THREE.Vector3(Math.cos(a) * 3, 0.1, Math.sin(a) * 3), spread: 0.6, life: 16, size0: 1.2, size1: 4, c0: C.foam, alpha: 0.4, drag: 0.6, floor: surf + 0.08 });
      }
    }
    // ---- nariz ejetado: arco balístico girando, cai no mar
    const nose = v.m.nose;
    if (c.tNose !== null && r.nose) {
      if (!v.nose) {
        v.nose = true;
        cap.remove(nose);
        this.group.add(nose);
        nose.userData.owner = r.id;
        for (let i = 0; i < 30; i++)
          this.smoke.emit({
            pos: capPos.clone().addScaledVector(capDir, 2.6),
            vel: new THREE.Vector3(this.smoke.rnd() * 6, 2, this.smoke.rnd() * 6),
            spread: 0.5,
            life: 3,
            size0: 0.8,
            size1: 3.5,
            c0: C.smokeW,
            alpha: 0.6,
            drag: 1.5,
          });
      }
      const age = t - c.tNose;
      const h = r.nose.heading * DEG;
      const fwd = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h));
      const side = new THREE.Vector3(Math.cos(h), 0, Math.sin(h));
      const p0 = nedToScene(r.nose.n, r.nose.e, r.nose.d, pn, pe).addScaledVector(fwd, 2.4);
      const y = p0.y + 9 * age - 4.9 * age * age;
      const ns = surfaceY(r.nose.n, r.nose.e);
      const landed = y <= ns;
      const ta = landed ? (9 + Math.sqrt(81 + 19.6 * (p0.y - ns))) / 9.8 : age;
      const p = p0
        .clone()
        .addScaledVector(fwd, 5 * ta)
        .addScaledVector(side, 4 * ta);
      p.y = landed ? ns - Math.min(1.5, (age - ta) * 0.3) : y;
      nose.position.copy(p);
      if (!landed) v.spin = age * 7;
      nose.rotation.set(0, 0, 0);
      nose.rotateY(-h);
      nose.rotateX(-v.spin);
      nose.rotateZ(v.spin * 0.4);
      nose.visible = age < 40;
      if (landed && !v.noseSplash) {
        v.noseSplash = true;
        for (let i = 0; i < 50; i++)
          this.spray.emit({
            pos: p,
            vel: new THREE.Vector3(this.spray.rnd() * 5, 4 + 4 * Math.random(), this.spray.rnd() * 5),
            spread: 0.5,
            life: 2,
            size0: 0.8,
            size1: 2.2,
            c0: C.spray,
            alpha: 0.8,
            rise: -9.8,
            floor: ns,
          });
      }
    }
    // cápsula caindo no mar
    if (c.tSplash !== null && !v.splash) {
      v.splash = true;
      for (let i = 0; i < 120; i++)
        this.spray.emit({
          pos: new THREE.Vector3(capPos.x, surf, capPos.z),
          vel: new THREE.Vector3(this.spray.rnd() * 8, 6 + 8 * Math.random(), this.spray.rnd() * 8),
          spread: 1,
          life: 3,
          size0: 1.2,
          size1: 3.5,
          c0: C.spray,
          alpha: 0.85,
          rise: -9.8,
          floor: surf,
        });
    }
    // ---- míssil
    const mis = v.m.missile;
    const dir = flightDir(r.heading, r.pitch);
    const pos = nedToScene(r.n, r.e, r.d, pn, pe);
    if (active && !inCapsule) pos.addScaledVector(dir, -r.speed * (1 - a) * dt);
    mis.visible = r.phase !== 'impacto' && !(r.phase === 'perdido' && r.d >= -0.5 && t - r.tPhase > 1.5);
    if (inCapsule) {
      // dentro da cápsula (mesma pose)
      mis.position.copy(capPos);
      mis.rotation.copy(cap.rotation);
      mis.visible = r.phase !== 'capsula' || capPos.y > -40;
    } else {
      mis.position.copy(pos);
      mis.rotation.set(0, 0, 0);
      mis.rotateY(-r.heading * DEG);
      mis.rotateX(r.pitch * DEG);
      // rolagem leve nas curvas
      mis.rotateZ(0);
    }
    // asas: recolhidas até a separação; abrem em 0,5 s logo depois
    const open = c.tSep === null ? 0 : Math.max(0, Math.min(1, (t - c.tSep - 0.15) / 0.5));
    for (const mm of v.m.morph) if (mm.morphTargetInfluences) mm.morphTargetInfluences[0] = 1 - open;
    if (c.tSep !== null && !v.sep) {
      v.sep = true;
      for (let i = 0; i < 40; i++)
        this.smoke.emit({
          pos: capPos.clone().addScaledVector(capDir, 2.8),
          vel: capDir
            .clone()
            .multiplyScalar(4)
            .add(new THREE.Vector3(this.smoke.rnd() * 4, 1, this.smoke.rnd() * 4)),
          spread: 0.6,
          life: 4,
          size0: 1,
          size1: 4,
          c0: C.smokeW,
          alpha: 0.6,
          drag: 1.4,
        });
    }
    // chama, clarão e fumaça
    const booster = r.phase === 'acelerador';
    const sustain = r.phase === 'cruzeiro' || r.phase === 'busca' || r.phase === 'terminal' || r.phase === 'subida' || r.phase === 'mergulho' || r.phase === 'passagem';
    const fl = v.m.flame;
    fl.visible = (booster || sustain) && mis.visible;
    v.m.glow.visible = fl.visible;
    if (fl.visible) {
      const k = booster ? 1.6 : 0.55;
      fl.scale.set(k * (0.9 + 0.2 * Math.random()), k * (0.9 + 0.2 * Math.random()), k * (0.8 + 0.5 * Math.random()));
      (fl.material as THREE.MeshBasicMaterial).color.setHex(booster ? 0xffc070 : 0xff9a4a);
      v.m.glow.scale.setScalar(booster ? 5 + 2 * Math.random() : 1.3 + 0.4 * Math.random());
    }
    const ms = surfaceY(r.n, r.e);
    if (st > 0 && (booster || sustain) && mis.visible) {
      const tail = pos.clone().addScaledVector(dir, -2.6);
      const rate = booster ? 160 : 70;
      v.smokeAcc += st * rate;
      const back = dir.clone().multiplyScalar(-(booster ? 25 : 12));
      // as partículas saem ao longo do trecho percorrido no quadro (sem buracos no rastro a 300 m/s)
      const n = Math.floor(v.smokeAcc);
      v.smokeAcc -= n;
      for (let i = 0; i < n; i++) {
        const along = tail.clone().addScaledVector(dir, -r.speed * st * (i / Math.max(1, n)));
        if (booster) this.smoke.emit({ pos: along, vel: back, spread: 0.8, life: 22, size0: 2.2, size1: 16, c0: C.smokeW, c1: C.smokeG, alpha: 0.75, drag: 1.6, rise: 0.25, floor: ms + 0.5 });
        else this.smoke.emit({ pos: along, vel: back, spread: 0.2, life: 10, size0: 0.6, size1: 4.5, c0: C.smokeW, c1: C.smokeG, alpha: 0.45, drag: 2, rise: 0.15, floor: ms + 0.5 });
      }
      if (booster) for (let i = 0; i < 3; i++) this.fire.emit({ pos: tail, vel: back.clone().multiplyScalar(2), spread: 0.4, life: 0.25, size0: 2.4, size1: 3.6, c0: C.hot, c1: C.fire, alpha: 0.9, drag: 4 });
      // rente ao mar: névoa levantada pela passagem
      const alt = -r.d - ms;
      if (alt < 7 && r.speed > 100) {
        v.sprayAcc += st * 90 * (1 - alt / 7);
        while (v.sprayAcc >= 1) {
          v.sprayAcc -= 1;
          const p = pos.clone().addScaledVector(dir, -4 - 30 * Math.random());
          p.y = ms + 0.3;
          this.spray.emit({
            pos: p,
            vel: new THREE.Vector3(this.spray.rnd() * 3, 1.5 + Math.random() * 2, this.spray.rnd() * 3),
            spread: 1.5,
            life: 2.5,
            size0: 1.5,
            size1: 6,
            c0: C.spray,
            alpha: 0.35,
            drag: 1,
            rise: -2,
            floor: ms,
          });
        }
      }
    }
    // queda no mar: borrifo
    if (r.phase === 'perdido' && !v.end) {
      v.end = true;
      if (r.d >= -0.6)
        for (let i = 0; i < 140; i++)
          this.spray.emit({
            pos: new THREE.Vector3(pos.x, ms, pos.z),
            vel: dir
              .clone()
              .multiplyScalar(10)
              .add(new THREE.Vector3(this.spray.rnd() * 9, 8 + 12 * Math.random(), this.spray.rnd() * 9)),
            spread: 1.5,
            life: 3,
            size0: 1.6,
            size1: 4,
            c0: C.spray,
            alpha: 0.85,
            rise: -9.8,
            floor: ms,
          });
    }
    if (labels && (mis.visible || cap.visible) && active) {
      const lp = inCapsule ? capPos : pos;
      const pp = proj(lp.clone().add(new THREE.Vector3(0, 3, 0)));
      const alt = -r.d;
      const rng = r.tgt ? ` · alvo ${(r.tgt.range / 1000).toFixed(1)} km` : '';
      labels.push({
        id: 'msl_' + r.id,
        text: `Míssil ${r.id}`,
        sub: `${PHASE_TXT[r.phase]} · ${alt >= 0 ? `${alt.toFixed(0)} m alt` : `${(-alt).toFixed(0)} m prof`} · ${Math.round(r.speed * 3.6)} km/h${rng}`,
        color: r.presets.warhead === 'combate' ? '#ff6b5a' : '#ffd166',
        small: true,
        prio: 1,
        x: pp.x,
        y: pp.y,
        visible: pp.visible,
      });
    }
  }

  private updateHostiles(
    e: SimulationEngine,
    list: Hostile[],
    pn: number,
    pe: number,
    st: number,
    t: number,
    surfaceY: (n: number, ee: number) => number,
    labels: Label3D[] | null,
    proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean },
  ): void {
    const alive = new Set<string>();
    for (const h of list) {
      alive.add(h.id);
      let v = this.hosts.get(h.id);
      if (!v) {
        const root = new THREE.Group();
        const model = h.type === 'terra' ? buildLandSite() : frigateFallback();
        root.add(model);
        const light = new THREE.PointLight(0xff7a2a, 0, 400, 1.6);
        root.add(light);
        v = { root, model, radar: null, withModel: false, acc: 0, fireAcc: 0, light, type: h.type, wreck: false };
        this.group.add(root);
        this.hosts.set(h.id, v);
        if (h.type === 'fragata' && this.frigateSrc) this.useFrigateModel(v);
      }
      const surf = h.type === 'terra' ? h.ground : surfaceY(h.n, h.e);
      const pos = new THREE.Vector3(h.e - pe, surf - (h.type === 'terra' ? 0 : h.sink), -(h.n - pn));
      const root = v.root;
      root.position.copy(pos);
      root.rotation.set(0, 0, 0);
      root.rotateY(-h.course * DEG);
      if (h.type === 'fragata') {
        // jogo no mar, banda e (afundando) proa embicada
        const bob = Math.sin(t * 0.7 + h.n * 0.01) * 0.6;
        root.rotateZ(h.list * DEG + bob * DEG);
        root.rotateX((h.sunk !== null ? -Math.min(12, (t - h.sunk) * 0.05) : Math.sin(t * 0.5) * 0.4) * DEG);
        if (v.radar) v.radar.rotation.y += st * 2.4;
        root.visible = h.sink < 40;
        // esteira
        if (st > 0 && h.speed > 0.5) {
          v.acc += st * Math.min(40, h.speed * 3);
          const fwd = new THREE.Vector3(Math.sin(h.course * DEG), 0, -Math.cos(h.course * DEG));
          const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
          while (v.acc >= 1) {
            v.acc -= 1;
            const at = pos
              .clone()
              .addScaledVector(fwd, -FRIGATE.L / 2 + 2)
              .addScaledVector(side, this.spray.rnd() * 8);
            at.y = surf + 0.15;
            this.spray.emit({ pos: at, vel: fwd.clone().multiplyScalar(-h.speed * 0.3), spread: 2, life: 26, size0: 3, size1: 10, c0: C.foam, alpha: 0.35, drag: 0.4, floor: surf + 0.1 });
            if (this.spray.rnd() > 0.3) {
              const bow = pos
                .clone()
                .addScaledVector(fwd, FRIGATE.L / 2 - 6)
                .addScaledVector(side, Math.sign(this.spray.rnd()) * FRIGATE.B * 0.45);
              bow.y = surf + 0.3;
              this.spray.emit({ pos: bow, vel: side.clone().multiplyScalar(Math.sign(bow.clone().sub(pos).dot(side)) * 1.5), spread: 1.5, life: 12, size0: 2, size1: 7, c0: C.foam, alpha: 0.3, floor: surf + 0.1 });
            }
          }
        }
      } else if (h.sunk !== null && !v.wreck) {
        // alvo em terra destruído: escombros
        v.wreck = true;
        v.model.scale.set(1, 0.3, 1);
        v.model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.material = (m.material as THREE.MeshStandardMaterial).clone();
            (m.material as THREE.MeshStandardMaterial).color.multiplyScalar(0.25);
          }
        });
      }
      // incêndio e fumaça nos pontos de impacto
      const burning = h.tHit !== null && (h.type === 'terra' || h.sink < 14);
      v.light.intensity = burning ? 2500 * (0.7 + 0.3 * Math.sin(t * 13) * Math.sin(t * 7.3)) : 0;
      if (burning && st > 0) {
        root.updateMatrixWorld();
        const age = t - h.tHit!;
        const fade = Math.max(0.35, Math.exp(-age / 600));
        v.fireAcc += st * 70 * fade;
        let k = 0;
        while (v.fireAcc >= 1) {
          v.fireAcc -= 1;
          const imp = h.impacts[k++ % Math.max(1, h.impacts.length)] ?? { x: 0, y: 0, z: 4 };
          // casco: x à vante (−z local), y a boreste (+x local), z altura
          const local = new THREE.Vector3(imp.y * 0.85, Math.max(1.5, Math.min(14, imp.z)), -imp.x);
          const wp = root.localToWorld(local);
          v.light.position.copy(local).add(new THREE.Vector3(0, 4, 0));
          this.fire.emit({
            pos: wp,
            vel: new THREE.Vector3(this.fire.rnd() * 2, 5 + 4 * Math.random(), this.fire.rnd() * 2),
            spread: 3,
            life: 1.1,
            size0: 4,
            size1: 7,
            c0: C.fire,
            c1: C.fireR,
            alpha: 0.85,
            drag: 0.8,
            rise: 2,
          });
          if (this.fire.rnd() > -0.1)
            this.dark.emit({
              pos: wp.clone().add(new THREE.Vector3(0, 4, 0)),
              vel: new THREE.Vector3(this.dark.rnd() * 2, 6 + 3 * Math.random(), this.dark.rnd() * 2),
              spread: 2,
              life: 40,
              size0: 6,
              size1: 40,
              c0: C.smokeD,
              c1: C.smokeD2,
              alpha: 0.75,
              drag: 0.15,
              rise: 0.2,
            });
        }
      }
      if (labels) {
        const pp = proj(pos.clone().add(new THREE.Vector3(0, h.type === 'terra' ? 30 : 34, 0)));
        const own = e.state.body.pos;
        const rng = Math.hypot(h.n - own.x, h.e - own.y);
        const what =
          h.type === 'terra'
            ? h.sunk !== null
              ? 'DESTRUÍDO'
              : `${(rng / 1000).toFixed(1)} km · ${h.ground.toFixed(0)} m de altitude`
            : h.sunk !== null
              ? 'PERDIDA — afundando'
              : h.tHit !== null
                ? `EM CHAMAS · ${(h.speed / 0.5144).toFixed(0)} nós`
                : `${(rng / 1000).toFixed(1)} km · ${(h.speed / 0.5144).toFixed(0)} nós${h.evading ? ' · MANOBRA EVASIVA' : ''}`;
        labels.push({
          id: 'hst_' + h.id,
          text: h.name.replace(' (classe Tamandaré, alvo fictício)', ' (classe Tamandaré)'),
          sub: what,
          color: h.sunk !== null ? '#ff8a80' : '#ff5257',
          small: true,
          prio: 1,
          x: pp.x,
          y: pp.y,
          visible: pp.visible,
        });
      }
    }
    for (const [id, v] of this.hosts)
      if (!alive.has(id)) {
        this.group.remove(v.root);
        this.hosts.delete(id);
      }
  }
}
