import type { Contact } from '../../sim/geo';
import type { SimState } from '../../sim/core/state';
import { sumDb, type SourceOverride } from '../types';
export interface Signature {
  category: string;
  level: number;
  tones: number[];
  shaftHz: number;
  blades: number;
  targetStrength: number;
}
/** Entirely synthetic generic library, not measured military signatures. */
export const LIBRARY: Record<Contact['kind'], Signature> = {
  mercante: { category: 'Mercante', level: 158, tones: [32, 64, 96, 192], shaftHz: 1.8, blades: 5, targetStrength: 22 },
  pesqueiro: { category: 'Pesqueiro', level: 142, tones: [55, 110, 165, 220], shaftHz: 4.2, blades: 3, targetStrength: 10 },
  rebocador: { category: 'Rebocador', level: 151, tones: [44, 88, 132, 264], shaftHz: 3.1, blades: 4, targetStrength: 15 },
  patrulha: { category: 'Embarcação rápida', level: 149, tones: [75, 150, 225, 300], shaftHz: 5.5, blades: 5, targetStrength: 15 },
};
export function signature(c: Contact, override: SourceOverride = {}): Signature {
  const base = LIBRARY[c.kind];
  const ratio = 0.75 + Math.abs(c.speed) * 0.055;
  const powered = override.propulsion !== false;
  return {
    ...base,
    level: (override.level ?? base.level + 12 * Math.log10(1 + Math.abs(c.speed) / 3)) - (powered ? 0 : 30),
    tones: powered ? (override.tones ?? base.tones.map((f) => f * ratio)) : [],
    shaftHz: powered ? (override.shaftHz ?? base.shaftHz * ratio) : 0,
    blades: override.blades ?? base.blades,
  };
}
export function ownNoise(s: SimState): number {
  const speed = Math.hypot(s.body.vel.x, s.body.vel.y, s.body.vel.z);
  const diesel = Object.values(s.electrical.generators).filter((g) => ['PARTINDO', 'EM CARGA', 'PARANDO'].includes(g.status)).length;
  const pumps = [s.compensation.pump, s.compensation.transfer?.pump, s.trim.pump, s.heel.pump].reduce((a, p) => a + (p?.speed ?? 0), 0);
  return sumDb(
    35,
    30 + 30 * Math.log10(1 + speed),
    30 + 20 * Math.log10(1 + Math.abs(s.propulsion.omega)),
    diesel ? 66 + 10 * Math.log10(diesel) : -100,
    pumps ? 46 + 10 * Math.log10(pumps) : -100,
    s.hpAir.compressorRunning ? 55 : -100,
    s.hydraulics.pumpOn ? 43 : -100,
  );
}
