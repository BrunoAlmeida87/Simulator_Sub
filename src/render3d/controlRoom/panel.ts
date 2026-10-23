/**
 * PAINÉIS DESENHADOS EM CANVAS: telas (consoles multifunção) e faces de
 * painéis físicos (lastro, alarmes, instrumentos). Cada painel é um plano 3D
 * com a textura do canvas; ao desenhar, registra REGIÕES CLICÁVEIS (botões,
 * chaves) em coordenadas do canvas. O clique na cena é convertido em
 * coordenadas de textura (uv) → região → ação (que envia comandos ao motor).
 * O conteúdo é lido do estado a cada redesenho: nada visual altera a física.
 */
import * as THREE from 'three';
import type { SimulationEngine } from '../../sim/core/engine';

export interface HitRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string;
  /** texto de ajuda mostrado ao passar o mouse */
  label: string;
  action?: () => void;
  /** desenhada como desabilitada (sem ação) */
  disabled?: boolean;
}

/** estado de interface compartilhado pelos painéis (seleções locais, não físicas) */
export interface RoomUiState {
  /** quantidade de dosagem escolhida em cada sistema (kg) */
  dose: Record<string, number>;
  /** página/grupo selecionado em telas com várias páginas */
  page: Record<string, number>;
  /** teste de lâmpadas pressionado */
  lampTest: boolean;
  /** tampas de proteção abertas (sopro de emergência) */
  guards: Record<string, boolean>;
  /** iluminação da sala */
  lighting: RoomLighting;
  /** cenário selecionado na estação do instrutor */
  scenario: number;
}

export type RoomLighting = 'normal' | 'vermelha' | 'azul';

export interface DrawCtx {
  /** face (difusa) */
  g: CanvasRenderingContext2D;
  /** camada de brilho (lâmpadas acesas), só nos painéis físicos */
  glow: CanvasRenderingContext2D | null;
  W: number;
  H: number;
  e: SimulationEngine;
  /** relógio de parede (s) para piscas */
  now: number;
  ui: RoomUiState;
  hit: (r: HitRegion) => void;
  /** região sob o mouse (realce) */
  hover: string | null;
}

export interface PanelOptions {
  /** dimensões físicas (m) */
  w: number;
  h: number;
  /** resolução do canvas (px) */
  px: [number, number];
  /** 'screen' = tela autoiluminada; 'face' = painel pintado com lâmpadas */
  kind: 'screen' | 'face';
  /** redesenhos por segundo quando visível */
  hz: number;
  draw: (c: DrawCtx) => void;
  /** estação a que pertence (foco ao clicar de longe) */
  station: string;
  name: string;
  /** escala de resolução do canvas (1 = px nominal; < 1 em baixa qualidade). O desenho usa sempre as coordenadas nominais. */
  res?: number;
}

export class CanvasPanel {
  readonly mesh: THREE.Mesh;
  readonly canvas: HTMLCanvasElement;
  readonly tex: THREE.CanvasTexture;
  private glowCanvas: HTMLCanvasElement | null = null;
  private glowTex: THREE.CanvasTexture | null = null;
  private g: CanvasRenderingContext2D;
  private gl: CanvasRenderingContext2D | null = null;
  regions: HitRegion[] = [];
  lastDraw = -1e9;
  dirty = true;
  readonly opts: PanelOptions;
  /** brilho das telas (reduzido na iluminação noturna) */
  private screenMat: THREE.MeshBasicMaterial | null = null;

  constructor(opts: PanelOptions) {
    this.opts = opts;
    const [W, H] = opts.px;
    const k = opts.res ?? 1;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(W * k);
    this.canvas.height = Math.round(H * k);
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    let mat: THREE.Material;
    if (opts.kind === 'screen') {
      this.screenMat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
      mat = this.screenMat;
    } else {
      this.glowCanvas = document.createElement('canvas');
      this.glowCanvas.width = this.canvas.width;
      this.glowCanvas.height = this.canvas.height;
      this.gl = this.glowCanvas.getContext('2d')!;
      this.glowTex = new THREE.CanvasTexture(this.glowCanvas);
      this.glowTex.colorSpace = THREE.SRGBColorSpace;
      mat = new THREE.MeshStandardMaterial({ map: this.tex, emissiveMap: this.glowTex, emissive: 0xffffff, emissiveIntensity: 0.75, roughness: 0.62, metalness: 0.05 });
    }
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(opts.w, opts.h), mat);
    this.mesh.userData.panel = this;
  }

  /** brilho da tela (iluminação da sala) */
  setScreenLevel(k: number): void {
    if (this.screenMat) this.screenMat.color.setScalar(k);
  }

  redraw(e: SimulationEngine, now: number, ui: RoomUiState, hover: string | null): void {
    const [W, H] = this.opts.px;
    const regions: HitRegion[] = [];
    const g = this.g;
    const k = this.opts.res ?? 1;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, W, H);
    if (this.gl) {
      this.gl.setTransform(k, 0, 0, k, 0, 0);
      this.gl.fillStyle = '#000';
      this.gl.fillRect(0, 0, W, H);
    }
    try {
      this.opts.draw({ g, glow: this.gl, W, H, e, now, ui, hit: (r) => regions.push(r), hover });
    } catch (ex) {
      g.fillStyle = '#300';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#f88';
      g.font = '20px monospace';
      g.fillText(String(ex).slice(0, 80), 10, 40);
    }
    this.regions = regions;
    this.tex.needsUpdate = true;
    if (this.glowTex) this.glowTex.needsUpdate = true;
    this.lastDraw = now;
    this.dirty = false;
  }

  /** região sob a coordenada de textura (uv do raio) */
  hitTest(uv: THREE.Vector2): HitRegion | null {
    const [W, H] = this.opts.px;
    const x = uv.x * W;
    const y = (1 - uv.y) * H;
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
  }

  dispose(): void {
    this.tex.dispose();
    this.glowTex?.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
