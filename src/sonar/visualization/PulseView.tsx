import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { runner } from '../../ui/store';
import { clamp, type Ping } from '../types';
import { PulseShell } from './PulseShell';
import { loadSubModel, subModelUrl } from '../../render3d/subModel';
interface Props {
  age: number;
  linesOnly: boolean;
  resetKey: number;
}
/** Presentation of the current engine ping; no independent physics or fabricated contacts. */
export function PulseView(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    opts = useRef(props);
  opts.current = props;
  const [error, setError] = useState('');
  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    let disposed = false;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setError('Visualização 3D indisponível neste navegador. TMA e cascata continuam disponíveis.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x061b2b);
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', 'Pulso do sonar em três dimensões');
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x061b2b, 0.025);
    const camera = new THREE.PerspectiveCamera(43, 1, 0.05, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 5;
    controls.maxDistance = 35;
    controls.maxPolarAngle = Math.PI * 0.88;
    const reset = () => {
      camera.position.set(7, -0.35, 12);
      controls.target.set(0.5, -1.6, 0);
      controls.update();
    };
    reset();
    scene.add(new THREE.HemisphereLight(0x99e5ff, 0x102631, 2));
    const sun = new THREE.DirectionalLight(0x8ce3ff, 3);
    sun.position.set(-4, 9, 4);
    scene.add(sun);
    const root = new THREE.Group();
    scene.add(root);
    const material = new THREE.MeshStandardMaterial({ color: 0x46707c, roughness: 0.8, metalness: 0.2 });
    const sub = new THREE.Group(),
      hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 1.05, 8, 20), material);
    hull.rotation.z = Math.PI / 2;
    sub.add(hull);
    const sail = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.11), material);
    sail.position.set(0.06, 0.19, 0);
    sub.add(sail);
    for (const x of [-0.5, 0.35]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.035, 0.62), material);
      fin.position.x = x;
      sub.add(fin);
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: 0x93ffff }));
    lamp.position.x = 0.69;
    sub.add(lamp);
    scene.add(sub);
    void loadSubModel(subModelUrl('leve'), renderer)
      .then((source) => {
        if (disposed) return;
        const model = source.clone(true);
        model.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry = o.geometry.clone();
            const copy = (m: THREE.Material) => {
              const c = m.clone();
              if (c instanceof THREE.MeshStandardMaterial) {
                c.color.lerp(new THREE.Color(0x87b9ce), 0.65);
                c.emissive.set(0x153d50);
              }
              return c;
            };
            o.material = Array.isArray(o.material) ? o.material.map(copy) : copy(o.material);
          }
        });
        const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
        model.scale.setScalar(2.1 / Math.max(size.x, size.y, size.z));
        model.rotation.y = -Math.PI / 2;
        sub.children.forEach((o) => {
          o.visible = false;
        });
        sub.add(model);
      })
      .catch(() => {
        /* geometric fallback remains visible */
      });
    const pulse = new PulseShell(0x3ce7ff),
      tail = new PulseShell(0x36bedf);
    root.add(pulse, tail);
    const echoes = Array.from({ length: 12 }, () => {
      const p = new PulseShell(0xffba59);
      root.add(p);
      return p;
    });
    const reflectors = Array.from({ length: 12 }, () => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd685, transparent: true }));
      scene.add(m);
      m.visible = false;
      return m;
    });
    const floorGeometry = new THREE.PlaneGeometry(50, 50, 40, 40);
    floorGeometry.rotateX(-Math.PI / 2);
    const sandCanvas = document.createElement('canvas');
    sandCanvas.width = sandCanvas.height = 256;
    const sand = sandCanvas.getContext('2d')!;
    sand.fillStyle = '#24424a';
    sand.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 7000; i++) {
      const x = ((((Math.sin(i * 91.17) * 43758.54) % 1) + 1) % 1) * 256,
        y = ((((Math.cos(i * 31.7) * 19471.37) % 1) + 1) % 1) * 256;
      sand.fillStyle = i % 3 ? '#102b3338' : '#75a6b41f';
      sand.fillRect(x, y, 1 + (i % 4), 1 + (i % 3));
    }
    const sandTexture = new THREE.CanvasTexture(sandCanvas);
    sandTexture.wrapS = sandTexture.wrapT = THREE.RepeatWrapping;
    sandTexture.repeat.set(8, 8);
    const floor = new THREE.Mesh(floorGeometry, new THREE.MeshStandardMaterial({ map: sandTexture, color: 0x345563, roughness: 0.96, side: THREE.DoubleSide }));
    scene.add(floor);
    const grid = new THREE.GridHelper(22, 22, 0x245667, 0x173d50);
    grid.position.y = -4.4;
    scene.add(grid);
    const surfaceGeometry = new THREE.PlaneGeometry(80, 80, 32, 32);
    surfaceGeometry.rotateX(-Math.PI / 2);
    const surfaceMaterial = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 water; void main(){water=position.xz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform float time; varying vec2 water; void main(){float a=sin(water.x*1.8+sin(water.y*.7)+time*.3)*sin(water.y*1.3+time*.2); float b=pow(abs(a),8.); gl_FragColor=vec4(vec3(.06,.20,.29)+b*vec3(.12,.24,.29),.55);}'
    });
    const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
    scene.add(surface);
    const particles = new THREE.BufferGeometry(),
      positions = new Float32Array(260 * 3);
    for (let i = 0; i < 260; i++) {
      positions[i * 3] = Math.sin(i * 78.23) * 11;
      positions[i * 3 + 1] = -0.1 - ((i % 37) / 37) * 4.5;
      positions[i * 3 + 2] = Math.cos(i * 33.17) * 9;
    }
    particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const dust = new THREE.Points(particles, new THREE.PointsMaterial({ color: 0x56aec1, size: 0.025, transparent: true, opacity: 0.38 }));
    scene.add(dust);
    let snapshot: Ping | null | undefined,
      engine = runner.engine,
      oldKey = props.resetKey,
      oldRange = -1,
      oldHeading = -1,
      frame = 0;
    let horizontal = 0.001,
      vertical = 0.01,
      bearing = 0,
      originDepth = 30;
    const floors = floorGeometry.attributes.position;
    function rebuild(ping: Ping | null) {
      const e = runner.engine,
        own = ping?.propagation.origin ?? { n: e.state.body.pos.x, e: e.state.body.pos.y, depth: Math.max(0.5, e.state.body.pos.z) };
      const range = ping?.propagation.range ?? e.state.sonar!.settings.range;
      bearing = ((ping?.propagation.bearing ?? e.state.sonar!.settings.section) * Math.PI) / 180;
      horizontal = 7 / range;
      const depth = Math.max(80, ...Array.from({ length: 8 }, (_, i) => e.env.bottomDepthAt(own.n + (Math.cos(bearing) * range * i) / 7, own.e + (Math.sin(bearing) * range * i) / 7)));
      vertical = 4.5 / depth;
      originDepth = own.depth;
      // Horizontal metres remain proportional. Depth and symbols are enlarged for legibility.
      root.position.set(-3, 0, 0);
      root.scale.setScalar(horizontal);
      sub.position.set(-3, -own.depth * vertical, 0);
      sub.rotation.y = -(((ping?.propagation.origin.heading ?? e.outputs.euler.heading) * Math.PI) / 180 - bearing);
      for (let i = 0; i < floors.count; i++) {
        const along = (floors.getX(i) + 3) / horizontal,
          across = floors.getZ(i) / horizontal;
        const n = own.n + Math.cos(bearing) * along - Math.sin(bearing) * across,
          east = own.e + Math.sin(bearing) * along + Math.cos(bearing) * across;
        floors.setY(i, -e.env.bottomDepthAt(n, east) * vertical);
      }
      floors.needsUpdate = true;
      floorGeometry.computeVertexNormals();
      grid.position.y = -depth * vertical - 0.015;
      pulse.position.set(0, (-own.depth * vertical) / horizontal, 0);
      tail.position.copy(pulse.position);
    }
    const resize = new ResizeObserver(() => {
      const w = el.clientWidth,
        h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    });
    resize.observe(el);
    const animate = () => {
      const e = runner.engine,
        ping = e.state.sonar?.ping ?? null;
      if (snapshot !== ping || engine !== e || (!ping && (oldRange !== e.state.sonar?.settings.range || oldHeading !== e.state.sonar?.settings.section))) {
        snapshot = ping;
        engine = e;
        oldRange = e.state.sonar!.settings.range;
        oldHeading = e.state.sonar!.settings.section;
        rebuild(ping);
      }
      if (oldKey !== opts.current.resetKey) {
        oldKey = opts.current.resetKey;
        reset();
      }
      const age = opts.current.age;
      const r = ping ? age * ping.speed : 0,
        range = ping?.propagation.range ?? 1;
      const strength = ping && age >= 0 ? clamp(1.2 - r / range, 0, 1) : 0;
      pulse.setPulse(r, strength, 0);
      tail.setPulse(Math.max(0, r - range * 0.025), strength * 0.35, 0);
      for (const shell of [pulse, tail, ...echoes]) shell.children[0].visible = !opts.current.linesOnly;
      for (let i = 0; i < echoes.length; i++) {
        const path = ping?.echoPaths[i],
          shell = echoes[i],
          dot = reflectors[i];
        if (!path || !ping) {
          shell.visible = false;
          dot.visible = false;
          continue;
        }
        const end = path.points.at(-1)!;
        const a = (path.bearing * Math.PI) / 180 - bearing,
          x = Math.cos(a) * end.r,
          z = Math.sin(a) * end.r;
        const reflected = age - path.arrival / 2,
          travel = path.arrival / 2;
        // Envelope reaches the observer at the stored arrival time, despite display exaggeration.
        const distance = Math.hypot(end.r, ((end.z - originDepth) * vertical) / horizontal),
          radius = (distance * reflected) / Math.max(0.001, travel);
        shell.position.set(x, (-end.z * vertical) / horizontal, z);
        shell.setPulse(radius, reflected >= 0 && age <= path.arrival + 0.15 ? 0.8 * clamp(1.4 - reflected / Math.max(0.001, travel), 0, 1) : 0, 0);
        dot.visible = reflected >= 0 && age < path.arrival + 0.5;
        dot.position.set(-3 + x * horizontal, -end.z * vertical, z * horizontal);
        (dot.material as THREE.MeshBasicMaterial).opacity = clamp(1 - reflected / (travel + 1), 0.2, 1);
      }
      surfaceMaterial.uniforms.time.value = age;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      const geometries = new Set<THREE.BufferGeometry>(),
        materials = new Set<THREE.Material>();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Points) {
          geometries.add(o.geometry);
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => materials.add(m));
        }
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      sandTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div className="sonar-pulse-canvas" ref={host}>
      {error && <div className="pulse-error">{error}</div>}
    </div>
  );
}
