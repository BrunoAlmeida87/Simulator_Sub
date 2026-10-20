/**
 * CALADOS E TRIM — grandezas calculadas a partir do estado (para exibição):
 * calado a vante e a ré nas marcas de calado pintadas no casco, trim
 * (diferença de calados), rigidez de trim e a razão entre a rigidez atual e a
 * submersa (explica por que o trim quase não aparece na superfície).
 *
 * Calado = profundidade da linha de base (fundo do cilindro, z = +R no
 * corpo) na posição da marca, em relação ao nível médio do mar (sem ondas).
 */
import type { SimulationEngine } from './core/engine';
import { qToMat3 } from './core/math';

/** posições longitudinais (m, corpo) das marcas de calado pintadas (trechos cilíndricos do casco) */
export const DRAFT_MARK_X = { fwd: 25, aft: -13.4 };

export interface DraftInfo {
  fwd: number; // calado a vante (m)
  aft: number; // calado a ré (m)
  mean: number;
  /** trim = calado AR − calado AV (m); + = pela popa (proa para cima) */
  trim: number;
  /** distância entre as marcas (m) */
  span: number;
  pitch: number; // graus (+ proa para cima)
  surfaced: boolean;
  /** rigidez de trim atual (N·m/rad) e a que teria submerso (W·BG) */
  stiffness: number;
  submergedStiffness: number;
  /** quantas vezes mais rígido que submerso */
  ratio: number;
  /** momento para variar o trim de 1 cm entre as marcas (t·m/cm) */
  mtc: number;
}

export function draftInfo(e: SimulationEngine): DraftInfo {
  const R = qToMat3(e.state.body.quat);
  const p = e.state.body.pos;
  const rb = e.vessel.hull.diameter / 2;
  const depth = (x: number) => p.z + R[6] * x + R[8] * rb;
  const fwd = depth(DRAFT_MARK_X.fwd);
  const aft = depth(DRAFT_MARK_X.aft);
  const span = DRAFT_MARK_X.fwd - DRAFT_MARK_X.aft;
  const o = e.outputs;
  const g = e.env.cfg.gravity;
  const W = o.mp.mass * g;
  const sub = Math.max(1, W * Math.max(0.01, e.vessel.mass.designBG));
  const k = o.pitchStiffness;
  return {
    fwd,
    aft,
    mean: (fwd + aft) / 2,
    trim: aft - fwd,
    span,
    pitch: o.euler.pitch,
    surfaced: o.surfaced,
    stiffness: k,
    submergedStiffness: sub,
    ratio: k / sub,
    // Δtrim de 0,01 m entre as marcas ⇔ Δθ = 0,01/span rad ⇔ M = K·0,01/span
    mtc: (k * 0.01) / span / (g * 1000),
  };
}
