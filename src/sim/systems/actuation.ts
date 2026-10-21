/**
 * ATUAÇÃO: planta hidráulica, lemes (superfícies de controle), mastros do
 * snorkel e do periscópio e alagamento de compartimentos.
 *
 * Planta hidráulica (conceitual): pressão do acumulador p_h recarregada por
 * bombas elétricas e consumida pelos movimentos de lemes e válvulas:
 *   dp_h/dt = Q_bombas − Σ consumos − vazamento
 * Fator de disponibilidade f = clamp((p_h − p_min)/(0,75·p_nom − p_min), 0, 1):
 * multiplica a velocidade dos atuadores (perda de energia ⇒ lemes lentos e,
 * por fim, imobilizados).
 *
 * Lemes: posição real persegue a comandada com taxa máxima (°/s)·f; batente
 * em ±δ_max; falha "travado" imobiliza.
 *
 * Alagamento (falha simulada): Q = C_d·A_rombo·√(2Δp/ρ), Δp = p_mar − p_interna.
 */
import type { VesselConfig } from '../config/types';
import type { SimState } from '../core/state';
import { DEG, clamp, rateLimit } from '../core/math';
import type { StepContext } from '../core/context';

export function hydraulicFactor(cfg: VesselConfig, s: SimState): number {
  const h = cfg.hydraulics;
  if (s.hydraulics.failed) return 0;
  return clamp((s.hydraulics.pressure - h.minPressure) / (0.75 * h.nominalPressure - h.minPressure), 0, 1);
}

export function updateHydraulics(cfg: VesselConfig, s: SimState, ctx: StepContext): number {
  const h = cfg.hydraulics;
  const st = s.hydraulics;
  const canRun = ctx.busPowered && !st.failed;
  if (st.pressure < 0.93 * h.nominalPressure) st.pumpOn = canRun;
  else if (st.pressure >= h.nominalPressure) st.pumpOn = false;
  if (!canRun) st.pumpOn = false;
  let p = st.pressure;
  if (st.pumpOn) p += h.pumpFlowEquivalent * ctx.dt;
  p -= ctx.hydraulicDemand + h.leakRate * ctx.dt;
  st.pressure = clamp(p, 0, h.nominalPressure);
  st.power = canRun ? (st.pumpOn ? h.pumpPower : h.idlePower) : 0;
  return st.power;
}

/** Ângulo geométrico (rad) de cada superfície para o cálculo de forças. */
export function finGeometricAngles(cfg: VesselConfig, s: SimState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of cfg.fins) {
    const st = s.surfaces[f.id];
    out[f.id] = st ? st.actual * f.commandSign * DEG : 0;
  }
  return out;
}

export function updateSurfaces(cfg: VesselConfig, s: SimState, ctx: StepContext): void {
  for (const f of cfg.fins) {
    if (f.maxDeflection <= 0) continue;
    const st = s.surfaces[f.id];
    st.cmd = clamp(st.cmd, -f.maxDeflection, f.maxDeflection);
    if (st.jammed) continue;
    const before = st.actual;
    st.actual = rateLimit(st.actual, st.cmd, f.rate * ctx.hydraulicFactor, ctx.dt);
    ctx.hydraulicDemand += Math.abs(st.actual - before) * cfg.hydraulics.consumptionPerDegree;
  }
}

export function snorkelHeadDepth(cfg: VesselConfig, s: SimState, ctx: StepContext): number {
  const h = cfg.hull;
  const top = -(h.diameter / 2 + h.sail.height + h.snorkelMast.extension * s.snorkel.pos);
  return ctx.depthOf({ x: h.snorkelMast.x, y: 0, z: top });
}

export function sailTopDepth(cfg: VesselConfig, ctx: StepContext): number {
  const h = cfg.hull;
  return ctx.depthOf({ x: 0.5 * (h.sail.xFwd + h.sail.xAft), y: 0, z: -(h.diameter / 2 + h.sail.height) });
}

/** Atualiza o mastro e retorna se há tomada de ar para diesel/compressor. */
export function updateSnorkel(cfg: VesselConfig, s: SimState, ctx: StepContext): boolean {
  const before = s.snorkel.pos;
  s.snorkel.pos = rateLimit(s.snorkel.pos, s.snorkel.cmd ? 1 : 0, ctx.hydraulicFactor / cfg.hull.snorkelMast.raiseTime, ctx.dt);
  ctx.hydraulicDemand += (Math.abs(s.snorkel.pos - before) * cfg.hydraulics.consumptionPerStroke) / 2;
  // profundidade relativa à superfície LOCAL (com ondas): uma crista pode cobrir a cabeça do snorkel
  const w = ctx.env.waves;
  const etaAt = (x: number) => (w.active ? w.elevation(ctx.pos.x + ctx.R[0] * x, ctx.pos.y + ctx.R[3] * x, ctx.t) : 0);
  const head = snorkelHeadDepth(cfg, s, ctx) + etaAt(cfg.hull.snorkelMast.x);
  // válvula de cabeça fecha automaticamente se a cabeça submergir
  s.snorkel.headValveOpen = s.snorkel.pos > 0.98 && head < -0.3;
  const surfaced = sailTopDepth(cfg, ctx) + etaAt(0.5 * (cfg.hull.sail.xFwd + cfg.hull.sail.xAft)) < -2.0;
  return s.snorkel.headValveOpen || surfaced;
}

/** Mastro do periscópio de ataque (padrão quando a configuração não o define). */
export function periscopeCfg(cfg: VesselConfig): { x: number; extension: number; raiseTime: number } {
  return cfg.hull.periscopeMast ?? { x: 12.0, extension: 5.0, raiseTime: 8 };
}

/** Cota (corpo, m, + para baixo) da cabeça do periscópio para a posição atual do mastro. */
export function periscopeHeadZ(cfg: VesselConfig, pos: number): number {
  const h = cfg.hull;
  return -(h.diameter / 2 + h.sail.height + 0.3 + periscopeCfg(cfg).extension * pos);
}

/**
 * Periscópio: mastro hidráulico (mesmo consumo do snorkel por curso). Sem
 * efeito hidrodinâmico na simulação (ver LIMITACOES); serve à vigilância.
 */
export function updatePeriscope(cfg: VesselConfig, s: SimState, ctx: StepContext): void {
  const p = (s.periscope ??= { cmd: false, pos: 0 });
  const before = p.pos;
  p.pos = rateLimit(p.pos, p.cmd ? 1 : 0, ctx.hydraulicFactor / periscopeCfg(cfg).raiseTime, ctx.dt);
  ctx.hydraulicDemand += (Math.abs(p.pos - before) * cfg.hydraulics.consumptionPerStroke) / 2;
}

export function updateFlooding(cfg: VesselConfig, s: SimState, ctx: StepContext): number {
  let total = 0;
  for (const c of cfg.compartments) {
    const f = s.flooding[c.id];
    f.rate = 0;
    if (f.breachArea <= 0) continue;
    const z = ctx.depthOf({ x: 0.5 * (c.xFwd + c.xAft), y: 0, z: c.bilgeZ });
    const dp = ctx.env.pressureAt(z) - cfg.internalPressure;
    if (dp <= 0 || z <= 0) continue;
    const rho = ctx.env.densityAtmosphericAt(z);
    const R = cfg.hull.diameter / 2;
    const maxMass = Math.PI * R * R * (c.xFwd - c.xAft) * 0.6 * rho;
    const q = 0.62 * f.breachArea * Math.sqrt((2 * dp) / rho);
    const m = Math.min(q * rho * ctx.dt, Math.max(0, maxMass - f.water));
    f.water += m;
    f.rate = m / ctx.dt / rho;
    total += m;
  }
  return total;
}
