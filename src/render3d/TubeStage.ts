/**
 * TUBO LANÇADOR EM 3D, ETAPA A ETAPA (só lê o estado; nada aqui altera a física).
 *
 * Uma cena pequena e separada com UM tubo em tamanho real: casco do tubo (vidro ou em corte), água do
 * tubo subindo e descendo, a arma (modelo do F21) andando no disparo, culatra e porta da boca abrindo,
 * as quatro válvulas (alagamento, suspiro, equalização, drenagem) com as tubulações e o escoamento,
 * o TCA embaixo, a garrafa de lançamento e o êmbolo de ejeção, o casco externo e o mar. Depois do
 * disparo a arma sai pela boca com as bolhas do ar de lançamento.
 *
 * Câmera livre (girar, aproximar, deslocar) e enquadramentos prontos; identificações em três grupos
 * (peças, válvulas, valores) que podem ser ligados e desligados; destaque pulsando na peça da etapa atual.
 *
 * Coordenadas locais: x ao longo do tubo (0 na culatra, L na boca), y para cima, z para o lado.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SimulationEngine } from '../sim/core/engine';
import type { TubeAction } from '../sim/systems/weapons';
import { tubeView } from '../sim/systems/weapons';
import { stowedWeaponX, tubeLength } from '../sim/systems/torpedoTubes';
import { makeDepthOf, RHO_NOMINAL } from '../sim/core/context';
import { qToMat3 } from '../sim/core/math';
import { torpedo as fallbackTorpedo } from './CargoVis';
import { loadSubModel } from './subModel';
import { Bubbles, torpedoModelUrl } from './TorpedoVis';
import { sm39ModelUrl } from './MissileVis';

export type TubeLabelGroup = 'pecas' | 'valvulas' | 'valores';
export type TubeStagePreset = 'tres4' | 'lado' | 'boca' | 'culatra' | 'cima';

export interface TubeStageOptions {
  /** meio tubo aberto (corte) em vez do tubo de vidro */
  cut: boolean;
  /** escoamento nas tubulações e bolhas */
  flows: boolean;
  labels: Record<TubeLabelGroup, boolean>;
}

const DEG = Math.PI / 180;

interface FlowPath {
  curve: THREE.CatmullRomCurve3;
  pts: THREE.Points;
  pos: Float32Array;
}

interface ValveVis {
  g: THREE.Group;
  ball: THREE.Mesh;
  wheel: THREE.Mesh;
  path: FlowPath;
}

interface Lbl {
  el: HTMLDivElement;
  group: TubeLabelGroup;
  at: () => THREE.Vector3 | null;
  text: () => string;
}

function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const FLOW_N = 26;

export class TubeStage {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
  private controls: OrbitControls;
  private raf = 0;
  private ro: ResizeObserver;
  private labelsEl: HTMLDivElement;
  private dot = dotTexture();
  private clock = new THREE.Clock();
  private tube = 1;
  private builtFor = '';
  private root = new THREE.Group();
  private opts: TubeStageOptions = { cut: true, flows: true, labels: { pecas: true, valvulas: true, valores: true } };
  private focus: TubeAction | null = null;
  private torpSrc: THREE.Object3D | null = null;
  private vsmSrc: THREE.Object3D | null = null;
  private disposed = false;

  // peças (refeitas a cada troca de tubo)
  private L = 7.5;
  private rOut = 0.31;
  private rBore = 0.278;
  private cutPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private levelPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private shellMat = new THREE.MeshStandardMaterial({ color: 0xb7c3d0, metalness: 0.65, roughness: 0.32, side: THREE.DoubleSide });
  private innerMat = new THREE.MeshStandardMaterial({ color: 0x55626f, metalness: 0.5, roughness: 0.55, side: THREE.BackSide });
  private waterMat = new THREE.MeshStandardMaterial({ color: 0x2a92ec, transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0.05, depthWrite: false, side: THREE.DoubleSide });
  private cutWaterMat = new THREE.MeshStandardMaterial({ color: 0x3aa0f5, transparent: true, opacity: 0.5, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false, emissive: 0x0a3a66 });
  private surfMat = new THREE.MeshStandardMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.7, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false });
  private hullMat = new THREE.MeshStandardMaterial({ color: 0x3e4b5c, metalness: 0.4, roughness: 0.6, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
  private water!: THREE.Mesh;
  private surf!: THREE.Mesh;
  private waterCut!: THREE.Mesh;
  private weapon: THREE.Group | null = null;
  private weaponGlow!: THREE.Mesh;
  private breech!: THREE.Group;
  private door!: THREE.Group;
  private ram!: THREE.Mesh;
  private tca!: { water: THREE.Mesh; h: number; y0: number };
  private flask!: { band: THREE.Mesh; path: FlowPath };
  private valves: Record<'flood' | 'vent' | 'equalize' | 'drain', ValveVis> = {} as Record<'flood' | 'vent' | 'equalize' | 'drain', ValveVis>;
  private halo!: THREE.Mesh;
  private bubbles: Bubbles;
  private exitTorp: THREE.Group | null = null;
  private lbls: Lbl[] = [];
  private lastEject: number | null = null;

  constructor(
    private container: HTMLElement,
    private getEngine: () => SimulationEngine,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);
    this.labelsEl = document.createElement('div');
    this.labelsEl.className = 'ts-labels';
    container.appendChild(this.labelsEl);
    this.scene.background = new THREE.Color(0x0c1a2b);
    this.scene.fog = new THREE.Fog(0x0c1a2b, 18, 60);
    this.scene.add(new THREE.HemisphereLight(0xdcefff, 0x1b2a3a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(4, 8, 6);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x7fc4ff, 1.1);
    rim.position.set(-6, 2, -5);
    this.scene.add(rim);
    this.scene.add(this.root);
    // piso de referência da sala de torpedos
    const grid = new THREE.GridHelper(30, 30, 0x2c4260, 0x1a2a3d);
    grid.position.set(3, -1.75, 0);
    this.scene.add(grid);
    this.bubbles = new Bubbles(420, this.dot, 0.12);
    this.scene.add(this.bubbles.points);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 45;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    loadSubModel(torpedoModelUrl(), this.renderer)
      .then((src) => {
        if (this.disposed) return;
        this.torpSrc = src;
        this.builtFor = 'modelo'; // refaz as peças com o modelo, sem mexer na câmera
      })
      .catch(() => undefined);
    loadSubModel(sm39ModelUrl(), this.renderer)
      .then((src) => {
        if (this.disposed) return;
        this.vsmSrc = src;
        this.builtFor = 'modelo';
      })
      .catch(() => undefined);
    this.loop();
  }

  setTube(n: number): void {
    if (n !== this.tube) {
      this.tube = n;
      this.builtFor = '';
    }
  }

  setOptions(o: Partial<TubeStageOptions>): void {
    this.opts = { ...this.opts, ...o, labels: { ...this.opts.labels, ...(o.labels ?? {}) } };
    this.applyCut();
  }

  /** peça da etapa atual (pulsa) */
  setFocus(a: TubeAction | null): void {
    this.focus = a;
  }

  preset(p: TubeStagePreset): void {
    const L = this.L;
    const c = new THREE.Vector3(L / 2, 0, 0);
    const pos: Record<TubeStagePreset, [THREE.Vector3, THREE.Vector3]> = {
      tres4: [new THREE.Vector3(L * 0.42, L * 0.3, L * 0.78), new THREE.Vector3(L * 0.45, -0.55, 0)],
      lado: [new THREE.Vector3(L * 0.45, 0.2, L * 0.95), new THREE.Vector3(L * 0.45, -0.5, 0)],
      boca: [new THREE.Vector3(L + 3.2, 1.1, 2.4), new THREE.Vector3(L - 0.6, 0, 0)],
      culatra: [new THREE.Vector3(-2.6, 1.2, 2.2), new THREE.Vector3(0.9, -0.2, 0)],
      cima: [new THREE.Vector3(L / 2, 8.5, 0.6), c],
    };
    const [a, b] = pos[p];
    this.camera.position.copy(a);
    this.controls.target.copy(b);
    this.controls.update();
  }

  /** libera geometrias e materiais próprios das peças (não os materiais fixos da classe nem o modelo do torpedo, compartilhado) */
  private disposeParts(): void {
    const shared = new Set<THREE.Material>([this.shellMat, this.innerMat, this.waterMat, this.cutWaterMat, this.surfMat, this.hullMat]);
    const skip = new Set<THREE.Object3D>([this.weapon, this.exitTorp].filter((x): x is THREE.Group => !!x));
    const visit = (o: THREE.Object3D) => {
      if (skip.has(o)) return;
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const x of mats) if (!shared.has(x)) x.dispose();
      for (const c of o.children) visit(c);
    };
    for (const c of this.root.children) visit(c);
  }

  dispose(): void {
    this.disposeParts();
    for (const m of [this.shellMat, this.innerMat, this.waterMat, this.cutWaterMat, this.surfMat, this.hullMat]) m.dispose();
    this.dot.dispose();
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelsEl.remove();
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private applyCut(): void {
    const cut = this.opts.cut;
    const planes = cut ? [this.cutPlane] : [];
    this.shellMat.clippingPlanes = planes;
    this.shellMat.transparent = !cut;
    this.shellMat.opacity = cut ? 1 : 0.2;
    this.shellMat.depthWrite = cut;
    this.innerMat.clippingPlanes = planes;
    this.innerMat.visible = cut;
    this.waterMat.clippingPlanes = cut ? [this.levelPlane, this.cutPlane] : [this.levelPlane];
    this.surfMat.clippingPlanes = planes;
    this.hullMat.clippingPlanes = planes;
    for (const m of [this.shellMat, this.innerMat, this.waterMat, this.surfMat, this.hullMat]) m.needsUpdate = true;
  }

  // ------------------------------------------------------------------ construção

  private makeTorpedo(kind: 'f21' | 'sm39' = 'f21'): THREE.Group {
    const g = new THREE.Group();
    g.userData.kind = kind;
    const m = kind === 'sm39' && this.vsmSrc ? this.vsmSrc.clone(true) : this.torpSrc ? this.torpSrc.clone(true) : fallbackTorpedo();
    m.rotation.y = -Math.PI / 2; // eixo −z do modelo → +x (boca)
    g.add(m);
    return g;
  }

  private path(points: [number, number, number][], color: number, radius = 0.045): FlowPath {
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(...p)),
      false,
      'catmullrom',
      0.1,
    );
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, radius, 10, false), new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.35 }));
    this.root.add(pipe);
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(FLOW_N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.1, map: this.dot, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, color: 0x6cc4ff }));
    pts.frustumCulled = false;
    pts.renderOrder = 5;
    this.root.add(pts);
    return { curve, pts, pos };
  }

  private valve(at: [number, number, number], path: FlowPath): ValveVis {
    const g = new THREE.Group();
    g.position.set(...at);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.085, 20, 14), new THREE.MeshStandardMaterial({ color: 0x6b7c8f, metalness: 0.4, roughness: 0.4, emissive: 0x000000 }));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 8), new THREE.MeshStandardMaterial({ color: 0x8a96a3 }));
    stem.position.z = 0.12;
    stem.rotation.x = Math.PI / 2;
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.014, 8, 24), new THREE.MeshStandardMaterial({ color: 0xd84a3a, metalness: 0.3, roughness: 0.5 }));
    wheel.position.z = 0.19;
    g.add(ball, stem, wheel);
    this.root.add(g);
    return { g, ball, wheel, path };
  }

  private build(e: SimulationEngine, i: number): void {
    const w = e.vessel.weapons!;
    const tc = w.tubes[i];
    const L = tubeLength(w, tc, e.geom.radiusAt);
    this.L = L;
    this.rOut = w.outerRadius;
    this.rBore = w.boreRadius;
    const rO = this.rOut;
    const rB = this.rBore;
    this.disposeParts();
    this.root.clear();
    this.weapon = null;
    this.exitTorp = null;
    // casco do tubo: parede externa (metal ou vidro), parede interna escura e anéis
    const shell = new THREE.CylinderGeometry(rO, rO, L, 56, 1, true);
    shell.rotateZ(-Math.PI / 2);
    const sh = new THREE.Mesh(shell, this.shellMat);
    sh.position.x = L / 2;
    sh.renderOrder = 2;
    const inner = new THREE.CylinderGeometry(rB, rB, L, 56, 1, true);
    inner.rotateZ(-Math.PI / 2);
    const inn = new THREE.Mesh(inner, this.innerMat);
    inn.position.x = L / 2;
    this.root.add(sh, inn);
    for (let k = 0; k <= 4; k++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rO + 0.015, 0.02, 8, 48), this.shellMat);
      ring.rotation.y = Math.PI / 2;
      ring.position.x = 0.25 + (k / 4) * (L - 0.5);
      this.root.add(ring);
    }
    // água do tubo (cortada no nível) e a superfície da água
    const wg = new THREE.CylinderGeometry(rB * 0.985, rB * 0.985, L - 0.02, 48, 1, false);
    wg.rotateZ(-Math.PI / 2);
    this.water = new THREE.Mesh(wg, this.waterMat);
    this.water.position.x = L / 2;
    this.water.renderOrder = 4;
    const sg = new THREE.PlaneGeometry(L - 0.02, 1, 1, 1);
    sg.rotateX(-Math.PI / 2);
    this.surf = new THREE.Mesh(sg, this.surfMat);
    this.surf.position.x = L / 2;
    this.surf.renderOrder = 4;
    // face da água no plano do corte (z = 0): o nível fica bem visível com o tubo aberto
    this.waterCut = new THREE.Mesh(new THREE.PlaneGeometry(L - 0.02, 1), this.cutWaterMat);
    this.waterCut.position.set(L / 2, 0, 0.002);
    this.waterCut.renderOrder = 5;
    this.root.add(this.water, this.surf, this.waterCut);
    // êmbolo de ejeção (disco atrás da arma)
    const rg = new THREE.CylinderGeometry(rB * 0.95, rB * 0.95, 0.06, 32);
    rg.rotateZ(-Math.PI / 2);
    this.ram = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.7, roughness: 0.3 }));
    this.ram.position.x = 0.08;
    this.root.add(this.ram);
    // culatra (porta interna): dobradiça no lado de trás, abre para a sala
    this.breech = new THREE.Group();
    this.breech.position.set(-0.05, 0, -(rO + 0.05));
    const bd = new THREE.CylinderGeometry(rO + 0.07, rO + 0.07, 0.1, 40);
    bd.rotateZ(Math.PI / 2);
    const bMesh = new THREE.Mesh(bd, new THREE.MeshStandardMaterial({ color: 0x9aa6b3, metalness: 0.75, roughness: 0.3 }));
    bMesh.position.z = rO + 0.05;
    const hw = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 10, 32), new THREE.MeshStandardMaterial({ color: 0xd84a3a, metalness: 0.3, roughness: 0.5 }));
    hw.rotation.y = Math.PI / 2;
    hw.position.set(-0.09, 0, rO + 0.05);
    this.breech.add(bMesh, hw);
    this.root.add(this.breech);
    // porta da boca: dobradiça em cima, abre para fora
    this.door = new THREE.Group();
    this.door.position.set(L + 0.06, rO + 0.05, 0);
    const dd = new THREE.CylinderGeometry(rO + 0.06, rO + 0.06, 0.09, 40);
    dd.rotateZ(Math.PI / 2);
    const dMesh = new THREE.Mesh(dd, new THREE.MeshStandardMaterial({ color: 0xe0823a, metalness: 0.4, roughness: 0.45 }));
    dMesh.position.y = -(rO + 0.05);
    this.door.add(dMesh);
    this.root.add(this.door);
    // casco externo em volta da boca
    const hull = new THREE.RingGeometry(rO + 0.14, 2.3, 56);
    hull.rotateY(Math.PI / 2);
    const hm = new THREE.Mesh(hull, this.hullMat);
    hm.position.x = L + 0.2;
    this.root.add(hm);
    // o mar além da boca
    const sea = new THREE.Mesh(new THREE.BoxGeometry(16, 5, 5), new THREE.MeshBasicMaterial({ color: 0x0d5d8f, transparent: true, opacity: 0.16, depthWrite: false }));
    sea.position.x = L + 0.25 + 8;
    this.root.add(sea);
    // TCA (tanque de compensação das armas), embaixo, com a água
    const tcaW = 2.2;
    const tcaH = 0.8;
    const tcaBox = new THREE.BoxGeometry(tcaW, tcaH, 1.1);
    const tcaEdges = new THREE.LineSegments(new THREE.EdgesGeometry(tcaBox), new THREE.LineBasicMaterial({ color: 0x8fb3d9 }));
    const tcaGlass = new THREE.Mesh(tcaBox, new THREE.MeshStandardMaterial({ color: 0x8fb3d9, transparent: true, opacity: 0.1, depthWrite: false }));
    const y0 = -0.78 - tcaH / 2;
    tcaEdges.position.set(1.8, y0, 0);
    tcaGlass.position.copy(tcaEdges.position);
    const tw = new THREE.Mesh(new THREE.BoxGeometry(tcaW - 0.04, 1, 1.06), new THREE.MeshStandardMaterial({ color: 0x2a92ec, transparent: true, opacity: 0.6, depthWrite: false }));
    tw.position.set(1.8, y0, 0);
    this.root.add(tcaEdges, tcaGlass, tw);
    this.tca = { water: tw, h: tcaH - 0.04, y0: y0 - tcaH / 2 + 0.02 };
    // tubulações e válvulas (atrás do plano do corte, z < 0)
    const z = -0.12;
    const yB = -0.78; // topo do TCA
    const flood = this.path(
      [
        [1.1, yB, z],
        [1.1, -0.45, z],
        [1.1, -rO + 0.02, z],
      ],
      0x4f86b8,
    );
    const drain = this.path(
      [
        [2.8, -rO + 0.02, z],
        [2.8, -0.45, z],
        [2.8, yB, z],
      ],
      0x4f86b8,
    );
    const vent = this.path(
      [
        [0.7, rO - 0.02, z],
        [0.7, 0.75, z],
        [0.45, 0.95, z],
        [-0.4, 0.98, z],
      ],
      0x8c99a6,
    );
    const eq = this.path(
      [
        [L - 1.0, rO - 0.02, z],
        [L - 1.0, 0.72, z],
        [L - 0.7, 0.92, z],
        [L + 0.9, 0.95, z],
      ],
      0x3aa1a8,
    );
    this.valves = {
      flood: this.valve([1.1, -0.52, z], flood),
      drain: this.valve([2.8, -0.52, z], drain),
      vent: this.valve([0.7, 0.56, z], vent),
      equalize: this.valve([L - 1.0, 0.56, z], eq),
    };
    // garrafa de lançamento e a linha até o êmbolo
    const fg = new THREE.CylinderGeometry(0.2, 0.2, 1.1, 24);
    const flask = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: 0x3d5a80, metalness: 0.6, roughness: 0.35 }));
    flask.position.set(-0.85, 0.1, -0.55);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), flask.material);
    cap.position.set(-0.85, 0.65, -0.55);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 1, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xffc94d, emissive: 0x664400, transparent: true, opacity: 0.85 }));
    band.position.set(-0.85, 0.1, -0.55);
    this.root.add(flask, cap, band);
    const fpath = this.path(
      [
        [-0.85, -0.5, -0.55],
        [-0.6, -0.62, -0.4],
        [-0.15, -0.62, -0.15],
        [0.04, -0.2, -0.1],
      ],
      0xc9a227,
      0.035,
    );
    (fpath.pts.material as THREE.PointsMaterial).color.set(0xffffff);
    this.flask = { band, path: fpath };
    // brilho da arma (etapa "alimentar") e halo da etapa atual
    this.weaponGlow = new THREE.Mesh(
      new THREE.CylinderGeometry(rB * 0.9, rB * 0.9, w.weapon.length * 0.98, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.weaponGlow.geometry.rotateZ(-Math.PI / 2);
    this.root.add(this.weaponGlow);
    this.halo = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.root.add(this.halo);
    this.applyCut();
    this.makeLabels(e, i);
  }

  // ------------------------------------------------------------------ rótulos

  private makeLabels(e: SimulationEngine, i: number): void {
    this.labelsEl.innerHTML = '';
    this.lbls = [];
    const L = this.L;
    const rO = this.rOut;
    const w = e.vessel.weapons!;
    const st = () => this.getEngine().state.weapons?.tubes[i];
    const tv = () => {
      const en = this.getEngine();
      const s = en.state;
      return tubeView(en.vessel, s, { env: en.env, depthOf: makeDepthOf(s.body.pos, qToMat3(s.body.quat)), rhoLocal: en.env.densityAt(Math.max(0, s.body.pos.z)) }, en.geom.radiusAt, i);
    };
    const v3 = (x: number, y: number, z: number) => () => new THREE.Vector3(x, y, z);
    const vs = (p: { pos: number; cmd: number }) => (p.pos > 0.999 ? 'aberta' : p.pos > 0.001 ? (p.cmd > 0.5 ? 'abrindo…' : 'fechando…') : 'fechada');
    const add = (group: TubeLabelGroup, at: () => THREE.Vector3 | null, text: () => string, cls = '') => {
      const el = document.createElement('div');
      el.className = `ts-lbl ts-${group} ${cls}`;
      this.labelsEl.appendChild(el);
      this.lbls.push({ el, group, at, text });
    };
    add('pecas', v3(-0.15, -rO - 0.25, 0.3), () => `Culatra (${vs(st()!.breech)})`);
    add('pecas', v3(L + 0.1, rO + 0.75, 0), () => `Porta da boca (${vs(st()!.door)})`);
    add('pecas', v3(L + 0.25, -1.55, 0), () => 'Casco externo');
    add('pecas', v3(L + 3.5, 0.5, 0), () => 'Mar');
    add('pecas', v3(-0.85, 1.25, -0.55), () => 'Garrafa de lançamento (ar AP)');
    add('pecas', v3(1.8, -1.6, 0.6), () => 'TCA (compensação das armas)');
    add(
      'pecas',
      () => (st()?.weapon ? new THREE.Vector3(stowedWeaponX(w) - w.breechX + (st()!.eject ?? 0), 0.42, 0.1) : null),
      () => (st()?.energized ? 'Arma F21 (alimentada)' : 'Arma F21'),
    );
    add(
      'pecas',
      () => (st()?.eject !== null ? new THREE.Vector3(0.1, -0.42, 0.1) : null),
      () => 'Êmbolo de ejeção',
    );
    add('valvulas', v3(1.1, -0.52, -0.12), () => `Alagamento: ${vs(st()!.flood)}`);
    add('valvulas', v3(2.8, -0.52, -0.12), () => `Drenagem: ${vs(st()!.drain)}`);
    add('valvulas', v3(0.7, 0.56, -0.12), () => `Suspiro: ${vs(st()!.vent)}`);
    add('valvulas', v3(L - 1.0, 0.56, -0.12), () => `Equalização: ${vs(st()!.equalize)}`);
    add('valores', v3(L * 0.45, rO + 0.3, 0), () => `Tubo ${(st()!.pressure / 1e5).toFixed(1)} bar · água ${Math.round((100 * st()!.water) / Math.max(1, tv().fullWater))} %`, 'big');
    add('valores', v3(L + 1.6, 1.2, 0), () => `Mar ${(tv().seaPressure / 1e5).toFixed(1)} bar`, 'big');
    add('valores', v3(-0.85, 0.85, -0.55), () => `${tv().flaskBar.toFixed(0)} bar`);
    add('valores', v3(1.8, -0.95, 0.55), () => {
      const ws = this.getEngine().state.weapons!;
      return `${(ws.tca.reduce((a, k) => a + k.mass, 0) / RHO_NOMINAL).toFixed(2)} m³`;
    });
  }

  private placeLabels(): void {
    const W = this.container.clientWidth;
    const H = this.container.clientHeight;
    for (const l of this.lbls) {
      const on = this.opts.labels[l.group];
      const p = on ? l.at() : null;
      if (!p) {
        l.el.style.display = 'none';
        continue;
      }
      const q = p.clone().applyMatrix4(this.root.matrixWorld).project(this.camera);
      if (q.z > 1 || q.x < -1.2 || q.x > 1.2 || q.y < -1.2 || q.y > 1.2) {
        l.el.style.display = 'none';
        continue;
      }
      l.el.style.display = '';
      const t = l.text();
      if (l.el.textContent !== t) l.el.textContent = t;
      l.el.style.transform = `translate(${((q.x + 1) / 2) * W}px, ${((1 - q.y) / 2) * H}px) translate(-50%, -100%)`;
    }
  }

  // ------------------------------------------------------------------ quadro

  private flow(p: FlowPath, on: boolean, dir: 1 | -1, speed: number, t: number, color?: number): void {
    p.pts.visible = on && this.opts.flows;
    if (!p.pts.visible) return;
    if (color !== undefined) (p.pts.material as THREE.PointsMaterial).color.set(color);
    const v = new THREE.Vector3();
    for (let k = 0; k < FLOW_N; k++) {
      let u = (k / FLOW_N + t * speed) % 1;
      if (dir < 0) u = 1 - u;
      p.curve.getPointAt(u, v);
      p.pos[k * 3] = v.x;
      p.pos[k * 3 + 1] = v.y;
      p.pos[k * 3 + 2] = v.z;
    }
    (p.pts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden || this.container.clientWidth < 2) return;
    const dt = Math.min(0.1, this.clock.getDelta());
    const tw = this.clock.elapsedTime;
    const e = this.getEngine();
    const w = e.vessel.weapons;
    const ws = e.state.weapons;
    if (!w || !ws) return;
    const i = Math.max(
      0,
      w.tubes.findIndex((x) => x.n === this.tube),
    );
    const key = `${i}:${this.torpSrc ? 1 : 0}`;
    if (key !== this.builtFor) {
      const first = this.builtFor === '';
      this.build(e, i);
      if (first) this.preset('tres4');
      this.builtFor = key;
    }
    const t = ws.tubes[i];
    const view = tubeView(e.vessel, e.state, { env: e.env, depthOf: makeDepthOf(e.state.body.pos, qToMat3(e.state.body.quat)), rhoLocal: e.env.densityAt(Math.max(0, e.state.body.pos.z)) }, e.geom.radiusAt, i);
    const L = this.L;
    const rB = this.rBore;
    // água: nível pela fração da área ocupada (cheio = topo do furo)
    const fill = Math.max(0, Math.min(1, t.water / Math.max(1, view.fullWater)));
    const level = -rB + 2 * rB * fill;
    this.levelPlane.constant = level + 0.002;
    this.water.visible = fill > 0.005;
    const chord = 2 * Math.sqrt(Math.max(0, rB * rB - level * level));
    this.surf.visible = fill > 0.01 && fill < 0.985;
    this.waterCut.visible = this.opts.cut && fill > 0.005;
    this.waterCut.scale.y = Math.max(0.001, level + rB);
    this.waterCut.position.y = (level - rB) / 2;
    this.surf.position.y = level + 0.004 * Math.sin(tw * 3);
    this.surf.scale.z = Math.max(0.001, chord * 0.98);
    // arma no tubo (anda no disparo)
    const showW = t.weapon;
    const kind = t.kind === 'sm39' && w.missile ? 'sm39' : 'f21';
    if (this.weapon && this.weapon.userData.kind !== kind) {
      this.root.remove(this.weapon);
      this.weapon = null;
    }
    if (showW && !this.weapon) {
      this.weapon = this.makeTorpedo(kind);
      this.root.add(this.weapon);
    }
    if (this.weapon) {
      this.weapon.visible = showW;
      this.weapon.position.set(stowedWeaponX(w, kind === 'sm39' ? w.missile!.length : w.weapon.length) - w.breechX + (t.eject ?? 0), 0, 0);
    }
    this.weaponGlow.visible = showW && t.energized;
    if (this.weaponGlow.visible) {
      this.weaponGlow.position.copy(this.weapon!.position);
      (this.weaponGlow.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.08 * Math.sin(tw * 4);
    }
    this.ram.position.x = 0.08 + (t.eject !== null ? Math.min(0.5, t.eject * 0.25) : 0);
    // portas
    this.breech.rotation.y = -t.breech.pos * 105 * DEG;
    this.door.rotation.z = t.door.pos * 100 * DEG;
    // TCA
    const tcaMass = ws.tca.reduce((a, k) => a + k.mass, 0);
    const tcaCap = w.tca.reduce((a, k) => a + k.capacity, 0) * RHO_NOMINAL;
    const tf = Math.max(0.01, Math.min(1, tcaMass / Math.max(1, tcaCap)));
    this.tca.water.scale.y = this.tca.h * tf;
    this.tca.water.position.y = this.tca.y0 + (this.tca.h * tf) / 2;
    // garrafa: a faixa amarela mostra a pressão
    const fb = Math.max(0.02, Math.min(1, view.flaskBar / (w.flask.pressure / 1e5)));
    this.flask.band.scale.y = fb;
    this.flask.band.position.y = 0.1 - 0.5 + fb / 2;
    // válvulas: cinza fechada, âmbar em movimento, verde aberta
    for (const [k, vv] of Object.entries(this.valves) as [keyof typeof this.valves, ValveVis][]) {
      const st = t[k];
      const m = vv.ball.material as THREE.MeshStandardMaterial;
      const col = st.pos > 0.999 ? 0x3ddc84 : st.pos > 0.001 || Math.abs(st.cmd - st.pos) > 0.01 ? 0xf5b041 : 0x6b7c8f;
      m.color.set(col);
      m.emissive.set(st.pos > 0.001 ? col : 0x000000);
      m.emissiveIntensity = 0.35;
      vv.wheel.rotation.z = st.pos * Math.PI * 3;
    }
    // escoamentos
    const filling = t.water < view.fullWater - 2;
    this.flow(this.valves.flood.path, t.flood.pos > 0.01 && t.vent.pos > 0.01 && filling, 1, 0.35, tw, 0x6cc4ff);
    this.flow(this.valves.drain.path, t.drain.pos > 0.01 && t.water > 1, 1, 0.35, tw, 0x6cc4ff);
    const ventOut = t.vent.pos > 0.01 && ((t.flood.pos > 0.01 && filling) || false);
    const ventIn = t.vent.pos > 0.01 && t.drain.pos > 0.01 && t.water > 1;
    this.flow(this.valves.vent.path, ventOut || ventIn, ventIn ? -1 : 1, 0.5, tw, 0xffffff);
    const eqOn = t.equalize.pos > 0.01 && (filling || Math.abs(t.pressure - view.seaPressure) > 0.02e5);
    this.flow(this.valves.equalize.path, eqOn, -1, 0.45, tw, 0x40e0d0);
    this.flow(this.flask.path, t.eject !== null, 1, 1.6, tw, 0xffffff);
    // bolhas: ar do suspiro saindo na sala e ar de lançamento saindo pela boca
    if (this.opts.flows && ventOut && Math.random() < 0.5) this.bubbles.emit(new THREE.Vector3(-0.4, 0.98, -0.12), 0.05, 0.6, 1.2);
    if (t.eject !== null && this.lastEject === null) for (let k = 0; k < 160; k++) this.bubbles.emit(new THREE.Vector3(L + 0.6, 0, 0), 0.4, 1.4, 2 + Math.random() * 2.5, new THREE.Vector3(3, 0, 0));
    if (t.eject !== null) for (let k = 0; k < 6; k++) this.bubbles.emit(new THREE.Vector3(L + 0.4, 0, 0), 0.3, 1.2, 1.5 + Math.random(), new THREE.Vector3(2, 0, 0));
    this.lastEject = t.eject;
    // a arma que acabou de sair: continua pela água alguns segundos
    const run = [...ws.runs].reverse().find((r) => r.tube === this.tube);
    const age = run ? e.state.t - run.tFire : 99;
    if (!t.weapon && run && age >= 0 && age < 7) {
      if (!this.exitTorp) {
        this.exitTorp = this.makeTorpedo();
        this.root.add(this.exitTorp);
      }
      const x = L + w.weapon.length / 2 + 13 * age + 1.2 * age * age;
      this.exitTorp.visible = x < 40;
      this.exitTorp.position.set(x, 0, 0);
      if (Math.random() < 0.6) this.bubbles.emit(new THREE.Vector3(x - w.weapon.length / 2, 0, 0), 0.15, 0.5, 2.5);
    } else if (this.exitTorp) this.exitTorp.visible = false;
    this.bubbles.step(dt, new THREE.Vector3(), 50);
    // destaque da etapa atual
    const fa = this.focus;
    const at: Partial<Record<TubeAction, [THREE.Vector3, number]>> = {
      alimentar: [new THREE.Vector3(stowedWeaponX(w) - w.breechX, 0, 0), 0.5],
      carregar: [new THREE.Vector3(stowedWeaponX(w) - w.breechX, 0, 0), 0.5],
      alagar: [new THREE.Vector3(1.1, -0.52, -0.12), 0.22],
      drenar: [new THREE.Vector3(2.8, -0.52, -0.12), 0.22],
      equalizar: [new THREE.Vector3(L - 1.0, 0.56, -0.12), 0.22],
      abrirPorta: [new THREE.Vector3(L + 0.08, 0, 0), 0.45],
      fecharPorta: [new THREE.Vector3(L + 0.08, 0, 0), 0.45],
      fogo: [new THREE.Vector3(-0.85, 0.1, -0.55), 0.45],
      abrirCulatra: [new THREE.Vector3(-0.05, 0, 0), 0.45],
      fecharCulatra: [new THREE.Vector3(-0.05, 0, 0), 0.45],
    };
    const h = fa ? at[fa] : undefined;
    this.halo.visible = !!h;
    if (h) {
      this.halo.position.copy(h[0]);
      const s = h[1] * (1 + 0.12 * Math.sin(tw * 5));
      this.halo.scale.set(fa === 'alimentar' || fa === 'carregar' ? w.weapon.length / 2 : s, s, s);
      this.halo.rotation.x = tw * 0.6;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  };
}
