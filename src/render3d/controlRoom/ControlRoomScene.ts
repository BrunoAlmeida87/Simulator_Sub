/**
 * SALA DE COMANDO EM PRIMEIRA PESSOA (Three.js). A cena só LÊ o estado da
 * simulação: telas, lâmpadas, ponteiros, manches, periscópio e água no piso
 * vêm do estado. Cliques e arrastos nos painéis/controles montam COMANDOS e
 * os entregam às ações fornecidas pela interface (RoomActions).
 *
 * Arranjo (inspirado em salas de controle de submarinos convencionais):
 * vante a bombordo o posto de governo (planador e timoneiro) com os
 * instrumentos de mergulho na antepara; a boreste o painel do lastro; no
 * centro os periscópios e a escada da torre; a bombordo os consoles
 * multifunção (sonar, tático, navegação); a boreste a segurança do mergulho,
 * o coletor de válvulas e o console da plataforma; à ré a mesa tática e a
 * estação do instrutor.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SimRunner } from '../../sim/core/runner';
import type { SimulationEngine } from '../../sim/core/engine';
import type { RoomActions } from './actions';
import { CanvasPanel, type HitRegion, type RoomLighting, type RoomUiState } from './panel';
import {
  RoomMaterials,
  cableTray,
  emergencyHandle,
  extinguisher,
  handwheel,
  ladder,
  lightFixture,
  periscope,
  phone,
  pipeRun,
  rack,
  seat,
  sitConsole,
  stackConsole,
  standPanel,
  telegraphLever,
  wtDoor,
  yoke,
  geomUtil,
  type Slot,
} from './furniture';
import { STATIONS, START_POSE, stationById } from './stations';
import { drawAnnunciator, drawConningOfficer, drawDivingGauges, drawHelmsman, drawPlanesman } from './panelsShip';
import { MANIFOLD_VALVES, drawBallastPanel, drawCompensation, drawManifold, drawTrimHeel, manifoldToggle, manifoldValveCmd, manifoldValveOrder } from './panelsBallast';
import { drawEnergy, drawInstructorFailures, drawInstructorSim, drawPropulsion } from './panelsPlatform';
import { drawNavigation, drawPlotTable, drawSonarContacts, drawSonarWaterfall, drawTacticalConsole } from './panelsCombat';
import { disposeRoomTextures, labelTexture } from './textures';
import { TELEGRAPH, nearestOrder } from '../../sim/telegraph';
import { ALARM_DEFS } from '../../sim/systems/alarms';

/** geometria do casco resistente na sala */
export const ROOM = { R: 3.0, axisY: 0.3, zFwd: -7, zAft: 7, eye: 1.65 };
export const halfWidth = (y: number) => Math.sqrt(Math.max(0, ROOM.R * ROOM.R - (y - ROOM.axisY) ** 2));
const TOP = ROOM.axisY + ROOM.R;
/** alcance do braço: controles mais distantes que isto só aproximam a câmera */
export const REACH = 2.7;

export interface HoverInfo {
  text: string;
  /** clicar aciona diretamente (true) ou aproxima a câmera (false) */
  direct: boolean;
  station: string | null;
}

interface Control3D {
  id: string;
  station: string | null;
  obj: THREE.Object3D;
  label: (e: SimulationEngine) => string;
  click?: () => void;
  drag?: { begin: () => void; move: (dx: number, dy: number) => void; end: () => void };
  update?: (e: SimulationEngine, dt: number) => void;
}

interface Obstacle {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** envio limitado (como os controles 2D): no máximo a cada `ms`, só quando muda; o último valor sai ao soltar */
function throttled<T>(send: (v: T) => void, ms = 120) {
  let last = 0;
  let key = '';
  let pending: T | null = null;
  return {
    push(v: T, k: string) {
      if (k === key) return;
      key = k;
      const now = performance.now();
      if (now - last >= ms) {
        last = now;
        pending = null;
        send(v);
      } else pending = v;
    },
    flush() {
      if (pending !== null) send(pending);
      pending = null;
      key = '';
    },
  };
}

export class ControlRoomScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private mats = new RoomMaterials();
  private panels: CanvasPanel[] = [];
  private controls: Control3D[] = [];
  private pickables: THREE.Object3D[] = [];
  private obstacles: Obstacle[] = [];
  private circles: { x: number; z: number; r: number }[] = [];
  readonly ui: RoomUiState = { dose: {}, page: {}, lampTest: false, guards: {}, lighting: 'normal', scenario: 0 };
  // câmera em primeira pessoa
  private pos = new THREE.Vector3(...START_POSE.pos);
  private yaw = START_POSE.yaw;
  private pitch = START_POSE.pitch;
  private keys = new Set<string>();
  /** entrada analógica de deslocamento (botões de toque): frente/lado */
  move = { f: 0, s: 0 };
  private tween: { from: THREE.Vector3; to: THREE.Vector3; qFrom: THREE.Quaternion; qTo: THREE.Quaternion; t: number } | null = null;
  focused: string | null = null;
  // interação
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private down: { x: number; y: number; lx: number; ly: number; ctl: Control3D | null; moved: boolean } | null = null;
  private dragging: Control3D | null = null;
  private hoverPanel: CanvasPanel | null = null;
  private hoverRegion: string | null = null;
  private lastHover = 0;
  onHover: ((h: HoverInfo | null) => void) | null = null;
  onFocus: ((station: string | null) => void) | null = null;
  // iluminação
  private lights: THREE.PointLight[] = [];
  private hemi: THREE.HemisphereLight;
  private emergency: THREE.PointLight[] = [];
  private beacon: { light: THREE.PointLight; mesh: THREE.Mesh };
  private lightKey = '';
  private water: THREE.Mesh;
  /** marcação relativa do periscópio (°), para girar o tubo como na visada */
  periBearing = 0;
  private clock = new THREE.Clock();
  private wall = 0;
  private pmrem: THREE.PMREMGenerator;
  private envTex: THREE.Texture;
  private disposed = false;
  readonly lowQuality: boolean;

  constructor(
    private container: HTMLElement,
    private runner: SimRunner,
    private act: RoomActions,
    quality: 'baixa' | 'media' | 'alta' = 'alta',
  ) {
    this.lowQuality = quality === 'baixa';
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.lowQuality, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'alta' ? 2 : quality === 'media' ? 1.5 : 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 60);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.3;
    this.scene.background = new THREE.Color(0x101418);
    this.hemi = new THREE.HemisphereLight(0xe8eef4, 0x4a3524, 0.9);
    this.scene.add(this.hemi);
    this.build();
    // água de alagamento (compartimento central)
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 14), new THREE.MeshStandardMaterial({ color: 0x1d5f7a, transparent: true, opacity: 0.55, roughness: 0.08, metalness: 0.3 }));
    this.water.rotation.x = -Math.PI / 2;
    this.water.visible = false;
    this.scene.add(this.water);
    // sinalizador de alarme crítico (âmbar giratório junto ao anunciador)
    const bm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.14, 16), new THREE.MeshStandardMaterial({ color: 0x661d10, emissive: 0xff3010, emissiveIntensity: 0, transparent: true, opacity: 0.9 }));
    bm.position.set(1.75, 2.42, -6.85);
    const bl = new THREE.PointLight(0xff3018, 0, 6, 2);
    bl.position.set(1.75, 2.3, -6.6);
    this.scene.add(bm, bl);
    this.beacon = { light: bl, mesh: bm };
    this.resize();
    this.updateCamera(0);
  }

  // ------------------------------------------------------------------ construção
  private addPanel(parent: THREE.Object3D, slot: Slot, opts: ConstructorParameters<typeof CanvasPanel>[0]): CanvasPanel {
    const p = new CanvasPanel({ ...opts, w: slot.w, h: slot.h, res: this.lowQuality ? 0.7 : 1 });
    p.mesh.position.copy(slot.pos);
    p.mesh.quaternion.copy(slot.quat);
    p.mesh.userData.dynamic = true;
    parent.add(p.mesh);
    this.panels.push(p);
    this.pickables.push(p.mesh);
    return p;
  }

  private addControl(c: Control3D, margin = 0.035): Control3D {
    // caixa invisível um pouco maior que a peça: alvos finos (alavancas, manches) ficam fáceis de acertar
    const o = c.obj;
    const parent = o.parent;
    const saved = { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() };
    parent?.remove(o);
    o.position.set(0, 0, 0);
    o.quaternion.identity();
    o.scale.set(1, 1, 1);
    o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o);
    o.position.copy(saved.p);
    o.quaternion.copy(saved.q);
    o.scale.copy(saved.s);
    parent?.add(o);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3()).addScalar(margin * 2);
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial());
      box.getCenter(proxy.position);
      proxy.visible = false;
      o.add(proxy);
    }
    c.obj.userData.dynamic = true;
    c.obj.traverse((o) => (o.userData.control = c));
    this.controls.push(c);
    this.pickables.push(c.obj);
    return c;
  }

  /** separa as peças móveis (painéis, controles) e funde o resto por material (menos chamadas de desenho) */
  private bake(group: THREE.Group, station: string | null): void {
    this.scene.add(group);
    group.updateMatrixWorld(true);
    const dyn: THREE.Object3D[] = [];
    group.traverse((o) => {
      if (o !== group && o.userData.dynamic) dyn.push(o);
    });
    for (const d of dyn) this.scene.attach(d);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const multi: THREE.Mesh[] = [];
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const m = o as THREE.Mesh;
      if (Array.isArray(m.material)) {
        multi.push(m);
        return;
      }
      let geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((geo.attributes.position.count as number) * 2), 2));
      if (!geo.attributes.normal) geo.computeVertexNormals();
      geo.clearGroups();
      geo = geo.applyMatrix4(m.matrixWorld);
      const list = byMat.get(m.material) ?? [];
      list.push(geo);
      byMat.set(m.material, list);
    });
    for (const m of multi) this.scene.attach(m);
    this.scene.remove(group);
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !multi.includes(m)) m.geometry.dispose();
    });
    const out = new THREE.Group();
    for (const [mat, geos] of byMat) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      out.add(mesh);
    }
    for (const m of multi) out.attach(m);
    if (station) {
      out.userData.station = station;
      out.traverse((o) => (o.userData.station = station));
    }
    // também as peças sem estação: bloqueiam o raio (não se clica através de paredes e consoles)
    this.pickables.push(out);
    this.scene.add(out);
  }

  private block(x0: number, x1: number, z0: number, z1: number): void {
    this.obstacles.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
  }

  private placeSeat(x: number, z: number, rotY: number, parentStation: string | null): void {
    const s = seat(this.mats);
    s.position.set(x, 0, z);
    s.rotation.y = rotY;
    const g = new THREE.Group();
    g.add(s);
    this.bake(g, parentStation);
    this.circles.push({ x, z, r: 0.3 });
  }

  private label(text: string, w: number, h: number, pos: THREE.Vector3, rotY: number, parent: THREE.Object3D): void {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: labelTexture(text, { w: 512, h: Math.round((512 * h) / w) }), roughness: 0.5 }));
    m.position.copy(pos);
    m.rotation.y = rotY;
    parent.add(m);
  }

  private build(): void {
    const m = this.mats;
    const { mesh, rbox } = geomUtil;
    const L = ROOM.zAft - ROOM.zFwd;
    // ---------- casco, cavernas, anteparas, piso e teto
    const env = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(ROOM.R, ROOM.R, L, 56, 1, true), m.lining);
    hull.rotation.x = Math.PI / 2;
    hull.position.set(0, ROOM.axisY, 0);
    env.add(hull);
    // cavernas (só o arco do teto aparece: nas laterais ficam atrás dos equipamentos e do isolamento)
    const a0 = Math.asin((1.95 - ROOM.axisY) / (ROOM.R - 0.04));
    for (let z = ROOM.zFwd + 0.45; z < ROOM.zAft; z += 0.7) {
      const fr = new THREE.Mesh(new THREE.TorusGeometry(ROOM.R - 0.04, 0.05, 6, 40, Math.PI - 2 * a0), m.frame);
      fr.rotation.z = a0;
      fr.scale.set(1, 1, 0.5);
      fr.position.set(0, ROOM.axisY, z);
      env.add(fr);
    }
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(2 * halfWidth(0) + 0.1, L), m.deck);
    deck.rotation.x = -Math.PI / 2;
    env.add(deck);
    // rodapés e chapa antiderrapante junto ao casco
    for (const sx of [-1, 1]) env.add(mesh(new THREE.BoxGeometry(0.25, 0.02, L), m.tread, sx * (halfWidth(0) - 0.12), 0.01, 0));
    // forro escuro do teto entre os dutos
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(2 * halfWidth(2.8), L), m.ceiling);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = 2.8;
    env.add(ceil);
    // anteparas (vante e ré) com portas estanques
    for (const [z, dir] of [
      [ROOM.zFwd, 1],
      [ROOM.zAft, -1],
    ] as const) {
      const sh = new THREE.Shape();
      const a0 = Math.asin((0 - ROOM.axisY) / ROOM.R);
      sh.moveTo(Math.cos(a0) * ROOM.R, 0);
      sh.absarc(0, ROOM.axisY, ROOM.R, a0, Math.PI - a0, false);
      sh.lineTo(-Math.cos(a0) * ROOM.R, 0);
      sh.closePath();
      const hole = new THREE.Path();
      hole.absellipse(0.95, 1.15, 0.36, 0.7, 0, Math.PI * 2, true, 0);
      sh.holes.push(hole);
      const bh = new THREE.Mesh(new THREE.ShapeGeometry(sh, 48), m.bulkhead);
      bh.position.z = z;
      env.add(bh);
      const door = wtDoor(m);
      door.position.set(0.95, 1.15, z + dir * 0.005);
      if (dir < 0) door.rotation.y = Math.PI;
      env.add(door);
      // reforços verticais da antepara
      for (const x of [-2.32, 0.16, 2.05]) env.add(mesh(new THREE.BoxGeometry(0.08, 2.4, 0.06), m.frame, x, 1.2, z + dir * 0.03));
      const ext = extinguisher(m);
      ext.position.set(0.25, 0.3, z + dir * 0.12);
      env.add(ext);
    }
    // dutos de ventilação aluminizados, tubulações e calhas de cabos
    const zf = ROOM.zFwd + 0.05;
    const za = ROOM.zAft - 0.05;
    const duct = (x: number, y: number, r: number) => env.add(mesh(new THREE.CylinderGeometry(r, r, za - zf, 20), m.foil, x, y, (zf + za) / 2).rotateX(Math.PI / 2));
    duct(0.05, 2.95, 0.26);
    duct(-1.05, 2.78, 0.17);
    duct(1.15, 2.8, 0.15);
    // tubulações pintadas de cinza-claro com faixas de identificação na cor do fluido (algumas totalmente coloridas)
    const pipes: [number, number, number, string, string][] = [
      [-1.62, 2.52, 0.055, 'air', 'sea'],
      [-1.78, 2.38, 0.04, 'air', 'hyd'],
      [-1.95, 2.22, 0.035, 'hyd', 'air'],
      [-1.45, 2.66, 0.03, 'fire', 'air'],
      [1.6, 2.55, 0.05, 'air', 'fresh'],
      [1.8, 2.38, 0.04, 'sea', 'air'],
      [1.98, 2.2, 0.03, 'air', 'oil'],
      [1.42, 2.68, 0.035, 'air', 'fire'],
    ];
    for (const [x, y, r, c, b] of pipes) {
      const p = pipeRun(m.pipes[c], m.pipes[b], r, zf, za);
      p.position.set(x, y, 0);
      env.add(p);
    }
    for (const sx of [-1, 1]) {
      const t = cableTray(m, 0.32, zf, za);
      t.position.set(sx * 0.72, 2.6, 0);
      env.add(t);
      for (let z = zf + 0.6; z < za; z += 1.4) env.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.25, 6), m.steel, sx * 0.72, 2.72, z));
    }
    // luminárias (e as luzes pontuais em algumas delas)
    for (let z = -5.6; z <= 5.8; z += 2.3) {
      for (const sx of [-0.45, 0.45]) {
        const f = lightFixture(m, 1.2);
        f.position.set(sx, 2.42, z);
        env.add(f);
      }
    }
    // luzes pontuais (poucas: cada uma custa em todos os pixels); as luminárias acima são emissivas
    for (const z of this.lowQuality ? [-3.2, 3.0] : [-4.6, -1.5, 1.6, 4.7]) {
      const pl = new THREE.PointLight(0xfff4e6, this.lowQuality ? 16 : 11, 0, 1.6);
      pl.position.set(0, 2.3, z);
      this.scene.add(pl);
      this.lights.push(pl);
    }
    // iluminação de emergência (lanternas de combate) — acesa sem energia no barramento
    for (const [x, z] of [
      [-2.2, -6.6],
      [2.2, 6.6],
      [-2.3, 1.0],
    ] as const) {
      const pl = new THREE.PointLight(0xffd8a0, 0, 7, 2);
      pl.position.set(x, 2.1, z);
      this.scene.add(pl);
      this.emergency.push(pl);
      env.add(mesh(rbox(0.16, 0.12, 0.1, 0.02), m.yellow, x, 2.18, z));
    }
    this.bake(env, null);

    // ---------- POSTO DE GOVERNO (vante, bombordo)
    {
      const g = new THREE.Group();
      g.position.set(-1.25, 0, -5.95);
      const c = sitConsole(m, 2.5, 3, { tall: true });
      g.add(c.group);
      const [sl, sc, sr] = c.slots;
      this.addPanel(g, sl, { w: 0, h: 0, px: [960, 640], kind: 'screen', hz: 8, draw: drawPlanesman(this.act), station: 'governo', name: 'Planador' });
      this.addPanel(g, sc, { w: 0, h: 0, px: [960, 640], kind: 'screen', hz: 6, draw: drawConningOfficer(this.act), station: 'governo', name: 'Oficial de manobra' });
      this.addPanel(g, sr, { w: 0, h: 0, px: [960, 640], kind: 'screen', hz: 8, draw: drawHelmsman(this.act), station: 'governo', name: 'Timoneiro' });
      const ph1 = phone(m);
      ph1.position.set(-0.95, c.deskY + 0.02, 0.05);
      g.add(ph1);
      const ph2 = phone(m);
      ph2.position.set(0.98, c.deskY + 0.02, 0.05);
      g.add(ph2);
      this.label('PLANADOR', 0.36, 0.06, new THREE.Vector3(-0.62, c.deskY + 0.03, 0.17), 0, g);
      this.label('TIMONEIRO', 0.36, 0.06, new THREE.Vector3(0.62, c.deskY + 0.03, 0.17), 0, g);
      g.children.slice(-2).forEach((o) => (o.rotation.x = -Math.PI / 2));
      // manches e telégrafo
      this.addYokes(g, c.deskY);
      this.addTelegraph(g, c.deskY);
      this.bake(g, 'governo');
      this.block(-2.55, 0.05, -6.7, -5.72);
      this.placeSeat(-1.87, -5.12, 0, 'governo');
      this.placeSeat(-0.63, -5.12, 0, 'governo');
      // instrumentos de mergulho e anunciador na antepara de vante
      const bh = new THREE.Group();
      const gs: Slot = { pos: new THREE.Vector3(-1.12, 2.0, ROOM.zFwd + 0.075), quat: new THREE.Quaternion(), w: 2.2, h: 0.62 };
      bh.add(mesh(rbox(2.28, 0.7, 0.06, 0.02), m.darkGrey, gs.pos.x, gs.pos.y, ROOM.zFwd + 0.04));
      this.addPanel(bh, gs, { w: 0, h: 0, px: [1420, 400], kind: 'face', hz: 6, draw: drawDivingGauges(), station: 'instrumentos', name: 'Instrumentos de mergulho' });
      const an: Slot = { pos: new THREE.Vector3(0.95, 2.22, ROOM.zFwd + 0.075), quat: new THREE.Quaternion(), w: 1.26, h: 0.4 };
      bh.add(mesh(rbox(1.32, 0.46, 0.06, 0.02), m.darkGrey, an.pos.x, an.pos.y, ROOM.zFwd + 0.04));
      this.addPanel(bh, an, { w: 0, h: 0, px: [1240, 400], kind: 'face', hz: 5, draw: drawAnnunciator(this.act), station: 'alarmes', name: 'Anunciador de alarmes' });
      this.bake(bh, 'instrumentos');
    }

    // ---------- PAINEL DO LASTRO (vante, boreste)
    {
      const g = new THREE.Group();
      g.position.set(2.3, 0, -5.0);
      g.rotation.y = -Math.PI / 2;
      const p = standPanel(m, 1.75, 1.18, 0.82, { shelf: true, depth: 0.5 });
      g.add(p.group);
      this.addPanel(g, p.slot, { w: 0, h: 0, px: [1360, 920], kind: 'face', hz: 6, draw: drawBallastPanel(this.act), station: 'lastro', name: 'Painel do lastro' });
      // alavancas do sopro de emergência sobre a área vermelha do painel
      const W = 1360;
      const H = 920;
      const toLocal = (px: number, py: number) => new THREE.Vector3((px / W - 0.5) * p.slot.w, p.slot.pos.y + (0.5 - py / H) * p.slot.h, 0.03);
      const ty = 278;
      this.addEmergency(g, 'vante', toLocal(W - 196, ty + 262), ['TLP1BB', 'TLP1BE']);
      this.addEmergency(g, 'ré', toLocal(W - 84, ty + 262), ['TLP2BB', 'TLP2BE']);
      const ph1 = phone(m);
      ph1.position.set(-0.7, 0.78, 0.1);
      g.add(ph1);
      this.bake(g, 'lastro');
      this.block(1.95, 2.95, -5.95, -4.05);
      this.placeSeat(1.55, -5.0, -Math.PI / 2, 'lastro');
    }

    // ---------- PERISCÓPIOS e escada da torre (centro)
    this.addPeriscope(0, -2.75, true);
    this.addPeriscope(0, -1.45, false);
    {
      const g = new THREE.Group();
      const l = ladder(m, TOP - 0.05);
      l.position.set(0.85, 0, -0.35);
      g.add(l);
      this.bake(g, null);
      this.block(0.6, 1.1, -0.55, -0.2);
    }

    // ---------- CONSOLES MULTIFUNÇÃO (bombordo)
    const portConsoles: [number, string, ConstructorParameters<typeof CanvasPanel>[0]['draw'], ConstructorParameters<typeof CanvasPanel>[0]['draw'], string, string][] = [
      [-3.0, 'sonar', drawSonarWaterfall(this.act), drawSonarContacts(this.act), 'Sonar — cascata', 'Sonar — contatos'],
      [-1.75, 'combate', drawTacticalConsole(this.act), drawSonarContacts(this.act), 'Quadro tático', 'Contatos'],
      [-0.5, 'navegacao', drawNavigation(this.act), drawTacticalConsole(this.act), 'Navegação', 'Quadro tático'],
    ];
    for (const [z, st, top, bot, n1, n2] of portConsoles) {
      const g = new THREE.Group();
      g.position.set(-2.12, 0, z);
      g.rotation.y = Math.PI / 2;
      const c = stackConsole(m, 1.12);
      g.add(c.group);
      this.addPanel(g, c.slots[0], { w: 0, h: 0, px: [960, 640], kind: 'screen', hz: st === 'sonar' ? 4 : 3, draw: top, station: st, name: n1 });
      this.addPanel(g, c.slots[1], { w: 0, h: 0, px: [960, 640], kind: 'screen', hz: 3, draw: bot, station: st, name: n2 });
      this.bake(g, st);
      this.block(-2.95, -1.95, z - 0.6, z + 0.6);
      this.placeSeat(-1.42, z, Math.PI / 2, st);
    }
    // bastidores eletrônicos (bombordo e boreste, à ré dos consoles)
    {
      const g = new THREE.Group();
      const place = (x: number, z: number, rot: number, v: number) => {
        const holder = new THREE.Group();
        holder.add(rack(m, 0.6, 1.85, 0.55, v));
        holder.add(mesh(rbox(0.64, 0.06, 0.6, 0.02), m.cream, 0, 1.88, -0.28));
        holder.position.set(x, 0, z);
        holder.rotation.y = rot;
        g.add(holder);
      };
      place(-2.2, 0.75, Math.PI / 2, 0);
      place(-2.2, 1.38, Math.PI / 2, 1);
      place(2.22, 1.95, -Math.PI / 2, 2);
      place(2.22, 2.58, -Math.PI / 2, 0);
      this.bake(g, null);
      this.block(-2.95, -2.15, 0.4, 1.72);
      this.block(2.15, 2.95, 1.6, 2.92);
    }

    // ---------- SEGURANÇA DO MERGULHO, COLETOR e PLATAFORMA (boreste)
    {
      const g = new THREE.Group();
      g.position.set(2.05, 0, -2.55);
      g.rotation.y = -Math.PI / 2;
      const c = sitConsole(m, 1.5, 2);
      g.add(c.group);
      this.addPanel(g, c.slots[0], { w: 0, h: 0, px: [960, 640], kind: 'screen', hz: 5, draw: drawCompensation(this.act), station: 'mergulho', name: 'Compensação' });
      this.addPanel(g, c.slots[1], { w: 0, h: 0, px: [960, 640], kind: 'screen', hz: 5, draw: drawTrimHeel(this.act), station: 'mergulho', name: 'Trim e banda' });
      this.bake(g, 'mergulho');
      this.block(1.85, 2.95, -3.35, -1.75);
      this.placeSeat(1.33, -2.55, -Math.PI / 2, 'mergulho');
    }
    {
      const g = new THREE.Group();
      g.position.set(2.32, 0, -1.0);
      g.rotation.y = -Math.PI / 2;
      const p = standPanel(m, 1.3, 1.1, 0.78, { depth: 0.35 });
      g.add(p.group);
      this.addPanel(g, p.slot, { w: 0, h: 0, px: [1000, 846], kind: 'face', hz: 4, draw: drawManifold(), station: 'coletor', name: 'Coletor de válvulas' });
      this.addHandwheels(g, p.slot);
      this.bake(g, 'coletor');
      this.block(2.1, 2.95, -1.7, -0.3);
    }
    {
      const g = new THREE.Group();
      g.position.set(2.05, 0, 0.55);
      g.rotation.y = -Math.PI / 2;
      const c = sitConsole(m, 1.5, 2);
      g.add(c.group);
      this.addPanel(g, c.slots[0], { w: 0, h: 0, px: [960, 640], kind: 'screen', hz: 4, draw: drawEnergy(this.act), station: 'plataforma', name: 'Energia' });
      this.addPanel(g, c.slots[1], { w: 0, h: 0, px: [960, 640], kind: 'screen', hz: 4, draw: drawPropulsion(this.act), station: 'plataforma', name: 'Propulsão' });
      this.bake(g, 'plataforma');
      this.block(1.85, 2.95, -0.22, 1.32);
      this.placeSeat(1.33, 0.55, -Math.PI / 2, 'plataforma');
    }

    // ---------- MESA TÁTICA (centro, à ré)
    {
      const g = new THREE.Group();
      g.position.set(0, 0, 2.7);
      g.add(mesh(rbox(1.62, 0.86, 1.04, 0.04), m.cream, 0, 0.43, 0));
      g.add(mesh(new THREE.BoxGeometry(1.5, 0.08, 0.92), m.black, 0, 0.04, 0));
      // moldura com rebites
      g.add(mesh(rbox(1.78, 0.08, 1.2, 0.03), m.cream, 0, 0.91, 0));
      for (let i = 0; i < 24; i++) {
        const t = i / 24;
        const per = 2 * (1.7 + 1.12);
        let d = t * per;
        let x: number;
        let z: number;
        if (d < 1.7) [x, z] = [-0.85 + d, -0.56];
        else if ((d -= 1.7) < 1.12) [x, z] = [0.85, -0.56 + d];
        else if ((d -= 1.12) < 1.7) [x, z] = [0.85 - d, 0.56];
        else [x, z] = [-0.85, 0.56 - (d - 1.7)];
        g.add(mesh(new THREE.SphereGeometry(0.012, 8, 6), m.steel, x, 0.955, z));
      }
      const slot: Slot = { pos: new THREE.Vector3(0, 0.957, 0), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), w: 1.58, h: 0.98 };
      this.addPanel(g, slot, { w: 0, h: 0, px: [1024, 640], kind: 'screen', hz: 3, draw: drawPlotTable(this.act), station: 'mesa', name: 'Mesa tática' });
      this.bake(g, 'mesa');
      this.block(-0.92, 0.92, 2.08, 3.32);
    }

    // ---------- ESTAÇÃO DO INSTRUTOR (ré, bombordo)
    {
      const g = new THREE.Group();
      g.position.set(-1.25, 0, 6.15);
      g.rotation.y = Math.PI;
      const c = sitConsole(m, 1.6, 2, { body: m.grey });
      g.add(c.group);
      this.addPanel(g, c.slots[0], { w: 0, h: 0, px: [960, 640], kind: 'screen', hz: 3, draw: drawInstructorFailures(this.act), station: 'instrutor', name: 'Falhas' });
      this.addPanel(g, c.slots[1], { w: 0, h: 0, px: [960, 640], kind: 'screen', hz: 3, draw: drawInstructorSim(this.act), station: 'instrutor', name: 'Simulação' });
      this.label('ESTAÇÃO DO INSTRUTOR (SIMULADOR)', 1.0, 0.08, new THREE.Vector3(0, 1.62, -0.42), 0, g);
      this.bake(g, 'instrutor');
      this.block(-2.1, -0.4, 5.45, 6.85);
      this.placeSeat(-1.25, 5.32, Math.PI, 'instrutor');
    }

    // ---------- detalhes das anteparas e do casco à ré: armários, ar de respiração de emergência, comunicações e sinalização
    {
      const g = new THREE.Group();
      // armários (bombordo, à ré dos bastidores)
      for (const z of [2.35, 2.98, 3.61]) {
        const lk = new THREE.Group();
        lk.add(mesh(rbox(0.6, 1.7, 0.45, 0.02), m.grey, 0, 0.85, -0.225));
        lk.add(mesh(new THREE.BoxGeometry(0.02, 1.5, 0.01), m.darkGrey, 0, 0.85, 0.005));
        lk.add(mesh(new THREE.BoxGeometry(0.03, 0.14, 0.03), m.chrome, 0.06, 1.0, 0.02));
        for (let k = 0; k < 4; k++) lk.add(mesh(new THREE.BoxGeometry(0.4, 0.012, 0.01), m.darkGrey, 0, 1.45 + k * 0.03, 0.006));
        lk.position.set(-2.32, 0, z);
        lk.rotation.y = Math.PI / 2;
        g.add(lk);
      }
      this.block(-2.95, -2.05, 2.0, 3.95);
      // coletor de ar de respiração de emergência (amarelo) ao longo do teto, com tomadas
      for (const sx of [-1, 1]) {
        g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 13.4, 10), m.yellow, sx * 1.28, 2.42, 0).rotateX(Math.PI / 2));
        for (let z = -5.5; z <= 5.6; z += 2.2) g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 10), m.yellow, sx * 1.28, 2.37, z));
      }
      // painel de comunicações internas (telefones autoexcitados) a boreste, à ré
      const cp = new THREE.Group();
      cp.add(mesh(rbox(0.7, 0.55, 0.12, 0.02), m.grey, 0, 1.45, -0.06));
      for (let k = 0; k < 3; k++) {
        cp.add(mesh(rbox(0.06, 0.18, 0.06, 0.02), m.black, -0.22 + k * 0.22, 1.42, 0.04));
        cp.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 14), m.steel, -0.22 + k * 0.22, 1.6, 0.02).rotateX(Math.PI / 2));
      }
      cp.position.set(2.42, 0, 4.4);
      cp.rotation.y = -Math.PI / 2;
      g.add(cp);
      this.label('COMUNICAÇÕES INTERNAS', 0.6, 0.06, new THREE.Vector3(0, 1.78, 0.002), 0, cp);
      // sinalização nas anteparas
      this.label('COMPARTIMENTO CENTRAL — SALA DE COMANDO', 1.3, 0.09, new THREE.Vector3(-1.0, 2.42, ROOM.zAft - 0.02), Math.PI, g);
      this.label('PORTA ESTANQUE — MANTER FECHADA', 0.8, 0.07, new THREE.Vector3(0.95, 2.12, ROOM.zAft - 0.02), Math.PI, g);
      this.label('PORTA ESTANQUE — MANTER FECHADA', 0.8, 0.07, new THREE.Vector3(0.95, 0.24, ROOM.zFwd + 0.02), 0, g);
      this.label('PERISCÓPIO DE ATAQUE', 0.5, 0.06, new THREE.Vector3(0.0, 2.65, -2.75 + 0.22), 0, g);
      this.bake(g, null);
    }

    // ---------- interruptor de iluminação junto à porta de ré
    {
      const box = new THREE.Group();
      box.add(mesh(rbox(0.2, 0.28, 0.08, 0.02), m.grey, 0, 0, 0));
      const knob = mesh(new THREE.BoxGeometry(0.05, 0.1, 0.05), m.black, 0, 0, 0.06);
      box.add(knob);
      box.position.set(1.85, 1.35, ROOM.zAft - 0.06);
      box.rotation.y = Math.PI;
      this.scene.add(box);
      const order: RoomLighting[] = ['normal', 'vermelha', 'azul'];
      this.addControl({
        id: 'light-switch',
        station: null,
        obj: box,
        label: () => `Iluminação da sala: ${this.ui.lighting.toUpperCase()} — clique para alternar (normal · vermelha · azul)`,
        click: () => (this.ui.lighting = order[(order.indexOf(this.ui.lighting) + 1) % order.length]),
        update: () => (knob.rotation.z = (order.indexOf(this.ui.lighting) - 1) * 0.6),
      });
    }
  }

  /** manches do planador (lemes de ré) e do timoneiro (leme de direção + lemes de vante) */
  private addYokes(g: THREE.Group, deskY: number): void {
    const m = this.mats;
    const e = () => this.runner.engine;
    const fin = (id: string) => e().vessel.fins.find((f) => f.id === id)!;
    // planador
    {
      const y = yoke(m);
      y.group.position.set(-0.62, deskY + 0.08, -0.12);
      g.add(y.group);
      let base = 0;
      let prev: number | null = null;
      const send = throttled<number>((v) => this.act.cmd({ type: 'surface', id: 'stern', angle: v }));
      this.addControl({
        id: 'yoke-planesman',
        station: 'governo',
        obj: y.group,
        label: (en) =>
          `Manche do PLANADOR — lemes de ré: ordem ${en.state.surfaces.stern.cmd.toFixed(0)}° · real ${en.state.surfaces.stern.actual.toFixed(1)}°. Arraste: para cima = empurrar = DESCER; para baixo = puxar = SUBIR.`,
        drag: {
          begin: () => {
            base = e().state.surfaces.stern.cmd;
            prev = base;
          },
          move: (_dx, dy) => {
            const mx = fin('stern').maxDeflection;
            const v = Math.round(clamp(base + dy * 0.12, -mx, mx));
            prev = v;
            send.push(v, String(v));
          },
          end: () => {
            send.flush();
            prev = null;
          },
        },
        update: (en) => {
          const v = prev ?? en.state.surfaces.stern.cmd;
          y.column.position.z = (v / fin('stern').maxDeflection) * 0.07;
        },
      });
    }
    // timoneiro
    {
      const y = yoke(m);
      y.group.position.set(0.62, deskY + 0.08, -0.12);
      g.add(y.group);
      let base = { r: 0, b: 0 };
      let prev: { r: number; b: number } | null = null;
      const sendR = throttled<number>((v) => this.act.cmd({ type: 'surface', id: 'rudder', angle: v }));
      const sendB = throttled<number>((v) => this.act.cmd({ type: 'surface', id: 'bow', angle: v }));
      this.addControl({
        id: 'yoke-helmsman',
        station: 'governo',
        obj: y.group,
        label: (en) =>
          `Manche do TIMONEIRO — leme ${Math.abs(en.state.surfaces.rudder.cmd).toFixed(0)}° ${en.state.surfaces.rudder.cmd > 0.5 ? 'BE' : en.state.surfaces.rudder.cmd < -0.5 ? 'BB' : 'a meio'}, lemes de vante ${en.state.surfaces.bow.cmd.toFixed(0)}°. Arraste: lados = leme de direção (BB/BE); cima/baixo = lemes de vante (descer/subir).`,
        drag: {
          begin: () => {
            base = { r: e().state.surfaces.rudder.cmd, b: e().state.surfaces.bow.cmd };
            prev = { ...base };
          },
          move: (dx, dy) => {
            const rm = fin('rudder').maxDeflection;
            const bm = fin('bow').maxDeflection;
            // movimento dominante: evita mexer sem querer no outro leme
            const r = Math.abs(dx) > Math.abs(dy) * 0.5 ? Math.round(clamp(base.r + dx * 0.15, -rm, rm)) : (prev?.r ?? base.r);
            const b = Math.abs(dy) > Math.abs(dx) * 0.5 ? Math.round(clamp(base.b + dy * 0.12, -bm, bm)) : (prev?.b ?? base.b);
            if (prev && r !== prev.r) sendR.push(r, String(r));
            if (prev && b !== prev.b) sendB.push(b, String(b));
            prev = { r, b };
          },
          end: () => {
            sendR.flush();
            sendB.flush();
            prev = null;
          },
        },
        update: (en) => {
          const r = prev?.r ?? en.state.surfaces.rudder.cmd;
          const b = prev?.b ?? en.state.surfaces.bow.cmd;
          y.wheel.rotation.z = (-r / fin('rudder').maxDeflection) * 0.9;
          y.column.position.z = (b / fin('bow').maxDeflection) * 0.07;
        },
      });
    }
  }

  private addTelegraph(g: THREE.Group, deskY: number): void {
    const t = telegraphLever(this.mats);
    t.group.position.set(0, deskY + 0.05, -0.06);
    g.add(t.group);
    const e = () => this.runner.engine;
    let base = 0;
    let prev: number | null = null;
    const rated = () => e().vessel.propulsion.motor.ratedRpm;
    this.addControl({
      id: 'telegraph',
      station: 'governo',
      obj: t.group,
      label: (en) =>
        `Telégrafo de máquinas: ${nearestOrder(prev ?? en.state.propulsion.rpmCmd).label} (${(prev ?? en.state.propulsion.rpmCmd).toFixed(0)} rpm; eixo ${en.outputs.rpm.toFixed(0)} rpm). Arraste para cima = avante, para baixo = a ré; encaixa nas ordens ao soltar.`,
      drag: {
        begin: () => {
          base = e().state.propulsion.rpmCmd;
          prev = base;
        },
        move: (_dx, dy) => {
          prev = clamp(base - dy * 1.1, TELEGRAPH[0].rpm, rated());
        },
        end: () => {
          if (prev !== null) this.act.cmd({ type: 'telegraph', rpm: nearestOrder(prev).rpm });
          prev = null;
        },
      },
      update: (en) => {
        const v = prev ?? en.state.propulsion.rpmCmd;
        t.lever.rotation.x = (-v / rated()) * 0.95;
      },
    });
  }

  /** alavanca do sopro de emergência de um grupo de TLP (tampa de proteção: 1º clique levanta, 2º puxa) */
  private addEmergency(g: THREE.Group, name: string, pos: THREE.Vector3, tanks: string[]): void {
    const h = emergencyHandle(this.mats);
    h.group.position.copy(pos);
    g.add(h.group);
    const id = `eb-${name}`;
    const pulled = (en: SimulationEngine) => tanks.every((t) => en.state.ballast[t].blow.cmd > 0.5 && en.state.ballast[t].vent.cmd < 0.5);
    let guardTimer = 0;
    this.addControl({
      id,
      station: 'lastro',
      obj: h.group,
      label: (en) =>
        pulled(en)
          ? `SOPRO DE EMERGÊNCIA ${name.toUpperCase()}: PUXADO (soprando ${tanks.join(', ')}). Clique para recolocar (fechar o sopro).`
          : this.ui.guards[id]
            ? `SOPRO DE EMERGÊNCIA ${name.toUpperCase()}: tampa aberta — clique para PUXAR (fecha os suspiros, abre o sopro e os grupos de ar AP)`
            : `SOPRO DE EMERGÊNCIA ${name.toUpperCase()}: clique para levantar a tampa de proteção`,
      click: () => {
        const en = this.runner.engine;
        if (pulled(en)) {
          for (const t of tanks) this.act.cmd({ type: 'mbtBlow', tank: t, open: false });
          this.ui.guards[id] = false;
          return;
        }
        if (!this.ui.guards[id]) {
          this.ui.guards[id] = true;
          window.clearTimeout(guardTimer);
          guardTimer = window.setTimeout(() => (this.ui.guards[id] = false), 12000);
          return;
        }
        for (const t of tanks) {
          this.act.cmd({ type: 'mbtVent', tank: t, open: false });
          this.act.cmd({ type: 'mbtBlow', tank: t, open: true });
        }
        for (const b of en.vessel.hpAir.banks) if (en.state.hpAir.banks[b.id].valve.cmd < 0.5) this.act.cmd({ type: 'hpBankValve', bank: b.id, open: true });
      },
      update: (en) => {
        const p = pulled(en);
        h.handle.position.z = THREE.MathUtils.lerp(h.handle.position.z, p ? 0.07 : 0, 0.2);
        const open = this.ui.guards[id] || p;
        h.guard.rotation.x = THREE.MathUtils.lerp(h.guard.rotation.x, open ? -1.9 : 0, 0.2);
      },
    });
  }

  /** volantes das válvulas manuais do coletor (posições casadas com as etiquetas desenhadas) */
  private addHandwheels(g: THREE.Group, slot: Slot): void {
    MANIFOLD_VALVES.forEach((mv, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const u = 0.125 + col * 0.25;
      const v = 0.57 + row * 0.24;
      const w = handwheel(this.mats, 0.085, this.mats.wheel[mv.sys]);
      w.position.set((u - 0.5) * slot.w, slot.pos.y + (0.5 - v) * slot.h, 0.1);
      g.add(w);
      this.addControl({
        id: `hw-${mv.id}`,
        station: 'coletor',
        obj: w,
        label: (en) => {
          const order = manifoldValveOrder(en, mv) > 0.5;
          const pos = manifoldValveCmd(en, mv);
          const st = pos >= 0.999 ? 'ABERTA' : pos <= 0.001 ? 'FECHADA' : order ? 'ABRINDO' : 'FECHANDO';
          return `${mv.label}: ${st} — clique para ${order ? 'FECHAR' : 'ABRIR'}`;
        },
        click: () => this.act.cmd(manifoldToggle(this.runner.engine, mv)),
        update: (en) => (w.rotation.z = -manifoldValveCmd(en, mv) * Math.PI * 3),
      });
    });
  }

  /** periscópio (o de ataque é funcional; o de busca/optrônico é ilustrativo) */
  private addPeriscope(x: number, z: number, attack: boolean): void {
    const m = this.mats;
    const p = periscope(m, TOP - 0.25);
    p.group.position.set(x, 0, z);
    this.scene.add(p.group);
    this.circles.push({ x, z, r: 0.34 });
    if (!attack) {
      // mastro optrônico/busca: arriado (só o tubo no teto)
      p.head.position.y = 2.2;
      p.tube.scale.y = 0.6;
      p.tube.position.y = 2.75;
      p.handles.forEach((h) => (h.rotation.z = 0));
      p.group.userData.dynamic = true;
      this.pickables.push(p.group);
      p.group.traverse((o) => (o.userData.station = 'periscopio'));
      p.group.traverse((o) => (o.userData.tip = 'Periscópio de busca / mastro optrônico (ilustrativo, arriado). O periscópio de ataque fica à vante.'));
      return;
    }
    const top = TOP - 0.25;
    this.addControl({
      id: 'periscope',
      station: 'periscopio',
      obj: p.group,
      label: (en) => `Periscópio de ataque — ${Math.round((en.state.periscope?.pos ?? 0) * 100)} % içado. Clique na ocular para olhar.`,
      click: () => this.act.periscopeView(),
      update: (en) => {
        const pos = en.state.periscope?.pos ?? 0;
        const hy = 0.12 + pos * 1.42;
        p.head.position.y = hy;
        const len = Math.max(0.05, top - (hy + 0.18));
        p.tube.scale.y = len;
        p.tube.position.y = hy + 0.18 + len / 2;
        p.handles.forEach((h, k) => (h.rotation.z = (k ? 1 : -1) * (1 - pos) * 1.5));
        p.group.rotation.y = (-this.periBearing * Math.PI) / 180;
      },
    });
    // coluna com a alavanca de içamento
    const col = new THREE.Group();
    col.position.set(x + 0.62, 0, z + 0.05);
    col.add(geomUtil.mesh(new THREE.CylinderGeometry(0.035, 0.035, TOP, 10), m.steel, 0, TOP / 2, 0));
    const box = geomUtil.mesh(geomUtil.rbox(0.16, 0.22, 0.12, 0.02), m.grey, 0, 1.3, 0.05);
    col.add(box);
    const lever = new THREE.Group();
    lever.position.set(0, 1.3, 0.12);
    lever.add(geomUtil.mesh(new THREE.BoxGeometry(0.025, 0.14, 0.025), m.chrome, 0, 0.06, 0));
    lever.add(geomUtil.mesh(new THREE.SphereGeometry(0.03, 12, 8), m.black, 0, 0.13, 0));
    col.add(lever);
    this.scene.add(col);
    this.circles.push({ x: x + 0.62, z: z + 0.05, r: 0.1 });
    this.addControl({
      id: 'periscope-hoist',
      station: 'periscopio',
      obj: col,
      label: (en) => `Alavanca de içamento do periscópio: ${en.state.periscope?.cmd ? 'IÇAR' : 'ARRIAR'} — clique para ${en.state.periscope?.cmd ? 'ARRIAR' : 'IÇAR'}`,
      click: () => this.act.cmd({ type: 'periscope', raise: !this.runner.engine.state.periscope?.cmd }),
      update: (en) => (lever.rotation.x = en.state.periscope?.cmd ? -0.6 : 0.6),
    });
  }

  // ------------------------------------------------------------------ câmera e movimento
  resize(): void {
    const w = Math.max(10, this.container.clientWidth);
    const h = Math.max(10, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // telas estreitas (retrato): campo de visão maior
    const base = w / h < 0.9 ? 78 : 62;
    this.camera.fov = (2 * Math.atan(Math.tan((base * Math.PI) / 360) / (this.focused ? this.zoom : 1)) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
    // redesenha já: setSize limpa o canvas (evita um quadro preto ao abrir/fechar o painel lateral)
    if (!this.disposed && this.scene.children.length) this.renderer.render(this.scene, this.camera);
  }

  private lookQuat(yaw: number, pitch: number): THREE.Quaternion {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  }

  /** aproxima a câmera de uma estação (ou volta a andar com null) */
  focus(id: string | null): void {
    this.zoom = 1;
    if (!id) {
      if (this.focused) {
        this.focused = null;
        this.resize();
        // de pé no lugar, fora dos obstáculos
        this.pos.y = ROOM.eye;
        this.collide();
        this.onFocus?.(null);
      }
      return;
    }
    const st = stationById(id);
    if (!st) return;
    const to = new THREE.Vector3(...st.view.pos);
    const look = new THREE.Vector3(...st.view.look);
    const d = look.clone().sub(to).normalize();
    const yaw = Math.atan2(-d.x, -d.z);
    const pitch = Math.asin(clamp(d.y, -1, 1));
    this.tween = { from: this.pos.clone(), to, qFrom: this.lookQuat(this.yaw, this.pitch), qTo: this.lookQuat(yaw, pitch), t: 0 };
    this.yaw = yaw;
    this.pitch = pitch;
    this.focused = id;
    this.resize();
    this.onFocus?.(id);
  }

  /** tecla pressionada/solta (WASD/setas, Shift = correr) */
  key(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  /** olha ao redor (px de arrasto) */
  look(dx: number, dy: number): void {
    this.cancelTween();
    const k = (this.camera.fov / 62) * 0.0042;
    this.yaw -= dx * k;
    this.pitch = clamp(this.pitch - dy * k, -1.35, 1.35);
  }

  private cancelTween(): void {
    if (!this.tween) return;
    this.pos.copy(this.camera.position);
    this.tween = null;
  }

  /** aproximação óptica no posto em foco (1 = normal) */
  private zoom = 1;

  /** roda do mouse: no posto em foco aproxima/afasta a vista (zoom); andando, dá um passo */
  wheel(dir: number): void {
    if (this.focused) {
      this.zoom = clamp(this.zoom * (dir > 0 ? 1.18 : 1 / 1.18), 1, 3.5);
      this.resize();
      return;
    }
    this.step(dir * 0.35);
  }

  /** passo à frente/atrás */
  step(d: number): void {
    this.cancelTween();
    if (this.focused) this.focus(null);
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.pos.addScaledVector(f, d);
    this.collide();
  }

  private collide(): void {
    const p = this.pos;
    const r = 0.26;
    p.z = clamp(p.z, ROOM.zFwd + 0.35, ROOM.zAft - 0.35);
    const hw = halfWidth(1.2) - 0.45;
    p.x = clamp(p.x, -hw, hw);
    for (const o of this.obstacles) {
      if (p.x > o.x0 - r && p.x < o.x1 + r && p.z > o.z0 - r && p.z < o.z1 + r) {
        const dx0 = p.x - (o.x0 - r);
        const dx1 = o.x1 + r - p.x;
        const dz0 = p.z - (o.z0 - r);
        const dz1 = o.z1 + r - p.z;
        const mn = Math.min(dx0, dx1, dz0, dz1);
        if (mn === dx0) p.x = o.x0 - r;
        else if (mn === dx1) p.x = o.x1 + r;
        else if (mn === dz0) p.z = o.z0 - r;
        else p.z = o.z1 + r;
      }
    }
    for (const c of this.circles) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      const rr = c.r + r;
      if (d < rr && d > 1e-6) {
        p.x = c.x + (dx / d) * rr;
        p.z = c.z + (dz / d) * rr;
      }
    }
  }

  private updateCamera(dt: number): void {
    // deslocamento por teclado / botões de toque
    let f = this.move.f;
    let s = this.move.s;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyA')) s -= 1;
    if (this.keys.has('KeyD')) s += 1;
    if (this.keys.has('ArrowLeft')) this.yaw += dt * 1.6;
    if (this.keys.has('ArrowRight')) this.yaw -= dt * 1.6;
    if ((f || s) && this.focused) this.focus(null);
    if (f || s) {
      this.cancelTween();
      const sp = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 2.8 : 1.4) * dt;
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const n = Math.hypot(f, s) || 1;
      this.pos.addScaledVector(fwd, (f / n) * sp).addScaledVector(right, (s / n) * sp);
      this.pos.y += (ROOM.eye - this.pos.y) * Math.min(1, dt * 6);
      this.collide();
    }
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / 0.75);
      const k = 1 - Math.pow(1 - tw.t, 3);
      this.camera.position.lerpVectors(tw.from, tw.to, k);
      this.camera.quaternion.slerpQuaternions(tw.qFrom, tw.qTo, k);
      if (tw.t >= 1) {
        this.pos.copy(tw.to);
        this.tween = null;
      }
    } else {
      this.camera.position.copy(this.pos);
      this.camera.quaternion.copy(this.lookQuat(this.yaw, this.pitch));
    }
  }

  // ------------------------------------------------------------------ interação
  private setNdc(x: number, y: number): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }

  /** o que está sob o ponteiro (coordenadas de tela) */
  private pickAt(x: number, y: number): { ctl: Control3D | null; panel: CanvasPanel | null; region: HitRegion | null; station: string | null; tip: string | null; dist: number } | null {
    this.setNdc(x, y);
    const hits = this.ray.intersectObjects(this.pickables, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.control && !o.userData.panel && !o.userData.station) o = o.parent;
      // primeira superfície sem função (parede, piso, teto): bloqueia
      if (!o) return null;
      const ctl = (o.userData.control as Control3D | undefined) ?? null;
      const panel = (o.userData.panel as CanvasPanel | undefined) ?? null;
      const region = panel && h.uv ? panel.hitTest(h.uv) : null;
      const station = ctl?.station ?? panel?.opts.station ?? (o.userData.station as string | undefined) ?? null;
      return { ctl, panel, region, station, tip: (h.object.userData.tip as string | undefined) ?? null, dist: h.distance };
    }
    return null;
  }

  pointerDown(x: number, y: number): void {
    const p = this.pickAt(x, y);
    const ctl = p?.ctl && p.ctl.drag && (p.dist < REACH || this.focused === p.ctl.station) ? p.ctl : null;
    this.down = { x, y, lx: x, ly: y, ctl, moved: false };
    if (ctl) {
      this.dragging = ctl;
      ctl.drag!.begin();
    }
  }

  pointerMove(x: number, y: number, buttons: number): void {
    const d = this.down;
    if (d && buttons) {
      if (Math.hypot(x - d.x, y - d.y) > 5) d.moved = true;
      if (this.dragging) this.dragging.drag!.move(x - d.x, y - d.y);
      else if (d.moved) this.look(x - d.lx, y - d.ly);
      d.lx = x;
      d.ly = y;
      if (this.dragging) this.emitHover(this.dragging.label(this.runner.engine), true, this.dragging.station);
      return;
    }
    const now = performance.now();
    if (now - this.lastHover < 45) return;
    this.lastHover = now;
    this.hover(x, y);
  }

  pointerUp(x: number, y: number): void {
    const d = this.down;
    this.down = null;
    if (this.dragging) {
      this.dragging.drag!.end();
      this.dragging = null;
      return;
    }
    if (d && !d.moved) this.click(x, y);
  }

  private emitHover(text: string, direct: boolean, station: string | null): void {
    this.onHover?.({ text, direct, station });
  }

  private hover(x: number, y: number): void {
    const p = this.pickAt(x, y);
    const prevPanel = this.hoverPanel;
    const prevRegion = this.hoverRegion;
    this.hoverPanel = p?.panel ?? null;
    this.hoverRegion = p?.region?.id ?? null;
    if (prevPanel && (prevPanel !== this.hoverPanel || prevRegion !== this.hoverRegion)) prevPanel.dirty = true;
    if (this.hoverPanel && prevRegion !== this.hoverRegion) this.hoverPanel.dirty = true;
    this.renderer.domElement.style.cursor = p && (p.ctl || p.region?.action || p.station) ? 'pointer' : 'default';
    if (!p) return this.onHover?.(null);
    const near = p.dist < REACH || (!!p.station && this.focused === p.station);
    const st = p.station ? stationById(p.station) : null;
    if (p.ctl) return this.emitHover(near || !p.ctl.station ? p.ctl.label(this.runner.engine) : `${st?.name ?? ''} — clique para aproximar`, near || !p.ctl.station, p.station);
    if (p.region) return this.emitHover(near ? p.region.label : `${p.panel?.opts.name ?? st?.name ?? ''}: ${p.region.label} — clique para aproximar`, near && !!p.region.action, p.station);
    if (p.tip) return this.emitHover(p.tip, false, p.station);
    if (st) return this.emitHover(`${st.name} — clique para aproximar e abrir o painel`, false, st.id);
    this.onHover?.(null);
  }

  private click(x: number, y: number): void {
    const p = this.pickAt(x, y);
    if (!p) return;
    const near = p.dist < REACH || (!!p.station && this.focused === p.station);
    if (p.ctl && (near || !p.ctl.station)) {
      if (p.ctl.click) p.ctl.click();
      else if (p.ctl.station && this.focused !== p.ctl.station) this.focus(p.ctl.station);
      this.markDirty(p.ctl.station);
      return;
    }
    if (p.region?.action && near) {
      p.region.action();
      this.markDirty(p.panel?.opts.station ?? null);
      return;
    }
    if (p.station && this.focused !== p.station) this.focus(p.station);
  }

  private markDirty(station: string | null): void {
    for (const p of this.panels) if (!station || p.opts.station === station) p.dirty = true;
  }

  // ------------------------------------------------------------------ quadro
  private applyLighting(e: SimulationEngine): void {
    const powered = e.state.electrical.energized;
    const mode = this.ui.lighting;
    const key = `${mode}|${powered}`;
    if (key === this.lightKey) return;
    this.lightKey = key;
    const col = mode === 'vermelha' ? 0xff2a14 : mode === 'azul' ? 0x6f9bff : 0xfff4e6;
    // vermelha/azul: iluminação baixa (adaptação ao escuro), as telas ficam mais fracas
    const k = !powered ? 0.0 : mode === 'normal' ? 1 : mode === 'vermelha' ? 0.13 : 0.2;
    const base = this.lowQuality ? 16 : 11;
    for (const l of this.lights) {
      l.color.setHex(col);
      l.intensity = base * k;
    }
    this.mats.diffuser.emissive.setHex(col);
    this.mats.diffuser.emissiveIntensity = powered ? (mode === 'normal' ? 2.2 : 0.9) : 0.05;
    this.hemi.color.setHex(mode === 'vermelha' ? 0xff3020 : mode === 'azul' ? 0x5070e0 : 0xe8eef4);
    this.hemi.intensity = !powered ? 0.06 : mode === 'normal' ? 0.9 : 0.1;
    this.scene.environmentIntensity = !powered ? 0.02 : mode === 'normal' ? 0.3 : 0.03;
    for (const l of this.emergency) l.intensity = powered ? 0 : 5;
    const screen = mode === 'normal' ? 1 : 0.7;
    for (const p of this.panels) p.setScreenLevel(screen);
    this.renderer.toneMappingExposure = 1.0;
  }

  /** desenha um quadro; retorna false se já foi destruída */
  render(): boolean {
    if (this.disposed) return false;
    const dt = Math.min(0.1, this.clock.getDelta());
    this.wall += dt;
    const e = this.runner.engine;
    this.updateCamera(dt);
    this.applyLighting(e);
    for (const c of this.controls) c.update?.(e, dt);
    // alarme crítico não reconhecido: sinalizador
    const crit = ALARM_DEFS.some((d) => d.priority <= 2 && e.state.alarms.runtime[d.id]?.active && !e.state.alarms.runtime[d.id]?.acked);
    const pulse = crit ? 0.5 + 0.5 * Math.sin(this.wall * 9) : 0;
    this.beacon.light.intensity = pulse * 6;
    (this.beacon.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse * 3;
    // água de alagamento no piso (compartimento central): altura = volume / área do piso
    const fl = e.state.flooding.CC;
    const lvl = fl ? fl.water / 1025 / (6.0 * 14) : 0;
    this.water.visible = lvl > 0.003;
    this.water.position.y = Math.min(1.6, lvl) + 0.005;
    // telas visíveis: redesenho por prioridade (perto primeiro), com orçamento por quadro
    this.camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    const now = this.wall;
    const due: { p: CanvasPanel; d: number }[] = [];
    const wp = new THREE.Vector3();
    for (const p of this.panels) {
      p.mesh.getWorldPosition(wp);
      const d = wp.distanceTo(this.camera.position);
      if (d > 12 || !frustum.intersectsObject(p.mesh)) continue;
      const hz = d < 3.5 ? p.opts.hz : d < 7 ? Math.min(p.opts.hz, 2) : 0.7;
      if (p.dirty || now - p.lastDraw > 1 / hz) due.push({ p, d });
    }
    due.sort((a, b) => (a.p.dirty === b.p.dirty ? a.d - b.d : a.p.dirty ? -1 : 1));
    const budget = this.lowQuality ? 2 : 3;
    for (const { p } of due.slice(0, budget)) p.redraw(e, now, this.ui, p === this.hoverPanel ? this.hoverRegion : null);
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  /** estado da câmera para guardar entre trocas de aba */
  getPose(): { pos: [number, number, number]; yaw: number; pitch: number } {
    return { pos: [this.pos.x, this.pos.y, this.pos.z], yaw: this.yaw, pitch: this.pitch };
  }

  setPose(p: { pos: [number, number, number]; yaw: number; pitch: number }): void {
    if (!p || !Array.isArray(p.pos)) return;
    this.pos.set(...p.pos);
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this.collide();
    this.updateCamera(0);
  }

  dispose(): void {
    this.disposed = true;
    for (const p of this.panels) p.dispose();
    const mats = new Set<THREE.Material>(this.mats.all());
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
      for (const mt of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mt);
    });
    for (const mt of mats) mt.dispose();
    this.envTex.dispose();
    this.pmrem.dispose();
    disposeRoomTextures();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export { STATIONS };
