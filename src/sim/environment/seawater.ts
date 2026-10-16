/**
 * Equação de estado da água do mar — UNESCO EOS-80 (Millero & Poisson, 1981;
 * Fofonoff & Millard, 1983, "Algorithms for computation of fundamental
 * properties of seawater", UNESCO Tech. Pap. Mar. Sci. 44).
 *
 *   ρ(S, T, p) = ρ(S, T, 0) / (1 − p / K(S, T, p))
 *
 * S = salinidade prática (PSU), T = temperatura (°C), p = pressão manométrica
 * do mar em BAR (pressão absoluta − pressão atmosférica).
 *
 * Valores de verificação publicados (usados nos testes):
 *   ρ(35, 5, 0)    = 1027.67547 kg/m³
 *   ρ(35, 5, 1000) = 1069.48914 kg/m³
 *   ρ(35, 25, 1000)= 1062.53817 kg/m³
 */

/** Densidade da água pura padrão (SMOW) em kg/m³. */
function rhoPureWater(T: number): number {
  return (
    999.842594 +
    6.793952e-2 * T -
    9.09529e-3 * T * T +
    1.001685e-4 * T ** 3 -
    1.120083e-6 * T ** 4 +
    6.536332e-9 * T ** 5
  );
}

/** Densidade à pressão atmosférica (p = 0). */
export function seawaterDensitySurface(S: number, T: number): number {
  const A = 0.824493 - 4.0899e-3 * T + 7.6438e-5 * T * T - 8.2467e-7 * T ** 3 + 5.3875e-9 * T ** 4;
  const B = -5.72466e-3 + 1.0227e-4 * T - 1.6546e-6 * T * T;
  const C = 4.8314e-4;
  return rhoPureWater(T) + A * S + B * S ** 1.5 + C * S * S;
}

/** Módulo volumétrico secante K(S, T, p) em bar. */
export function secantBulkModulus(S: number, T: number, pBar: number): number {
  const Kw = 19652.21 + 148.4206 * T - 2.327105 * T * T + 1.360477e-2 * T ** 3 - 5.155288e-5 * T ** 4;
  const K0 =
    Kw +
    S * (54.6746 - 0.603459 * T + 1.09987e-2 * T * T - 6.167e-5 * T ** 3) +
    S ** 1.5 * (7.944e-2 + 1.6483e-2 * T - 5.3009e-4 * T * T);
  const Aw = 3.239908 + 1.43713e-3 * T + 1.16092e-4 * T * T - 5.77905e-7 * T ** 3;
  const A = Aw + S * (2.2838e-3 - 1.0981e-5 * T - 1.6078e-6 * T * T) + 1.91075e-4 * S ** 1.5;
  const Bw = 8.50935e-5 - 6.12293e-6 * T + 5.2787e-8 * T * T;
  const B = Bw + S * (-9.9348e-7 + 2.0816e-8 * T + 9.1697e-10 * T * T);
  return K0 + A * pBar + B * pBar * pBar;
}

/** Densidade in situ (kg/m³). pBar = pressão manométrica do mar em bar. */
export function seawaterDensity(S: number, T: number, pBar: number): number {
  const rho0 = seawaterDensitySurface(S, T);
  if (pBar <= 0) return rho0;
  return rho0 / (1 - pBar / secantBulkModulus(S, T, pBar));
}
