/**
 * SINALIZAÇÃO PIROTÉCNICA E DE EMERGÊNCIA — sistema da física (valores FICTÍCIOS de simulação).
 *
 * Lançador de sinais no dorso do casco (logo atrás da vela) e alojamento da boia de emergência no convés de ré.
 * Fluxo do lançador (comando 'signal'): ocioso → selecionado → preparando → pronto → liberado (volta a
 * selecionado); cancelar volta a selecionado; uma falha de liberação deixa o lançador em FALHA até o reset.
 * As denominações (vermelho = emergência, amarelo = emersão…) são classificações do simulador, não códigos navais.
 * Não há procedimento interno de acionamento: só a sequência de interface.
 *
 * Cada dispositivo liberado (state.signals.runs) é um corpo independente do submarino:
 *  1. sai do lançador com a velocidade do submarino + a ejeção (para cima em relação ao casco);
 *  2. sobe com empuxo positivo: a velocidade tende à de subida livre (constante de tempo) e perde a velocidade
 *     horizontal do submarino; a água mexida pelas ondas (cinemática orbital do campo de ondas) o arrasta;
 *  3. ao atingir a superfície local (elevação da onda), flutua e deriva com o vento (fração windDrift);
 *  4. ativa o efeito: luz (cor), fumaça, luz + fumaça, estrela com paraquedas ou, na boia, luz piscando e a
 *     indicação fictícia de transmissão; o efeito dura `duration` e se extingue (a boia fica até o reabastecimento).
 * Falhas de treinamento (comando 'failure', alvo `signal:<id>`): liberação, subida, ativação, extinção prematura,
 * fumaça degradada, liberação e transmissão da boia. Persistem até serem removidas.
 *
 * Os dispositivos têm poucos quilos: não entram no balanço de massa do submarino (limitação documentada).
 */
import type { SignalColor, SignalKind, SignalsConfig, VesselConfig } from '../config/types';
import type { SignalFault, SignalPhase, SignalRun, SignalsState, SimState } from '../core/state';
import type { Mat3, Vec3 } from '../core/math';
import type { Environment } from '../environment/environment';
import { defaultSignals } from '../config/defaultVessel';
import { windOf } from '../environment/wind';

const G = 9.81;
const LOG = 'Sinalização';
/** dispositivos guardados na lista (os mais antigos encerrados saem primeiro) */
const MAX_RUNS = 24;
/** tempo em que um dispositivo encerrado continua na cena antes de sair da lista (s) */
const KEEP_ENDED = 90;
/** tempo dos estados transitórios do lançador (s) */
const TRANSIENT = 2;

export const SIGNAL_KINDS: SignalKind[] = ['vermelho', 'amarelo', 'verde', 'branco', 'fumaca', 'combinado', 'estrela', 'boia'];

/** O que o dispositivo faz na superfície. */
export type SignalEffect = 'luz' | 'fumaca' | 'combinado' | 'estrela' | 'boia';

export interface SignalInfo {
  /** nome completo */
  name: string;
  /** nome curto (tabelas, rótulos) */
  short: string;
  /** significado (classificação do simulador) */
  meaning: string;
  effect: SignalEffect;
  /** cores possíveis (a primeira é a padrão) — só as que existem nos modelos 3D */
  colors: SignalColor[];
  desc: string;
}

export const SIGNAL_INFO: Record<SignalKind, SignalInfo> = {
  vermelho: {
    name: 'Sinal vermelho — emergência',
    short: 'Vermelho',
    meaning: 'emergência',
    effect: 'luz',
    colors: ['vermelho'],
    desc: 'Cilindro vermelho que sobe à superfície e acende uma luz flutuante vermelha, com uma fumaça vermelha curta para ser visto de dia.',
  },
  amarelo: {
    name: 'Sinal amarelo — emersão',
    short: 'Amarelo',
    meaning: 'emersão',
    effect: 'luz',
    colors: ['amarelo'],
    desc: 'Cilindro amarelo: luz flutuante amarela e fumaça amarela curta. Indica (no simulador) a intenção de vir à superfície.',
  },
  verde: {
    name: 'Sinal verde — exercício',
    short: 'Verde',
    meaning: 'exercício',
    effect: 'luz',
    colors: ['verde'],
    desc: 'Cilindro verde: luz flutuante verde e fumaça verde curta. Marca um evento de exercício.',
  },
  branco: {
    name: 'Sinal branco — marcação de posição',
    short: 'Branco',
    meaning: 'marcação de posição',
    effect: 'luz',
    colors: ['branco'],
    desc: 'Cilindro branco: luz flutuante branca e fumaça branca curta. Marca a posição do submarino.',
  },
  fumaca: {
    name: 'Sinal de fumaça flutuante',
    short: 'Fumaça',
    meaning: 'marcação diurna',
    effect: 'fumaca',
    colors: ['laranja', 'vermelho', 'amarelo', 'verde', 'branco'],
    desc: 'Flutuador que solta fumaça densa colorida por alguns minutos; visível de dia, levada pelo vento.',
  },
  combinado: {
    name: 'Sinal combinado — luz e fumaça',
    short: 'Combinado',
    meaning: 'marcação diurna e noturna',
    effect: 'combinado',
    colors: ['laranja'],
    desc: 'Flutuador com emissores independentes: luz branca e fumaça laranja ao mesmo tempo.',
  },
  estrela: {
    name: 'Estrela com paraquedas',
    short: 'Estrela',
    meaning: 'sinal aéreo',
    effect: 'estrela',
    colors: ['branco', 'vermelho', 'amarelo', 'verde'],
    desc: 'Ao romper a superfície, lança uma estrela luminosa que sobe e desce lentamente presa a um paraquedas.',
  },
  boia: {
    name: 'Boia de emergência',
    short: 'Boia',
    meaning: 'emergência (localização)',
    effect: 'boia',
    colors: ['laranja'],
    desc: 'Boia que sobe do convés, flutua com luz piscando e indica transmissão (fictícia) da posição.',
  },
};

export const SIGNAL_FAULTS: { id: SignalFault; code: string; name: string; effect: string }[] = [
  { id: 'release', code: 'F01', name: 'Falha de liberação', effect: 'O dispositivo não sai do lançador; o lançador fica em FALHA até o reset (o dispositivo não é gasto).' },
  { id: 'ascent', code: 'F02', name: 'Falha de subida', effect: 'O dispositivo para no meio da subida, alaga e afunda devagar.' },
  { id: 'activation', code: 'F03', name: 'Falha de ativação', effect: 'O dispositivo chega à superfície mas não acende nem solta fumaça.' },
  { id: 'premature', code: 'F04', name: 'Extinção prematura', effect: `O efeito termina com uma fração da duração normal.` },
  { id: 'smoke', code: 'F05', name: 'Fumaça degradada', effect: 'A fumaça sai fraca e rala.' },
  { id: 'buoyRelease', code: 'F06', name: 'Falha de liberação da boia', effect: 'A boia não sai do alojamento.' },
  { id: 'buoyTx', code: 'F07', name: 'Falha de transmissão da boia', effect: 'A boia flutua, mas a transmissão (fictícia) fica em falha.' },
];

export const signalsCfg = (v: VesselConfig): SignalsConfig => v.signals ?? defaultSignals();

export function initSignals(v: VesselConfig): SignalsState {
  return { inventory: { ...signalsCfg(v).stock }, launcher: { state: 'ocioso', kind: null, color: null, t: 0 }, runs: [], faults: {}, count: 0 };
}

const COLOR_NAME: Record<SignalColor, string> = { vermelho: 'vermelho', amarelo: 'amarelo', verde: 'verde', branco: 'branco', laranja: 'laranja' };

/** Nome do dispositivo com a cor quando ela é escolhível (fumaça, estrela). */
export function signalLabel(kind: SignalKind, color?: SignalColor | null): string {
  const i = SIGNAL_INFO[kind];
  return i.colors.length > 1 && color ? `${i.short} ${COLOR_NAME[color]}` : i.short;
}

/** Dispositivo ainda na água ou no ar com algo a mostrar (subindo, flutuando, ativo). */
export const signalLive = (r: SignalRun) => r.phase === 'liberado' || r.phase === 'subindo' || r.phase === 'superficie' || r.phase === 'ativo';

/** Dispositivos em uso por tipo (liberados e ainda não encerrados). */
export function inUse(ss: SignalsState, kind: SignalKind): number {
  return ss.runs.filter((r) => r.kind === kind && signalLive(r)).length;
}

export type SystemStatus = 'PRONTO' | 'ATIVO' | 'DEGRADADO' | 'FALHA' | 'INDISPONÍVEL';

/**
 * Estado geral: FALHA (lançador em falha), INDISPONÍVEL (sem nenhum dispositivo a bordo), ATIVO (algum dispositivo
 * liberado ainda em curso), DEGRADADO (falha de treinamento ativa, algum tipo esgotado ou abaixo da profundidade
 * máxima de liberação), PRONTO.
 */
export function signalsStatus(ss: SignalsState, depth: number, cfg: SignalsConfig): { status: SystemStatus; why: string } {
  if (ss.launcher.state === 'falha') return { status: 'FALHA', why: 'lançador em falha — reset necessário' };
  const total = SIGNAL_KINDS.reduce((a, k) => a + (ss.inventory[k] ?? 0), 0);
  if (total === 0) return { status: 'INDISPONÍVEL', why: 'nenhum dispositivo a bordo' };
  if (ss.runs.some((r) => signalLive(r))) return { status: 'ATIVO', why: `${ss.runs.filter((r) => signalLive(r)).length} dispositivo(s) em curso` };
  const faults = SIGNAL_FAULTS.filter((f) => ss.faults[f.id]);
  if (faults.length) return { status: 'DEGRADADO', why: `falha de treinamento: ${faults.map((f) => f.code).join(', ')}` };
  if (depth > cfg.maxDepth) return { status: 'DEGRADADO', why: `abaixo da profundidade máxima de liberação (${cfg.maxDepth} m)` };
  const empty = SIGNAL_KINDS.filter((k) => (ss.inventory[k] ?? 0) === 0);
  if (empty.length) return { status: 'DEGRADADO', why: `esgotado: ${empty.map((k) => SIGNAL_INFO[k].short).join(', ')}` };
  return { status: 'PRONTO', why: 'lançador e inventário disponíveis' };
}

/** Duração planejada do efeito na superfície (s; a boia não se extingue). */
function plannedLife(cfg: SignalsConfig, kind: SignalKind): number {
  const e = SIGNAL_INFO[kind].effect;
  return e === 'luz' ? cfg.duration.light : e === 'fumaca' ? cfg.duration.smoke : e === 'combinado' ? cfg.duration.combined : e === 'estrela' ? cfg.duration.flare : Infinity;
}

/** Intensidade da luz (0…1) no instante t: acende em 1 s e apaga nos últimos 15 % da duração. */
export function signalLight(r: SignalRun, t: number): number {
  const eff = SIGNAL_INFO[r.kind].effect;
  if (eff === 'fumaca' || r.phase !== 'ativo' || r.tAct === null) return 0;
  if (eff === 'boia') return 1;
  const age = t - r.tAct;
  const fade = 0.15 * r.life;
  return Math.max(0, Math.min(1, age / 1, (r.life - age) / fade));
}

/** Emissão de fumaça (0…1): fumaça e combinado durante o efeito; sinais de cor, uma fumaça curta no começo. */
export function signalSmoke(r: SignalRun, t: number, cfg: SignalsConfig): number {
  const eff = SIGNAL_INFO[r.kind].effect;
  if (r.phase !== 'ativo' || r.tAct === null) return 0;
  const age = t - r.tAct;
  if (eff === 'fumaca' || eff === 'combinado') return Math.max(0, Math.min(1, age / 2, (r.life - age) / (0.2 * r.life))) * r.smokeK;
  if (eff === 'luz') return Math.max(0, Math.min(1, age / 1.5, 1 - age / Math.min(cfg.colorPuff, r.life))) * r.smokeK;
  return 0;
}

/** Ponto do corpo (m) → NED (m): pos + R·p. */
function bodyToNed(pos: Vec3, R: Mat3, p: Vec3): Vec3 {
  return { x: pos.x + R[0] * p.x + R[1] * p.y + R[2] * p.z, y: pos.y + R[3] * p.x + R[4] * p.y + R[5] * p.z, z: pos.z + R[6] * p.x + R[7] * p.y + R[8] * p.z };
}

/** Ponto de saída de um dispositivo no casco (m, corpo): lançador atrás da vela ou alojamento da boia, no dorso. */
export function releasePoint(cfg: SignalsConfig, kind: SignalKind, radiusAt: (x: number) => number): Vec3 {
  const x = kind === 'boia' ? cfg.buoyX : cfg.launcherX;
  return { x, y: 0, z: -(radiusAt(x) + 0.15) };
}

export interface SignalsCtx {
  s: SimState;
  v: VesselConfig;
  env: Environment;
  pos: Vec3;
  R: Mat3;
  /** velocidade do submarino (NED, m/s) */
  vel: Vec3;
  radiusAt: (x: number) => number;
  log: (text: string, group: string) => void;
}

const fmtDepth = (d: number) => `${Math.max(0, d).toFixed(0)} m`;

function setLauncher(ss: SignalsState, state: SignalsState['launcher']['state'], t: number) {
  ss.launcher.state = state;
  ss.launcher.t = t;
}

export type SignalAction = 'select' | 'prepare' | 'release' | 'cancel' | 'reset' | 'restock' | 'stock' | 'clear';

/** Ordem ao sistema de sinalização (comando 'signal'). */
export function signalCommand(c: SignalsCtx, action: SignalAction, p: { kind?: SignalKind; color?: SignalColor; count?: number }): void {
  const s = c.s;
  const ss = (s.signals ??= initSignals(c.v));
  const cfg = signalsCfg(c.v);
  const L = ss.launcher;
  const t = s.t;
  const busy = L.state === 'preparando' || L.state === 'pronto';
  switch (action) {
    case 'select': {
      const k = p.kind;
      if (!k || !SIGNAL_INFO[k]) return;
      if (L.state === 'falha') return c.log(`Seleção recusada: lançador em FALHA (fazer o reset)`, LOG);
      if (busy) return c.log(`Seleção recusada: ${signalLabel(L.kind!, L.color)} já ${L.state === 'pronto' ? 'PRONTO' : 'em preparação'} (cancelar antes)`, LOG);
      const info = SIGNAL_INFO[k];
      const color = p.color && info.colors.includes(p.color) ? p.color : info.colors[0];
      L.kind = k;
      L.color = color;
      setLauncher(ss, 'selecionado', t);
      c.log(`${signalLabel(k, color).toUpperCase()} SELECIONADO (${info.meaning}; a bordo: ${ss.inventory[k] ?? 0})`, LOG);
      return;
    }
    case 'prepare': {
      if (L.state !== 'selecionado' || !L.kind) return c.log(`Preparação recusada: ${L.state === 'falha' ? 'lançador em FALHA' : 'selecione um dispositivo antes'}`, LOG);
      if ((ss.inventory[L.kind] ?? 0) <= 0) return c.log(`Preparação recusada: ${SIGNAL_INFO[L.kind].short} esgotado`, LOG);
      const depth = s.body.pos.z;
      if (depth > cfg.maxDepth) return c.log(`Preparação recusada: profundidade ${fmtDepth(depth)} além do máximo de liberação (${cfg.maxDepth} m)`, LOG);
      setLauncher(ss, 'preparando', t);
      c.log(`${signalLabel(L.kind, L.color).toUpperCase()}: PREPARANDO (${cfg.prepareTime.toFixed(0)} s)`, LOG);
      return;
    }
    case 'release': {
      if (L.state !== 'pronto' || !L.kind) return c.log(`Liberação recusada: o dispositivo não está PRONTO`, LOG);
      const kind = L.kind;
      const color = L.color ?? SIGNAL_INFO[kind].colors[0];
      const depth = s.body.pos.z;
      if (depth > cfg.maxDepth) return c.log(`Liberação recusada: profundidade ${fmtDepth(depth)} além do máximo (${cfg.maxDepth} m)`, LOG);
      if ((ss.inventory[kind] ?? 0) <= 0) return c.log(`Liberação recusada: ${SIGNAL_INFO[kind].short} esgotado`, LOG);
      const fail = kind === 'boia' ? ss.faults.buoyRelease : ss.faults.release;
      if (fail) {
        setLauncher(ss, 'falha', t);
        c.log(`FALHA DE LIBERAÇÃO: ${signalLabel(kind, color).toUpperCase()} não saiu ${kind === 'boia' ? 'do alojamento' : 'do lançador'} (${kind === 'boia' ? 'F06' : 'F01'})`, LOG);
        return;
      }
      ss.inventory[kind] = (ss.inventory[kind] ?? 0) - 1;
      ss.count++;
      const id = `${kind === 'boia' ? 'B' : 'S'}${String(ss.count).padStart(2, '0')}`;
      const pb = releasePoint(cfg, kind, c.radiusAt);
      const p0 = bodyToNed(c.pos, c.R, pb);
      // ejeção para cima do casco (eixo −z do corpo)
      const up = { x: -c.R[2], y: -c.R[5], z: -c.R[8] };
      const ej = kind === 'boia' ? cfg.eject * 0.5 : cfg.eject;
      const run: SignalRun = {
        id,
        kind,
        color,
        tRel: t,
        n: p0.x,
        e: p0.y,
        d: p0.z,
        vn: c.vel.x + up.x * ej,
        ve: c.vel.y + up.y * ej,
        vd: c.vel.z + up.z * ej,
        phase: 'liberado',
        tPhase: t,
        depth0: Math.max(0, p0.z),
        tSurf: null,
        tAct: null,
        tEnd: null,
        life: plannedLife(cfg, kind),
        fault: null,
        smokeK: ss.faults.smoke ? cfg.degradedSmoke : 1,
        flare: null,
        tx: 'off',
        track: [{ n: p0.x, e: p0.y, d: p0.z }],
      };
      ss.runs.push(run);
      trimRuns(ss, t);
      setLauncher(ss, 'liberado', t);
      c.log(`${signalLabel(kind, color).toUpperCase()} LIBERADO (${id}) a ${fmtDepth(depth)} — restam ${ss.inventory[kind]}`, LOG);
      return;
    }
    case 'cancel':
      if (!busy) return;
      setLauncher(ss, 'cancelado', t);
      c.log(`${signalLabel(L.kind!, L.color).toUpperCase()}: PREPARAÇÃO CANCELADA`, LOG);
      return;
    case 'reset':
      setLauncher(ss, 'ocioso', t);
      L.kind = null;
      L.color = null;
      c.log('Lançador de sinais: RESET (ocioso)', LOG);
      return;
    case 'restock':
      ss.inventory = { ...cfg.stock };
      ss.runs = ss.runs.filter((r) => signalLive(r) && r.kind !== 'boia');
      c.log(`Manutenção: inventário reabastecido (${SIGNAL_KINDS.map((k) => `${SIGNAL_INFO[k].short} ${cfg.stock[k]}`).join(', ')}); boia recolhida`, LOG);
      return;
    case 'stock': {
      const k = p.kind;
      if (!k || !SIGNAL_INFO[k] || p.count === undefined || !Number.isFinite(p.count)) return;
      const n = Math.max(0, Math.min(k === 'boia' ? 2 : 20, Math.round(p.count)));
      ss.inventory[k] = n;
      c.log(`Manutenção: ${SIGNAL_INFO[k].short} a bordo = ${n}`, LOG);
      return;
    }
    case 'clear': {
      const before = ss.runs.length;
      ss.runs = ss.runs.filter((r) => signalLive(r));
      if (before !== ss.runs.length) c.log(`Dispositivos encerrados retirados da lista (${before - ss.runs.length})`, LOG);
      return;
    }
  }
}

/** Mantém a lista curta: sai primeiro o dispositivo encerrado mais antigo. */
function trimRuns(ss: SignalsState, t: number) {
  ss.runs = ss.runs.filter((r) => r.tEnd === null || t - r.tEnd < KEEP_ENDED || r.kind === 'boia');
  while (ss.runs.length > MAX_RUNS) {
    const i = ss.runs.findIndex((r) => !signalLive(r));
    ss.runs.splice(i >= 0 ? i : 0, 1);
  }
}

function setPhase(r: SignalRun, ph: SignalPhase, t: number) {
  r.phase = ph;
  r.tPhase = t;
}

const orbital = { vn: 0, ve: 0, vz: 0, an: 0, ae: 0, az: 0, pd: 0 };

/** Um passo do sistema: lançador e dispositivos liberados. */
export function updateSignals(c: SignalsCtx, dt: number): void {
  const s = c.s;
  const ss = s.signals;
  if (!ss) return;
  const cfg = signalsCfg(c.v);
  const t = s.t;
  const L = ss.launcher;
  // lançador
  if (L.state === 'preparando' && t - L.t >= cfg.prepareTime) {
    setLauncher(ss, 'pronto', t);
    c.log(`${signalLabel(L.kind!, L.color).toUpperCase()}: PRONTO para liberar`, LOG);
  } else if ((L.state === 'liberado' || L.state === 'cancelado') && t - L.t >= TRANSIENT) {
    const next = L.kind && (ss.inventory[L.kind] ?? 0) > 0 ? 'selecionado' : 'ocioso';
    setLauncher(ss, next, t);
    if (next === 'ocioso') {
      L.kind = null;
      L.color = null;
    }
  }
  if (!ss.runs.length) return;
  const waves = c.env.waves;
  const wind = windOf(c.env.cfg.waves);
  let removed = false;
  for (const r of ss.runs) {
    const name = `${signalLabel(r.kind, r.color)} ${r.id}`;
    const surf = -waves.elevation(r.n, r.e, t);
    const isBuoy = r.kind === 'boia';
    switch (r.phase) {
      case 'liberado':
      case 'subindo': {
        if (r.phase === 'liberado' && t - r.tPhase >= 1) setPhase(r, 'subindo', t);
        // falha de subida: para no meio do caminho (ou após 6 s, de cotas rasas) e afunda devagar
        const failAscent = !isBuoy && ss.faults.ascent && r.fault === null && (r.d <= 0.55 * r.depth0 || t - r.tRel > 6) && r.d > surf + 3;
        if (failAscent) {
          r.fault = 'subida';
          setPhase(r, 'falha', t);
          r.tEnd = t;
          c.log(`FALHA DE SUBIDA: ${name} parou a ${fmtDepth(r.d)} e está afundando (F02)`, LOG);
          break;
        }
        const vUp = isBuoy ? cfg.ascent.buoy : cfg.ascent.signal;
        waves.kinematics(r.n, r.e, Math.max(0, r.d), t, orbital);
        r.vd += (-vUp + orbital.vz - r.vd) * Math.min(1, dt / cfg.tau.vertical);
        r.vn += (orbital.vn - r.vn) * Math.min(1, dt / cfg.tau.horizontal);
        r.ve += (orbital.ve - r.ve) * Math.min(1, dt / cfg.tau.horizontal);
        r.n += r.vn * dt;
        r.e += r.ve * dt;
        r.d += r.vd * dt;
        const last = r.track[r.track.length - 1];
        if (!last || Math.hypot(r.n - last.n, r.e - last.e, r.d - last.d) > 1.5) r.track.push({ n: r.n, e: r.e, d: r.d });
        if (r.track.length > 240) r.track.splice(1, 1);
        if (r.d <= surf) {
          r.d = surf;
          r.tSurf = t;
          r.track.push({ n: r.n, e: r.e, d: r.d });
          setPhase(r, 'superficie', t);
          c.log(`${name}: CHEGOU À SUPERFÍCIE (${(t - r.tRel).toFixed(0)} s após a liberação, ${Math.hypot(r.n - r.track[0].n, r.e - r.track[0].e).toFixed(0)} m do ponto de saída)`, LOG);
        }
        break;
      }
      case 'superficie':
      case 'ativo':
      case 'extinto': {
        // flutua na superfície local e deriva com o vento e a água das ondas
        waves.kinematics(r.n, r.e, 0, t, orbital);
        r.vn = orbital.vn + wind.n * cfg.windDrift;
        r.ve = orbital.ve + wind.e * cfg.windDrift;
        r.vd = 0;
        r.n += r.vn * dt;
        r.e += r.ve * dt;
        r.d = -waves.elevation(r.n, r.e, t);
        if (r.phase === 'superficie' && t - r.tPhase >= (isBuoy ? 2 : 1.2)) activate(c, ss, cfg, r, name, t);
        else if (r.phase === 'ativo') runActive(c, cfg, r, name, t, dt, wind);
        else if (r.phase === 'extinto' && r.kind === 'estrela' && r.flare) fallFlare(cfg, r, dt, wind, t);
        break;
      }
      case 'falha': {
        if (r.fault === 'subida') {
          // alagado: afunda devagar até sumir
          r.vd += (0.35 - r.vd) * Math.min(1, dt / 3);
          r.vn *= Math.exp(-dt / 4);
          r.ve *= Math.exp(-dt / 4);
          r.n += r.vn * dt;
          r.e += r.ve * dt;
          r.d += r.vd * dt;
        } else {
          r.n += wind.n * cfg.windDrift * dt;
          r.e += wind.e * cfg.windDrift * dt;
          r.d = -waves.elevation(r.n, r.e, t);
        }
        break;
      }
    }
    if (r.tEnd !== null && t - r.tEnd >= KEEP_ENDED && !isBuoy) removed = true;
  }
  if (removed) trimRuns(ss, t);
}

function activate(c: SignalsCtx, ss: SignalsState, cfg: SignalsConfig, r: SignalRun, name: string, t: number) {
  const eff = SIGNAL_INFO[r.kind].effect;
  if (eff === 'boia') {
    setPhase(r, 'ativo', t);
    r.tAct = t;
    r.tx = ss.faults.buoyTx ? 'falha' : 'ok';
    if (r.tx === 'falha') r.fault = 'transmissão';
    c.log(`${name}: FLUTUANDO — luz piscando; transmissão ${r.tx === 'ok' ? 'ATIVA (indicação fictícia)' : 'EM FALHA (F07)'}`, LOG);
    return;
  }
  if (ss.faults.activation) {
    r.fault = 'ativação';
    setPhase(r, 'falha', t);
    r.tEnd = t;
    c.log(`FALHA DE ATIVAÇÃO: ${name} está na superfície mas não acendeu (F03)`, LOG);
    return;
  }
  if (ss.faults.premature) {
    r.life *= cfg.prematureFactor;
    r.fault = 'extinção prematura';
  }
  setPhase(r, 'ativo', t);
  r.tAct = t;
  if (eff === 'estrela') r.flare = { alt: 0.5, vz: Math.sqrt(2 * G * cfg.flare.apex), chute: 0, dn: 0, de: 0 };
  const what = eff === 'luz' ? 'luz acesa' : eff === 'fumaca' ? 'fumaça' : eff === 'combinado' ? 'luz e fumaça' : 'estrela lançada';
  c.log(`${name} ATIVO — ${what}${r.smokeK < 1 && eff !== 'estrela' ? ' (fumaça degradada, F05)' : ''}`, LOG);
}

function runActive(c: SignalsCtx, cfg: SignalsConfig, r: SignalRun, name: string, t: number, dt: number, wind: { n: number; e: number }) {
  if (r.kind === 'estrela' && r.flare) fallFlare(cfg, r, dt, wind, t);
  if (r.kind === 'boia' || r.tAct === null) return;
  if (t - r.tAct >= r.life) {
    setPhase(r, 'extinto', t);
    r.tEnd = t;
    c.log(`${name}: EXTINTO após ${(t - r.tAct).toFixed(0)} s${r.fault === 'extinção prematura' ? ' (extinção prematura, F04)' : ''}`, LOG);
  }
}

/** Estrela: subida balística até o ápice, abertura do paraquedas e descida lenta levada pelo vento. */
function fallFlare(cfg: SignalsConfig, r: SignalRun, dt: number, wind: { n: number; e: number }, t: number) {
  const f = r.flare!;
  if (f.chute <= 0 && f.vz > 0) {
    f.vz -= G * dt;
    if (f.vz <= 0) f.chute = 0.001;
  } else {
    f.chute = Math.min(1, f.chute + dt / 1.5);
    f.vz += (-cfg.flare.descent - f.vz) * Math.min(1, dt / 1.2);
  }
  f.alt = Math.max(0, f.alt + f.vz * dt);
  // no ar: deriva com o vento inteiro (o flutuador continua na água; o deslocamento da estrela fica relativo a ele)
  f.dn += wind.n * dt;
  f.de += wind.e * dt;
  // de volta ao mar: some (apagada) ou apaga ao tocar a água
  if (f.alt <= 0 && f.chute > 0) {
    if (r.phase === 'extinto') r.flare = null;
    else if (r.tAct !== null) r.life = Math.min(r.life, t - r.tAct);
  }
}
