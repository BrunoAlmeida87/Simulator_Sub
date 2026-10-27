import * as THREE from 'three';
import type { Environment } from '../sim/environment/environment';
import { ambientStrength, BOTTOM_CELL, MAX_BOTTOM_ITEMS, sampleBottom, type AmbientSettings, type BottomItem } from './ambientMotion';

/** Fundo decorativo instanciado: rochas, esponjas e tufos rasos, sem colisão física. */
export class BottomLife {
  readonly group = new THREE.Group();
  private rocks: THREE.InstancedMesh;
  private sponges: THREE.InstancedMesh;
  private plants: THREE.InstancedMesh;
  private samples: BottomItem[] = [];
  private key = '';
  private environment: Environment | null = null;
  private pose = new THREE.Object3D();
  private color = new THREE.Color();
  private uniforms = { uAmbientTime: { value: 0 },
    uAmbientOrigin: { value: new THREE.Vector2() }, uAmbientStrength: { value: 0 }, uAmbientDirection: { value: new THREE.Vector2() } };

  constructor(private qualityScale = 1) {
    this.rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.98, color: 0xffffff }), MAX_BOTTOM_ITEMS);
    const tube = new THREE.CylinderGeometry(0.24, 0.36, 1, 7, 1, true);
    tube.translate(0, 0.5, 0);
    this.sponges = new THREE.InstancedMesh(tube, new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide }), MAX_BOTTOM_ITEMS);
    // Três fitas por tufo, raízes em y=0; deformação cresce até a ponta.
    const ribbon = new THREE.PlaneGeometry(0.3, 1, 1, 5);
    ribbon.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = `uniform float uAmbientTime; uniform vec2 uAmbientOrigin; uniform float uAmbientStrength; uniform vec2 uAmbientDirection;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float phase = (instanceMatrix[3].x + uAmbientOrigin.x)*0.019 + (instanceMatrix[3].z + uAmbientOrigin.y)*0.013;
        float sway = uAmbientStrength * (0.28 + 0.2*sin(uAmbientTime*0.42+phase));
        vec2 localDir = vec2(dot(uAmbientDirection, normalize(instanceMatrix[0].xz)), dot(uAmbientDirection, normalize(instanceMatrix[2].xz)));
        transformed.xz += localDir * position.y * position.y * sway;
      `,
      );
    };
    this.plants = new THREE.InstancedMesh(ribbon, mat, MAX_BOTTOM_ITEMS * 3);
    for (const mesh of [this.rocks, this.sponges, this.plants]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
    }
    this.group.name = 'Fundo vivo';
  }

  update(env: Environment, t: number, pn: number, pe: number, settings: AmbientSettings, visible: boolean): void {
    this.group.visible = visible && settings.bottomLifeDensity !== 'desligada';
    if (!this.group.visible) return;
    const key = `${Math.floor(pn / BOTTOM_CELL)},${Math.floor(pe / BOTTOM_CELL)},${settings.bottomLifeDensity},${JSON.stringify(env.cfg.bottom)},${JSON.stringify(env.cfg.geo)}`;
    if (key !== this.key || env !== this.environment) {
      this.key = key;
      this.environment = env;
      this.samples = sampleBottom((n, e) => env.bottomDepthAt(n, e), pn, pe, settings.bottomLifeDensity);
      if (this.qualityScale < 1) this.samples = this.samples.filter((_, i) => i % 2 === 0);
    }
    const a = (settings.currentDirection * Math.PI) / 180;
    this.uniforms.uAmbientTime.value = t;
    this.uniforms.uAmbientOrigin.value.set(pe, -pn);
    this.uniforms.uAmbientStrength.value = ambientStrength(settings);
    this.uniforms.uAmbientDirection.value.set(Math.sin(a), -Math.cos(a));
    let rocks = 0,
      sponges = 0,
      plants = 0;
    for (const p of this.samples) {
      // Some suavemente antes de trocar de célula; nunca aparece de repente ao lado da câmera.
      const fade = Math.max(0, Math.min(1, (75 - Math.hypot(p.n - pn, p.e - pe)) / 15));
      if (fade <= 0) continue;
      const scale = p.scale * fade;
      this.pose.position.set(p.e - pe, -p.depth, -(p.n - pn));
      this.pose.rotation.set(0, p.heading, 0);
      if (p.kind === 'rock') {
        this.pose.position.y += scale * 0.25;
        this.pose.scale.set(scale * 1.3, scale * 0.65, scale);
        this.color.setHSL(0.09 + p.tint * 0.04, 0.1, 0.2 + p.tint * 0.14);
        this.pose.updateMatrix();
        this.rocks.setMatrixAt(rocks, this.pose.matrix);
        this.rocks.setColorAt(rocks++, this.color);
      } else if (p.kind === 'sponge') {
        this.pose.scale.set(scale, scale, scale);
        this.color.setHSL(0.05 + p.tint * 0.08, 0.28, 0.24 + p.tint * 0.12);
        this.pose.updateMatrix();
        this.sponges.setMatrixAt(sponges, this.pose.matrix);
        this.sponges.setColorAt(sponges++, this.color);
      } else {
        this.color.setHSL(0.22 + p.tint * 0.08, 0.35, 0.18 + p.tint * 0.1);
        for (let blade = 0; blade < 3; blade++) {
          this.pose.rotation.y = p.heading + (blade * Math.PI) / 3;
          this.pose.scale.set(scale, scale * (0.75 + blade * 0.15), scale);
          this.pose.updateMatrix();
          this.plants.setMatrixAt(plants, this.pose.matrix);
          this.plants.setColorAt(plants++, this.color);
        }
      }
    }
    this.rocks.count = rocks;
    this.sponges.count = sponges;
    this.plants.count = plants;
    for (const mesh of [this.rocks, this.sponges, this.plants]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  dispose(): void {
    for (const mesh of [this.rocks, this.sponges, this.plants]) {
      mesh.dispose();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.group.clear();
    this.group.removeFromParent();
  }
}
