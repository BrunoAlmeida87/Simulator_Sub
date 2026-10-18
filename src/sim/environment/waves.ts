/**
 * ONDAS DE SUPERFÍCIE — mar irregular como soma de ondas lineares (Airy) de
 * água profunda, amostradas de um espectro de Pierson–Moskowitz com
 * espalhamento direcional cos²:
 *
 *   S(ω) = (5/16)·Hs²·ωp⁴·ω⁻⁵·exp(−1,25·(ωp/ω)⁴)
 *   a_i = √(2·S(ω_i)·Δω),  k_i = ω_i²/g
 *   η(x,t) = Σ a_i·cos(k_i·(d_i·x) − ω_i·t + φ_i)          (+ para cima)
 *   cinemática a profundidade z: velocidade e aceleração orbitais ∝ a·ω·e^{−kz}
 *
 * O MESMO conjunto de componentes alimenta a física (empuxo por fatia com a
 * elevação local, forças de inércia da onda, escoamento relativo) e o
 * oceano desenhado em 3D — o que se vê é o que move o submarino.
 */

export interface WaveConfig {
  seaState: number; // 0 (calmo) … 6 (muito agitado) — escala de Douglas simplificada
  direction: number; // graus (de onde as ondas VÃO, sentido horário a partir do Norte)
  seed: number;
}

export interface WaveComponent {
  a: number; // amplitude (m)
  k: number; // número de onda (rad/m)
  w: number; // frequência angular (rad/s)
  dn: number; // direção de propagação (Norte)
  de: number; // direção de propagação (Leste)
  phi: number; // fase (rad)
}

/** Altura significativa (m) e período de pico (s) por estado do mar (valores típicos). */
export const SEA_STATES: { hs: number; tp: number; label: string }[] = [
  { hs: 0, tp: 0, label: '0 — calmo (espelhado)' },
  { hs: 0.1, tp: 2.0, label: '1 — calmo (encrespado)' },
  { hs: 0.4, tp: 3.5, label: '2 — mar de pequenas vagas' },
  { hs: 1.0, tp: 5.5, label: '3 — mar ligeiro' },
  { hs: 2.0, tp: 7.0, label: '4 — mar moderado' },
  { hs: 3.5, tp: 8.5, label: '5 — mar grosso' },
  { hs: 5.5, tp: 10.5, label: '6 — mar muito grosso' },
];

export const MAX_WAVE_COMPONENTS = 24;

function mulberry(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WaveField {
  components: WaveComponent[] = [];
  hs = 0;
  tp = 0;
  /** número de onda mínimo (decaimento mais lento com a profundidade) */
  kMin = Infinity;

  constructor(cfg: WaveConfig, g = 9.80665) {
    this.build(cfg, g);
  }

  build(cfg: WaveConfig, g = 9.80665): void {
    const st = SEA_STATES[Math.max(0, Math.min(SEA_STATES.length - 1, Math.round(cfg.seaState)))];
    this.hs = st.hs;
    this.tp = st.tp;
    this.components = [];
    this.kMin = Infinity;
    if (st.hs <= 0) return;
    const rnd = mulberry(cfg.seed || 7);
    const wp = (2 * Math.PI) / st.tp;
    const N = MAX_WAVE_COMPONENTS;
    const w0 = 0.6 * wp;
    const w1 = 3.2 * wp;
    const dw = (w1 - w0) / N;
    const S = (w: number) => (5 / 16) * st.hs * st.hs * wp ** 4 * w ** -5 * Math.exp(-1.25 * (wp / w) ** 4);
    const base = (cfg.direction * Math.PI) / 180;
    for (let i = 0; i < N; i++) {
      const w = w0 + (i + 0.3 + 0.4 * rnd()) * dw;
      // espalhamento cos²: amostragem por rejeição em ±90°
      let th = 0;
      for (let j = 0; j < 20; j++) {
        const c = (rnd() - 0.5) * Math.PI;
        if (rnd() < Math.cos(c) ** 2) {
          th = c * 0.7;
          break;
        }
      }
      const dir = base + th;
      const k = (w * w) / g;
      this.kMin = Math.min(this.kMin, k);
      this.components.push({ a: Math.sqrt(2 * S(w) * dw), k, w, dn: Math.cos(dir), de: Math.sin(dir), phi: rnd() * 2 * Math.PI });
    }
  }

  get active(): boolean {
    return this.components.length > 0;
  }

  /** Profundidade abaixo da qual o efeito das ondas é desprezível (e^{−kz} < 0,2 %). */
  get cutoffDepth(): number {
    return this.active ? 6.2 / this.kMin : 0;
  }

  /**
   * Amostra combinada (uma única passagem pelas componentes): elevação η e
   * cinemática orbital à profundidade média z (sem estiramento de Wheeler).
   */
  sample(n: number, e: number, z: number, t: number, out: { eta: number; vn: number; ve: number; vz: number; an: number; ae: number; az: number }): void {
    out.eta = out.vn = out.ve = out.vz = out.an = out.ae = out.az = 0;
    const zz = Math.max(0, z);
    for (const c of this.components) {
      const th = c.k * (c.dn * n + c.de * e) - c.w * t + c.phi;
      const cs = Math.cos(th);
      out.eta += c.a * cs;
      const kz = c.k * zz;
      if (kz > 9) continue;
      const sn = Math.sin(th);
      const aw = c.a * c.w * Math.exp(-kz);
      out.vn += aw * cs * c.dn;
      out.ve += aw * cs * c.de;
      out.vz -= aw * sn;
      const aw2 = aw * c.w;
      out.an += aw2 * sn * c.dn;
      out.ae += aw2 * sn * c.de;
      out.az += aw2 * cs;
    }
  }

  /** Elevação da superfície η (m, + para cima) em (Norte, Leste) no instante t. */
  elevation(n: number, e: number, t: number): number {
    let h = 0;
    for (const c of this.components) h += c.a * Math.cos(c.k * (c.dn * n + c.de * e) - c.w * t + c.phi);
    return h;
  }

  /**
   * Cinemática orbital em (n, e, profundidade z ≥ 0): velocidade e aceleração
   * no referencial NED (z para baixo) e pressão dinâmica (Pa/ρ).
   */
  kinematics(n: number, e: number, z: number, t: number, out: { vn: number; ve: number; vz: number; an: number; ae: number; az: number; pd: number }): void {
    out.vn = out.ve = out.vz = out.an = out.ae = out.az = out.pd = 0;
    const zz = Math.max(0, z);
    for (const c of this.components) {
      const dec = Math.exp(-c.k * zz);
      if (dec < 1e-4) continue;
      const th = c.k * (c.dn * n + c.de * e) - c.w * t + c.phi;
      const cs = Math.cos(th);
      const sn = Math.sin(th);
      const aw = c.a * c.w * dec;
      // horizontal: u = aω e^{-kz} cosθ ao longo de d; vertical (para cima): aω e^{-kz} sinθ
      out.vn += aw * cs * c.dn;
      out.ve += aw * cs * c.de;
      out.vz -= aw * sn; // NED: para baixo positivo
      const aw2 = aw * c.w;
      out.an += aw2 * sn * c.dn;
      out.ae += aw2 * sn * c.de;
      out.az += aw2 * cs; // d/dt(−aω e sinθ) = aω² e cosθ
      out.pd += 9.80665 * c.a * dec * cs;
    }
  }
}
