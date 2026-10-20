/**
 * GRAVAÇÃO DE COMANDOS — formato do arquivo e conferência da reprodução.
 *
 * Uma gravação guarda:
 *  - a SESSÃO INICIAL completa (configuração + estado + identificação…),
 *    exatamente como no instante em que a gravação começou;
 *  - os COMANDOS estruturados (tipo Command), cada um com o número do passo
 *    fixo em que foi aplicado, o tempo de simulação e a origem (operador ou
 *    automação que o emitiu);
 *  - as mensagens de narração das automações (só para o histórico);
 *  - PONTOS DE CONTROLE periódicos (posição, atitude, velocidade, bateria e
 *    um resumo numérico do estado) para conferir a reprodução.
 *
 * Como a física usa passo fixo e é determinística, reaplicar os mesmos
 * comandos nos mesmos passos a partir do mesmo estado reproduz a mesma
 * evolução. Limitações: entre versões diferentes do simulador (física
 * alterada) ou navegadores com funções matemáticas diferentes (sen, exp…
 * podem diferir no último dígito) a reprodução pode divergir aos poucos —
 * os pontos de controle mostram quanto.
 */
import type { Command } from './commands';
import type { SimulationEngine } from './core/engine';
import { migrateSave, encodeNonFinite, decodeNonFinite, type SaveFile } from './persistence';
import { SIM_VERSION } from './version';

export const REC_FORMAT = 'sx1-gravacao';
export const REC_VERSION = 1;

export interface RecEvent {
  /** nº do passo (state.step) em que o comando foi aplicado: antes de executar o passo step+1 */
  step: number;
  t: number;
  /** 'operador', 'manobra', 'demonstracao', 'guiado', 'rota'… */
  src: string;
  cmd?: Command;
  /** narração (mensagem de histórico emitida por uma automação) */
  note?: { text: string; group: string };
}

export interface Checkpoint {
  step: number;
  t: number;
  n: number;
  e: number;
  z: number;
  heading: number;
  pitch: number;
  u: number;
  soc: number;
  /** resumo numérico do estado físico (igualdade exata ⇔ mesmo estado) */
  hash: string;
}

export interface RecordingFile {
  format: string;
  version: number;
  simVersion: string;
  name: string;
  createdAt: string;
  dt: number;
  initial: SaveFile;
  events: RecEvent[];
  checkpoints: Checkpoint[];
  end: { step: number; t: number };
}

/** intervalo entre pontos de controle (s de simulação) */
export const CHECKPOINT_EVERY = 10;

/** Resumo FNV-1a de 64 bits (dois de 32) dos números do estado físico, sem o histórico de mensagens. */
export function stateHash(e: SimulationEngine): string {
  const s = e.state;
  const src = { ...s, commands: undefined, alarms: { runtime: s.alarms.runtime }, nav: { ...s.nav, trail: s.nav.trail.length } };
  const json = JSON.stringify(encodeNonFinite(src));
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export function makeCheckpoint(e: SimulationEngine): Checkpoint {
  const s = e.state;
  return {
    step: s.step,
    t: s.t,
    n: s.body.pos.x,
    e: s.body.pos.y,
    z: s.body.pos.z,
    heading: e.outputs.euler.heading,
    pitch: e.outputs.euler.pitch,
    u: s.body.vel.x,
    soc: s.electrical.soc,
    hash: stateHash(e),
  };
}

export interface CheckpointDiff {
  step: number;
  t: number;
  exact: boolean;
  /** distância horizontal + vertical entre a posição gravada e a reproduzida (m) */
  dPos: number;
  dHeading: number;
}

export function compareCheckpoint(rec: Checkpoint, e: SimulationEngine): CheckpointDiff {
  const now = makeCheckpoint(e);
  const dh = Math.abs(((now.heading - rec.heading + 540) % 360) - 180);
  return { step: rec.step, t: rec.t, exact: now.hash === rec.hash, dPos: Math.hypot(now.n - rec.n, now.e - rec.e, now.z - rec.z), dHeading: dh };
}

export function recordingToText(r: RecordingFile): string {
  return JSON.stringify(encodeNonFinite(r));
}

export interface ParsedRecording {
  rec: RecordingFile;
  /** avisos de compatibilidade (versão diferente etc.) */
  warnings: string[];
}

/** Valida uma gravação (texto ou objeto). Lança Error com mensagem em português. */
export function parseRecording(input: string | unknown): ParsedRecording {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new Error('O arquivo não é um JSON válido.');
    }
  }
  if (!raw || typeof raw !== 'object') throw new Error('Arquivo não reconhecido.');
  const r = raw as Record<string, unknown>;
  if (r.format === 'sx1-simulador') throw new Error('Este arquivo é uma SESSÃO salva (não uma gravação): carregue-o em “Sessão — salvar e continuar”.');
  if (r.format !== REC_FORMAT) throw new Error('Arquivo não reconhecido como gravação de comandos.');
  const v = Number(r.version ?? 1);
  if (v > REC_VERSION) throw new Error(`Gravação de uma versão mais nova do simulador (${String(r.simVersion ?? 'formato ' + v)}). Atualize o simulador.`);
  if (!Array.isArray(r.events) || !r.initial || !r.end) throw new Error('Gravação incompleta (faltam o estado inicial ou os comandos).');
  const rec = decodeNonFinite(structuredClone(r)) as unknown as RecordingFile;
  rec.initial = migrateSave(rec.initial);
  rec.checkpoints = Array.isArray(rec.checkpoints) ? rec.checkpoints : [];
  rec.events = rec.events.filter((ev) => ev && Number.isFinite(ev.step) && (ev.cmd || ev.note)).sort((a, b) => a.step - b.step);
  const warnings: string[] = [];
  if (rec.simVersion !== SIM_VERSION)
    warnings.push(
      `Gravada com o simulador ${rec.simVersion || 'de versão desconhecida'} (este é o ${SIM_VERSION}). Se a física mudou entre as versões, a reprodução pode divergir do original; os pontos de controle mostram a diferença.`,
    );
  if (rec.initial.migratedFrom) warnings.push('O estado inicial estava num formato antigo e foi convertido.');
  return { rec, warnings };
}

/** Descrição curta de um comando (para listas). */
export function describeCommand(c: Command): string {
  switch (c.type) {
    case 'telegraph':
      return `telégrafo ${c.rpm} rpm`;
    case 'surface':
      return `leme ${c.id} ${c.angle}°`;
    case 'autopilot':
      return `piloto ${c.channel} ${c.mode}`;
    case 'setpoint':
      return `referência ${c.channel} = ${c.value}`;
    case 'mbtVent':
      return `suspiro ${c.tank} ${c.open ? 'abrir' : 'fechar'}`;
    case 'mbtBlow':
      return `sopro ${c.tank} ${c.open ? 'abrir' : 'fechar'}`;
    case 'dosing':
      return `${c.system}: ${c.mode} ${Math.round(c.kg)} kg`;
    case 'failure':
      return `falha ${c.target} ${c.active ? 'ON' : 'OFF'}`;
    default:
      return c.type;
  }
}
