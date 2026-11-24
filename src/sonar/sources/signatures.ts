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
/** Parcelas do ruído próprio (mesma escala de ownNoise), por fonte — tela Discrição. */
export function ownNoiseSources(s: SimState): { id: string; name: string; level: number }[] {
  const speed = Math.hypot(s.body.vel.x, s.body.vel.y, s.body.vel.z);
  const diesel = Object.values(s.electrical.generators).filter((g) => ['PARTINDO', 'EM CARGA', 'PARANDO'].includes(g.status)).length;
  const pumps = [s.compensation.pump, s.compensation.transfer?.pump, s.trim.pump, s.heel.pump].reduce((a, p) => a + (p?.speed ?? 0), 0);
  const bilge = Object.values(s.damage?.pumps ?? {}).filter((p) => p.power > 0).length;
  const list = [
    { id: 'base', name: 'Ruído de fundo da plataforma', level: 35 },
    { id: 'flow', name: 'Escoamento no casco (velocidade)', level: 30 + 30 * Math.log10(1 + speed) },
    { id: 'shaft', name: 'Hélice e linha de eixo (rotação)', level: 30 + 20 * Math.log10(1 + Math.abs(s.propulsion.omega)) },
    { id: 'diesel', name: 'Diesel-geradores', level: diesel ? 66 + 10 * Math.log10(diesel) : -100 },
    { id: 'pumps', name: 'Bombas de compensação, trim e banda', level: pumps ? 46 + 10 * Math.log10(pumps) : -100 },
    { id: 'comp', name: 'Compressor de ar AP', level: s.hpAir.compressorRunning ? 55 : -100 },
    { id: 'hyd', name: 'Bomba hidráulica', level: s.hydraulics.pumpOn ? 43 : -100 },
  ];
  // bombas de esgoto só entram quando ligadas (mantém o ruído dos cenários existentes)
  if (bilge) list.push({ id: 'bilge', name: 'Bombas de esgoto', level: 50 + 10 * Math.log10(bilge) });
  return list;
}

export function ownNoise(s: SimState): number {
  return sumDb(...ownNoiseSources(s).map((x) => x.level));
}
