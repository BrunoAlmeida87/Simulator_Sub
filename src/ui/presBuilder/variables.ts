/**
 * VARIÁVEIS AO VIVO do Estúdio de apresentações: o que pode aparecer no texto
 * ({prof}, {Δpeso:2}…), nos mostradores sobre a cena e nas condições que
 * fazem a apresentação avançar. Tudo lido do estado calculado pelo motor.
 */
import type { SimulationEngine } from '../../sim/core/engine';
import { verticalBalance, hydroArrows, toTf } from '../../sim/forceVectors';
import { tankVolume } from '../../sim/systems/internalTanks';
import { toKnots } from '../../sim/units';
import { visibleAlarms } from '../../sim/systems/alarms';

export interface VarCtx {
  /** s de simulação desde o início da etapa */
  tStep: number;
  /** manobra rápida (Imergir/Emergir) em andamento */
  maneuver: boolean;
}

export interface PresVar {
  id: string;
  label: string;
  unit: string;
  dec: number;
  group: string;
  /** 0/1 (mostrado como sim/não; condições "é sim" / "é não") */
  bool?: boolean;
  get: (e: SimulationEngine, c: VarCtx) => number;
}

const mbtFill = (e: SimulationEngine) => e.vessel.ballast.tanks.reduce((a, t) => a + e.state.ballast[t.id].water, 0) / e.vessel.ballast.tanks.reduce((a, t) => a + t.volume, 0);
const vb = (e: SimulationEngine) => verticalBalance(e);
const b = (x: boolean) => (x ? 1 : 0);
const hydroKN = (e: SimulationEngine, id: string) => (hydroArrows(e).find((h) => h.id === id)?.magnitudeN ?? 0) / 1000;
const dosing = (e: SimulationEngine) => (['compensation', 'trim', 'heel'] as const).some((s) => !!e.state[s].dosing?.active);

export const PRES_VARS: PresVar[] = [
  // movimento
  { id: 'prof', label: 'Profundidade (quilha)', unit: 'm', dec: 1, group: 'Movimento', get: (e) => e.outputs.depthKeel },
  { id: 'vz', label: 'Velocidade vertical (+ desce)', unit: 'm/s', dec: 2, group: 'Movimento', get: (e) => e.outputs.verticalSpeed },
  { id: 'vel', label: 'Velocidade', unit: 'nós', dec: 1, group: 'Movimento', get: (e) => toKnots(e.state.body.vel.x) },
  { id: 'rumo', label: 'Rumo', unit: '°', dec: 0, group: 'Movimento', get: (e) => e.outputs.euler.heading },
  { id: 'pitch', label: 'Pitch (+ proa acima)', unit: '°', dec: 1, group: 'Movimento', get: (e) => e.outputs.euler.pitch },
  { id: 'banda', label: 'Banda', unit: '°', dec: 1, group: 'Movimento', get: (e) => e.outputs.euler.roll },
  { id: 'fundo', label: 'Altura acima do fundo', unit: 'm', dec: 0, group: 'Movimento', get: (e) => e.outputs.altitude },
  { id: 'rpm', label: 'Rotação do eixo', unit: 'rpm', dec: 0, group: 'Movimento', get: (e) => e.outputs.rpm },
  // forças e massas
  { id: 'peso', label: 'Peso P', unit: 'tf', dec: 1, group: 'Forças e massas', get: (e) => toTf(vb(e).weightN, vb(e).g) },
  { id: 'empuxo', label: 'Empuxo E', unit: 'tf', dec: 1, group: 'Forças e massas', get: (e) => toTf(vb(e).buoyancyN, vb(e).g) },
  { id: 'resultante', label: 'Resultante E − P', unit: 'tf', dec: 2, group: 'Forças e massas', get: (e) => toTf(vb(e).netN, vb(e).g) },
  { id: 'flutuab', label: 'Flutuabilidade líquida (+ leve)', unit: 't', dec: 2, group: 'Forças e massas', get: (e) => e.outputs.netBuoyancyKg / 1000 },
  { id: 'reserva', label: 'Reserva de flutuabilidade', unit: 't', dec: 1, group: 'Forças e massas', get: (e) => Math.max(0, e.outputs.reserveKg) / 1000 },
  { id: 'massa', label: 'Massa total', unit: 't', dec: 1, group: 'Forças e massas', get: (e) => e.outputs.mp.mass / 1000 },
  { id: 'helice', label: 'Empuxo do hélice', unit: 'kN', dec: 1, group: 'Forças e massas', get: (e) => hydroKN(e, 'prop') },
  { id: 'resistencia', label: 'Resistência ao avanço', unit: 'kN', dec: 1, group: 'Forças e massas', get: (e) => hydroKN(e, 'drag') },
  { id: 'forcaLemeAV', label: 'Força dos lemes de vante', unit: 'kN', dec: 1, group: 'Forças e massas', get: (e) => hydroKN(e, 'bow') },
  { id: 'forcaLemeAR', label: 'Força dos lemes de ré', unit: 'kN', dec: 1, group: 'Forças e massas', get: (e) => hydroKN(e, 'stern') },
  { id: 'imerso', label: 'Fração do casco imersa', unit: '%', dec: 1, group: 'Forças e massas', get: (e) => vb(e).immersedFraction * 100 },
  { id: 'volume', label: 'Volume deslocado', unit: 'm³', dec: 1, group: 'Forças e massas', get: (e) => vb(e).displacedM3 },
  // tanques
  { id: 'tlp', label: 'TLP — enchimento', unit: '%', dec: 0, group: 'Tanques', get: (e) => mbtFill(e) * 100 },
  { id: 'tlpAgua', label: 'Água nos TLP', unit: 't', dec: 1, group: 'Tanques', get: (e) => vb(e).mbtWaterKg / 1000 },
  { id: 'comp', label: 'Água de compensação', unit: 'm³', dec: 2, group: 'Tanques', get: (e) => Object.values(e.state.compensation.tanks).reduce((a, t) => a + tankVolume(t), 0) },
  { id: 'trimAV', label: 'Tanque de trim AV', unit: 'm³', dec: 2, group: 'Tanques', get: (e) => tankVolume(e.state.trim.tankA) },
  { id: 'trimAR', label: 'Tanque de trim AR', unit: 'm³', dec: 2, group: 'Tanques', get: (e) => tankVolume(e.state.trim.tankB) },
  { id: 'bandaBB', label: 'Tanque de banda BB', unit: 'm³', dec: 2, group: 'Tanques', get: (e) => tankVolume(e.state.heel.tankA) },
  { id: 'bandaBE', label: 'Tanque de banda BE', unit: 'm³', dec: 2, group: 'Tanques', get: (e) => tankVolume(e.state.heel.tankB) },
  { id: 'suspirosAbertos', label: 'Suspiros abertos (quantidade)', unit: '', dec: 0, group: 'Tanques', get: (e) => e.vessel.ballast.tanks.filter((t) => e.state.ballast[t.id].vent.pos > 0.05).length },
  // lemes e controle
  { id: 'lemeAV', label: 'Leme de vante (+ subir)', unit: '°', dec: 0, group: 'Lemes e controle', get: (e) => e.state.surfaces.bow?.actual ?? 0 },
  { id: 'lemeAR', label: 'Leme de ré (+ subir)', unit: '°', dec: 0, group: 'Lemes e controle', get: (e) => e.state.surfaces.stern?.actual ?? 0 },
  { id: 'lemeDir', label: 'Leme de direção (+ BE)', unit: '°', dec: 0, group: 'Lemes e controle', get: (e) => e.state.surfaces.rudder?.actual ?? 0 },
  { id: 'cotaOrdenada', label: 'Cota ordenada ao piloto', unit: 'm', dec: 0, group: 'Lemes e controle', get: (e) => e.state.autopilot.depthSet },
  // energia e ar
  { id: 'bateria', label: 'Carga da bateria', unit: '%', dec: 1, group: 'Energia e ar', get: (e) => e.state.electrical.soc * 100 },
  { id: 'arAP', label: 'Ar AP no coletor', unit: 'bar', dec: 0, group: 'Energia e ar', get: (e) => e.outputs.hpManifoldBar },
  // situações (sim/não)
  { id: 'naSuperficie', label: 'Na superfície', unit: '', dec: 0, group: 'Situação (sim/não)', bool: true, get: (e) => b(e.outputs.surfaced) },
  { id: 'suspirosFechados', label: 'Todos os suspiros fechados', unit: '', dec: 0, group: 'Situação (sim/não)', bool: true, get: (e) => b(e.vessel.ballast.tanks.every((t) => e.state.ballast[t.id].vent.pos < 0.03)) },
  {
    id: 'soprando',
    label: 'Sopro dos TLP aberto',
    unit: '',
    dec: 0,
    group: 'Situação (sim/não)',
    bool: true,
    get: (e) => b(e.vessel.ballast.tanks.some((t) => e.state.ballast[t.id].blow.pos > 0.05 || e.state.ballast[t.id].emergencyBlow.pos > 0.05)),
  },
  { id: 'dosagem', label: 'Dosagem automática em curso', unit: '', dec: 0, group: 'Situação (sim/não)', bool: true, get: (e) => b(dosing(e)) },
  { id: 'manobra', label: 'Manobra rápida em andamento', unit: '', dec: 0, group: 'Situação (sim/não)', bool: true, get: (_e, c) => b(c.maneuver) },
  { id: 'pilotoProf', label: 'Piloto de profundidade em AUTO', unit: '', dec: 0, group: 'Situação (sim/não)', bool: true, get: (e) => b(e.state.autopilot.depthMode === 'AUTO') },
  {
    id: 'naCota',
    label: 'Na cota ordenada e estável (±1,5 m)',
    unit: '',
    dec: 0,
    group: 'Situação (sim/não)',
    bool: true,
    get: (e) => b(Math.abs(e.outputs.depthKeel - e.state.autopilot.depthSet) < 1.5 && Math.abs(e.outputs.verticalSpeed) < 0.1),
  },
  { id: 'snorkel', label: 'Snorkel içado', unit: '', dec: 0, group: 'Situação (sim/não)', bool: true, get: (e) => b(e.state.snorkel.pos > 0.95) },
  { id: 'alarme', label: 'Alarme ativo', unit: '', dec: 0, group: 'Situação (sim/não)', bool: true, get: (e) => b(visibleAlarms(e.state).some((a) => a.active)) },
  // tempo
  { id: 'tEtapa', label: 'Tempo de simulação na etapa', unit: 's', dec: 0, group: 'Tempo', get: (_e, c) => c.tStep },
  { id: 't', label: 'Tempo de simulação', unit: 's', dec: 0, group: 'Tempo', get: (e) => e.state.t },
];

const BY_ID = new Map(PRES_VARS.map((v) => [v.id, v]));
export const presVar = (id: string): PresVar | undefined => BY_ID.get(id);

/** grupos na ordem do catálogo */
export const VAR_GROUPS: string[] = [...new Set(PRES_VARS.map((v) => v.group))];

export function readVar(id: string, e: SimulationEngine, c: VarCtx): number {
  const v = BY_ID.get(id);
  if (!v) return NaN;
  try {
    return v.get(e, c);
  } catch {
    return NaN;
  }
}

/** Fotografia de todas as variáveis (início da etapa, para as variações Δ). */
export function takeVars(e: SimulationEngine, c: VarCtx): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of PRES_VARS) out[v.id] = readVar(v.id, e, c);
  return out;
}

const NUM = (x: number, d: number) => (Number.isFinite(x) ? (Math.abs(x) < 0.5 * Math.pow(10, -d) ? 0 : x).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');

/** valor formatado (com sinal opcional, sem unidade) */
export function fmtVar(v: PresVar, x: number, dec?: number, signed = false): string {
  if (v.bool) return x > 0.5 ? 'sim' : 'não';
  const d = dec ?? v.dec;
  const s = NUM(x, d);
  return signed && Number.isFinite(x) && s !== NUM(0, d) && x > 0 ? '+' + s : s;
}

/** valor formatado com unidade (mostradores) */
export function fmtVarUnit(v: PresVar, x: number): string {
  const s = fmtVar(v, x);
  return v.unit && !v.bool ? `${s} ${v.unit}` : s;
}

/** {id}, {id:2}, {Δid}, {Δid:2} */
const PLACEHOLDER = /\{(Δ|D:)?([A-Za-z][A-Za-z0-9]*)(?::(\d))?\}/g;

/** Substitui os valores ao vivo no texto. `base` = valores no início da etapa (para Δ). */
export function fillTemplate(text: string, e: SimulationEngine, c: VarCtx, base?: Record<string, number>): string {
  return String(text ?? '').replace(PLACEHOLDER, (all, delta: string | undefined, id: string, dec: string | undefined) => {
    const v = BY_ID.get(id);
    if (!v) return all;
    const x = readVar(id, e, c);
    const d = dec !== undefined ? Number(dec) : undefined;
    if (delta) {
      const x0 = base?.[id];
      return fmtVar(v, x0 === undefined ? 0 : x - x0, d, true);
    }
    return fmtVar(v, x, d);
  });
}

/** valores ao vivo usados num texto que não existem no catálogo (aviso no editor) */
export function unknownPlaceholders(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text ?? '').matchAll(PLACEHOLDER)) if (!BY_ID.has(m[2])) out.add(m[0]);
  return [...out];
}

// ------------------------------------------------------------- condições
export type CondOp = '>' | '<' | '≥' | '≤' | '≈' | '=' | '≠';
export const COND_OPS: { op: CondOp; label: string }[] = [
  { op: '>', label: 'maior que' },
  { op: '<', label: 'menor que' },
  { op: '≥', label: 'maior ou igual a' },
  { op: '≤', label: 'menor ou igual a' },
  { op: '≈', label: 'perto de (± tolerância)' },
  { op: '=', label: 'igual a' },
  { op: '≠', label: 'diferente de' },
];

export interface Condition {
  /** id da variável */
  v: string;
  op: CondOp;
  value: number;
  /** tolerância (op ≈) */
  tol: number;
}

export function testCondition(c: Condition, x: number): boolean {
  if (!Number.isFinite(x)) return false;
  switch (c.op) {
    case '>':
      return x > c.value;
    case '<':
      return x < c.value;
    case '≥':
      return x >= c.value;
    case '≤':
      return x <= c.value;
    case '≈':
      return Math.abs(x - c.value) <= Math.abs(c.tol);
    case '=':
      return Math.abs(x - c.value) < 1e-6 || (!!presVar(c.v)?.bool && x > 0.5 === c.value > 0.5);
    case '≠':
      return !(Math.abs(x - c.value) < 1e-6 || (!!presVar(c.v)?.bool && x > 0.5 === c.value > 0.5));
  }
  return false;
}

export function evalConditions(list: Condition[], logic: 'todas' | 'qualquer', e: SimulationEngine, c: VarCtx): boolean {
  if (!list.length) return true;
  const r = list.map((k) => testCondition(k, readVar(k.v, e, c)));
  return logic === 'todas' ? r.every(Boolean) : r.some(Boolean);
}

/** "Profundidade (quilha) > 30 m" */
export function describeCondition(c: Condition): string {
  const v = presVar(c.v);
  if (!v) return `variável desconhecida (${c.v})`;
  if (v.bool) return `${v.label}: ${(c.op === '≠') !== c.value > 0.5 ? 'sim' : 'não'}`;
  const val = `${fmtVar(v, c.value, Math.max(0, Math.min(3, decimalsOf(c.value))))}${v.unit ? ' ' + v.unit : ''}`;
  if (c.op === '≈') return `${v.label} ≈ ${val} (± ${fmtVar(v, Math.abs(c.tol), Math.max(0, Math.min(3, decimalsOf(c.tol))))})`;
  return `${v.label} ${c.op} ${val}`;
}

function decimalsOf(x: number): number {
  if (!Number.isFinite(x) || Number.isInteger(x)) return 0;
  const s = String(x);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}
