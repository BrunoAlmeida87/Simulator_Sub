import * as THREE from 'three';
import { PulseShell } from './PulseShell';
import type { SimulationEngine } from '../../sim/core/engine';
import type { SceneLayers } from '../../render3d/layers';
import { diagnostic } from './diagnostic';
import { type Propagation, type RayPoint, clamp } from '../types';
export const SONAR_LAYERS = ['sonarRays', 'sonarWave', 'sonarThermocline', 'sonarProfile', 'sonarCoverage', 'sonarHeatmap', 'sonarSurface', 'sonarBottom', 'sonarEchoes', 'sonarBearings', 'sonarRulers'] as const;
/** Buffers rebuilt only on a new propagation snapshot. Group uses the existing NED→Three transform. */
export class SonarVis {
  private group = new THREE.Group();
  private lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x65e5be, transparent: true, fog: false, depthTest: false }));
  private wave = new PulseShell(0x46deef);
  private surface = this.points(0x80ceff);
  private bottom = this.points(0xffb46d);
  private coverage = this.points(0x917baf);
  private heat = this.points(0x31ceaa);
  private echoes = this.points(0xffc76e);
  private bearings = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x73cbdc, transparent: true, fog: false, depthTest: false }));
  private thermo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xbc8cdd, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  private profile = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xca9ee9, fog: false }));
  private rulers = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x5c8595, transparent: true, fog: false }));
  private last: Propagation | null = null;
  private times: number[] = [];
  private surfaceTimes: number[] = [];
  private bottomTimes: number[] = [];
  private marks = new Float32Array(512 * 3);
  private bearingBuffer = new Float32Array(48 * 6);
  constructor(scene: THREE.Scene) {
    this.group.add(this.lines, this.wave, this.surface, this.bottom, this.coverage, this.heat, this.echoes, this.bearings, this.thermo, this.profile, this.rulers);
    scene.add(this.group);
    this.echoes.geometry.setAttribute('position', new THREE.BufferAttribute(this.marks, 3).setUsage(THREE.DynamicDrawUsage));
    this.bearings.geometry.setAttribute('position', new THREE.BufferAttribute(this.bearingBuffer, 3).setUsage(THREE.DynamicDrawUsage));
    for (const o of [this.lines, this.wave, this.echoes, this.bearings]) o.frustumCulled = false;
  }
  private points(color: number) {
    return new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color, size: 4, sizeAttenuation: false, transparent: true, fog: false, depthTest: false }));
  }
  private setGeometry(object: THREE.Line | THREE.LineSegments | THREE.Points, positions: number[]): void {
    object.geometry.dispose();
    object.geometry = new THREE.BufferGeometry();
    object.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  }
  private build(d: Propagation): void {
    this.last = d;
    const a = (d.bearing * Math.PI) / 180,
      sx = Math.sin(a),
      cz = -Math.cos(a);
    const xyz = (p: RayPoint) => [sx * p.r, -p.z, cz * p.r];
    const segments: { a: RayPoint; b: RayPoint }[] = [],
      surf: RayPoint[] = [],
      bottom: RayPoint[] = [];
    const zmax = Math.max(100, ...d.bottom.map((p) => p.z)),
      grid = new Float32Array(80 * 24);
    for (const ray of d.rays)
      for (let i = 1; i < ray.points.length; i++) {
        const p = ray.points[i];
        segments.push({ a: ray.points[i - 1], b: p });
        if (p.event) (p.event === 'surface' ? surf : bottom).push(p);
        const ix = Math.min(79, Math.floor((p.r / d.range) * 80)),
          iz = clamp(Math.floor((p.z / zmax) * 24), 0, 23);
        grid[iz * 80 + ix] += 1;
      }
    segments.sort((a, b) => a.b.t - b.b.t);
    this.times = segments.map((s) => s.b.t);
    this.setGeometry(
      this.lines,
      segments.flatMap((s) => [...xyz(s.a), ...xyz(s.b)]),
    );
    surf.sort((a, b) => a.t - b.t);
    bottom.sort((a, b) => a.t - b.t);
    this.surfaceTimes = surf.map((p) => p.t);
    this.bottomTimes = bottom.map((p) => p.t);
    this.setGeometry(this.surface, surf.flatMap(xyz));
    this.setGeometry(this.bottom, bottom.flatMap(xyz));
    const cover: number[] = [],
      heat: number[] = [],
      colors: number[] = [];
    for (let z = 0; z < 24; z++)
      for (let r = 0; r < 80; r++) {
        const p = { r: ((r + 0.5) / 80) * d.range, z: ((z + 0.5) / 24) * zmax, t: 0, loss: 0 };
        const floor = d.bottom[Math.min(120, Math.round((r / 80) * 120))].z;
        if (p.z > floor) continue;
        const count = grid[z * 80 + r];
        if (!count) cover.push(...xyz(p));
        else {
          heat.push(...xyz(p));
          const v = Math.min(1, Math.log1p(count) / 4);
          colors.push(0.1 + v * 0.6, 0.3 + v * 0.7, 0.5 - v * 0.3);
        }
      }
    this.setGeometry(this.coverage, cover);
    this.setGeometry(this.heat, heat);
    this.heat.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.heat.material.vertexColors = true;
    this.thermo.rotation.x = -Math.PI / 2;
    this.thermo.scale.set(d.range * 2, d.range * 2, 1);
    this.thermo.position.set(0, -d.thermocline, 0);
    const cmin = Math.min(...d.profile.map((p) => p.c));
    this.setGeometry(
      this.profile,
      d.profile.flatMap((p) => [-100 - (p.c - cmin) * 5, -p.z, 0]),
    );
    const rulers: number[] = [];
    for (let r = 0; r <= d.range; r += d.range / 6) rulers.push(sx * r, 0, cz * r, sx * r, -zmax, cz * r);
    for (let z = 0; z <= zmax; z += zmax / 4) rulers.push(0, -z, 0, sx * d.range, -z, cz * d.range);
    this.setGeometry(this.rulers, rulers);
  }
  update(e: SimulationEngine, pn: number, pe: number, l: SceneLayers): void {
    this.group.visible = SONAR_LAYERS.some((k) => l[k]);
    if (!this.group.visible || !e.state.sonar) return;
    const s = e.state.sonar,
      ping = s.ping,
      d = ping ? ping.propagation : diagnostic(e);
    if (this.last !== d) this.build(d);
    this.group.position.set(d.origin.e - pe, 0, -(d.origin.n - pn));
    const age = ping ? (l.sonarReplayTime >= 0 ? l.sonarReplayTime : e.state.t - ping.start) : null;
    let count = this.times.length;
    if (age !== null) {
      let lo = 0,
        hi = this.times.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.times[mid] <= age) lo = mid + 1;
        else hi = mid;
      }
      count = lo;
    }
    this.lines.geometry.setDrawRange(0, count * 2);
    this.surface.geometry.setDrawRange(0, age === null ? this.surfaceTimes.length : this.surfaceTimes.filter((t) => t <= age).length);
    this.bottom.geometry.setDrawRange(0, age === null ? this.bottomTimes.length : this.bottomTimes.filter((t) => t <= age).length);
    this.wave.position.set(0, -d.origin.depth, 0);
    const radius = ping && age !== null ? age * ping.speed : 0;
    this.wave.setPulse(radius, l.sonarOpacity * clamp(1.2 - radius / d.range, 0, 1), 0, -Math.max(...d.bottom.map((p) => p.z)));
    let b = 0,
      m = 0;
    for (const track of l.sonarReplayTime >= 0 ? [] : s.tracks) {
      if (e.state.t - track.lastSeen > 30) continue;
      const rad = (track.bearing * Math.PI) / 180,
        x = e.state.body.pos.y - d.origin.e,
        z = -(e.state.body.pos.x - d.origin.n),
        y = -Math.max(0, e.state.body.pos.z);
      this.bearingBuffer.set([x, y, z, x + Math.sin(rad) * d.range, y, z - Math.cos(rad) * d.range], b);
      b += 6;
      if (track.range !== undefined && e.state.t - (track.rangeTime ?? -100) < 15) {
        this.marks.set([x + Math.sin(rad) * track.range, y, z - Math.cos(rad) * track.range], m);
        m += 3;
      }
    }
    // Returning echoes follow stored finite-width acoustic paths, with the same arrival clock.
    if (ping && age !== null)
      for (const echo of ping.echoPaths ?? []) {
        if (age < echo.arrival / 2 || age > echo.arrival + 0.5) continue;
        const points = echo.points,
          time = points[points.length - 1].t * clamp(2 - (2 * age) / echo.arrival, 0, 1);
        const index = points.findIndex((p) => p.t >= time),
          q = points[index < 0 ? points.length - 1 : index],
          p = points[Math.max(0, index - 1)];
        const f = clamp((time - p.t) / Math.max(1e-6, q.t - p.t), 0, 1),
          range = p.r + (q.r - p.r) * f,
          rad = (echo.bearing * Math.PI) / 180;
        this.marks.set([Math.sin(rad) * range, -(p.z + (q.z - p.z) * f), -Math.cos(rad) * range], m);
        m += 3;
      }
    this.bearings.geometry.attributes.position.needsUpdate = true;
    this.bearings.geometry.setDrawRange(0, b / 3);
    this.echoes.geometry.attributes.position.needsUpdate = true;
    this.echoes.geometry.setDrawRange(0, m / 3);
    for (const [object, visible] of [
      [this.lines, l.sonarRays],
      [this.wave, l.sonarWave && this.wave.visible],
      [this.thermo, l.sonarThermocline],
      [this.profile, l.sonarProfile],
      [this.coverage, l.sonarCoverage],
      [this.heat, l.sonarHeatmap],
      [this.surface, l.sonarSurface],
      [this.bottom, l.sonarBottom],
      [this.echoes, l.sonarEchoes],
      [this.bearings, l.sonarBearings],
      [this.rulers, l.sonarRulers],
    ] as const)
      object.visible = visible;
    for (const obj of [this.lines, this.surface, this.bottom, this.coverage, this.heat, this.bearings, this.rulers]) obj.material.opacity = l.sonarOpacity;
    this.thermo.material.opacity = l.sonarOpacity * 0.2;
  }
}
