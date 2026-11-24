/**
 * ESTADO DOS SISTEMAS DA FASE 3 (atmosfera, avarias, distribuição elétrica, navegação com correção,
 * discrição, ameaça de torpedo, rebocadores e instrutor). Todos são opcionais no SimState: o motor os cria
 * com os valores iniciais destas funções (salvamentos antigos e cenários existentes começam neles).
 */
import type { VesselConfig } from '../config/types';
import { defaultAtmosphere, defaultDamage, defaultDistribution, defaultThreat, defaultTugs, type BreakerId } from '../config/extSystems';
import type { Command } from '../commands';

export const M_O2 = 0.032;
export const M_N2 = 0.028;
export const M_CO2 = 0.044;
export const M_H2 = 0.002;
export const M_CO = 0.028;
export const R_GAS = 8.314;

export interface AtmosphereState {
  /** massas no volume livre (kg) */
  o2: number;
  n2: number;
  co2: number;
  h2: number;
  co: number;
  /** equipamentos: absorvedores de CO₂, queimadores de H₂, liberação de O₂ de reserva, ventilador pelo snorkel */
  scrubbers: boolean;
  recombiners: boolean;
  o2Release: boolean;
  ventFan: boolean;
  /** O₂ de reserva restante (kg) */
  o2Stock: number;
  /** diagnósticos do último passo (kg/s, + entrando no ar) */
  rates: { o2: number; co2: number; h2: number; co: number };
  /** renovações por hora pela ventilação no último passo */
  ach: number;
}

export interface FireState {
  intensity: number; // 0..1
  detected: boolean;
  timer: number; // s acima do limiar de detecção
  fighting: boolean;
  temp: number; // °C do compartimento
}

export interface DamageState {
  pumps: Record<string, { cmd: boolean; flow: number; power: number }>;
  doors: Record<string, { open: boolean; flow: number }>;
  fires: Record<string, FireState>;
  /** agente extintor restante (kg) */
  agent: number;
}

export interface DistributionState {
  /** disjuntor fechado (carga alimentada) por carga */
  breakers: Record<BreakerId, boolean>;
  /** rejeição automática de cargas por prioridade */
  autoShed: boolean;
  /** cargas rejeitadas automaticamente (para religar) */
  shed: BreakerId[];
  shedTimer: number;
  batteryTemp: number; // °C
  /** potência térmica da bateria no último passo (W) */
  batteryHeat: number;
}

export interface NavFixState {
  /** instante da última correção de posição (s) e distância percorrida até ela (m) */
  lastFix: number;
  distAtFix: number;
  fixes: number;
  /** correção automática ao expor a antena do GPS */
  autoFix: boolean;
  lastKind: 'inicial' | 'GPS';
  /** erro da correção (desvio-padrão, m) */
  sigma0: number;
}

export interface AircraftState {
  n: number;
  e: number;
  heading: number; // graus
  /** centro da órbita de patrulha (NED) */
  cn: number;
  ce: number;
  /** submarino detectado: instante e posição marcada (datum) */
  detectedAt: number | null;
  datum: { n: number; e: number } | null;
  esmWarned: boolean;
}

export interface StealthState {
  /** segundos com mastro exposto em cada minuto da última hora (60 posições, circular) */
  bins: number[];
  binIndex: number;
  binT: number;
  /** o que está exposto agora */
  exposed: string[];
  aircraft: AircraftState | null;
  detections: number;
  seed: number;
}

export interface HostileTorpedo {
  id: string;
  n: number;
  e: number;
  d: number;
  heading: number; // graus
  speed: number;
  phase: 'busca' | 'ataque' | 'enganado' | 'perdido' | 'impacto' | 'fim';
  /** alvo atual: 'sx1' ou id do despistador */
  target: string | null;
  run: number; // m percorridos
  warhead: 'exercicio' | 'avaria';
  t0: number;
  /** posição do SX-1 no lançamento (ponto de busca) */
  datum: { n: number; e: number };
  /** instante do fim (impacto ou autonomia esgotada) */
  tEnd?: number;
}

export interface DecoyState {
  id: string;
  n: number;
  e: number;
  d: number;
  t0: number;
}

export interface ThreatState {
  torpedoes: HostileTorpedo[];
  decoys: DecoyState[];
  decoyStock: number;
  seq: number;
  /** resultado do último ataque (texto) */
  last: string;
}

export type TugMode = 'livre' | 'empurrar' | 'puxar';
export interface TugState {
  mode: TugMode;
  side: 'BB' | 'BE';
  /** tração ordenada e atual (0..1 da tração máxima) */
  cmd: number;
  level: number;
  /** ângulo do cabo/empurrão em relação à perpendicular ao casco (°, + para vante) */
  angle: number;
  connected: boolean;
}
export interface TugsState {
  tugs: Record<string, TugState>;
  /** força e momento aplicados no último passo (corpo) */
  F: { x: number; y: number; z: number };
  M: { x: number; y: number; z: number };
}

/** condição de um evento programado pelo instrutor */
export interface InstructorCond {
  variable: 'depth' | 'speed' | 'pitch' | 'heading' | 'soc' | 'time';
  op: '>' | '<';
  value: number;
}
export interface InstructorEvent {
  id: string;
  label: string;
  /** dispara em t (s de simulação) ou quando a condição vale */
  at?: number;
  cond?: InstructorCond;
  command: Command;
  fired: boolean;
  firedAt?: number;
}
export interface InstructorState {
  events: InstructorEvent[];
  seq: number;
}

/** volume de gás em mols do ar livre na pressão interna e temperatura do ar */
export function airMoles(cfg: VesselConfig): number {
  const a = cfg.atmosphere ?? defaultAtmosphere();
  return (cfg.internalPressure * a.freeVolume) / (R_GAS * (a.temperature + 273.15));
}

export function initAtmosphere(cfg: VesselConfig): AtmosphereState {
  const n = airMoles(cfg);
  const a = cfg.atmosphere ?? defaultAtmosphere();
  return {
    o2: n * 0.2095 * M_O2,
    n2: n * 0.7901 * M_N2,
    co2: n * 0.0004 * M_CO2,
    h2: 0,
    co: 0,
    scrubbers: true,
    recombiners: true,
    o2Release: false,
    ventFan: true,
    o2Stock: a.o2Stock,
    rates: { o2: 0, co2: 0, h2: 0, co: 0 },
    ach: 0,
  };
}

export function initDamage(cfg: VesselConfig): DamageState {
  const d = cfg.damage ?? defaultDamage();
  const pumps: DamageState['pumps'] = {};
  for (const p of d.bilgePumps) pumps[p.id] = { cmd: false, flow: 0, power: 0 };
  // condição de mergulho: portas estanques fechadas (sem passagem de água entre compartimentos)
  const doors: DamageState['doors'] = {};
  for (const p of d.doors) doors[p.id] = { open: false, flow: 0 };
  const fires: DamageState['fires'] = {};
  for (const c of cfg.compartments) fires[c.id] = { intensity: 0, detected: false, timer: 0, fighting: false, temp: 24 };
  return { pumps, doors, fires, agent: d.fire.agent };
}

export const BREAKER_IDS: BreakerId[] = ['MEP', 'BC', 'BTC', 'BT', 'BB', 'HID', 'COMP', 'ESG', 'HOTEL', 'NAV'];

export function initDistribution(cfg: VesselConfig): DistributionState {
  const d = cfg.distribution ?? defaultDistribution();
  const breakers = Object.fromEntries(BREAKER_IDS.map((b) => [b, true])) as Record<BreakerId, boolean>;
  return { breakers, autoShed: false, shed: [], shedTimer: 0, batteryTemp: d.battery.initialTemp, batteryHeat: 0 };
}

export function initNavFix(t: number, distance: number): NavFixState {
  return { lastFix: t, distAtFix: distance, fixes: 0, autoFix: false, lastKind: 'inicial', sigma0: 10 };
}

export function initStealth(seed: number): StealthState {
  return { bins: new Array(60).fill(0), binIndex: 0, binT: 0, exposed: [], aircraft: null, detections: 0, seed: (seed * 2654435761) >>> 0 || 12345 };
}

export function initThreat(cfg: VesselConfig): ThreatState {
  return { torpedoes: [], decoys: [], decoyStock: (cfg.threat ?? defaultThreat()).decoy.stock, seq: 0, last: '' };
}

export function initTugs(cfg: VesselConfig): TugsState {
  const tugs: TugsState['tugs'] = {};
  for (const t of (cfg.tugs ?? defaultTugs()).tugs) tugs[t.id] = { mode: 'livre', side: 'BE', cmd: 0, level: 0, angle: 0, connected: false };
  return { tugs, F: { x: 0, y: 0, z: 0 }, M: { x: 0, y: 0, z: 0 } };
}

export function initInstructor(): InstructorState {
  return { events: [], seq: 0 };
}

/** frações molares (0..1) do ar interno */
export function atmosphereFractions(a: AtmosphereState): { o2: number; co2: number; h2: number; co: number; n2: number } {
  const n = a.o2 / M_O2 + a.n2 / M_N2 + a.co2 / M_CO2 + a.h2 / M_H2 + a.co / M_CO;
  if (!(n > 0)) return { o2: 0, co2: 0, h2: 0, co: 0, n2: 0 };
  return { o2: a.o2 / M_O2 / n, co2: a.co2 / M_CO2 / n, h2: a.h2 / M_H2 / n, co: a.co / M_CO / n, n2: a.n2 / M_N2 / n };
}
