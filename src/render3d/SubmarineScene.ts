/**
 * VISUALIZAÇÃO 3D (Three.js). Apenas LÊ o estado da simulação: nenhuma
 * animação do submarino é independente da física — posição, atitude, deflexão dos lemes,
 * rotação do hélice, níveis dos tanques e bolhas dos suspiros vêm do estado.
 * A fauna é decorativa e acompanha o relógio da simulação.
 *
 * Mapeamento NED → Three.js (Y para cima): X₃ = Leste, Y₃ = −profundidade,
 * Z₃ = −Norte. Origem flutuante na posição horizontal do submarino.
 */
import { fmtSpeed } from '../ui/format';
import { dieselExhaust, disperserOutlets } from '../sim/systems/exhaust';
import { WindFx } from './WindFx';
import { RioLandmarks } from './RioLandmarks';
import { DEFAULT_DAYLIGHT, NightSky, computeDaylight, navLightsOn, skyPalette, type DaylightSettings } from './daylight';
import { NavLights, Searchlights, submarineNavLights } from './NavLights';
import { DepthRefs } from './DepthRefs';
import { DepthLines } from './DepthLines';
import { trafficAt, trafficForEnv } from '../sim/traffic';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { DEFAULT_TRAIL_STYLE, type TrailStyle } from './trailStyle';
import { Ocean, UnderwaterSky, addCaustics, type OceanQuality } from './Ocean';
import { LIGHTING, addRim, type RimUniforms, type SceneLighting } from './lighting';
import type { SimulationEngine } from '../sim/core/engine';
import type { SimRunner } from '../sim/core/runner';
import { qToMat3, DEG } from '../sim/core/math';
import { SystemsVis } from './Systems';
import { ForceArrows } from './ForceArrows';
import { SurfaceFx } from './SurfaceFx';
import { UnderwaterFx } from './UnderwaterFx';
import { Markers } from './Markers';
import { TrimVis } from './TrimVis';
import { CargoVis } from './CargoVis';
import { TorpedoVis, torpedoPose } from './TorpedoVis';
import { PitchAngle } from './PitchAngle';
import { Ensign } from './Ensign';
import { defaultLayers, type SceneLayers } from './layers';
import type { PickTarget } from '../ui/ops/opsBus';
import type { LabelRect } from './labelLayout';
import type { Appearance } from './sailArt';
import { SailDecals, anechoicTextures, bladeGeometry, draftMarkBand, finGeometry, hubGeometry } from './HullDetail';
import { DRAFT_MARK_X, draftInfo } from '../sim/drafts';
import { qFromEuler, qToEuler } from '../sim/core/math';
import { ShipsLayer } from './Ships';
import { TerrainLayer, type TerrainDetail } from './Terrain';
import { ShipyardModel } from './Shipyard';
import { DEFAULT_ORIGIN, type LatLon } from '../sim/geo';
import { MarineLife } from './MarineLife';
import { AmbientParticles } from './AmbientParticles';
import { BottomLife } from './BottomLife';
import { DEFAULT_AMBIENT, type AmbientSettings } from './ambientMotion';
import { periscopeCfg, periscopeHeadZ } from '../sim/systems/actuation';
import { SubModelRig, loadSubModel, subModelLevel, subModelUrl } from './subModel';
import { BRIDGE_EYE, NAKED_FOV, bridgeFelt } from './bridge';
import { droneIdle, droneStart, droneStep, type DroneInput, type DronePose } from './drone';
import { BASE_FOV, DEEP_VIEWS, dollyRatio } from './deepPerspective';
import { SubEnvironment, envColors, envIntensity, type EnvColors } from './subEnvironment';
import { InteriorRig, cutSide, interiorEnabled, interiorUrl, setCutPlane } from './interiorModel';
import { readRenderStats, type RenderStats } from './renderPerf';

/**
 * Câmeras: 'piloto' (lateral que acompanha), 'perseguicao', 'perspectiva'
 * (grande-angular de perto, 3/4 pela proa: a proa, mais próxima, aparece bem
 * maior que a popa), 'fixa' (parada no mundo: o submarino atravessa o quadro),
 * enquadramentos rápidos de apresentação ('superficie', 'submerso', 'tanques',
 * 'forcas') e as vistas em primeira pessoa: 'periscopio' (cabeça do
 * periscópio) e 'passadico' (no alto da vela, olho nu ou binóculo). 'drone' é
 * uma câmera livre no MUNDO (não acompanha o submarino): voa pelo mar, orla e cidade.
 */
export type ViewMode =
  | 'piloto'
  | 'perseguicao'
  | 'cinematografica'
  | 'perspectiva'
  | 'perfil'
  | 'frente'
  | 'topo'
  | 'livre'
  | 'fixa'
  | 'superficie'
  | 'submerso'
  | 'tanques'
  | 'forcas'
  | 'calado'
  | 'navio'
  | 'periscopio'
  | 'passadico'
  | 'drone'
  | 'torpedo';

/** Linha de visada do periscópio: marcação relativa à proa (°), elevação (°) e campo de visão vertical (°). */
export interface PeriscopeSight {
  bearing: number;
  elev: number;
  fov: number;
}

/** Visada no passadiço (alto da vela): marcação relativa à proa (°), elevação (°) e campo vertical (°: olho nu ou binóculo). */
export type BridgeSight = PeriscopeSight;

interface Particle {
  n: number;
  e: number;
  d: number;
  vy: number;
  life: number;
  /** deriva horizontal (m/s, n/e) — bolhas da descarga lançadas para ré */
  vn?: number;
  ve?: number;
}

export interface Label3D {
  id: string;
  text: string;
  /** segunda linha (menor) */
  sub?: string;
  color?: string;
  small?: boolean;
  /** destaque grande (ex.: valor do ângulo de pitch) */
  big?: boolean;
  /** identificação de componente: fica fora do casco, com linha até a âncora */
  callout?: boolean;
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
  /** Área projetada do submarino reservada para o modelo, sem textos de componentes. */
  labelBounds: LabelRect | null = null;
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
  /** mastro do periscópio de ataque (posição vinda do estado) e cabeça (gira com a marcação) */
  private periMast!: THREE.Group;
  private periHead!: THREE.Group;
  /** visada do periscópio usada pela vista 'periscopio' (definida pela interface) */
  periscope: PeriscopeSight = { bearing: 0, elev: 0, fov: 32 };
  /** visada no passadiço usada pela vista 'passadico' (definida pela interface) */
  bridge: BridgeSight = { bearing: 0, elev: 0, fov: NAKED_FOV };
  /** câmera DRONE: pose no mundo (null = começa acima e atrás do submarino) e comandos (definidos pela interface) */
  drone: DronePose | null = null;
  droneInput: DroneInput = droneIdle();
  /** pose recebida de outra janela: o drone a segue suavemente em vez de responder aos comandos */
  droneTarget: DronePose | null = null;
  /** velocidade atual do drone (m/s), para o painel */
  droneSpeedNow = 0;
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
  /** Cristo Redentor, Ponte Rio–Niterói e nomes dos lugares (costa do Rio) */
  private rio = new RioLandmarks();
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
  /** modelo detalhado (.glb, subModel.ts) quando carregado; null = casco gerado pelo código (reserva) */
  private model: SubModelRig | null = null;
  /** interior do Blender no corte (meio casco aberto); carregado só quando o corte é ligado */
  private interior: InteriorRig | null = null;
  private interiorState: 'idle' | 'loading' | 'ok' | 'failed' = 'idle';
  /** plano do meio casco aberto (mundo) e lado removido (o da câmera) */
  private cutPlane = new THREE.Plane();
  private cutSign: 1 | -1 = 1;
  private halfOpen = false;
  /** interior do Blender à vista neste quadro (desenhado e clicável) */
  private interiorShown = false;
  /** materiais do casco do .glb recortados pelo plano (cópias; o original fica para fora do corte) */
  private clipMats = new Map<THREE.Material, THREE.Material>();
  private disposed = false;
  private pickables: THREE.Object3D[] = [];
  private dryBg = new THREE.Color(0x5a6b7e);
  private profile!: THREE.LineSegments;
  private systems!: SystemsVis;
  private forces!: ForceArrows;
  private fx: SurfaceFx;
  private underwaterFx: UnderwaterFx;
  private markers!: Markers;
  private trimVis!: TrimVis;
  private cargoVis!: CargoVis;
  private torpedoVis!: TorpedoVis;
  private pitchAngle = new PitchAngle();
  private ensign!: Ensign;
  private keyLight = new THREE.DirectionalLight(0xffffff, 0);
  private fillLight = new THREE.AmbientLight(0xffffff, 0);
  /** sol, lua e luzes (Sol e luzes: hora do dia, direção, luar, luzes de navegação, faróis, água escura) — só visual */
  daylight: DaylightSettings = { ...DEFAULT_DAYLIGHT };
  private sunLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private nightSky = new NightSky();
  private navLights!: NavLights;
  private searchlights!: Searchlights;
  private pal = { fog: new THREE.Color(), zenith: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), sun: new THREE.Color() };
  /** reflexo do céu no modelo .glb (mapa de ambiente só do submarino) */
  private subEnv!: SubEnvironment;
  private envCol: EnvColors | undefined;
  private envApplied: { model: SubModelRig | null; tex: THREE.Texture | null; k: number } = { model: null, tex: null, k: -1 };
  private tmpV = new THREE.Vector3();
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
  /** bolhas da descarga dos diesel-geradores (saídas atrás da vela, abaixo d'água) */
  private exParticles: Particle[] = [];
  private exBubbles: THREE.Points;
  private static readonly EX_MAX = 1400;
  /** vento aparente: linhas de vento e flâmula na vela */
  private wind!: WindFx;
  /** partículas em suspensão (fixas no mundo) — referência visual de movimento */
  private snow: AmbientParticles;
  private bottomLife: BottomLife;
  ambientSettings: AmbientSettings = { ...DEFAULT_AMBIENT };
  private depthRefs: DepthRefs;
  private depthLines = new DepthLines();
  /** espaçamento das linhas de profundidade (m), das preferências gráficas */
  depthLineSpacing = 25;
  /** referências discretas de profundidade (Configurações → Gráficos) */
  depthRefsOn = true;

  private bubbles: THREE.Points;
  private trail: Line2;
  trailStyle: TrailStyle = { ...DEFAULT_TRAIL_STYLE };
  private depthLine: THREE.Line;
  private lastSubPos = new THREE.Vector3();
  private view: ViewMode = 'perspectiva';
  private viewBlend = 1;
  private viewFrom = new THREE.Vector3();
  /** campo de visão no início da transição de vista (interpolado junto com a posição) */
  private fovFrom = 50;
  /**
   * PERSPECTIVA PROFUNDA (deepPerspective.ts): campo de visão grande-angular (°)
   * aplicado às vistas de 3ª pessoa, com a câmera aproximada na mesma proporção
   * (mesmo enquadramento); 0 = desligada. Só visual.
   */
  deepFov = 0;
  private lastDeepFov = 0;
  /** campo de visão da vista livre: mantém o da vista de onde se começou a arrastar (sem "pulo" de zoom) */
  private freeFov = 50;
  realisticFog = true;
  /** perfil de iluminação (apenas visual) */
  lighting: SceneLighting = 'clara';
  private rim: RimUniforms = { uRim: { value: 0 }, uRimColor: { value: new THREE.Color(0xa8dcff) } };
  private clock = new THREE.Clock();
  private dot = dotTexture();
  private env: () => SimulationEngine;

  constructor(
    private container: HTMLElement,
    runner: SimRunner,
    initialView: ViewMode = 'perspectiva',
    quality: OceanQuality = 'alta',
  ) {
    this.quality = quality;
    this.runner = runner;
    this.env = () => this.runner.engine;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.applyPixelRatio();
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.62;
    this.subEnv = new SubEnvironment(this.renderer);
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 30000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 3000;
    this.controls.addEventListener('start', () => {
      if (this.view !== 'livre') {
        this.freeFov = Math.max(35, Math.min(75, this.camera.fov));
        this.view = 'livre';
      }
    });

    // luzes
    this.hemiLight = new THREE.HemisphereLight(0xbfdfff, 0x0b1a26, 1.3);
    this.scene.add(this.hemiLight);
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    sun.position.copy(this.sunDir).multiplyScalar(1000);
    this.sunLight = sun;
    this.scene.add(sun);
    // céu noturno (estrelas, lua) e luar
    this.scene.add(this.nightSky.group, this.nightSky.moonLight);
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
    {
      // luzes de navegação (superfície) e faróis (submerso), presas ao submarino
      const v = this.env().vessel;
      const R = v.hull.diameter / 2;
      this.navLights = new NavLights(submarineNavLights(v.hull.length, R, v.hull.sail));
      this.searchlights = new Searchlights(v.hull.length, R, R + v.hull.sail.height);
      this.sub.add(this.navLights.group, this.searchlights.group);
    }
    this.scene.add(this.sub);
    this.loadModel();
    this.scene.add(this.trimLines);
    this.forces = new ForceArrows(this.env());
    this.scene.add(this.forces.group);
    this.trimVis = new TrimVis(this.env());
    this.sub.add(this.trimVis.local);
    this.scene.add(this.trimVis.world);
    this.cargoVis = new CargoVis(this.env());
    this.sub.add(this.cargoVis.local);
    this.scene.add(this.cargoVis.world);
    this.torpedoVis = new TorpedoVis(this.dot, this.renderer);
    this.sub.add(this.torpedoVis.local);
    this.scene.add(this.torpedoVis.world);
    this.scene.add(this.pitchAngle.group);
    this.fx = new SurfaceFx(this.dot, quality === 'baixa' ? 0.5 : 1);
    this.scene.add(this.fx.group);
    this.underwaterFx = new UnderwaterFx(quality === 'baixa' ? 0.5 : 1);
    this.scene.add(this.underwaterFx.group);
    {
      const v = this.env().vessel;
      this.wind = new WindFx(v.hull.diameter / 2 + v.hull.sail.height, v.hull.sail.xAft + 0.9);
      this.scene.add(this.wind.group);
      this.sub.add(this.wind.pennant);
      this.ensign = new Ensign(v.hull.diameter / 2 + v.hull.sail.height, v.hull.sail.xAft + 2.6);
      this.sub.add(this.ensign.group);
    }
    this.markers = new Markers(this.env(), this.dot);
    this.scene.add(this.markers.group);
    this.scene.add(this.ships.group);
    this.scene.add(this.marineLife.group);
    this.scene.add(this.rio.group);

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
      this.exBubbles = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0xf2f8fb, size: 0.95, transparent: true, opacity: 0.85, map: this.dot, depthWrite: false }));
      this.exBubbles.frustumCulled = false;
      this.scene.add(this.exBubbles);
    }

    // Partículas em suspensão: deriva e oscilação no referencial do mundo.
    this.snow = new AmbientParticles(quality === 'baixa' ? 700 : 1400);
    this.scene.add(this.snow.points);
    this.bottomLife = new BottomLife(quality === 'baixa' ? 0.5 : 1);
    this.scene.add(this.bottomLife.group);
    // referências discretas de profundidade (faixas de partículas e sombra no fundo)
    this.depthRefs = new DepthRefs(this.dot);
    this.scene.add(this.depthRefs.group);
    this.scene.add(this.depthLines.group);

    // trajetória e linha de profundidade
    const tg = new LineGeometry();
    tg.setPositions(new Float32Array(1600 * 3));
    tg.instanceCount = 0;
    // Espessura em pixels, independente da distância da câmera e do suporte a linhas WebGL.
    this.trail = new Line2(tg, new LineMaterial({ color: this.trailStyle.trailColor, linewidth: this.trailStyle.trailWidth, transparent: true, opacity: this.trailStyle.trailOpacity, depthWrite: false, fog: false, toneMapped: false }));
    this.trail.frustumCulled = false;
    // Referência de navegação: depois da água transparente (ordem 2).
    // Mantém depthTest para respeitar casco/terreno, sem a água apagar a linha
    // quando a câmera está no ar e o caminho está submerso.
    this.trail.renderOrder = 3;
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
    // periscópio de ataque: tubo fino e cabeça com janela (o curso é o do estado; sem efeito na física)
    {
      const pc = periscopeCfg(v);
      const ext = pc.extension;
      const tubeMat = new THREE.MeshStandardMaterial({ color: 0x55606b, metalness: 0.6, roughness: 0.3 });
      const headMat = new THREE.MeshStandardMaterial({ color: 0x3c4651, metalness: 0.5, roughness: 0.4 });
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x0b1620, metalness: 0.9, roughness: 0.08, emissive: 0x06121c });
      this.periMast = new THREE.Group();
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, ext, 16), tubeMat);
      this.periHead = new THREE.Group();
      const hd = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.7, 14), headMat);
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.06), glassMat);
      win.position.set(0, 0.05, -0.13);
      this.periHead.add(hd, win);
      this.periHead.position.y = ext / 2 + 0.3;
      this.periMast.add(tube, this.periHead);
      this.periMast.position.set(0, -periscopeHeadZ(v, 0) - ext / 2 - 0.65, -pc.x);
      this.sub.add(this.periMast);
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
        if (id) this.fins[id + (side < 0 ? 'L' : 'R')] = piv;
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
    const hub = new THREE.Mesh(hubGeometry(0.48, 2.0), finMat);
    this.prop.add(hub);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 0.75, roughness: 0.28, side: THREE.DoubleSide });
    const nb = v.propulsion.propeller.blades;
    const Rp = v.propulsion.propeller.diameter / 2;
    const bg = bladeGeometry(0.45, Rp);
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

  /** Busca o .glb da qualidade escolhida; se faltar ou falhar, fica o casco gerado pelo código. */
  private loadModel(): void {
    const url = subModelUrl(subModelLevel(this.quality));
    loadSubModel(url, this.renderer)
      .then((src) => {
        if (!this.disposed) this.attachModel(src);
      })
      .catch((err: unknown) => console.info(`[SX-1] modelo 3D ${url} indisponível; mantido o casco gerado pelo código (${err instanceof Error ? err.message : String(err)})`));
  }

  /** Troca casco, vela, lemes, hélice e mastros gerados pelo código pelas peças do .glb (só visual). */
  private attachModel(src: THREE.Object3D): void {
    let rig: SubModelRig;
    try {
      rig = new SubModelRig(src, this.env().vessel);
    } catch (err) {
      console.warn(`[SX-1] modelo 3D recusado; mantido o casco gerado pelo código (${err instanceof Error ? err.message : String(err)})`);
      return;
    }
    const old = new Set<THREE.Object3D>([...this.shell, ...Object.values(this.fins), this.prop, this.mast, this.periMast]);
    const fromOld = (o: THREE.Object3D) => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (old.has(p)) return true;
      return false;
    };
    this.pickables = this.pickables.filter((p) => !fromOld(p));
    for (const o of old) o.parent?.remove(o);
    for (const m of rig.materials())
      if (m instanceof THREE.MeshStandardMaterial) {
        addCaustics(m, this.caustics, 14);
        addRim(m, this.rim);
      }
    this.sub.add(rig.root);
    this.shell = [...rig.shell];
    this.pickables.push(...rig.pickables);
    if (rig.draftMarks.length) {
      for (const m of this.draftMarks) m.parent?.remove(m);
      this.draftMarks = rig.draftMarks;
    }
    this.model = rig;
    rig.setFinColor(this.ctrlMat.color, this.ctrlMat.emissive);
    // força reaplicar corte/opacidade/visibilidade às peças novas
    this.hullState = { ...this.hullState, op: -1 };
  }

  /** true quando o modelo detalhado (.glb) está em uso. */
  get detailedModel(): boolean {
    return this.model !== null;
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
    this.model?.setFinColor(this.ctrlMat.color, this.ctrlMat.emissive);
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

  /** escala de resolução (fração da nativa; só visual): a imagem é desenhada em menos pixels e ampliada pelo navegador */
  private renderScale = 1;
  setRenderScale(scale: number): void {
    const k = Math.max(0.25, Math.min(1, scale));
    if (Math.abs(k - this.renderScale) < 1e-3) return;
    this.renderScale = k;
    this.applyPixelRatio();
  }
  private applyPixelRatio(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.renderScale);
  }
  /** contadores do último quadro (medidor de FPS) */
  renderStats(): RenderStats {
    return readRenderStats(this.renderer, this.renderScale);
  }

  resize(): void {
    const w = Math.max(10, this.container.clientWidth);
    const h = Math.max(10, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.trail.material.resolution.set(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setView(v: ViewMode): void {
    this.viewFrom.copy(this.camera.position);
    this.fovFrom = this.camera.fov;
    if (v === 'livre' && this.view !== 'livre') this.freeFov = Math.max(35, Math.min(75, this.camera.fov));
    // das vistas em primeira pessoa a câmera não "voa" de dentro do mastro: começa já no novo enquadramento
    const fromEye = this.view === 'periscopio' || this.view === 'passadico' || this.view === 'drone';
    this.view = v;
    this.viewBlend = v === 'livre' || fromEye ? 1 : 0;
    if (fromEye && v !== 'livre') {
      this.viewFrom.copy(this.cameraTarget(v));
      this.fovFrom = this.viewFov(v);
    }
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
    // posição atual do submarino (a cena pode não ter desenhado desde um avanço acelerado ou troca de motor)
    this.lastSubPos.copy(P(0, 0, this.env().state.body.pos.z));
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
      const side = Math.max(100, 110 / asp) * this.deepRatio('fixa');
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
    const list = [...this.pickables, ...this.systems.pickables, this.trimVis.block, ...(this.interiorShown && this.interior ? this.interior.pickables : [])];
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

  private hullState = { cut: false, op: 1, pres: false, light: '', shell: true, half: false };
  /** cópia de um material do casco recortada pelo plano do meio casco aberto */
  private clipMat(m: THREE.Material): THREE.Material {
    let c = this.clipMats.get(m);
    if (!c) {
      c = m.clone();
      c.clippingPlanes = [this.cutPlane];
      c.side = THREE.DoubleSide;
      // lado de dentro do casco (faces de trás) cinza-claro, como nas ilustrações em corte; o de fora fica como é
      c.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace(
          '#include <color_fragment>',
          '#include <color_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = vec3(0.4, 0.44, 0.48);',
        );
        sh.fragmentShader = sh.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\nif (!gl_FrontFacing) totalEmissiveRadiance = vec3(0.07, 0.08, 0.09);',
        );
      };
      c.customProgramCacheKey = () => 'sx1-casco-cortado';
      this.clipMats.set(m, c);
    }
    return c;
  }

  /** Carrega o interior do Blender (uma vez); sem o arquivo fica o corte antigo. */
  private loadInterior(): void {
    this.interiorState = 'loading';
    loadSubModel(interiorUrl(), this.renderer)
      .then((src) => {
        if (this.disposed) return;
        try {
          const rig = new InteriorRig(src, this.systems.interiorLinks());
          rig.root.visible = false;
          this.sub.add(rig.root);
          this.interior = rig;
          this.interiorState = 'ok';
          this.hullState = { ...this.hullState, op: -1 };
        } catch (err) {
          this.interiorState = 'failed';
          console.warn(`[SX-1] interior recusado; mantido o corte antigo (${err instanceof Error ? err.message : String(err)})`);
        }
      })
      .catch((err: unknown) => {
        this.interiorState = 'failed';
        console.info(`[SX-1] interior ${interiorUrl()} indisponível; mantido o corte antigo (${err instanceof Error ? err.message : String(err)})`);
      });
  }

  /** true quando o corte usa o interior do Blender (meio casco aberto). */
  get interiorCut(): boolean {
    return this.halfOpen;
  }

  private applyHull(): void {
    const cut = this.layers.tanks;
    // meio casco aberto: o casco fica como fora do corte (opaco, com texturas), só recortado pelo plano
    const half = this.halfOpen;
    const cutLook = cut && !half;
    const op = cutLook ? Math.max(0.04, Math.min(1, this.layers.hullOpacity)) : 1;
    const pres = this.layers.presLight;
    const light = this.lighting;
    // casco externo oculto: ficam os lemes, o hélice, o mastro e (com o corte) os componentes internos
    const shell = this.layers.hull !== false;
    const hs = this.hullState;
    if (hs.cut === cut && hs.op === op && hs.pres === pres && hs.light === light && hs.shell === shell && hs.half === half) return;
    for (const o of this.shell) o.visible = shell;
    const hc = pres ? LIGHTING.estudio.hull : (LIGHTING[light] ?? LIGHTING.clara).hull;
    for (const [m, tx] of [
      [this.hullMat, this.tileTex.hull],
      [this.sailMat, this.tileTex.sail],
    ] as const) {
      m.transparent = op < 0.999;
      m.opacity = op;
      m.color.set(cutLook ? 0x9cc0e4 : hc.color);
      m.emissive.set(hc.emissive);
      m.depthWrite = op >= 0.999;
      // no corte as placas do revestimento atrapalham a leitura dos tanques
      m.map = cutLook ? null : (tx?.map ?? null);
      m.bumpMap = cutLook ? null : (tx?.bump ?? null);
      m.clippingPlanes = half ? [this.cutPlane] : null;
      m.side = half ? THREE.DoubleSide : THREE.FrontSide;
      m.needsUpdate = true;
    }
    this.deckMat.transparent = op < 0.999;
    this.deckMat.opacity = op;
    this.deckMat.depthWrite = op >= 0.999;
    this.deckMat.clippingPlanes = half ? [this.cutPlane] : null;
    this.deckMat.needsUpdate = true;
    if (this.decals) this.decals.group.visible = !cut && shell;
    for (const m of this.draftMarks) m.visible = !cut && shell;
    // no corte o casco é desenhado depois do oceano (fica visível abaixo da linha d'água)
    this.hullMesh.renderOrder = cut ? 5 : 0;
    // modelo .glb: no corte usa o material transparente do casco gerado (sem texturas); fora dele, o do arquivo
    if (this.model)
      for (const m of this.model.shellMeshes) {
        const base = m.userData.baseMaterial as THREE.Material;
        m.material = half ? this.clipMat(base) : cutLook ? this.hullMat : base;
        m.renderOrder = cut ? 5 : 0;
      }
    // sem o casco, o contorno lateral fica como referência da forma (no meio casco aberto o próprio casco mostra)
    this.profile.visible = cutLook || (!shell && !half);
    this.hullState = { cut, op, pres, light, shell, half };
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

  /** fator de aproximação da câmera da perspectiva profunda (1 = vista normal) */
  private deepRatio(v: ViewMode): number {
    return this.deepFov > 0 && DEEP_VIEWS.has(v) ? dollyRatio(BASE_FOV, this.deepFov) : 1;
  }

  /** posição da câmera de cada vista; com a perspectiva profunda, aproximada do ponto de mira (mesmo enquadramento) */
  private cameraTarget(v: ViewMode): THREE.Vector3 {
    const base = this.baseCameraTarget(v);
    const k = this.deepRatio(v);
    if (k === 1) return base;
    const look = this.lastSubPos.clone();
    if (v === 'piloto') look.add(this.headingVectors().fwd.multiplyScalar(this.pilotLead()));
    return look.add(base.sub(look).multiplyScalar(k));
  }

  private baseCameraTarget(v: ViewMode): THREE.Vector3 {
    const v0L = this.env().vessel.hull.length;
    const { fwd, stbd } = this.headingVectors();
    const c = this.lastSubPos.clone();
    const asp = Math.max(0.3, this.camera.aspect);
    switch (v) {
      case 'superficie': {
        const k = Math.max(1, 1.3 / asp);
        return c
          .add(fwd.multiplyScalar(-60 * k))
          .add(stbd.multiplyScalar(62 * k))
          .setY(Math.max(26 * k, c.y + 26 * k));
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
      case 'torpedo': {
        // atrás e um pouco acima do torpedo acompanhado (sem torpedo: como a perseguição)
        const f = this.torpedoVis?.focus;
        if (f)
          return f.pos
            .clone()
            .addScaledVector(f.dir, -15)
            .add(stbd.clone().multiplyScalar(3))
            .add(new THREE.Vector3(0, 3.5, 0));
        return this.baseCameraTarget('perseguicao');
      }
      case 'cinematografica': {
        // Oscilações contínuas em tempo real: câmera operada à mão, sem saltos aleatórios.
        const t = this.wallTime;
        return c
          .addScaledVector(fwd, -Math.max(95, 70 / asp) + 1.2 * Math.sin(t * 0.43))
          .addScaledVector(stbd, 18 + 1.5 * Math.sin(t * 0.71) + 0.35 * Math.sin(t * 1.83))
          .add(new THREE.Vector3(0, 16 + 0.8 * Math.sin(t * 0.93) + 0.2 * Math.sin(t * 2.17), 0));
      }
      case 'perseguicao':
        return c
          .add(fwd.multiplyScalar(-Math.max(95, 70 / Math.max(0.3, this.camera.aspect))))
          .add(stbd.multiplyScalar(18))
          .add(new THREE.Vector3(0, 16, 0));
      case 'perfil':
        return c.add(stbd.multiplyScalar(140)).add(new THREE.Vector3(0, 4, 0));
      case 'frente':
        return c.add(fwd.multiplyScalar(110)).add(new THREE.Vector3(0, 6, 0));
      case 'topo':
        return c.add(new THREE.Vector3(0, 170, 0)).add(fwd.multiplyScalar(-1));
      case 'periscopio':
      case 'passadico':
      case 'drone':
        // primeira pessoa: a posição real é a do olho (definida a cada quadro em render())
        return c.add(new THREE.Vector3(0, 10, 0));
      default:
        return this.perspectiveFrame().pos;
    }
  }

  /**
   * Plano próximo da câmera, proporcional à distância ao alvo (3ª pessoa) ou à altura (drone): com a câmera afastada
   * a razão far/near cai e a água não briga mais com o mar achatado do terreno (precisão de profundidade).
   * Periscópio e passadiço ficam com 0,5 m (o olho está no próprio submarino).
   */
  private nearPlane(droneView: boolean): number {
    if (droneView) return Math.min(30, Math.max(0.5, Math.abs(this.camera.position.y) * 0.01));
    if (this.view === 'periscopio' || this.view === 'passadico') return 0.5;
    return Math.min(30, Math.max(0.5, this.camera.position.distanceTo(this.controls.target) * 0.01));
  }

  /** campo de visão vertical (°) do enquadramento de cada vista de 3ª pessoa */
  private viewFov(v: ViewMode): number {
    if (v === 'perspectiva') return this.perspectiveFrame().fov;
    if (v === 'calado') return 16;
    if (v === 'drone') return 60;
    if (v === 'livre') return this.deepFov > 0 ? this.deepFov : this.freeFov;
    return this.deepFov > 0 && DEEP_VIEWS.has(v) ? this.deepFov : BASE_FOV;
  }

  private persp: { key: string; f: { pos: THREE.Vector3; target: THREE.Vector3; fov: number } } | null = null;

  /**
   * PERSPECTIVA VERDADEIRA: grande-angular de perto, 3/4 pela proa a boreste.
   * A câmera fica a ~20 m da proa (≈ 4× mais perto da proa que da popa), por
   * isso a proa aparece bem maior que a popa. O campo de visão e a distância
   * são calculados para o casco inteiro (com a vela) caber no quadro em
   * qualquer proporção de tela: em retrato a câmera vai mais para vante.
   */
  private perspectiveFrame(): { pos: THREE.Vector3; target: THREE.Vector3; fov: number } {
    const e = this.env();
    const v = e.vessel;
    const L = v.hull.length;
    const R0 = v.hull.diameter / 2;
    const { fwd, stbd } = this.headingVectors();
    const c = this.lastSubPos;
    const asp = Math.max(0.3, this.camera.aspect);
    const key = `${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)},${fwd.x.toFixed(4)},${fwd.z.toFixed(4)},${asp.toFixed(3)}`;
    if (this.persp?.key === key) return this.persp.f;
    const up = new THREE.Vector3(0, 1, 0);
    const at = (x: number, y: number) => c.clone().addScaledVector(fwd, x).addScaledVector(up, y);
    // pontos de referência do casco: perfil (topo e fundo), proa, popa e topo da vela
    const pts: THREE.Vector3[] = [];
    for (const x of [-L / 2, -L * 0.3, -L * 0.1, L * 0.1, L * 0.3, L / 2 - 4, L / 2]) {
      const r = e.geom.radiusAt(x);
      pts.push(at(x, r), at(x, -r));
    }
    const sv = v.hull.sail;
    pts.push(at(sv.xAft, R0 + sv.height), at(sv.xFwd, R0 + sv.height));
    const bow = at(L / 2, 0);
    // em retrato o casco fica mais "de frente" (estreito na horizontal)
    const kAsp = Math.min(1, Math.max(0, (asp - 0.55) / 1.1));
    const az = ((34 + 46 * kAsp) * Math.PI) / 180;
    let best: { pos: THREE.Vector3; target: THREE.Vector3; fov: number } | null = null;
    for (const k of [1, 1.2, 1.45, 1.75, 2.1, 2.6, 3.2]) {
      const d = 19 * k;
      const pos = bow
        .clone()
        .addScaledVector(fwd, Math.cos(az) * d)
        .addScaledVector(stbd, Math.sin(az) * d)
        .addScaledVector(up, 4 + 0.22 * d);
      // direção: bissetriz dos extremos angulares (horizontal e vertical)
      let yMin = Infinity;
      let yMax = -Infinity;
      let aMin = Infinity;
      let aMax = -Infinity;
      const toC = c.clone().sub(pos).setY(0).normalize();
      const side = new THREE.Vector3().crossVectors(toC, up);
      for (const p of pts) {
        const q = p.clone().sub(pos);
        const hz = Math.hypot(q.x, q.z);
        const a = Math.atan2(q.dot(side), q.clone().setY(0).dot(toC));
        aMin = Math.min(aMin, a);
        aMax = Math.max(aMax, a);
        const el = Math.atan2(q.y, hz);
        yMin = Math.min(yMin, el);
        yMax = Math.max(yMax, el);
      }
      const yaw = (aMin + aMax) / 2;
      const pitch = (yMin + yMax) / 2;
      const hdir = toC.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(side, Math.sin(yaw));
      const dir = hdir.multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch)).normalize();
      // projeção dos pontos no referencial da câmera: campo necessário
      const right = new THREE.Vector3().crossVectors(dir, up).normalize();
      const camUp = new THREE.Vector3().crossVectors(right, dir);
      let tH = 0;
      let tV = 0;
      for (const p of pts) {
        const q = p.clone().sub(pos);
        const z = Math.max(0.5, q.dot(dir));
        tH = Math.max(tH, Math.abs(q.dot(right)) / z);
        tV = Math.max(tV, Math.abs(q.dot(camUp)) / z);
      }
      const need = Math.max(tV, tH / asp) * 1.2;
      const fov = (2 * Math.atan(need) * 180) / Math.PI;
      const target = pos.clone().addScaledVector(dir, Math.max(15, c.distanceTo(pos)));
      best = { pos, target, fov: Math.max(40, fov) };
      if (fov <= 72) break;
    }
    this.persp = { key, f: best! };
    return best!;
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
    const rawDt = this.clock.getDelta();
    const dtR = Math.min(0.1, rawDt);
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
    if (this.model) {
      const ang = (id: string) => {
        const f = e.vessel.fins.find((x) => x.id === id);
        const st = s.surfaces[id];
        return f && st ? st.actual * f.commandSign * DEG : 0;
      };
      const maxStern = (e.vessel.fins.find((x) => x.id === 'stern')?.maxDeflection ?? 25) * DEG;
      const pos = s.periscope?.pos ?? 0;
      this.model.update(e.vessel, s, ang('bow'), ang('stern'), ang('rudder'), maxStern, this.periscope.bearing, pos > 0.005 && this.view !== 'periscopio');
    } else
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
    const v = e.vessel;
    const R0 = v.hull.diameter / 2;
    if (!this.model) {
      this.prop.rotation.z = -s.propulsion.shaftAngle;
      this.mast.position.y = R0 + v.hull.sail.height - v.hull.snorkelMast.extension / 2 - 0.5 + s.snorkel.pos * v.hull.snorkelMast.extension;
      {
        const pc = periscopeCfg(v);
        this.periMast.position.y = -periscopeHeadZ(v, s.periscope?.pos ?? 0) - pc.extension / 2 - 0.65;
        this.periHead.rotation.y = (-this.periscope.bearing * Math.PI) / 180;
        // arriado fica fora da cena (não aparece no corte nem sem casco); na vista do periscópio a câmera está dentro da cabeça
        this.periMast.visible = (s.periscope?.pos ?? 0) > 0.005 && this.view !== 'periscopio';
      }
    }

    // fundo e terra (reconstruídos ao afastar-se ou quando o fundo/costa mudam)
    const coastOn = !!e.env.cfg.geo?.coast;
    const terrain = this.ensureTerrain();
    // no drone os níveis de detalhe do terreno se centram na câmera (o grupo é deslocado para a origem flutuante)
    const tf = this.view === 'torpedo' ? this.torpedoVis.focus : null;
    const tc = this.view === 'drone' && this.drone ? { n: this.drone.n, e: this.drone.e } : tf ? { n: tf.n, e: tf.e } : { n: pn, e: pe };
    terrain.update(e.env, tc.n, tc.e, coastOn);
    terrain.group.position.set(tc.e - pe, 0, -(tc.n - pn));
    // estaleiro e base naval (só com a costa ligada: faz parte da costa, também na física)
    if (coastOn && e.env.cfg.geo) {
      if (!this.shipyard) {
        const sy = new ShipyardModel(this.quality);
        this.shipyard = sy;
        this.scene.add(sy.group);
        // submarinos atracados com a versão leve do modelo .glb; sem o arquivo fica o desenho (reserva)
        loadSubModel(subModelUrl('leve'), this.renderer)
          .then((src) => {
            if (!this.disposed && this.shipyard === sy) sy.useSubModel(src);
          })
          .catch(() => undefined);
      }
      this.shipyardDist = this.shipyard.place(e.env.cfg.geo.origin, pn, pe, this.camera.position);
      this.shipyard.float(e.env.waves, tWave);
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
      // descarga dos diesel-geradores: sai atrás da vela, abaixo d'água, e sobe em bolhas (ver sim/systems/exhaust.ts)
      const ex = dieselExhaust(v, s);
      // efeito da camada "Esteira" (desligada: sem bolhas novas e as existentes ocultas)
      if (ex.route && this.layers.wake) {
        const psi = (e.outputs.euler.heading * Math.PI) / 180;
        const fN = Math.cos(psi);
        const fE = Math.sin(psi);
        const rate = (20 + 38 * ex.load + (ex.starting ? 28 : 0)) * step; // bolhas/s por saída
        for (const o of disperserOutlets(v, e.geom.radiusAt)) {
          const src = toWorld(o.x, o.y, o.z);
          if (src.d + wv.elevation(src.n, src.e, tWave) < 0.3) continue; // saída fora d'água: sem bolhas
          const side = o.y < 0 ? -1 : 1;
          let k = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
          while (k-- > 0 && this.exParticles.length < SubmarineScene.EX_MAX) {
            // lançadas para ré ao longo do casco, abrindo um pouco para o bordo
            const back = 0.8 + Math.random() * 1.2;
            const out = side * (0.15 + Math.random() * 0.35);
            this.exParticles.push({
              n: src.n + (Math.random() - 0.5) * 0.8,
              e: src.e + (Math.random() - 0.5) * 0.8,
              d: src.d + Math.random() * 0.3,
              vy: 0.3 + Math.random() * 0.5,
              life: 60,
              vn: -fN * back - fE * out,
              ve: -fE * back + fN * out,
            });
          }
        }
      }
      this.exParticles = this.exParticles.filter((p) => {
        p.d -= p.vy * step;
        p.life -= step;
        // o jato perde velocidade na água; a bolha sobe e se espalha
        const kk = Math.exp(-0.6 * step);
        p.vn = (p.vn ?? 0) * kk;
        p.ve = (p.ve ?? 0) * kk;
        p.n += p.vn * step + (Math.random() - 0.5) * 0.14;
        p.e += p.ve * step + (Math.random() - 0.5) * 0.14;
        const alive = p.d > -wv.elevation(p.n, p.e, tWave) && p.life > 0;
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

    // esteira, onda de proa, rastro do hélice, jato dos suspiros
    const pixelScale = this.renderer.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.snow.update(e.env, s.t, pn, pe, pd, pixelScale, this.ambientSettings);
    this.underwaterFx.ambientSettings = this.ambientSettings;
    this.fx.update(e, step, pn, pe, tWave, pixelScale, this.layers.wake);
    this.underwaterFx.update(e, step, pn, pe, tWave, pixelScale, this.layers.wake && !this.layers.noWater);
    {
      // vela fora d'água: a flâmula só aparece com o submarino na superfície
      this.sub.updateMatrixWorld();
      const top = this.wind.pennant.getWorldPosition(new THREE.Vector3());
      const sailOut = top.y > e.env.waves.elevation(pn - top.z, pe + top.x, tWave) + 0.3;
      this.wind.update(e, step, dtR, pn, pe, tWave, this.layers.wind && !this.layers.noWater, this.camera.position.y < 0, sailOut && this.layers.pennant && this.layers.hull);
      // bandeira: some quando o topo da vela entra na água
      this.ensign.update(e, dtR, sailOut && !!this.layers.flag && this.layers.hull);
    }
    this.markers.update(e, pn, pe, tWave, this.layers.markers);

    // trajetória
    const starts = this.trail.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute;
    const ends = this.trail.geometry.getAttribute('instanceEnd') as THREE.InterleavedBufferAttribute;
    const tr = s.nav.trail;
    const nT = Math.min(tr.length, 1599);
    for (let i = 0; i < nT; i++) {
      const p = tr[tr.length - nT + i];
      const next = i + 1 < nT ? tr[tr.length - nT + i + 1] : { e: pe, n: pn, z: pd };
      starts.setXYZ(i, p.e - pe, -p.z, -(p.n - pn));
      ends.setXYZ(i, next.e - pe, -next.z, -(next.n - pn));
    }
    starts.data.needsUpdate = true;
    this.trail.geometry.instanceCount = nT;
    this.trail.material.linewidth = this.trailStyle.trailWidth;
    this.trail.material.color.set(this.trailStyle.trailColor);
    this.trail.material.opacity = this.trailStyle.trailOpacity;
    this.trail.visible = this.layers.trail && nT > 0;

    // linha de profundidade (superfície ↔ submarino ↔ fundo)
    const bottom = e.env.bottomDepthAt(pn, pe);
    const dlp = this.depthLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    dlp.setXYZ(0, 0, 0, 0);
    dlp.setXYZ(1, 0, -pd, 0);
    dlp.setXYZ(2, 0, -bottom, 0);
    dlp.needsUpdate = true;
    this.depthLine.computeLineDistances();

    // câmera: segue o submarino (vista "Calado" usa teleobjetiva; "Perspectiva" é grande-angular de perto)
    const sh = this.view === 'navio' ? this.ships.nearest : null;
    const delta = subPos.clone().sub(this.lastSubPos);
    this.lastSubPos.copy(subPos);
    const eyeView = this.view === 'periscopio' || this.view === 'passadico';
    const droneView = this.view === 'drone';
    if (this.deepFov !== this.lastDeepFov) {
      // perspectiva profunda ligada/desligada: as vistas que acompanham deslizam até o novo enquadramento;
      // a câmera fixa é reposicionada; na livre, a câmera aproxima ou afasta mantendo o enquadramento
      this.lastDeepFov = this.deepFov;
      this.fixedCam = null;
      if (this.view === 'livre') {
        const k = dollyRatio(this.camera.fov, this.viewFov('livre'));
        this.camera.position.sub(this.controls.target).multiplyScalar(k).add(this.controls.target);
      } else if (DEEP_VIEWS.has(this.view)) {
        this.viewFrom.copy(this.camera.position);
        this.fovFrom = this.camera.fov;
        this.viewBlend = 0;
      }
    }
    let fov =
      this.view === 'periscopio'
        ? Math.max(2, Math.min(70, this.periscope.fov))
        : this.view === 'passadico'
          ? Math.max(2, Math.min(80, this.bridge.fov))
          : sh
            ? Math.max(2.5, Math.min(50, (2 * Math.atan((sh.length * 1.8) / (2 * (sh.dist + 55))) * 180) / Math.PI))
            : this.viewFov(this.view);
    if (!eyeView && !droneView && this.view !== 'livre' && this.view !== 'fixa' && this.viewBlend < 1) {
      // o campo de visão acompanha a transição da câmera (sem "pulo" de zoom)
      const kb = Math.min(1, this.viewBlend + dtR * 1.8);
      fov = this.fovFrom + (fov - this.fovFrom) * (1 - Math.pow(1 - kb, 3));
    }
    if (Math.abs(this.camera.fov - fov) > 1e-4) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    // vista "Torpedo": câmera atrás e acima da arma, pela pose deste passo (a arma anda até 26 m/s)
    const torpPose = this.view === 'torpedo' ? torpedoPose(e, pn, pe, a) : null;
    if (eyeView || droneView || torpPose) this.controls.enabled = false;
    else if (!this.controls.enabled) this.controls.enabled = true;
    let rollUp: THREE.Vector3 | null = null;
    if (droneView) {
      // DRONE: pose no mundo (N/E/altura), convertida para a origem flutuante; voa também com a simulação pausada
      const d = this.drone ?? (this.drone = droneStart(pn, pe, pd, e.outputs.euler.heading));
      const tgt = this.droneTarget;
      if (tgt) {
        const k = Math.min(1, dtR * 12);
        d.n += (tgt.n - d.n) * k;
        d.e += (tgt.e - d.e) * k;
        d.up += (tgt.up - d.up) * k;
        d.yaw += (((((tgt.yaw - d.yaw + 180) % 360) + 360) % 360) - 180) * k;
        d.pitch += (tgt.pitch - d.pitch) * k;
      } else this.droneSpeedNow = droneStep(d, this.droneInput, Math.min(0.25, rawDt), (n, ee) => -e.env.bottomDepthAt(n, ee));
      const yaw = (d.yaw * Math.PI) / 180;
      const pit = (d.pitch * Math.PI) / 180;
      const pos = new THREE.Vector3(d.e - pe, d.up, -(d.n - pn));
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pit), Math.sin(pit), -Math.cos(yaw) * Math.cos(pit));
      this.camera.position.copy(pos);
      this.controls.target.copy(pos).addScaledVector(dir, 60);
      this.viewFrom.copy(pos);
    } else if (this.view === 'passadico') {
      // PASSADIÇO: olho no alto da vela (acompanha arfagem, caturro e balanço do casco);
      // a linha de visada é estabilizada pelo observador, que ainda sente parte do caturro e do balanço
      this.sub.updateMatrixWorld();
      const sv = v.hull.sail;
      const eye = this.sub.localToWorld(new THREE.Vector3(0, R0 + sv.height + BRIDGE_EYE.above, -(sv.xFwd - BRIDGE_EYE.aft)));
      const { fwd, stbd } = this.headingVectors();
      const b = (this.bridge.bearing * Math.PI) / 180;
      const felt = bridgeFelt(this.bridge.bearing, e.outputs.euler.pitch, e.outputs.euler.roll);
      const vPitch = (felt.pitch * Math.PI) / 180;
      const vRoll = (felt.roll * Math.PI) / 180;
      const el = (Math.max(-60, Math.min(60, this.bridge.elev)) * Math.PI) / 180 + vPitch;
      const dir = fwd
        .multiplyScalar(Math.cos(b))
        .add(stbd.multiplyScalar(Math.sin(b)))
        .multiplyScalar(Math.cos(el));
      dir.y = Math.sin(el);
      dir.normalize();
      // horizonte inclinado pelo balanço sentido (positivo = lado direito da vista desce)
      rollUp = new THREE.Vector3(0, 1, 0).applyAxisAngle(dir, -vRoll);
      this.camera.position.copy(eye);
      this.controls.target.copy(eye).add(dir.multiplyScalar(100));
      this.viewFrom.copy(eye);
    } else if (this.view === 'periscopio') {
      // câmera na cabeça do periscópio; linha de visada estabilizada (horizonte nivelado)
      this.sub.updateMatrixWorld();
      const head = this.sub.localToWorld(new THREE.Vector3(0, -periscopeHeadZ(v, s.periscope?.pos ?? 0) - 0.3, -periscopeCfg(v).x));
      const { fwd, stbd } = this.headingVectors();
      const b = (this.periscope.bearing * Math.PI) / 180;
      const el = (Math.max(-20, Math.min(45, this.periscope.elev)) * Math.PI) / 180;
      const dir = fwd
        .multiplyScalar(Math.cos(b))
        .add(stbd.multiplyScalar(Math.sin(b)))
        .multiplyScalar(Math.cos(el));
      dir.y = Math.sin(el);
      this.camera.position.copy(head);
      this.controls.target.copy(head).add(dir.multiplyScalar(100));
      this.viewFrom.copy(head);
    } else if (torpPose) {
      const { stbd } = this.headingVectors();
      const side = stbd.set(-torpPose.dir.z, 0, torpPose.dir.x);
      this.camera.position
        .copy(torpPose.pos)
        .addScaledVector(torpPose.dir, -13)
        .addScaledVector(side, 2.5)
        .add(new THREE.Vector3(0, 2.8, 0));
      this.controls.target.copy(torpPose.pos).addScaledVector(torpPose.dir, 5);
      this.viewFrom.copy(this.camera.position);
      this.viewBlend = 1;
    } else if (this.view === 'livre') {
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    } else if (this.view === 'fixa') {
      this.updateFixedCamera(pn, pe, pd);
    } else {
      this.viewBlend = Math.min(1, this.viewBlend + dtR * 1.8);
      const target = this.cameraTarget(this.view);
      this.viewFrom.add(delta);
      const k = 1 - Math.pow(1 - this.viewBlend, 3);
      if (this.view === 'cinematografica' && this.viewBlend >= 1) {
        // Amortecimento independente da taxa de quadros, mantendo a origem flutuante.
        this.camera.position.add(delta).lerp(target, 1 - Math.exp(-2.5 * dtR));
      } else this.camera.position.lerpVectors(this.viewFrom, target, k);
      this.controls.target.copy(subPos);
      if (this.view === 'perspectiva') this.controls.target.copy(this.perspectiveFrame().target);
      if (this.view === 'piloto') this.controls.target.add(this.headingVectors().fwd.multiplyScalar(this.pilotLead()));
      if (sh) this.controls.target.copy(sh.pos).add(new THREE.Vector3(0, 8, 0));
      const tf = this.view === 'torpedo' ? this.torpedoVis.focus : null;
      if (tf) this.controls.target.copy(tf.pos).addScaledVector(tf.dir, 8);
      if (this.viewBlend >= 1) this.viewFrom.copy(target);
    }
    this.camera.up.set(0, 1, 0);
    if (rollUp) this.camera.up.copy(rollUp);
    if (this.view === 'topo') {
      const { fwd } = this.headingVectors();
      this.camera.up.copy(fwd);
    }
    this.controls.update();
    if (this.view === 'cinematografica') {
      // Inclinação discreta (< 0,4°), aplicada após o lookAt e removida no quadro seguinte.
      this.camera.rotateZ(this.viewBlend * (0.005 * Math.sin(this.wallTime * 0.67) + 0.0015 * Math.sin(this.wallTime * 1.61)));
    }

    // ambiente subaquático. Na cabeça do periscópio e no passadiço a referência é a onda no ponto do olho:
    // na cota periscópica as cristas passam por cima da cabeça e a vista mergulha e volta
    const waveAtCam = eyeView || droneView ? e.env.waves.elevation(pn - this.camera.position.z, pe + this.camera.position.x, tWave) : 0;
    const under = this.camera.position.y < waveAtCam;
    const camDepth = Math.max(0, waveAtCam - this.camera.position.y);
    this.wallTime += dtR;
    const prof = LIGHTING[this.lighting] ?? LIGHTING.clara;
    // sol, lua e noite (só visual); sem água a cena fica sempre com a luz padrão de dia
    const dry0 = this.layers.noWater;
    const dl = computeDaylight(dry0 ? DEFAULT_DAYLIGHT : this.daylight);
    const pal = skyPalette(dl, !dry0 && this.daylight.moonlight, this.pal);
    this.sunLight.position.copy(dl.sunDir).multiplyScalar(1000);
    this.sunLight.color.copy(this.pal.sun);
    this.sunLight.intensity = pal.sunI;
    this.hemiLight.color.copy(this.pal.hemiSky);
    this.hemiLight.groundColor.copy(this.pal.hemiGround);
    this.hemiLight.intensity = pal.hemiK;
    this.sky.material.uniforms.sunPosition.value.copy(dl.sunDir);
    (this.underSky.material.uniforms.uSunDir.value as THREE.Vector3).copy(dl.sunDir);
    const uw = this.underSky.update(this.camera.position, camDepth, this.wallTime, prof.water, dl.under, dl.sunK);
    const deepColor = uw.horizon.clone();
    this.ocean.setLight(dl.sunDir, dl.sunK, dl.moonDir, dl.moonK, this.pal.zenith, this.pal.fog, 0.12 + 0.88 * dl.day, dl.under);
    // neve marinha: no escuro só se vê de perto (fica discreta)
    this.snow.setLight(0.25 + 0.75 * dl.under);
    this.ocean.update(e.env.waves, tWave, pn, pe, this.camera.position, deepColor, this.wallTime);
    this.nightSky.update(dl, this.camera.position, !under && !dry0, pal.moonI, this.pal.zenith, this.pal.fog);
    terrain.night = coastOn ? dl.night : 0;
    // drone no alto: a malha do mar se estende até o horizonte (sem borda visível); em todas as vistas o plano próximo
    // acompanha a distância (precisão de profundidade: sem "pintas" entre a água e o mar achatado da costa)
    {
      const k = droneView ? Math.max(1, this.camera.position.y / 350) : 1;
      if (this.ocean.mesh.scale.x !== k) this.ocean.mesh.scale.set(k, 1, k);
      const near = this.nearPlane(droneView);
      if (Math.abs(this.camera.near - near) > 0.05) {
        this.camera.near = near;
        this.camera.updateProjectionMatrix();
      }
    }
    this.sky.position.copy(this.camera.position);
    this.sky.visible = !under;
    this.underSky.mesh.visible = under;
    // fundo só quando dentro do alcance de visibilidade (senão aparece como faixa de névoa)
    // fundo: debaixo d'água só dentro do alcance de visibilidade (senão vira faixa de névoa) ou perto da costa;
    // acima d'água o oceano cobre o fundo e a terra aparece; níveis grosseiros só acima d'água
    {
      const nearBottom = e.env.bottomDepthAt(tc.n, tc.e) - camDepth < (this.realisticFog ? 330 : 1200);
      terrain.setVisible(under ? nearBottom || terrain.landNear : coastOn, !under && coastOn);
    }
    // sem água: só o submarino (e o que está dentro dele) sobre um fundo neutro
    const dry = this.layers.noWater;
    this.ocean.mesh.visible = !dry;
    this.fx.group.visible = this.fx.group.visible && !dry;
    this.bubbles.visible = !dry;
    this.exBubbles.visible = !dry && this.layers.wake;
    this.snow.points.visible = !dry;
    this.bottomLife.update(e.env, s.t, pn, pe, this.ambientSettings, !dry && under);
    // referências de profundidade: faixas e sombra (opção gráfica); a linha tracejada superfície–submarino–fundo
    // é o eixo dos rótulos de cota, por isso também segue a camada "Identificações"
    this.depthRefs.update(e.env, pn, pe, pd, (e.outputs.euler.heading * Math.PI) / 180, e.vessel.hull.length, e.vessel.hull.diameter, this.depthRefsOn && !dry, s.t, this.ambientSettings);
    this.depthLine.visible = this.depthRefsOn && this.layers.labels && !dry;
    // linhas de profundidade a cada 25 m (camada própria; somem sem água)
    this.depthLines.spacing = this.depthLineSpacing;
    this.depthLines.update(e.env, pn, pe, this.camera.position, this.layers.depthLines !== false && !dry);
    if (dry) {
      this.underSky.mesh.visible = false;
      this.sky.visible = false;
      this.terrain?.setVisible(false, false);
      if (this.shipyard) this.shipyard.group.visible = false;
    }
    this.caustics.uTime.value = this.wallTime;
    this.caustics.uCaustic.value = Math.min(1, e.env.waves.hs * 0.45 + 0.15) * dl.sunK;
    if (dry) {
      this.scene.background = this.dryBg;
      this.scene.fog = null;
      this.caustics.uCaustic.value = 0;
    } else if (under) {
      this.scene.background = deepColor;
      this.scene.fog = this.realisticFog ? new THREE.FogExp2(deepColor.getHex(), 0.0032) : new THREE.FogExp2(deepColor.getHex(), 0.0008);
    } else {
      this.scene.background = this.pal.fog.clone();
      // com a costa ligada a névoa vai mais longe: a serra aparece ao fundo
      this.scene.fog = new THREE.Fog(this.pal.fog.getHex(), coastOn ? 5000 : 3000, coastOn ? 32000 : 14000);
    }
    // iluminação: exposição, luz presa à câmera (mais fraca acima d'água, onde o sol ilumina) e contorno do casco
    {
      const pres = this.layers.presLight;
      // à noite e com a água escura a luz presa à câmera também diminui (os faróis passam a mostrar o submarino)
      const k = (under ? 1 : 0.5) * (dry ? 1 : under ? Math.max(0.2, dl.under) : Math.max(0.3, dl.day));
      this.renderer.toneMappingExposure = under && !dry ? prof.exposureUnder : prof.exposureAbove;
      this.keyLight.intensity = Math.max(pres ? 1.6 : 0, prof.camKey * k);
      this.fillLight.intensity = Math.max(pres ? 0.45 : 0, prof.camFill * k);
      this.rim.uRim.value = this.layers.tanks ? 0 : prof.rim * (under && !dry ? 1 : 0.35);
    }
    // reflexo do céu no modelo .glb (só visual): mesmas cores do céu/água da cena
    if (this.model) {
      const mode = dry ? 'seco' : under ? 'submerso' : 'acima';
      this.envCol = envColors(mode, { zenith: this.pal.zenith, fog: this.pal.fog, sun: this.pal.sun, sunDir: dl.sunDir, sunK: dl.sunK, day: dl.day, uwUp: uw.up, uwHorizon: uw.horizon }, this.envCol);
      this.subEnv.update(this.envCol, this.wallTime);
      const tex = this.subEnv.texture;
      const k = envIntensity(mode, dl.day, dl.under);
      const ap = this.envApplied;
      if (tex && (ap.model !== this.model || ap.tex !== tex || Math.abs(ap.k - k) > 0.005)) {
        for (const m of this.model.materials()) {
          if (!(m instanceof THREE.MeshStandardMaterial)) continue;
          if (!m.envMap) m.needsUpdate = true;
          m.envMap = tex;
          m.envMapIntensity = k;
        }
        this.envApplied = { model: this.model, tex, k };
      }
    }
    // luzes de navegação (na superfície, do crepúsculo ao amanhecer ou ligadas) e faróis
    {
      this.sub.updateMatrixWorld();
      const wv = e.env.waves;
      const aboveWater = (p: THREE.Vector3) => {
        const w = this.sub.localToWorld(this.tmpV.copy(p));
        return w.y > wv.elevation(pn - w.z, pe + w.x, tWave) + 0.1;
      };
      const camLocal = this.sub.worldToLocal(this.camera.position.clone());
      this.navLights.update(!dry && this.layers.hull && navLightsOn(this.daylight, dl), camLocal, this.wallTime, aboveWater);
      const bow = this.sub.localToWorld(this.tmpV.set(0, 0, -(v.hull.length / 2 - 3)));
      const bowUnder = bow.y < wv.elevation(pn - bow.z, pe + bow.x, tWave) - 0.5;
      this.searchlights.update(!dry && this.daylight.subLights, under, bowUnder);
    }
    // navios: luzes de navegação junto com as do submarino
    this.ships.lights = { on: !dry && navLightsOn(this.daylight, dl), cam: this.camera.position, time: this.wallTime };
    // corte com o interior do Blender (meio casco aberto): carrega na 1ª vez; plano do lado da câmera
    const intOn = this.layers.tanks && interiorEnabled(this.quality, !!this.layers.halfCut);
    if (intOn && this.interiorState === 'idle') this.loadInterior();
    // raio-X (padrão) ou meio casco aberto (camada própria)
    this.halfOpen = intOn && !!this.interior && !!this.layers.halfCut;
    if (this.halfOpen) {
      this.cutSign = cutSide(this.sub.worldToLocal(this.camera.position.clone()).x, this.cutSign);
      setCutPlane(this.cutPlane, this.sub, this.cutSign);
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
    const hull = e.vessel.hull;
    const rHull = hull.diameter / 2;
    const corners = [-rHull, rHull].flatMap((x) => [-rHull, rHull + hull.sail.height].flatMap((y) => [-hull.length / 2, hull.length / 2].map((z) => proj(this.sub.localToWorld(new THREE.Vector3(x, y, z))))));
    this.labelBounds = corners.every((p) => p.visible)
      ? {
          x0: Math.min(...corners.map((p) => p.x)) - 10,
          x1: Math.max(...corners.map((p) => p.x)) + 10,
          y0: Math.min(...corners.map((p) => p.y)) - 10,
          y1: Math.max(...corners.map((p) => p.y)) + 10,
        }
      : null;
    const sysStep = Math.min(3, this.runner.timeScale) * (this.runner.running ? dtR : 0);
    const showInt = intOn && !!this.interior;
    this.interiorShown = showInt;
    this.systems.setInteriorMode(showInt, this.halfOpen ? this.cutPlane : null);
    this.systems.update(e, this.sub, this.layers, sysStep, lbl, proj);
    if (this.interior) {
      this.interior.root.visible = showInt;
      if (showInt) {
        this.interior.setClip(this.halfOpen ? this.cutPlane : null);
        if (this.interior.cutMode !== (this.halfOpen ? 'meio' : 'raiox')) this.interior.setMode(this.halfOpen ? 'meio' : 'raiox');
        this.interior.update(e, this.systems.visibility(this.layers), this.layers.pipes, sysStep, !!this.layers.tankFilter);
      }
    }
    this.forces.update(e, this.sub, this.camera, this.layers, lbl, proj);
    this.trimVis.update(e, this.sub, this.layers, lbl, proj);
    this.cargoVis.update(e, this.sub, this.layers, lbl, proj);
    this.torpedoVis.setClip(showInt && this.halfOpen ? this.cutPlane : null);
    this.torpedoVis.update(e, this.sub, pn, pe, this.layers.torpedoes !== false, showInt, a, step, (n, ee) => e.env.waves.elevation(n, ee, tWave), this.layers.labels ? lbl : null, proj);
    this.pitchAngle.update(!!this.layers.pitchAngle, e, this.sub, lbl, proj);
    this.updateTrimRef(e, lbl, proj);
    // tráfego adicional (quantidade nas Configurações): mesmos navios do mapa tático
    const extra = this.trafficCount > 0 && this.layers.ships && !dry ? trafficAt(e.state.t, trafficForEnv(e.env, this.geoOrigin, this.trafficCount), this.geoOrigin) : [];
    this.ships.update(e, pn, pe, tWave, this.geoOrigin, this.shipRange, this.layers.ships && !dry, this.layers.labels ? lbl : null, proj, extra);
    this.marineLife.update(e.env, tWave, pn, pe, !dry);
    if (this.layers.labels) this.wind.label(e, lbl, proj);
    {
      const g = e.env.cfg.geo;
      const origin = g && g.coast ? g.origin : null;
      this.rio.update(origin, pn, pe, !dry);
      if (this.layers.labels && !under) this.rio.label(origin, pn, pe, this.camera.position, lbl, proj);
    }
    if (this.shipyard && this.layers.labels && !dry && coastOn) this.shipyard.label(lbl, proj, this.shipyardDist);
    this.renderer.render(this.scene, this.camera);

    // rótulos básicos (superfície, cota/velocidade, fundo): também seguem a camada "Identificações"
    if (this.layers.labels) {
      const ps = proj(new THREE.Vector3(0, 0, 0));
      lbl.push({ id: 'surf', text: 'superfície', ...ps });
      const psub = proj(subPos.clone().add(new THREE.Vector3(0, 12, 0)));
      lbl.push({ id: 'sub', text: `${e.outputs.depthKeel.toFixed(1)} m · ${fmtSpeed(e.state.body.vel.x, 1)}`, ...psub });
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
    const mid = near.f
      .clone()
      .add(near.a)
      .multiplyScalar(0.5)
      .add(new THREE.Vector3(0, 9, 0));
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
    this.disposed = true;
    this.subEnv.dispose();
    this.navLights.dispose();
    this.searchlights.dispose();
    this.nightSky.dispose();
    this.marineLife.dispose();
    this.bottomLife.dispose();
    this.wind.dispose();
    this.ensign.dispose();
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

