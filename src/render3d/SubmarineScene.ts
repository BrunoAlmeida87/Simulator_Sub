/**
 * VISUALIZAÇÃO 3D (Three.js). Apenas LÊ o estado da simulação: nenhuma
 * animação é independente da física — posição, atitude, deflexão dos lemes,
 * rotação do hélice, níveis dos tanques e bolhas dos suspiros vêm do estado.
 *
 * Mapeamento NED → Three.js (Y para cima): X₃ = Leste, Y₃ = −profundidade,
 * Z₃ = −Norte. Origem flutuante na posição horizontal do submarino.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Ocean, UnderwaterSky, addCaustics, type OceanQuality } from './Ocean';
import type { SimulationEngine } from '../sim/core/engine';
import type { SimRunner } from '../sim/core/runner';
import { qToMat3, DEG } from '../sim/core/math';
import { tankVolume } from '../sim/systems/internalTanks';

export type ViewMode = 'piloto' | 'perseguicao' | 'perspectiva' | 'perfil' | 'frente' | 'topo' | 'livre';

interface TankVis {
  water: THREE.Mesh;
  air: THREE.Mesh;
  h: number;
  getFill: (e: SimulationEngine) => number;
}

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
  private mast!: THREE.Mesh;
  private tanks: TankVis[] = [];
  private tankGroup = new THREE.Group();
  private ocean: Ocean;
  private sky: Sky;
  private underSky: UnderwaterSky;
  private sunDir = new THREE.Vector3(0.62, 0.22, -0.6).normalize();
  private caustics = { uTime: { value: 0 }, uCaustic: { value: 0 } };
  private wallTime = 0;
  readonly quality: OceanQuality;
  private seabed: THREE.Mesh | null = null;
  private seabedCenter = { n: 1e12, e: 1e12 };
  private particles: Particle[] = [];
  /** partículas em suspensão (fixas no mundo) — referência visual de movimento */
  private snow: THREE.Points;
  private snowBase: Float32Array;
  private static readonly SNOW_N = 1400;
  private static readonly SNOW_BOX = { h: 140, v: 60 };
  /** esteira na superfície (gerada pela velocidade real quando o hélice está próximo da superfície) */
  private wake: Particle[] = [];
  private wakePts: THREE.Points;
  private bubbles: THREE.Points;
  private trail: THREE.Line;
  private depthLine: THREE.Line;
  private lastSubPos = new THREE.Vector3();
  private view: ViewMode = 'perspectiva';
  private viewBlend = 1;
  private viewFrom = new THREE.Vector3();
  cutaway = false;
  showTrail = true;
  realisticFog = true;
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
    this.hullMat = new THREE.MeshStandardMaterial({ color: 0x323c48, metalness: 0.3, roughness: 0.55, emissive: 0x0b141c });
    addCaustics(this.hullMat, this.caustics, 14);
    this.sailMat = this.hullMat;
    this.buildSubmarine();
    this.scene.add(this.sub);

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
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(500 * 3), 3));
    this.wakePts = new THREE.Points(wg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, transparent: true, opacity: 0.75, depthWrite: false, map: this.dot }));
    this.wakePts.frustumCulled = false;
    this.scene.add(this.wakePts);

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
    this.sub.add(hull);
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
    // mastro do snorkel
    const mg = new THREE.CylinderGeometry(0.22, 0.22, v.hull.snorkelMast.extension, 12);
    this.mast = new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ color: 0x5a6672, metalness: 0.5, roughness: 0.4 }));
    this.mast.position.set(0, R + sv.height - v.hull.snorkelMast.extension / 2, -v.hull.snorkelMast.x);
    this.sub.add(this.mast);
    // superfícies
    const finMat = new THREE.MeshStandardMaterial({ color: 0x3a4652, metalness: 0.3, roughness: 0.6 });
    const ctrlMat = new THREE.MeshStandardMaterial({ color: 0xc2763a, metalness: 0.2, roughness: 0.6 });
    const makeH = (x: number, z: number, span: number, chord: number, mat: THREE.Material, id: string | null) => {
      const r0 = Math.max(0.3, e.geom.radiusAt(x) - 0.1);
      const g = new THREE.Group();
      for (const side of [-1, 1]) {
        const piv = new THREE.Group();
        piv.position.set(side * (r0 + span / 2), -z, -x);
        const m = new THREE.Mesh(new THREE.BoxGeometry(span, 0.22, chord), mat);
        m.position.z = chord * 0.2;
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
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, span, chord), mat);
        m.position.z = chord * 0.2;
        piv.add(m);
        this.sub.add(piv);
        if (id) this.fins[id + (side < 0 ? 'D' : 'U')] = piv;
      }
    };
    makeH(24, 0.6, 2.4, 2.2, ctrlMat, 'bow');
    makeH(-29.8, 0, 2.9, 2.6, finMat, null);
    makeH(-32.4, 0, 2.6, 1.6, ctrlMat, 'stern');
    makeV(-29.8, 2.9, 2.6, finMat, null);
    makeV(-32.4, 2.6, 1.6, ctrlMat, 'rudder');
    // hélice
    const hub = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.6, 16), finMat);
    hub.rotation.x = -Math.PI / 2;
    this.prop.add(hub);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 0.7, roughness: 0.3 });
    const nb = v.propulsion.propeller.blades;
    const Rp = v.propulsion.propeller.diameter / 2;
    for (let k = 0; k < nb; k++) {
      const arm = new THREE.Group();
      arm.rotation.z = (k / nb) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.75, Rp - 0.4, 0.07), bladeMat);
      b.position.y = (Rp - 0.4) / 2 + 0.4;
      b.rotation.y = 0.55;
      b.rotation.z = 0.12;
      arm.add(b);
      this.prop.add(arm);
    }
    this.prop.position.set(0, 0, L / 2 + 0.6);
    this.sub.add(this.prop);

    // tanques (corte esquemático)
    const tMat = (c: number, o: number) => new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: o, depthWrite: false });
    const addTank = (cx: number, cy: number, cz: number, H: number, W: number, Lt: number, color: number, getFill: (e: SimulationEngine) => number) => {
      const water = new THREE.Mesh(new THREE.BoxGeometry(W, 1, Lt), tMat(color, 0.85));
      const air = new THREE.Mesh(new THREE.BoxGeometry(W, 1, Lt), tMat(0xe6f2ff, 0.18));
      const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, Lt)), new THREE.LineBasicMaterial({ color: 0xcfe0f2 }));
      const g = new THREE.Group();
      g.position.set(cy, -cz, -cx);
      g.add(water, air, box);
      this.tankGroup.add(g);
      this.tanks.push({ water, air, h: H, getFill });
    };
    for (const t of v.ballast.tanks) {
      const W = 2.4;
      addTank(t.center.x, t.center.y, t.center.z, t.height, W, t.volume / (t.height * W), 0x2a7fd4, (en) => en.state.ballast[t.id].water / t.volume);
    }
    for (const t of v.compensation.tanks) addTank(t.center.x, t.center.y, t.center.z, t.height, 2.6, t.capacity / (t.height * 2.6), 0x3ddc84, (en) => tankVolume(en.state.compensation.tanks[t.id]) / t.capacity);
    for (const [t, getter] of [
      [v.trim.tankA, (en: SimulationEngine) => tankVolume(en.state.trim.tankA)],
      [v.trim.tankB, (en: SimulationEngine) => tankVolume(en.state.trim.tankB)],
    ] as const)
      addTank(t.center.x, t.center.y, t.center.z, t.height, 2.4, t.capacity / (t.height * 2.4), 0xffb347, (en) => getter(en) / t.capacity);
    for (const [t, getter] of [
      [v.heel.tankA, (en: SimulationEngine) => tankVolume(en.state.heel.tankA)],
      [v.heel.tankB, (en: SimulationEngine) => tankVolume(en.state.heel.tankB)],
    ] as const)
      addTank(t.center.x, t.center.y, t.center.z, t.height, 1.0, t.capacity / (t.height * 1.0), 0xb48cff, (en) => getter(en) / t.capacity);
    this.tankGroup.visible = false;
    this.sub.add(this.tankGroup);
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
  }

  setCutaway(on: boolean): void {
    this.cutaway = on;
    this.hullMat.transparent = on;
    this.hullMat.opacity = on ? 0.22 : 1;
    this.hullMat.color.set(on ? 0x8fb3d9 : 0x323c48);
    this.hullMat.depthWrite = !on;
    this.hullMat.needsUpdate = true;
    this.tankGroup.visible = on;
  }

  private headingVectors(): { fwd: THREE.Vector3; stbd: THREE.Vector3 } {
    const psi = (this.env().outputs.euler.heading * Math.PI) / 180;
    return { fwd: new THREE.Vector3(Math.sin(psi), 0, -Math.cos(psi)), stbd: new THREE.Vector3(Math.cos(psi), 0, Math.sin(psi)) };
  }

  /** Deslocamento da vista lateral para a frente (mostra a água à proa) — nulo em telas estreitas. */
  private pilotLead(): number {
    return this.camera.aspect > 1.3 ? 13 : 0;
  }

  private cameraTarget(v: ViewMode): THREE.Vector3 {
    const { fwd, stbd } = this.headingVectors();
    const c = this.lastSubPos.clone();
    switch (v) {
      case 'piloto': {
        // lateral (boreste), ligeiramente abaixo do eixo e à frente: o submarino avança da esquerda para a direita.
        // Distância ajustada à proporção da tela para o casco inteiro caber (telas em retrato).
        const asp = Math.max(0.3, this.camera.aspect);
        const dist = Math.max(95, 100 / asp);
        const cam = c.add(stbd.multiplyScalar(dist)).add(fwd.clone().multiplyScalar(this.pilotLead()));
        const axisDepth = -this.lastSubPos.y;
        const k = Math.min(1, Math.max(0, (axisDepth - 5) / 9));
        const kk = k * k * (3 - 2 * k);
        cam.y = 7 * (1 - kk) + Math.min(this.lastSubPos.y - 1.0, -1.2) * kk;
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

  private rebuildSeabed(n0: number, e0: number): void {
    const env = this.env().env;
    const size = 3600;
    const seg = 140;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c1 = new THREE.Color(0x6b5a3e);
    const c2 = new THREE.Color(0x2b3a3e);
    let dmin = Infinity;
    let dmax = -Infinity;
    const depths = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const d = env.bottomDepthAt(n0 - z, e0 + x);
      depths[i] = d;
      dmin = Math.min(dmin, d);
      dmax = Math.max(dmax, d);
      pos.setY(i, -d);
    }
    for (let i = 0; i < pos.count; i++) {
      const t = (depths[i] - dmin) / Math.max(1, dmax - dmin);
      const c = c1.clone().lerp(c2, t);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    if (this.seabed) {
      this.scene.remove(this.seabed);
      this.seabed.geometry.dispose();
      (this.seabed.material as THREE.Material).dispose();
    }
    const bedMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    addCaustics(bedMat, this.caustics, 45);
    this.seabed = new THREE.Mesh(g, bedMat);
    this.scene.add(this.seabed);
    this.seabedCenter = { n: n0, e: e0 };
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

    // tanques
    if (this.tankGroup.visible) {
      for (const t of this.tanks) {
        const f = Math.max(0.001, Math.min(1, t.getFill(e)));
        t.water.scale.y = t.h * f;
        t.water.position.y = -t.h / 2 + (t.h * f) / 2;
        t.air.scale.y = Math.max(0.001, t.h * (1 - f));
        t.air.position.y = t.h / 2 - (t.h * (1 - f)) / 2;
      }
    }

    // fundo (reconstruído ao afastar-se)
    if (Math.hypot(pn - this.seabedCenter.n, pe - this.seabedCenter.e) > 800) this.rebuildSeabed(Math.round(pn / 100) * 100, Math.round(pe / 100) * 100);
    if (this.seabed) this.seabed.position.set(this.seabedCenter.e - pe, 0, -(this.seabedCenter.n - pn));

    // bolhas dos suspiros/embornais (taxa proporcional à vazão de ar simulada)
    const Rm = qToMat3(s.body.quat);
    const toWorld = (bx: number, by: number, bz: number) => ({
      n: s.body.pos.x + Rm[0] * bx + Rm[1] * by + Rm[2] * bz,
      e: s.body.pos.y + Rm[3] * bx + Rm[4] * by + Rm[5] * bz,
      d: s.body.pos.z + Rm[6] * bx + Rm[7] * by + Rm[8] * bz,
    });
    if (this.runner.running) {
      for (const t of v.ballast.tanks) {
        const st = s.ballast[t.id];
        const rate = Math.min(120, st.mdotVent * 25 + st.mdotSpill * 25);
        const nEmit = rate * dtR * this.runner.timeScale;
        let k = Math.floor(nEmit) + (Math.random() < nEmit % 1 ? 1 : 0);
        const src = st.mdotVent >= st.mdotSpill ? toWorld(t.center.x, t.center.y, t.center.z - t.height / 2 - 0.5) : toWorld(t.center.x, t.center.y, t.center.z + t.height / 2);
        while (k-- > 0 && this.particles.length < 600) {
          this.particles.push({ n: src.n + (Math.random() - 0.5) * 2, e: src.e + (Math.random() - 0.5) * 2, d: src.d, vy: 0.8 + Math.random() * 0.8, life: 60 });
        }
      }
      const step = dtR * this.runner.timeScale;
      this.particles = this.particles.filter((p) => {
        p.d -= p.vy * step;
        p.life -= step;
        p.n += (Math.random() - 0.5) * 0.3;
        p.e += (Math.random() - 0.5) * 0.3;
        return p.d > -e.env.waves.elevation(p.n, p.e, tWave) && p.life > 0;
      });
    }
    const bp = this.bubbles.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < 600; i++) {
      const p = this.particles[i];
      if (p) bp.setXYZ(i, p.e - pe, -p.d, -(p.n - pn));
      else bp.setXYZ(i, 0, -1e6, 0);
    }
    bp.needsUpdate = true;

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
    // esteira: espuma deixada na superfície pelo hélice quando ele está próximo da superfície
    {
      const step = this.runner.running ? dtR * this.runner.timeScale : 0;
      const sternW = toWorld(-v.hull.length / 2, 0, 0);
      const u = Math.abs(s.body.vel.x);
      if (step > 0 && sternW.d < 7 && u > 0.4) {
        const rate = Math.min(60, u * 8);
        let k = Math.floor(rate * step) + (Math.random() < (rate * step) % 1 ? 1 : 0);
        while (k-- > 0 && this.wake.length < 500) {
          this.wake.push({ n: sternW.n + (Math.random() - 0.5) * 3, e: sternW.e + (Math.random() - 0.5) * 3, d: 0, vy: 0, life: 25 });
        }
      }
      if (step > 0) this.wake = this.wake.filter((p) => (p.life -= step) > 0);
      const wp = this.wakePts.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < 500; i++) {
        const p = this.wake[i];
        if (p) wp.setXYZ(i, p.e - pe, (i % 3 === 0 ? e.env.waves.elevation(p.n, p.e, tWave) : wp.getY(i)) + 0.12, -(p.n - pn));
        else wp.setXYZ(i, 0, -1e6, 0);
      }
      wp.needsUpdate = true;
    }

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
    this.trail.visible = this.showTrail;

    // linha de profundidade (superfície ↔ submarino ↔ fundo)
    const bottom = e.env.bottomDepthAt(pn, pe);
    const dl = this.depthLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    dl.setXYZ(0, 0, 0, 0);
    dl.setXYZ(1, 0, -pd, 0);
    dl.setXYZ(2, 0, -bottom, 0);
    dl.needsUpdate = true;
    this.depthLine.computeLineDistances();

    // câmera: segue o submarino
    const delta = subPos.clone().sub(this.lastSubPos);
    this.lastSubPos.copy(subPos);
    if (this.view === 'livre') {
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    } else {
      this.viewBlend = Math.min(1, this.viewBlend + dtR * 1.8);
      const target = this.cameraTarget(this.view);
      this.viewFrom.add(delta);
      const k = 1 - Math.pow(1 - this.viewBlend, 3);
      this.camera.position.lerpVectors(this.viewFrom, target, k);
      this.controls.target.copy(subPos);
      if (this.view === 'piloto') this.controls.target.add(this.headingVectors().fwd.multiplyScalar(this.pilotLead()));
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
    const uw = this.underSky.update(this.camera.position, camDepth, this.wallTime);
    const deepColor = uw.horizon.clone();
    this.ocean.update(e.env.waves, tWave, pn, pe, this.camera.position, deepColor, this.wallTime);
    this.sky.position.copy(this.camera.position);
    this.sky.visible = !under;
    this.underSky.mesh.visible = under;
    // fundo só quando dentro do alcance de visibilidade (senão aparece como faixa de névoa)
    if (this.seabed) this.seabed.visible = under && (e.env.bottomDepthAt(pn, pe) - camDepth < (this.realisticFog ? 330 : 1200));
    this.caustics.uTime.value = this.wallTime;
    this.caustics.uCaustic.value = Math.min(1, e.env.waves.hs * 0.45 + 0.15);
    if (under) {
      this.scene.background = deepColor;
      this.scene.fog = this.realisticFog ? new THREE.FogExp2(deepColor.getHex(), 0.0032) : new THREE.FogExp2(deepColor.getHex(), 0.0008);
    } else {
      this.scene.background = new THREE.Color(0x9dbad4);
      this.scene.fog = new THREE.Fog(0x9dbad4, 3000, 14000);
    }
    this.renderer.render(this.scene, this.camera);

    // rótulos
    const proj = (vtx: THREE.Vector3) => {
      const p = vtx.clone().project(this.camera);
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, visible: p.z < 1 && p.z > -1 };
    };
    const lbl: Label3D[] = [];
    const ps = proj(new THREE.Vector3(0, 0, 0));
    lbl.push({ id: 'surf', text: 'superfície', ...ps });
    const psub = proj(subPos.clone().add(new THREE.Vector3(0, 12, 0)));
    lbl.push({ id: 'sub', text: `${e.outputs.depthKeel.toFixed(1)} m · ${(e.state.body.vel.x / 0.5144).toFixed(1)} nós`, ...psub });
    const pb = proj(new THREE.Vector3(0, -bottom, 0));
    lbl.push({ id: 'bot', text: `fundo ${bottom.toFixed(0)} m (altitude ${e.outputs.altitude.toFixed(0)} m)`, ...pb });
    return lbl;
  }

  dispose(): void {
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
