/** Public measurements deliberately contain no world entity IDs, names or target coordinates. */
export interface Observer {
  n: number;
  e: number;
  depth: number;
  heading: number;
  vn: number;
  ve: number;
}
export interface Measurement {
  t: number;
  bearing: number;
  sigma: number;
  snr: number;
  observer: Observer;
  mode: 'passive' | 'active' | 'intercept';
  range?: number;
  rangeSigma?: number;
}
export interface Track {
  id: string;
  bearing: number;
  snr: number;
  sigma: number;
  lastSeen: number;
  mode: Measurement['mode'];
  range?: number;
  rangeSigma?: number;
  rangeTime?: number;
  history: Ring<Measurement>;
  classification: string;
  confidence: number;
  manual?: string;
  peaks: number[];
  modulation: number[];
}
export interface Ring<T> {
  data: T[];
  head: number;
  size: number;
  capacity: number;
}
export function ring<T>(capacity: number): Ring<T> {
  return { data: [], head: 0, size: 0, capacity };
}
export function push<T>(r: Ring<T>, item: T): void {
  r.data[r.head] = item;
  r.head = (r.head + 1) % r.capacity;
  r.size = Math.min(r.capacity, r.size + 1);
}
export function values<T>(r: Ring<T>): T[] {
  return Array.from({ length: r.size }, (_, i) => r.data[(r.head - r.size + i + r.capacity) % r.capacity]);
}
export interface Spectrum {
  bins: number[];
  binHz: number;
  peaks: number[];
}
export interface AcousticFrame {
  t: number;
  broadband: number[];
  lofar: number[];
  demon: number[];
  beam: number;
  snr: number;
  peaks: number[];
  modulation: number[];
}
export interface RayPoint {
  r: number;
  z: number;
  t: number;
  loss: number;
  event?: 'surface' | 'bottom';
}
export interface Ray {
  points: RayPoint[];
}
export interface Propagation {
  origin: Observer;
  bearing: number;
  range: number;
  rays: Ray[];
  bottom: { r: number; z: number }[];
  profile: { z: number; c: number }[];
  thermocline: number;
}
export interface Echo {
  due: number;
  measurement: Measurement;
}
export interface AcousticPath {
  loss: number;
  time: number;
  coverage: number;
  ray: Ray;
}
export interface CachedPath {
  at: number;
  key: string;
  loss: number;
  time: number;
  coverage: number;
}
export interface EchoPath {
  bearing: number;
  points: RayPoint[];
  arrival: number;
}
export interface Ping {
  echoPaths: EchoPath[];
  start: number;
  speed: number;
  duration: number;
  propagation: Propagation;
  events: { t: number; label: string }[];
}
export interface SourceOverride {
  level?: number;
  shaftHz?: number;
  blades?: number;
  tones?: number[];
  propulsion?: boolean;
}
export interface SonarSettings {
  sourceOverrides: Record<string, SourceOverride>;
  historySeconds: number;
  enabled: boolean;
  coverage: number;
  integration: number;
  beam: number;
  selected: string | null;
  traffic: number;
  biological: number;
  shipping: number;
  rayCount: number;
  section: number;
  range: number;
  homogeneous: boolean;
  intercept: boolean;
}
export interface SonarState {
  pathCursor: number;
  lastPathCheck: number;
  paths: Record<string, CachedPath>;
  audioSamples: number[];
  settings: SonarSettings;
  lastSample: number;
  seed: number;
  nextId: number;
  tracks: Track[];
  noise: { ambient: number; own: number; total: number };
  frame: AcousticFrame | null;
  history: Ring<AcousticFrame>;
  pending: Echo[];
  ping: Ping | null;
  lastIntercept: number;
  version: number;
}
export function initialSonar(): SonarState {
  return {
    pathCursor: 0,
    lastPathCheck: 0,
    paths: {},
    audioSamples: [],
    settings: {
      sourceOverrides: {},
      historySeconds: 240,
      enabled: true,
      coverage: 360,
      integration: 3,
      beam: 0,
      selected: null,
      traffic: 0,
      biological: 0.3,
      shipping: 0.4,
      rayCount: 64,
      section: 0,
      range: 6000,
      homogeneous: false,
      intercept: false,
    },
    lastSample: 0,
    seed: 918273,
    nextId: 1,
    tracks: [],
    noise: { ambient: 0, own: 0, total: 0 },
    frame: null,
    history: ring(240),
    pending: [],
    ping: null,
    lastIntercept: 0,
    version: 0,
  };
}
export const wrap = (x: number): number => ((x % 360) + 360) % 360;
export const angleDiff = (a: number, b: number): number => ((a - b + 540) % 360) - 180;
export const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
export function random(s: { seed: number }): number {
  s.seed = (Math.imul(1664525, s.seed) + 1013904223) >>> 0;
  return (s.seed + 0.5) / 4294967296;
}
export function gaussian(s: { seed: number }): number {
  return Math.sqrt(-2 * Math.log(random(s))) * Math.cos(2 * Math.PI * random(s));
}
export function sumDb(...levels: number[]): number {
  return 10 * Math.log10(levels.reduce((a, b) => a + 10 ** (b / 10), 1e-12));
}
