/**
 * TERRENO 3D — fundo do mar e, com a costa ligada, terra e orla. Os vértices
 * vêm de Environment.bottomDepthAt (a MESMA função usada pela física, pelo
 * ecobatímetro e pelos alarmes): o que se vê é o que o casco "sente".
 *
 * Detalhe por distância (níveis independentes, recentrados quando o
 * submarino se afasta):
 *  - PERTO: fundo e terra com resolução fina (20–30 m), em volta do
 *    submarino; é o único visível debaixo d'água;
 *  - MÉDIO e LONGE (só com costa): terra com resolução menor; a água vira
 *    um plano escuro logo abaixo do nível do mar; vistos só de cima d'água.
 * Os níveis mais grosseiros ficam alguns metros abaixo para não brigarem
 * com o nível fino onde se sobrepõem.
 */
import * as THREE from 'three';
import type { Environment } from '../sim/environment/environment';

export type TerrainDetail = 'baixa' | 'media' | 'alta';

interface RingSpec {
  size: number;
  segs: number;
  /** deslocamento vertical (m) para ceder ao nível mais fino */
  drop: number;
  /** distância (m) de deslocamento que provoca reconstrução */
  rebuild: number;
  /** água achatada (níveis grosseiros) */
  flatSea: boolean;
}

const SPECS: Record<TerrainDetail, { near: RingSpec; mid: RingSpec | null; far: RingSpec | null }> = {
  baixa: { near: { size: 3000, segs: 100, drop: 0, rebuild: 700, flatSea: false }, mid: { size: 14000, segs: 80, drop: 2, rebuild: 3500, flatSea: true }, far: null },
  media: {
    near: { size: 4000, segs: 160, drop: 0, rebuild: 900, flatSea: false },
    mid: { size: 20000, segs: 160, drop: 2, rebuild: 4500, flatSea: true },
    far: { size: 60000, segs: 150, drop: 5, rebuild: 15000, flatSea: true },
  },
  alta: {
    near: { size: 6000, segs: 300, drop: 0, rebuild: 1300, flatSea: false },
    mid: { size: 24000, segs: 240, drop: 2, rebuild: 5500, flatSea: true },
    far: { size: 70000, segs: 200, drop: 5, rebuild: 17000, flatSea: true },
  },
};

/** textura de detalhe (ruído suave), multiplicada pelas cores dos vértices */
function detailTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  let s = 1234567;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff);
  // ruído de valor em duas escalas, periódico
  const grid = (k: number) => Array.from({ length: k * k }, rnd);
  const g1 = grid(16);
  const g2 = grid(64);
  const sample = (gr: number[], k: number, x: number, y: number) => {
    const fx = (x / N) * k;
    const fy = (y / N) * k;
    const x0 = Math.floor(fx) % k;
    const y0 = Math.floor(fy) % k;
    const x1 = (x0 + 1) % k;
    const y1 = (y0 + 1) % k;
    const tx = fx - Math.floor(fx);
    const ty = fy - Math.floor(fy);
    const a = gr[y0 * k + x0] * (1 - tx) + gr[y0 * k + x1] * tx;
    const b = gr[y1 * k + x0] * (1 - tx) + gr[y1 * k + x1] * tx;
    return a * (1 - ty) + b * ty;
  };
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const v = 0.78 + 0.16 * sample(g1, 16, x, y) + 0.1 * sample(g2, 64, x, y);
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, v * 255);
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const C = {
  bedShallow: new THREE.Color(0x8a7d58),
  bedDeep: new THREE.Color(0x2b3a3e),
  sand: new THREE.Color(0xc9b98a),
  grass: new THREE.Color(0x6f8a45),
  forest: new THREE.Color(0x2f5a2c),
  highForest: new THREE.Color(0x3b5434),
  rock: new THREE.Color(0x6b6b63),
  sea: new THREE.Color(0x14324a),
};

/** cor de um ponto do terreno (altura h > 0 em terra, < 0 no fundo) e declive */
function terrainColor(h: number, slope: number, out: THREE.Color, flatSea: boolean, deepest: number): void {
  if (h <= 0) {
    if (flatSea) {
      out.copy(C.sea);
      return;
    }
    const t = Math.min(1, -h / Math.max(30, deepest));
    out.copy(C.bedShallow).lerp(C.bedDeep, Math.sqrt(t));
    return;
  }
  if (h < 2.5) out.copy(C.sand);
  else if (h < 10) out.copy(C.sand).lerp(C.grass, (h - 2.5) / 7.5);
  else if (h < 120) out.copy(C.grass).lerp(C.forest, Math.min(1, (h - 10) / 60));
  else out.copy(C.forest).lerp(C.highForest, Math.min(1, (h - 120) / 500));
  if (slope > 0.6) out.lerp(C.rock, Math.min(1, (slope - 0.6) * 1.5));
}

class Ring {
  mesh: THREE.Mesh | null = null;
  center = { n: 1e12, e: 1e12 };
  hasLand = false;
  constructor(
    private spec: RingSpec,
    private mat: THREE.Material,
  ) {}

  needs(pn: number, pe: number): boolean {
    return Math.hypot(pn - this.center.n, pe - this.center.e) > this.spec.rebuild;
  }

  build(env: Environment, n0: number, e0: number, parent: THREE.Object3D): void {
    const { size, segs, drop, flatSea } = this.spec;
    const g = new THREE.PlaneGeometry(size, size, segs, segs);
    g.rotateX(-Math.PI / 2);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const n1 = segs + 1;
    const H = new Float32Array(pos.count);
    let deepest = 1;
    let land = false;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = -env.bottomDepthAt(n0 - z, e0 + x);
      H[i] = h;
      if (h > 0) land = true;
      else deepest = Math.max(deepest, -h);
    }
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();
    const step = size / segs;
    for (let i = 0; i < pos.count; i++) {
      const ix = i % n1;
      const iz = Math.floor(i / n1);
      const hx = H[Math.min(n1 - 1, ix + 1) + iz * n1] - H[Math.max(0, ix - 1) + iz * n1];
      const hz = H[ix + Math.min(n1 - 1, iz + 1) * n1] - H[ix + Math.max(0, iz - 1) * n1];
      const slope = Math.hypot(hx, hz) / (2 * step);
      const h = H[i];
      terrainColor(h, slope, col, flatSea, deepest);
      colors.set([col.r, col.g, col.b], i * 3);
      // níveis grosseiros: água achatada logo abaixo do nível do mar
      const y = flatSea && h <= 0 ? -1.2 : h;
      pos.setY(i, y - drop);
      // textura de detalhe a cada ~80 m
      uv.setXY(i, (pos.getX(i) + e0) / 80, (-pos.getZ(i) + n0) / 80);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    if (this.mesh) {
      parent.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this.center = { n: n0, e: e0 };
    this.hasLand = land;
  }

  place(pn: number, pe: number): void {
    if (this.mesh) this.mesh.position.set(this.center.e - pe, 0, -(this.center.n - pn));
  }

  dispose(parent: THREE.Object3D): void {
    if (this.mesh) {
      parent.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.center = { n: 1e12, e: 1e12 };
  }
}

export class TerrainLayer {
  readonly group = new THREE.Group();
  private near: Ring;
  private mid: Ring | null;
  private far: Ring | null;
  private bedMat: THREE.MeshStandardMaterial;
  private landMat: THREE.MeshStandardMaterial;
  private key = '';
  readonly detail: TerrainDetail;

  constructor(detail: TerrainDetail, decorate: (m: THREE.MeshStandardMaterial) => void) {
    this.detail = detail;
    const tex = detailTexture();
    this.bedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.landMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    if (tex) this.bedMat.map = this.landMat.map = tex;
    decorate(this.bedMat);
    const sp = SPECS[detail];
    this.near = new Ring(sp.near, this.bedMat);
    this.mid = sp.mid ? new Ring(sp.mid, this.landMat) : null;
    this.far = sp.far ? new Ring(sp.far, this.landMat) : null;
  }

  /** existe terra no nível fino (perto) — para decidir visibilidade debaixo d'água */
  get landNear(): boolean {
    return this.near.hasLand;
  }

  /**
   * Atualiza (reconstrói quando o submarino se afasta ou a configuração do
   * fundo muda) e posiciona os níveis. coast = costa ligada.
   */
  update(env: Environment, pn: number, pe: number, coast: boolean): void {
    const key = JSON.stringify([env.cfg.bottom, env.cfg.geo]);
    const force = key !== this.key;
    this.key = key;
    const snap = (v: number, k: number) => Math.round(v / k) * k;
    if (force || this.near.needs(pn, pe)) this.near.build(env, snap(pn, 100), snap(pe, 100), this.group);
    this.near.place(pn, pe);
    for (const r of [this.mid, this.far]) {
      if (!r) continue;
      if (!coast) {
        r.dispose(this.group);
        continue;
      }
      if (force || r.needs(pn, pe)) r.build(env, snap(pn, 500), snap(pe, 500), this.group);
      r.place(pn, pe);
    }
  }

  /** visibilidade dos níveis: perto (fundo/terra), médio/longe (só acima d'água) */
  setVisible(near: boolean, coarse: boolean): void {
    if (this.near.mesh) this.near.mesh.visible = near;
    for (const r of [this.mid, this.far]) if (r && r.mesh) r.mesh.visible = coarse;
  }

  dispose(): void {
    this.near.dispose(this.group);
    this.mid?.dispose(this.group);
    this.far?.dispose(this.group);
    this.bedMat.map?.dispose();
    this.bedMat.dispose();
    this.landMat.dispose();
  }
}
