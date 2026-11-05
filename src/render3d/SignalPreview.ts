/**
 * PRÉVIA 3D DA TELA SINALIZAÇÃO & EMERGÊNCIA: o painel de controle (control_panel.glb) e o dispositivo selecionado
 * (cilindro de subida e o modelo da superfície; estrela com paraquedas; boia), com os GLBs reais da biblioteca.
 * Os indicadores do painel acompanham o lançador (PRONTO, ATIVO, FALHA, SINAL SELECIONADO, BOIA) e o botão da cor
 * selecionada acende. Cena pequena e leve: ≤ 30 quadros/s, parada quando a aba está oculta ou fora da tela.
 * Só lê o estado (nada aqui altera a simulação).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SignalColor, SignalKind } from '../sim/config/types';
import type { LauncherState } from '../sim/core/state';
import { SIGNAL_INFO } from '../sim/systems/signals';
import { PANEL_FILE, PARACHUTE_FILE, SignalInstance, ascentFile, flareFile, loadSignalAsset, surfaceFile } from './SignalVis';

export interface PreviewState {
  kind: SignalKind;
  color: SignalColor;
  launcher: LauncherState;
  /** algum dispositivo ativo / boia na água / falha */
  active: boolean;
  buoy: boolean;
  fault: boolean;
}

const BUTTON_OF: Partial<Record<SignalColor, string>> = { vermelho: 'BUTTON_RED', amarelo: 'BUTTON_YELLOW', verde: 'BUTTON_GREEN', branco: 'BUTTON_WHITE' };

export class SignalPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.05, 30);
  private controls: OrbitControls;
  private pmrem: THREE.PMREMGenerator;
  private stage = new THREE.Group();
  private turn = new THREE.Group();
  private panel: SignalInstance | null = null;
  private items: SignalInstance[] = [];
  private key = '';
  private st: PreviewState | null = null;
  private raf = 0;
  private last = 0;
  private clock = new THREE.Clock();
  private disposed = false;
  private visible = true;
  private ro: ResizeObserver;
  private io: IntersectionObserver | null = null;
  /** nomes dos arquivos que faltaram (a tela avisa) */
  missing: string[] = [];
  onMissing: ((files: string[]) => void) | null = null;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const c = this.renderer.domElement;
    c.style.display = 'block';
    c.style.width = '100%';
    c.style.height = '100%';
    host.appendChild(c);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.background = new THREE.Color(0x0c1a2b);
    this.scene.add(new THREE.HemisphereLight(0xdcefff, 0x1b2a3a, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 3, 3);
    this.scene.add(key);
    // piso de referência
    const grid = new THREE.GridHelper(4, 20, 0x2c4260, 0x1a2a3d);
    grid.position.y = -0.4;
    this.scene.add(grid, this.stage);
    this.stage.add(this.turn);
    this.camera.position.set(0.05, 0.12, 1.45);
    this.controls = new OrbitControls(this.camera, c);
    this.controls.target.set(0.0, -0.12, 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 6;
    this.controls.enablePan = false;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver((en) => (this.visible = en.some((x) => x.isIntersecting)));
      this.io.observe(host);
    }
    this.resize();
    loadSignalAsset(PANEL_FILE)
      .then((a) => {
        if (this.disposed) return;
        this.panel = new SignalInstance(PANEL_FILE, a);
        this.panel.root.position.set(-0.42, -0.14, -0.2);
        this.panel.root.rotation.y = 0.35;
        this.stage.add(this.panel.root);
        if (this.st) this.applyPanel(this.st);
      })
      .catch(() => this.miss(PANEL_FILE));
    this.loop();
  }

  private miss(f: string) {
    if (!this.missing.includes(f)) this.missing.push(f);
    this.onMissing?.(this.missing);
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** dispositivo e estado do lançador mostrados */
  set(st: PreviewState): void {
    this.st = st;
    const key = `${st.kind}|${st.color}`;
    if (key !== this.key) {
      this.key = key;
      for (const i of this.items) i.dispose();
      this.items = [];
      const eff = SIGNAL_INFO[st.kind].effect;
      const files = [...new Set([ascentFile(st.kind, st.color), surfaceFile(st.kind, st.color)])];
      if (eff === 'estrela') files.push(flareFile(st.color), PARACHUTE_FILE);
      const want = key;
      Promise.all(files.map((f) => loadSignalAsset(f).catch(() => (this.miss(f), null)))).then((as) => {
        if (this.disposed || this.key !== want) return;
        let x = 0;
        as.forEach((a, k) => {
          if (!a) return;
          const i = new SignalInstance(files[k], a);
          const f = files[k];
          if (f.startsWith('star_flare')) {
            i.root.position.set(0.55, 0.62, 0);
            i.root.scale.setScalar(0.9);
            i.play('FLARE_GLOW');
            i.setEmission(1, 2);
          } else if (f === PARACHUTE_FILE) {
            i.root.position.set(0.55, 0.62 + 0.31, 0);
            i.playAlso('PARACHUTE_OPEN', true);
            i.playAlso('PARACHUTE_SWAY');
          } else {
            i.root.position.set(x, 0, 0);
            x += 0.42;
            if (i.has('ACTIVE')) i.play('ACTIVE');
            else if (i.has('LIGHT_SMOKE_ACTIVE')) i.play('LIGHT_SMOKE_ACTIVE');
            else if (i.has('BUOY_IDLE')) {
              i.play('BUOY_IDLE');
              i.playAlso('BUOY_LIGHT_FLASH');
            }
            i.setEmission(1, 1.5);
          }
          this.turn.add(i.root);
          this.items.push(i);
        });
        // centra o conjunto no giro
        const box = new THREE.Box3().setFromObject(this.turn);
        const cx = (box.min.x + box.max.x) / 2;
        for (const i of this.items) i.root.position.x -= cx;
        this.turn.position.set(0.3, -0.4 - box.min.y, 0.12);
      });
    }
    this.applyPanel(st);
  }

  /** indicadores do painel conforme o lançador; botão da cor selecionada aceso */
  private applyPanel(st: PreviewState): void {
    const p = this.panel;
    if (!p) return;
    const lit = (name: string, on: boolean) => {
      p.node(name)?.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && 'emissiveIntensity' in m) m.emissiveIntensity = on ? 3 : 0.05;
      });
    };
    const blink = Math.floor(performance.now() / 400) % 2 === 0;
    lit('INDICATOR_READY', st.launcher === 'pronto' || (st.launcher === 'preparando' && blink));
    lit('INDICATOR_ACTIVE', st.active);
    lit('INDICATOR_FAULT', st.fault || st.launcher === 'falha');
    lit('INDICATOR_SIGNAL_SELECTED', st.launcher !== 'ocioso');
    lit('INDICATOR_BUOY_STATUS', st.buoy);
    for (const [c, n] of Object.entries(BUTTON_OF)) lit(n, st.launcher !== 'ocioso' && c === st.color && SIGNAL_INFO[st.kind].effect === 'luz');
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (document.hidden || !this.visible || this.host.clientWidth < 2 || now - this.last < 33) return;
    this.last = now;
    const dt = Math.min(0.1, this.clock.getDelta());
    this.turn.rotation.y += dt * 0.35;
    for (const i of this.items) i.update(dt);
    if (this.st) this.applyPanel(this.st);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io?.disconnect();
    for (const i of this.items) i.dispose();
    this.panel?.dispose();
    this.controls.dispose();
    this.scene.environment?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
