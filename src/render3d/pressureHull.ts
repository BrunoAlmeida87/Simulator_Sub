/**
 * CASCO RESISTENTE (só desenho): onde o corte posiciona tanques, tubulações, válvulas e bombas.
 *
 * Raio interno = o da física (hullRadius dos tanques internos, 2,9 m). Nas pontas, as anteparas
 * resistentes em domo ficam logo antes dos tanques de lastro principais (TLP): os TLP ficam FORA
 * do casco resistente, entre a antepara e o casco externo. A ré o casco resistente afina junto com
 * o casco externo (12 cm de folga e 5 cm de chapa).
 *
 * O modelo do Blender (scripts/blender/build_sx1_interior.py) lê estes mesmos números pelo
 * exportar_interior.ts; o teste tests/systemsLayout.test.ts confere que nada do corte sai daqui.
 */
export const PRESSURE_HULL = {
  /** raio interno no corpo cilíndrico (m) */
  innerRadius: 2.9,
  /** espessura da chapa (m) */
  thickness: 0.05,
  /** folga até o casco externo onde ele afina (m) */
  gap: 0.12,
  /** antepara de vante: base (x, m) e flecha do domo (m) */
  fwd: { base: 24.7, depth: 0.75 },
  /** antepara de ré: base (x, m) e flecha do domo (m) */
  aft: { base: -19.9, depth: 0.6 },
} as const;

/** Raio interno do casco resistente na posição x (afina a ré com o casco externo). */
export function pressureHullInner(x: number, outerRadiusAt: (x: number) => number): number {
  const P = PRESSURE_HULL;
  return Math.min(P.innerRadius, outerRadiusAt(x) - P.gap - P.thickness);
}

/** true se a posição longitudinal x fica entre as duas anteparas (dentro do casco resistente). */
export function insidePressureHullX(x: number): boolean {
  return x > PRESSURE_HULL.aft.base && x < PRESSURE_HULL.fwd.base;
}
