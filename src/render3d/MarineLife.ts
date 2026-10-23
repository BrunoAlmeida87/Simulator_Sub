/** Peixes leves: geometrias compartilhadas, cinco chamadas de desenho no total. */
import * as THREE from 'three';
import type { Environment } from '../sim/environment/environment';
import { DEFAULT_MARINE_LIFE, MAX_FISH, sampleMarineLife, type FishPose, type MarineLifeSettings } from './marineLifeMotion';

function finGeometry(tail: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tail ? [0, 0, 0, -0.3, 0.24, 0, -0.24, 0, 0, 0, 0, 0, -0.24, 0, 0, -0.3, -0.24, 0] : [0.15, 0.13, 0, -0.1, 0.36, 0, -0.23, 0.12, 0], 3));
  g.computeVertexNormals();
  return g;
}

export class MarineLife {
  readonly group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private tail: THREE.InstancedMesh;
  private fin: THREE.InstancedMesh;
  private eyes: THREE.InstancedMesh;
  private belly: THREE.InstancedMesh;
  private pose = new THREE.Object3D();
  private part = new THREE.Object3D();
  private matrix = new THREE.Matrix4();
  private color = new THREE.Color();
  private samples: FishPose[] = [];
  settings: MarineLifeSettings = { ...DEFAULT_MARINE_LIFE };

  constructor() {
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3 });
    const finMat = new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide });
    this.body = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6), bodyMat, MAX_FISH);
    this.tail = new THREE.InstancedMesh(finGeometry(true), finMat, MAX_FISH);
    this.fin = new THREE.InstancedMesh(finGeometry(false), finMat, MAX_FISH);
    this.belly = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 5), new THREE.MeshStandardMaterial({ color: 0xd9e5df, roughness: 0.55 }), MAX_FISH);
    this.eyes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshStandardMaterial({ color: 0x0a151c, roughness: 0.2 }), MAX_FISH * 2);
    this.group.name = 'Vida marinha';
    for (const mesh of [this.body, this.tail, this.fin, this.belly, this.eyes]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
    }
  }

  private place(mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0): void {
    this.part.position.set(x, y, z);
    this.part.rotation.set(0, yaw, 0);
    this.part.scale.set(sx, sy, sz);
    this.part.updateMatrix();
    this.matrix.multiplyMatrices(this.pose.matrix, this.part.matrix);
    mesh.setMatrixAt(index, this.matrix);
  }

  update(env: Environment, t: number, pn: number, pe: number, visible: boolean): void {
    this.group.visible = visible && this.settings.fishDensity !== 'desligada' && (this.settings.fishJumps || this.settings.fishUnderwater);
    if (!this.group.visible) return;
    sampleMarineLife(env, t, pn, pe, this.settings, this.samples);
    this.samples.forEach((f, i) => {
      this.pose.position.set(f.e - pe, f.y, -(f.n - pn));
      // O modelo aponta para +X; yaw transforma esse eixo em rumo NED.
      this.pose.rotation.set(0, Math.PI / 2 - f.heading, f.pitch, 'YXZ');
      this.pose.scale.setScalar(f.length);
      this.pose.updateMatrix();
      this.place(this.body, i, 0, 0, 0, 0.48, 0.16, 0.11);
      this.place(this.belly, i, 0.025, -0.065, 0, 0.39, 0.105, 0.105);
      this.place(this.tail, i, -0.4, 0, 0, 1, 1, 1, Math.sin(f.phase) * 0.45);
      this.place(this.fin, i, 0, 0, 0, 1, 1, 1);
      this.place(this.eyes, i * 2, 0.31, 0.045, 0.081, 0.024, 0.024, 0.024);
      this.place(this.eyes, i * 2 + 1, 0.31, 0.045, -0.081, 0.024, 0.024, 0.024);
      this.color.setHSL(0.47 + f.tint * 0.16, 0.18 + f.tint * 0.25, 0.4 + f.tint * 0.17);
      this.body.setColorAt(i, this.color);
      this.color.multiplyScalar(0.7);
      this.tail.setColorAt(i, this.color);
      this.fin.setColorAt(i, this.color);
    });
    for (const mesh of [this.body, this.tail, this.fin, this.belly, this.eyes]) {
      mesh.count = this.samples.length * (mesh === this.eyes ? 2 : 1);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    const materials = new Set<THREE.Material>();
    for (const mesh of [this.body, this.tail, this.fin, this.belly, this.eyes]) {
      mesh.dispose();
      mesh.geometry.dispose();
      materials.add(mesh.material as THREE.Material);
    }
    materials.forEach((m) => m.dispose());
    this.group.clear();
    this.group.removeFromParent();
  }
}
