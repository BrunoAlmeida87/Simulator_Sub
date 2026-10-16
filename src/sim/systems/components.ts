/**
 * Componentes genéricos com estados transitórios: válvulas e bombas.
 *
 * Válvula: a posição real se move em direção à comandada com velocidade
 * 1/t_curso (curso completo em t_curso segundos). Sem energia hidráulica
 * (quando aplicável) ou travada por falha, permanece na posição atual.
 *
 * Bomba centrífuga simplificada (leis de afinidade):
 *   Q(Δp) = s·Q₀·√(1 − Δp/(s²·Δp₀))       (s = rotação relativa)
 *   P_elét = Q·Δp/η + P₀·s
 * A rotação acelera/desacelera linearmente em t_partida segundos.
 */
import type { PumpConfig, ValveConfig } from '../config/types';
import type { PumpState, ValveState } from '../core/state';

export type ValveStatus = 'ABERTA' | 'FECHADA' | 'ABRINDO' | 'FECHANDO' | 'PARCIAL' | 'TRAVADA';

/** Atualiza a válvula; retorna a fração de curso percorrida (para consumo hidráulico). */
export function updateValve(cfg: ValveConfig, st: ValveState, dt: number, actuationAvailable: boolean): number {
  if (st.stuck || !actuationAvailable) return 0;
  const target = Math.min(1, Math.max(0, st.cmd));
  const d = target - st.pos;
  if (d === 0) return 0;
  const step = dt / Math.max(0.05, cfg.strokeTime);
  const moved = Math.min(Math.abs(d), step);
  st.pos += Math.sign(d) * moved;
  if (Math.abs(target - st.pos) < 1e-9) st.pos = target;
  return moved;
}

export function valveStatus(st: ValveState): ValveStatus {
  if (st.stuck) return 'TRAVADA';
  if (st.pos >= 0.999 && st.cmd >= 0.999) return 'ABERTA';
  if (st.pos <= 0.001 && st.cmd <= 0.001) return 'FECHADA';
  if (st.cmd > st.pos + 1e-6) return 'ABRINDO';
  if (st.cmd < st.pos - 1e-6) return 'FECHANDO';
  return 'PARCIAL';
}

export type PumpStatus = 'PARADA' | 'PARTINDO' | 'OPERANDO' | 'PARANDO' | 'FALHA' | 'SEM ENERGIA';

export function updatePumpSpeed(cfg: PumpConfig, st: PumpState, dt: number, powered: boolean): void {
  const target = st.cmd && powered && !st.failed ? 1 : 0;
  const rate = dt / Math.max(0.1, cfg.spinUpTime);
  if (st.speed < target) st.speed = Math.min(target, st.speed + rate);
  else if (st.speed > target) st.speed = Math.max(target, st.speed - rate * 1.5);
}

export function pumpStatus(st: PumpState, powered: boolean): PumpStatus {
  if (st.failed) return 'FALHA';
  if (st.cmd && !powered) return 'SEM ENERGIA';
  if (st.cmd && st.speed < 0.999) return 'PARTINDO';
  if (st.cmd) return 'OPERANDO';
  if (st.speed > 0.001) return 'PARANDO';
  return 'PARADA';
}

/** Vazão (m³/s) da bomba contra o diferencial Δp (Pa). */
export function pumpFlow(cfg: PumpConfig, speed: number, dp: number): number {
  if (speed <= 1e-4) return 0;
  const H = speed * speed * cfg.shutoffPressure;
  if (dp >= H) return 0;
  const q = speed * cfg.ratedFlow * Math.sqrt(1 - dp / H);
  return Math.min(q, 1.25 * speed * cfg.ratedFlow);
}

/**
 * Vazão com perda de carga quadrática na linha: Δp_total = Δp_est + k·Q², k = perda/Q₀².
 * Solução fechada de Q² (1 + Q₀²k/H) = s²Q₀² (1 − Δp_est/H).
 */
export function pumpFlowWithLine(cfg: PumpConfig, speed: number, dpStatic: number, lineLossAtRated: number): number {
  if (speed <= 1e-4) return 0;
  const H = speed * speed * cfg.shutoffPressure;
  const k = lineLossAtRated / (cfg.ratedFlow * cfg.ratedFlow);
  const rhs = speed * speed * cfg.ratedFlow * cfg.ratedFlow * (1 - dpStatic / H);
  if (rhs <= 0) return 0;
  const q = Math.sqrt(rhs / (1 + (cfg.ratedFlow * cfg.ratedFlow * k) / H));
  return Math.min(q, 1.25 * speed * cfg.ratedFlow);
}

export function pumpPower(cfg: PumpConfig, speed: number, flow: number, dp: number): number {
  if (speed <= 1e-4) return 0;
  return (flow * Math.max(0, dp)) / cfg.efficiency + cfg.noLoadPower * speed;
}
