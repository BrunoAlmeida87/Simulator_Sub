import * as THREE from 'three';
/** Illustrative spherical envelope, independent of the ray-based detection model. */
export class PulseShell extends THREE.Group {
  private materials: THREE.ShaderMaterial[] = [];
  constructor(color: number) {
    super();
    const material = (alpha: number, rim: boolean) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { tint: { value: new THREE.Color(color) }, alpha: { value: alpha }, strength: { value: 1 }, top: { value: 0 }, bottom: { value: -1e6 } },
        vertexShader:
          'varying vec3 normalView; varying vec3 viewDir; varying float height; void main(){vec4 world=modelMatrix*vec4(position,1.); height=world.y; vec4 mv=viewMatrix*world; normalView=normalize(normalMatrix*normal); viewDir=normalize(-mv.xyz); gl_Position=projectionMatrix*mv;}',
        fragmentShader: `uniform vec3 tint; uniform float alpha; uniform float strength; uniform float top; uniform float bottom; varying vec3 normalView; varying vec3 viewDir; varying float height; void main(){if(height>top||height<bottom)discard; float rim=${rim ? 'pow(1.-abs(dot(normalize(normalView),normalize(viewDir))),2.)' : '1.'}; gl_FragColor=vec4(tint,alpha*strength*${rim ? '(.05+rim*.95)' : 'rim'});}`,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(m);
      return m;
    };
    this.add(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), material(0.32, true)));
    const vertices: number[] = [];
    const arc = (fn: (t: number) => number[]) => {
      for (let i = 0; i < 96; i++) vertices.push(...fn((i / 96) * Math.PI * 2), ...fn(((i + 1) / 96) * Math.PI * 2));
    };
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 8;
      arc((t) => [Math.cos(t) * Math.cos(a), Math.sin(t), Math.cos(t) * Math.sin(a)]);
    }
    for (let i = -3; i <= 3; i++) {
      const a = (i * Math.PI) / 8;
      arc((t) => [Math.cos(a) * Math.cos(t), Math.sin(a), Math.cos(a) * Math.sin(t)]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.add(new THREE.LineSegments(g, material(0.55, false)));
    this.visible = false;
  }
  setPulse(radius: number, strength: number, top = 0, bottom = -1e6) {
    this.visible = radius > 0.001 && strength > 0.001;
    this.scale.setScalar(Math.max(0.001, radius));
    for (const m of this.materials) {
      m.uniforms.strength.value = strength;
      m.uniforms.top.value = top;
      m.uniforms.bottom.value = bottom;
    }
  }
  dispose() {
    this.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
    });
    this.materials.forEach((m) => m.dispose());
  }
}
