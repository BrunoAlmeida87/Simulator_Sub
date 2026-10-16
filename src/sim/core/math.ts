/**
 * Utilitários matemáticos do motor de simulação.
 *
 * Convenções (padrão naval / SNAME):
 *  - Referencial inercial NED: x = Norte, y = Leste, z = para BAIXO (z = profundidade).
 *  - Referencial do corpo: x = avante (proa), y = boreste (BE), z = para baixo (quilha).
 *  - Ângulos de Euler (sequência ZYX): ψ (rumo/yaw), θ (pitch, + = proa para cima),
 *    φ (roll/banda, + = adernado para boreste).
 *  - A atitude é integrada como quatérnio (sem singularidade em θ = ±90°).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  w: number;
  x: number;
  y: number;
  z: number;
}

/** Matriz 3x3 em ordem linha-maior: [m00, m01, m02, m10, ... m22]. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vAdd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vSub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vScale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vDot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vCross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const vNorm = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const vCopy = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

/** Normaliza ângulo para (-π, π]. */
export function wrapPi(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

/** Normaliza ângulo em graus para [0, 360). */
export function wrap360(a: number): number {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
}

/** Aproxima x de alvo com taxa máxima (por segundo). */
export function rateLimit(current: number, target: number, maxRate: number, dt: number): number {
  const d = target - current;
  const m = maxRate * dt;
  if (d > m) return current + m;
  if (d < -m) return current - m;
  return target;
}

// ---------------------------------------------------------------- quatérnios

export const qIdentity = (): Quat => ({ w: 1, x: 0, y: 0, z: 0 });

export function qMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function qNormalize(q: Quat): Quat {
  const n = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z) || 1;
  return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}

/** Quatérnio a partir de ângulos de Euler ZYX (rad). Rotação corpo → NED. */
export function qFromEuler(phi: number, theta: number, psi: number): Quat {
  const cr = Math.cos(phi / 2);
  const sr = Math.sin(phi / 2);
  const cp = Math.cos(theta / 2);
  const sp = Math.sin(theta / 2);
  const cy = Math.cos(psi / 2);
  const sy = Math.sin(psi / 2);
  return {
    w: cr * cp * cy + sr * sp * sy,
    x: sr * cp * cy - cr * sp * sy,
    y: cr * sp * cy + sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
  };
}

/** Ângulos de Euler ZYX (rad) a partir do quatérnio. */
export function qToEuler(q: Quat): { phi: number; theta: number; psi: number } {
  const phi = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
  const theta = Math.asin(clamp(2 * (q.w * q.y - q.z * q.x), -1, 1));
  const psi = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
  return { phi, theta, psi };
}

/** Matriz de rotação R (corpo → NED) a partir do quatérnio. */
export function qToMat3(q: Quat): Mat3 {
  const { w, x, y, z } = q;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ];
}

/** R · v  (corpo → NED). */
export function mulMat3Vec(m: Mat3, v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  };
}

/** Rᵀ · v  (NED → corpo). */
export function mulMat3TVec(m: Mat3, v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[3] * v.y + m[6] * v.z,
    y: m[1] * v.x + m[4] * v.y + m[7] * v.z,
    z: m[2] * v.x + m[5] * v.y + m[8] * v.z,
  };
}

/** Derivada do quatérnio: q̇ = ½ q ⊗ (0, ω) com ω no referencial do corpo. */
export function qDerivative(q: Quat, w: Vec3): Quat {
  const r = qMul(q, { w: 0, x: w.x, y: w.y, z: w.z });
  return { w: 0.5 * r.w, x: 0.5 * r.x, y: 0.5 * r.y, z: 0.5 * r.z };
}

// ---------------------------------------------------------------- numérico

/**
 * Raiz de função monotônica crescente em [lo, hi] por bissecção.
 * Retorna lo se f(lo) ≥ 0, hi se f(hi) ≤ 0.
 */
export function bisectIncreasing(f: (x: number) => number, lo: number, hi: number, iters = 48): number {
  const flo = f(lo);
  if (flo >= 0) return lo;
  const fhi = f(hi);
  if (fhi <= 0) return hi;
  let a = lo;
  let b = hi;
  for (let i = 0; i < iters; i++) {
    const m = 0.5 * (a + b);
    if (f(m) > 0) b = m;
    else a = m;
  }
  return 0.5 * (a + b);
}

/**
 * Raiz quadrada "regularizada" usada em escoamentos por orifício:
 * comporta-se como sign(x)·√|x| para |x| ≫ x0 e linearmente perto de zero,
 * evitando derivada infinita (rigidez numérica) quando Δp → 0.
 */
export function regSqrt(x: number, x0: number): number {
  return x / Math.sqrt(Math.abs(x) + x0);
}

/** Gerador pseudoaleatório determinístico (mulberry32) — estado serializável. */
export function rngNext(state: { seed: number }): number {
  let t = (state.seed = (state.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Amostra normal padrão (Box–Muller) a partir do gerador determinístico. */
export function rngNormal(state: { seed: number }): number {
  const u1 = Math.max(1e-12, rngNext(state));
  const u2 = rngNext(state);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
