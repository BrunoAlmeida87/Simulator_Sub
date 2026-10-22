/**
 * LINHAS DE PROFUNDIDADE (só visual): a cada 25 m, um anel horizontal bem
 * leve em volta da câmera, fixo na cota, com o rótulo da profundidade
 * ("25 m", "50 m"…), da primeira cota até o fundo simulado sob a câmera.
 * Olhando na horizontal, cada anel aparece como uma linha suave atravessando
 * a vista; ao subir ou descer, as linhas passam pela câmera e pelo submarino.
 * O anel acompanha a câmera na horizontal, por isso sempre a envolve.
 * Camada "Linhas de profundidade" (layers.depthLines).
 */
import * as THREE from 'three';
import type { Environment } from '../sim/environment/environment';

export const DEPTH_LINE_SPACING = 25; // m
const RADIUS = 180; // m (raio do anel em volta da câmera)
const SEGMENTS = 160;
const LABELS_PER_RING = 4;
const MAX_LEVELS = 160; // até 4 000 m

interface Level {
  ring: THREE.LineLoop;
  labels: THREE.Sprite[];
}

function labelTexture(text: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  g.font = '600 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(4, 20, 34, 0.55)';
  g.strokeText(text, 128, 34);
  g.fillStyle = 'rgba(214, 238, 255, 0.95)';
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class DepthLines {
  readonly group = new THREE.Group();
  private levels: Level[] = [];
  private ringGeo: THREE.BufferGeometry;
  private lineMat = new THREE.LineBasicMaterial({ color: 0xc4e6ff, transparent: true, opacity: 0.28, depthWrite: false });

  constructor() {
    this.group.name = 'Linhas de profundidade';
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.sin(a), 0, Math.cos(a)));
    }
    this.ringGeo = new THREE.BufferGeometry().setFromPoints(pts);
  }

  private level(k: number): Level {
    while (this.levels.length <= k) {
      const depth = (this.levels.length + 1) * DEPTH_LINE_SPACING;
      const ring = new THREE.LineLoop(this.ringGeo, this.lineMat);
      ring.frustumCulled = false;
      ring.scale.setScalar(RADIUS);
      this.group.add(ring);
      const tex = labelTexture(`${depth} m`);
      const labels: THREE.Sprite[] = [];
      if (tex) {
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.75, depthWrite: false, sizeAttenuation: false });
        for (let j = 0; j < LABELS_PER_RING; j++) {
          const s = new THREE.Sprite(mat);
          s.scale.set(0.11, 0.0275, 1);
          s.center.set(0.5, 0);
          this.group.add(s);
          labels.push(s);
        }
      }
      this.levels.push({ ring, labels });
    }
    return this.levels[k];
  }

  /**
   * @param pn,pe posição horizontal do submarino (m, NED): a cena é centrada nela
   * @param cam posição da câmera na cena (x = leste, y = cima, z = −norte)
   */
  update(env: Environment, pn: number, pe: number, cam: THREE.Vector3, enabled: boolean): void {
    this.group.visible = enabled;
    if (!enabled) return;
    const bottom = env.bottomDepthAt(pn - cam.z, pe + cam.x);
    const n = Math.max(0, Math.min(MAX_LEVELS, Number.isFinite(bottom) ? Math.floor((bottom - 0.5) / DEPTH_LINE_SPACING) : 0));
    for (let k = 0; k < Math.max(n, this.levels.length); k++) {
      const on = k < n;
      if (!on) {
        const L = this.levels[k];
        L.ring.visible = false;
        for (const s of L.labels) s.visible = false;
        continue;
      }
      const L = this.level(k);
      const y = -(k + 1) * DEPTH_LINE_SPACING;
      L.ring.visible = true;
      L.ring.position.set(cam.x, y, cam.z);
      L.labels.forEach((s, j) => {
        // rótulos defasados entre cotas para não ficarem empilhados
        const a = ((j + (k % 2) * 0.5) / LABELS_PER_RING) * Math.PI * 2 + 0.35;
        s.visible = true;
        s.position.set(cam.x + RADIUS * Math.sin(a), y + 0.4, cam.z + RADIUS * Math.cos(a));
      });
    }
  }

  dispose(): void {
    this.ringGeo.dispose();
    this.lineMat.dispose();
    for (const L of this.levels)
      for (const s of L.labels.slice(0, 1)) {
        s.material.map?.dispose();
        s.material.dispose();
      }
  }
}
