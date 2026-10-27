import * as THREE from 'three';
import type { Environment } from '../sim/environment/environment';
import { suspensionParticle, type AmbientSettings } from './ambientMotion';

export class AmbientParticles {
  readonly points: THREE.Points;
  private pos: THREE.BufferAttribute;
  private sizes: THREE.BufferAttribute;
  private alpha: THREE.BufferAttribute;
  private material: THREE.ShaderMaterial;
  constructor(private count: number) {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3);
    this.sizes = new THREE.Float32BufferAttribute(new Float32Array(count), 1);
    this.alpha = new THREE.Float32BufferAttribute(new Float32Array(count), 1);
    g.setAttribute('position', this.pos);
    g.setAttribute('aSize', this.sizes);
    g.setAttribute('aAlpha', this.alpha);
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 400 }, uLight: { value: 1 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vAlpha;
        void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv;
        gl_PointSize=clamp(aSize*uScale/max(1.0,-mv.z),1.0,10.0); vAlpha=aAlpha; }`,
      fragmentShader: `varying float vAlpha; uniform float uLight;
        void main(){ vec2 p=(gl_PointCoord-0.5)*2.0; float r=length(p); if(r>1.0) discard;
        gl_FragColor=vec4(vec3(0.68,0.81,0.82)*uLight, vAlpha*pow(1.0-r*r,2.0)); }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
  }
  setLight(value: number): void {
    this.material.uniforms.uLight.value = value;
  }
  update(env: Environment, t: number, pn: number, pe: number, pd: number, scale: number, settings: AmbientSettings): void {
    this.material.uniforms.uScale.value = scale;
    // Limita consultas do relevo: compartilha amostras em células de 8 m.
    const beds = new Map<string, number>();
    for (let i = 0; i < this.count; i++) {
      const p = suspensionParticle(i, t, pn, pe, pd, settings);
      const key = `${Math.floor(p.n / 8)},${Math.floor(p.e / 8)}`;
      let bed = beds.get(key);
      if (bed === undefined) {
        bed = env.bottomDepthAt(p.n, p.e);
        beds.set(key, bed);
      }
      // Usa o relevo exato perto do fundo para não atravessar rampas/costas.
      if (Math.abs(bed - p.d) < 8) bed = env.bottomDepthAt(p.n, p.e);
      const waterFade = Math.max(0, Math.min(1, (p.d + env.waves.elevation(p.n, p.e, t) - 0.5) / 2, (bed - p.d - 0.2) / 2));
      this.pos.setXYZ(i, p.e - pe, -p.d, -(p.n - pn));
      this.sizes.setX(i, p.size);
      this.alpha.setX(i, p.alpha * p.fade * waterFade);
    }
    this.pos.needsUpdate = this.sizes.needsUpdate = this.alpha.needsUpdate = true;
  }
}
