/**
 * Recursos de APRESENTAÇÃO: situações prontas, estado inicial restaurável,
 * marcação "antes" para comparação com o estado atual e preferências de
 * camadas/enquadramento salvas no navegador.
 */
import type { SimRunner } from '../sim/core/runner';
import type { SimulationEngine } from '../sim/core/engine';
import { buildScenario } from '../sim/scenarios';
import { applyCommand } from '../sim/commands';
import { deserializeEngine, serializeEngine, type SaveFile } from '../sim/persistence';
import { verticalBalance, toTf } from '../sim/forceVectors';
import { tankVolume } from '../sim/systems/internalTanks';
import { toKnots } from '../sim/units';
import { defaultLayers, type SceneLayers } from '../render3d/layers';
import type { ViewMode } from '../render3d/SubmarineScene';
import { baseConfig } from './store';
import { demo } from './demo';
import { maneuver } from './maneuvers';

export interface Preset {
  id: string;
  name: string;
  scenario: string;
  view: ViewMode;
  layers: Partial<SceneLayers>;
  note: string;
  /** estado do mar (0–6); forças e tanques ficam mais legíveis com mar calmo */
  sea?: number;
  setup?: (e: SimulationEngine) => void;
}

export const PRESETS: Preset[] = [
  {
    id: 'trim_demo',
    name: 'Trim: deslocar peso e compensar',
    sea: 1,
    scenario: 'pairando',
    view: 'forcas',
    layers: { trimVectors: true, vectors: false, hydroVectors: false, tanks: true, pipes: true, flows: true, labels: true, markers: false, highlight: null },
    note: 'Pairando a 80 m (sem velocidade). Leve o peso de 5 t para vante: o binário faz a proa descer cerca de 10°. Depois use “Compensar com o trim”: a água vai de TT-AV para TT-AR e o submarino volta a nivelar. Com 10 t o trim não é suficiente.',
  },
  {
    id: 'sup_parado',
    sea: 1,
    name: 'Superfície, parado — peso e empuxo',
    scenario: 'superficie',
    view: 'forcas',
    layers: { trimVectors: false, vectors: true, hydroVectors: false, tanks: true, pipes: true, flows: true, labels: true, wake: true, markers: false, highlight: null },
    note: 'TLP vazios e suspiros fechados. Abra os suspiros: o peso cresce com a água que entra e o casco afunda até o empuxo (volume imerso) acompanhar.',
  },
  {
    id: 'sup_8nos',
    sea: 3,
    name: 'Navegação na superfície a 8 nós',
    scenario: 'superficie_avante',
    view: 'superficie',
    layers: { trimVectors: false, vectors: false, hydroVectors: true, tanks: false, wake: true, markers: true, labels: true, highlight: null },
    note: 'Esteira, onda de proa e rastro do hélice ligados à velocidade real. Pare o hélice: o rastro do hélice some, mas o casco continua avançando por inércia.',
  },
  {
    id: 'mergulho',
    sea: 2,
    name: 'Mergulho em movimento — tanques e escoamentos',
    scenario: 'superficie_avante',
    view: 'tanques',
    layers: { trimVectors: false, vectors: true, hydroVectors: false, tanks: true, pipes: true, flows: true, labels: true, wake: true, markers: true, highlight: null },
    note: 'Use “Imergir” ou abra os suspiros: o ar sai pelos suspiros, a água entra pelos embornais, o peso aumenta e a resultante aponta para baixo.',
  },
  {
    id: 'neutro50',
    sea: 1,
    name: 'Submerso equilibrado a 50 m',
    scenario: 'submerso_50',
    view: 'forcas',
    layers: { trimVectors: false, vectors: true, hydroVectors: true, tanks: true, pipes: true, flows: true, labels: true, markers: false, highlight: null },
    note: 'Casco todo imerso: o empuxo fica praticamente constante. Admita 1 t de compensação e veja apenas o peso e a resultante mudarem.',
  },
  {
    id: 'pairando',
    sea: 1,
    name: 'Pairando a 80 m — controle só pelo peso',
    scenario: 'pairando',
    view: 'forcas',
    layers: { trimVectors: false, vectors: true, hydroVectors: false, tanks: true, pipes: true, flows: true, labels: true, markers: false, highlight: 'TC1' },
    note: 'Sem velocidade os lemes não atuam. Só a compensação (admitir/esgotar) altera a resultante e o movimento vertical.',
  },
  {
    id: 'pesado',
    sea: 1,
    name: 'Compensação desajustada (+4 t)',
    scenario: 'desajuste',
    view: 'forcas',
    layers: { trimVectors: false, vectors: true, tanks: true, pipes: true, flows: true, labels: true, highlight: null },
    note: 'Na superfície o excesso de 4 t só aprofunda um pouco o casco; após o mergulho aparece como resultante para baixo.',
  },
  {
    id: 'periscopica',
    sea: 3,
    name: 'Cota periscópica (snorkel)',
    scenario: 'cota_periscopica',
    view: 'submerso',
    layers: { trimVectors: false, vectors: false, tanks: false, markers: true, wake: true, labels: true, highlight: null },
    note: 'Perto da superfície o hélice e a vela perturbam a água; as boias marcam o avanço.',
  },
  {
    id: 'mar5',
    name: 'Mar grosso (estado 5)',
    scenario: 'mar_grosso',
    view: 'submerso',
    layers: { trimVectors: false, vectors: true, tanks: false, markers: true, wake: true, labels: true, highlight: null },
    note: 'As ondas fazem o empuxo e a resultante oscilarem perto da superfície.',
  },
];

// ------------------------------------------------------------ métricas
export interface MetricDef {
  id: string;
  label: string;
  unit: string;
  dec: number;
  get: (e: SimulationEngine) => number;
}

export const METRICS: MetricDef[] = [
  { id: 't', label: 'Tempo de simulação', unit: 's', dec: 0, get: (e) => e.state.t },
  { id: 'depth', label: 'Profundidade (quilha)', unit: 'm', dec: 1, get: (e) => e.outputs.depthKeel },
  { id: 'vz', label: 'Velocidade vertical (+ desce)', unit: 'm/s', dec: 2, get: (e) => e.outputs.verticalSpeed },
  { id: 'u', label: 'Velocidade', unit: 'nós', dec: 1, get: (e) => toKnots(e.state.body.vel.x) },
  { id: 'pitch', label: 'Pitch', unit: '°', dec: 1, get: (e) => e.outputs.euler.pitch },
  { id: 'roll', label: 'Banda', unit: '°', dec: 1, get: (e) => e.outputs.euler.roll },
  { id: 'mass', label: 'Massa total', unit: 't', dec: 1, get: (e) => e.outputs.mp.mass / 1000 },
  { id: 'P', label: 'Peso P', unit: 'tf', dec: 1, get: (e) => toTf(verticalBalance(e).weightN, e.env.cfg.gravity) },
  { id: 'E', label: 'Empuxo E', unit: 'tf', dec: 1, get: (e) => toTf(verticalBalance(e).buoyancyN, e.env.cfg.gravity) },
  { id: 'R', label: 'Resultante E − P', unit: 'tf', dec: 2, get: (e) => toTf(verticalBalance(e).netN, e.env.cfg.gravity) },
  { id: 'V', label: 'Volume deslocado', unit: 'm³', dec: 1, get: (e) => verticalBalance(e).displacedM3 },
  { id: 'imm', label: 'Fração imersa', unit: '%', dec: 1, get: (e) => verticalBalance(e).immersedFraction * 100 },
  { id: 'mbt', label: 'Água nos TLP', unit: 'm³', dec: 1, get: (e) => Object.values(e.state.ballast).reduce((a, b) => a + b.water, 0) },
  { id: 'comp', label: 'Água de compensação', unit: 'm³', dec: 2, get: (e) => Object.values(e.state.compensation.tanks).reduce((a, t) => a + tankVolume(t), 0) },
  { id: 'trimA', label: 'TT-AV', unit: 'm³', dec: 2, get: (e) => tankVolume(e.state.trim.tankA) },
  { id: 'trimB', label: 'TT-AR', unit: 'm³', dec: 2, get: (e) => tankVolume(e.state.trim.tankB) },
  { id: 'heelA', label: 'TB-BB', unit: 'm³', dec: 2, get: (e) => tankVolume(e.state.heel.tankA) },
  { id: 'heelB', label: 'TB-BE', unit: 'm³', dec: 2, get: (e) => tankVolume(e.state.heel.tankB) },
  { id: 'hp', label: 'Ar AP no coletor', unit: 'bar', dec: 0, get: (e) => e.outputs.hpManifoldBar },
  { id: 'soc', label: 'Carga da bateria', unit: '%', dec: 1, get: (e) => e.state.electrical.soc * 100 },
];

export const takeMetrics = (e: SimulationEngine): Record<string, number> => Object.fromEntries(METRICS.map((m) => [m.id, m.get(e)]));

// ------------------------------------------------------------ estado
const K_LAYERS = 'sx1.pres.layers.v1';
const K_VIEW = 'sx1.pres.view.v1';

function load<T>(k: string, def: T): T {
  try {
    const r = localStorage.getItem(k);
    return r ? { ...def, ...JSON.parse(r) } : def;
  } catch {
    return def;
  }
}

class PresentationStore {
  layers: SceneLayers = load(K_LAYERS, { ...defaultLayers(), vectors: true, tanks: true, pipes: true, flows: true, labels: true, markers: true, presLight: true });
  view: ViewMode = (() => {
    try {
      return (localStorage.getItem(K_VIEW) as ViewMode) || 'forcas';
    } catch {
      return 'forcas';
    }
  })();
  presetId: string | null = null;
  initial: SaveFile | null = null;
  before: { file: SaveFile; metrics: Record<string, number>; label: string } | null = null;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const l of this.listeners) l();
  }

  setLayers(p: Partial<SceneLayers>): void {
    this.layers = { ...this.layers, ...p };
    try {
      localStorage.setItem(K_LAYERS, JSON.stringify({ ...this.layers, highlight: null }));
    } catch {
      /* sem armazenamento */
    }
    this.emit();
  }
  setView(v: ViewMode, autoLayers = false): void {
    this.view = v;
    // enquadramentos que já ligam o que mostram (clique do operador)
    if (autoLayers && v === 'tanques' && !this.layers.tanks) this.layers = { ...this.layers, tanks: true };
    if (autoLayers && v === 'forcas' && !this.layers.vectors) this.layers = { ...this.layers, vectors: true };
    if (autoLayers && v === 'calado' && !this.layers.trimRef) this.layers = { ...this.layers, trimRef: true };
    try {
      localStorage.setItem(K_VIEW, v);
    } catch {
      /* sem armazenamento */
    }
    this.emit();
  }

  /** Guarda o estado atual como "inicial" (se ainda não houver um para este motor). */
  ensureInitial(r: SimRunner): void {
    if (!this.initial) this.initial = serializeEngine(r.engine, 'Estado inicial da apresentação');
  }

  prepare(r: SimRunner, p: Preset): void {
    demo.stop(r);
    maneuver.cancel(r);
    maneuver.result = null;
    r.running = false;
    const e = buildScenario(p.scenario, baseConfig());
    if (p.sea !== undefined) applyCommand(e, { type: 'seaState', value: p.sea });
    p.setup?.(e);
    e.computeOutputs();
    r.replaceEngine(e);
    this.initial = serializeEngine(e, `Início: ${p.name}`);
    this.before = null;
    if (PRESETS.some((x) => x.id === p.id)) this.presetId = p.id;
    this.layers = { ...this.layers, ...p.layers };
    this.view = p.view;
    this.setLayers({});
    this.setView(p.view);
  }

  restoreInitial(r: SimRunner): void {
    if (!this.initial) return;
    demo.stop(r);
    maneuver.cancel(r);
    r.running = false;
    r.replaceEngine(deserializeEngine(this.initial));
    this.emit();
  }

  markBefore(r: SimRunner): void {
    const e = r.engine;
    this.before = { file: serializeEngine(e, 'Antes'), metrics: takeMetrics(e), label: `t = ${e.state.t.toFixed(0)} s` };
    e.log(`Apresentação: marcado o estado “antes” (t = ${e.state.t.toFixed(0)} s)`, 'Apresentação');
    this.emit();
  }

  restoreBefore(r: SimRunner): void {
    if (!this.before) return;
    demo.stop(r);
    maneuver.cancel(r);
    r.running = false;
    r.replaceEngine(deserializeEngine(this.before.file));
    this.emit();
  }
}

export const pres = new PresentationStore();

/** Comando de lastro para um grupo de TLP (vante/ré/todos). */
export function mbtGroup(e: SimulationEngine, group: 'vante' | 're' | 'todos', what: 'vent' | 'blow', open: boolean): void {
  const ids = e.vessel.ballast.tanks.filter((t) => group === 'todos' || (group === 'vante' ? t.center.x > 0 : t.center.x < 0)).map((t) => t.id);
  if (group === 'todos') {
    applyCommand(e, { type: what === 'vent' ? 'mbtVent' : 'mbtBlow', tank: 'ALL', open });
    return;
  }
  for (const id of ids) applyCommand(e, { type: what === 'vent' ? 'mbtVent' : 'mbtBlow', tank: id, open });
}
