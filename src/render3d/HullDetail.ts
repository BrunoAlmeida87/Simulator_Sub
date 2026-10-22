/**
 * DETALHES VISUAIS DO CASCO (texturas procedurais e peças decorativas).
 * Nada aqui é lido pela física: só aparência. As dimensões que importam para
 * a física (casco, vela, posição e curso do snorkel, lemes) vêm da
 * configuração e não são alteradas.
 */
import * as THREE from 'three';
import { drawSailDecal, type Appearance } from './sailArt';

/** gerador pseudoaleatório determinístico (texturas iguais a cada execução) */
function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Placas anecoicas (revestimento de borracha) em fiadas desencontradas:
 * mapa de cor (quase branco, multiplica a cor do material) e mapa de relevo.
 * tiles = placas por lado da textura.
 */
export function anechoicTextures(size: number, tiles = 8): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } | null {
  if (typeof document === 'undefined') return null;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  };
  const cm = mk();
  const cb = mk();
  const gm = cm.getContext('2d')!;
  const gb = cb.getContext('2d')!;
  const r = rng(17);
  const t = size / tiles;
  const gap = Math.max(1, size / 512);
  gm.fillStyle = '#b9bfc5';
  gm.fillRect(0, 0, size, size);
  gb.fillStyle = '#202020';
  gb.fillRect(0, 0, size, size);
  for (let j = 0; j < tiles; j++) {
    const off = j % 2 ? t / 2 : 0;
    for (let i = -1; i < tiles + 1; i++) {
      const x = i * t + off;
      const y = j * t;
      const v = 226 + Math.floor(r() * 22);
      gm.fillStyle = `rgb(${v},${v + 2},${v + 4})`;
      gm.fillRect(x + gap, y + gap, t - 2 * gap, t - 2 * gap);
      // leve abaulamento da placa no relevo
      const gr = gb.createRadialGradient(x + t / 2, y + t / 2, t * 0.1, x + t / 2, y + t / 2, t * 0.75);
      gr.addColorStop(0, '#e8e8e8');
      gr.addColorStop(1, '#bdbdbd');
      gb.fillStyle = gr;
      gb.fillRect(x + gap, y + gap, t - 2 * gap, t - 2 * gap);
      // manchas de desgaste
      if (r() < 0.18) {
        gm.fillStyle = `rgba(60,64,70,${0.04 + r() * 0.05})`;
        gm.beginPath();
        gm.ellipse(x + r() * t, y + r() * t, t * (0.1 + r() * 0.25), t * (0.05 + r() * 0.12), r() * Math.PI, 0, Math.PI * 2);
        gm.fill();
      }
    }
  }
  // ruído fino
  const id = gm.getImageData(0, 0, size, size);
  for (let k = 0; k < id.data.length; k += 4) {
    const n = (r() - 0.5) * 10;
    id.data[k] += n;
    id.data[k + 1] += n;
    id.data[k + 2] += n;
  }
  gm.putImageData(id, 0, 0);
  const map = new THREE.CanvasTexture(cm);
  map.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(cb);
  for (const tx of [map, bump]) {
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.anisotropy = 4;
  }
  return { map, bump };
}

/** Meia espessura do perfil simétrico NACA 00xx (x = 0…1 da corda, bordo de fuga fechado), em frações da corda. */
function nacaHalf(x: number, tc: number): number {
  return 5 * tc * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
}

/**
 * Superfície de controle com perfil de asa: seção NACA 00xx simétrica, planta
 * trapezoidal (afilamento e enflechamento do bordo de ataque) e ponta arredondada.
 * Eixos da construção: x = envergadura (raiz em −span/2, ponta em +span/2),
 * y = corda (bordo de ataque em −chord/2), z = espessura.
 */
export function finGeometry(span: number, chord: number, thickness: number, horizontal: boolean): THREE.BufferGeometry {
  const tc = Math.min(0.2, Math.max(0.15, thickness / chord)); // espessura relativa (perfil 0015…0020)
  const taper = 0.62; // corda na ponta / corda na raiz
  const sweep = chord * 0.24; // recuo do bordo de ataque na ponta
  const NS = 18; // estações ao longo da envergadura
  const NC = 22; // pontos por face do perfil
  const xs: number[] = [];
  for (let i = 0; i <= NC; i++) xs.push(0.5 * (1 - Math.cos((Math.PI * i) / NC))); // mais pontos nos bordos
  const pos: number[] = [];
  const ring = 2 * NC; // anel: extradorso (bordo de ataque → fuga) + intradorso (fuga → ataque), sem repetir os bordos
  for (let j = 0; j <= NS; j++) {
    const u = j / NS;
    // ponta arredondada: nos últimos 22 % da envergadura a corda fecha em quarto de elipse, a partir do bordo de fuga
    const tipU = 0.78;
    const base = chord * (1 - (1 - taper) * u);
    const le0 = -chord / 2 + sweep * u;
    let c = base;
    let le = le0;
    if (u > tipU) {
      const k = (u - tipU) / (1 - tipU);
      const f = Math.sqrt(Math.max(0, 1 - k * k));
      c = Math.max(base * 0.04, base * (0.25 + 0.75 * f));
      le = le0 + (base - c) * 0.85;
    }
    const x = -span / 2 + span * u;
    const thick = tc * c * (u > tipU ? Math.max(0.15, Math.sqrt(Math.max(0, 1 - ((u - tipU) / (1 - tipU)) ** 2))) : 1);
    const ht = thick / tc; // corda equivalente para a espessura
    for (let i = 0; i < NC; i++) pos.push(x, le + xs[i] * c, nacaHalf(xs[i], tc) * ht);
    for (let i = NC; i > 0; i--) pos.push(x, le + xs[i] * c, -nacaHalf(xs[i], tc) * ht);
  }
  const idx: number[] = [];
  for (let j = 0; j < NS; j++)
    for (let i = 0; i < ring; i++) {
      const a = j * ring + i;
      const b = j * ring + ((i + 1) % ring);
      const c2 = a + ring;
      const d = b + ring;
      idx.push(a, c2, b, b, c2, d);
    }
  // tampas: raiz (dentro do casco) e ponta
  const cap = (j: number, flip: boolean) => {
    const o = pos.length / 3;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < ring; i++) {
      cx += pos[(j * ring + i) * 3];
      cy += pos[(j * ring + i) * 3 + 1];
    }
    pos.push(cx / ring, cy / ring, 0);
    for (let i = 0; i < ring; i++) {
      const a = j * ring + i;
      const b = j * ring + ((i + 1) % ring);
      if (flip) idx.push(o, a, b);
      else idx.push(o, b, a);
    }
  };
  cap(0, true);
  cap(NS, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // (x = envergadura, y = corda, z = espessura) → horizontal: (x, espessura, corda) | vertical: (espessura, x, corda)
  if (horizontal) g.rotateX(Math.PI / 2);
  else {
    g.rotateX(Math.PI / 2);
    g.rotateZ(Math.PI / 2);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Pá de hélice de submarino (cimitarra de grande caimento): superfície helicoidal
 * com passo P (ângulo φ(r) = atan(P / 2πr)), corda máxima a ~0,5 R e ponta
 * arredondada, caimento (skew) crescente para a ponta, inclinação para ré (rake)
 * e seção lenticular espessa na raiz e fina na ponta.
 * Eixo do hélice = z (+z para ré); a pá nasce ao longo de +y; o giro de vante é −z.
 */
export function bladeGeometry(rHub: number, rTip: number, pitchRatio = 1.0): THREE.BufferGeometry {
  const D = 2 * rTip;
  const P = pitchRatio * D;
  const NR = 26;
  const NC = 14;
  const xh = rHub / rTip;
  const skewMax = (38 * Math.PI) / 180;
  const pos: number[] = [];
  const ring = 2 * NC;
  for (let j = 0; j <= NR; j++) {
    const t = j / NR;
    const xi = 1 - (1 - t) ** 1.35; // estações mais densas perto da ponta
    const x = xh + (1 - xh) * xi; // r/R
    const r = x * rTip * (j === 0 ? 0.92 : 1); // raiz um pouco dentro do cubo
    const chord = D * 0.36 * Math.sqrt(Math.max(0.0016, 1 - x)) * (0.18 + 1.45 * x);
    const phi = Math.atan(P / (2 * Math.PI * Math.max(r, 0.05)));
    const skew = skewMax * xi ** 1.7 - 0.1 * skewMax * Math.sin(Math.PI * xi);
    const rake = 0.06 * D * xi;
    const tmax = D * (0.042 - 0.036 * xi);
    const cphi = Math.cos(phi);
    const sphi = Math.sin(phi);
    const pt = (s: number, side: number) => {
      // s: −1 (bordo de ataque) … +1 (bordo de fuga); side: +1 face (ré), −1 dorso (vante)
      const sc = (s * chord) / 2;
      const xc = (s + 1) / 2;
      const half = 0.5 * tmax * Math.pow(4 * xc * (1 - xc), 0.75); // seção lenticular, bordos finos
      const off = side * half;
      // coordenadas na superfície helicoidal (tangencial, axial) + espessura na normal (−sinφ, cosφ)
      const tang = sc * cphi - off * sphi;
      const ax = sc * sphi + off * cphi + rake;
      const th = skew + tang / r;
      pos.push(-r * Math.sin(th), r * Math.cos(th), ax);
    };
    for (let i = 0; i < NC; i++) pt(-1 + (2 * i) / NC, 1);
    for (let i = NC; i > 0; i--) pt(-1 + (2 * i) / NC, -1);
  }
  const idx: number[] = [];
  for (let j = 0; j < NR; j++)
    for (let i = 0; i < ring; i++) {
      const a = j * ring + i;
      const b = j * ring + ((i + 1) % ring);
      idx.push(a, a + ring, b, b, a + ring, b + ring);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Cubo do hélice: cilindro curto que continua o cone de popa e termina em ogiva. Eixo z (+z para ré). */
export function hubGeometry(rFront: number, length: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const z0 = -0.45 * length;
  const z1 = 0.1 * length;
  const z2 = 0.55 * length;
  pts.push(new THREE.Vector2(0.001, z0));
  pts.push(new THREE.Vector2(rFront * 0.96, z0));
  pts.push(new THREE.Vector2(rFront, z0 + 0.04 * length));
  pts.push(new THREE.Vector2(rFront * 1.04, z1));
  const N = 12;
  for (let i = 1; i <= N; i++) {
    const k = i / N;
    pts.push(new THREE.Vector2(Math.max(0.001, rFront * 1.04 * Math.cos((k * Math.PI) / 2) ** 0.8), z1 + (z2 - z1) * Math.sin((k * Math.PI) / 2)));
  }
  const g = new THREE.LatheGeometry(pts, 28);
  g.rotateX(Math.PI / 2); // eixo do torno (y) → z
  g.computeVertexNormals();
  return g;
}

/**
 * Pintura da vela (emblema + inscrição) nos dois bordos: planos com textura
 * de canvas logo fora das faces planas da vela.
 */
export class SailDecals {
  readonly group = new THREE.Group();
  private sides: { mesh: THREE.Mesh; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; bowRight: boolean }[] = [];
  private key = '';

  /**
   * xMid: posição longitudinal do centro da pintura (m, corpo); yHalf: meia
   * largura da vela; yMid: altura do centro (Three, acima do eixo); w, h: tamanho (m).
   */
  constructor(xMid: number, yHalf: number, yMid: number, w: number, h: number, res: number) {
    if (typeof document === 'undefined') return;
    for (const side of [1, -1]) {
      const canvas = document.createElement('canvas');
      canvas.width = res;
      canvas.height = res / 2;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      // leve emissão: a pintura continua legível no bordo à sombra (apresentação)
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: 0x6a6a6a,
        transparent: true,
        depthWrite: false,
        roughness: 0.55,
        metalness: 0.05,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      // boreste (+x Three) e bombordo (−x), voltados para fora
      mesh.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      mesh.position.set(side * (yHalf + 0.012), yMid, -xMid);
      mesh.renderOrder = 1;
      this.group.add(mesh);
      // boreste: a proa fica à direita de quem olha; bombordo: à esquerda
      this.sides.push({ mesh, canvas, tex, bowRight: side > 0 });
    }
  }

  update(a: Appearance, force = false): void {
    const key = `${a.sailText}|${a.sailTextColor}|${a.emblem}|${a.emblemImage?.length ?? 0}|${a.emblemImage?.slice(-40) ?? ''}`;
    if (key === this.key && !force) return;
    this.key = key;
    for (const s of this.sides) {
      drawSailDecal(s.canvas, a, s.bowRight, () => this.update(a, true));
      s.tex.needsUpdate = true;
    }
  }
}

/**
 * MARCAS DE CALADO pintadas no costado (numerais a cada metro e traços a
 * cada 0,2 m, medidos da linha de base = fundo do cilindro). Faixa que
 * acompanha a curvatura do casco (torno parcial), em um bordo.
 * xc: posição longitudinal (m, corpo); side: +1 boreste, −1 bombordo.
 */
export function draftMarkBand(radiusAt: (x: number) => number, xc: number, side: 1 | -1, maxDraft = 6.2): THREE.Mesh | null {
  if (typeof document === 'undefined') return null;
  const r = radiusAt(xc);
  const len = 1.5; // m ao longo do casco
  const phiTop = Math.acos(Math.min(1, maxDraft / r - 1)); // ângulo (a partir do topo) da marca mais alta
  const phiLen = Math.PI - phiTop;
  const phiStart = side > 0 ? phiTop : Math.PI;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 6; i++) {
    const x = xc - len / 2 + (len * i) / 6;
    pts.push(new THREE.Vector2(radiusAt(x) + 0.012, x));
  }
  const geo = new THREE.LatheGeometry(pts, 64, phiStart, phiLen);
  geo.rotateX(-Math.PI / 2);
  const W = 1024;
  const H = 192;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const su = W / (r * phiLen); // px por metro ao redor do casco
  const sv = H / len; // px por metro ao longo do casco
  /** posição u (px) de uma altura h (m) acima da linha de base */
  const uOf = (h: number) => {
    const phi = Math.acos(Math.max(-1, Math.min(1, h / r - 1)));
    return side > 0 ? ((phi - phiTop) / phiLen) * W : ((Math.PI - phi) / phiLen) * W;
  };
  // texto "em pé" no mundo: o eixo u é vertical no costado e v é longitudinal
  const frame = (h: number, vMid: number) => {
    const X = uOf(h);
    const Y = H - vMid * sv;
    // (tx, ty) em centímetros do texto → canvas; boreste: proa à direita; bombordo: proa à esquerda
    if (side > 0) g.setTransform(0, -sv / 100, su / 100, 0, X, Y);
    else g.setTransform(0, sv / 100, -su / 100, 0, X, Y);
  };
  g.fillStyle = '#f2f2f2';
  g.strokeStyle = 'rgba(15,15,15,0.9)';
  const vCenter = len / 2;
  for (let k = 1; k <= Math.floor(maxDraft / 0.2); k++) {
    const h = k * 0.2;
    const meter = Math.abs(h - Math.round(h)) < 1e-6;
    frame(h, vCenter);
    g.lineWidth = 2;
    if (meter) {
      // numeral com a base na altura exata
      g.font = 'bold 34px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      const t = `${Math.round(h)}M`;
      g.strokeText(t, 0, 0);
      g.fillText(t, 0, 0);
    } else {
      g.fillRect(-20, -4, 40, 4);
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.6, emissive: 0x555555, emissiveMap: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 1;
  return m;
}
