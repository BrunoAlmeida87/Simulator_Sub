/**
 * LINHA DE EIXO (só desenho): motor elétrico principal → mancal de escora → eixo → hélice.
 *
 * Motor de ímã permanente com acionamento direto (sem redutor), como o dos Scorpène: grande
 * diâmetro e curto, no eixo do casco, à vante dos diesel-geradores e acima do tanque de trim
 * de ré. O mancal de escora, logo a ré do motor (acima dos geradores), transmite o empuxo do
 * hélice ao casco. O eixo atravessa a antepara resistente de ré (bucim), passa entre as duas
 * metades do TLP-2 e segue no tubo telescópico até o cubo do hélice.
 *
 * Valores coerentes com a física (src/sim/config/defaultVessel.ts → propulsion.motor: 3 MW a
 * 160 rpm, 215 kN·m): eixo de Ø 0,30 m (τ ≈ 40 MPa no torque máximo). Usado pelo interior do
 * Blender (exportar_interior.ts → build_sx1_interior.py); o teste tests/systemsLayout.test.ts
 * garante que nada do corte do site encosta nele. Coordenadas do corpo: x para vante (m).
 */
export const SHAFT_LINE = {
  /** motor elétrico principal: faces de ré/vante (x) e raio externo da carcaça (m) */
  motor: { aft: -15.5, fwd: -12.5, radius: 1.2 },
  /** mancal de escora: centro (x), comprimento e raio do corpo (m) */
  thrustBearing: { x: -17.0, length: 0.9, radius: 0.55 },
  /** raio do eixo (m) */
  shaftRadius: 0.15,
  /** mancal de apoio (x) no tubo telescópico, a ré do TLP-2 */
  supportBearing: { x: -29.5 },
  /** ponta de ré do eixo: face de vante do cubo do hélice (x, m) */
  aftEnd: -34.85,
} as const;

/** Distância de um ponto do corpo (x, y, z) ao eixo do casco (y = z = 0). */
export function axisDistance(y: number, z: number): number {
  return Math.hypot(y, z);
}

/**
 * Raio livre exigido em torno do eixo na posição x (envoltória da linha de eixo):
 * carcaça do motor, corpo do mancal de escora ou o próprio eixo. 0 fora da linha.
 */
export function shaftEnvelope(x: number): number {
  const S = SHAFT_LINE;
  if (x >= S.motor.aft && x <= S.motor.fwd) return S.motor.radius;
  const tb = S.thrustBearing;
  if (Math.abs(x - tb.x) <= tb.length / 2) return tb.radius;
  if (x < S.motor.aft && x >= S.aftEnd) return S.shaftRadius;
  return 0;
}
