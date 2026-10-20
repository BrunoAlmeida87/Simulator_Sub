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

/** Superfície de controle perfilada (planta trapezoidal, bordo de ataque arredondado). */
export function finGeometry(span: number, chord: number, thickness: number, horizontal: boolean): THREE.BufferGeometry {
  // planta no plano (ao longo da envergadura, ao longo da corda)
  const tip = chord * 0.72;
  const sweep = chord * 0.12;
  const s = new THREE.Shape();
  s.moveTo(-span / 2, -chord / 2);
  s.lineTo(span / 2, -chord / 2 + sweep);
  s.lineTo(span / 2, -chord / 2 + sweep + tip);
  s.quadraticCurveTo(span / 2 - 0.1, chord / 2 + 0.05, span / 2 - 0.35, chord / 2);
  s.lineTo(-span / 2, chord / 2);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thickness * 0.55, bevelEnabled: true, bevelThickness: thickness * 0.22, bevelSize: thickness * 0.2, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, -thickness * 0.275);
  // shape (x = envergadura, y = corda, z = espessura) → horizontal: (x, espessura, corda) | vertical: (espessura, x, corda)
  if (horizontal) g.rotateX(Math.PI / 2);
  else {
    g.rotateX(Math.PI / 2);
    g.rotateZ(Math.PI / 2);
  }
  g.computeVertexNormals();
  return g;
}

/** Pá de hélice em cimitarra (com caimento e passo), para hélices de 7 pás. */
export function bladeGeometry(rHub: number, rTip: number): THREE.BufferGeometry {
  const L = rTip - rHub;
  const s = new THREE.Shape();
  // contorno da pá no plano (x = corda, y = raio)
  s.moveTo(-0.22, 0);
  s.bezierCurveTo(-0.5, L * 0.35, -0.35, L * 0.8, 0.12, L);
  s.bezierCurveTo(0.45, L * 0.82, 0.5, L * 0.3, 0.22, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 10 });
  // torção (passo): gira cada seção em torno do raio proporcionalmente
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = Math.max(0, Math.min(1, v.y / L));
    const ang = 0.9 - 0.45 * k;
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    const x = v.x * c - v.z * sn;
    const z = v.x * sn + v.z * c;
    p.setXYZ(i, x, v.y + rHub, z);
  }
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
