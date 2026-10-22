/**
 * Ar AP: circuitos independentes normal/emergência, p = mRT/V.
 * Só os grupos abertos de um mesmo circuito se equalizam. O compressor
 * recarrega ambos por conexões com retenção, sem interligar as reservas.
 */
import type { AirCircuit, HpAirConfig } from '../config/types';
import type { SimState } from '../core/state';
import { R_AIR, type StepContext } from '../core/context';
import { updateValve } from './components';

export const bankTempK = (cfg: HpAirConfig) => cfg.temperature + 273.15;
export const bankCircuit = (b: HpAirConfig['banks'][number]): AirCircuit => b.purpose ?? 'normal';
export const emergencyBlowActive = (s: SimState): boolean => Object.values(s.ballast).some((t) => t.emergencyBlow.cmd > 0.5);

export function bankPressure(cfg: HpAirConfig, id: string, mass: number): number {
  const b = cfg.banks.find((x) => x.id === id)!;
  return (mass * R_AIR * bankTempK(cfg)) / b.volume;
}

/** Massa disponível: um coletor isolado de volume desprezível não fornece ar. */
export function manifoldMass(cfg: HpAirConfig, s: SimState, circuit: AirCircuit = 'normal'): number {
  return cfg.banks.reduce((sum, b) => sum + (bankCircuit(b) === circuit && s.hpAir.banks[b.id].valve.pos > 0.05 ? s.hpAir.banks[b.id].mass : 0), 0);
}

/** Atualiza válvulas e equaliza cada circuito separadamente. */
export function updateHpManifold(cfg: HpAirConfig, s: SimState, ctx: StepContext): number {
  let strokes = 0;
  for (const b of cfg.banks) strokes += updateValve(b.valve, s.hpAir.banks[b.id].valve, ctx.dt, ctx.hydraulicFactor > 0);
  for (const circuit of ['normal', 'emergency'] as const) {
    const open = cfg.banks.filter((b) => bankCircuit(b) === circuit && s.hpAir.banks[b.id].valve.pos > 0.05);
    const mass = open.reduce((sum, b) => sum + s.hpAir.banks[b.id].mass, 0);
    const volume = open.reduce((sum, b) => sum + b.volume, 0);
    for (const b of open) s.hpAir.banks[b.id].mass = (mass * b.volume) / volume;
    const pressure = volume > 0 ? (mass * R_AIR * bankTempK(cfg)) / volume : ctx.env.cfg.atmosphericPressure;
    if (circuit === 'normal') s.hpAir.manifoldPressure = pressure;
    else s.hpAir.emergencyManifoldPressure = pressure;
  }
  return strokes;
}

/** Consumo proporcional entre os grupos abertos do circuito selecionado. */
export function drawFromManifold(cfg: HpAirConfig, s: SimState, mass: number, circuit: AirCircuit = 'normal'): void {
  const available = manifoldMass(cfg, s, circuit);
  if (mass <= 0 || available <= 0) return;
  const fraction = Math.min(1, mass / available);
  for (const b of cfg.banks) {
    const st = s.hpAir.banks[b.id];
    if (bankCircuit(b) === circuit && st.valve.pos > 0.05) st.mass *= 1 - fraction;
  }
}

/** Compressor manual ou automático durante a emergência, com prioridade à reserva dedicada. */
export function updateCompressor(cfg: HpAirConfig, s: SimState, ctx: StepContext): { added: number; power: number } {
  const emergency = emergencyBlowActive(s);
  const run = (s.hpAir.compressorCmd || emergency) && ctx.busPowered && ctx.airIntakeAvailable;
  s.hpAir.compressorRunning = false;
  if (!run) return { added: 0, power: 0 };
  let remaining = cfg.compressor.massFlow * ctx.dt;
  let added = 0;
  const groups = emergency ? [cfg.banks.filter((b) => bankCircuit(b) === 'emergency'), cfg.banks.filter((b) => bankCircuit(b) === 'normal')] : [cfg.banks];
  for (const banks of groups) {
    const deficits = banks.map((b) => Math.max(0, (Math.min(b.maxPressure, cfg.compressor.maxPressure) * b.volume) / (R_AIR * bankTempK(cfg)) - s.hpAir.banks[b.id].mass));
    const total = deficits.reduce((sum, deficit) => sum + deficit, 0);
    if (total <= 0 || remaining <= 0) continue;
    const supply = Math.min(remaining, total);
    banks.forEach((b, i) => {
      s.hpAir.banks[b.id].mass += (supply * deficits[i]) / total;
    });
    added += supply;
    remaining -= supply;
  }
  s.hpAir.compressorRunning = added > 0;
  return { added, power: added > 0 ? cfg.compressor.power : s.hpAir.compressorCmd ? 0.1 * cfg.compressor.power : 0 };
}
