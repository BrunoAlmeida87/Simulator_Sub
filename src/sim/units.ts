/** Conversões de unidades usadas na interface. */
export const KNOT = 1852 / 3600; // m/s
export const toKnots = (ms: number) => ms / KNOT;
export const BAR = 1e5;
export const toBar = (pa: number) => pa / BAR;
export const tonnes = (kg: number) => kg / 1000;
