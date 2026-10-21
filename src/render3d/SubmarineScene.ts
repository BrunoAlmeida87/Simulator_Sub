/**
 * VISUALIZAÇÃO 3D (Three.js). Apenas LÊ o estado da simulação: nenhuma
 * animação do submarino é independente da física — posição, atitude, deflexão dos lemes,
 * rotação do hélice, níveis dos tanques e bolhas dos suspiros vêm do estado.
 * A fauna é decorativa e acompanha o relógio da simulação.
 *
 * Mapeamento NED → Three.js (Y para cima): X₃ = Leste, Y₃ = −profundidade,
 * Z₃ = −Norte. Origem flutuante na posição horizontal do submarino.
 */
import { dieselExhaust, disperserOutlets } from '../sim/systems/exhaust';
import { DepthRefs } from './DepthRefs';
import { trafficAt, trafficForEnv } from '../sim/traffic';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Ocean, UnderwaterSky, addCaustics, type OceanQuality } from './Ocean';
import { LIGHTING, addRim, type RimUniforms, type SceneLighting } from './lighting';
import type { SimulationEngine } from '../sim/core/engine';
import type { SimRunner } from '../sim/core/runner';
import { qToMat3, DEG } from '../sim/core/math';
import { SystemsVis } from './Systems';
import { ForceArrows } from './ForceArrows';
import { SurfaceFx } from './SurfaceFx';
import { Markers } from './Markers';
import { TrimVis } from './TrimVis';
import { defaultLayers, type SceneLayers } from './layers';
import type { PickTarget } from '../ui/ops/opsBus';
import type { Appearance } from './sailArt';
import { SailDecals, anechoicTextures, bladeGeometry, draftMarkBand, finGeometry } from './HullDetail';
import { DRAFT_MARK_X, draftInfo } from '../sim/drafts';
import { qFromEuler, qToEuler } from '../sim/core/math';
import { ShipsLayer } from './Ships';
import { TerrainLayer, type TerrainDetail } from './Terrain';
import { ShipyardModel } from './Shipyard';
import { DEFAULT_ORIGIN, type LatLon } from '../sim/geo';
import { MarineLife } from './MarineLife';

/**
 * Câmeras: 'piloto' (lateral que acompanha), 'perseguicao', 'fixa' (parada no
 * mundo: o submarino atravessa o quadro) e enquadramentos rápidos de
 * apresentação ('superficie', 'submerso', 'tanques', 'forcas').
 */
export type ViewMode = 'piloto' | 'perseguicao' | 'perspectiva' | 'perfil' | 'frente' | 'topo' | 'livre' | 'fixa' | 'superficie' | 'submerso' | 'tanques' | 'forcas' | 'calado' | 'navio';

interface Particle {
  n: number;
  e: number;
  d: number;
  vy: number;
  life: number;
}

export interface Label3D {
  id: string;
  text: string;
  /** segunda linha (menor) */
  sub?: string;
  color?: string;
  small?: boolean;
  /** prioridade de posicionamento (0 = mais importante; ≥ 3 pode ser omitido se não couber) */
  prio?: number;
  x: number;
  y: number;
  visible: boolean;
}

const P = (n: number, e: number, d: number) => new THREE.Vector3(e, -d, -n);

/** Textura circular suave para partículas (bolhas, neve marinha, espuma). */
function dotTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SubmarineScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  private runner: SimRunner;
  private sub = new THREE.Group();
  private hullMat: THREE.MeshStandardMaterial;
  private sailMat: THREE.MeshStandardMaterial;
  private fins: Record<string, THREE.Object3D> = {};
  private prop = new THREE.Group();
  private mast!: THREE.Group;
  /** material das superfícies de controle (cor configurável) */
  private ctrlMat!: THREE.MeshStandardMaterial;
  private deckMat!: THREE.MeshStandardMaterial;
  private decals: SailDecals | null = null;
  /** marcas de calado pintadas (proa e popa, dois bordos) */
  private draftMarks: THREE.Object3D[] = [];
  /** casco externo (casco, vela, carenagens, pintura, convés e escotilhas): camada "hull" */
  private shell: THREE.Object3D[] = [];
  /** linhas de referência de trim: nível do mar (fixo no mundo) × linha d'água do casco (fixa no casco) */
  private trimLines!: THREE.LineSegments;
  /**
   * Ampliação VISUAL do ângulo de trim (1 = real). Só a pose desenhada muda;
   * a física não. A interface mostra o aviso quando > 1.
   */
  trimGain = 1;
  /** navios da mesa tática */
  private ships = new ShipsLayer();
  /** fauna decorativa; preferências compartilhadas com a segunda janela */
  readonly marineLife = new MarineLife();
  /** origem geográfica do referencial local (para posicionar os navios como no mapa) */
  geoOrigin: LatLon = DEFAULT_ORIGIN;
  /** alcance de desenho dos navios (km) */
  shipRange = 12;
  /** navios adicionais (tráfego fictício), definidos nas Configurações */
  trafficCount = 0;
  private appRev = -1;
  private texDetail: Appearance['textures'] | null = null;
  private tileTex: { hull: { map: THREE.Texture; bump: THREE.Texture } | null; sail: { map: THREE.Texture; bump: THREE.Texture } | null } = { hull: null, sail: null };
  private hullMesh!: THREE.Mesh;
  private pickables: THREE.Object3D[] = [];
  private dryBg = new THREE.Color(0x5a6b7e);
  private profile!: THREE.LineSegments;
  private systems!: SystemsVis;
  private forces!: ForceArrows;
  private fx: SurfaceFx;
  private markers!: Markers;
  private trimVis!: TrimVis;
  private keyLight = new THREE.DirectionalLight(0xffffff, 0);
  private fillLight = new THREE.AmbientLight(0xffffff, 0);
  private fixedCam: { n: number; e: number; y: number; ln: number; le: number; ly: number } | null = null;
  /** camadas visuais (alteradas pela interface a cada quadro) */
  layers: SceneLayers = defaultLayers();
  private ocean: Ocean;
  private sky: Sky;
  private underSky: UnderwaterSky;
  private sunDir = new THREE.Vector3(0.62, 0.22, -0.6).normalize();
  private caustics = { uTime: { value: 0 }, uCaustic: { value: 0 } };
  private wallTime = 0;
  readonly quality: OceanQuality;
  /** fundo do mar e terra (mesma função de profundidade da física), com níveis de detalhe */
  private terrain: TerrainLayer | null = null;
  /** detalhe do terreno (Configurações → Qualidade gráfica) */
  terrainDetail: TerrainDetail = 'media';
  private shipyard: ShipyardModel | null = null;
  private shipyardDist = Infinity;
  private particles: Particle[] = [];
  /** bolhas pequenas da descarga dos diesel-geradores pelos dispersores (atrás da vela) */
  private exParticles: Particle[] = [];
  private exBubbles: THREE.Points;
  private static readonly EX_MAX = 450;
  /** partículas em suspensão (fixas no mundo) — referência visual de movimento */
  private snow: THREE.Points;
  private depthRefs: DepthRefs;
  /** referências discretas de profundidade (Configurações → Gráficos) */
  depthRefsOn = true;
  private snowBase: Float32Array;
  private static readonly SNOW_N = 1400;
  private static readonly SNOW_BOX = { h: 140, v: 60 };
  private bubbles: THREE.Points;
  private trail: THREE.Line;
  private depthLine: THREE.Line;
  private lastSubPos = new THREE.Vector3();
  private view: ViewMode = 'perspectiva';
  private viewBlend = 1;
  private viewFrom = new THREE.Vector3();
  realisticFog = true;
  /** perfil de iluminação (apenas visual) */
  lighting: SceneLighting = 'clara';
  private rim: RimUniforms = { uRim: { value: 0 }, uRimColor: { value: new THREE.Color(0xa8dcff) } };
  private clock = new THREE.Clock();
  private dot = dotTexture();
  private env: () => SimulationEngine;

  constructor(private container: HTMLElement, runner: SimRunner, initialView: ViewMode = 'perspectiva', quality: OceanQuality = 'alta') {
    this.quality = quality;
    this.runner = runner;
    this.env = () => this.runner.engine;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.62;
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 30000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 3000;
    this.controls.addEventListener('start', () => {
      if (this.view !== 'livre') this.view = 'livre';
    });

    // luzes
    this.scene.add(new THREE.HemisphereLight(0xbfdfff, 0x0b1a26, 1.3));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    sun.position.copy(this.sunDir).multiplyScalar(1000);
    this.scene.add(sun);
    // luzes de apresentação (presas à câmera)
    this.keyLight.position.set(0.4, 0.6, 1);
    this.camera.add(this.keyLight, this.fillLight);
    this.scene.add(this.camera);

    // céu atmosférico (Preetham)
    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    const su = this.sky.material.uniforms;
    su.turbidity.value = 5;
    su.rayleigh.value = 2.2;
    su.mieCoefficient.value = 0.004;
    su.mieDirectionalG.value = 0.85;
    su.sunPosition.value.copy(this.sunDir);
    this.scene.add(this.sky);

    // submarino
    this.hullMat = new THREE.MeshStandardMaterial({ color: 0x3a4654, metalness: 0.3, roughness: 0.5, emissive: 0x0e1923 });
    addCaustics(this.hullMat, this.caustics, 14);
    addRim(this.hullMat, this.rim);
    this.sailMat = new THREE.MeshStandardMaterial({ color: 0x3a4654, metalness: 0.3, roughness: 0.5, emissive: 0x0e1923 });
    addCaustics(this.sailMat, this.caustics, 14);
    addRim(this.sailMat, this.rim);
    this.buildSubmarine();
    this.scene.add(this.sub);
    this.scene.add(this.trimLines);
    this.forces = new ForceArrows(this.env());
    this.scene.add(this.forces.group);
    this.trimVis = new TrimVis(this.env());
    this.sub.add(this.trimVis.local);
    this.scene.add(this.trimVis.world);
    this.fx = new SurfaceFx(this.dot, quality === 'baixa' ? 0.5 : 1);
    this.scene.add(this.fx.group);
    this.markers = new Markers(this.env(), this.dot);
    this.scene.add(this.markers.group);
    this.scene.add(this.ships.group);
    this.scene.add(this.marineLife.group);

    // oceano: mesmas componentes de onda da física, deslocadas em GPU
    this.ocean = new Ocean(quality, this.sunDir);
    this.scene.add(this.ocean.mesh);
    this.underSky = new UnderwaterSky(this.sunDir);
    this.scene.add(this.underSky.mesh);

    // bolhas
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(600 * 3), 3));
    this.bubbles = new THREE.Points(bg, new THREE.PointsMaterial({ color: 0xdff2ff, size: 0.9, transparent: true, opacity: 0.85, map: this.dot, depthWrite: false }));
    this.bubbles.frustumCulled = false;
    this.scene.add(this.bubbles);
    {
      const eg = new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SubmarineScene.EX_MAX * 3), 3));
      this.exBubbles = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0xe4ecef, size: 0.45, transparent: true, opacity: 0.75, map: this.dot, depthWrite: false }));
      this.exBubbles.frustumCulled = false;
      this.scene.add(this.exBubbles);
    }

    // partículas em suspensão (neve marinha), fixas no referencial do mundo
    const nS = SubmarineScene.SNOW_N;
    this.snowBase = new Float32Array(nS * 3);
    for (let i = 0; i < nS; i++) {
      this.snowBase[i * 3] = Math.random() * SubmarineScene.SNOW_BOX.h;
      this.snowBase[i * 3 + 1] = Math.random() * SubmarineScene.SNOW_BOX.h;
      this.snowBase[i * 3 + 2] = Math.random() * SubmarineScene.SNOW_BOX.v;
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(nS * 3), 3));
    this.snow = new THREE.Points(sgeo, new THREE.PointsMaterial({ color: 0xbfe3ff, size: 0.5, transparent: true, opacity: 0.6, depthWrite: false, map: this.dot }));
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
    // referências discretas de profundidade (faixas de partículas e sombra no fundo)
    this.depthRefs = new DepthRefs(this.dot);
    this.scene.add(this.depthRefs.group);

    // trajetória e linha de profundidade
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(1600 * 3), 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.8 }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    this.depthLine = new THREE.Line(dg, new THREE.LineDashedMaterial({ color: 0xb48cff, dashSize: 2, gapSize: 2 }));
    this.depthLine.frustumCulled = false;
    this.scene.add(this.depthLine);

    this.resize();
    const s = this.env().state;
    this.lastSubPos.copy(P(0, 0, s.body.pos.z));
    this.view = initialView;
    this.camera.position.copy(this.cameraTarget(initialView === 'livre' ? 'perspectiva' : initialView));
    this.viewFrom.copy(this.camera.position);
    this.controls.target.copy(this.lastSubPos);
  }

  private buildSubmarine(): void {
    const e = this.env();
    const v = e.vessel;
    const L = v.hull.length;
    const R = v.hull.diameter / 2;
    // casco (torno do perfil r(x))
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 160; i++) {
      const x = -L / 2 + (i / 160) * L;
      pts.push(new THREE.Vector2(Math.max(0.001, e.geom.radiusAt(x)), x));
    }
    const hg = new THREE.LatheGeometry(pts, 48);
    hg.rotateX(-Math.PI / 2);
    const hull = new THREE.Mesh(hg, this.hullMat);
    this.hullMesh = hull;
    this.sub.add(hull);
    this.shell.push(hull);
    // contorno do casco (perfil lateral e planta) para o corte
    {
      const segs: number[] = [];
      const N = 120;
      const pt = (x: number, y: number, z: number) => [y, -z, -x];
      for (let i = 0; i < N; i++) {
        const x0 = -L / 2 + (i / N) * L;
        const x1 = -L / 2 + ((i + 1) / N) * L;
        const r0 = e.geom.radiusAt(x0);
        const r1 = e.geom.radiusAt(x1);
        for (const sgn of [-1, 1]) {
          segs.push(...pt(x0, 0, sgn * r0), ...pt(x1, 0, sgn * r1));
          segs.push(...pt(x0, sgn * r0, 0), ...pt(x1, sgn * r1, 0));
        }
      }
      const sv0 = v.hull.sail;
      const top = -(R + sv0.height);
      for (const [a, b] of [
        [pt(sv0.xAft, 0, -R + 0.3), pt(sv0.xAft, 0, top)],
        [pt(sv0.xAft, 0, top), pt(sv0.xFwd, 0, top)],
        [pt(sv0.xFwd, 0, top), pt(sv0.xFwd, 0, -R + 0.3)],
      ])
        segs.push(...a, ...b);
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      this.profile = new THREE.LineSegments(pg, new THREE.LineBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false }));
      this.profile.renderOrder = 7;
      this.profile.visible = false;
      this.sub.add(this.profile);
    }
    // vela (perfil em estádio extrudado)
    const sv = v.hull.sail;
    const len = sv.xFwd - sv.xAft;
    const w = sv.width / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-w, sv.xAft + w);
    shape.lineTo(-w, sv.xFwd - len * 0.25);
    shape.quadraticCurveTo(-w, sv.xFwd, 0, sv.xFwd);
    shape.quadraticCurveTo(w, sv.xFwd, w, sv.xFwd - len * 0.25);
    shape.lineTo(w, sv.xAft + w);
    shape.quadraticCurveTo(w, sv.xAft, 0, sv.xAft);
    shape.quadraticCurveTo(-w, sv.xAft, -w, sv.xAft + w);
    const sg = new THREE.ExtrudeGeometry(shape, { depth: sv.height + 0.6, bevelEnabled: false, curveSegments: 8 });
    sg.rotateX(-Math.PI / 2);
    const sail = new THREE.Mesh(sg, this.sailMat);
    sail.position.y = R - 0.6;
    this.sub.add(sail);
    this.shell.push(sail);
    // topo da vela: carenagens dos mastros recolhidos (decorativas)
    {
      const capMat = new THREE.MeshStandardMaterial({ color: 0x2e3946, metalness: 0.35, roughness: 0.55 });
      for (const [x, r, h] of [
        [sv.xFwd - 2.0, 0.28, 0.35],
        [sv.xFwd - 3.4, 0.22, 0.3],
        [sv.xAft + 2.2, 0.3, 0.32],
      ] as const) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, h, 14), capMat);
        c.position.set(0, R + sv.height + h / 2, -x);
        this.sub.add(c);
        this.shell.push(c);
      }
    }
    // pintura da vela (emblema + inscrição) na parte alta, acima dos lemes de vela
    {
      const xFlat0 = sv.xAft + w;
      const xFlat1 = sv.xFwd - len * 0.25;
      const fb0 = v.fins.find((f) => f.id === 'bow');
      const planeTop = fb0 ? -fb0.position.z + 0.2 : R + sv.height * 0.45;
      const top = R + sv.height - 0.15;
      const dh = Math.max(1.2, Math.min(top - planeTop, (xFlat1 - xFlat0) / 2));
      this.decals = new SailDecals((xFlat0 + xFlat1) / 2, w, top - dh / 2, dh * 2, dh, 1024);
      this.sub.add(this.decals.group);
    }
    // mastro do snorkel (mais grosso que antes para ficar visível; o curso e a altura da cabeça são os da física)
    {
      const ext = v.hull.snorkelMast.extension;
      const mastMat = new THREE.MeshStandardMaterial({ color: 0x5f6b78, metalness: 0.5, roughness: 0.38 });
      const headMat = new THREE.MeshStandardMaterial({ color: 0x8b97a3, metalness: 0.45, roughness: 0.35 });
      const bandMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.2, roughness: 0.5, emissive: 0x202428 });
      this.mast = new THREE.Group();
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, ext, 18), mastMat);
      // cabeça (válvula de cabeça / boia) no topo
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 0.95, 18), headMat);
      head.position.y = ext / 2 - 0.35;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.51, 0.51, 0.16, 18), bandMat);
      band.position.y = ext / 2 - 0.55;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), headMat);
      cap.position.y = ext / 2 + 0.12;
      this.mast.add(tube, head, band, cap);
      this.mast.position.set(0, R + sv.height - ext / 2, -v.hull.snorkelMast.x);
      this.sub.add(this.mast);
    }
    // convés (chapa plana sobre o casco cilíndrico)
    {
      this.deckMat = new THREE.MeshStandardMaterial({ color: 0x323c48, metalness: 0.25, roughness: 0.75 });
      addRim(this.deckMat, this.rim);
      const xa = -v.hull.length / 2 + v.hull.sternLength + 1;
      const xf = v.hull.length / 2 - v.hull.bowLength - 1;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, xf - xa), this.deckMat);
      deck.position.set(0, R - 0.02, -(xa + xf) / 2);
      this.sub.add(deck);
      this.shell.push(deck);
      // escotilhas
      const hatchMat = new THREE.MeshStandardMaterial({ color: 0x252e38, metalness: 0.3, roughness: 0.6 });
      for (const x of [xf - 3, sv.xAft - 3, xa + 4]) {
        const hch = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 20), hatchMat);
        hch.position.set(0, R + 0.1, -x);
        this.sub.add(hch);
        this.shell.push(hch);
      }
    }
    // superfícies
    const finMat = new THREE.MeshStandardMaterial({ color: 0x3a4652, metalness: 0.3, roughness: 0.6 });
    addRim(finMat, this.rim);
    const ctrlMat = new THREE.MeshStandardMaterial({ color: 0xc2763a, metalness: 0.2, roughness: 0.55 });
    this.ctrlMat = ctrlMat;
    const makeH = (x: number, z: number, span: number, chord: number, mat: THREE.Material, id: string | null, root?: number) => {
      const r0 = root ?? Math.max(0.3, e.geom.radiusAt(x) - 0.1);
      const g = new THREE.Group();
      for (const side of [-1, 1]) {
        const piv = new THREE.Group();
        piv.position.set(side * (r0 + span / 2), -z, -x);
        const m = new THREE.Mesh(finGeometry(span, chord, 0.3, true), mat);
        m.scale.x = side; // ponta para fora nos dois bordos
        m.position.z = chord * 0.2;
        if (id) {
          m.userData.pick = { kind: 'fin', id };
          this.pickables.push(m);
        }
        piv.add(m);
        g.add(piv);
        if (id) (this.fins[id + (side < 0 ? 'L' : 'R')] = piv);
      }
      this.sub.add(g);
    };
    const makeV = (x: number, span: number, chord: number, mat: THREE.Material, id: string | null) => {
      const r0 = Math.max(0.3, e.geom.radiusAt(x) - 0.1);
      for (const side of [-1, 1]) {
        const piv = new THREE.Group();
        piv.position.set(0, side * (r0 + span / 2), -x);
        const m = new THREE.Mesh(finGeometry(span, chord, 0.3, false), mat);
        m.scale.y = side;
        m.position.z = chord * 0.2;
        if (id) {
          m.userData.pick = { kind: 'fin', id };
          this.pickables.push(m);
        }
        piv.add(m);
        this.sub.add(piv);
        if (id) this.fins[id + (side < 0 ? 'D' : 'U')] = piv;
      }
    };
    // lemes de vante na vela (posição da física) e superfícies de ré totalmente móveis (sem estabilizadores fixos)
    const fb = v.fins.find((f) => f.id === 'bow')!;
    makeH(fb.position.x, fb.position.z, 2.6, 2.0, ctrlMat, 'bow', v.hull.sail.width / 2);
    const fs = v.fins.find((f) => f.id === 'stern')!;
    makeH(fs.position.x, 0, 3.3, 3.0, ctrlMat, 'stern');
    const fr = v.fins.find((f) => f.id === 'rudder')!;
    makeV(fr.position.x, 3.3, 3.0, ctrlMat, 'rudder');
    // hélice
    const hub = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.6, 16), finMat);
    hub.rotation.x = -Math.PI / 2;
    this.prop.add(hub);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 0.75, roughness: 0.28, side: THREE.DoubleSide });
    const nb = v.propulsion.propeller.blades;
    const Rp = v.propulsion.propeller.diameter / 2;
    const bg = bladeGeometry(0.35, Rp);
    for (let k = 0; k < nb; k++) {
      const arm = new THREE.Group();
      arm.rotation.z = (k / nb) * Math.PI * 2;
      arm.add(new THREE.Mesh(bg, bladeMat));
      this.prop.add(arm);
    }
    this.prop.position.set(0, 0, L / 2 + 0.6);
    this.prop.userData.pick = { kind: 'prop', id: 'prop' };
    this.pickables.push(this.prop);
    this.mast.userData.pick = { kind: 'mast', id: 'snorkel' };
    this.pickables.push(this.mast);
    this.sub.add(this.prop);

    // marcas de calado (proa e popa, dois bordos)
    for (const xm of [DRAFT_MARK_X.fwd, DRAFT_MARK_X.aft])
      for (const side of [1, -1] as const) {
        const m = draftMarkBand(e.geom.radiusAt, xm, side);
        if (m) {
          this.draftMarks.push(m);
          this.sub.add(m);
        }
      }
    // linhas de referência de trim (atualizadas a cada quadro; camada "Calado/trim")
    {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(8 * 3), 3));
      lg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(8 * 3), 3));
      this.trimLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, transparent: true, toneMapped: false, fog: false }));
      this.trimLines.renderOrder = 30;
      this.trimLines.frustumCulled = false;
      this.trimLines.visible = false;
    }
    // tanques, tubulações e escoamentos (corte)
    this.systems = new SystemsVis(e, this.dot);
    this.sub.add(this.systems.group);
    this.systems.group.traverse((o) => {
      // desenhados depois do oceano (que não grava profundidade): visíveis também abaixo da linha d'água
      if (o.renderOrder < 6) o.renderOrder = 6;
    });
  }

  /**
   * Aplica a aparência (identificação e detalhe das texturas). Chamado a cada
   * quadro pela interface; só refaz algo quando rev muda. Puramente visual.
   */
  setAppearance(a: Appearance, rev: number): void {
    if (rev === this.appRev) return;
    this.appRev = rev;
    this.ctrlMat.color.set(a.finColor);
    this.ctrlMat.emissive.set(a.finColor).multiplyScalar(0.22);
    this.decals?.update(a);
    if (a.textures !== this.texDetail) {
      this.texDetail = a.textures;
      this.buildTileTextures(a.textures);
    }
    this.hullState = { ...this.hullState, op: -1 };
  }

  /** placas anecoicas: casco (UV do torno) e vela (UV em metros) */
  private buildTileTextures(detail: Appearance['textures']): void {
    for (const t of [this.tileTex.hull, this.tileTex.sail]) {
      t?.map.dispose();
      t?.bump.dispose();
    }
    const size = detail === 'alta' ? 1024 : 512;
    const base = anechoicTextures(size, 8);
    if (!base) return;
    const v = this.env().vessel;
    const tile = 0.55; // m por placa
    const circ = Math.PI * v.hull.diameter;
    const hull = { map: base.map, bump: base.bump };
    for (const t of [hull.map, hull.bump]) t.repeat.set(Math.round(circ / (8 * tile)), v.hull.length / (8 * tile));
    const sail = { map: base.map.clone(), bump: base.bump.clone() };
    for (const t of [sail.map, sail.bump]) {
      t.repeat.set(1 / (8 * tile), 1 / (8 * tile));
      t.needsUpdate = true;
    }
    this.tileTex = { hull, sail };
    const bumpScale = detail === 'alta' ? 0.35 : 0.12;
    for (const [m, tx] of [
      [this.hullMat, hull],
      [this.sailMat, sail],
    ] as const) {
      m.map = tx.map;
      m.bumpMap = tx.bump;
      m.bumpScale = bumpScale;
      m.needsUpdate = true;
    }
  }

  resize(): void {
    const w = Math.max(10, this.container.clientWidth);
    const h = Math.max(10, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setView(v: ViewMode): void {
    this.viewFrom.copy(this.camera.position);
    this.view = v;
    this.viewBlend = v === 'livre' ? 1 : 0;
    if (v === 'fixa') this.fixedCam = null;
  }

  get viewMode(): ViewMode {
    return this.view;
  }

  /** Posição da câmera e do alvo relativas ao submarino (para restaurar a vista livre). */
  getCameraPose(): { pos: [number, number, number]; target: [number, number, number] } {
    const p = this.camera.position.clone().sub(this.lastSubPos);
    const t = this.controls.target.clone().sub(this.lastSubPos);
    return { pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
  }

  setCameraPose(c: { pos: [number, number, number]; target: [number, number, number] }): void {
    this.camera.position.set(...c.pos).add(this.lastSubPos);
    this.controls.target.set(...c.target).add(this.lastSubPos);
    this.viewFrom.copy(this.camera.position);
    this.controls.update();
  }

  /**
   * Câmera FIXA no mundo: posicionada à frente e ao lado da derrota; o
   * submarino entra, atravessa o quadro e sai. Reposiciona-se quando o casco
   * passa bem além do ponto de mira.
   */
  private updateFixedCamera(pn: number, pe: number, pd: number): void {
    const psi = (this.env().outputs.euler.heading * Math.PI) / 180;
    const fn = Math.cos(psi);
    const fe = Math.sin(psi);
    const asp = Math.max(0.3, this.camera.aspect);
    let fc = this.fixedCam;
    const surfaced = pd < 8;
    if (fc) {
      const along = (pn - fc.ln) * fn + (pe - fc.le) * fe;
      if (along > 95 || along < -260 || Math.hypot(pn - fc.n, pe - fc.e) > 700) fc = null;
    }
    if (!fc) {
      // mira 45 m à frente: o casco começa no quadro e o atravessa
      const ahead = 45;
      const side = Math.max(100, 110 / asp);
      const ln = pn + fn * ahead;
      const le = pe + fe * ahead;
      const ly = -pd;
      fc = { n: ln - fe * side, e: le + fn * side, y: surfaced ? 9 : Math.min(-3, ly + 2), ln, le, ly };
      this.fixedCam = fc;
    }
    this.camera.position.set(fc.e - pe, fc.y, -(fc.n - pn));
    this.controls.target.set(fc.le - pe, surfaced ? -1 : fc.ly, -(fc.ln - pn));
  }

  setCutaway(on: boolean): void {
    this.layers = { ...this.layers, tanks: on };
  }

  /** Objeto selecionável sob o ponto da tela (px relativos ao contêiner): lemes, hélice, mastro, tanques, válvulas, bombas, bateria… */
  pick(x: number, y: number): PickTarget | null {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), this.camera);
    const list = [...this.pickables, ...this.systems.pickables, this.trimVis.block];
    const hits = rc.intersectObjects(list, true);
    const visible = (o: THREE.Object3D | null): boolean => {
      for (let n = o; n; n = n.parent) if (!n.visible) return false;
      return true;
    };
    // objetos pequenos (válvulas, bombas, lemes) têm preferência sobre volumes grandes (tanques)
    let best: { t: PickTarget; d: number; pr: number } | null = null;
    for (const hit of hits) {
      if (!visible(hit.object)) continue;
      let n: THREE.Object3D | null = hit.object;
      while (n && !n.userData.pick) n = n.parent;
      if (!n) continue;
      const t = n.userData.pick as PickTarget;
      const pr = t.kind === 'tank' || t.kind === 'battery' ? 1 : 0;
      if (!best || pr < best.pr || (pr === best.pr && hit.distance < best.d)) best = { t, d: hit.distance, pr };
    }
    return best ? best.t : null;
  }

  /** Tanque sob o ponto da tela (px relativos ao contêiner), ou null. */
  pickTank(x: number, y: number): string | null {
    if (!this.layers.tanks) return null;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    return this.systems.pick(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), this.camera);
  }

  private hullState = { cut: false, op: 1, pres: false, light: '', shell: true };
  private applyHull(): void {
    const cut = this.layers.tanks;
    const op = cut ? Math.max(0.04, Math.min(1, this.layers.hullOpacity)) : 1;
    const pres = this.layers.presLight;
    const light = this.lighting;
    // casco externo oculto: ficam os lemes, o hélice, o mastro e (com o corte) os componentes internos
    const shell = this.layers.hull !== false;
    const hs = this.hullState;
    if (hs.cut === cut && hs.op === op && hs.pres === pres && hs.light === light && hs.shell === shell) return;
    for (const o of this.shell) o.visible = shell;
    const hc = pres ? LIGHTING.estudio.hull : (LIGHTING[light] ?? LIGHTING.clara).hull;
    for (const [m, tx] of [
      [this.hullMat, this.tileTex.hull],
      [this.sailMat, this.tileTex.sail],
    ] as const) {
      m.transparent = op < 0.999;
      m.opacity = op;
      m.color.set(cut ? 0x9cc0e4 : hc.color);
      m.emissive.set(hc.emissive);
      m.depthWrite = op >= 0.999;
      // no corte as placas do revestimento atrapalham a leitura dos tanques
      m.map = cut ? null : (tx?.map ?? null);
      m.bumpMap = cut ? null : (tx?.bump ?? null);
      m.needsUpdate = true;
    }
    this.deckMat.transparent = op < 0.999;
    this.deckMat.opacity = op;
    this.deckMat.depthWrite = op >= 0.999;
    if (this.decals) this.decals.group.visible = !cut && shell;
    for (const m of this.draftMarks) m.visible = !cut && shell;
    // no corte o casco é desenhado depois do oceano (fica visível abaixo da linha d'água)
    this.hullMesh.renderOrder = cut ? 5 : 0;
    // sem o casco, o contorno lateral fica como referência da forma
    this.profile.visible = cut || !shell;
    this.hullState = { cut, op, pres, light, shell };
  }

  private headingVectors(): { fwd: THREE.Vector3; stbd: THREE.Vector3 } {
    const psi = (this.env().outputs.euler.heading * Math.PI) / 180;
    return { fwd: new THREE.Vector3(Math.sin(psi), 0, -Math.cos(psi)), stbd: new THREE.Vector3(Math.cos(psi), 0, Math.sin(psi)) };
  }

  /** Deslocamento da vista lateral para a frente (mostra a água à proa) — nulo em telas estreitas. */
  private pilotLead(): number {
    return this.camera.aspect > 1.3 ? 13 : 0;
  }

  /** altura da câmera lateral: acima d'água com o casco na superfície, no nível do eixo quando submerso */
  private sideCamY(below = 1.0, above = 7): number {
    const axisDepth = -this.lastSubPos.y;
    const k = Math.min(1, Math.max(0, (axisDepth - 5) / 9));
    const kk = k * k * (3 - 2 * k);
    return above * (1 - kk) + Math.min(this.lastSubPos.y - below, -1.2) * kk;
  }

  private cameraTarget(v: ViewMode): THREE.Vector3 {
    const v0L = this.env().vessel.hull.length;
    const { fwd, stbd } = this.headingVectors();
    const c = this.lastSubPos.clone();
    const asp = Math.max(0.3, this.camera.aspect);
    switch (v) {
      case 'superficie': {
        const k = Math.max(1, 1.3 / asp);
        return c.add(fwd.multiplyScalar(-60 * k)).add(stbd.multiplyScalar(62 * k)).setY(Math.max(26 * k, c.y + 26 * k));
      }
      case 'submerso': {
        const cam = c.add(stbd.multiplyScalar(Math.max(80, 90 / asp))).add(fwd.multiplyScalar(6));
        cam.y = Math.min(this.lastSubPos.y + 3, -3);
        return cam;
      }
      case 'tanques': {
        const cam = c.add(stbd.multiplyScalar(Math.max(58, 66 / asp)));
        cam.y = this.lastSubPos.y + 10;
        return cam;
      }
      case 'navio': {
        // atrás e acima do submarino, olhando para o navio mais próximo
        const sh = this.ships.nearest;
        if (!sh) return c.add(fwd.multiplyScalar(-70)).add(new THREE.Vector3(0, 25, 0));
        const dir = sh.pos.clone().sub(c).setY(0).normalize();
        return c.add(dir.multiplyScalar(-55)).add(new THREE.Vector3(0, 14, 0));
      }
      case 'calado': {
        // lateral rente à água, teleobjetiva: o casco inteiro no quadro e a linha d'água em perfil
        const half = Math.tan(((this.camera.fov / 2) * Math.PI) / 180) * asp;
        const dist = (v0L / 2 + 10) / Math.max(0.05, half);
        const cam = c.add(stbd.multiplyScalar(dist));
        cam.y = this.lastSubPos.y > -6 ? 1.2 : this.lastSubPos.y + 1.2;
        return cam;
      }
      case 'forcas': {
        const cam = c.add(stbd.multiplyScalar(Math.max(90, 100 / asp)));
        cam.y = this.sideCamY(0.5, 6);
        return cam;
      }
      case 'piloto': {
        // lateral (boreste), ligeiramente abaixo do eixo e à frente: o submarino avança da esquerda para a direita.
        // Distância ajustada à proporção da tela para o casco inteiro caber (telas em retrato).
        const dist = Math.max(95, 100 / asp);
        const cam = c.add(stbd.multiplyScalar(dist)).add(fwd.clone().multiplyScalar(this.pilotLead()));
        cam.y = this.sideCamY();
        return cam;
      }
      case 'perseguicao':
        return c.add(fwd.multiplyScalar(-Math.max(95, 70 / Math.max(0.3, this.camera.aspect)))).add(stbd.multiplyScalar(18)).add(new THREE.Vector3(0, 16, 0));
      case 'perfil':
        return c.add(stbd.multiplyScalar(140)).add(new THREE.Vector3(0, 4, 0));
      case 'frente':
        return c.add(fwd.multiplyScalar(110)).add(new THREE.Vector3(0, 6, 0));
      case 'topo':
        return c.add(new THREE.Vector3(0, 170, 0)).add(fwd.multiplyScalar(-1));
      default:
        return c.add(fwd.multiplyScalar(-70)).add(stbd.multiplyScalar(75)).add(new THREE.Vector3(0, 32, 0));
    }
  }

  /** cria/recria o terreno quando o nível de detalhe muda */
  private ensureTerrain(): TerrainLayer {
    if (!this.terrain || this.terrain.detail !== this.terrainDetail) {
      if (this.terrain) {
        this.scene.remove(this.terrain.group);
        this.terrain.dispose();
      }
      this.terrain = new TerrainLayer(this.terrainDetail, (m) => addCaustics(m, this.caustics, 45));
      this.scene.add(this.terrain.group);
    }
    return this.terrain;
  }

  /** Atualiza a cena a partir do estado e renderiza. Retorna rótulos de sobreposição. */
  render(): Label3D[] {
    const e = this.env();
    const s = e.state;
    const dtR = Math.min(0.1, this.clock.getDelta());
    const a = this.runner.alpha;
    // instante das ondas coerente com a pose interpolada
    const tWave = s.t - e.config.settings.dt * (1 - a);
    // pose interpolada entre o passo anterior e o atual
    const pn = e.prevPos.x + (s.body.pos.x - e.prevPos.x) * a;
    const pe = e.prevPos.y + (s.body.pos.y - e.prevPos.y) * a;
    const pd = e.prevPos.z + (s.body.pos.z - e.prevPos.z) * a;
    const subPos = P(0, 0, pd);
    const q0 = new THREE.Quaternion(e.prevQuat.x, e.prevQuat.y, e.prevQuat.z, e.prevQuat.w);
    const q1 = new THREE.Quaternion(s.body.quat.x, s.body.quat.y, s.body.quat.z, s.body.quat.w);
    if (q0.dot(q1) < 0) q1.set(-q1.x, -q1.y, -q1.z, -q1.w);
    q0.slerp(q1, a);
    if (this.trimGain !== 1) {
      // ampliação visual do trim (demonstração): só o ângulo de pitch desenhado é multiplicado
      const eu = qToEuler({ w: q0.w, x: q0.x, y: q0.y, z: q0.z });
      const th = Math.max(-0.5, Math.min(0.5, eu.theta * this.trimGain));
      const qq = qFromEuler(eu.phi, th, eu.psi);
      q0.set(qq.x, qq.y, qq.z, qq.w);
    }
    const R = qToMat3({ w: q0.w, x: q0.x, y: q0.y, z: q0.z });
    // M₃ = P·R·Pᵀ com P: (n,e,d) → (e, −d, −n)
    const m = new THREE.Matrix4();
    m.set(R[4], -R[5], -R[3], 0, -R[7], R[8], R[6], 0, -R[1], R[2], R[0], 0, 0, 0, 0, 1);
    this.sub.quaternion.setFromRotationMatrix(m);
    this.sub.position.copy(subPos);

    // superfícies de controle (ângulos geométricos reais)
    for (const f of e.vessel.fins) {
      const st = s.surfaces[f.id];
      if (!st) continue;
      const g = st.actual * f.commandSign * DEG;
      if (f.orientation === 'horizontal') {
        for (const k of ['L', 'R']) if (this.fins[f.id + k]) this.fins[f.id + k].rotation.x = g;
      } else {
        for (const k of ['U', 'D']) if (this.fins[f.id + k]) this.fins[f.id + k].rotation.y = g;
      }
    }
    this.prop.rotation.z = -s.propulsion.shaftAngle;
    const v = e.vessel;
    const R0 = v.hull.diameter / 2;
    this.mast.position.y = R0 + v.hull.sail.height - v.hull.snorkelMast.extension / 2 - 0.5 + s.snorkel.pos * v.hull.snorkelMast.extension;

    // fundo e terra (reconstruídos ao afastar-se ou quando o fundo/costa mudam)
    const coastOn = !!e.env.cfg.geo?.coast;
    const terrain = this.ensureTerrain();
    terrain.update(e.env, pn, pe, coastOn);
    // estaleiro e base naval (só com a costa ligada: faz parte da costa, também na física)
    if (coastOn && e.env.cfg.geo) {
      if (!this.shipyard) {
        this.shipyard = new ShipyardModel(this.quality);
        this.scene.add(this.shipyard.group);
      }
      this.shipyardDist = this.shipyard.place(e.env.cfg.geo.origin, pn, pe, this.camera.position);
    } else if (this.shipyard) this.shipyard.group.visible = false;

    // bolhas dos suspiros/embornais (taxa proporcional à vazão de ar simulada)
    const Rm = qToMat3(s.body.quat);
    const toWorld = (bx: number, by: number, bz: number) => ({
      n: s.body.pos.x + Rm[0] * bx + Rm[1] * by + Rm[2] * bz,
      e: s.body.pos.y + Rm[3] * bx + Rm[4] * by + Rm[5] * bz,
      d: s.body.pos.z + Rm[6] * bx + Rm[7] * by + Rm[8] * bz,
    });
    const step = this.runner.running ? dtR * this.runner.timeScale : 0;
    const wv = e.env.waves;
    if (step > 0) {
      for (const t of v.ballast.tanks) {
        const st = s.ballast[t.id];
        const r = e.geom.radiusAt(t.center.x);
        const side = t.center.y < 0 ? -1 : 1;
        // suspiro (convés) e embornais (fundo): só emitem bolhas quando submersos
        const srcs: [number, { n: number; e: number; d: number }][] = [
          [st.mdotVent, toWorld(t.center.x + (t.center.x > 0 ? 0.8 : -0.8), side * r * 0.27, -r - 0.2)],
          [st.mdotSpill, toWorld(t.center.x, side * r * 0.5, r + 0.4)],
        ];
        for (const [mdot, src] of srcs) {
          if (mdot < 0.01 || src.d + wv.elevation(src.n, src.e, tWave) < 0) continue;
          const nEmit = Math.min(120, mdot * 25) * step;
          let k = Math.floor(nEmit) + (Math.random() < nEmit % 1 ? 1 : 0);
          while (k-- > 0 && this.particles.length < 600) {
            this.particles.push({ n: src.n + (Math.random() - 0.5) * 2, e: src.e + (Math.random() - 0.5) * 2, d: src.d, vy: 0.8 + Math.random() * 0.8, life: 60 });
          }
        }
      }
      // descarga dos diesel-geradores pelos dispersores (mastro recolhido, gerador em carga): ver sim/systems/exhaust.ts
      const ex = dieselExhaust(v, s);
      if (ex.route === 'dispersores') {
        const rate = (6 + 14 * ex.load + (ex.starting ? 12 : 0)) * step; // bolhas/s por saída: fluxo moderado
        for (const o of disperserOutlets(v, e.geom.radiusAt)) {
          const src = toWorld(o.x, o.y, o.z);
          if (src.d + wv.elevation(src.n, src.e, tWave) < 0.3) continue; // saída fora d'água: sem bolhas
          let k = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
          while (k-- > 0 && this.exParticles.length < SubmarineScene.EX_MAX) {
            this.exParticles.push({ n: src.n + (Math.random() - 0.5) * 0.6, e: src.e + (Math.random() - 0.5) * 0.6, d: src.d + Math.random() * 0.2, vy: 0.35 + Math.random() * 0.45, life: 40 });
          }
        }
      }
      this.exParticles = this.exParticles.filter((p) => {
        p.d -= p.vy * step;
        p.life -= step;
        p.n += (Math.random() - 0.5) * 0.12;
        p.e += (Math.random() - 0.5) * 0.12;
        const alive = p.d > -wv.elevation(p.n, p.e, tWave) && p.life > 0;
        if (!alive && p.life > 0 && Math.random() < 0.25) this.fx.bubbleSurfaced(p.n, p.e);
        return alive;
      });
      this.particles = this.particles.filter((p) => {
        p.d -= p.vy * step;
        p.life -= step;
        p.n += (Math.random() - 0.5) * 0.3;
        p.e += (Math.random() - 0.5) * 0.3;
        const alive = p.d > -wv.elevation(p.n, p.e, tWave) && p.life > 0;
        if (!alive && p.life > 0) this.fx.bubbleSurfaced(p.n, p.e);
        return alive;
      });
    }
    const bp = this.bubbles.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < 600; i++) {
      const p = this.particles[i];
      if (p) bp.setXYZ(i, p.e - pe, -p.d, -(p.n - pn));
      else bp.setXYZ(i, 0, -1e6, 0);
    }
    bp.needsUpdate = true;
    const ep = this.exBubbles.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < SubmarineScene.EX_MAX; i++) {
      const p = this.exParticles[i];
      if (p) ep.setXYZ(i, p.e - pe, -p.d, -(p.n - pn));
      else ep.setXYZ(i, 0, -1e6, 0);
    }
    ep.needsUpdate = true;

    // neve marinha: posições fixas no mundo, reenquadradas numa caixa em torno do submarino
    {
      const B = SubmarineScene.SNOW_BOX;
      const sp = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
      const mod = (a: number, m: number) => ((a % m) + m) % m;
      for (let i = 0; i < SubmarineScene.SNOW_N; i++) {
        const rn = mod(this.snowBase[i * 3] - pn, B.h) - B.h / 2;
        const re = mod(this.snowBase[i * 3 + 1] - pe, B.h) - B.h / 2;
        const rd = mod(this.snowBase[i * 3 + 2] - pd, B.v) - B.v / 2;
        const d = pd + rd;
        if (d < 0.8) sp.setXYZ(i, 0, -1e6, 0);
        else sp.setXYZ(i, re, -d, -rn);
      }
      sp.needsUpdate = true;
    }
    // esteira, onda de proa, rastro do hélice, jato dos suspiros
    const pixelScale = this.renderer.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.fx.update(e, step, pn, pe, tWave, pixelScale, this.layers.wake);
    this.markers.update(e, pn, pe, tWave, this.layers.markers);

    // trajetória
    const tp = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    const tr = s.nav.trail;
    const nT = Math.min(tr.length, 1599);
    for (let i = 0; i < nT; i++) {
      const p = tr[tr.length - nT + i];
      tp.setXYZ(i, p.e - pe, -p.z, -(p.n - pn));
    }
    tp.setXYZ(nT, 0, -pd, 0);
    tp.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, nT + 1);
    this.trail.visible = this.layers.trail;

    // linha de profundidade (superfície ↔ submarino ↔ fundo)
    const bottom = e.env.bottomDepthAt(pn, pe);
    const dl = this.depthLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    dl.setXYZ(0, 0, 0, 0);
    dl.setXYZ(1, 0, -pd, 0);
    dl.setXYZ(2, 0, -bottom, 0);
    dl.needsUpdate = true;
    this.depthLine.computeLineDistances();

    // câmera: segue o submarino (vista "Calado" usa teleobjetiva)
    const sh = this.view === 'navio' ? this.ships.nearest : null;
    const fov = this.view === 'calado' ? 16 : sh ? Math.max(2.5, Math.min(50, ((2 * Math.atan((sh.length * 1.8) / (2 * (sh.dist + 55)))) * 180) / Math.PI)) : 50;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const delta = subPos.clone().sub(this.lastSubPos);
    this.lastSubPos.copy(subPos);
    if (this.view === 'livre') {
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    } else if (this.view === 'fixa') {
      this.updateFixedCamera(pn, pe, pd);
    } else {
      this.viewBlend = Math.min(1, this.viewBlend + dtR * 1.8);
      const target = this.cameraTarget(this.view);
      this.viewFrom.add(delta);
      const k = 1 - Math.pow(1 - this.viewBlend, 3);
      this.camera.position.lerpVectors(this.viewFrom, target, k);
      this.controls.target.copy(subPos);
      if (this.view === 'piloto') this.controls.target.add(this.headingVectors().fwd.multiplyScalar(this.pilotLead()));
      if (sh) this.controls.target.copy(sh.pos).add(new THREE.Vector3(0, 8, 0));
      if (this.viewBlend >= 1) this.viewFrom.copy(target);
    }
    this.camera.up.set(0, 1, 0);
    if (this.view === 'topo') {
      const { fwd } = this.headingVectors();
      this.camera.up.copy(fwd);
    }
    this.controls.update();

    // ambiente subaquático
    const under = this.camera.position.y < 0;
    const camDepth = Math.max(0, -this.camera.position.y);
    this.wallTime += dtR;
    const prof = LIGHTING[this.lighting] ?? LIGHTING.clara;
    const uw = this.underSky.update(this.camera.position, camDepth, this.wallTime, prof.water);
    const deepColor = uw.horizon.clone();
    this.ocean.update(e.env.waves, tWave, pn, pe, this.camera.position, deepColor, this.wallTime);
    this.sky.position.copy(this.camera.position);
    this.sky.visible = !under;
    this.underSky.mesh.visible = under;
    // fundo só quando dentro do alcance de visibilidade (senão aparece como faixa de névoa)
    // fundo: debaixo d'água só dentro do alcance de visibilidade (senão vira faixa de névoa) ou perto da costa;
    // acima d'água o oceano cobre o fundo e a terra aparece; níveis grosseiros só acima d'água
    {
      const nearBottom = e.env.bottomDepthAt(pn, pe) - camDepth < (this.realisticFog ? 330 : 1200);
      terrain.setVisible(under ? nearBottom || terrain.landNear : coastOn, !under && coastOn);
    }
    // sem água: só o submarino (e o que está dentro dele) sobre um fundo neutro
    const dry = this.layers.noWater;
    this.ocean.mesh.visible = !dry;
    this.fx.group.visible = this.fx.group.visible && !dry;
    this.bubbles.visible = !dry;
    this.exBubbles.visible = !dry;
    this.snow.visible = !dry;
    // referências de profundidade: faixas e sombra (opção gráfica); a linha tracejada superfície–submarino–fundo
    // é o eixo dos rótulos de cota, por isso também segue a camada "Identificações"
    this.depthRefs.update(e.env, pn, pe, pd, (e.outputs.euler.heading * Math.PI) / 180, e.vessel.hull.length, e.vessel.hull.diameter, this.depthRefsOn && !dry);
    this.depthLine.visible = this.depthRefsOn && this.layers.labels && !dry;
    if (dry) {
      this.underSky.mesh.visible = false;
      this.sky.visible = false;
      this.terrain?.setVisible(false, false);
      if (this.shipyard) this.shipyard.group.visible = false;
    }
    this.caustics.uTime.value = this.wallTime;
    this.caustics.uCaustic.value = Math.min(1, e.env.waves.hs * 0.45 + 0.15);
    if (dry) {
      this.scene.background = this.dryBg;
      this.scene.fog = null;
      this.caustics.uCaustic.value = 0;
    } else if (under) {
      this.scene.background = deepColor;
      this.scene.fog = this.realisticFog ? new THREE.FogExp2(deepColor.getHex(), 0.0032) : new THREE.FogExp2(deepColor.getHex(), 0.0008);
    } else {
      this.scene.background = new THREE.Color(0x9dbad4);
      // com a costa ligada a névoa vai mais longe: a serra aparece ao fundo
      this.scene.fog = new THREE.Fog(0x9dbad4, coastOn ? 5000 : 3000, coastOn ? 32000 : 14000);
    }
    // iluminação: exposição, luz presa à câmera (mais fraca acima d'água, onde o sol ilumina) e contorno do casco
    {
      const pres = this.layers.presLight;
      const k = under ? 1 : 0.5;
      this.renderer.toneMappingExposure = under && !dry ? prof.exposureUnder : prof.exposureAbove;
      this.keyLight.intensity = Math.max(pres ? 1.6 : 0, prof.camKey * k);
      this.fillLight.intensity = Math.max(pres ? 0.45 : 0, prof.camFill * k);
      this.rim.uRim.value = this.layers.tanks ? 0 : prof.rim * (under && !dry ? 1 : 0.35);
    }
    // camadas: casco, tanques/circuitos, vetores
    this.applyHull();
    this.camera.updateMatrixWorld();
    const proj = (vtx: THREE.Vector3) => {
      const p = vtx.clone().project(this.camera);
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, visible: p.z < 1 && p.z > -1 };
    };
    const lbl: Label3D[] = [];
    this.sub.updateMatrixWorld();
    this.systems.update(e, this.sub, this.layers, Math.min(3, this.runner.timeScale) * (this.runner.running ? dtR : 0), lbl, proj);
    this.forces.update(e, this.sub, this.camera, this.layers, lbl, proj);
    this.trimVis.update(e, this.sub, this.layers, lbl, proj);
    this.updateTrimRef(e, lbl, proj);
    // tráfego adicional (quantidade nas Configurações): mesmos navios do mapa tático
    const extra = this.trafficCount > 0 && this.layers.ships && !dry ? trafficAt(e.state.t, trafficForEnv(e.env, this.geoOrigin, this.trafficCount), this.geoOrigin) : [];
    this.ships.update(e, pn, pe, tWave, this.geoOrigin, this.shipRange, this.layers.ships && !dry, this.layers.labels ? lbl : null, proj, extra);
    this.marineLife.update(e.env, tWave, pn, pe, !dry);
    if (this.shipyard && this.layers.labels && !dry && coastOn) this.shipyard.label(lbl, proj, this.shipyardDist);
    this.renderer.render(this.scene, this.camera);

    // rótulos básicos (superfície, cota/velocidade, fundo): também seguem a camada "Identificações"
    if (this.layers.labels) {
      const ps = proj(new THREE.Vector3(0, 0, 0));
      lbl.push({ id: 'surf', text: 'superfície', ...ps });
      const psub = proj(subPos.clone().add(new THREE.Vector3(0, 12, 0)));
      lbl.push({ id: 'sub', text: `${e.outputs.depthKeel.toFixed(1)} m · ${(e.state.body.vel.x / 0.5144).toFixed(1)} nós`, ...psub });
      const pb = proj(new THREE.Vector3(0, -bottom, 0));
      lbl.push({ id: 'bot', text: `fundo ${bottom.toFixed(0)} m (altitude ${e.outputs.altitude.toFixed(0)} m)`, ...pb });
    }
    return lbl;
  }

  /**
   * Referências de trim: linha d'água do casco (amarela, fixa no casco, no
   * calado médio atual) × nível do mar (ciano, horizontal) junto às marcas de
   * calado, com as leituras calculadas de calado AV/AR e trim.
   */
  private updateTrimRef(e: SimulationEngine, lbl: Label3D[], proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean }): void {
    const on = this.layers.trimRef;
    this.trimLines.visible = on;
    if (!on) return;
    const d = draftInfo(e);
    const r = e.vessel.hull.diameter / 2;
    const zwl = r - d.mean; // cota (corpo, + para baixo) da linha d'água sem trim
    const b = Math.sqrt(Math.max(0, r * r - zwl * zwl)) + 0.3;
    const pos = this.trimLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.trimLines.geometry.getAttribute('color') as THREE.BufferAttribute;
    const yellow = new THREE.Color(0xffe14d);
    const cyan = new THREE.Color(0x49dcff);
    let k = 0;
    const put = (v: THREE.Vector3, c: THREE.Color) => {
      pos.setXYZ(k, v.x, v.y, v.z);
      col.setXYZ(k, c.r, c.g, c.b);
      k++;
    };
    const pts: { side: number; f: THREE.Vector3; a: THREE.Vector3 }[] = [];
    for (const side of [1, -1]) {
      const f = this.sub.localToWorld(new THREE.Vector3(side * b, -zwl, -DRAFT_MARK_X.fwd));
      const a = this.sub.localToWorld(new THREE.Vector3(side * b, -zwl, -DRAFT_MARK_X.aft));
      put(f, yellow);
      put(a, yellow);
      put(new THREE.Vector3(f.x, 0, f.z), cyan);
      put(new THREE.Vector3(a.x, 0, a.z), cyan);
      pts.push({ side, f, a });
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    if (!this.layers.labels) return;
    // rótulos do bordo voltado para a câmera
    const cam = this.camera.position;
    const near = pts.reduce((p, q) => (q.f.distanceTo(cam) < p.f.distanceTo(cam) ? q : p));
    const up = new THREE.Vector3(0, 2.6, 0);
    const cm = (m: number) => `${Math.round(Math.abs(m) * 100)} cm`;
    lbl.push({ id: 'drF', text: `Calado AV ${d.fwd.toFixed(2)} m`, color: '#ffe14d', small: true, prio: 0, ...proj(near.f.clone().add(up)) });
    lbl.push({ id: 'drA', text: `Calado AR ${d.aft.toFixed(2)} m`, color: '#ffe14d', small: true, prio: 0, ...proj(near.a.clone().add(up)) });
    const mid = near.f.clone().add(near.a).multiplyScalar(0.5).add(new THREE.Vector3(0, 9, 0));
    const trimTxt = Math.abs(d.trim) < 0.005 ? 'sem trim' : `trim ${cm(d.trim)} ${d.trim > 0 ? 'pela popa' : 'pela proa'}`;
    lbl.push({
      id: 'drT',
      text: `${trimTxt} · θ ${d.pitch.toFixed(2)}°${this.trimGain > 1 ? ` (desenho ×${this.trimGain})` : ''}`,
      sub: d.surfaced ? `Na superfície o plano de flutuação deixa o trim ${Math.round(d.ratio)}× mais rígido que submerso · ${d.mtc.toFixed(1)} t·m por cm` : 'Submerso: rigidez de trim = W·BG',
      color: '#ffffff',
      prio: 0,
      ...proj(mid),
    });
  }

  dispose(): void {
    this.marineLife.dispose();
    this.shipyard?.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    this.renderer.domElement.remove();
  }
}
