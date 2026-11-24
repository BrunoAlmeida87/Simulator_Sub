/**
 * DEBRIEFING — avaliação pós-exercício a partir do que a simulação já registra (alarmes, comandos, eventos do
 * instrutor e histórico). Funções puras (testes em tests/debrief.test.ts). A nota é INDICATIVA: um resumo para
 * a conversa com a equipe, não uma avaliação formal.
 */
import type { SimState } from '../sim/core/state';
import type { VesselConfig } from '../sim/config/types';
import type { HistoryRecorder } from '../sim/history';

export interface AlarmResponse {
  id: string;
  text: string;
  priority: number;
  raised: number;
  acked: number | null;
}

export interface EventReaction {
  label: string;
  fired: number;
  /** primeiro comando do operador depois do evento (s) */
  reaction: number | null;
  firstCommand: string | null;
}

export interface DebriefReport {
  duration: number;
  alarms: AlarmResponse[];
  byPriority: Record<number, number>;
  ackMean: number | null;
  ackMax: number | null;
  unacked: number;
  events: EventReaction[];
  maxDepth: number;
  maxPitch: number;
  maxRoll: number;
  overOperating: number;
  overTest: boolean;
  depthRms: number | null;
  score: number;
  notes: string[];
}

/** grupos de comandos que não são ações do operador */
const NOT_OPERATOR = new Set(['Instrutor', 'Falhas', 'Gravação', 'Apresentação', 'Avarias:auto']);

export function alarmResponses(s: SimState): AlarmResponse[] {
  const out: AlarmResponse[] = [];
  const open = new Map<string, AlarmResponse>();
  for (const ev of s.alarms.log) {
    if (ev.event === 'ATIVADO') {
      const r: AlarmResponse = { id: ev.id, text: ev.text, priority: ev.priority, raised: ev.t, acked: null };
      out.push(r);
      open.set(ev.id, r);
    } else if (ev.event === 'RECONHECIDO') {
      const r = open.get(ev.id);
      if (r && r.acked === null) r.acked = ev.t;
    }
  }
  return out;
}

export function eventReactions(s: SimState): EventReaction[] {
  return (s.instructor?.events ?? [])
    .filter((ev) => ev.fired && ev.firedAt !== undefined)
    .map((ev) => {
      const c = s.commands.find((x) => x.t > ev.firedAt! + 1e-6 && !NOT_OPERATOR.has(x.group) && !x.text.startsWith('INSTRUTOR') && !x.text.startsWith('FALHA'));
      return { label: ev.label, fired: ev.firedAt!, reaction: c ? c.t - ev.firedAt! : null, firstCommand: c ? `[${c.group}] ${c.text}` : null };
    });
}

/** percorre o histórico (mais antigo → mais recente) */
function eachSample(h: HistoryRecorder, fn: (i: number) => void): void {
  const start = (h.head - h.count + h.capacity) % h.capacity;
  for (let k = 0; k < h.count; k++) fn((start + k) % h.capacity);
}

export function buildDebrief(cfg: VesselConfig, s: SimState, h: HistoryRecorder | null): DebriefReport {
  const alarms = alarmResponses(s);
  const byPriority: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const a of alarms) byPriority[a.priority] = (byPriority[a.priority] ?? 0) + 1;
  const ackTimes = alarms.filter((a) => a.acked !== null).map((a) => a.acked! - a.raised);
  const ackMean = ackTimes.length ? ackTimes.reduce((x, y) => x + y, 0) / ackTimes.length : null;
  const ackMax = ackTimes.length ? Math.max(...ackTimes) : null;
  const unacked = Object.values(s.alarms.runtime).filter((r) => !r.acked).length;
  let maxDepth = 0,
    maxPitch = 0,
    maxRoll = 0,
    overOperating = 0,
    se = 0,
    n = 0;
  if (h && h.count) {
    const dt = h.interval;
    eachSample(h, (i) => {
      const d = h.data.depth[i];
      maxDepth = Math.max(maxDepth, d);
      maxPitch = Math.max(maxPitch, Math.abs(h.data.pitch[i]));
      maxRoll = Math.max(maxRoll, Math.abs(h.data.roll[i]));
      if (d > cfg.limits.operatingDepth) overOperating += dt;
      const set = h.data.depthSet[i];
      if (Number.isFinite(set)) {
        se += (d - set) ** 2;
        n++;
      }
    });
  }
  const depthRms = n ? Math.sqrt(se / n) : null;
  const overTest = maxDepth > cfg.limits.testDepth || s.alarms.log.some((a) => a.id === 'DEPTH_TEST');
  const events = eventReactions(s);
  const notes: string[] = [];
  let score = 100;
  const pAl = Math.min(40, 6 * byPriority[1] + 3 * byPriority[2] + 1 * byPriority[3]);
  if (pAl) notes.push(`−${pAl}: alarmes (${byPriority[1]} críticos, ${byPriority[2]} altos, ${byPriority[3]} médios)`);
  score -= pAl;
  if (ackMean !== null && ackMean > 10) {
    const p = Math.min(15, Math.round((ackMean - 10) * 0.5));
    if (p) notes.push(`−${p}: reconhecimento médio de alarme em ${ackMean.toFixed(0)} s (meta ≤ 10 s)`);
    score -= p;
  }
  if (unacked) {
    const p = Math.min(10, 2 * unacked);
    notes.push(`−${p}: ${unacked} alarme(s) sem reconhecer`);
    score -= p;
  }
  if (overOperating > 0) {
    notes.push(`−10: ${overOperating.toFixed(0)} s além da profundidade operacional`);
    score -= 10;
  }
  if (overTest) {
    notes.push('−20: profundidade de teste ultrapassada');
    score -= 20;
  }
  if (s.alarms.log.some((a) => a.id === 'CONTACT')) {
    notes.push('−10: contato com o fundo');
    score -= 10;
  }
  const slow = events.filter((ev) => ev.reaction === null || ev.reaction > 30);
  if (slow.length) {
    const p = Math.min(15, 5 * slow.length);
    notes.push(`−${p}: ${slow.length} evento(s) do instrutor sem reação do operador em 30 s`);
    score -= p;
  }
  if (!notes.length) notes.push('Sem descontos: nenhum alarme, limite ou reação lenta registrados.');
  return { duration: s.t, alarms, byPriority, ackMean, ackMax, unacked, events, maxDepth, maxPitch, maxRoll, overOperating, overTest, depthRms, score: Math.max(0, Math.round(score)), notes };
}

/** relatório em texto (para baixar ou colar numa ata) */
export function debriefText(r: DebriefReport, title: string): string {
  const t = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  const L: string[] = [];
  L.push(`DEBRIEFING — ${title}`);
  L.push(`Duração simulada: ${t(r.duration)}   Nota indicativa: ${r.score}/100`);
  L.push('');
  L.push('Descontos:');
  for (const n of r.notes) L.push(`  ${n}`);
  L.push('');
  L.push(
    `Profundidade máxima ${r.maxDepth.toFixed(1)} m · pitch máx. ${r.maxPitch.toFixed(1)}° · banda máx. ${r.maxRoll.toFixed(1)}°${r.depthRms !== null ? ` · erro RMS de cota (piloto) ${r.depthRms.toFixed(2)} m` : ''}`,
  );
  L.push(`Alarmes: ${r.alarms.length} (P1 ${r.byPriority[1]}, P2 ${r.byPriority[2]}, P3 ${r.byPriority[3]}, P4 ${r.byPriority[4]}); reconhecimento médio ${r.ackMean !== null ? r.ackMean.toFixed(1) + ' s' : '—'}`);
  L.push('');
  if (r.events.length) {
    L.push('Eventos do instrutor:');
    for (const ev of r.events) L.push(`  ${t(ev.fired)}  ${ev.label} → ${ev.reaction !== null ? `reação em ${ev.reaction.toFixed(0)} s: ${ev.firstCommand}` : 'sem reação registrada'}`);
    L.push('');
  }
  L.push('Alarmes (ativação → reconhecimento):');
  for (const a of r.alarms) L.push(`  ${t(a.raised)}  P${a.priority} ${a.text}${a.acked !== null ? ` → reconhecido em ${(a.acked - a.raised).toFixed(0)} s` : ' → não reconhecido'}`);
  return L.join('\n');
}
