import * as THREE from 'three';
import type { SimulationEngine } from '../sim/core/engine';
import { qToMat3 } from '../sim/core/math';
import { sedimentIntensity } from './underwaterFxModel';
import { cavitationSamples } from '../sim/systems/cavitation';

interface Particle {
  n: number;
  e: number;
  d: number;
  vn: number;
  ve: number;
  vd: number;
  age: number;
  life: number;
  size: number;
  alpha: number;
  sediment: boolean;
}

/** Partículas no mundo (origem flutuante); envelhecem somente em tempo simulado. */
export class UnderwaterFx {
  readonly group = new THREE.Group();
  private particles: Particle[] = [];
  private pos: THREE.BufferAttribute;
  private size: THREE.BufferAttribute;
  private opacity: THREE.BufferAttribute;
  private kind: THREE.BufferAttribute;
  private mat: THREE.ShaderMaterial;
  private points: THREE.Points;
  private capacity: number;
  private engine: SimulationEngine | null = null;
  private lastTime = -1;
  private cavCarry = 0;
  private sandCarry = [0, 0, 0, 0];
  private contacts = [false, false, false, false];

  constructor(scale = 1) {
    this.capacity = Math.round(2600 * scale);
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.Float32BufferAttribute(new Float32Array(this.capacity * 3), 3);
    this.size = new THREE.Float32BufferAttribute(new Float32Array(this.capacity), 1);
    this.opacity = new THREE.Float32BufferAttribute(new Float32Array(this.capacity), 1);
    this.kind = new THREE.Float32BufferAttribute(new Float32Array(this.capacity), 1);
    g.setAttribute('position', this.pos);
    g.setAttribute('aSize', this.size);
    g.setAttribute('aAlpha', this.opacity);
    g.setAttribute('aKind', this.kind);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 400 } },
      vertexShader: `
        attribute float aSize; attribute float aAlpha; attribute float aKind;
        uniform float uScale; varying float alpha; varying float kind;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uScale / max(1.0, -mv.z), 1.0, 110.0);
          alpha = aAlpha; kind = aKind;
        }`,
      fragmentShader: `
        varying float alpha; varying float kind;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          if (r > 1.0) discard;
          float cloud = pow(1.0 - r*r, 2.0);
          float bubble = 0.25 * cloud + 0.65 * exp(-pow((r - 0.65) * 7.0, 2.0));
          vec3 color = mix(vec3(0.78, 0.92, 0.96), vec3(0.64, 0.53, 0.35), kind);
          gl_FragColor = vec4(color, alpha * mix(bubble, cloud, kind));
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.group.add(this.points);
  }

  reset(): void {
    this.particles.length = 0;
    this.cavCarry = 0;
    this.sandCarry.fill(0);
    this.contacts.fill(false);
    this.points.geometry.setDrawRange(0, 0);
  }

  update(e: SimulationEngine, dt: number, pn: number, pe: number, t: number, pixelScale: number, enabled: boolean): void {
    const replaced = this.engine !== e || e.state.t < this.lastTime;
    if (replaced) this.reset();
    dt = replaced ? 0 : Math.max(0, e.state.t - this.lastTime);
    this.engine = e;
    this.lastTime = e.state.t;
    this.group.visible = enabled;
    this.mat.uniforms.uScale.value = pixelScale;
    // Subpassos limitados para aceleração temporal, sem emissão em pausa.
    const steps = Math.min(60, Math.ceil(dt / 0.04));
    for (let i = 0; i < steps; i++) this.advance(e, dt / steps, t, enabled);
    this.particles.forEach((p, i) => {
      const age = p.age / p.life;
      this.pos.setXYZ(i, p.e - pe, -p.d, -(p.n - pn));
      this.kind.setX(i, p.sediment ? 1 : 0);
      this.size.setX(i, p.sediment ? p.size + p.age * 0.24 : p.size * (1 - 0.55 * age));
      this.opacity.setX(i, p.alpha * Math.min(1, p.age * (p.sediment ? 5 : 35)) * (1 - age) ** 1.4);
    });
    this.pos.needsUpdate = this.kind.needsUpdate = this.size.needsUpdate = this.opacity.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.particles.length);
  }

  private advance(e: SimulationEngine, dt: number, t: number, enabled: boolean): void {
    const s = e.state;
    const R = qToMat3(s.body.quat);
    const world = (x: number, y: number, z: number) => ({
      n: s.body.pos.x + R[0] * x + R[1] * y + R[2] * z,
      e: s.body.pos.y + R[3] * x + R[4] * y + R[5] * z,
      d: s.body.pos.z + R[6] * x + R[7] * y + R[8] * z,
    });
    const rnd = () => Math.random() - 0.5;
    const prop = e.vessel.propulsion.propeller;
    const radius = prop.diameter / 2;
    const propX = -e.vessel.hull.length / 2 - 0.8;
    const rho = e.env.densityAt(s.body.pos.z);
    const jet = Math.sign(s.propulsion.thrust) * Math.sqrt(Math.abs(s.propulsion.thrust) / (rho * Math.PI * radius ** 2));
    const u = s.body.vel.x;
    const velocity = {
      n: R[0] * u + R[1] * s.body.vel.y + R[2] * s.body.vel.z,
      e: R[3] * u + R[4] * s.body.vel.y + R[5] * s.body.vel.z,
      d: R[6] * u + R[7] * s.body.vel.y + R[8] * s.body.vel.z,
    };
    this.particles = this.particles.filter((p) => {
      p.age += dt;
      if (p.age >= p.life) return false;
      const drag = Math.exp(-(p.sediment ? 0.65 : 0.3) * dt);
      p.vn *= drag;
      p.ve *= drag;
      // Sedimento: subida inicial pelo escoamento, depois queda com velocidade terminal.
      p.vd = p.sediment ? 0.14 + (p.vd - 0.14) * Math.exp(-0.8 * dt) : p.vd;
      p.n += p.vn * dt;
      p.e += p.ve * dt;
      p.d += p.vd * dt;
      return p.d > -e.env.waves.elevation(p.n, p.e, t) && p.d < e.env.bottomDepthAt(p.n, p.e);
    });
    if (!enabled) return;
    const add = (p: Particle) => {
      if (this.particles.length < this.capacity) this.particles.push(p);
    };
    // Amostra as pás: pressão local incorpora profundidade, ondas e atitude.
    for (const p of cavitationSamples(e.vessel, s, e.env, t)) {
      const k = p.intensity;
      this.cavCarry += (k * 650 * dt) / prop.blades;
      while (this.cavCarry >= 1) {
        this.cavCarry--;
        const axial = u * 0.7 - jet * 1.8;
        add({
          ...p,
          n: p.n + rnd() * 0.3,
          e: p.e + rnd() * 0.3,
          vn: R[0] * axial + rnd() * 0.35,
          ve: R[3] * axial + rnd() * 0.35,
          vd: R[6] * axial + rnd() * 0.2,
          age: 0,
          life: 0.18 + Math.random() * 0.4,
          size: 0.08 + Math.random() * 0.18,
          alpha: 0.85,
          sediment: false,
        });
      }
    }
    // Mesmos três pontos da quilha usados pelo contato físico + disco da hélice.
    const xs = [e.vessel.hull.length * 0.36, 0, -e.vessel.hull.length * 0.36, propX];
    xs.forEach((x, i) => {
      const z = i === 3 ? radius : e.geom.radiusAt(x);
      const p = world(x, 0, z);
      const bottom = e.env.bottomDepthAt(p.n, p.e);
      if (bottom <= 0) return;
      const clearance = bottom - p.d;
      const contact = clearance <= 0.15;
      const k = sedimentIntensity(clearance, Math.hypot(velocity.n, velocity.e), i === 3 ? jet : 0, velocity.d);
      // Um pulso no primeiro toque; parado no fundo a emissão contínua cessa.
      if (contact && !this.contacts[i]) this.sandCarry[i] += 75;
      this.contacts[i] = contact;
      this.sandCarry[i] += k * 45 * dt;
      while (this.sandCarry[i] >= 1) {
        this.sandCarry[i]--;
        const side = Math.random() < 0.5 ? -1 : 1;
        const spread = side * (1 + Math.random() * 1.5);
        const lateral = side * (contact ? 3.5 : 1.2);
        const n = p.n + R[1] * spread + rnd() * 2,
          east = p.e + R[4] * spread + rnd() * 2;
        const bed = e.env.bottomDepthAt(n, east);
        if (bed <= 0) continue;
        add({
          n,
          e: east,
          d: bed - 0.12,
          vn: R[1] * lateral + velocity.n * 0.18 - (i === 3 ? R[0] * jet * 0.7 : 0) + rnd() * 1.5,
          ve: R[4] * lateral + velocity.e * 0.18 - (i === 3 ? R[3] * jet * 0.7 : 0) + rnd() * 1.5,
          vd: -(0.5 + k * 1.4 + Math.random() * 0.7),
          age: 0,
          life: 7 + Math.random() * 9,
          size: 1.1 + Math.random() * 2.2,
          alpha: (contact ? 0.36 : 0.22) + k * 0.25,
          sediment: true,
        });
      }
    });
  }
}
