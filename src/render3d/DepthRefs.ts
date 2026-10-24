/**
 * REFERÊNCIAS DISCRETAS DE PROFUNDIDADE (só visual, lidas do estado):
 *  - faixas finas de partículas em suspensão em cotas fixas (a cada 20 m),
 *    paradas no mundo: ao subir ou descer, o submarino as atravessa, o que
 *    dá a noção da variação de profundidade sem linhas nem números;
 *  - sombra suave no fundo, sob o submarino, que fica mais nítida e escura
 *    quanto menor a altitude (distância ao fundo simulado), alinhada ao
 *    declive local do fundo.
 * Ligadas/desligadas em Configurações → Gráficos.
 */
import * as THREE from 'three';
import type { Environment } from '../sim/environment/environment';
import { rand } from './visualTest';

const SPACING = 20; // m entre faixas
const FIRST = 10; // m (primeira faixa)
const SLOTS = 8; // faixas desenhadas em torno da cota atual
const PER = 420; // partículas por faixa
const BOX = 120; // m (caixa horizontal em volta do submarino)

export class DepthRefs {
  readonly group = new THREE.Group();
  private bands: THREE.Points;
  private base: Float32Array;
  private shadow: THREE.Mesh;
  private shadowMat: THREE.MeshBasicMaterial;

  constructor(dot: THREE.Texture | null) {
    this.group.name = 'Referências de profundidade';
    this.base = new Float32Array(SLOTS * PER * 3);
    for (let i = 0; i < SLOTS * PER; i++) {
      this.base[i * 3] = rand() * BOX;
      this.base[i * 3 + 1] = rand() * BOX;
      this.base[i * 3 + 2] = (rand() - 0.5) * 1.2; // espessura da faixa (m)
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SLOTS * PER * 3), 3));
    this.bands = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd8f0e2, size: 0.42, transparent: true, opacity: 0.5, depthWrite: false, map: dot ?? undefined }));
    this.bands.frustumCulled = false;
    this.group.add(this.bands);
    // sombra: elipse de borda suave (textura circular esticada)
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false, map: dot ?? undefined, polygonOffset: true, polygonOffsetFactor: -2 });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.shadowMat);
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);
  }

  /**
   * @param pn,pe posição horizontal do submarino (m, NED); a cena é centrada nela
   * @param pd profundidade do eixo (m); heading rumo (rad); length/beam do casco (m)
   */
  update(env: Environment, pn: number, pe: number, pd: number, heading: number, length: number, beam: number, enabled: boolean): void {
    this.group.visible = enabled && pd > 2;
    if (!this.group.visible) return;
    const bottom = env.bottomDepthAt(pn, pe);
    // faixas: as SLOTS cotas fixas mais próximas da cota atual, abaixo da superfície e acima do fundo
    const k0 = Math.round((pd - FIRST) / SPACING) - SLOTS / 2;
    const pos = this.bands.geometry.getAttribute('position') as THREE.BufferAttribute;
    const mod = (a: number, m: number) => ((a % m) + m) % m;
    for (let s = 0; s < SLOTS; s++) {
      const k = k0 + s;
      const depth = FIRST + k * SPACING;
      const ok = k >= 0 && depth > 3 && depth < bottom - 1.5;
      for (let i = 0; i < PER; i++) {
        const j = s * PER + i;
        if (!ok) {
          pos.setXYZ(j, 0, -1e6, 0);
          continue;
        }
        // posições fixas no mundo (cada faixa com sua semente: deslocamento por k)
        const rn = mod(this.base[j * 3] + k * 37.1 - pn, BOX) - BOX / 2;
        const re = mod(this.base[j * 3 + 1] + k * 53.7 - pe, BOX) - BOX / 2;
        pos.setXYZ(j, re, -(depth + this.base[j * 3 + 2]), -rn);
      }
    }
    pos.needsUpdate = true;
    // sombra no fundo: mais escura e definida perto do fundo; some acima de ~80 m de altitude
    const alt = bottom - pd;
    const f = Math.max(0, Math.min(1, 1 - (alt - 4) / 76));
    this.shadow.visible = Number.isFinite(bottom) && bottom > 0 && f > 0.01;
    if (!this.shadow.visible) return;
    this.shadowMat.opacity = 0.5 * f * f;
    const spread = 1 + Math.max(0, alt) / 25; // penumbra cresce com a altitude
    // declive local do fundo (diferenças finitas) para deitar a sombra sobre ele
    const h = 4;
    const dN = (env.bottomDepthAt(pn + h, pe) - env.bottomDepthAt(pn - h, pe)) / (2 * h);
    const dE = (env.bottomDepthAt(pn, pe + h) - env.bottomDepthAt(pn, pe - h)) / (2 * h);
    // normal em coordenadas da cena (x = leste, y = cima, z = −norte); y = −profundidade
    const nrm = new THREE.Vector3(dE, 1, -dN).normalize();
    this.shadow.position.set(0, -bottom + 0.25, 0);
    this.shadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
    // eixo maior ao longo do rumo
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -heading);
    this.shadow.quaternion.multiply(q);
    this.shadow.scale.set(beam * 1.6 * spread, length * 1.15 * spread, 1);
  }

  dispose(): void {
    this.bands.geometry.dispose();
    (this.bands.material as THREE.Material).dispose();
    this.shadow.geometry.dispose();
    this.shadowMat.dispose();
  }
}
