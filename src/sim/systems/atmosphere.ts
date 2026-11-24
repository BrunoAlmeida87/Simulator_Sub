/**
 * ATMOSFERA INTERNA — um único volume de ar livre no casco resistente (sem divisão por compartimento).
 *
 *   dm_O₂/dt  = −n·ṁ_O₂ + liberação de reserva − incêndio + ventilação
 *   dm_CO₂/dt = +n·ṁ_CO₂ − k_abs·x_CO₂ + incêndio + ventilação
 *   dm_H₂/dt  = gaseificação da recarga (I·k_H₂·f(SoC)) − k_queim·x_H₂ + ventilação
 *   dm_CO/dt  = incêndio + ventilação
 *   ventilação: m_i → m_i,ext com taxa ACH/3600 (válvula de cabeça do snorkel aberta)
 *
 * n = tripulação + cargas "pessoas". As frações são molares; o total de mols fica ≈ o da pressão interna.
 * Não altera massa, CG nem energia do navio (os gases pesam poucos quilos; os equipamentos fazem parte da
 * carga de habitabilidade HOTEL). Valores fictícios — ver docs/PARAMETROS.md.
 */
import type { VesselConfig } from '../config/types';
import { defaultAtmosphere, defaultDamage } from '../config/extSystems';
import type { SimState } from '../core/state';
import { airMoles, atmosphereFractions, initAtmosphere, M_CO2, M_N2, M_O2 } from '../core/extState';

/** pessoas a bordo: tripulação configurada + cargas da categoria "pessoas" */
export function peopleAboard(cfg: VesselConfig, s: SimState): number {
  const a = cfg.atmosphere ?? defaultAtmosphere();
  let n = a.crew;
  for (const c of s.cargoLoads ?? []) if (c.category === 'pessoas') n += c.quantity;
  return Math.max(0, n);
}

/** renovações de ar por hora agora (válvula de cabeça aberta: ventilador e diesels em carga) */
export function ventilationAch(cfg: VesselConfig, s: SimState, powered: boolean): number {
  if (!s.snorkel.headValveOpen || !s.atmosphere) return 0;
  const a = cfg.atmosphere ?? defaultAtmosphere();
  let diesels = 0;
  for (const g of Object.values(s.electrical.generators)) if (g.status === 'EM CARGA') diesels++;
  return (s.atmosphere.ventFan && powered ? a.ventAch : 0) + a.dieselAch * diesels;
}

/**
 * Taxas (kg/s, + entrando no ar) sem a ventilação: pessoas, O₂ de reserva (se liberando), absorvedores,
 * gaseificação da recarga, queimadores e incêndios. Função pura: o passo e as telas usam a mesma conta.
 */
export function atmosphereRates(cfg: VesselConfig, s: SimState, powered: boolean): { o2: number; co2: number; h2: number; co: number } {
  const at = s.atmosphere;
  if (!at) return { o2: 0, co2: 0, h2: 0, co: 0 };
  const a = cfg.atmosphere ?? defaultAtmosphere();
  const x = atmosphereFractions(at);
  const people = peopleAboard(cfg, s);
  let dO2 = -people * a.o2Use;
  let dCO2 = people * a.co2Make;
  let dH2 = 0;
  let dCO = 0;
  if (at.o2Release && at.o2Stock > 0) dO2 += a.o2Rate;
  if (at.scrubbers && powered) dCO2 -= a.scrubberRate * x.co2;
  // gaseificação no fim da recarga (corrente negativa = recarga)
  const I = s.electrical.current;
  if (I < 0 && s.electrical.soc > a.gassingSoc) dH2 += (a.h2PerAh * -I * ((s.electrical.soc - a.gassingSoc) / Math.max(1e-6, 1 - a.gassingSoc))) / 3600;
  if (at.recombiners && powered) dH2 -= a.recombinerRate * x.h2;
  // incêndios (controle de avarias)
  const f = (cfg.damage ?? defaultDamage()).fire;
  for (const fire of Object.values(s.damage?.fires ?? {})) {
    if (fire.intensity <= 0) continue;
    const oxy = Math.max(0, Math.min(1.3, (x.o2 - 0.12) / (0.2095 - 0.12)));
    dO2 -= f.o2Use * fire.intensity * oxy;
    dCO2 += f.co2Make * fire.intensity * oxy;
    dCO += f.coMake * fire.intensity;
  }
  return { o2: dO2, co2: dCO2, h2: dH2, co: dCO };
}

export function updateAtmosphere(cfg: VesselConfig, s: SimState, dt: number, powered: boolean): void {
  const at = (s.atmosphere ??= initAtmosphere(cfg));
  const a = cfg.atmosphere ?? defaultAtmosphere();
  const r = atmosphereRates(cfg, s, powered);
  let dO2 = r.o2;
  const dCO2 = r.co2;
  const dH2 = r.h2;
  const dCO = r.co;
  // reserva de O₂: limitada ao que resta no passo
  if (at.o2Release && at.o2Stock > 0) {
    const used = Math.min(a.o2Rate, at.o2Stock / dt);
    dO2 += used - a.o2Rate;
    at.o2Stock = Math.max(0, at.o2Stock - used * dt);
    if (at.o2Stock <= 0) at.o2Release = false;
  }
  at.rates = { o2: dO2, co2: dCO2, h2: dH2, co: dCO };
  at.o2 = Math.max(0, at.o2 + dO2 * dt);
  at.co2 = Math.max(0, at.co2 + dCO2 * dt);
  at.h2 = Math.max(0, at.h2 + dH2 * dt);
  at.co = Math.max(0, at.co + dCO * dt);
  // ventilação pelo snorkel: mistura com o ar externo mantendo o total de mols da pressão interna
  const ach = ventilationAch(cfg, s, powered);
  at.ach = ach;
  if (ach > 0) {
    const k = 1 - Math.exp((-ach / 3600) * dt);
    const n = airMoles(cfg);
    at.o2 += k * (n * 0.2095 * M_O2 - at.o2);
    at.n2 += k * (n * 0.7901 * M_N2 - at.n2);
    at.co2 += k * (n * 0.0004 * M_CO2 - at.co2);
    at.h2 += k * (0 - at.h2);
    at.co += k * (0 - at.co);
  }
}

/**
 * Autonomia estimada com as taxas atuais (horas) até O₂ < 17 % ou CO₂ > 3 % (o que vier antes);
 * Infinity se nenhuma das duas piora.
 */
export function atmosphereEndurance(cfg: VesselConfig, s: SimState, powered = s.electrical.energized && (s.distribution?.breakers.HOTEL ?? true)): { hours: number; limit: 'O₂' | 'CO₂' | null } {
  const at = s.atmosphere;
  if (!at) return { hours: Infinity, limit: null };
  const n = airMoles(cfg);
  // sem ventilação (pior caso submerso): as taxas atuais de consumo e produção
  const r = atmosphereRates(cfg, s, powered);
  const tO2 = r.o2 < 0 ? (at.o2 - 0.17 * n * M_O2) / -r.o2 : Infinity;
  const tCO2 = r.co2 > 0 ? (0.03 * n * M_CO2 - at.co2) / r.co2 : Infinity;
  const t = Math.max(0, Math.min(tO2, tCO2));
  return { hours: t / 3600, limit: !Number.isFinite(t) ? null : tO2 <= tCO2 ? 'O₂' : 'CO₂' };
}

/** CO em ppm e as demais frações em % (para telas e alarmes) */
export function atmospherePercent(s: SimState): { o2: number; co2: number; h2: number; coPpm: number } | null {
  if (!s.atmosphere) return null;
  const x = atmosphereFractions(s.atmosphere);
  return { o2: x.o2 * 100, co2: x.co2 * 100, h2: x.h2 * 100, coPpm: x.co * 1e6 };
}
