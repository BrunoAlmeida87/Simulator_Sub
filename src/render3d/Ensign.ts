/**
 * BANDEIRA (camada própria): bandeira do Brasil num mastro no topo da vela,
 * tremulando com o vento aparente (o mesmo da flâmula: brisa do estado do mar
 * menos a velocidade do submarino). Só aparece com a vela fora d'água: some
 * quando o submarino submerge. Só visual.
 */
import * as THREE from 'three';
import type { SimulationEngine } from '../sim/core/engine';
import { apparentWind } from './WindFx';

/** comprimento e altura do pano (m), proporção 10:7 */
const LEN = 2.4;
const HGT = 1.68;
const STAFF = 3.4;

/** bandeira do Brasil desenhada em canvas (simplificada: losango, círculo, faixa e estrelas) */
function flagTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const W = 500;
  const H = 350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#009c3b';
  g.fillRect(0, 0, W, H);
  const m = W * (1.7 / 20);
  g.fillStyle = '#ffdf00';
  g.beginPath();
  g.moveTo(m, H / 2);
  g.lineTo(W / 2, m);
  g.lineTo(W - m, H / 2);
  g.lineTo(W / 2, H - m);
  g.closePath();
  g.fill();
  const r = W * (3.5 / 20);
  g.fillStyle = '#002776';
  g.beginPath();
  g.arc(W / 2, H / 2, r, 0, Math.PI * 2);
  g.fill();
  // faixa branca curva com o lema
  g.save();
  g.beginPath();
  g.arc(W / 2, H / 2, r, 0, Math.PI * 2);
  g.clip();
  g.strokeStyle = '#ffffff';
  g.lineWidth = r * 0.17;
  g.beginPath();
  g.arc(W / 2 - r * 0.25, H / 2 + r * 2.1, r * 2.35, -Math.PI * 0.69, -Math.PI * 0.31);
  g.stroke();
  // estrelas
  g.fillStyle = '#ffffff';
  const stars: [number, number, number][] = [
    [0.1, 0.35, 3],
    [-0.3, 0.45, 2.5],
    [0.35, 0.5, 2.5],
    [-0.15, 0.62, 3],
    [0.2, 0.7, 2],
    [-0.45, 0.25, 2],
    [0.5, 0.2, 2],
    [0.0, 0.8, 2.5],
    [-0.6, 0.55, 2],
    [0.65, 0.45, 2],
    [-0.05, -0.55, 3],
  ];
  for (const [x, y, s] of stars) {
    g.beginPath();
    g.arc(W / 2 + x * r, H / 2 + y * r, s * 1.6, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Ensign {
  /** preso ao grupo do submarino (topo da vela) */
  readonly group = new THREE.Group();
  private cloth: THREE.Mesh;
  private pos: THREE.BufferAttribute;
  private base: Float32Array;
  private wall = 0;

  /** sailTop: altura do topo da vela (local); xStaff: posição do mastro (m à vante do centro) */
  constructor(sailTop: number, xStaff: number) {
    const metal = new THREE.MeshStandardMaterial({ color: 0xc8ced6, metalness: 0.6, roughness: 0.35 });
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, STAFF, 8), metal);
    staff.position.y = STAFF / 2;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), metal);
    knob.position.y = STAFF + 0.05;
    const geo = new THREE.PlaneGeometry(LEN, HGT, 18, 6);
    geo.translate(LEN / 2, 0, 0);
    this.pos = geo.getAttribute('position') as THREE.BufferAttribute;
    this.base = Float32Array.from(this.pos.array as Float32Array);
    const tex = flagTexture();
    this.cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex ?? undefined, color: tex ? 0xffffff : 0x009c3b, side: THREE.DoubleSide, roughness: 0.8, emissive: 0x111111 }));
    this.cloth.position.y = STAFF - HGT / 2 - 0.05;
    this.group.add(staff, knob, this.cloth);
    this.group.position.set(0, sailTop, -xStaff);
    this.group.name = 'Bandeira';
    this.group.visible = false;
  }

  /** on: camada ligada e vela fora d'água; dtWall: tempo real (animação do pano) */
  update(e: SimulationEngine, dtWall: number, on: boolean): void {
    this.group.visible = on;
    if (!on) return;
    this.wall += dtWall;
    const aw = apparentWind(e);
    // direção do vento aparente no referencial do submarino → local da cena (x = boreste, z = ré)
    const psi = (e.outputs.euler.heading * Math.PI) / 180;
    const bx = aw.n * Math.cos(psi) + aw.e * Math.sin(psi);
    const by = -aw.n * Math.sin(psi) + aw.e * Math.cos(psi);
    this.cloth.rotation.y = Math.atan2(bx, by);
    // pouco vento: o pano cai junto ao mastro, mas continua ondulando
    const lift = Math.min(1, aw.speed / 3.5);
    const droop = (1 - lift) * 0.95;
    const om = 3.2 + aw.speed * 1.2;
    const amp = 0.1 + Math.min(0.22, aw.speed * 0.03);
    const b = this.base;
    for (let i = 0; i < this.pos.count; i++) {
      const x = b[3 * i];
      const y = b[3 * i + 1];
      const f = x / LEN;
      // onda que corre do mastro para a ponta, maior na ponta; com pouco vento o pano pende (cai para baixo)
      const wave = Math.sin(x * 2.2 - this.wall * om + y * 0.6) * amp * f;
      const hang = Math.sin(droop) * x;
      const along = Math.cos(droop) * x;
      this.pos.setXYZ(i, along + wave * 0.15, y - hang, wave);
    }
    this.pos.needsUpdate = true;
    this.cloth.geometry.computeVertexNormals();
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.map?.dispose();
        mat.dispose();
      }
    });
  }
}
