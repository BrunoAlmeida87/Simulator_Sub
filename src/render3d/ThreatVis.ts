/**
 * AMEAÇAS E REBOCADORES NA CENA 3D (só lê o estado; nada aqui altera a física).
 *
 *  - camada `threats`: torpedo de exercício contra o SX-1 (state.threat.torpedoes) com rastro de bolhas,
 *    despistadores (coluna de bolhas) e a aeronave de patrulha (state.stealth.aircraft) na altitude da física;
 *  - camada `tugs`: rebocadores (state.tugs) ao lado do casco no ponto e bordo da física, com o cabo quando
 *    puxam e a espuma do hélice proporcional à tração. Usa o modelo do rebocador ASD da galeria quando o
 *    arquivo carrega (senão um casco simplificado).
 * Eixo dos modelos: −z para vante; rotation.y = −rumo (como os navios em Ships.ts).
 */
import * as THREE from 'three';
import type { SimulationEngine } from '../sim/core/engine';
import { defaultStealth, defaultTugs } from '../sim/config/extSystems';
import { qToMat3 } from '../sim/core/math';
import { Bubbles } from './TorpedoVis';
import { ImportedShips } from './ImportedShips';
import type { Label3D } from './SubmarineScene';

const scenePos = (n: number, e: number, d: number, pn: number, pe: number, out = new THREE.Vector3()) => out.set(e - pe, -d, -(n - pn));
const DEG = Math.PI / 180;

function torpedoMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 5.6, 16), new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.4, roughness: 0.5 }));
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc23b3b, roughness: 0.6 }));
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -2.8;
  g.add(nose);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.4), new THREE.MeshStandardMaterial({ color: 0x1b1f24 }));
  fin.position.z = 2.6;
  g.add(fin);
  const fin2 = fin.clone();
  fin2.rotation.z = Math.PI / 2;
  g.add(fin2);
  return g;
}

function decoyMesh(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 10), new THREE.MeshStandardMaterial({ color: 0xd9c58a, emissive: 0x3a3010 }));
  return m;
}

function aircraftMesh(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb8c2cc, metalness: 0.2, roughness: 0.6 });
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.7, 34, 12), mat);
  fus.rotation.x = Math.PI / 2;
  g.add(fus);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(32, 0.5, 4.2), mat);
  wing.position.set(0, 0.6, -1);
  g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(12, 0.4, 2.4), mat);
  tail.position.set(0, 0.8, 15);
  g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5.5, 3), mat);
  fin.position.set(0, 3.2, 15.5);
  g.add(fin);
  for (const x of [-7.5, -3.8, 3.8, 7.5]) {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 3.6, 10), mat);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(x, 0.1, -3);
    g.add(eng);
  }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
  beacon.position.set(0, 1.4, 0);
  beacon.name = 'beacon';
  g.add(beacon);
  return g;
}

function tugPlaceholder(): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(9, 3.2, 26), new THREE.MeshStandardMaterial({ color: 0x24354a, roughness: 0.7 }));
  hull.position.y = 0.6;
  g.add(hull);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.4, 26.2), new THREE.MeshStandardMaterial({ color: 0xb0482f }));
  deck.position.y = 2.3;
  g.add(deck);
  const house = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 7), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 }));
  house.position.set(0, 4.5, -4);
  g.add(house);
  const fender = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.5, 6, 18, Math.PI), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  fender.rotation.x = Math.PI / 2;
  fender.position.set(0, 1.6, -12.6);
  g.add(fender);
  return g;
}

interface TorpVis {
  mesh: THREE.Group;
  wake: Bubbles;
  acc: number;
  last: THREE.Vector3 | null;
}

interface TugVis {
  root: THREE.Group;
  model: THREE.Group;
  line: THREE.Line;
  lineAttr: THREE.BufferAttribute;
  foam: Bubbles;
  acc: number;
}

export class ThreatVis {
  readonly group = new THREE.Group();
  private torps = new Map<string, TorpVis>();
  private decoys = new Map<string, { mesh: THREE.Mesh; bubbles: Bubbles; acc: number }>();
  private aircraft: THREE.Group | null = null;
  private tugs = new Map<string, TugVis>();
  private imported = new ImportedShips();
  private lastPn = 0;
  private lastPe = 0;
  private tmp = new THREE.Vector3();

  constructor(private dot: THREE.Texture | null) {}

  private torpVis(id: string): TorpVis {
    let v = this.torps.get(id);
    if (!v) {
      v = { mesh: torpedoMesh(), wake: new Bubbles(260, this.dot, 0.45), acc: 0, last: null };
      this.group.add(v.mesh, v.wake.points);
      this.torps.set(id, v);
    }
    return v;
  }

  private tugVis(id: string, length: number): TugVis {
    let v = this.tugs.get(id);
    if (!v) {
      const root = new THREE.Group();
      const model = tugPlaceholder();
      root.add(model);
      const g = new THREE.BufferGeometry();
      const lineAttr = new THREE.BufferAttribute(new Float32Array(6), 3);
      g.setAttribute('position', lineAttr);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xd9c58a }));
      line.frustumCulled = false;
      const foam = new Bubbles(160, this.dot, 0.9);
      this.group.add(root, line, foam.points);
      v = { root, model, line, lineAttr, foam, acc: 0 };
      this.tugs.set(id, v);
      const entry = v;
      void this.imported.instance('asd').then((mesh) => {
        if (!mesh || this.tugs.get(id) !== entry) return;
        const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
        if (!(size.z > 0)) return;
        mesh.scale.multiplyScalar(length / size.z);
        entry.root.remove(entry.model);
        entry.model.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
        entry.model = mesh;
        entry.root.add(mesh);
      });
    }
    return v;
  }

  update(
    e: SimulationEngine,
    pn: number,
    pe: number,
    layers: { threats?: boolean; tugs?: boolean; labels?: boolean },
    dtVis: number,
    elev: (n: number, e: number) => number,
    labels: Label3D[] | null,
    proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean },
  ): void {
    const s = e.state;
    const shift = this.tmp.set(pe - this.lastPe, 0, -(pn - this.lastPn)).clone();
    this.lastPn = pn;
    this.lastPe = pe;
    const showThreats = layers.threats !== false;
    // --- torpedos inimigos
    const alive = new Set<string>();
    for (const tp of showThreats ? (s.threat?.torpedoes ?? []) : []) {
      if (tp.phase === 'impacto' || tp.phase === 'fim') continue;
      alive.add(tp.id);
      const v = this.torpVis(tp.id);
      scenePos(tp.n, tp.e, tp.d, pn, pe, v.mesh.position);
      v.mesh.rotation.set(0, -tp.heading * DEG, 0);
      v.mesh.visible = true;
      v.acc += dtVis * (tp.speed / 2);
      const tail = this.tmp.set(0, 0, 3).applyEuler(v.mesh.rotation).add(v.mesh.position);
      while (v.acc > 1) {
        v.acc -= 1;
        v.wake.emit(tail, 0.4, 0.5, 7);
      }
      v.wake.step(dtVis, shift, -elev(pn, pe) + 0.2);
      if (labels) {
        const p = proj(v.mesh.position);
        labels.push({ id: 'thr_' + tp.id, text: `◆ Torpedo ${tp.id}`, sub: tp.phase, color: '#ff8a8e', small: true, prio: 0, x: p.x, y: p.y, visible: p.visible });
      }
    }
    for (const [id, v] of this.torps) {
      if (alive.has(id)) continue;
      v.mesh.visible = false;
      v.wake.step(dtVis, shift, 0);
      if (!v.wake.active()) {
        this.group.remove(v.mesh, v.wake.points);
        v.mesh.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
        v.wake.points.geometry.dispose();
        this.torps.delete(id);
      }
    }
    // --- despistadores
    const liveD = new Set<string>();
    for (const dc of showThreats ? (s.threat?.decoys ?? []) : []) {
      liveD.add(dc.id);
      let v = this.decoys.get(dc.id);
      if (!v) {
        v = { mesh: decoyMesh(), bubbles: new Bubbles(180, this.dot, 0.35), acc: 0 };
        this.group.add(v.mesh, v.bubbles.points);
        this.decoys.set(dc.id, v);
      }
      scenePos(dc.n, dc.e, dc.d, pn, pe, v.mesh.position);
      v.acc += dtVis * 18;
      while (v.acc > 1) {
        v.acc -= 1;
        v.bubbles.emit(v.mesh.position, 0.3, 1.4, 9);
      }
      v.bubbles.step(dtVis, shift, -elev(pn, pe));
    }
    for (const [id, v] of this.decoys) {
      if (liveD.has(id)) continue;
      v.mesh.visible = false;
      v.bubbles.step(dtVis, shift, 0);
      if (!v.bubbles.active()) {
        this.group.remove(v.mesh, v.bubbles.points);
        v.mesh.geometry.dispose();
        v.bubbles.points.geometry.dispose();
        this.decoys.delete(id);
      }
    }
    // --- aeronave
    const ac = showThreats ? s.stealth?.aircraft : null;
    if (ac) {
      if (!this.aircraft) {
        this.aircraft = aircraftMesh();
        this.group.add(this.aircraft);
      }
      const alt = (e.vessel.stealth ?? defaultStealth()).aircraft.altitude;
      scenePos(ac.n, ac.e, -alt, pn, pe, this.aircraft.position);
      this.aircraft.rotation.set(0, -ac.heading * DEG, 0.35);
      this.aircraft.visible = true;
      const b = this.aircraft.getObjectByName('beacon');
      if (b) b.visible = Math.floor(s.t * 1.5) % 2 === 0;
      if (labels) {
        const p = proj(this.aircraft.position);
        labels.push({
          id: 'thr_air',
          text: '✈ Aeronave de patrulha',
          sub: ac.detectedAt != null && s.t - ac.detectedAt < 60 ? '▲ detectou o SX-1' : 'exercício',
          color: '#e9f8ff',
          small: true,
          prio: 1,
          x: p.x,
          y: p.y,
          visible: p.visible,
        });
      }
    } else if (this.aircraft) this.aircraft.visible = false;
    // --- rebocadores
    const tc = e.vessel.tugs ?? defaultTugs();
    const R = qToMat3(s.body.quat);
    const hdg = e.outputs.euler.heading;
    const rad = e.vessel.hull.diameter / 2;
    for (const t of tc.tugs) {
      const ts = s.tugs?.tugs[t.id];
      const on = layers.tugs !== false && !!ts && ts.mode !== 'livre';
      const v = on ? this.tugVis(t.id, 28) : this.tugs.get(t.id);
      if (!v) continue;
      v.root.visible = on;
      v.line.visible = on && ts!.mode === 'puxar';
      if (!on || !ts) {
        v.foam.step(dtVis, shift, 0);
        continue;
      }
      const side = ts.side === 'BE' ? 1 : -1;
      const gap = ts.mode === 'puxar' ? 38 : 13.5;
      // ponto no casco e posição do rebocador (corpo → NED), na superfície
      const hx = t.x;
      const hn = s.body.pos.x + R[0] * hx + R[1] * side * rad;
      const he = s.body.pos.y + R[3] * hx + R[4] * side * rad;
      const tn = s.body.pos.x + R[0] * hx + R[1] * side * (rad + gap);
      const tE = s.body.pos.y + R[3] * hx + R[4] * side * (rad + gap);
      const eta = elev(tn, tE);
      scenePos(tn, tE, -eta, pn, pe, v.root.position);
      // empurrando: proa voltada para o casco; puxando: popa voltada para o casco
      const face = hdg + (ts.mode === 'empurrar' ? -90 * side : 90 * side) + ts.angle * side * (ts.mode === 'empurrar' ? -1 : 1);
      v.root.rotation.set(0, -face * DEG, 0);
      if (v.line.visible) {
        const a = scenePos(hn, he, -0.5, pn, pe, new THREE.Vector3());
        const b = v.root.position.clone().add(new THREE.Vector3(0, 2, 0));
        const arr = v.lineAttr.array as Float32Array;
        arr.set([a.x, a.y, a.z, b.x, b.y, b.z]);
        v.lineAttr.needsUpdate = true;
      }
      v.acc += dtVis * 30 * ts.level;
      const stern = new THREE.Vector3(0, -0.5, 13).applyEuler(v.root.rotation).add(v.root.position);
      while (v.acc > 1) {
        v.acc -= 1;
        v.foam.emit(stern, 1.5, 0.2, 3);
      }
      v.foam.step(dtVis, shift, v.root.position.y + 0.3);
      if (labels) {
        const p = proj(v.root.position.clone().add(new THREE.Vector3(0, 9, 0)));
        labels.push({ id: 'tug_' + t.id, text: t.name, sub: `${ts.mode} ${Math.round(ts.level * 100)} %`, small: true, prio: 2, x: p.x, y: p.y, visible: p.visible });
      }
    }
  }

  dispose(): void {
    this.imported.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
    this.group.clear();
  }
}
