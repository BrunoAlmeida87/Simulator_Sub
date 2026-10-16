/**
 * Contexto de um passo de integração: dados derivados compartilhados por
 * todos os módulos durante o passo (pose, ambiente, disponibilidade de
 * energia elétrica e hidráulica).
 */
import type { Mat3, Vec3 } from './math';
import type { VesselConfig } from '../config/types';
import type { Environment } from '../environment/environment';
import type { HullGeometry } from '../physics/hullGeometry';

export const R_AIR = 287.05; // J/(kg·K)
export const GAMMA_AIR = 1.4;
export const RHO_NOMINAL = 1025; // kg/m³ — conversão massa↔volume dentro do casco

export interface StepContext {
  cfg: VesselConfig;
  env: Environment;
  geom: HullGeometry;
  dt: number;
  t: number;
  R: Mat3;
  pos: Vec3;
  /** profundidade (m, NED) de um ponto dado no referencial do corpo */
  depthOf: (p: Vec3) => number;
  busPowered: boolean;
  /** fator 0..1 de disponibilidade hidráulica para atuadores */
  hydraulicFactor: number;
  rhoLocal: number;
  seaTempK: number;
  airIntakeAvailable: boolean;
  /** consumo hidráulico acumulado no passo (Pa) */
  hydraulicDemand: number;
  log: (text: string, group: string) => void;
}

export function makeDepthOf(pos: Vec3, R: Mat3): (p: Vec3) => number {
  return (p: Vec3) => pos.z + R[6] * p.x + R[7] * p.y + R[8] * p.z;
}
