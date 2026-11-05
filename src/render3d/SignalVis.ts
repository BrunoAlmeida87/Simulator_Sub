/**
 * SINALIZAÇÃO PIROTÉCNICA E DE EMERGÊNCIA NA CENA 3D (só lê state.signals; nada aqui altera a física).
 *
 * Modelos: biblioteca "Submarine Signalling 3D" (public/models/sinalizacao/, gerada no Blender e otimizada por
 * scripts/sinalizacao/otimizar.mjs). Cada arquivo é carregado uma vez (cache), só quando o dispositivo/cor aparece
 * ou é selecionado na tela; cada dispositivo ganha um clone (geometria compartilhada, materiais emissivos próprios).
 *  - subida: cilindro underwater_signal_<cor> (combinado: neutral) ou a boia; bolhas saem de SIGNAL_TRAIL_ORIGIN;
 *  - superfície: floating_light_signal_<cor> (sinais de cor), floating_smoke_signal_<cor>, combined_signal,
 *    emergency_buoy; WATERLINE_REFERENCE / BUOY_WATERLINE no nível local da onda, inclinação pela declividade da onda;
 *  - estrela: star_flare_<cor> sob o parachute.glb (PARACHUTE_SUSPENSION_POINT preso à estrela);
 *  - lançador: submarine_release_visual.glb no dorso do casco, com SIGNAL_RELEASE_ORIGIN no ponto de saída da física;
 *    o mesmo desenho marca o alojamento da boia.
 * Clipes (documentation/animations.md): um clipe de estado por nó emissivo (OFF/LOW_INTENSITY/ACTIVE/FADING;
 * INACTIVE, LIGHT_ACTIVE, SMOKE_ACTIVE, LIGHT_SMOKE_ACTIVE, ENDED; FLARE_GLOW/FLARE_FADE; BUOY_FLOAT + BUOY_LIGHT_FLASH/OFF; PARACHUTE_OPEN + SWAY).
 * O simulador controla posição, flutuação, intensidade da luz (emissiveIntensity, halo, luz real) e as partículas
 * (sprites da biblioteca: fumaça, bolhas, brilho, respingo, anel e espuma). Os mixers andam com o tempo de
 * simulação (param na pausa e seguem a aceleração).
 */
import * as THREE from 'three';
import type { SimulationEngine } from '../sim/core/engine';
import type { SignalColor, SignalKind } from '../sim/config/types';
import type { SignalRun } from '../sim/core/state';
import { SIGNAL_INFO, releasePoint, signalLabel, signalLight, signalSmoke, signalsCfg } from '../sim/systems/signals';
import { windOf } from '../sim/environment/wind';
import type { SceneLayers } from './layers';
import type { Label3D } from './SubmarineScene';

const base = () => (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';
export const signalModelUrl = (file: string) => `${base()}models/sinalizacao/${file}`;
export const signalTexUrl = (file: string) => `${base()}textures/sinalizacao/${file}`;

const EN: Record<SignalColor, string> = { vermelho: 'red', amarelo: 'yellow', verde: 'green', branco: 'white', laranja: 'orange' };
/** cor de exibição (luz, fumaça, halo) de cada cor de dispositivo */
export const SIGNAL_RGB: Record<SignalColor, number> = { vermelho: 0xff3b2e, amarelo: 0xffd23a, verde: 0x34e06a, branco: 0xf4f6ff, laranja: 0xff7a1a };
const SMOKE_RGB: Record<SignalColor, number> = { vermelho: 0xc8402e, amarelo: 0xe8c84a, verde: 0x4fa860, branco: 0xe4e6ea, laranja: 0xf07a2a };

export const RELEASE_FILE = 'submarine_release_visual.glb';
export const PARACHUTE_FILE = 'parachute.glb';
export const PANEL_FILE = 'control_panel.glb';

/** modelo usado na subida (cilindro da cor ou a boia) */
export function ascentFile(kind: SignalKind, color: SignalColor): string {
  if (kind === 'boia') return 'emergency_buoy.glb';
  if (kind === 'combinado') return 'underwater_signal_neutral.glb';
  return `underwater_signal_${EN[color]}.glb`;
}

/** modelo na superfície: flutuador de luz/fumaça, combinado, boia; a estrela deixa o cilindro gasto flutuando */
export function surfaceFile(kind: SignalKind, color: SignalColor): string {
  const eff = SIGNAL_INFO[kind].effect;
  if (eff === 'luz') return `floating_light_signal_${EN[color === 'laranja' ? 'branco' : color]}.glb`;
  if (eff === 'fumaca') return `floating_smoke_signal_${EN[color]}.glb`;
  if (eff === 'combinado') return 'combined_signal.glb';
  if (eff === 'boia') return 'emergency_buoy.glb';
  return ascentFile(kind, color);
}

/** estrela da cor */
export const flareFile = (color: SignalColor) => `star_flare_${EN[color === 'laranja' ? 'branco' : color]}.glb`;

/** todos os arquivos de um dispositivo (para pré-carregar ao selecionar) */
export function deviceFiles(kind: SignalKind, color: SignalColor): string[] {
  const f = [ascentFile(kind, color), surfaceFile(kind, color)];
  if (SIGNAL_INFO[kind].effect === 'estrela') f.push(flareFile(color), PARACHUTE_FILE);
  return [...new Set(f)];
}

// ------------------------------------------------------------------ carregamento (cache)

export interface SignalAsset {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}
const cache = new Map<string, Promise<SignalAsset>>();
const ready = new Map<string, SignalAsset>();
const failed = new Set<string>();

/** Carrega (uma vez) um GLB da biblioteca. Falha não fica em cache: outra tentativa busca de novo. */
export function loadSignalAsset(file: string): Promise<SignalAsset> {
  let p = cache.get(file);
  if (!p) {
    p = (async () => {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(signalModelUrl(file));
      const a = { scene: gltf.scene, clips: gltf.animations };
      a.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = false;
        }
      });
      ready.set(file, a);
      failed.delete(file);
      return a;
    })();
    p.catch((err) => {
      cache.delete(file);
      failed.add(file);
      console.warn(`Sinalização: modelo ${file} não carregou`, err);
    });
    cache.set(file, p);
  }
  return p;
}

/** Pré-carrega os modelos de um dispositivo (seleção na tela). */
export function preloadSignal(kind: SignalKind, color: SignalColor): void {
  for (const f of deviceFiles(kind, color)) loadSignalAsset(f).catch(() => undefined);
}

/** modelos que falharam ao carregar (a tela informa) */
export const signalLoadFailures = () => [...failed];

const asset = (file: string): SignalAsset | null => {
  const a = ready.get(file);
  if (!a && !failed.has(file)) loadSignalAsset(file).catch(() => undefined);
  return a ?? null;
};

// ------------------------------------------------------------------ texturas dos efeitos

const texCache = new Map<string, THREE.Texture>();
function tex(file: string): THREE.Texture {
  let t = texCache.get(file);
  if (!t) {
    t = new THREE.TextureLoader().load(signalTexUrl(file));
    t.colorSpace = THREE.NoColorSpace;
    texCache.set(file, t);
  }
  return t;
}

// ------------------------------------------------------------------ instância de um modelo

const DARK = new THREE.Color(0, 0, 0);

/** Clone de um modelo com o seu mixer e os materiais emissivos próprios (intensidade por instância). */
export class SignalInstance {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer | null;
  private actions = new Map<string, THREE.AnimationAction>();
  private state: string | null = null;
  private emissive: { m: THREE.MeshStandardMaterial; base: number }[] = [];
  private owned: THREE.Material[] = [];
  /** altura local (m) do nó de linha d'água (0 se não houver) */
  readonly waterline: number;
  /** mapa de ambiente aplicado (cena principal: o reflexo do céu do submarino) */
  private envTex: THREE.Texture | null = null;
  private envK = -1;
  /**
   * own: clona todos os materiais (cena principal: recebem o mapa de ambiente dela, sem mexer no modelo em cache);
   * senão só os emissivos (prévia, que usa scene.environment)
   */
  constructor(
    readonly file: string,
    a: SignalAsset,
    own = false,
  ) {
    this.model = a.scene.clone(true);
    this.root.add(this.model);
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const cl = mats.map((m) => {
        const sm = m as THREE.MeshStandardMaterial;
        const glow = !!sm.emissive && !sm.emissive.equals(DARK);
        if (!glow && !own) return m;
        const c = sm.clone();
        this.owned.push(c);
        if (glow) this.emissive.push({ m: c, base: Math.max(1, sm.emissiveIntensity) });
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? cl : cl[0];
    });
    const wl = this.model.getObjectByName('WATERLINE_REFERENCE') ?? this.model.getObjectByName('BUOY_WATERLINE');
    this.waterline = wl ? wl.position.y : 0;
    this.mixer = a.clips.length ? new THREE.AnimationMixer(this.model) : null;
    if (this.mixer) for (const c of a.clips) this.actions.set(c.name, this.mixer.clipAction(c));
  }
  node(name: string): THREE.Object3D | undefined {
    return this.model.getObjectByName(name);
  }
  /** posição no mundo de um nó auxiliar (ou do centro do modelo) */
  worldOf(name: string, out = new THREE.Vector3()): THREE.Vector3 {
    const n = this.node(name);
    if (!n) return this.root.getWorldPosition(out);
    n.updateWorldMatrix(true, false);
    return n.getWorldPosition(out);
  }
  has(clip: string): boolean {
    return this.actions.has(clip);
  }
  /** toca um clipe de estado (um por vez neste grupo); once = uma vez, parado no fim */
  play(clip: string, once = false, fade = 0.3): void {
    if (this.state === clip) return;
    const next = this.actions.get(clip);
    if (!next) return;
    const prev = this.state ? this.actions.get(this.state) : null;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.play();
    if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
    this.state = clip;
  }
  /** clipe independente (outro nó): toca junto com o clipe de estado */
  playAlso(clip: string, once = false): void {
    const a = this.actions.get(clip);
    if (!a || a.isRunning() || (once && a.time > 0)) return;
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.play();
  }
  stopAlso(clip: string): void {
    this.actions.get(clip)?.stop();
  }
  /** reflexo do ambiente nos materiais próprios (PBR metálico fica preto sem ele) */
  setEnv(tex: THREE.Texture | null, k: number): void {
    if (tex === this.envTex && Math.abs(k - this.envK) < 0.005) return;
    for (const m of this.owned) {
      const sm = m as THREE.MeshStandardMaterial;
      if (!sm.isMeshStandardMaterial) continue;
      if (!!sm.envMap !== !!tex) sm.needsUpdate = true;
      sm.envMap = tex;
      sm.envMapIntensity = k;
    }
    this.envTex = tex;
    this.envK = k;
  }
  /** emissão dos materiais emissivos: 0 = apagado … 1 = intensidade do arquivo × k */
  setEmission(level: number, k = 1): void {
    for (const e of this.emissive) e.m.emissiveIntensity = e.base * level * k;
  }
  update(dt: number): void {
    if (this.mixer && dt > 0) this.mixer.update(dt);
  }
  dispose(): void {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.model);
    }
    this.root.removeFromParent();
    // só os materiais próprios: geometria e texturas são do modelo em cache (compartilhadas)
    for (const m of this.owned) m.dispose();
  }
}

// ------------------------------------------------------------------ partículas com os sprites da biblioteca

const VERT = `
attribute float aSize;
attribute vec4 aColor;
attribute float aRot;
varying vec4 vColor;
varying float vRot;
uniform float uViewH;
void main() {
  vColor = aColor;
  vRot = aRot;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * projectionMatrix[1][1] * uViewH * 0.5 / max(0.3, -mv.z), 0.0, 1024.0);
}`;
const FRAG = `
uniform sampler2D map;
varying vec4 vColor;
varying float vRot;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vRot), k = cos(vRot);
  vec2 uv = vec2(k * c.x - s * c.y, s * c.x + k * c.y) + 0.5;
  vec4 tx = texture2D(map, uv);
  float a = vColor.a * tx.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * tx.rgb, a);
}`;

interface Emit {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  size0: number;
  size1: number;
  color: THREE.Color;
  alpha: number;
  /** arrasto (1/s) e empuxo/subida (m/s²) */
  drag?: number;
  rise?: number;
  /** vento (m/s, cena) aplicado aos poucos */
  wind?: THREE.Vector3;
  /** altura máxima (bolhas estouram na superfície) */
  ceil?: number;
  spin?: number;
}

/** Nuvem de sprites (um desenho por textura): tamanho, cor, opacidade e rotação por partícula. */
export class SpriteCloud {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private rot: Float32Array;
  private vel: Float32Array;
  private wind: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private a0: Float32Array;
  private drag: Float32Array;
  private rise: Float32Array;
  private ceil: Float32Array;
  private spin: Float32Array;
  private head = 0;
  private live = 0;
  readonly mat: THREE.ShaderMaterial;
  constructor(
    private n: number,
    texture: string,
    additive: boolean,
  ) {
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.wind = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1);
    this.life = new Float32Array(n).fill(0);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.a0 = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.rise = new Float32Array(n);
    this.ceil = new Float32Array(n).fill(1e9);
    this.spin = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uViewH: { value: 800 }, map: { value: tex(texture) } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }
  get count(): number {
    return this.live;
  }
  emit(p: Emit): void {
    const i = this.head;
    this.head = (this.head + 1) % this.n;
    this.pos.set([p.pos.x, p.pos.y, p.pos.z], i * 3);
    this.vel.set([p.vel.x, p.vel.y, p.vel.z], i * 3);
    this.wind.set(p.wind ? [p.wind.x, p.wind.y, p.wind.z] : [0, 0, 0], i * 3);
    // o shader escreve a cor direto na tela (sem conversão): a cor vai em sRGB
    const c = tmpC.copy(p.color).convertLinearToSRGB();
    this.col.set([c.r, c.g, c.b, 0], i * 4);
    this.age[i] = 0;
    this.life[i] = p.life;
    this.s0[i] = p.size0;
    this.s1[i] = p.size1;
    this.a0[i] = p.alpha;
    this.drag[i] = p.drag ?? 0;
    this.rise[i] = p.rise ?? 0;
    this.ceil[i] = p.ceil ?? 1e9;
    this.rot[i] = Math.random() * 6.283;
    this.spin[i] = p.spin ?? (Math.random() - 0.5) * 0.6;
  }
  /** avança dt (s de simulação); shift = deslocamento da origem flutuante neste quadro */
  update(dt: number, shift: THREE.Vector3, viewH: number): void {
    this.mat.uniforms.uViewH.value = viewH;
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= this.life[i]) {
        if (this.col[i * 4 + 3] !== 0) this.col[i * 4 + 3] = 0;
        continue;
      }
      live++;
      const j = i * 3;
      this.pos[j] -= shift.x;
      this.pos[j + 2] -= shift.z;
      if (dt > 0) {
        this.age[i] += dt;
        const k = Math.exp(-this.drag[i] * dt);
        this.vel[j] *= k;
        this.vel[j + 1] = this.vel[j + 1] * k + this.rise[i] * dt;
        this.vel[j + 2] *= k;
        if (this.wind[j] !== 0 || this.wind[j + 2] !== 0) {
          // levada pelo vento aos poucos
          const kw = 1 - Math.exp(-0.6 * dt);
          this.vel[j] += (this.wind[j] - this.vel[j]) * kw;
          this.vel[j + 2] += (this.wind[j + 2] - this.vel[j + 2]) * kw;
        }
        this.pos[j] += this.vel[j] * dt;
        this.pos[j + 1] += this.vel[j + 1] * dt;
        this.pos[j + 2] += this.vel[j + 2] * dt;
        this.rot[i] += this.spin[i] * dt;
        if (this.pos[j + 1] > this.ceil[i]) this.age[i] = this.life[i];
      }
      const f = Math.min(1, this.age[i] / this.life[i]);
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(f);
      // aparece rápido e some devagar
      this.col[i * 4 + 3] = this.a0[i] * Math.min(1, f * 8) * (1 - f) * (1 - f * 0.3);
    }
    this.live = live;
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aRot as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose(): void {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

// ------------------------------------------------------------------ desenho de cada dispositivo

interface RunVis {
  asc: SignalInstance | null;
  surf: SignalInstance | null;
  flare: SignalInstance | null;
  chute: SignalInstance | null;
  halo: THREE.Sprite;
  flareHalo: THREE.Sprite;
  foam: THREE.Mesh;
  ring: THREE.Mesh;
  track: THREE.Line;
  bubbleAcc: number;
  smokeAcc: number;
  sparkAcc: number;
  surfaced: boolean;
  ignited: boolean;
  yaw: number;
  /** posição atual na cena (para câmera e luz) */
  pos: THREE.Vector3;
  lightPos: THREE.Vector3;
  light: number;
  color: THREE.Color;
}

/** Pose acompanhada pelas vistas "Sinal", "Boia" e "Superfície (sinais)". */
export interface SignalFocus {
  id: string;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  back: number;
  side: number;
  up: number;
}

const PHASE_TXT: Record<SignalRun['phase'], string> = {
  liberado: 'saindo do lançador',
  subindo: 'subindo',
  superficie: 'na superfície',
  ativo: 'ATIVO',
  extinto: 'extinto',
  falha: 'FALHA',
};

const UP = new THREE.Vector3(0, 1, 0);
const tmpC = new THREE.Color();
const tmpV = new THREE.Vector3();

/** Luz real (PointLight) das sinalizações: poucas, criadas na primeira ativação e depois só reajustadas. */
const LIGHT_POOL = 3;

export class SignalVis {
  /** dispositivos no mar e no ar (cena) */
  readonly group = new THREE.Group();
  /** lançador e alojamento da boia (filho do grupo do casco) */
  readonly local = new THREE.Group();
  /** luzes reais (fora do grupo: esconder o grupo não muda o número de luzes da cena) */
  readonly lights = new THREE.Group();
  private pool: THREE.PointLight[] = [];
  private runs = new Map<string, RunVis>();
  private frames: { launcher: SignalInstance | null; buoy: SignalInstance | null } = { launcher: null, buoy: null };
  private smoke = new SpriteCloud(1400, 'smoke/smoke_dense.png', false);
  private smokeThin = new SpriteCloud(700, 'smoke/smoke_dispersed.png', false);
  private bubbles = new SpriteCloud(900, 'bubbles/bubble_small.png', false);
  private sparks = new SpriteCloud(500, 'glow/light_particle.png', true);
  private drops = new SpriteCloud(300, 'water/water_drops.png', false);
  private lastOrigin = new THREE.Vector3();
  private clock = 0;
  /** dispositivo acompanhado pela vista "Sinal" / "Boia" (atualizado a cada quadro) */
  focus: SignalFocus | null = null;
  buoyFocus: SignalFocus | null = null;
  surfaceFocus: SignalFocus | null = null;
  /** 0 dia … 1 noite (o halo e a luz real crescem à noite) */
  night = 0;
  /** reflexo do céu da cena (o mesmo do submarino) e a sua intensidade */
  env: { tex: THREE.Texture | null; k: number } = { tex: null, k: 1 };
  constructor() {
    this.group.add(this.smoke.points, this.smokeThin.points, this.bubbles.points, this.sparks.points, this.drops.points);
    this.group.name = 'Sinalizacao';
    this.local.name = 'SinalizacaoLancador';
    loadSignalAsset(RELEASE_FILE).catch(() => undefined);
  }

  private ensureLights(): void {
    if (this.pool.length) return;
    for (let i = 0; i < LIGHT_POOL; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 60, 1.6);
      this.pool.push(l);
      this.lights.add(l);
    }
  }

  private newRun(r: SignalRun): RunVis {
    const col = new THREE.Color(SIGNAL_RGB[SIGNAL_INFO[r.kind].effect === 'combinado' || r.kind === 'boia' ? 'branco' : r.color]);
    const haloFile = `glow/halo_${EN[r.color === 'laranja' ? 'branco' : r.color]}.png`;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(haloFile), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    const flareHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow/flash_intense.png'), color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    const plane = (file: string, add: boolean) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: tex(file), transparent: true, depthWrite: false, opacity: 0, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -2 }),
      );
      m.renderOrder = 2;
      return m;
    };
    const track = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.7, depthWrite: false }));
    track.frustumCulled = false;
    const v: RunVis = {
      asc: null,
      surf: null,
      flare: null,
      chute: null,
      halo,
      flareHalo,
      foam: plane('water/surface_foam.png', false),
      ring: plane('water/wave_ring.png', false),
      track,
      bubbleAcc: 0,
      smokeAcc: 0,
      sparkAcc: 0,
      surfaced: r.tSurf !== null,
      ignited: false,
      yaw: Math.random() * 6.283,
      pos: new THREE.Vector3(),
      lightPos: new THREE.Vector3(),
      light: 0,
      color: col,
    };
    this.group.add(halo, flareHalo, v.foam, v.ring, track);
    return v;
  }

  private disposeRun(v: RunVis): void {
    for (const i of [v.asc, v.surf, v.flare, v.chute]) i?.dispose();
    for (const o of [v.halo, v.flareHalo]) {
      o.removeFromParent();
      o.material.dispose();
    }
    for (const m of [v.foam, v.ring]) {
      m.removeFromParent();
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    v.track.removeFromParent();
    v.track.geometry.dispose();
    (v.track.material as THREE.Material).dispose();
  }

  /** instância de um arquivo (criada quando o modelo terminar de carregar) */
  private inst(cur: SignalInstance | null, file: string): SignalInstance | null {
    if (cur && cur.file === file) return cur;
    const a = asset(file);
    if (!a) return cur;
    cur?.dispose();
    const i = new SignalInstance(file, a, true);
    this.group.add(i.root);
    return i;
  }

  /** lançador (e alojamento da boia) no dorso do casco, com SIGNAL_RELEASE_ORIGIN no ponto de saída da física */
  private updateFrames(e: SimulationEngine, on: boolean, scale: number): void {
    const cfg = signalsCfg(e.vessel);
    for (const which of ['launcher', 'buoy'] as const) {
      let f = this.frames[which];
      if (!f) {
        const a = asset(RELEASE_FILE);
        if (!a) continue;
        f = this.frames[which] = new SignalInstance(RELEASE_FILE, a, true);
        // a placa olha para +z local: deitada no dorso, com a face para cima
        f.model.rotation.x = -Math.PI / 2;
        this.local.add(f.root);
      }
      const p = releasePoint(cfg, which === 'buoy' ? 'boia' : 'vermelho', e.geom.radiusAt);
      const o = f.node('SIGNAL_RELEASE_ORIGIN');
      const k = Math.min(scale, 6);
      f.root.scale.setScalar(k);
      // corpo (x à vante, y a boreste, z para baixo) → local do casco (y, −z, −x); o ponto de origem fica na saída
      f.root.position.set(p.y, -p.z - (o ? o.position.z : 0) * k - 0.12, -p.x);
      f.root.visible = on;
      f.setEnv(this.env.tex, this.env.k);
    }
  }

  update(
    e: SimulationEngine,
    layers: SceneLayers,
    pn: number,
    pe: number,
    step: number,
    viewH: number,
    surfaceY: (n: number, ee: number) => number,
    labels: Label3D[] | null,
    proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean },
  ): void {
    const ss = e.state.signals;
    const on = layers.signals !== false;
    const scale = Math.max(1, Math.min(30, layers.signalScale ?? 1));
    const shift = new THREE.Vector3(pe, 0, -pn).sub(this.lastOrigin);
    this.lastOrigin.set(pe, 0, -pn);
    const st = Math.min(step, 0.25);
    this.clock += st;
    this.updateFrames(e, on, scale);
    this.group.visible = true;
    const t = e.state.t;
    const cfg = signalsCfg(e.vessel);
    const w = windOf(e.env.cfg.waves);
    const windS = new THREE.Vector3(w.e, 0, -w.n);
    const alive = new Set<string>();
    const lit: { v: RunVis; k: number }[] = [];
    let focusRun: { r: SignalRun; v: RunVis } | null = null;
    let buoyRun: { r: SignalRun; v: RunVis } | null = null;
    const wantFocus = layers.signalFocus ?? null;
    for (const r of ss?.runs ?? []) {
      alive.add(r.id);
      let v = this.runs.get(r.id);
      if (!v) {
        v = this.newRun(r);
        this.runs.set(r.id, v);
      }
      this.updateRun(r, v, pn, pe, st, t, cfg, layers, on, scale, windS, surfaceY, labels, proj);
      if (v.light > 0.01) lit.push({ v, k: v.light });
      if (r.kind === 'boia') buoyRun = { r, v };
      else if (wantFocus === r.id || (!wantFocus && (!focusRun || r.tRel >= focusRun.r.tRel))) focusRun = { r, v };
      else if (wantFocus && focusRun?.r.id !== wantFocus && r.tRel >= (focusRun?.r.tRel ?? -1)) focusRun = { r, v };
    }
    if (wantFocus) {
      const fr = ss?.runs.find((x) => x.id === wantFocus);
      const fv = fr && this.runs.get(fr.id);
      if (fr && fv) {
        if (fr.kind === 'boia') buoyRun = { r: fr, v: fv };
        focusRun = { r: fr, v: fv };
      }
    }
    for (const [id, v] of this.runs)
      if (!alive.has(id)) {
        this.disposeRun(v);
        this.runs.delete(id);
      }
    // partículas
    this.smoke.points.visible = on && layers.signalSmoke !== false;
    this.smokeThin.points.visible = this.smoke.points.visible;
    this.bubbles.points.visible = on && layers.signalBubbles !== false;
    this.drops.points.visible = this.bubbles.points.visible;
    this.sparks.points.visible = on && layers.signalLights !== false;
    for (const c of [this.smoke, this.smokeThin, this.bubbles, this.sparks, this.drops]) c.update(st, shift, viewH);
    // luzes reais: as mais fortes
    if (lit.length) this.ensureLights();
    lit.sort((a, b) => b.k - a.k);
    this.pool.forEach((l, i) => {
      const x = on && layers.signalLights !== false ? lit[i] : undefined;
      if (!x) {
        l.intensity = 0;
        return;
      }
      l.color.copy(x.v.color);
      l.position.copy(x.v.lightPos);
      l.distance = 40 + 20 * scale;
      l.intensity = x.k * (40 + 260 * this.night) * Math.min(4, scale);
    });
    // focos das câmeras
    this.focus = focusRun ? this.poseOf(focusRun.r, focusRun.v, scale) : null;
    this.buoyFocus = buoyRun ? this.poseOf(buoyRun.r, buoyRun.v, scale) : null;
    this.surfaceFocus = this.surfacePose(e, pn, pe, scale);
  }

  /** enquadramento atrás/acima do dispositivo; a estrela é vista de baixo e de longe */
  private poseOf(r: SignalRun, v: RunVis, scale: number): SignalFocus {
    const k = Math.max(1, Math.sqrt(scale));
    if (r.flare && v.flare?.root.visible) {
      const fp = v.flare.root.position.clone();
      // perto da estrela, um pouco acima: a estrela, o paraquedas e o mar ao fundo
      return { id: r.id, pos: fp, dir: new THREE.Vector3(0, 0, -1), back: 5 + 3 * k, side: 2.5 * k, up: 1.2 * k };
    }
    const under = r.phase === 'liberado' || r.phase === 'subindo' || (r.phase === 'falha' && r.fault === 'subida');
    const h = new THREE.Vector3(r.ve, 0, -r.vn);
    const dir = h.lengthSq() > 0.01 ? h.normalize() : new THREE.Vector3(0, 0, -1);
    if (r.kind === 'boia') return { id: r.id, pos: v.pos.clone().add(new THREE.Vector3(0, 0.3 * scale, 0)), dir, back: 4 * k + 2, side: 2.5 * k, up: under ? 0.6 * k : 1.4 * k };
    const plume = !under && (SIGNAL_INFO[r.kind].effect === 'fumaca' || SIGNAL_INFO[r.kind].effect === 'combinado');
    // fumaça: de lado e mais longe, para caber a coluna; demais: perto, um pouco acima
    if (plume) return { id: r.id, pos: v.pos.clone().add(new THREE.Vector3(0, 2.5, 0)), dir, back: 14 + 3 * k, side: 9, up: 0 };
    return { id: r.id, pos: v.pos.clone(), dir, back: 3.2 * k + 1.5, side: 2 * k, up: under ? 0.8 * k : 1.3 * k };
  }

  /** vista da superfície: ao nível da água, olhando para o conjunto dos dispositivos flutuando */
  private surfacePose(e: SimulationEngine, pn: number, pe: number, scale: number): SignalFocus | null {
    const ss = e.state.signals;
    const all = (ss?.runs ?? []).filter((r) => r.tSurf !== null && !(r.phase === 'falha' && r.fault === 'subida'));
    // os que ainda estão em curso; sem nenhum, os que acabaram de se apagar
    const liveF = all.filter((r) => r.phase === 'superficie' || r.phase === 'ativo');
    const float = liveF.length ? liveF : all.filter((r) => r.tEnd !== null && e.state.t - r.tEnd < 30);
    if (!float.length) return null;
    let n = 0;
    let ee = 0;
    for (const r of float) {
      n += r.n;
      ee += r.e;
    }
    n /= float.length;
    ee /= float.length;
    let spread = 0;
    for (const r of float) spread = Math.max(spread, Math.hypot(r.n - n, r.e - ee));
    const pos = new THREE.Vector3(ee - pe, 0.5, -(n - pn));
    // olha do lado do submarino para os sinais
    const toSub = new THREE.Vector3(-pos.x, 0, -pos.z);
    const dir = toSub.lengthSq() > 1 ? toSub.normalize().negate() : new THREE.Vector3(0, 0, -1);
    return { id: 'superficie', pos, dir, back: 16 + 1.4 * Math.min(150, spread) + 3 * Math.sqrt(scale), side: 6, up: 3.5 };
  }

  private updateRun(
    r: SignalRun,
    v: RunVis,
    pn: number,
    pe: number,
    st: number,
    t: number,
    cfg: ReturnType<typeof signalsCfg>,
    layers: SceneLayers,
    on: boolean,
    scale: number,
    windS: THREE.Vector3,
    surfaceY: (n: number, ee: number) => number,
    labels: Label3D[] | null,
    proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean },
  ): void {
    const eff = SIGNAL_INFO[r.kind].effect;
    const under = r.phase === 'liberado' || r.phase === 'subindo' || (r.phase === 'falha' && r.fault === 'subida');
    const pos = new THREE.Vector3(r.e - pe, -r.d, -(r.n - pn));
    const lightsOn = on && layers.signalLights !== false;
    const fx = on && layers.signalBubbles !== false;
    const smokeOn = on && layers.signalSmoke !== false;
    // ---- modelo: subida (cilindro/boia) ou na superfície
    let body: SignalInstance | null;
    if (under) {
      v.asc = this.inst(v.asc, ascentFile(r.kind, r.color));
      if (v.surf && v.surf !== v.asc) v.surf.root.visible = false;
      body = v.asc;
    } else {
      const file = surfaceFile(r.kind, r.color);
      if (v.asc && v.asc.file !== file) v.asc.root.visible = false;
      v.surf = v.asc && v.asc.file === file ? v.asc : this.inst(v.surf, file);
      body = v.surf;
    }
    v.pos.copy(pos);
    for (const i of [v.asc, v.surf, v.flare, v.chute]) i?.setEnv(this.env.tex, this.env.k);
    if (body) {
      body.root.visible = on;
      // ampliado: cresce à medida que se afasta do casco (não atravessa o casco nem a vela ao sair)
      const grow = under ? Math.min(1, Math.max(0, (r.depth0 - r.d) / 10)) : 1;
      body.root.scale.setScalar(1 + (scale - 1) * grow);
      if (under) {
        // de pé, inclinado para o lado em que anda; balanço lento
        body.root.position.copy(pos);
        const tilt = new THREE.Vector3(r.ve, -r.vd * 3 + 0.5, -r.vn).normalize();
        body.root.quaternion.setFromUnitVectors(UP, tilt);
        v.yaw += st * 0.4;
        body.root.rotateY(v.yaw);
      } else {
        // linha d'água do modelo no nível local da onda; inclinação pela declividade da onda
        const h = 0.6;
        const y0 = surfaceY(r.n, r.e);
        const gx = (surfaceY(r.n, r.e + h) - surfaceY(r.n, r.e - h)) / (2 * h);
        const gz = (surfaceY(r.n - h, r.e) - surfaceY(r.n + h, r.e)) / (2 * h);
        const nrm = new THREE.Vector3(-gx, 1, -gz).normalize();
        const sink = r.phase === 'falha' && r.fault === 'ativação' ? 0.03 : 0;
        body.root.position.set(pos.x, y0 - (body.waterline + sink) * scale, pos.z);
        body.root.quaternion.setFromUnitVectors(UP, nrm);
        v.yaw += st * 0.15;
        body.root.rotateY(v.yaw);
        v.pos.copy(body.root.position);
      }
      // centro visual para câmera e rótulos
      if (r.kind === 'boia') body.worldOf('BUOY_CAMERA_TARGET', v.pos);
      else if (under) body.worldOf('SIGNAL_CAMERA_TARGET', v.pos);
      else body.worldOf(eff === 'fumaca' ? 'SMOKE_CAMERA_TARGET' : eff === 'luz' ? 'LIGHT_CAMERA_TARGET' : 'WATERLINE_REFERENCE', v.pos);
      // clipes de estado
      const L = signalLight(r, t);
      if (r.kind === 'boia') {
        if (!under) body.play('BUOY_FLOAT');
        if (r.phase === 'ativo') {
          body.stopAlso('BUOY_LIGHT_OFF');
          body.playAlso('BUOY_LIGHT_FLASH');
        } else {
          body.stopAlso('BUOY_LIGHT_FLASH');
          body.playAlso('BUOY_LIGHT_OFF', true);
        }
      } else if (body.has('ACTIVE')) {
        const age = r.tAct !== null ? t - r.tAct : 0;
        body.play(r.phase !== 'ativo' || L <= 0.01 ? 'OFF' : age > 0.85 * r.life ? 'FADING' : L < 0.95 ? 'LOW_INTENSITY' : 'ACTIVE', r.phase === 'ativo' && age > 0.85 * r.life);
      } else if (body.has('LIGHT_SMOKE_ACTIVE')) {
        const sm = signalSmoke(r, t, cfg);
        body.play(r.phase === 'extinto' ? 'ENDED' : r.phase !== 'ativo' ? 'INACTIVE' : L > 0.01 && sm > 0.01 ? 'LIGHT_SMOKE_ACTIVE' : L > 0.01 ? 'LIGHT_ACTIVE' : sm > 0.01 ? 'SMOKE_ACTIVE' : 'ENDED');
        // a fumaça de verdade são as partículas: o volume de prévia some com elas ligadas
        const proxy = body.node('SMOKE_VISUAL_PROXY');
        if (proxy) proxy.visible = !smokeOn;
      }
      body.update(st);
      // luz: emissão do material, halo e luz real
      const flash = r.kind === 'boia' ? (r.tx !== 'off' && t % 2 < 0.22 ? 1 : 0.06) : 1;
      const light = r.kind === 'boia' ? (r.phase === 'ativo' ? flash : 0) : eff === 'estrela' || eff === 'fumaca' ? 0 : L;
      body.setEmission(lightsOn ? light : light > 0 ? 0.3 : 0, 1 + 2 * this.night);
      v.light = lightsOn ? light * (r.kind === 'boia' ? 0.6 : 1) : 0;
      body.worldOf(r.kind === 'boia' ? 'BUOY_LIGHT' : 'LIGHT_EMITTER', v.lightPos);
      v.halo.position.copy(v.lightPos);
      const hs = (1.1 + 4.5 * this.night) * Math.sqrt(scale) * (r.kind === 'boia' ? 1.2 : 1);
      v.halo.scale.set(hs, hs, 1);
      const hm = v.halo.material as THREE.SpriteMaterial;
      hm.opacity = v.light * (0.55 + 0.45 * this.night);
      // brilho aditivo acima de 1 à noite (o halo vermelho da textura é escuro)
      hm.color.setScalar(1 + 0.8 * this.night);
      v.halo.visible = v.light > 0.01;
      // bolhas na subida (SIGNAL_TRAIL_ORIGIN) e rastro de quem afunda
      if (under && fx && st > 0) {
        const speed = Math.hypot(r.vn, r.ve, r.vd);
        v.bubbleAcc += st * (r.phase === 'falha' ? 6 : 26) * Math.min(1.5, 0.4 + speed);
        const src = body.worldOf(r.kind === 'boia' ? 'BUOY_WATERLINE' : 'SIGNAL_TRAIL_ORIGIN', tmpV.clone());
        while (v.bubbleAcc >= 1) {
          v.bubbleAcc -= 1;
          const s0 = (0.025 + Math.random() * 0.05) * Math.sqrt(scale);
          this.bubbles.emit({
            pos: src.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.12 * scale, 0, (Math.random() - 0.5) * 0.12 * scale)),
            vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.3),
            life: 5 + Math.random() * 6,
            size0: s0,
            size1: s0 * 1.8,
            color: new THREE.Color(0.85, 0.95, 1),
            alpha: 0.75,
            drag: 0.6,
            rise: 0.35,
            ceil: surfaceY(r.n, r.e) - 0.05,
          });
        }
      }
    }
    // ---- chegada à superfície: respingo, anel e gotas (uma vez)
    if (!under && !v.surfaced) {
      v.surfaced = true;
      if (fx && t - (r.tSurf ?? t) < 3) {
        const y0 = surfaceY(r.n, r.e);
        v.ring.userData.t0 = this.clock;
        for (let i = 0; i < 26; i++)
          this.drops.emit({
            pos: new THREE.Vector3(pos.x, y0 + 0.1, pos.z),
            vel: new THREE.Vector3((Math.random() - 0.5) * 2.2, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 2.2).multiplyScalar(Math.sqrt(scale)),
            life: 0.9 + Math.random() * 0.6,
            size0: 0.12 * Math.sqrt(scale),
            size1: 0.3 * Math.sqrt(scale),
            color: new THREE.Color(0.9, 0.97, 1),
            alpha: 0.9,
            rise: -9.81,
          });
      }
    }
    // anel de onda e espuma em volta do flutuador
    {
      const y0 = surfaceY(r.n, r.e) + 0.02;
      const t0 = v.ring.userData.t0 as number | undefined;
      const ra = t0 === undefined ? 99 : this.clock - t0;
      v.ring.visible = fx && ra < 4;
      if (v.ring.visible) {
        const s = (0.6 + ra * 1.6) * Math.sqrt(scale);
        v.ring.position.set(pos.x, y0, pos.z);
        v.ring.scale.set(s, 1, s);
        (v.ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - ra / 4);
      }
      const floating = !under && !(r.kind === 'estrela' && r.phase !== 'ativo' && r.flare === null && r.tEnd !== null && t - r.tEnd > 30);
      v.foam.visible = fx && floating;
      if (v.foam.visible) {
        const s = (0.9 + 0.15 * Math.sin(this.clock * 1.3)) * scale * (r.kind === 'boia' ? 1.4 : 1);
        v.foam.position.set(pos.x, y0, pos.z);
        v.foam.scale.set(s, 1, s);
        (v.foam.material as THREE.MeshBasicMaterial).opacity = 0.55;
      }
    }
    // ---- fumaça (SMOKE_EMITTER; sinais de cor: a fumaça curta sai de cima do flutuador)
    const sm = signalSmoke(r, t, cfg);
    if (sm > 0.005 && smokeOn && st > 0 && body) {
      const src = body.worldOf(eff === 'luz' ? 'LIGHT_EMITTER' : 'SMOKE_EMITTER', tmpV.clone());
      const col = new THREE.Color(SMOKE_RGB[eff === 'combinado' ? 'laranja' : r.color]);
      const dense = eff !== 'luz';
      v.smokeAcc += st * (dense ? 24 : 9) * sm;
      // vento mínimo para a coluna se inclinar (a fumaça de sinal se espalha rente ao mar)
      const wv = windS.lengthSq() > 0.25 ? windS.clone().multiplyScalar(1.8) : new THREE.Vector3(1.2, 0, -0.5);
      while (v.smokeAcc >= 1) {
        v.smokeAcc -= 1;
        const jitter = 0.75 + 0.5 * Math.random();
        const thin = !dense || Math.random() < 0.3;
        (thin ? this.smokeThin : this.smoke).emit({
          pos: src.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.15, 0, (Math.random() - 0.5) * 0.15)),
          vel: new THREE.Vector3((Math.random() - 0.5) * 0.9, 0.5 + Math.random() * 0.9, (Math.random() - 0.5) * 0.9),
          life: (dense ? 18 : 10) * jitter,
          size0: 0.3 * Math.sqrt(scale),
          size1: (dense ? 5.5 : 3.5) * jitter * (0.5 + 0.5 * r.smokeK),
          color: col.clone().multiplyScalar(0.8 + 0.35 * Math.random()),
          alpha: (thin ? 0.35 : 0.6) * Math.max(0.35, r.smokeK),
          drag: 0.35,
          rise: 0.04,
          wind: wv.clone().multiplyScalar(0.8 + 0.4 * Math.random()),
          spin: (Math.random() - 0.5) * 0.9,
        });
      }
    }
    // ---- estrela com paraquedas
    if (r.flare) {
      const f = r.flare;
      v.flare = this.inst(v.flare, flareFile(r.color));
      v.chute = this.inst(v.chute, PARACHUTE_FILE);
      const fpos = new THREE.Vector3(pos.x + f.de, surfaceY(r.n, r.e) + f.alt + 0.4, pos.z - f.dn);
      const L = signalLight(r, t);
      const k = Math.max(1, scale);
      if (v.flare) {
        v.flare.root.visible = on && f.alt > 0.3;
        v.flare.root.position.copy(fpos);
        v.flare.root.scale.setScalar(k);
        v.flare.play(r.phase === 'ativo' && L > 0.6 ? 'FLARE_GLOW' : 'FLARE_FADE', r.phase !== 'ativo' || L <= 0.6);
        v.flare.update(st);
        v.flare.setEmission(lightsOn ? L : L * 0.3, 1 + 3 * this.night);
        v.flare.worldOf('FLARE_PARTICLE_ORIGIN', v.lightPos);
        v.light = lightsOn ? L * 1.4 : 0;
        v.color.set(SIGNAL_RGB[r.color]);
        // clarão da estrela
        const fs = (3.5 + 9 * this.night) * Math.sqrt(k) * (0.6 + 0.4 * Math.sin(this.clock * 23) * Math.sin(this.clock * 11.7));
        v.flareHalo.position.copy(v.lightPos);
        v.flareHalo.scale.set(fs, fs, 1);
        (v.flareHalo.material as THREE.SpriteMaterial).opacity = lightsOn ? L * (0.8 + 0.2 * this.night) : 0;
        v.flareHalo.visible = lightsOn && L > 0.01;
        // fagulhas que pingam da estrela
        if (lightsOn && L > 0.05 && st > 0) {
          v.sparkAcc += st * 22 * L;
          while (v.sparkAcc >= 1) {
            v.sparkAcc -= 1;
            this.sparks.emit({
              pos: v.lightPos.clone(),
              vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, -0.5 - Math.random() * 1.5, (Math.random() - 0.5) * 1.2).add(windS),
              life: 0.8 + Math.random() * 1.2,
              size0: 0.25 * Math.sqrt(k),
              size1: 0.05,
              color: v.color.clone().lerp(new THREE.Color(1, 1, 1), 0.4),
              alpha: 0.95,
              rise: -3,
            });
          }
          // fumaça clara deixada pela estrela
          if (smokeOn && Math.random() < st * 6)
            this.smokeThin.emit({ pos: v.lightPos.clone(), vel: new THREE.Vector3(0, 0.3, 0), life: 10, size0: 0.4, size1: 4, color: new THREE.Color(0.85, 0.86, 0.88), alpha: 0.35, drag: 0.4, wind: windS.clone() });
        }
        if (!v.ignited && f.alt > 0.3) {
          v.ignited = true;
          for (let i = 0; i < 30 && lightsOn; i++)
            this.sparks.emit({
              pos: v.lightPos.clone(),
              vel: new THREE.Vector3((Math.random() - 0.5) * 6, -1 - Math.random() * 4, (Math.random() - 0.5) * 6),
              life: 0.6 + Math.random() * 0.5,
              size0: 0.4,
              size1: 0.05,
              color: v.color.clone(),
              alpha: 1,
              rise: -6,
            });
        }
      }
      if (v.chute && v.flare) {
        v.chute.root.visible = on && f.chute > 0;
        v.chute.root.scale.setScalar(k);
        // o ponto de suspensão do paraquedas fica na estrela
        const sp = v.chute.node('PARACHUTE_SUSPENSION_POINT');
        v.chute.root.position.copy(fpos).sub(new THREE.Vector3(0, (sp ? sp.position.y : -0.31) * k, 0));
        if (f.chute > 0) {
          v.chute.playAlso('PARACHUTE_OPEN', true);
          if (f.chute >= 1) v.chute.playAlso('PARACHUTE_SWAY');
        } else v.chute.playAlso('PARACHUTE_CLOSED_VISUAL', true);
        v.chute.update(st);
      }
    } else {
      if (v.flare) v.flare.root.visible = false;
      if (v.chute) v.chute.root.visible = false;
      v.flareHalo.visible = false;
    }
    // ---- trajetória ilustrativa
    v.track.visible = on && !!layers.signalTracks && r.track.length > 0;
    if (v.track.visible) {
      const pts = r.track.map((p) => new THREE.Vector3(p.e - pe, -p.d, -(p.n - pn)));
      if (under) pts.push(pos.clone());
      if (pts.length >= 2) v.track.geometry.setFromPoints(pts);
      else v.track.visible = false;
    }
    // ---- identificação
    if (labels && on) {
      const lp = (v.flare?.root.visible ? v.flare.root.position.clone() : v.pos.clone()).add(new THREE.Vector3(0, 1.2 + 0.5 * scale, 0));
      const pp = proj(lp);
      const age = t - r.tRel;
      const where = under ? `${Math.max(0, r.d).toFixed(0)} m de profundidade` : r.flare && r.flare.alt > 1 ? `${r.flare.alt.toFixed(0)} m de altura` : 'na superfície';
      const txt = r.kind === 'boia' && r.phase === 'ativo' ? (r.tx === 'ok' ? 'TRANSMITINDO (fictício)' : 'transmissão em FALHA') : PHASE_TXT[r.phase] + (r.fault ? ` (${r.fault})` : '');
      labels.push({ id: 'sig_' + r.id, text: `${r.id} · ${signalLabel(r.kind, r.color)}`, sub: `${txt} · ${where} · ${age.toFixed(0)} s`, color: '#e8f0ff', small: true, prio: 1, x: pp.x, y: pp.y, visible: pp.visible });
    }
  }

  dispose(): void {
    for (const v of this.runs.values()) this.disposeRun(v);
    this.runs.clear();
    for (const f of [this.frames.launcher, this.frames.buoy]) f?.dispose();
    for (const c of [this.smoke, this.smokeThin, this.bubbles, this.sparks, this.drops]) c.dispose();
    for (const l of this.pool) l.dispose();
  }
}
