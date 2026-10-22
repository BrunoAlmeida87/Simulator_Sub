import type { SimulationEngine } from '../sim/core/engine';

/** Situação de navegação resumida (texto e classe de cor) a partir do estado físico. */
export function navStatus(e: SimulationEngine): { label: string; cls: 'ok' | 'info' | 'warn' | 'alarm' } {
  const s = e.state;
  const o = e.outputs;
  const tanks = e.vessel.ballast.tanks;
  const fill = tanks.reduce((a, t) => a + s.ballast[t.id].water, 0) / tanks.reduce((a, t) => a + t.volume, 0);
  const venting = tanks.some((t) => s.ballast[t.id].vent.pos > 0.1 && s.ballast[t.id].water < t.volume * 0.98);
  const blowing = tanks.some((t) => s.ballast[t.id].mdotBlow + s.ballast[t.id].mdotEmergencyBlow > 0.01);
  const vz = o.verticalSpeed;
  if (s.contact) return { label: 'CONTATO COM O FUNDO', cls: 'alarm' };
  if (blowing) return { label: 'EMERGINDO — soprando os TLP', cls: 'warn' };
  if (venting) return { label: 'IMERGINDO — TLP alagando', cls: 'warn' };
  if (o.surfaced && fill < 0.5) return { label: Math.abs(s.body.vel.x) > 0.3 ? 'NAVEGANDO NA SUPERFÍCIE' : 'NA SUPERFÍCIE', cls: 'info' };
  if (vz > 0.15) return { label: 'DESCENDO', cls: 'warn' };
  if (vz < -0.15) return { label: fill < 0.6 ? 'EMERGINDO' : 'SUBINDO', cls: 'warn' };
  if (o.depthKeel < 18) return { label: 'COTA PERISCÓPICA', cls: 'info' };
  return { label: Math.abs(s.body.vel.x) > 0.3 ? 'SUBMERSO — NAVEGANDO' : 'SUBMERSO — PAIRANDO', cls: 'ok' };
}
