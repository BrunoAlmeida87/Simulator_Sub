/**
 * AR COMPRIMIDO DE ALTA PRESSÃO (AP) — garrafas, válvulas de isolamento,
 * coletor e compressor.
 *
 *  p_grupo = m·R·T_ar / V_grupo
 *
 * Simplificação: os grupos com válvula de isolamento aberta são equalizados
 * instantaneamente no coletor (p_coletor = Σm·R·T / ΣV). O compressor só
 * opera com tomada de ar disponível (superfície ou snorkel) e barramento
 * energizado, carregando todos os grupos até a pressão máxima.
 */
import type { HpAirConfig } from '../config/types';
import type { SimState } from '../core/state';
import { R_AIR, type StepContext } from '../core/context';
import { updateValve } from './components';

export const bankTempK = (cfg: HpAirConfig) => cfg.temperature + 273.15;

export function bankPressure(cfg: HpAirConfig, id: string, mass: number): number {
  const b = cfg.banks.find((x) => x.id === id)!;
  return (mass * R_AIR * bankTempK(cfg)) / b.volume;
}

/** Atualiza válvulas e calcula a pressão do coletor. Retorna cursos de válvula. */
export function updateHpManifold(cfg: HpAirConfig, s: SimState, ctx: StepContext): number {
  let strokes = 0;
  const T = bankTempK(cfg);
  let mSum = 0;
  let vSum = 0;
  for (const b of cfg.banks) {
    const st = s.hpAir.banks[b.id];
    strokes += updateValve(b.valve, st.valve, ctx.dt, ctx.hydraulicFactor > 0);
    if (st.valve.pos > 0.05) {
      mSum += st.mass;
      vSum += b.volume;
    }
  }
  // equalização entre grupos abertos
  if (vSum > 0) {
    for (const b of cfg.banks) {
      const st = s.hpAir.banks[b.id];
      if (st.valve.pos > 0.05) st.mass = (mSum * b.volume) / vSum;
    }
    s.hpAir.manifoldPressure = (mSum * R_AIR * T) / vSum;
  } else {
    // coletor isolado: pressão residual decai rapidamente (volume desprezível)
    s.hpAir.manifoldPressure = Math.max(ctx.env.cfg.atmosphericPressure, s.hpAir.manifoldPressure * Math.exp(-ctx.dt / 0.5));
  }
  return strokes;
}

/** Retira do coletor a massa consumida pelos sopros (proporcional a cada grupo aberto). */
export function drawFromManifold(cfg: HpAirConfig, s: SimState, mass: number): void {
  if (mass <= 0) return;
  let mOpen = 0;
  for (const b of cfg.banks) {
    const st = s.hpAir.banks[b.id];
    if (st.valve.pos > 0.05) mOpen += st.mass;
  }
  if (mOpen <= 0) return;
  for (const b of cfg.banks) {
    const st = s.hpAir.banks[b.id];
    if (st.valve.pos > 0.05) st.mass = Math.max(0, st.mass - (mass * st.mass) / mOpen);
  }
}

/** Compressor: retorna massa adicionada (kg) e potência demandada (W). */
export function updateCompressor(cfg: HpAirConfig, s: SimState, ctx: StepContext): { added: number; power: number } {
  const c = cfg.compressor;
  const run = s.hpAir.compressorCmd && ctx.busPowered && ctx.airIntakeAvailable;
  s.hpAir.compressorRunning = false;
  if (!run) return { added: 0, power: 0 };
  let added = 0;
  const T = bankTempK(cfg);
  const per = (c.massFlow * ctx.dt) / cfg.banks.length;
  for (const b of cfg.banks) {
    const st = s.hpAir.banks[b.id];
    const mMax = (c.maxPressure * b.volume) / (R_AIR * T);
    const add = Math.min(per, Math.max(0, mMax - st.mass));
    st.mass += add;
    added += add;
  }
  s.hpAir.compressorRunning = added > 0;
  return { added, power: added > 0 ? c.power : 0.1 * c.power };
}
