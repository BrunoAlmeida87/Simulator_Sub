/**
 * TANQUES, TUBULAÇÕES E ESCOAMENTOS no corte do submarino.
 *
 * Níveis, válvulas, bombas e vazões vêm do estado do motor a cada quadro:
 *  - nível de cada tanque = volume simulado (o nível da seção em "D" dos TLP é
 *    obtido invertendo a curva área × altura, para que o volume desenhado seja
 *    o volume calculado);
 *  - válvulas: cor pela posição real (verde aberta, vermelha fechada, âmbar em curso);
 *  - bombas: rotor gira com a rotação simulada;
 *  - partículas de escoamento: sentido e velocidade pela vazão simulada
 *    (água de alagamento/expulsão, ar dos suspiros, ar AP do sopro, ar
 *    derramado pelos embornais, admissão/descarga de compensação, trim e banda).
 */
import * as THREE from 'three';
import type { SimulationEngine } from '../sim/core/engine';
import { buildCompensationCircuit, circuitEdgeFlow, selectorValve } from '../sim/systems/compensationCircuit';
import { tankVolume } from '../sim/systems/internalTanks';
import type { ValveState } from '../sim/core/state';
import { TANK_STYLE, type SceneLayers, type TankCategory } from './layers';
import type { Label3D } from './SubmarineScene';

type V3 = { x: number; y: number; z: number };
/** corpo (x vante, y boreste, z para baixo) → local do grupo do submarino */
const b2l = (x: number, y: number, z: number) => new THREE.Vector3(y, -z, -x);

interface TankVis {
  id: string;
  cat: TankCategory;
  name: string;
  short: string;
  /** centro no corpo e topo (para rótulos) */
  top: V3;
  meshes: THREE.Object3D[];
  waterMat: THREE.MeshStandardMaterial;
  airMat: THREE.MeshStandardMaterial;
  edgeMat: THREE.LineBasicMaterial;
  surf: THREE.Mesh;
  pick: THREE.Mesh;
  getVol: (e: SimulationEngine) => number;
  cap: number;
  getFlow: (e: SimulationEngine) => number; // m³/s (+ entrando)
  setLevel: (fill: number) => void;
}

interface Stream {
  pts: THREE.Vector3[];
  cum: number[];
  total: number;
  color: THREE.Color;
  /** vazão normalizada e com sinal (−1 … 1); sinal + = sentido do caminho */
  rate: (e: SimulationEngine) => number;
  phase: number;
  spacing: number;
  owners: string[];
  layer: 'flows';
}

interface ValveVis {
  mesh: THREE.Mesh;
  get: (e: SimulationEngine) => ValveState;
  name: string;
  owners: string[];
}

interface PumpVis {
  body: THREE.Mesh;
  rotor: THREE.Object3D;
  get: (e: SimulationEngine) => { speed: number; cmd: boolean; failed: boolean };
  name: string;
  owners: string[];
  pos: THREE.Vector3;
}

interface PortArrow {
  mesh: THREE.Mesh;
  /** direção para fora (local) */
  out: THREE.Vector3;
  base: THREE.Vector3;
  rate: (e: SimulationEngine) => number; // + entrando
  owners: string[];
}

const MAX_PTS = 4000;
const C_WATER = new THREE.Color(0x9fe0ff);
const C_AIR = new THREE.Color(0xffffff);
const C_HP = new THREE.Color(0xfff0a0);

export class SystemsVis {
  readonly group = new THREE.Group();
  readonly tanks: TankVis[] = [];
  private tankGroup = new THREE.Group();
  private pipeGroup = new THREE.Group();
  private pipeMats: { mat: THREE.MeshBasicMaterial; owners: string[]; base: number; mesh: THREE.Object3D }[] = [];
  private _ids: Set<string> | null = null;
  private get tankIds(): Set<string> {
    return (this._ids ??= new Set(this.tanks.map((t) => t.id)));
  }
  private streams: Stream[] = [];
  private valves: ValveVis[] = [];
  private pumps: PumpVis[] = [];
  private ports: PortArrow[] = [];
  private points: THREE.Points;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private clipPlanes = new Map<string, { water: THREE.Plane; air: THREE.Plane; levelLocal: number; center: THREE.Vector3 }>();

  constructor(private e0: SimulationEngine, dot: THREE.Texture | null) {
    this.group.add(this.tankGroup, this.pipeGroup);
    this.buildTanks();
    for (const t of this.tanks) {
      t.pick.userData.pick = { kind: 'tank', id: t.id };
      this.pickables.push(t.pick);
    }
    this.buildCircuits();
    this.buildPower();
    for (const v of this.valves) this.pickables.push(v.mesh);
    for (const p of this.pumps) this.pickables.push(p.body);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.Float32BufferAttribute(new Float32Array(MAX_PTS * 3), 3);
    this.colAttr = new THREE.Float32BufferAttribute(new Float32Array(MAX_PTS * 3), 3);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.5, vertexColors: true, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, map: dot ?? undefined, toneMapped: false, fog: false }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
    this.group.add(this.points);
  }

  // ---------------------------------------------------------------- tanques
  private tankMats(cat: TankCategory) {
    const c = new THREE.Color(TANK_STYLE[cat].color);
    const waterMat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.55, roughness: 0.4, transparent: true, opacity: 0.88, depthWrite: false, side: THREE.DoubleSide });
    const airMat = new THREE.MeshStandardMaterial({ color: 0xeef6ff, emissive: 0x8aa0b8, emissiveIntensity: 0.35, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
    const edgeMat = new THREE.LineBasicMaterial({ color: c.clone().lerp(new THREE.Color(0xffffff), 0.35), transparent: true, opacity: 1, depthWrite: false });
    return { waterMat, airMat, edgeMat };
  }

  private buildTanks(): void {
    const e = this.e0;
    const v = e.vessel;
    // TLP: seção em "D" que acompanha o casco (bombordo/boreste), extrudada ao longo de x
    for (const t of v.ballast.tanks) {
      const rr = Math.max(1.2, e.geom.radiusAt(t.center.x) - 0.2);
      const gap = 0.18;
      const side = t.center.y < 0 ? -1 : 1;
      const v0 = Math.sqrt(rr * rr - gap * gap);
      const shape = new THREE.Shape();
      const N = 28;
      // u = y (boreste +), w = −z (para cima +)
      shape.moveTo(side * gap, -v0);
      for (let i = 0; i <= N; i++) {
        const w = -v0 + (2 * v0 * i) / N;
        shape.lineTo(side * Math.sqrt(Math.max(0, rr * rr - w * w)), w);
      }
      shape.lineTo(side * gap, v0);
      shape.closePath();
      // área × altura (para inverter nível ↔ volume)
      const M = 96;
      const cumA: number[] = [0];
      for (let i = 0; i < M; i++) {
        const w = -v0 + ((i + 0.5) * 2 * v0) / M;
        cumA.push(cumA[i] + Math.max(0, Math.sqrt(Math.max(0, rr * rr - w * w)) - gap) * ((2 * v0) / M));
      }
      const area = cumA[M];
      const Lt = t.volume / area;
      const geo = new THREE.ExtrudeGeometry(shape, { depth: Lt, bevelEnabled: false, curveSegments: 4 });
      geo.translate(0, 0, -Lt / 2);
      const mats = this.tankMats('lastro');
      const water = new THREE.Mesh(geo, mats.waterMat);
      const air = new THREE.Mesh(geo, mats.airMat);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), mats.edgeMat);
      const surf = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
      surf.rotation.x = -Math.PI / 2;
      const grp = new THREE.Group();
      grp.position.copy(b2l(t.center.x, 0, t.center.z));
      grp.add(water, air, edges, surf);
      this.tankGroup.add(grp);
      const key = t.id;
      const waterPlane = new THREE.Plane();
      const airPlane = new THREE.Plane();
      mats.waterMat.clippingPlanes = [waterPlane];
      mats.airMat.clippingPlanes = [airPlane];
      this.clipPlanes.set(key, { water: waterPlane, air: airPlane, levelLocal: 0, center: grp.position.clone() });
      const setLevel = (fill: number) => {
        const target = Math.max(0, Math.min(1, fill)) * area;
        let k = 0;
        while (k < M && cumA[k + 1] < target) k++;
        const f = k >= M ? 1 : (target - cumA[k]) / Math.max(1e-9, cumA[k + 1] - cumA[k]);
        const w = -v0 + ((k + f) * 2 * v0) / M;
        const cp = this.clipPlanes.get(key)!;
        cp.levelLocal = w;
        const width = Math.max(0.01, Math.sqrt(Math.max(0, rr * rr - w * w)) - gap);
        surf.scale.set(width, Lt, 1);
        surf.position.set(side * (gap + width / 2), w, 0);
        surf.visible = fill > 0.005 && fill < 0.995;
      };
      this.tanks.push({
        id: t.id,
        cat: 'lastro',
        name: t.name,
        short: t.id.replace('TLP', 'TLP-').replace(/(BB|BE)$/, ' $1'),
        top: { x: t.center.x, y: side * rr * 0.6, z: -v0 },
        meshes: [water, air, edges, surf],
        ...mats,
        surf,
        pick: water,
        getVol: (en) => en.state.ballast[t.id].water,
        cap: t.volume,
        getFlow: (en) => en.state.ballast[t.id].qWater,
        setLevel,
      });
    }
    // tanques internos: caixas (nível linear)
    const box = (id: string, name: string, short: string, cat: TankCategory, c: V3, H: number, W: number, cap: number, getVol: (en: SimulationEngine) => number, getFlow: (en: SimulationEngine) => number) => {
      const Lt = cap / (H * W);
      const mats = this.tankMats(cat);
      const water = new THREE.Mesh(new THREE.BoxGeometry(W, 1, Lt), mats.waterMat);
      const air = new THREE.Mesh(new THREE.BoxGeometry(W, 1, Lt), mats.airMat);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, Lt)), mats.edgeMat);
      const surf = new THREE.Mesh(new THREE.PlaneGeometry(W, Lt), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
      surf.rotation.x = -Math.PI / 2;
      const grp = new THREE.Group();
      grp.position.copy(b2l(c.x, c.y, c.z));
      grp.add(water, air, edges, surf);
      this.tankGroup.add(grp);
      const setLevel = (fill: number) => {
        const f = Math.max(0.001, Math.min(1, fill));
        water.scale.y = H * f;
        water.position.y = -H / 2 + (H * f) / 2;
        air.scale.y = Math.max(0.001, H * (1 - f));
        air.position.y = H / 2 - (H * (1 - f)) / 2;
        surf.position.y = -H / 2 + H * f;
        surf.visible = fill > 0.005 && fill < 0.995;
      };
      this.tanks.push({ id, cat, name, short, top: { x: c.x, y: c.y, z: c.z - H / 2 }, meshes: [water, air, edges, surf], ...mats, surf, pick: water, getVol, cap, getFlow, setLevel });
    };
    v.compensation.tanks.forEach((t) =>
      box(t.id, t.name, t.id.replace('TC', 'TC-'), 'compensacao', t.center, t.height, 2.6, t.capacity, (en) => tankVolume(en.state.compensation.tanks[t.id]), (en) => en.state.compensation.tanks[t.id].flow ?? 0),
    );
    box(v.trim.tankA.id, v.trim.tankA.name, 'TT-AV', 'trim', v.trim.tankA.center, v.trim.tankA.height, 2.2, v.trim.tankA.capacity, (en) => tankVolume(en.state.trim.tankA), (en) => -en.state.trim.flow);
    box(v.trim.tankB.id, v.trim.tankB.name, 'TT-AR', 'trim', v.trim.tankB.center, v.trim.tankB.height, 2.2, v.trim.tankB.capacity, (en) => tankVolume(en.state.trim.tankB), (en) => en.state.trim.flow);
    box(v.heel.tankA.id, v.heel.tankA.name, 'TB-BB', 'banda', v.heel.tankA.center, v.heel.tankA.height, 1.0, v.heel.tankA.capacity, (en) => tankVolume(en.state.heel.tankA), (en) => -en.state.heel.flow);
    box(v.heel.tankB.id, v.heel.tankB.name, 'TB-BE', 'banda', v.heel.tankB.center, v.heel.tankB.height, 1.0, v.heel.tankB.capacity, (en) => tankVolume(en.state.heel.tankB), (en) => en.state.heel.flow);
  }

  // ------------------------------------------------------- energia (corte)
  private batt: THREE.Mesh[] = [];
  private battBar: THREE.Mesh[] = [];
  private gens: { mesh: THREE.Mesh; id: string }[] = [];
  private buildPower(): void {
    const e = this.e0;
    for (const y of [-1.25, 1.25]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.8, 7), new THREE.MeshStandardMaterial({ color: 0x55606c, emissive: 0x1a2430, roughness: 0.6, transparent: true, opacity: 0.92, depthWrite: false }));
      m.position.copy(b2l(14, y, 2.4));
      m.userData.pick = { kind: 'battery', id: 'battery' };
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.12, 1), new THREE.MeshBasicMaterial({ color: 0x3ddc84, toneMapped: false, transparent: true, depthWrite: false }));
      bar.position.copy(b2l(14, y, 1.95));
      this.group.add(m, bar);
      this.batt.push(m);
      this.battBar.push(bar);
      this.pickables.push(m);
    }
    e.vessel.electrical.generators.forEach((g, i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 3.4), new THREE.MeshStandardMaterial({ color: 0x8a6a3a, emissive: 0x2a1c08, roughness: 0.6, transparent: true, opacity: 0.92, depthWrite: false }));
      m.position.copy(b2l(-17.5, i === 0 ? -0.95 : 0.95, 1.3));
      m.userData.pick = { kind: 'generator', id: g.id };
      this.group.add(m);
      this.gens.push({ mesh: m, id: g.id });
      this.pickables.push(m);
    });
  }

  private updatePower(e: SimulationEngine, layers: SceneLayers, labels: Label3D[], sub: THREE.Object3D, proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean }): void {
    const el = e.state.electrical;
    const soc = el.soc;
    const hide = !!layers.tankFilter && layers.tankFilter.length > 0;
    for (const m of this.batt) m.visible = !hide;
    this.battBar.forEach((b) => {
      b.visible = !hide;
      b.scale.z = Math.max(0.02, soc) * 7;
      (b.material as THREE.MeshBasicMaterial).color.set(soc > 0.5 ? 0x3ddc84 : soc > 0.25 ? 0xffc040 : 0xff4d4d);
    });
    for (const g of this.gens) {
      g.mesh.visible = !hide;
      const st = el.generators[g.id];
      (g.mesh.material as THREE.MeshStandardMaterial).emissive.set(st.status === 'EM CARGA' ? 0x2a7a2a : st.status === 'PARTINDO' ? 0x7a6a10 : st.failed ? 0x7a1010 : 0x2a1c08);
    }
    if (!hide && layers.labels) {
      labels.push({ id: 'pwB', text: `Bateria ${(soc * 100).toFixed(0)} %${el.current < -1 ? ' ▲ carregando' : ''}`, color: '#9fe3b0', small: true, prio: 3, ...proj(sub.localToWorld(b2l(14, 0, 1.6))) });
      const run = e.vessel.electrical.generators.filter((g) => el.generators[g.id].status === 'EM CARGA').length;
      if (run) labels.push({ id: 'pwG', text: `Geradores: ${run} em carga`, color: '#ffd18a', small: true, prio: 3, ...proj(sub.localToWorld(b2l(-17.5, 0, 0.4))) });
    }
  }

  /** objetos clicáveis (com userData.pick) */
  readonly pickables: THREE.Object3D[] = [];

  // ------------------------------------------------------------- circuitos
  private pipe(pts: THREE.Vector3[], color: number, owners: string[], r = 0.11): void {
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    const m = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(4, pts.length * 6), r, 6, false), mat);
    this.pipeGroup.add(m);
    this.pipeMats.push({ mat, owners, base: 0.85, mesh: m });
  }

  private stream(pts: THREE.Vector3[], color: THREE.Color, owners: string[], rate: (e: SimulationEngine) => number, spacing = 0.9): void {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    this.streams.push({ pts, cum, total: cum[cum.length - 1], color, rate, phase: Math.random() * spacing, spacing, owners, layer: 'flows' });
  }

  private valve(p: THREE.Vector3, name: string, get: (e: SimulationEngine) => ValveState, owners: string[]): void {
    const sys = owners.find((o) => o === 'HP' || o === 'compensacao' || o === 'trim' || o === 'heel') ?? 'lastro';
    const tank = owners.find((o) => this.tanks.some((t) => t.id === o));
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff4d4d, depthTest: false, transparent: true, toneMapped: false, fog: false }));
    m.position.copy(p);
    m.renderOrder = 13;
    m.userData.pick = { kind: 'valve', id: tank ?? name, sys };
    this.pipeGroup.add(m);
    this.valves.push({ mesh: m, get, name, owners });
  }

  private pump(p: THREE.Vector3, name: string, get: PumpVis['get'], owners: string[]): void {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.7, 18), new THREE.MeshBasicMaterial({ color: 0x6f7c8a, transparent: true, depthTest: false, toneMapped: false, fog: false }));
    body.position.copy(p);
    body.renderOrder = 13;
    body.userData.pick = { kind: 'pump', id: name, sys: owners.find((o) => o === 'compensacao' || o === 'trim' || o === 'heel') ?? 'compensacao' };
    const rotor = new THREE.Group();
    const bm = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });
    for (let k = 0; k < 2; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, 0.14), bm);
      b.rotation.y = (k * Math.PI) / 2;
      b.renderOrder = 14;
      rotor.add(b);
    }
    rotor.position.copy(p).add(new THREE.Vector3(0, 0.4, 0));
    this.pipeGroup.add(body, rotor);
    this.pumps.push({ body, rotor, get, name, owners, pos: p.clone() });
  }

  private port(base: THREE.Vector3, out: THREE.Vector3, rate: PortArrow['rate'], owners: string[], color: number): void {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 14), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false, fog: false }));
    m.renderOrder = 15;
    this.pipeGroup.add(m);
    this.ports.push({ mesh: m, out: out.clone().normalize(), base: base.clone(), rate, owners });
  }

  private buildCircuits(): void {
    const e = this.e0;
    const v = e.vessel;
    const geom = e.geom;
    const sq = (n: number) => Math.sign(n) * Math.min(1, Math.sqrt(Math.abs(n)));
    // --- ar AP: garrafas → coletor ao longo do casco → válvulas de sopro → TLP
    const zM = (x: number) => -(geom.radiusAt(x) - 0.45);
    const node = b2l(-8, 0, zM(-8));
    v.hpAir.banks.forEach((b, i) => {
      const y = i === 0 ? -0.9 : 0.9;
      const grp = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 3.2, 12), new THREE.MeshStandardMaterial({ color: 0xd9cf8f, emissive: 0x3a3418, transparent: true, opacity: 0.9 }));
        c.rotation.x = Math.PI / 2;
        c.position.copy(b2l(-8, y + (k - 1) * 0.3, 1.5 + (k % 2) * 0.25));
        c.userData.pick = { kind: 'hp', id: b.id };
        this.pickables.push(c);
        grp.add(c);
      }
      this.pipeGroup.add(grp);
      const start = b2l(-8, y, 1.0);
      const riser = [start, b2l(-8, y, 0.2), b2l(-8, 0, zM(-8))];
      this.pipe(riser, 0xb7a95c, ['HP']);
      this.valve(b2l(-8, y, 0.6), b.valve.name, (en) => en.state.hpAir.banks[b.id].valve, ['HP']);
      this.stream(riser, C_HP, ['HP'], (en) => {
        let m = 0;
        for (const t of v.ballast.tanks) m += en.state.ballast[t.id].mdotBlow;
        return en.state.hpAir.banks[b.id].valve.pos > 0.05 ? sq(m / 30) : 0;
      });
    });
    const xs = v.ballast.tanks.map((t) => t.center.x);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const man: THREE.Vector3[] = [];
    for (let x = xMin; x <= xMax + 1e-6; x += (xMax - xMin) / 24) man.push(b2l(x, 0, zM(x)));
    this.pipe(man, 0xb7a95c, ['HP']);
    for (const t of v.ballast.tanks) {
      const r = geom.radiusAt(t.center.x);
      const side = t.center.y < 0 ? -1 : 1;
      const rr = r - 0.2;
      const topZ = -Math.sqrt(Math.max(0, rr * rr - (side * rr * 0.45) ** 2)) + 0.25;
      const yIn = side * rr * 0.45;
      // sopro: coletor → válvula → topo do tanque
      const fwd = t.center.x > 0;
      const xFace = t.center.x + (fwd ? -1.2 : 1.2);
      const nodeX = b2l(xFace, 0, zM(xFace));
      const bl = [...this.pathAlongManifold(-8, xFace, zM), nodeX, b2l(xFace, yIn, topZ), b2l(t.center.x, yIn, topZ + 0.3)];
      this.pipe([nodeX, b2l(xFace, yIn, topZ), b2l(t.center.x, yIn, topZ + 0.3)], 0xb7a95c, [t.id]);
      this.valve(b2l(xFace, yIn * 0.6, (zM(xFace) + topZ) / 2), t.blowValve.name, (en) => en.state.ballast[t.id].blow, [t.id]);
      this.stream([node, ...bl], C_HP, [t.id, 'HP'], (en) => sq(en.state.ballast[t.id].mdotBlow / 15));
      // suspiro: topo do tanque → válvula → convés
      const yV = side * rr * 0.3;
      const zDeck = -Math.sqrt(Math.max(0, r * r - yV * yV)) - 0.15;
      const vent = [b2l(t.center.x + (fwd ? 0.8 : -0.8), yIn, topZ + 0.3), b2l(t.center.x + (fwd ? 0.8 : -0.8), yV, topZ - 0.2), b2l(t.center.x + (fwd ? 0.8 : -0.8), yV, zDeck)];
      this.pipe(vent, 0x9fb7cf, [t.id]);
      this.valve(vent[1], t.ventValve.name, (en) => en.state.ballast[t.id].vent, [t.id]);
      this.stream(vent, C_AIR, [t.id], (en) => sq(en.state.ballast[t.id].mdotVent / 12), 0.7);
      this.port(vent[2], new THREE.Vector3(0, 1, 0), (en) => -sq(en.state.ballast[t.id].mdotVent / 12), [t.id], 0xffffff);
      // embornal (alagamento / expulsão): fundo do casco ↔ fundo do tanque
      const yF = side * rr * 0.5;
      const zKeelOut = Math.sqrt(Math.max(0, r * r - yF * yF)) + 0.9;
      const zIn = Math.sqrt(Math.max(0, rr * rr - yF * yF)) - 0.3;
      const flood: THREE.Vector3[] = [];
      for (const dx of [-1.2, 0, 1.2]) {
        const p = [b2l(t.center.x + dx, yF, zKeelOut), b2l(t.center.x + dx, yF, zIn), b2l(t.center.x + dx, yF, zIn - 1.6)];
        if (dx === 0) flood.push(...p);
        this.stream(p, C_WATER, [t.id], (en) => sq(en.state.ballast[t.id].qWater / 2.5), 0.6);
        this.stream(p.slice().reverse(), C_AIR, [t.id], (en) => sq(en.state.ballast[t.id].mdotSpill / 10), 0.8);
      }
      this.port(flood[0], new THREE.Vector3(0, -1, 0), (en) => sq(en.state.ballast[t.id].qWater / 2.5), [t.id], 0x7fd8ff);
    }

    // --- compensação: admissão do mar → V-AM → coletor → VC → TC ; TC → BC → V-DM → mar
    const cmp = v.compensation;
    const zc = 2.72;
    const yc = 0.75;
    const sc = cmp.seaConnection;
    const seaIn = b2l(sc.x, -0.5, geom.radiusAt(sc.x) + 0.8);
    const vam = b2l(sc.x, -0.5, zc);
    const xd = sc.x + 1.8;
    const seaOut = b2l(xd + 0.9, yc, geom.radiusAt(xd) + 0.8);
    const pumpP = b2l(xd, yc, zc);
    const vdm = b2l(xd + 0.9, yc, zc);
    const ctx = cmp.tanks.map((t) => t.center.x);
    const lineC = [b2l(Math.min(...ctx), yc, zc), b2l(Math.max(...ctx), yc, zc)];
    this.pipe(lineC, 0x168a52, ['compensacao']);
    this.pipe([seaIn, vam, b2l(sc.x, yc, zc)], 0x168a52, ['compensacao']);
    this.pipe([pumpP, vdm, seaOut], 0x168a52, ['compensacao']);
    this.valve(vam, cmp.inletValve.name, (en) => en.state.compensation.inlet, ['compensacao']);
    this.valve(vdm, cmp.dischargeValve.name, (en) => en.state.compensation.discharge, ['compensacao']);
    this.pump(pumpP.clone().add(new THREE.Vector3(0.0, 0.0, 0)), cmp.pump.name, (en) => en.state.compensation.pump, ['compensacao']);
    this.port(seaIn, new THREE.Vector3(0, -1, 0), (en) => sq(en.state.compensation.qIn / 0.012), ['compensacao'], 0x7fffc0);
    this.port(seaOut, new THREE.Vector3(0, -1, 0), (en) => -sq(en.state.compensation.qOut / 0.012), ['compensacao'], 0x7fffc0);
    cmp.tanks.forEach((t, i) => {
      const vc = b2l(t.center.x, yc, zc);
      const tankB = b2l(t.center.x, 0.2, t.center.z + t.height / 2 - 0.2);
      this.pipe([vc, b2l(t.center.x, 0.2, zc), tankB], 0x168a52, [t.id, 'compensacao']);
      this.valve(b2l(t.center.x, yc * 0.6, zc), cmp.tankValves[i].name, (en) => en.state.compensation.tankValves[cmp.tankValves[i].id], [t.id, 'compensacao']);
      const seaFlow = (en: SimulationEngine) => {
        const tr = en.state.compensation.transfer;
        const internal = tr ? (tr.source === t.id ? -tr.flow : tr.destination === t.id ? tr.flow : 0) : 0;
        return (en.state.compensation.tanks[t.id].flow ?? 0) - internal;
      };
      const toTank = [seaIn, vam, b2l(sc.x, yc, zc), vc, b2l(t.center.x, 0.2, zc), tankB];
      this.stream(toTank, new THREE.Color(0x9dffc8), [t.id, 'compensacao'], (en) => sq(Math.max(0, seaFlow(en)) / 0.012));
      const fromTank = [tankB, b2l(t.center.x, 0.2, zc), vc, pumpP, vdm, seaOut];
      this.stream(fromTank, new THREE.Color(0x9dffc8), [t.id, 'compensacao'], (en) => sq(Math.max(0, -seaFlow(en)) / 0.012));
    });

    // Mesmas arestas da física e do 2D; cada tanque usa sua posição transversal real.
    if (cmp.transfer && this.e0.state.compensation.transfer) {
      const tanks = [v.heel.tankA, ...cmp.tanks.filter(t => t.id === 'TC0'), v.heel.tankB];
      const ids = tanks.map(t => t.id);
      const nodes: Record<string, THREE.Vector3> = {
        'header:A': b2l(0, 0, 2.1), 'header:B': b2l(5.5, 0, 2.1),
        'vdc:A': b2l(1.9, -0.35, 2.1), 'vdc:B': b2l(1.9, 0.35, 2.1),
        'vdc:P': b2l(3.1, -0.35, 2.1), 'vdc:T': b2l(3.1, 0.35, 2.1),
        'pump:in': b2l(4.5, 0.4, 2.5), 'pump:out': b2l(4.5, -0.4, 2.5),
      };
      tanks.forEach(t => { nodes[`tank:${t.id}`] = b2l(t.center.x, t.center.y, t.center.z + t.height / 2 - 0.15); });
      const circuitOf = (en: SimulationEngine) => buildCompensationCircuit(en.state.compensation, ids);
      const edges = circuitOf(this.e0).edges;
      edges.forEach(edge => {
        let points = [nodes[edge.from], nodes[edge.to]];
        const tank = tanks.find(t => edge.from === `tank:${t.id}`);
        if (tank) {
          const x = edge.to === 'header:A' ? 0 : 5.5;
          points = [nodes[edge.from], b2l(x, tank.center.y, 1.9), nodes[edge.to]];
          this.valve(points[0].clone().lerp(points[1], 0.45), `${tank.id} → coletor ${edge.to.slice(-1)}`,
            en => selectorValve(en.state.compensation.transfer!, tank.id, edge.to === 'header:A' ? 'A' : 'B'), [tank.id, 'compensacao']);
        }
        this.pipe(points, edge.id === 'discharge' ? 0xba7635 : 0x168a70, ['compensacao'], 0.07);
        this.stream(points, new THREE.Color(0x9dffc8), ['compensacao'], en =>
          sq(circuitEdgeFlow(circuitOf(en), edge.id, en.state.compensation.transfer!.pump.flow) / 0.010));
      });
      this.pump(b2l(4.5, 0, 2.5), cmp.transfer.pump.name, en => en.state.compensation.transfer!.pump, ['compensacao']);
      // Corpo da direcional com as quatro portas conectadas, em vez de uma esfera solta.
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.45, 1.6), new THREE.MeshBasicMaterial({ color: 0x8ee9cc, depthTest: false, transparent: true, opacity: 0.85, fog: false }));
      body.position.copy(b2l(2.5, 0, 2.1));
      body.renderOrder = 13;
      body.userData.pick = { kind: 'valve', id: 'VDC 4/2', sys: 'compensacao' };
      this.pipeGroup.add(body);
      this.valves.push({ mesh: body, get: en => en.state.compensation.transfer!.direction, name: 'VDC 4/2 · A/B/P/T', owners: ['compensacao'] });
    }

    // --- trim e banda: tanque A ↔ bomba ↔ tanque B (sentido pelo seletor)
    const transfer = (sys: 'trim' | 'heel', ya: number, za: number, pumpAt: V3, color: number, flowColor: number, qMax: number) => {
      const c = v[sys];
      const A = c.tankA.center;
      const B = c.tankB.center;
      const a0 = b2l(A.x, A.y * 0.75, A.z + c.tankA.height / 2 - 0.15);
      const b0 = b2l(B.x, B.y * 0.75, B.z + c.tankB.height / 2 - 0.15);
      const a1 = sys === 'trim' ? b2l(A.x, ya, za) : b2l(A.x, A.y * 0.75, za);
      const b1 = sys === 'trim' ? b2l(B.x, ya, za) : b2l(B.x, B.y * 0.75, za);
      const pp = b2l(pumpAt.x, pumpAt.y, pumpAt.z);
      const path = [a0, a1, pp, b1, b0];
      this.pipe(path, color, [c.tankA.id, c.tankB.id, sys]);
      const va = a1.clone().lerp(pp, 0.12);
      const vb = b1.clone().lerp(pp, 0.12);
      this.valve(va, c.valveA.name, (en) => en.state[sys].valveA, [c.tankA.id, sys]);
      this.valve(vb, c.valveB.name, (en) => en.state[sys].valveB, [c.tankB.id, sys]);
      this.pump(pp, c.pump.name, (en) => en.state[sys].pump, [c.tankA.id, c.tankB.id, sys]);
      this.stream(path, new THREE.Color(flowColor), [c.tankA.id, c.tankB.id, sys], (en) => sq(en.state[sys].flow / qMax));
    };
    transfer('trim', -0.75, 2.72, { x: 9, y: -0.75, z: 2.72 }, 0xa86a12, 0xffd18a, 0.012);
    transfer('heel', 0, 1.95, { x: 2, y: 0, z: 1.95 }, 0x7a3fb0, 0xe6c2ff, 0.006);
  }

  private pathAlongManifold(x0: number, x1: number, zM: (x: number) => number): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    const n = Math.max(2, Math.ceil(Math.abs(x1 - x0) / 3));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      out.push(b2l(x, 0, zM(x)));
    }
    return out;
  }

  /** Busca do tanque sob o cursor (coordenadas normalizadas −1…1). */
  pick(ndc: THREE.Vector2, cam: THREE.Camera): string | null {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, cam);
    const hits = rc.intersectObjects(
      this.tanks.map((t) => t.pick),
      false,
    );
    for (const h of hits) {
      const t = this.tanks.find((x) => x.pick === h.object);
      if (t) return t.id;
    }
    return null;
  }

  update(e: SimulationEngine, sub: THREE.Object3D, layers: SceneLayers, step: number, labels: Label3D[], proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean }): void {
    const showT = layers.tanks;
    const showP = layers.tanks && layers.pipes;
    const showF = layers.tanks && layers.flows;
    this.group.visible = showT;
    this.pipeGroup.visible = showP;
    const hl = layers.highlight;
    // filtro de tanques visíveis: circuitos aparecem se pertencem a um tanque visível
    // (ou, sem tanque próprio, ao sistema de um tanque visível)
    const filt = layers.tankFilter && layers.tankFilter.length ? new Set(layers.tankFilter) : null;
    const SYS: Record<TankCategory, string> = { lastro: 'HP', compensacao: 'compensacao', trim: 'trim', banda: 'heel' };
    const sysOn = new Set<string>();
    if (filt) for (const t of this.tanks) if (filt.has(t.id)) sysOn.add(SYS[t.cat]);
    const ids = this.tankIds;
    const shown = (owners: string[]) => {
      if (!filt) return true;
      const own = owners.filter((o) => ids.has(o));
      return own.length ? own.some((o) => filt.has(o)) : owners.some((o) => sysOn.has(o));
    };
    const owned = (owners: string[]) => shown(owners) && (!hl || owners.includes(hl));
    const ownedDim = (owners: string[]) => !hl || owners.includes(hl);
    sub.updateMatrixWorld();
    const upW = new THREE.Vector3(0, 1, 0).transformDirection(sub.matrixWorld);
    // tanques
    for (const t of this.tanks) {
      const fill = t.getVol(e) / t.cap;
      t.setLevel(fill);
      const vis = !filt || filt.has(t.id);
      for (const m of t.meshes) if (!vis) m.visible = false;
      if (vis) for (const m of t.meshes) if (m !== t.surf) m.visible = true;
      if (!vis) continue;
      const sel = hl === t.id;
      const dim = !!hl && !sel;
      t.waterMat.opacity = dim ? 0.16 : sel ? 0.96 : 0.88;
      t.waterMat.emissiveIntensity = sel ? 1.0 : dim ? 0.2 : 0.55;
      t.airMat.opacity = dim ? 0.05 : sel ? 0.32 : 0.2;
      t.edgeMat.opacity = dim ? 0.2 : 1;
      t.edgeMat.color.set(sel ? 0xffffff : new THREE.Color(TANK_STYLE[t.cat].color).lerp(new THREE.Color(0xffffff), 0.35));
      (t.surf.material as THREE.MeshBasicMaterial).opacity = dim ? 0.15 : 0.75;
      const cp = this.clipPlanes.get(t.id);
      if (cp) {
        const lp = sub.localToWorld(cp.center.clone().add(new THREE.Vector3(0, cp.levelLocal, 0)));
        cp.water.setFromNormalAndCoplanarPoint(upW.clone().negate(), lp);
        cp.air.setFromNormalAndCoplanarPoint(upW, lp);
      }
      if (showT && layers.labels && (!hl || sel)) {
        const q = t.getFlow(e);
        const arrow = Math.abs(q) * 1000 > 0.5 ? (q > 0 ? ' ▲' : ' ▼') : '';
        const st = TANK_STYLE[t.cat];
        labels.push({
          id: 'tk' + t.id,
          text: `${t.short} ${(fill * 100).toFixed(0)} %${arrow}`,
          sub: sel ? `${st.label} — ${st.fn} · ${t.getVol(e).toFixed(t.cap > 20 ? 1 : 2)}/${t.cap.toFixed(0)} m³` : undefined,
          color: st.css,
          small: !sel,
          prio: sel ? 1 : 2,
          ...proj(sub.localToWorld(b2l(t.top.x, t.top.y, t.top.z))),
        });
      }
    }
    this.updatePower(e, layers, labels, sub, proj);
    // tubulações
    for (const p of this.pipeMats) {
      p.mesh.visible = shown(p.owners);
      p.mat.opacity = ownedDim(p.owners) ? p.base : 0.12;
    }
    for (const v of this.valves) {
      const st = v.get(e);
      const m = v.mesh.material as THREE.MeshBasicMaterial;
      const moving = Math.abs(st.cmd - st.pos) > 0.02;
      m.color.set(st.stuck ? 0xff00ff : moving ? 0xffc040 : st.pos > 0.5 ? 0x3ddc84 : 0xff4d4d);
      v.mesh.visible = shown(v.owners);
      m.opacity = ownedDim(v.owners) ? 1 : 0.15;
      v.mesh.scale.setScalar(st.pos > 0.5 || moving ? 1.25 : 1);
      // rótulo só durante o curso da válvula (ou aberta, para o tanque destacado)
      if (showP && layers.labels && (moving || (hl && st.pos > 0.5 && v.owners.includes(hl)))) {
        labels.push({ id: 'vl' + v.name, text: `${v.name}: ${moving ? (st.cmd > st.pos ? 'abrindo' : 'fechando') : 'aberta'}`, color: moving ? '#ffc040' : '#3ddc84', small: true, prio: 3, ...proj(sub.localToWorld(v.mesh.position.clone())) });
      }
    }
    for (const p of this.pumps) {
      const st = p.get(e);
      const m = p.body.material as THREE.MeshBasicMaterial;
      m.color.set(st.failed ? 0xff4d4d : st.speed > 0.05 ? 0x3ddc84 : 0x6f7c8a);
      p.body.visible = shown(p.owners);
      m.opacity = ownedDim(p.owners) ? 1 : 0.15;
      p.rotor.rotation.y += step * st.speed * 25;
      p.rotor.visible = owned(p.owners);
      if (showP && layers.labels && (st.speed > 0.05 || st.failed) && owned(p.owners)) {
        labels.push({ id: 'pm' + p.name, text: `${p.name}: ${st.failed ? 'FALHA' : `em funcionamento ${(st.speed * 100).toFixed(0)} %`}`, color: st.failed ? '#ff6b6b' : '#3ddc84', small: true, prio: 3, ...proj(sub.localToWorld(p.pos.clone().add(new THREE.Vector3(0, 0.9, 0)))) });
      }
    }
    for (const pa of this.ports) {
      const r = showF ? pa.rate(e) : 0;
      const vis = Math.abs(r) > 0.03 && owned(pa.owners);
      pa.mesh.visible = vis;
      if (!vis) continue;
      const s = 0.6 + 0.9 * Math.abs(r);
      pa.mesh.scale.setScalar(s);
      // + entrando: aponta para dentro (contra "out")
      const dir = r > 0 ? pa.out.clone().negate() : pa.out.clone();
      pa.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      pa.mesh.position.copy(pa.base).add(pa.out.clone().multiplyScalar(0.9 * s));
    }
    // partículas de escoamento
    let n = 0;
    const pos = this.posAttr;
    const col = this.colAttr;
    if (showF) {
      for (const s of this.streams) {
        const r = s.rate(e);
        if (Math.abs(r) < 0.02 || !owned(s.owners)) continue;
        const speed = 0.8 + 5 * Math.abs(r);
        s.phase = (s.phase + step * speed) % s.spacing;
        const cnt = Math.floor(s.total / s.spacing);
        let seg = 0;
        for (let k = 0; k < cnt && n < MAX_PTS; k++) {
          let d = k * s.spacing + s.phase;
          if (r < 0) d = s.total - d;
          if (d < 0 || d > s.total) continue;
          seg = 0;
          while (seg < s.cum.length - 2 && s.cum[seg + 1] < d) seg++;
          const a = s.pts[seg];
          const b = s.pts[seg + 1];
          const f = (d - s.cum[seg]) / Math.max(1e-9, s.cum[seg + 1] - s.cum[seg]);
          pos.setXYZ(n, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
          const fade = 0.55 + 0.45 * Math.abs(r);
          col.setXYZ(n, s.color.r * fade, s.color.g * fade, s.color.b * fade);
          n++;
        }
      }
    }
    for (let i = n; i < MAX_PTS; i++) pos.setXYZ(i, 0, -1e5, 0);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.points.geometry.setDrawRange(0, Math.max(1, n));
    this.points.visible = n > 0;
  }
}
