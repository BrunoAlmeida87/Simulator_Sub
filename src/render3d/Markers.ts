/**
 * REFERÊNCIAS FIXAS NO CENÁRIO (opcionais): boias numa malha de 300 m com
 * cabo de fundeio marcado a cada 10 m (referência de profundidade debaixo
 * d'água) e marcadores de distância a cada 50 m ao longo da derrota inicial.
 * Ficam parados no referencial do mundo; só sobem e descem com as ondas.
 */
import * as THREE from 'three';
import type { SimulationEngine } from '../sim/core/engine';

const GRID = 300;
const N_BUOY = 36;
const N_POST = 30;
const POST_STEP = 50;
const ROPE = 120; // m de cabo desenhado
const BEADS = ROPE / 10;

function textSprite(text: string, color = '#ffe14d'): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(8,16,26,0.78)';
  g.beginPath();
  g.roundRect(4, 14, 248, 68, 14);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = color;
  g.font = 'bold 44px ui-monospace, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true, toneMapped: false, fog: false }));
  s.scale.set(9, 3.4, 1);
  return s;
}

interface Buoy {
  g: THREE.Group;
  rope: THREE.Line;
  beads: THREE.Points;
  n: number;
  e: number;
}

interface Post {
  g: THREE.Group;
  label: THREE.Sprite | null;
  k: number;
  n: number;
  e: number;
}

export class Markers {
  readonly group = new THREE.Group();
  private buoys: Buoy[] = [];
  private posts: Post[] = [];
  private origin: { n: number; e: number; psi: number };
  private labelCache = new Map<number, THREE.Sprite>();

  constructor(e: SimulationEngine, dot: THREE.Texture | null) {
    const s = e.state;
    this.origin = { n: s.body.pos.x, e: s.body.pos.y, psi: (e.outputs.euler.heading * Math.PI) / 180 };
    const red = new THREE.MeshStandardMaterial({ color: 0xe0352b, emissive: 0x5a0d08, roughness: 0.5 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, emissive: 0x333333, roughness: 0.5 });
    const lamp = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });
    const ropeMat = new THREE.LineBasicMaterial({ color: 0xd8c9a0, transparent: true, opacity: 0.75 });
    const beadMat = new THREE.PointsMaterial({ color: 0xffe14d, size: 0.9, map: dot ?? undefined, transparent: true, depthWrite: false });
    for (let i = 0; i < N_BUOY; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.6, 16), i % 2 ? red : white);
      body.position.y = 0.3;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.35, 16), i % 2 ? white : red);
      band.position.y = 0.6;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.6, 8), white);
      mast.position.y = 2.2;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.9, 12), i % 2 ? red : white);
      cone.position.y = 3.6;
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), lamp);
      l.position.y = 4.2;
      g.add(body, band, mast, cone, l);
      const rg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -ROPE, 0)]);
      const rope = new THREE.Line(rg, ropeMat);
      const bg = new THREE.BufferGeometry();
      const bp = new Float32Array(BEADS * 3);
      for (let k = 0; k < BEADS; k++) bp[k * 3 + 1] = -(k + 1) * 10;
      bg.setAttribute('position', new THREE.BufferAttribute(bp, 3));
      const beads = new THREE.Points(bg, beadMat);
      g.add(rope, beads);
      this.group.add(g);
      this.buoys.push({ g, rope, beads, n: NaN, e: NaN });
    }
    const yel = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0x4a3a00, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b2633, roughness: 0.7 });
    for (let i = 0; i < N_POST; i++) {
      const g = new THREE.Group();
      const raft = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.4, 12), yel);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 6), dark);
      pole.position.y = 1.8;
      const flag = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.05), yel);
      flag.position.set(0.6, 3.1, 0);
      g.add(raft, pole, flag);
      this.group.add(g);
      this.posts.push({ g, label: null, k: NaN, n: 0, e: 0 });
    }
  }

  private label(k: number): THREE.Sprite {
    let s = this.labelCache.get(k);
    if (!s) {
      s = textSprite(`${k * POST_STEP} m`);
      this.labelCache.set(k, s);
    }
    return s;
  }

  update(e: SimulationEngine, pn: number, pe: number, t: number, enabled: boolean): void {
    this.group.visible = enabled;
    if (!enabled) return;
    const w = e.env.waves;
    // boias: nós da malha mais próximos
    const cn = Math.round(pn / GRID);
    const ce = Math.round(pe / GRID);
    const nodes: { n: number; e: number; d: number }[] = [];
    for (let i = -3; i <= 3; i++)
      for (let j = -3; j <= 3; j++) {
        const n = (cn + i) * GRID + GRID / 2;
        const ee = (ce + j) * GRID + GRID / 2;
        nodes.push({ n, e: ee, d: Math.hypot(n - pn, ee - pe) });
      }
    nodes.sort((a, b) => a.d - b.d);
    this.buoys.forEach((b, i) => {
      const nd = nodes[i];
      b.n = nd.n;
      b.e = nd.e;
      const y = w.elevation(nd.n, nd.e, t);
      b.g.position.set(nd.e - pe, y - 0.35, -(nd.n - pn));
      // cabo até o fundo (no máximo ROPE m)
      const bottom = e.env.bottomDepthAt(nd.n, nd.e);
      b.rope.scale.y = Math.min(1, bottom / ROPE);
      b.g.visible = true;
    });
    // marcadores de distância ao longo da derrota inicial (50 m), 35 m a bombordo
    const o = this.origin;
    const fn = Math.cos(o.psi);
    const fe = Math.sin(o.psi);
    const along = (pn - o.n) * fn + (pe - o.e) * fe;
    const k0 = Math.round(along / POST_STEP) - Math.floor(N_POST / 2);
    this.posts.forEach((p, i) => {
      const k = k0 + i;
      const n = o.n + fn * k * POST_STEP + fe * 35;
      const ee = o.e + fe * k * POST_STEP - fn * 35;
      if (p.k !== k) {
        if (p.label) p.g.remove(p.label);
        p.label = k >= 0 && k % 2 === 0 ? this.label(k) : null;
        if (p.label) {
          p.label.position.set(0, 6, 0);
          p.g.add(p.label);
        }
        p.k = k;
      }
      p.g.visible = k >= 0;
      p.g.position.set(ee - pe, w.elevation(n, ee, t) - 0.1, -(n - pn));
    });
  }
}
