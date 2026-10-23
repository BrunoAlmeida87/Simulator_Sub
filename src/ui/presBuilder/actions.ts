/**
 * CATÁLOGO DE AÇÕES do Estúdio de apresentações. Cada etapa guarda ações como
 * dados ({ t: tipo, p: parâmetros, delay }); aqui está o que cada tipo
 * significa: rótulo, campos do formulário, descrição e execução.
 *
 * As ações que mexem no submarino só EMITEM COMANDOS (applyCommand, com origem
 * "apresentação", registrados no histórico como os do operador). As ações de
 * câmera/camadas só mudam a visualização.
 */
import type { SimulationEngine } from '../../sim/core/engine';
import type { SimRunner } from '../../sim/core/runner';
import { failureCatalog, type Command } from '../../sim/commands';
import { SCENARIOS } from '../../sim/scenarios';
import type { SceneLayers, BoolLayer } from '../../render3d/layers';
import { LAYER_INFO } from '../../render3d/layers';
import type { ViewMode } from '../../render3d/SubmarineScene';
import { maneuver } from '../maneuvers';
import { graphics } from '../graphics';
import { DEEP_FOVS, DEEP_LABELS, type DeepLevel } from '../../render3d/deepPerspective';

export type ParamValue = string | number | boolean;
export type Params = Record<string, ParamValue>;

export type FieldDef =
  | { key: string; label: string; type: 'number'; unit?: string; min?: number; max?: number; step?: number; presets?: [number, string][] }
  | { key: string; label: string; type: 'select'; options: (e: SimulationEngine) => [string, string][] }
  | { key: string; label: string; type: 'bool'; on: string; off: string }
  | { key: string; label: string; type: 'text'; rows?: number };

export interface ActionCtx {
  r: SimRunner;
  /** envia um comando registrado (origem "apresentação") */
  send: (c: Command) => void;
  setView: (v: ViewMode) => void;
  setLayers: (p: Partial<SceneLayers>) => void;
  markBefore: () => void;
  restoreBefore: () => void;
  restoreStart: () => void;
  loadScenario: (id: string, sea: number | null) => void;
}

export interface ActionType {
  id: string;
  group: string;
  label: string;
  hint?: string;
  fields: FieldDef[];
  defaults: Params;
  describe: (p: Params, e?: SimulationEngine) => string;
  run: (p: Params, c: ActionCtx) => void;
}

/** ação guardada numa etapa */
export interface StepAction {
  id: string;
  /** tipo (id do catálogo) */
  t: string;
  p: Params;
  /** segundos depois de entrar na etapa (relógio da etapa) */
  delay: number;
}

// ------------------------------------------------------------ utilitários
const num = (p: Params, k: string, def = 0) => {
  const x = Number(p[k]);
  return Number.isFinite(x) ? x : def;
};
const str = (p: Params, k: string, def = '') => (p[k] === undefined || p[k] === null ? def : String(p[k]));
const bool = (p: Params, k: string) => p[k] === true || p[k] === 'true' || p[k] === 1;
const f = (x: number, d = 0) => x.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: 0 });

/** nome de uma opção (descrição das ações) */
function optLabel(field: FieldDef | undefined, value: string, e?: SimulationEngine): string {
  if (!field || field.type !== 'select' || !e) return value;
  try {
    return field.options(e).find((o) => o[0] === value)?.[1] ?? value;
  } catch {
    return value;
  }
}

const MBT_TARGETS = (e: SimulationEngine): [string, string][] => [['ALL', 'todos os TLP'], ['vante', 'TLP de vante'], ['re', 'TLP de ré'], ...e.vessel.ballast.tanks.map((t) => [t.id, t.name] as [string, string])];
const MBT_LABEL: Record<string, string> = { ALL: 'todos os TLP', vante: 'TLP de vante', re: 'TLP de ré' };

function mbtIds(e: SimulationEngine, target: string): string[] {
  if (target === 'ALL') return ['ALL'];
  if (target === 'vante' || target === 're') return e.vessel.ballast.tanks.filter((t) => (target === 'vante' ? t.center.x > 0 : t.center.x < 0)).map((t) => t.id);
  return e.vessel.ballast.tanks.some((t) => t.id === target) ? [target] : [];
}

const TELEGRAPH_PRESETS: [number, string][] = [
  [-110, 'RÉ TODA'],
  [-60, 'RÉ MEIA'],
  [-30, 'RÉ DEVAGAR'],
  [0, 'PARAR'],
  [40, 'AV DEVAGAR'],
  [75, 'AV MEIA'],
  [115, 'AV 3/4'],
  [160, 'AV TODA'],
];
const telegraphName = (rpm: number) => TELEGRAPH_PRESETS.find((t) => t[0] === rpm)?.[1];

export const VIEW_OPTIONS: [ViewMode, string][] = [
  ['superficie', 'Superfície'],
  ['perspectiva', 'Perspectiva'],
  ['submerso', 'Submerso'],
  ['tanques', 'Tanques'],
  ['forcas', 'Forças'],
  ['calado', 'Calado'],
  ['navio', 'Navio próximo'],
  ['piloto', 'Seguir (lateral)'],
  ['perseguicao', 'Perseguição'],
  ['fixa', 'Fixa'],
  ['passadico', 'Passadiço'],
  ['drone', 'Drone'],
  ['livre', 'Livre'],
];
const viewName = (v: string) => VIEW_OPTIONS.find((x) => x[0] === v)?.[1] ?? v;

const LAYER_OPTIONS = (): [string, string][] => (Object.keys(LAYER_INFO) as Exclude<BoolLayer, 'hull'>[]).map((k) => [k, LAYER_INFO[k].label]).concat([['hull', 'Casco externo']]) as [string, string][];

const SCALE_PRESETS: [number, string][] = [
  [0.25, '×0,25'],
  [0.5, '×0,5'],
  [1, '×1'],
  [2, '×2'],
  [3, '×3'],
  [5, '×5'],
  [10, '×10'],
  [20, '×20'],
];

const ALL_TANKS = (e: SimulationEngine): [string, string][] => [
  ['', '(nenhum)'],
  ...e.vessel.ballast.tanks.map((t) => [t.id, t.name] as [string, string]),
  ...e.vessel.compensation.tanks.map((t) => [t.id, t.name] as [string, string]),
  [e.vessel.trim.tankA.id, e.vessel.trim.tankA.name],
  [e.vessel.trim.tankB.id, e.vessel.trim.tankB.name],
  [e.vessel.heel.tankA.id, e.vessel.heel.tankA.name],
  [e.vessel.heel.tankB.id, e.vessel.heel.tankB.name],
];

const SENSOR_MODES: [string, string][] = [
  ['congelado', 'congelado'],
  ['deriva', 'deriva'],
  ['zero', 'zero'],
  ['ruido', 'ruído'],
];

// ------------------------------------------------------------ catálogo
export const ACTION_TYPES: ActionType[] = [
  // ---------------- propulsão
  {
    id: 'telegrafo',
    group: 'Propulsão',
    label: 'Telégrafo (ordem de rpm)',
    fields: [{ key: 'rpm', label: 'Ordem', type: 'number', unit: 'rpm', min: -160, max: 160, step: 5, presets: TELEGRAPH_PRESETS }],
    defaults: { rpm: 75 },
    describe: (p) => `Telégrafo: ${telegraphName(num(p, 'rpm')) ?? ''} ${f(num(p, 'rpm'))} rpm`.replace(':  ', ': '),
    run: (p, c) => c.send({ type: 'telegraph', rpm: num(p, 'rpm') }),
  },
  // ---------------- lastro
  {
    id: 'suspiros',
    group: 'Lastro principal',
    label: 'Suspiros dos TLP',
    hint: 'Abrir os suspiros deixa o ar sair e a água entrar pelos embornais (imersão).',
    fields: [
      { key: 'alvo', label: 'Tanques', type: 'select', options: MBT_TARGETS },
      { key: 'abrir', label: 'Válvulas', type: 'bool', on: 'Abrir', off: 'Fechar' },
    ],
    defaults: { alvo: 'ALL', abrir: true },
    describe: (p, e) => `${bool(p, 'abrir') ? 'Abrir' : 'Fechar'} suspiros — ${MBT_LABEL[str(p, 'alvo')] ?? optLabel(ACTION_FIELD('suspiros', 'alvo'), str(p, 'alvo'), e)}`,
    run: (p, c) => {
      for (const id of mbtIds(c.r.engine, str(p, 'alvo', 'ALL'))) c.send({ type: 'mbtVent', tank: id, open: bool(p, 'abrir') });
    },
  },
  {
    id: 'sopro',
    group: 'Lastro principal',
    label: 'Sopro dos TLP (ar comprimido)',
    hint: 'Com os suspiros fechados, o ar das garrafas expulsa a água pelos embornais (emersão).',
    fields: [
      { key: 'alvo', label: 'Tanques', type: 'select', options: MBT_TARGETS },
      { key: 'abrir', label: 'Válvulas', type: 'bool', on: 'Abrir', off: 'Fechar' },
    ],
    defaults: { alvo: 'ALL', abrir: true },
    describe: (p, e) => `${bool(p, 'abrir') ? 'Abrir' : 'Fechar'} sopro — ${MBT_LABEL[str(p, 'alvo')] ?? optLabel(ACTION_FIELD('sopro', 'alvo'), str(p, 'alvo'), e)}`,
    run: (p, c) => {
      for (const id of mbtIds(c.r.engine, str(p, 'alvo', 'ALL'))) c.send({ type: 'mbtBlow', tank: id, open: bool(p, 'abrir') });
    },
  },
  {
    id: 'soproEmergencia',
    group: 'Lastro principal',
    label: 'Sopro de emergência',
    fields: [{ key: 'abrir', label: 'Sopro', type: 'bool', on: 'Abrir', off: 'Fechar' }],
    defaults: { abrir: true },
    describe: (p) => `${bool(p, 'abrir') ? 'ABRIR' : 'Fechar'} sopro de emergência`,
    run: (p, c) => c.send({ type: 'emergencyBlow', open: bool(p, 'abrir') }),
  },
  // ---------------- compensação, trim e banda
  {
    id: 'compensacao',
    group: 'Compensação, trim e banda',
    label: 'Compensação: admitir ou esgotar',
    fields: [
      { key: 'modo', label: 'Operação', type: 'bool', on: 'Admitir', off: 'Esgotar' },
      { key: 'kg', label: 'Quantidade', type: 'number', unit: 'kg', min: 50, max: 20000, step: 50 },
    ],
    defaults: { modo: true, kg: 1000 },
    describe: (p) => `Compensação: ${bool(p, 'modo') ? 'admitir' : 'esgotar'} ${f(num(p, 'kg'))} kg`,
    run: (p, c) => c.send({ type: 'dosing', system: 'compensation', mode: bool(p, 'modo') ? 'admitir' : 'esgotar', kg: Math.abs(num(p, 'kg', 1000)) }),
  },
  {
    id: 'equilibrar',
    group: 'Compensação, trim e banda',
    label: 'Equilibrar pela compensação (automático)',
    hint: 'Admite ou esgota a água que falta para zerar a flutuabilidade líquida do momento.',
    fields: [{ key: 'tol', label: 'Só se o desequilíbrio passar de', type: 'number', unit: 'kg', min: 0, max: 5000, step: 50 }],
    defaults: { tol: 250 },
    describe: (p) => `Equilibrar pela compensação (se |E − P| > ${f(num(p, 'tol'))} kg)`,
    run: (p, c) => {
      const net = c.r.engine.outputs.netBuoyancyKg;
      if (Math.abs(net) > num(p, 'tol', 250)) c.send({ type: 'dosing', system: 'compensation', mode: net > 0 ? 'admitir' : 'esgotar', kg: Math.abs(net) });
    },
  },
  {
    id: 'trim',
    group: 'Compensação, trim e banda',
    label: 'Trim: transferir água',
    fields: [
      { key: 'dir', label: 'Sentido', type: 'bool', on: 'Vante → ré (levanta a proa)', off: 'Ré → vante (baixa a proa)' },
      { key: 'kg', label: 'Quantidade', type: 'number', unit: 'kg', min: 50, max: 10000, step: 50 },
    ],
    defaults: { dir: true, kg: 1000 },
    describe: (p) => `Trim: transferir ${f(num(p, 'kg'))} kg ${bool(p, 'dir') ? 'AV → AR' : 'AR → AV'}`,
    run: (p, c) => c.send({ type: 'dosing', system: 'trim', mode: 'transferir', kg: Math.abs(num(p, 'kg', 1000)), dir: bool(p, 'dir') ? 'AtoB' : 'BtoA' }),
  },
  {
    id: 'banda',
    group: 'Compensação, trim e banda',
    label: 'Banda: transferir água',
    fields: [
      { key: 'dir', label: 'Sentido', type: 'bool', on: 'Bombordo → boreste', off: 'Boreste → bombordo' },
      { key: 'kg', label: 'Quantidade', type: 'number', unit: 'kg', min: 50, max: 5000, step: 50 },
    ],
    defaults: { dir: true, kg: 500 },
    describe: (p) => `Banda: transferir ${f(num(p, 'kg'))} kg ${bool(p, 'dir') ? 'BB → BE' : 'BE → BB'}`,
    run: (p, c) => c.send({ type: 'dosing', system: 'heel', mode: 'transferir', kg: Math.abs(num(p, 'kg', 500)), dir: bool(p, 'dir') ? 'AtoB' : 'BtoA' }),
  },
  {
    id: 'interromperDosagem',
    group: 'Compensação, trim e banda',
    label: 'Interromper sequência automática',
    fields: [
      {
        key: 'sis',
        label: 'Sistema',
        type: 'select',
        options: () => [
          ['compensation', 'Compensação'],
          ['trim', 'Trim'],
          ['heel', 'Banda'],
        ],
      },
    ],
    defaults: { sis: 'compensation' },
    describe: (p) => `Interromper sequência de ${{ compensation: 'compensação', trim: 'trim', heel: 'banda' }[str(p, 'sis')] ?? str(p, 'sis')}`,
    run: (p, c) => {
      const s = str(p, 'sis', 'compensation');
      if (s === 'compensation' || s === 'trim' || s === 'heel') c.send({ type: 'dosingAbort', system: s });
    },
  },
  {
    id: 'pesoPosicao',
    group: 'Compensação, trim e banda',
    label: 'Peso deslocável: mover',
    hint: 'Peso didático que corre ao longo do casco (x > posição neutra = para vante).',
    fields: [
      {
        key: 'x',
        label: 'Posição x',
        type: 'number',
        unit: 'm',
        min: -25,
        max: 25,
        step: 0.5,
        presets: [
          [2, 'neutra'],
          [25, 'toda a vante'],
          [-25, 'toda a ré'],
        ],
      },
    ],
    defaults: { x: 25 },
    describe: (p) => `Peso deslocável: mover para x = ${f(num(p, 'x'), 1)} m`,
    run: (p, c) => c.send({ type: 'demoWeight', x: num(p, 'x') }),
  },
  {
    id: 'pesoMassa',
    group: 'Compensação, trim e banda',
    label: 'Peso deslocável: toneladas deslocadas',
    fields: [{ key: 't', label: 'Deslocar', type: 'number', unit: 't', min: 0, max: 30, step: 0.5 }],
    defaults: { t: 5 },
    describe: (p) => `Peso deslocável: deslocar ${f(num(p, 't'), 1)} t (carga existente)`,
    run: (p, c) => c.send({ type: 'demoWeight', mass: num(p, 't') * 1000 }),
  },
  // ---------------- governo e piloto
  {
    id: 'leme',
    group: 'Lemes e piloto automático',
    label: 'Leme (ângulo manual)',
    hint: 'Comandar um leme manualmente desengaja o piloto daquele canal.',
    fields: [
      {
        key: 'id',
        label: 'Leme',
        type: 'select',
        options: () => [
          ['stern', 'Lemes de ré (+ subir)'],
          ['bow', 'Lemes de vante (+ subir)'],
          ['rudder', 'Leme de direção (+ boreste)'],
        ],
      },
      { key: 'ang', label: 'Ângulo', type: 'number', unit: '°', min: -30, max: 30, step: 1 },
    ],
    defaults: { id: 'stern', ang: 0 },
    describe: (p) => `${{ stern: 'Lemes de ré', bow: 'Lemes de vante', rudder: 'Leme de direção' }[str(p, 'id')] ?? str(p, 'id')}: ${f(num(p, 'ang'))}°`,
    run: (p, c) => c.send({ type: 'surface', id: str(p, 'id', 'stern'), angle: num(p, 'ang') }),
  },
  {
    id: 'pilotoProf',
    group: 'Lemes e piloto automático',
    label: 'Piloto de profundidade: ir para a cota',
    hint: 'Engaja o piloto de profundidade (AUTO) com a cota ordenada.',
    fields: [{ key: 'cota', label: 'Cota', type: 'number', unit: 'm', min: 0, max: 400, step: 1 }],
    defaults: { cota: 50 },
    describe: (p) => `Piloto de profundidade AUTO — cota ${f(num(p, 'cota'))} m`,
    run: (p, c) => {
      c.send({ type: 'autopilot', channel: 'depth', mode: 'AUTO' });
      c.send({ type: 'setpoint', channel: 'depth', value: num(p, 'cota', 50) });
    },
  },
  {
    id: 'pilotoRumo',
    group: 'Lemes e piloto automático',
    label: 'Piloto de rumo: governar no rumo',
    fields: [{ key: 'rumo', label: 'Rumo', type: 'number', unit: '°', min: 0, max: 359, step: 1 }],
    defaults: { rumo: 90 },
    describe: (p) => `Piloto de rumo AUTO — rumo ${f(num(p, 'rumo'))}°`,
    run: (p, c) => {
      c.send({ type: 'autopilot', channel: 'heading', mode: 'AUTO' });
      c.send({ type: 'setpoint', channel: 'heading', value: num(p, 'rumo', 90) });
    },
  },
  {
    id: 'piloto',
    group: 'Lemes e piloto automático',
    label: 'Piloto automático: modo (mantém a ordem)',
    hint: 'AUTO sem nova ordem mantém o valor atual (rumo, cota ou pitch).',
    fields: [
      {
        key: 'canal',
        label: 'Canal',
        type: 'select',
        options: () => [
          ['depth', 'Profundidade'],
          ['heading', 'Rumo'],
          ['pitch', 'Atitude (pitch)'],
        ],
      },
      { key: 'auto', label: 'Modo', type: 'bool', on: 'AUTO', off: 'MANUAL' },
    ],
    defaults: { canal: 'heading', auto: true },
    describe: (p) => `Piloto de ${{ depth: 'profundidade', heading: 'rumo', pitch: 'pitch' }[str(p, 'canal')] ?? str(p, 'canal')}: ${bool(p, 'auto') ? 'AUTO' : 'MANUAL'}`,
    run: (p, c) => {
      const ch = str(p, 'canal', 'heading');
      if (ch === 'depth' || ch === 'heading' || ch === 'pitch') c.send({ type: 'autopilot', channel: ch, mode: bool(p, 'auto') ? 'AUTO' : 'MANUAL' });
    },
  },
  {
    id: 'pilotoPitch',
    group: 'Lemes e piloto automático',
    label: 'Piloto de atitude: pitch ordenado',
    fields: [{ key: 'pitch', label: 'Pitch', type: 'number', unit: '°', min: -20, max: 20, step: 0.5 }],
    defaults: { pitch: -5 },
    describe: (p) => `Piloto de atitude AUTO — pitch ${f(num(p, 'pitch'), 1)}°`,
    run: (p, c) => {
      c.send({ type: 'autopilot', channel: 'pitch', mode: 'AUTO' });
      c.send({ type: 'setpoint', channel: 'pitch', value: num(p, 'pitch') });
    },
  },
  // ---------------- mastros, energia e ar
  {
    id: 'snorkel',
    group: 'Mastros, energia e ar',
    label: 'Mastro do snorkel',
    fields: [{ key: 'icar', label: 'Mastro', type: 'bool', on: 'Içar', off: 'Arriar' }],
    defaults: { icar: true },
    describe: (p) => `Snorkel: ${bool(p, 'icar') ? 'içar' : 'arriar'}`,
    run: (p, c) => c.send({ type: 'snorkel', raise: bool(p, 'icar') }),
  },
  {
    id: 'periscopio',
    group: 'Mastros, energia e ar',
    label: 'Periscópio',
    fields: [{ key: 'icar', label: 'Periscópio', type: 'bool', on: 'Içar', off: 'Arriar' }],
    defaults: { icar: true },
    describe: (p) => `Periscópio: ${bool(p, 'icar') ? 'içar' : 'arriar'}`,
    run: (p, c) => c.send({ type: 'periscope', raise: bool(p, 'icar') }),
  },
  {
    id: 'gerador',
    group: 'Mastros, energia e ar',
    label: 'Diesel-gerador',
    fields: [
      { key: 'id', label: 'Gerador', type: 'select', options: (e) => e.vessel.electrical.generators.map((g) => [g.id, g.name] as [string, string]) },
      { key: 'partir', label: 'Ordem', type: 'bool', on: 'Partir', off: 'Parar' },
    ],
    defaults: { id: 'GD1', partir: true },
    describe: (p) => `${str(p, 'id')}: ${bool(p, 'partir') ? 'partir' : 'parar'}`,
    run: (p, c) => {
      if (c.r.engine.state.electrical.generators[str(p, 'id')]) c.send({ type: 'generator', id: str(p, 'id'), run: bool(p, 'partir') });
    },
  },
  {
    id: 'compressor',
    group: 'Mastros, energia e ar',
    label: 'Compressor de ar AP',
    fields: [{ key: 'partir', label: 'Ordem', type: 'bool', on: 'Partir', off: 'Parar' }],
    defaults: { partir: true },
    describe: (p) => `Compressor de ar AP: ${bool(p, 'partir') ? 'partir' : 'parar'}`,
    run: (p, c) => c.send({ type: 'compressor', run: bool(p, 'partir') }),
  },
  {
    id: 'disjuntor',
    group: 'Mastros, energia e ar',
    label: 'Disjuntor principal da bateria',
    fields: [{ key: 'fechar', label: 'Disjuntor', type: 'bool', on: 'Fechar', off: 'Abrir' }],
    defaults: { fechar: true },
    describe: (p) => `Disjuntor da bateria: ${bool(p, 'fechar') ? 'fechar' : 'abrir'}`,
    run: (p, c) => c.send({ type: 'breaker', closed: bool(p, 'fechar') }),
  },
  // ---------------- manobras automáticas
  {
    id: 'imergir',
    group: 'Manobras automáticas',
    label: 'Manobra: imergir para a cota',
    hint: 'Sequência automática completa (seguimento, suspiros, piloto de profundidade).',
    fields: [{ key: 'cota', label: 'Cota', type: 'number', unit: 'm', min: 15, max: 300, step: 5 }],
    defaults: { cota: 50 },
    describe: (p) => `Manobra automática: IMERGIR para ${f(num(p, 'cota'))} m`,
    run: (p, c) => maneuver.start(c.r, 'imergir', num(p, 'cota', 50)),
  },
  {
    id: 'emergir',
    group: 'Manobras automáticas',
    label: 'Manobra: emergir',
    fields: [],
    defaults: {},
    describe: () => 'Manobra automática: EMERGIR',
    run: (_p, c) => maneuver.start(c.r, 'emergir'),
  },
  {
    id: 'cancelarManobra',
    group: 'Manobras automáticas',
    label: 'Cancelar a manobra em andamento',
    fields: [],
    defaults: {},
    describe: () => 'Cancelar a manobra automática',
    run: (_p, c) => maneuver.cancel(c.r),
  },
  // ---------------- ambiente e falhas
  {
    id: 'mar',
    group: 'Ambiente e falhas',
    label: 'Estado do mar',
    fields: [
      {
        key: 'estado',
        label: 'Estado do mar',
        type: 'number',
        min: 0,
        max: 6,
        step: 1,
        presets: [
          [0, 'espelhado'],
          [1, 'calmo'],
          [3, 'moderado'],
          [5, 'grosso'],
        ],
      },
    ],
    defaults: { estado: 1 },
    describe: (p) => `Estado do mar ${f(num(p, 'estado'))}`,
    run: (p, c) => c.send({ type: 'seaState', value: Math.max(0, Math.min(6, num(p, 'estado', 1))) }),
  },
  {
    id: 'falha',
    group: 'Ambiente e falhas',
    label: 'Falha (injetar ou remover)',
    hint: 'Ambiente controlado de treinamento: o efeito é o da física.',
    fields: [
      { key: 'alvo', label: 'Falha', type: 'select', options: (e) => failureCatalog(e).map((d) => [d.target, `${d.group}: ${d.name}`] as [string, string]) },
      { key: 'ativa', label: 'Situação', type: 'bool', on: 'Injetar', off: 'Remover' },
      { key: 'param', label: 'Parâmetro (área do rombo/vazamento em cm²; 0 = padrão)', type: 'number', min: 0, max: 500, step: 1 },
      { key: 'modo', label: 'Modo (sensores)', type: 'select', options: () => SENSOR_MODES },
    ],
    defaults: { alvo: 'pump:trim', ativa: true, param: 0, modo: 'congelado' },
    describe: (p, e) => `${bool(p, 'ativa') ? 'Injetar' : 'Remover'} falha: ${optLabel(ACTION_FIELD('falha', 'alvo'), str(p, 'alvo'), e)}`,
    run: (p, c) => {
      const target = str(p, 'alvo');
      const def = failureCatalog(c.r.engine).find((d) => d.target === target);
      if (!def) return;
      const param = def.modes ? str(p, 'modo', 'congelado') : num(p, 'param') > 0 ? num(p, 'param') : def.param?.default;
      c.send({ type: 'failure', target, active: bool(p, 'ativa'), param });
    },
  },
  {
    id: 'reconhecer',
    group: 'Ambiente e falhas',
    label: 'Reconhecer todos os alarmes',
    fields: [],
    defaults: {},
    describe: () => 'Reconhecer os alarmes',
    run: (_p, c) => c.send({ type: 'ack', id: 'ALL' }),
  },
  // ---------------- câmera e camadas (só visualização)
  {
    id: 'camera',
    group: 'Câmera e camadas',
    label: 'Trocar a câmera',
    hint: 'Útil com atraso: a etapa começa numa vista e muda para outra depois de alguns segundos.',
    fields: [{ key: 'vista', label: 'Vista', type: 'select', options: () => VIEW_OPTIONS }],
    defaults: { vista: 'tanques' },
    describe: (p) => `Câmera: ${viewName(str(p, 'vista'))}`,
    run: (p, c) => c.setView(str(p, 'vista', 'forcas') as ViewMode),
  },
  {
    id: 'camada',
    group: 'Câmera e camadas',
    label: 'Ligar ou desligar uma camada',
    fields: [
      { key: 'camada', label: 'Camada', type: 'select', options: LAYER_OPTIONS },
      { key: 'ligar', label: 'Situação', type: 'bool', on: 'Ligar', off: 'Desligar' },
    ],
    defaults: { camada: 'vectors', ligar: true },
    describe: (p) => `${bool(p, 'ligar') ? 'Ligar' : 'Desligar'} camada: ${LAYER_OPTIONS().find((o) => o[0] === str(p, 'camada'))?.[1] ?? str(p, 'camada')}`,
    run: (p, c) => {
      const k = str(p, 'camada');
      if (k === 'hull' || k in LAYER_INFO) c.setLayers({ [k]: bool(p, 'ligar') } as Partial<SceneLayers>);
    },
  },
  {
    id: 'perspectiva',
    group: 'Câmera e camadas',
    label: 'Perspectiva profunda (todas as vistas)',
    hint: 'Lente grande-angular com a câmera mais perto, mantendo o enquadramento: mais sensação de profundidade. Só visual.',
    fields: [
      { key: 'ligar', label: 'Perspectiva', type: 'bool', on: 'Profunda', off: 'Normal' },
      { key: 'nivel', label: 'Intensidade', type: 'select', options: () => (Object.keys(DEEP_FOVS) as DeepLevel[]).map((k) => [k, `${DEEP_LABELS[k]} (${DEEP_FOVS[k]}°)`] as [string, string]) },
    ],
    defaults: { ligar: true, nivel: 'media' },
    describe: (p) => (bool(p, 'ligar') ? `Perspectiva profunda — ${DEEP_LABELS[str(p, 'nivel') as DeepLevel]?.toLowerCase() ?? str(p, 'nivel')}` : 'Perspectiva normal'),
    run: (p) => {
      const lv = str(p, 'nivel', 'media');
      graphics.set(bool(p, 'ligar') ? { deepPersp: true, ...(lv === 'leve' || lv === 'media' || lv === 'forte' ? { deepLevel: lv } : {}) } : { deepPersp: false });
    },
  },
  {
    id: 'destaque',
    group: 'Câmera e camadas',
    label: 'Destacar um tanque',
    fields: [{ key: 'tanque', label: 'Tanque', type: 'select', options: ALL_TANKS }],
    defaults: { tanque: 'TC1' },
    describe: (p, e) => (str(p, 'tanque') ? `Destacar o tanque ${optLabel(ACTION_FIELD('destaque', 'tanque'), str(p, 'tanque'), e)}` : 'Limpar o destaque de tanque'),
    run: (p, c) => c.setLayers(str(p, 'tanque') ? { highlight: str(p, 'tanque'), tanks: true } : { highlight: null }),
  },
  // ---------------- simulação e apresentação
  {
    id: 'simulacao',
    group: 'Simulação',
    label: 'Executar ou pausar a simulação',
    fields: [{ key: 'executar', label: 'Simulação', type: 'bool', on: 'Executar', off: 'Pausar' }],
    defaults: { executar: false },
    describe: (p) => (bool(p, 'executar') ? 'Executar a simulação' : 'Pausar a simulação (congela a cena)'),
    run: (p, c) => {
      c.r.running = bool(p, 'executar');
      c.r.notify();
    },
  },
  {
    id: 'velocidade',
    group: 'Simulação',
    label: 'Velocidade do tempo',
    fields: [{ key: 'x', label: 'Fator', type: 'number', min: 0.25, max: 20, step: 0.25, presets: SCALE_PRESETS }],
    defaults: { x: 2 },
    describe: (p) => `Velocidade do tempo ×${f(num(p, 'x', 1), 2)}`,
    run: (p, c) => {
      c.r.timeScale = Math.max(0.05, Math.min(64, num(p, 'x', 1)));
      c.r.notify();
    },
  },
  {
    id: 'marcarAntes',
    group: 'Simulação',
    label: 'Marcar o estado “antes” (comparação)',
    fields: [],
    defaults: {},
    describe: () => 'Marcar o estado “antes” (tabela Antes × agora)',
    run: (_p, c) => c.markBefore(),
  },
  {
    id: 'voltarAntes',
    group: 'Simulação',
    label: 'Voltar ao estado “antes”',
    fields: [],
    defaults: {},
    describe: () => 'Voltar ao estado marcado como “antes”',
    run: (_p, c) => c.restoreBefore(),
  },
  {
    id: 'cenario',
    group: 'Simulação',
    label: 'Carregar um cenário',
    hint: 'Troca o submarino de situação (local, cota, velocidade). As ações e condições seguintes valem para o novo cenário.',
    fields: [
      { key: 'id', label: 'Cenário', type: 'select', options: () => SCENARIOS.map((s) => [s.id, s.name] as [string, string]) },
      { key: 'mar', label: 'Estado do mar (−1 = o do cenário)', type: 'number', min: -1, max: 6, step: 1 },
    ],
    defaults: { id: 'superficie', mar: -1 },
    describe: (p) => `Carregar o cenário “${SCENARIOS.find((s) => s.id === str(p, 'id'))?.name ?? str(p, 'id')}”`,
    run: (p, c) => c.loadScenario(str(p, 'id', 'superficie'), num(p, 'mar', -1) >= 0 ? num(p, 'mar') : null),
  },
  {
    id: 'estadoInicial',
    group: 'Simulação',
    label: 'Voltar ao início da apresentação',
    fields: [],
    defaults: {},
    describe: () => 'Voltar ao estado do início da apresentação',
    run: (_p, c) => c.restoreStart(),
  },
  // ---------------- avançado
  {
    id: 'comando',
    group: 'Avançado',
    label: 'Comando do simulador (JSON)',
    hint: 'Comando do simulador escrito em JSON; os campos são conferidos antes de executar. Ex.: {"type":"telegraph","rpm":40}',
    fields: [{ key: 'json', label: 'Comando', type: 'text', rows: 3 }],
    defaults: { json: '{"type":"telegraph","rpm":40}' },
    describe: (p) => `Comando: ${str(p, 'json').slice(0, 80)}`,
    run: (p, c) => {
      const cmd = parseCommandJson(str(p, 'json'));
      if (cmd) c.send(cmd);
    },
  },
];

const BY_ID = new Map(ACTION_TYPES.map((a) => [a.id, a]));
export const actionType = (id: string): ActionType | undefined => BY_ID.get(id);
export const ACTION_GROUPS: string[] = [...new Set(ACTION_TYPES.map((a) => a.group))];

function ACTION_FIELD(type: string, key: string): FieldDef | undefined {
  return BY_ID.get(type)?.fields.find((x) => x.key === key);
}

/**
 * Campos de cada comando aceito no modo avançado (JSON): o que falta ou vem
 * com o tipo errado é recusado antes de chegar ao motor — um número ausente
 * viraria NaN no estado da simulação.
 */
type FieldCheck = (v: unknown) => boolean;
const isNum: FieldCheck = (v) => typeof v === 'number' && Number.isFinite(v);
const isBool: FieldCheck = (v) => typeof v === 'boolean';
const isStr: FieldCheck = (v) => typeof v === 'string' && v.length > 0;
const isObj: FieldCheck = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf =
  (...xs: string[]): FieldCheck =>
  (v) =>
    typeof v === 'string' && xs.includes(v);
const opt =
  (f: FieldCheck): FieldCheck =>
  (v) =>
    v === undefined || f(v);
const FLUID = oneOf('compensation', 'trim', 'heel');
const CHANNEL = oneOf('heading', 'depth', 'pitch');
const DIR = oneOf('AtoB', 'BtoA');

const COMMAND_FIELDS: Record<string, Record<string, FieldCheck>> = {
  compensationRoute: { source: isStr, destination: isStr },
  compensationTransferPump: { run: isBool },
  compensationDirection: { position: opt(oneOf('direta', 'inversa')), reverse: opt(isBool) },
  mbtVent: { tank: isStr, open: isBool },
  mbtBlow: { tank: isStr, open: isBool },
  emergencyBlow: { open: opt(isBool), tank: opt(isStr) },
  hpBankValve: { bank: isStr, open: isBool },
  compressor: { run: isBool },
  valve: { system: FLUID, valve: isStr, open: isBool },
  pump: { system: FLUID, run: isBool },
  direction: { system: oneOf('trim', 'heel'), dir: DIR },
  dosing: { system: FLUID, mode: oneOf('admitir', 'esgotar', 'transferir'), kg: (v) => isNum(v) && (v as number) > 0, dir: opt(DIR) },
  dosingAbort: { system: FLUID },
  telegraph: { rpm: isNum },
  surface: { id: isStr, angle: isNum },
  autopilot: { channel: CHANNEL, mode: oneOf('MANUAL', 'AUTO') },
  setpoint: { channel: CHANNEL, value: isNum },
  snorkel: { raise: isBool },
  periscope: { raise: isBool },
  generator: { id: isStr, run: isBool },
  breaker: { closed: isBool },
  ack: { id: isStr },
  seaState: { value: isNum, direction: opt(isNum) },
  environment: { patch: isObj },
  demoWeight: { x: opt(isNum), mass: opt(isNum) },
  failure: { target: isStr, active: isBool, param: opt((v) => isNum(v) || isStr(v)) },
};

/** tipos de comando aceitos no modo avançado */
export const ADVANCED_COMMAND_TYPES: string[] = Object.keys(COMMAND_FIELDS);

/** comando JSON digitado no modo avançado (null se inválido: tipo desconhecido, campo faltando ou com tipo errado) */
export function parseCommandJson(text: string): Command | null {
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!isObj(c) || typeof c.type !== 'string') return null;
  const fields = COMMAND_FIELDS[c.type];
  if (!fields) return null;
  for (const [k, check] of Object.entries(fields)) if (!check(c[k])) return null;
  // peso deslocável: ao menos posição ou massa
  if (c.type === 'demoWeight' && c.x === undefined && c.mass === undefined) return null;
  return c as unknown as Command;
}

/** descrição de uma ação guardada */
export function describeAction(a: StepAction, e?: SimulationEngine): string {
  const t = BY_ID.get(a.t);
  if (!t) return `Ação desconhecida (${a.t})`;
  try {
    return t.describe({ ...t.defaults, ...a.p }, e);
  } catch {
    return t.label;
  }
}

/** executa uma ação guardada (erros não interrompem a apresentação) */
export function runAction(a: StepAction, c: ActionCtx): boolean {
  const t = BY_ID.get(a.t);
  if (!t) return false;
  try {
    t.run({ ...t.defaults, ...a.p }, c);
    return true;
  } catch {
    return false;
  }
}

/** problema de preenchimento (mostrado no editor), ou null */
export function actionProblem(a: StepAction): string | null {
  const t = BY_ID.get(a.t);
  if (!t) return 'tipo de ação desconhecido';
  if (a.t === 'comando' && !parseCommandJson(str(a.p, 'json'))) return 'JSON inválido, comando desconhecido ou campo faltando/com tipo errado (ex.: {"type":"telegraph","rpm":40})';
  for (const fd of t.fields) if (fd.type === 'number' && a.p[fd.key] !== undefined && !Number.isFinite(Number(a.p[fd.key]))) return `${fd.label}: número inválido`;
  return null;
}
