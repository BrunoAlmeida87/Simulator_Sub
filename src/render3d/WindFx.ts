/**
 * VENTO APARENTE (só visual; o vento não entra na física).
 *
 * Vento real: uma brisa leve no sentido em que as ondas vão, um pouco mais
 * forte com o mar mais agitado. Vento aparente = vento real − velocidade do
 * submarino sobre o fundo: com o submarino avançando ele passa a vir da proa,
 * de encontro ao submarino (sensação de avanço). Mostrado por:
 *  - poucas linhas finas e discretas passando acima da água perto da vela, no
 *    sentido do vento aparente (camada "Vento");
 *  - flâmula opcional num pau curto no topo da vela (camada "Flâmula", só com
 *    a vela fora d'água), estendida para sotavento.
 */
import * as THREE from 'three';
import type { SimulationEngine } from '../sim/core/engine';
import type { Label3D } from './SubmarineScene';

/** brisa (m/s) por estado do mar 0…6 — fraca de propósito: o avanço do submarino domina o vento aparente */
export const WIND_BY_SEA_STATE = [0.4, 0.8, 1.2, 1.6, 2.0, 2.5, 3.0];

/** vento real (m/s), como vetor para onde o ar vai (n, e) */
export function trueWind(e: SimulationEngine): { n: number; e: number; speed: number } {
  const w = e.env.cfg.waves;
  const ss = Math.max(0, Math.min(6, Math.round(w?.seaState ?? 0)));
  const speed = WIND_BY_SEA_STATE[ss];
  const a = ((w?.direction ?? 0) * Math.PI) / 180;
  return { n: Math.cos(a) * speed, e: Math.sin(a) * speed, speed };
}

/**
 * vento aparente a bordo (m/s): vetor do ar em relação ao submarino (n, e),
 * intensidade e de onde vem em relação à proa (°, + = boreste)
 */
export function apparentWind(e: SimulationEngine): { n: number; e: number; speed: number; fromRel: number } {
  const t = trueWind(e);
  const v = e.outputs.velNED;
  const n = t.n - v.x;
  const ee = t.e - v.y;
  const speed = Math.hypot(n, ee);
  // de onde vem: oposto ao sentido do ar
  const from = (Math.atan2(-ee, -n) * 180) / Math.PI;
  const rel = ((((from - e.outputs.euler.heading + 180) % 360) + 360) % 360) - 180;
  return { n, e: ee, speed, fromRel: rel };
}

const N = 36;
/** comprimento da flâmula (m) */
const FL = 2.6;
const BOX = 38;
/** largura das faixas de vento (m) */
const WID = 0.07;

interface Streak {
  dn: number;
  de: number;
  h: number;
  life: number;
  max: number;
}

export class WindFx {
  readonly group = new THREE.Group();
  /** flâmula presa ao submarino (local da vela) */
  readonly pennant = new THREE.Group();
  private lines: THREE.Mesh;
  private pos: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;
  private streaks: Streak[] = [];
  private flag: THREE.Mesh;
  private flagPos: THREE.BufferAttribute;
  private flagBase: Float32Array;
  private wall = 0;

  constructor(sailTop: number, xStaff: number) {
    // cada faixa: duas tiras cruzadas (horizontal e vertical), visíveis de qualquer ângulo; 8 vértices
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.Float32BufferAttribute(new Float32Array(N * 8 * 3), 3);
    this.col = new THREE.Float32BufferAttribute(new Float32Array(N * 8 * 4), 4);
    const idx: number[] = [];
    for (let i = 0; i < N; i++) {
      const b = i * 8;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2, b + 4, b + 5, b + 6, b + 5, b + 7, b + 6);
    }
    g.setIndex(idx);
    g.setAttribute('position', this.pos);
    g.setAttribute('color', this.col);
    this.lines = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
    this.group.add(this.lines);
    for (let i = 0; i < N; i++) this.streaks.push(this.spawn({ dn: 0, de: 0, h: 0, life: 0, max: 1 }, Math.random()));
    // flâmula: pau no topo da vela (à ré) e um triângulo que tremula
    const staffMat = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.6, roughness: 0.35 });
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 2.6, 8), staffMat);
    staff.position.y = 1.3;
    const fg = new THREE.PlaneGeometry(FL, 0.95, 12, 1);
    // triângulo: a altura diminui para a ponta
    const p = fg.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + FL / 2;
      const k = 1 - (x / FL) * 0.85;
      p.setXYZ(i, x, p.getY(i) * k, 0);
    }
    this.flagBase = Float32Array.from(p.array as Float32Array);
    this.flagPos = p;
    this.flag = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: 0xd8342c, side: THREE.DoubleSide, roughness: 0.75, emissive: 0x3a0a08 }));
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.95), new THREE.MeshStandardMaterial({ color: 0xf4f4f4, side: THREE.DoubleSide, emissive: 0x303030 }));
    stripe.position.set(0.25, 0, 0.004);
    this.flag.add(stripe);
    this.flag.position.y = 2.1;
    this.pennant.add(staff, this.flag);
    this.pennant.position.set(0, sailTop, -xStaff);
    this.pennant.name = 'Flâmula (vento aparente)';
  }

  private spawn(s: Streak, phase = 0): Streak {
    s.dn = (Math.random() * 2 - 1) * BOX;
    s.de = (Math.random() * 2 - 1) * BOX;
    s.h = 0.8 + Math.random() * Math.random() * 7;
    s.max = 1.2 + Math.random() * 1.4;
    s.life = phase * s.max;
    return s;
  }

  /**
   * dt: tempo de simulação; pn/pe: origem flutuante (posição do submarino);
   * on: camada Vento; under: câmera debaixo d'água; flag: flâmula visível (camada Flâmula e vela fora d'água)
   */
  update(e: SimulationEngine, dt: number, dtWall: number, pn: number, pe: number, t: number, on: boolean, under: boolean, flag: boolean): void {
    const aw = apparentWind(e);
    this.group.visible = on && !under && aw.speed > 0.5;
    this.pennant.visible = flag;
    this.wall += dtWall;
    const w = e.env.waves;
    if (this.group.visible) {
      const dn = aw.n / Math.max(1e-6, aw.speed);
      const de = aw.e / Math.max(1e-6, aw.speed);
      const len = Math.min(4.5, 0.9 + aw.speed * 0.35);
      const k = Math.min(1, (aw.speed - 0.5) / 6);
      for (let i = 0; i < N; i++) {
        const s = this.streaks[i];
        s.life += dt;
        // o ar passa pelo submarino com a velocidade do vento aparente
        s.dn += aw.n * dt;
        s.de += aw.e * dt;
        if (s.life >= s.max || Math.abs(s.dn) > BOX + 8 || Math.abs(s.de) > BOX + 8) {
          this.spawn(s);
          // nasce a barlavento: entra na caixa pelo lado de onde vem o vento
          s.dn -= dn * BOX * 0.6 * Math.random();
          s.de -= de * BOX * 0.6 * Math.random();
        }
        const y = w.elevation(pn + s.dn, pe + s.de, t) + s.h;
        // cena: x = leste, y = cima, z = −norte
        const x0 = s.de;
        const z0 = -s.dn;
        // cauda (transparente) a barlavento, cabeça a sotavento; direção (leste, −norte) na cena
        const ax = de * len * 0.5;
        const az = -dn * len * 0.5;
        // lateral horizontal (perpendicular ao vento) e vertical
        const px = (-az / (len * 0.5)) * WID;
        const pz = (ax / (len * 0.5)) * WID;
        const b = i * 8;
        this.pos.setXYZ(b, x0 - ax - px, y, z0 - az - pz);
        this.pos.setXYZ(b + 1, x0 - ax + px, y, z0 - az + pz);
        this.pos.setXYZ(b + 2, x0 + ax - px, y, z0 + az - pz);
        this.pos.setXYZ(b + 3, x0 + ax + px, y, z0 + az + pz);
        this.pos.setXYZ(b + 4, x0 - ax, y - WID, z0 - az);
        this.pos.setXYZ(b + 5, x0 - ax, y + WID, z0 - az);
        this.pos.setXYZ(b + 6, x0 + ax, y - WID, z0 + az);
        this.pos.setXYZ(b + 7, x0 + ax, y + WID, z0 + az);
        const a = Math.sin((Math.PI * s.life) / s.max) * 0.3 * k;
        for (const q of [0, 1, 4, 5]) this.col.setXYZW(b + q, 1, 1, 1, 0);
        for (const q of [2, 3, 6, 7]) this.col.setXYZW(b + q, 1, 1, 1, a);
      }
      this.pos.needsUpdate = true;
      this.col.needsUpdate = true;
    }
    if (this.pennant.visible) {
      // direção do vento aparente no referencial do submarino → local da cena (x = boreste, z = ré)
      const psi = (e.outputs.euler.heading * Math.PI) / 180;
      const bx = aw.n * Math.cos(psi) + aw.e * Math.sin(psi);
      const by = -aw.n * Math.sin(psi) + aw.e * Math.cos(psi);
      const lx = by;
      const lz = -bx;
      this.flag.rotation.y = Math.atan2(-lz, lx);
      // pouco vento: a flâmula cai
      const droop = Math.max(0, 1 - aw.speed / 5);
      this.flag.rotation.z = -droop * 1.25;
      const om = 4 + aw.speed * 1.1;
      const amp = 0.07 + Math.min(0.2, aw.speed * 0.016);
      const b = this.flagBase;
      for (let i = 0; i < this.flagPos.count; i++) {
        const x = b[3 * i];
        this.flagPos.setXYZ(i, x, b[3 * i + 1], Math.sin(x * 2.4 - this.wall * om) * amp * (x / FL));
      }
      this.flagPos.needsUpdate = true;
    }
  }

  /** rótulo do vento aparente junto à flâmula (camada Identificações) */
  label(e: SimulationEngine, lbl: Label3D[], proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean }): void {
    if (!this.pennant.visible) return;
    const aw = apparentWind(e);
    const kn = aw.speed / 0.5144;
    const side = Math.abs(aw.fromRel) < 3 ? 'pela proa' : Math.abs(aw.fromRel) > 177 ? 'pela popa' : `${Math.round(Math.abs(aw.fromRel))}° ${aw.fromRel > 0 ? 'BE' : 'BB'}`;
    const p = proj(this.pennant.localToWorld(new THREE.Vector3(0, 3.4, 0)));
    lbl.push({ id: 'wind', text: `vento aparente ${kn.toFixed(0)} nós`, sub: `vem ${side}`, ...p, small: true, prio: 3 });
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
    this.pennant.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }
}
