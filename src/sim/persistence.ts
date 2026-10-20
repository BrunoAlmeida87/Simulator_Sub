/**
 * Serialização do estado completo da simulação (configuração + estado físico
 * + dados de sessão da interface). O formato é JSON puro: pode ser salvo no
 * armazenamento local do navegador ou exportado como arquivo e aberto em
 * outro computador com uma versão compatível do simulador.
 *
 * Versões do formato:
 *  - 1: configuração + estado físico (versão estável anterior).
 *  - 2: acrescenta `session` (automações em andamento, aceleração,
 *       identificação, referência geográfica) e `simVersion`; números não
 *       finitos (NaN/±∞) são preservados com um marcador, para que a
 *       continuação seja exatamente igual à simulação original.
 * Arquivos v1 continuam sendo aceitos (migração automática ao carregar).
 */
import type { SimConfig } from './config/types';
import type { SimState } from './core/state';
import { SimulationEngine } from './core/engine';
import { createState } from './core/initialState';
import { defaultSimConfig } from './config/defaultVessel';
import { SIM_VERSION } from './version';

export const SAVE_FORMAT = 'sx1-simulador';
export const SAVE_VERSION = 2;

/** Dados da sessão além do motor físico, preenchidos pela interface. */
export interface SessionExtras {
  /** fator de aceleração da simulação no momento do salvamento */
  timeScale?: number;
  /** automações em andamento (manobra, demonstração, cenário guiado, rota, checklist) */
  automation?: Record<string, unknown>;
  /** identificação visual do submarino (nome, inscrição, cores) */
  identity?: unknown;
  /** outras referências da interface (ex.: origem geográfica do mapa) */
  ui?: Record<string, unknown>;
}

export interface SaveFile {
  format: string;
  version: number;
  name: string;
  savedAt: string;
  simTime: number;
  scenarioId: string;
  /** versão do simulador que gravou o arquivo (v2+) */
  simVersion?: string;
  config: SimConfig;
  state: SimState;
  session?: SessionExtras;
  /** preenchido ao carregar: versão de formato original quando houve migração */
  migratedFrom?: number;
}

// ------------------------------------------------------------ números não finitos
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Cópia profunda trocando NaN/±∞ por {"$nf": "..."} (JSON transformaria em null). */
export function encodeNonFinite<T>(v: T): T {
  const enc = (x: unknown): unknown => {
    if (typeof x === 'number') return Number.isFinite(x) ? x : { $nf: Number.isNaN(x) ? 'NaN' : x > 0 ? 'Inf' : '-Inf' };
    if (Array.isArray(x)) return x.map(enc);
    if (x && typeof x === 'object') {
      if (ArrayBuffer.isView(x)) return Array.from(x as unknown as ArrayLike<number>).map(enc);
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x)) if (val !== undefined) o[k] = enc(val);
      return o;
    }
    return x;
  };
  return enc(v) as T;
}

/** Inverso de encodeNonFinite (aceita também dados sem marcadores). */
export function decodeNonFinite<T>(v: T): T {
  const dec = (x: Json): unknown => {
    if (Array.isArray(x)) return x.map(dec);
    if (x && typeof x === 'object') {
      const keys = Object.keys(x);
      if (keys.length === 1 && keys[0] === '$nf' && typeof x.$nf === 'string') return x.$nf === 'NaN' ? NaN : x.$nf === 'Inf' ? Infinity : -Infinity;
      const o: Record<string, unknown> = {};
      for (const k of keys) o[k] = dec(x[k]);
      return o;
    }
    return x;
  };
  return dec(v as unknown as Json) as T;
}

// ------------------------------------------------------------ gravação
export function serializeEngine(e: SimulationEngine, name: string, session?: SessionExtras): SaveFile {
  return encodeNonFinite<SaveFile>({
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    name,
    savedAt: new Date().toISOString(),
    simTime: e.state.t,
    scenarioId: e.state.scenarioId,
    simVersion: SIM_VERSION,
    config: e.config,
    state: e.state,
    session,
  });
}

// ------------------------------------------------------------ leitura e migração
/**
 * Completa um objeto com as chaves que faltam (vindas de `defaults`), sem
 * sobrescrever nada que já exista. Listas não são mescladas. `skip` lista
 * caminhos opcionais cuja ausência tem significado (ex.: ondas ausentes =
 * mar calmo nas versões antigas).
 */
function fillMissing(target: Record<string, unknown>, defaults: Record<string, unknown>, skip: Set<string>, path = ''): void {
  for (const [k, dv] of Object.entries(defaults)) {
    const p = path ? `${path}.${k}` : k;
    if (skip.has(p)) continue;
    const tv = target[k];
    if (tv === undefined) {
      if (dv !== undefined) target[k] = structuredClone(dv);
    } else if (tv && dv && typeof tv === 'object' && typeof dv === 'object' && !Array.isArray(tv) && !Array.isArray(dv)) {
      fillMissing(tv as Record<string, unknown>, dv as Record<string, unknown>, skip, p);
    }
  }
}

/** campos opcionais da configuração cuja ausência deve ser mantida (comportamento antigo) */
const CONFIG_OPTIONAL = new Set(['environment.waves', 'vessel.mass.demoWeight', 'environment.bottom.mode', 'environment.geo']);
/** campos opcionais do estado que não devem ser criados */
const STATE_OPTIONAL = new Set(['trimRef']);

/**
 * Valida e converte um arquivo (de qualquer versão aceita) para o formato
 * atual em memória. Lança Error com mensagem em português se não for possível.
 */
export function migrateSave(raw: unknown): SaveFile {
  if (!raw || typeof raw !== 'object') throw new Error('Arquivo não reconhecido (não é um estado do simulador).');
  const r = raw as Record<string, unknown>;
  if (r.format === 'sx1-gravacao') throw new Error('Este arquivo é uma GRAVAÇÃO de comandos: carregue-o em “Gravação e reprodução”.');
  if (r.format !== SAVE_FORMAT) throw new Error('Arquivo não reconhecido (formato inválido).');
  const version = Number(r.version ?? 1);
  if (!Number.isFinite(version) || version < 1) throw new Error('Versão de arquivo inválida.');
  if (version > SAVE_VERSION) throw new Error(`Arquivo gravado por uma versão mais nova do simulador (${String(r.simVersion ?? `formato ${version}`)}). Atualize o simulador para abri-lo.`);
  if (!r.config || !r.state || typeof r.config !== 'object' || typeof r.state !== 'object') throw new Error('Arquivo incompleto: faltam a configuração ou o estado.');
  const f = decodeNonFinite(structuredClone(r)) as unknown as SaveFile;
  // configuração: completa campos obrigatórios acrescentados em versões posteriores
  fillMissing(f.config as unknown as Record<string, unknown>, defaultSimConfig() as unknown as Record<string, unknown>, CONFIG_OPTIONAL);
  // fundo: arquivos sem "modo" usam o relevo (comportamento das versões anteriores)
  const b = f.config.environment.bottom;
  if (b && b.mode === undefined) b.mode = 'relevo';
  // estado: completa com um estado novo construído para a mesma configuração
  const st = f.state;
  const pose = { depth: st.body?.pos?.z ?? 0, heading: 0, north: st.body?.pos?.x ?? 0, east: st.body?.pos?.y ?? 0 };
  const def = createState(f.config, pose, String(f.scenarioId ?? st.scenarioId ?? 'superficie'), true);
  fillMissing(st as unknown as Record<string, unknown>, def as unknown as Record<string, unknown>, STATE_OPTIONAL);
  if (version < SAVE_VERSION) f.migratedFrom = version;
  f.version = SAVE_VERSION;
  f.name = String(f.name ?? 'Estado sem nome');
  f.scenarioId = String(f.scenarioId ?? st.scenarioId);
  f.simTime = Number(f.simTime ?? st.t ?? 0);
  return f;
}

export function deserializeEngine(raw: SaveFile | unknown): SimulationEngine {
  const f = migrateSave(raw);
  return new SimulationEngine(f.config, f.state);
}

/** Texto JSON pronto para arquivo. */
export const saveToText = (f: SaveFile): string => JSON.stringify(f);

/** Lê o texto de um arquivo salvo (qualquer versão aceita). */
export const parseSaveText = (text: string): SaveFile => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('O arquivo não é um JSON válido.');
  }
  return migrateSave(raw);
};
