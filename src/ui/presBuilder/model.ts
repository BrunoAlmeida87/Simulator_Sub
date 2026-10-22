/**
 * MODELO DE DADOS das apresentações criadas no Estúdio. Uma apresentação é
 * uma lista de ETAPAS; cada etapa define:
 *   - texto e formatação (título, narração com valores ao vivo, "por quê",
 *     notas do apresentador, estilo/posição/tamanho do cartão);
 *   - visualização (tela, câmera, camadas, mostradores, velocidade do tempo);
 *   - ações (comandos ao entrar na etapa, cada um com atraso opcional);
 *   - gatilho para avançar (manual, tempo ou condição física) e destino;
 *   - estado salvo opcional (a etapa pode começar sempre do mesmo ponto).
 *
 * Tudo é JSON simples: salvo no navegador, exportado/importado como arquivo.
 * `normalizePresentation` aceita qualquer coisa e devolve uma apresentação válida.
 */
import type { SaveFile } from '../../sim/persistence';
import type { LoadCondition } from '../../sim/scenarios';
import { defaultLayers, type SceneLayers } from '../../render3d/layers';
import type { BridgeSight, ViewMode } from '../../render3d/SubmarineScene';
import type { DronePose } from '../../render3d/drone';
import { isScreenId, type ScreenId } from '../nav';
import { actionType, type StepAction, type Params } from './actions';
import { COND_OPS, presVar, type Condition, type CondOp } from './variables';
import { TEXT_COLORS } from './richText';

export const PRES_FORMAT = 'sx1-apresentacao';
export const PRES_VERSION = 1;

export type CardStyle = 'cartao' | 'titulo' | 'legenda' | 'oculto';
export type CardPosition = 'baixo' | 'topo' | 'esquerda' | 'direita' | 'centro';
export type CardSize = 'P' | 'M' | 'G' | 'GG';
export type RunMode = 'manter' | 'executar' | 'pausar';
export type AdvanceMode = 'manual' | 'tempo' | 'condicao';
/** onde a etapa é mostrada: o palco do Estúdio ou qualquer tela do simulador */
export type StepScreen = 'palco' | ScreenId;

export interface CamPose {
  pos: [number, number, number];
  target: [number, number, number];
}

export type DroneFrame = 'submarino' | 'mapa';

/** posição e proa do submarino (referência do drone) */
export interface SubRef {
  n: number;
  e: number;
  heading: number;
}

/** pose do drone no mundo → como é guardada na etapa */
export function droneToStep(p: DronePose, sub: SubRef, frame: DroneFrame): DronePose {
  if (frame === 'mapa') return { ...p };
  const psi = (sub.heading * Math.PI) / 180;
  const dn = p.n - sub.n;
  const de = p.e - sub.e;
  return { n: Math.cos(psi) * dn + Math.sin(psi) * de, e: -Math.sin(psi) * dn + Math.cos(psi) * de, up: p.up, yaw: (((p.yaw - sub.heading) % 360) + 360) % 360, pitch: p.pitch };
}

/** pose guardada na etapa → pose do drone no mundo (na posição atual do submarino) */
export function droneFromStep(d: DronePose, sub: SubRef, frame: DroneFrame): DronePose {
  if (frame === 'mapa') return { ...d };
  const psi = (sub.heading * Math.PI) / 180;
  return { n: sub.n + Math.cos(psi) * d.n - Math.sin(psi) * d.e, e: sub.e + Math.sin(psi) * d.n + Math.cos(psi) * d.e, up: d.up, yaw: (((d.yaw + sub.heading) % 360) + 360) % 360, pitch: d.pitch };
}

export interface StepFormat {
  style: CardStyle;
  position: CardPosition;
  size: CardSize;
  /** cor de destaque (nome de TEXT_COLORS) */
  accent: string;
  /** número da etapa (3/9) e trilha de progresso */
  showProgress: boolean;
  /** linha "aguardando…" / "próxima etapa em…" */
  showStatus: boolean;
}

export interface StepVisual {
  screen: StepScreen;
  /** null = manter a câmera atual */
  view: ViewMode | null;
  /** posição exata da câmera livre (relativa ao submarino) */
  camPose: CamPose | null;
  /**
   * posição do drone (vista Drone). Com droneFrame 'submarino': n = metros à
   * vante, e = metros a boreste e yaw = visada em relação à proa (o drone
   * aparece sempre no mesmo enquadramento do submarino). Com 'mapa': Norte,
   * Leste e rumo verdadeiro (um ponto fixo do cenário). Ao entrar na etapa o
   * drone é posicionado e fica parado no cenário.
   */
  drone: DronePose | null;
  droneFrame: DroneFrame;
  /** visada do passadiço (vista Passadiço): marcação, elevação e binóculo */
  bridge: BridgeSight | null;
  /** null = manter as camadas atuais */
  layers: SceneLayers | null;
  /** mostradores ao vivo sobre a cena (ids de variáveis) */
  hud: string[];
  /** null = manter */
  timeScale: number | null;
  run: RunMode;
}

export interface StepAdvance {
  mode: AdvanceMode;
  /** modo tempo: segundos de apresentação */
  seconds: number;
  conditions: Condition[];
  logic: 'todas' | 'qualquer';
  /** a condição precisa ficar verdadeira por N s de simulação */
  hold: number;
  /** tempo mínimo de leitura depois que a condição é atingida (s) */
  minDwell: number;
  /** limite em s de simulação (0 = sem limite) */
  timeout: number;
  onTimeout: 'avancar' | 'aguardar';
  /** texto mostrado enquanto aguarda (vazio = gerado a partir das condições) */
  waitText: string;
  /** '' = próxima etapa; id de etapa = ir para ela; FIM = encerrar */
  next: string;
}

export const NEXT_END = '__fim';

export interface PresStep {
  id: string;
  title: string;
  text: string;
  why: string;
  /** só na tela do apresentador (nunca na 2ª janela) */
  notes: string;
  format: StepFormat;
  visual: StepVisual;
  actions: StepAction[];
  advance: StepAdvance;
  /** estado da simulação guardado para esta etapa */
  state: SaveFile | null;
  /** carregar o estado guardado ao entrar na etapa */
  loadState: boolean;
}

export interface PresStart {
  /** cenário (sempre igual), estado guardado, ou continuar de onde o simulador está */
  mode: 'cenario' | 'estado' | 'atual';
  scenario: string;
  /** null = o do cenário */
  sea: number | null;
  load: LoadCondition;
  precompensated: boolean;
  state: SaveFile | null;
}

export interface UserPresentation {
  format: typeof PRES_FORMAT;
  version: number;
  id: string;
  name: string;
  description: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  start: PresStart;
  steps: PresStep[];
  /** modelo embutido (somente leitura; editar cria uma cópia) */
  builtin?: boolean;
}

// ------------------------------------------------------------ fábrica
let seq = 0;
export function uid(prefix = 'x'): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}${seq.toString(36)}`;
}

export const defaultFormat = (): StepFormat => ({ style: 'cartao', position: 'baixo', size: 'M', accent: 'ciano', showProgress: true, showStatus: true });
export const defaultVisual = (): StepVisual => ({ screen: 'palco', view: null, camPose: null, drone: null, droneFrame: 'submarino', bridge: null, layers: null, hud: [], timeScale: null, run: 'executar' });
export const defaultAdvance = (): StepAdvance => ({ mode: 'manual', seconds: 10, conditions: [], logic: 'todas', hold: 0, minDwell: 5, timeout: 0, onTimeout: 'avancar', waitText: '', next: '' });

export function newStep(p: Partial<PresStep> = {}): PresStep {
  return {
    id: uid('e'),
    title: 'Nova etapa',
    text: '',
    why: '',
    notes: '',
    format: defaultFormat(),
    visual: defaultVisual(),
    actions: [],
    advance: defaultAdvance(),
    state: null,
    loadState: false,
    ...p,
  };
}

export function newAction(t: string, p: Params = {}, delay = 0): StepAction {
  return { id: uid('a'), t, p: { ...(actionType(t)?.defaults ?? {}), ...p }, delay };
}

export function newPresentation(name = 'Nova apresentação'): UserPresentation {
  const now = new Date().toISOString();
  return {
    format: PRES_FORMAT,
    version: PRES_VERSION,
    id: uid('p'),
    name,
    description: '',
    author: '',
    createdAt: now,
    updatedAt: now,
    start: { mode: 'cenario', scenario: 'superficie', sea: 1, load: 'normal', precompensated: true, state: null },
    steps: [
      newStep({
        title: 'Abertura',
        text: '# Título da apresentação\nSubtítulo ou tema',
        format: { ...defaultFormat(), style: 'titulo', position: 'centro', size: 'G' },
        visual: { ...defaultVisual(), view: 'superficie', run: 'executar' },
      }),
    ],
  };
}

/** cópia independente (novos ids), para duplicar etapas e apresentações */
export function cloneStep(s: PresStep): PresStep {
  const c = structuredClone(s);
  c.id = uid('e');
  c.actions = c.actions.map((a) => ({ ...a, id: uid('a') }));
  return c;
}

export function clonePresentation(p: UserPresentation, name?: string): UserPresentation {
  const c = structuredClone(p);
  const now = new Date().toISOString();
  c.id = uid('p');
  c.name = name ?? `${p.name} (cópia)`;
  c.createdAt = now;
  c.updatedAt = now;
  delete c.builtin;
  // ids de etapa novos, mantendo os desvios ("ir para a etapa…")
  const map = new Map<string, string>();
  for (const s of c.steps) {
    const nid = uid('e');
    map.set(s.id, nid);
    s.id = nid;
    s.actions = s.actions.map((a) => ({ ...a, id: uid('a') }));
  }
  for (const s of c.steps) if (s.advance.next && s.advance.next !== NEXT_END) s.advance.next = map.get(s.advance.next) ?? '';
  return c;
}

// ------------------------------------------------------------ validação
const STYLES: CardStyle[] = ['cartao', 'titulo', 'legenda', 'oculto'];
const POSITIONS: CardPosition[] = ['baixo', 'topo', 'esquerda', 'direita', 'centro'];
const SIZES: CardSize[] = ['P', 'M', 'G', 'GG'];
const RUNS: RunMode[] = ['manter', 'executar', 'pausar'];
const MODES: AdvanceMode[] = ['manual', 'tempo', 'condicao'];
const VIEWS: ViewMode[] = ['piloto', 'perseguicao', 'perspectiva', 'superficie', 'submerso', 'tanques', 'forcas', 'calado', 'navio', 'fixa', 'passadico', 'drone', 'livre'];
const LOADS: LoadCondition[] = ['leve', 'normal', 'pesada'];

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const s = (x: unknown, def = '', max = 20000): string => (typeof x === 'string' ? x.slice(0, max) : typeof x === 'number' ? String(x) : def);
const n = (x: unknown, def: number, min = -Infinity, max = Infinity): number => {
  const v = Number(x);
  return Number.isFinite(v) && x !== null && x !== '' ? Math.max(min, Math.min(max, v)) : def;
};
const pick = <T>(x: unknown, list: readonly T[], def: T): T => (list.includes(x as T) ? (x as T) : def);
const isSave = (x: unknown): x is SaveFile => !!x && typeof x === 'object' && (x as SaveFile).format !== undefined && !!(x as SaveFile).state && !!(x as SaveFile).config;
const vec3 = (x: unknown): [number, number, number] | null => (Array.isArray(x) && x.length === 3 && x.every((v) => Number.isFinite(Number(v))) ? [Number(x[0]), Number(x[1]), Number(x[2])] : null);

function normLayers(x: unknown): SceneLayers | null {
  if (!x || typeof x !== 'object') return null;
  const d = defaultLayers();
  const r = x as Record<string, unknown>;
  const out = { ...d } as unknown as Record<string, unknown>;
  for (const [k, dv] of Object.entries(d)) {
    const v = r[k];
    if (v === undefined) continue;
    if (typeof dv === 'boolean') out[k] = !!v;
    else if (k === 'resultantGain') out[k] = v === 'auto' ? 'auto' : n(v, 1, 0.01, 1e6);
    else if (k === 'hullOpacity') out[k] = n(v, d.hullOpacity, 0.04, 1);
    else if (k === 'highlight') out[k] = typeof v === 'string' && v ? v : null;
    else if (k === 'tankFilter') out[k] = Array.isArray(v) ? v.filter((t) => typeof t === 'string') : null;
    else if (k === 'hiddenVectors') out[k] = Array.isArray(v) ? v.filter((t) => typeof t === 'string') : [];
  }
  return out as unknown as SceneLayers;
}

const finite = (r: Record<string, unknown>, keys: string[]): boolean => keys.every((k) => r[k] !== null && r[k] !== '' && Number.isFinite(Number(r[k])));

function normDrone(x: unknown): DronePose | null {
  const r = obj(x);
  return finite(r, ['n', 'e', 'up', 'yaw', 'pitch']) ? { n: Number(r.n), e: Number(r.e), up: Number(r.up), yaw: Number(r.yaw), pitch: Number(r.pitch) } : null;
}

function normBridge(x: unknown): BridgeSight | null {
  const r = obj(x);
  return finite(r, ['bearing', 'elev', 'fov']) ? { bearing: Number(r.bearing), elev: Number(r.elev), fov: Math.max(1, Math.min(120, Number(r.fov))) } : null;
}

function normCondition(x: unknown): Condition | null {
  const r = obj(x);
  const v = s(r.v);
  if (!presVar(v)) return null;
  return {
    v,
    op: pick<CondOp>(
      r.op,
      COND_OPS.map((o) => o.op),
      '>',
    ),
    value: n(r.value, 0),
    tol: Math.abs(n(r.tol, 1)),
  };
}

function normAction(x: unknown): StepAction | null {
  const r = obj(x);
  const t = s(r.t);
  if (!actionType(t)) return null;
  const p: Params = {};
  for (const [k, v] of Object.entries(obj(r.p))) if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') p[k] = typeof v === 'string' ? v.slice(0, 4000) : v;
  return { id: s(r.id) || uid('a'), t, p: { ...actionType(t)!.defaults, ...p }, delay: n(r.delay, 0, 0, 36000) };
}

export function normalizeStep(x: unknown): PresStep {
  const r = obj(x);
  const fo = obj(r.format);
  const vi = obj(r.visual);
  const ad = obj(r.advance);
  const df = defaultFormat();
  const dv = defaultVisual();
  const da = defaultAdvance();
  const cam = obj(vi.camPose);
  const pos = vec3(cam.pos);
  const target = vec3(cam.target);
  const screen = vi.screen === 'palco' || isScreenId(vi.screen) ? (vi.screen as StepScreen) : dv.screen;
  return {
    id: s(r.id) || uid('e'),
    title: s(r.title, 'Etapa', 300),
    text: s(r.text),
    why: s(r.why),
    notes: s(r.notes),
    format: {
      style: pick(fo.style, STYLES, df.style),
      position: pick(fo.position, POSITIONS, df.position),
      size: pick(fo.size, SIZES, df.size),
      accent: typeof fo.accent === 'string' && TEXT_COLORS[fo.accent] ? fo.accent : df.accent,
      showProgress: fo.showProgress === undefined ? df.showProgress : !!fo.showProgress,
      showStatus: fo.showStatus === undefined ? df.showStatus : !!fo.showStatus,
    },
    visual: {
      screen,
      view: vi.view === null || vi.view === undefined ? null : pick<ViewMode | null>(vi.view, VIEWS, null),
      camPose: pos && target ? { pos, target } : null,
      drone: normDrone(vi.drone),
      droneFrame: vi.droneFrame === 'mapa' ? 'mapa' : 'submarino',
      bridge: normBridge(vi.bridge),
      layers: normLayers(vi.layers),
      hud: Array.isArray(vi.hud) ? vi.hud.filter((h): h is string => typeof h === 'string' && !!presVar(h)).slice(0, 12) : [],
      timeScale: vi.timeScale === null || vi.timeScale === undefined ? null : n(vi.timeScale, 1, 0.05, 64),
      run: pick(vi.run, RUNS, dv.run),
    },
    actions: (Array.isArray(r.actions) ? r.actions : []).map(normAction).filter((a): a is StepAction => !!a),
    advance: {
      mode: pick(ad.mode, MODES, da.mode),
      seconds: n(ad.seconds, da.seconds, 0, 36000),
      conditions: (Array.isArray(ad.conditions) ? ad.conditions : []).map(normCondition).filter((c): c is Condition => !!c),
      logic: ad.logic === 'qualquer' ? 'qualquer' : 'todas',
      hold: n(ad.hold, 0, 0, 36000),
      minDwell: n(ad.minDwell, da.minDwell, 0, 36000),
      timeout: n(ad.timeout, 0, 0, 360000),
      onTimeout: ad.onTimeout === 'aguardar' ? 'aguardar' : 'avancar',
      waitText: s(ad.waitText, '', 500),
      next: s(ad.next, '', 200),
    },
    state: isSave(r.state) ? (r.state as SaveFile) : null,
    loadState: !!r.loadState && isSave(r.state),
  };
}

/** Aceita qualquer objeto (arquivo importado, versão antiga) e devolve uma apresentação válida. */
export function normalizePresentation(x: unknown): UserPresentation {
  const r = obj(x);
  const st = obj(r.start);
  const now = new Date().toISOString();
  const steps = (Array.isArray(r.steps) ? r.steps : []).slice(0, 500).map(normalizeStep);
  // ids repetidos (arquivo editado à mão) e desvios para etapas que não existem
  const seen = new Set<string>();
  for (const k of steps) {
    if (seen.has(k.id)) k.id = uid('e');
    seen.add(k.id);
  }
  for (const k of steps) if (k.advance.next && k.advance.next !== NEXT_END && !seen.has(k.advance.next)) k.advance.next = '';
  return {
    format: PRES_FORMAT,
    version: PRES_VERSION,
    id: s(r.id) || uid('p'),
    name: s(r.name, 'Apresentação sem nome', 200) || 'Apresentação sem nome',
    description: s(r.description, '', 4000),
    author: s(r.author, '', 200),
    createdAt: s(r.createdAt) || now,
    updatedAt: s(r.updatedAt) || now,
    start: {
      mode: pick(st.mode, ['cenario', 'estado', 'atual'] as const, 'cenario'),
      scenario: s(st.scenario, 'superficie', 100) || 'superficie',
      sea: st.sea === null || st.sea === undefined ? null : n(st.sea, 1, 0, 6),
      load: pick(st.load, LOADS, 'normal'),
      precompensated: st.precompensated === undefined ? true : !!st.precompensated,
      state: isSave(st.state) ? (st.state as SaveFile) : null,
    },
    steps: steps.length ? steps : [newStep({ title: 'Etapa 1' })],
    ...(r.builtin ? { builtin: true } : {}),
  };
}

/** problemas a resolver antes de apresentar (avisos do editor) */
export function presentationProblems(p: UserPresentation): { step: number; text: string }[] {
  const out: { step: number; text: string }[] = [];
  if (p.start.mode === 'estado' && !p.start.state) out.push({ step: -1, text: 'Ponto de partida “estado guardado”, mas nenhum estado foi capturado.' });
  p.steps.forEach((k, i) => {
    if (k.advance.mode === 'condicao' && !k.advance.conditions.length) out.push({ step: i, text: 'Gatilho por condição sem nenhuma condição (avança logo depois do tempo de leitura).' });
    if (k.loadState && !k.state) out.push({ step: i, text: 'Marcado para carregar o estado guardado, mas nenhum estado foi capturado.' });
    if (k.visual.run === 'pausar' && k.advance.mode === 'condicao') out.push({ step: i, text: 'A simulação fica pausada nesta etapa: a condição física não vai mudar.' });
  });
  return out;
}
