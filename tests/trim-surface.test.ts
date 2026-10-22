/**
 * TRIMAGEM NA SUPERFÍCIE — a resposta calculada é comparada com a esperada
 * pela hidrostática. Na superfície a rigidez de trim vem do momento de
 * inércia do plano de flutuação (ρ·g·I_L), ~100 vezes maior que a submersa
 * (W·BG): o mesmo momento produz um ângulo ~100 vezes menor. Não é erro da
 * física; é preciso referência visual (marcas de calado) ou ampliação.
 */
import { describe, it, expect } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { draftInfo, DRAFT_MARK_X } from '../src/sim/drafts';
import type { SimulationEngine } from '../src/sim/core/engine';

/** momento de inércia longitudinal do plano de flutuação (m⁴) a partir das fatias do casco */
function waterplaneIL(e: SimulationEngine): number {
  const zAxis = e.state.body.pos.z;
  const rows = e.geom.slices.map((s) => ({ x: s.x, b: s.r > zAxis ? 2 * Math.sqrt(s.r * s.r - zAxis * zAxis) : 0, dx: s.dx }));
  const A = rows.reduce((a, r) => a + r.b * r.dx, 0);
  const xF = rows.reduce((a, r) => a + r.b * r.x * r.dx, 0) / A;
  return rows.reduce((a, r) => a + r.b * (r.x - xF) ** 2 * r.dx, 0);
}

function shiftWeight(scenario: string) {
  const e = buildScenario(scenario);
  applyCommand(e, { type: 'seaState', value: 0 });
  e.advanceSim(300);
  const d0 = draftInfo(e);
  const g = e.env.cfg.gravity;
  const W = e.outputs.mp.mass * g;
  const Kexp = e.outputs.surfaced ? e.outputs.rhoLocal * g * waterplaneIL(e) + W * e.outputs.BG : W * e.outputs.BG;
  const Kmotor = e.outputs.pitchStiffness;
  applyCommand(e, { type: 'demoWeight', x: 25 }); // 5 t de x = 2 m para x = 25 m
  e.advanceSim(900);
  const d1 = draftInfo(e);
  const M = 5000 * g * 23;
  return { d0, d1, Kexp, Kmotor, dThetaExp: (-M / Kexp) * (180 / Math.PI), dTheta: d1.pitch - d0.pitch };
}

describe('Trimagem na superfície: calculado × esperado', () => {
  const surf = shiftWeight('superficie');
  const sub = shiftWeight('pairando');

  it('rigidez de trim do motor confere com ρ·g·I_L + W·BG (superfície) e W·BG (submerso)', () => {
    expect(Math.abs(surf.Kmotor / surf.Kexp - 1)).toBeLessThan(0.1);
    expect(Math.abs(sub.Kmotor / sub.Kexp - 1)).toBeLessThan(0.02);
    expect(surf.Kmotor / sub.Kmotor).toBeGreaterThan(80);
  });

  it('peso de 5 t levado 23 m a vante: Δθ simulado ≈ previsto (proa desce) nos dois casos', () => {
    expect(surf.dTheta).toBeLessThan(0);
    expect(Math.abs(surf.dTheta / surf.dThetaExp - 1)).toBeLessThan(0.15);
    expect(Math.abs(sub.dTheta / sub.dThetaExp - 1)).toBeLessThan(0.05);
    // na superfície o ângulo é ~100 vezes menor
    expect(Math.abs(sub.dTheta / surf.dTheta)).toBeGreaterThan(60);
  });

  it('calados nas marcas: proa afunda e popa sobe alguns centímetros (coerentes com o ângulo)', () => {
    const dF = surf.d1.fwd - surf.d0.fwd;
    const dA = surf.d1.aft - surf.d0.aft;
    expect(dF).toBeGreaterThan(0.01);
    expect(dA).toBeLessThan(0);
    const span = DRAFT_MARK_X.fwd - DRAFT_MARK_X.aft;
    const dTrimFromAngle = -Math.tan((surf.dTheta * Math.PI) / 180) * span;
    expect(surf.d1.trim - surf.d0.trim).toBeCloseTo(-dTrimFromAngle, 2);
    expect(Math.abs(surf.d1.trim - surf.d0.trim)).toBeLessThan(0.15); // poucos centímetros
    expect(surf.d1.ratio).toBeGreaterThan(80);
  });
});
