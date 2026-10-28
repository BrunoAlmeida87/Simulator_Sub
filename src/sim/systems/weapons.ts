/**
 * TUBOS LANÇADORES E TORPEDOS (tiro de exercício) — sistema da física.
 *
 * Sequência de lançamento em cada tubo (como num submarino convencional moderno):
 *  1. ALIMENTAR a arma e passar os dados de tiro (alvo, velocidade, cota, rumo);
 *  2. ALAGAR: a água do tanque de compensação das armas (TCA) enche o espaço em volta da arma;
 *     o suspiro descarrega o ar do tubo para dentro do casco (peso total inalterado);
 *  3. EQUALIZAR com o mar: a pressão do tubo sobe até a pressão externa na cota da boca;
 *  4. ABRIR a porta da boca (hidráulica; só com o tubo equalizado);
 *  5. DISPARAR: a garrafa de lançamento (ar AP) aciona o cilindro de ejeção, que empurra água para
 *     a culatra e expulsa a arma (≈ 13 m/s na boca). A reação empurra o submarino para ré.
 *  Depois do disparo, a água do mar ocupa no tubo o lugar da arma; a compensação automática das
 *  armas (AWC) admite ou descarrega água no TCA para manter o peso de referência:
 *     W = Σ armas nos tubos + Σ água dos tubos + água dos TCA + armas de reserva  (constante)
 *  Assim o submarino continua neutro; sobra só um pequeno binário (a água fica mais a ré que a arma).
 *  RECARREGAR: fechar a porta, drenar o tubo para o TCA, abrir a culatra, puxar uma arma da reserva.
 *
 * Corrida do torpedo (cinemática simples, sem hidrodinâmica da arma): partida do motor, afastamento
 * em linha reta até a distância de segurança, guiagem pelo fio para o ponto de interceptação do alvo,
 * aquisição pelo autodiretor (alcance e cone) e ataque. É tiro de EXERCÍCIO: a arma passa sob o alvo,
 * registra o acerto e, no fim da corrida, flutua para ser recolhida. Os alvos são os contatos fictícios
 * do quadro tático (geo.ts) e o tráfego adicional (traffic.ts), funções do tempo de simulação.
 */
import type { VesselConfig, ValveConfig, WeaponsConfig, TorpedoTubeConfig } from '../config/types';
import type { SimState, TorpedoRun, TubePresets, TubeState, WeaponsState, ValveState } from '../core/state';
import type { Vec3 } from '../core/math';
import type { StepContext } from '../core/context';
import type { Environment } from '../environment/environment';
import { R_AIR, RHO_NOMINAL } from '../core/context';
import { newValve } from '../core/state';
import { updateValve } from './components';
import { bankTempK, drawFromManifold, manifoldMass } from './hpAir';
import { newDosing, tankWaterCentroid } from './internalTanks';
import { boreVolume, ejectTravel, muzzleX, stowedWeaponX, tubeLength } from './torpedoTubes';
import { contactsLocal, DEFAULT_ORIGIN, type Contact, type LatLon } from '../geo';
import { trafficAt, trafficForEnv } from '../traffic';

type RadiusAt = (x: number) => number;

const VALVE: ValveConfig = { id: 'VTT', name: 'Válvula do tubo', strokeTime: 2, hydraulic: true };
const doorValve = (w: WeaponsConfig): ValveConfig => ({ id: 'PT', name: 'Porta da boca', strokeTime: w.doorTime, hydraulic: true });
const breechValve = (w: WeaponsConfig): ValveConfig => ({ id: 'CT', name: 'Culatra', strokeTime: w.breechTime, hydraulic: true });

/** massa de ar da garrafa de lançamento na pressão p */
const flaskMass = (w: WeaponsConfig, p: number, T: number) => (p * w.flask.volume) / (R_AIR * T);
export const flaskPressure = (w: WeaponsConfig, m: number, T: number) => (m * R_AIR * T) / w.flask.volume;

export const DEFAULT_PRESETS: TubePresets = { target: null, speed: 'alta', depth: 30, course: null };

const tubeName = (t: { n: number; side?: string }) => `Tubo ${t.n}`;

export function initWeapons(v: VesselConfig, R: RadiusAt): WeaponsState | undefined {
  const w = v.weapons;
  if (!w) return undefined;
  const T = v.hpAir.temperature + 273.15;
  const reserve = v.mass.shiftLoads?.find((l) => l.id === w.reserveLoad)?.quantity ?? 0;
  const tubes: TubeState[] = w.tubes.map((tc, i) => ({
    n: tc.n,
    weapon: i < w.initialLoaded,
    energized: false,
    water: 0,
    pressure: v.internalPressure,
    flood: newValve(),
    vent: newValve(),
    equalize: newValve(),
    drain: newValve(),
    door: newValve(),
    breech: newValve(),
    flask: flaskMass(w, w.flask.pressure, T),
    presets: { ...DEFAULT_PRESETS },
    auto: null,
    eject: null,
    ejectV: 0,
    reload: null,
  }));
  const st: WeaponsState = {
    tubes,
    runs: [],
    tca: w.tca.map((t) => ({ mass: t.initialVolume * RHO_NOMINAL, flow: 0 })),
    awcRef: 0,
    awcFlow: 0,
    reserve,
    fired: 0,
  };
  st.awcRef = weaponsWeight(w, st);
  st.awcMomentRef = weaponsMoment(v, st, R);
  st.awcTrim = 0;
  return st;
}

/** Momento longitudinal (Σ m·x, kg·m) das armas, da água dos tubos, dos TCA e da reserva (na estiva). */
export function weaponsMoment(v: VesselConfig, st: WeaponsState, R: RadiusAt): number {
  const w = v.weapons!;
  const home = v.mass.shiftLoads?.find((l) => l.id === w.reserveLoad)?.home.x ?? 0;
  let m = st.reserve * w.weapon.mass * home;
  w.tubes.forEach((tc, i) => {
    const t = st.tubes[i];
    if (t.weapon) m += w.weapon.mass * (stowedWeaponX(w) + (t.eject ?? 0));
    m += t.water * (w.breechX + tubeLength(w, tc, R) / 2);
  });
  w.tca.forEach((tk, k) => (m += st.tca[k].mass * tk.center.x));
  return m;
}

/** Espaço livre nos TCA (kg). */
export const tcaFree = (w: WeaponsConfig, st: WeaponsState) => Math.max(0, w.tca.reduce((a, k) => a + k.capacity, 0) * RHO_NOMINAL - st.tca.reduce((a, k) => a + k.mass, 0));

/** Peso mantido pela compensação automática (kg). */
export function weaponsWeight(w: WeaponsConfig, st: WeaponsState): number {
  let m = st.reserve * w.weapon.mass;
  for (const t of st.tubes) m += (t.weapon ? w.weapon.mass : 0) + t.water;
  for (const k of st.tca) m += k.mass;
  return m;
}

/** Água para encher o tubo (kg): o furo inteiro menos a arma. */
export const fullWater = (w: WeaponsConfig, tc: TorpedoTubeConfig, t: TubeState, R: RadiusAt) => Math.max(0, boreVolume(w, tc, R) - (t.weapon ? w.weapon.volume : 0)) * RHO_NOMINAL;

/** Pressão do mar na boca do tubo (Pa). */
export function seaPressureAtTube(ctx: Pick<StepContext, 'env' | 'depthOf' | 'rhoLocal'>, w: WeaponsConfig, tc: TorpedoTubeConfig, R: RadiusAt): number {
  const d = Math.max(0, ctx.depthOf({ x: muzzleX(w, tc, R), y: tc.y, z: tc.z }));
  return ctx.env.cfg.atmosphericPressure + ctx.rhoLocal * ctx.env.cfg.gravity * d;
}

const BAR = 1e5;
const EQ_TOL = 0.05 * BAR;

export interface TubeView {
  /** estado resumido (para telas e painéis) */
  status: string;
  /** cor do estado: neutro, andamento, pronto, alerta */
  tone: 'off' | 'busy' | 'ready' | 'warn';
  flooded: boolean;
  equalized: boolean;
  ready: boolean;
  fullWater: number;
  seaPressure: number;
  flaskBar: number;
}

/** Leitura do estado de um tubo para as telas (não altera nada). */
export function tubeView(v: VesselConfig, s: SimState, ctx: Pick<StepContext, 'env' | 'depthOf' | 'rhoLocal'>, R: RadiusAt, i: number): TubeView {
  const w = v.weapons!;
  const tc = w.tubes[i];
  const t = s.weapons!.tubes[i];
  const full = fullWater(w, tc, t, R);
  const sea = seaPressureAtTube(ctx, w, tc, R);
  const flooded = t.water >= full - 2;
  const equalized = flooded && t.equalize.pos > 0.999 && Math.abs(t.pressure - sea) < EQ_TOL;
  const ready = t.weapon && t.energized && equalized && t.door.pos > 0.999 && t.eject === null;
  const T = v.hpAir.temperature + 273.15;
  const base = { flooded, equalized, ready, fullWater: full, seaPressure: sea, flaskBar: flaskPressure(w, t.flask, T) / BAR };
  let status = '';
  let tone: TubeView['tone'] = 'off';
  if (t.eject !== null) [status, tone] = ['DISPARANDO', 'warn'];
  else if (t.reload !== null) [status, tone] = [`RECARREGANDO ${Math.round((100 * t.reload) / w.reloadTime)}%`, 'busy'];
  else if (ready) [status, tone] = ['PRONTO PARA DISPARO', 'ready'];
  else if (t.door.pos > 0.001 && t.door.pos < 0.999) [status, tone] = [t.door.cmd > 0.5 ? 'ABRINDO A PORTA' : 'FECHANDO A PORTA', 'busy'];
  else if (t.breech.pos > 0.001) [status, tone] = [t.breech.pos < 0.999 ? 'CULATRA EM MOVIMENTO' : 'CULATRA ABERTA', 'busy'];
  else if (t.drain.pos > 0.001 && t.water > 1) [status, tone] = ['DRENANDO', 'busy'];
  else if (t.flood.pos > 0.001 && !flooded) [status, tone] = ['ALAGANDO', 'busy'];
  else if (t.equalize.pos > 0.001 && !equalized) [status, tone] = ['EQUALIZANDO', 'busy'];
  else if (t.door.pos > 0.999) [status, tone] = [t.weapon ? 'PORTA ABERTA' : 'VAZIO, PORTA ABERTA', t.weapon ? 'busy' : 'warn'];
  else if (equalized) [status, tone] = [t.weapon ? 'EQUALIZADO' : 'VAZIO, ALAGADO', 'busy'];
  else if (flooded) [status, tone] = [t.weapon ? 'ALAGADO' : 'VAZIO, ALAGADO', t.weapon ? 'busy' : 'off'];
  else if (t.weapon) [status, tone] = [t.energized ? 'CARREGADO, ARMA ALIMENTADA' : 'CARREGADO (SECO)', 'off'];
  else [status, tone] = ['VAZIO', 'off'];
  return { ...base, status, tone };
}

// ------------------------------------------------------------------ alvos

/** Contatos que podem ser alvo (os mesmos do quadro tático): fixos + tráfego adicional. */
export function weaponTargets(env: Environment, origin: LatLon, t: number, traffic: number): Contact[] {
  const fixed = contactsLocal(t, origin);
  const extra = traffic > 0 ? trafficAt(t, trafficForEnv(env, origin, traffic), origin) : [];
  return [...fixed, ...extra];
}

const DEG = Math.PI / 180;
const wrap360 = (a: number) => ((a % 360) + 360) % 360;
const angDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180;

/** Rumo de interceptação (ponto futuro do alvo à velocidade da arma); sem solução, o rumo direto. */
export function interceptCourse(from: { n: number; e: number }, speed: number, tg: { n: number; e: number; course: number; speed: number }): number {
  const rn = tg.n - from.n;
  const re = tg.e - from.e;
  const vn = Math.cos(tg.course * DEG) * tg.speed;
  const ve = Math.sin(tg.course * DEG) * tg.speed;
  // |r + v·t| = s·t  →  (v² − s²)t² + 2(r·v)t + r² = 0
  const a = vn * vn + ve * ve - speed * speed;
  const b = 2 * (rn * vn + re * ve);
  const c = rn * rn + re * re;
  let tt = -1;
  if (Math.abs(a) < 1e-9) tt = b < 0 ? -c / b : -1;
  else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const r1 = (-b - Math.sqrt(disc)) / (2 * a);
      const r2 = (-b + Math.sqrt(disc)) / (2 * a);
      tt = [r1, r2].filter((x) => x > 0).sort((p, q) => p - q)[0] ?? -1;
    }
  }
  const pn = tt > 0 ? rn + vn * tt : rn;
  const pe = tt > 0 ? re + ve * tt : re;
  return wrap360(Math.atan2(pe, pn) / DEG);
}

// ------------------------------------------------------------------ comandos

export type TubeAction =
  'preparar' | 'disparar' | 'fechar' | 'recarregar' | 'cancelar' | 'alimentar' | 'alagar' | 'equalizar' | 'abrirPorta' | 'fecharPorta' | 'drenar' | 'abrirCulatra' | 'fecharCulatra' | 'carregar' | 'dados';

export const TUBE_ACTION_LABEL: Record<TubeAction, string> = {
  preparar: 'preparar (alagar, equalizar, abrir a porta)',
  disparar: 'disparar',
  fechar: 'fechar a porta (tubo continua alagado)',
  recarregar: 'recarregar da reserva',
  cancelar: 'cancelar a sequência',
  alimentar: 'alimentar a arma',
  alagar: 'alagar',
  equalizar: 'equalizar com o mar',
  abrirPorta: 'abrir a porta da boca',
  fecharPorta: 'fechar a porta da boca',
  drenar: 'drenar para o TCA',
  abrirCulatra: 'abrir a culatra',
  fecharCulatra: 'fechar a culatra',
  carregar: 'carregar arma da reserva',
  dados: 'dados de tiro',
};

export interface TubeCmdCtx {
  v: VesselConfig;
  s: SimState;
  R: RadiusAt;
  /** pressão do mar na boca de cada tubo (Pa) */
  sea: (i: number) => number;
  log: (text: string, group: string) => void;
  /** origem geográfica e tráfego adicional (para achar o alvo durante a corrida) */
  origin?: LatLon;
  traffic?: number;
  /** nome do alvo (para o histórico) */
  targetName?: (id: string) => string | undefined;
}

const G = 'Armas';

function presetText(p: TubePresets, name?: string): string {
  const alvo = p.target ? `alvo ${name ?? p.target}` : 'sem alvo';
  const rumo = p.course === null ? 'rumo do submarino' : `rumo ${Math.round(p.course).toString().padStart(3, '0')}°`;
  return `${alvo}, velocidade ${p.speed}, cota ${Math.round(p.depth)} m, ${rumo}`;
}

/** Aplica uma ordem a um tubo. Recusas são registradas com o motivo (o estado não muda). */
export function tubeCommand(c: TubeCmdCtx, n: number, action: TubeAction, presets?: Partial<TubePresets>): void {
  const w = c.v.weapons;
  const ws = c.s.weapons;
  if (!w || !ws) return;
  const i = w.tubes.findIndex((t) => t.n === n);
  if (i < 0) return c.log(`Ordem recusada: tubo ${n} não existe.`, G);
  const tc = w.tubes[i];
  const t = ws.tubes[i];
  const nm = tubeName(tc);
  const refuse = (why: string) => c.log(`${nm}: ${TUBE_ACTION_LABEL[action]} recusado — ${why}.`, G);
  const full = fullWater(w, tc, t, c.R);
  const flooded = t.water >= full - 2;
  const sea = c.sea(i);
  const equalized = flooded && t.equalize.pos > 0.999 && Math.abs(t.pressure - sea) < EQ_TOL;
  if (presets) {
    t.presets = { ...t.presets, ...presets };
    if (t.presets.depth < 3) t.presets.depth = 3;
    if (t.presets.course !== null) t.presets.course = wrap360(t.presets.course);
    if (c.origin) t.origin = c.origin;
    if (c.traffic !== undefined) t.traffic = c.traffic;
  }
  if (t.eject !== null) return refuse('disparo em andamento');
  switch (action) {
    case 'dados':
      c.log(`${nm}: dados de tiro — ${presetText(t.presets, t.presets.target ? c.targetName?.(t.presets.target) : undefined)}`, G);
      return;
    case 'cancelar':
      if (!t.auto) return;
      c.log(`${nm}: sequência "${t.auto}" cancelada pelo operador`, G);
      t.auto = null;
      return;
    case 'preparar':
    case 'disparar':
      if (!t.weapon) return refuse('tubo vazio (recarregar da reserva)');
      if (t.breech.pos > 0.001 || t.breech.cmd > 0) return refuse('culatra aberta');
      if (t.reload !== null) return refuse('recarga em andamento');
      t.auto = action;
      c.log(`${nm}: ${action === 'disparar' ? 'preparar e disparar' : 'preparar para disparo'} — ${presetText(t.presets, t.presets.target ? c.targetName?.(t.presets.target) : undefined)}`, G);
      if (action === 'disparar' && tubeReadyNow(c.v, t, full, sea)) fire(c, i);
      return;
    case 'fechar':
      t.auto = 'fechar';
      c.log(`${nm}: fechar a porta da boca e isolar o tubo do mar`, G);
      return;
    case 'recarregar':
      if (t.weapon) return refuse('já há arma no tubo');
      if (ws.reserve <= 0) return refuse('sem armas de reserva');
      if (t.water > tcaFree(w, ws) + 1) return refuse(`sem espaço nos TCA para a água do tubo (${(t.water / RHO_NOMINAL).toFixed(2)} m³)`);
      t.auto = 'recarregar';
      c.log(`${nm}: recarregar — fechar a porta, drenar, abrir a culatra e puxar uma arma da reserva (${ws.reserve} a bordo)`, G);
      return;
    case 'alimentar':
      if (!t.weapon) return refuse('tubo vazio');
      t.energized = !t.energized;
      c.log(`${nm}: arma ${t.energized ? 'alimentada — ' + presetText(t.presets, t.presets.target ? c.targetName?.(t.presets.target) : undefined) : 'desligada'}`, G);
      return;
    case 'alagar':
      if (t.breech.pos > 0.001) return refuse('culatra aberta');
      if (flooded) return refuse('tubo já alagado');
      t.flood.cmd = 1;
      t.vent.cmd = 1;
      t.drain.cmd = 0;
      c.log(`${nm}: alagar — água do TCA, suspiro aberto para dentro do casco`, G);
      return;
    case 'equalizar':
      if (!flooded) return refuse('tubo não está alagado');
      t.vent.cmd = 0;
      t.flood.cmd = 0;
      t.equalize.cmd = 1;
      c.log(`${nm}: equalizar com o mar (${(sea / BAR).toFixed(1)} bar na boca)`, G);
      return;
    case 'abrirPorta':
      if (!equalized) return refuse(`tubo não equalizado (tubo ${(t.pressure / BAR).toFixed(1)} bar, mar ${(sea / BAR).toFixed(1)} bar)`);
      t.door.cmd = 1;
      c.log(`${nm}: abrir a porta da boca`, G);
      return;
    case 'fecharPorta':
      t.door.cmd = 0;
      c.log(`${nm}: fechar a porta da boca`, G);
      return;
    case 'drenar':
      if (t.door.pos > 0.001) return refuse('porta da boca aberta');
      if (t.water <= 1) return refuse('tubo já seco');
      if (t.water > tcaFree(w, ws) + 1) return refuse(`sem espaço nos TCA para a água do tubo (${(t.water / RHO_NOMINAL).toFixed(2)} m³)`);
      t.equalize.cmd = 0;
      t.flood.cmd = 0;
      t.vent.cmd = 1;
      t.drain.cmd = 1;
      c.log(`${nm}: drenar para o TCA (suspiro aberto)`, G);
      return;
    case 'abrirCulatra':
      if (t.door.pos > 0.001) return refuse('porta da boca aberta');
      if (t.water > 1) return refuse('tubo com água (drenar antes)');
      t.breech.cmd = 1;
      c.log(`${nm}: abrir a culatra`, G);
      return;
    case 'fecharCulatra':
      if (t.reload !== null) return refuse('recarga em andamento');
      t.breech.cmd = 0;
      c.log(`${nm}: fechar a culatra`, G);
      return;
    case 'carregar':
      if (t.breech.pos < 0.999) return refuse('culatra fechada');
      if (t.weapon) return refuse('já há arma no tubo');
      if (ws.reserve <= 0) return refuse('sem armas de reserva');
      t.reload = 0;
      c.log(`${nm}: carregar uma arma da reserva (${Math.round(w.reloadTime / 60)} min)`, G);
      return;
  }
}

function tubeReadyNow(v: VesselConfig, t: TubeState, full: number, sea: number): boolean {
  const w = v.weapons!;
  void w;
  return t.weapon && t.water >= full - 2 && t.equalize.pos > 0.999 && Math.abs(t.pressure - sea) < EQ_TOL && t.door.pos > 0.999 && t.eject === null;
}

/** Disparo: a garrafa de lançamento aciona a ejeção (a arma corre no tubo nos passos seguintes). */
function fire(c: TubeCmdCtx, i: number): void {
  const w = c.v.weapons!;
  const t = c.s.weapons!.tubes[i];
  const T = c.v.hpAir.temperature + 273.15;
  if (flaskPressure(w, t.flask, T) < w.flask.minPressure) {
    c.log(`${tubeName(t)}: disparo recusado — garrafa de lançamento abaixo de ${Math.round(w.flask.minPressure / BAR)} bar`, G);
    t.auto = null;
    return;
  }
  if (!t.energized) t.energized = true;
  // a garrafa descarrega no cilindro de ejeção; o ar sai para dentro do casco (suspiro do cilindro)
  const residual = flaskMass(w, 20 * BAR, T);
  const used = Math.max(0, t.flask - residual);
  t.flask = residual;
  c.s.ledger.airVented += used;
  t.eject = 0;
  t.ejectV = 0;
  t.auto = null;
  c.log(`${tubeName(t)}: FOGO — ejeção por ar comprimido (${used.toFixed(0)} kg de ar AP descarregados para dentro do casco)`, G);
}

/** Ordens a um torpedo já lançado (pelo fio). */
export type TorpedoAction = 'cortarFio' | 'alvo' | 'rumo' | 'cota' | 'recolher';

export function torpedoCommand(c: TubeCmdCtx, id: string, action: TorpedoAction, p: { target?: string | null; course?: number; depth?: number }): void {
  const ws = c.s.weapons;
  const r = ws?.runs.find((x) => x.id === id);
  if (!ws || !r) return;
  const refuse = (why: string) => c.log(`Torpedo ${id}: ordem recusada — ${why}.`, G);
  if (action === 'recolher') {
    if (r.phase !== 'recolher') return refuse('ainda em corrida');
    ws.runs = ws.runs.filter((x) => x !== r);
    c.log(`Torpedo ${id} (exercício) recolhido`, G);
    return;
  }
  if (r.phase === 'flutuando' || r.phase === 'recolher') return refuse('corrida terminada');
  if (action === 'cortarFio') {
    if (!r.wire) return;
    r.wire = false;
    c.log(`Torpedo ${id}: fio cortado — a arma segue sozinha (autodiretor)`, G);
    return;
  }
  if (!r.wire) return refuse('sem fio de guiagem');
  if (action === 'alvo') {
    r.target = p.target ?? null;
    r.presets = { ...r.presets, target: r.target };
    r.tgt = null;
    if (r.phase === 'ataque') r.phase = 'guiado';
    c.log(`Torpedo ${id}: novo alvo pelo fio — ${r.target ? (c.targetName?.(r.target) ?? r.target) : 'nenhum (corrida no rumo)'}`, G);
  } else if (action === 'rumo' && p.course !== undefined) {
    r.presets = { ...r.presets, course: wrap360(p.course) };
    if (!r.target && r.phase !== 'afastamento') r.cmdHeading = r.presets.course!;
    c.log(`Torpedo ${id}: rumo ${Math.round(wrap360(p.course)).toString().padStart(3, '0')}° pelo fio`, G);
  } else if (action === 'cota' && p.depth !== undefined) {
    r.presets = { ...r.presets, depth: Math.max(3, p.depth) };
    c.log(`Torpedo ${id}: cota ${Math.round(r.presets.depth)} m pelo fio`, G);
  }
}

// ------------------------------------------------------------------ passo

export interface WeaponsStepInput {
  ctx: StepContext;
  R: RadiusAt;
  /** velocidade do submarino (NED, m/s) e rumo (°) */
  velNED: Vec3;
  heading: number;
}

export interface WeaponsStepResult {
  strokes: number;
  /** reação da ejeção no submarino (corpo): força e momento */
  F: Vec3;
  M: Vec3;
}

/** Atualiza tubos, compensação automática e torpedos lançados (um passo fixo). */
export function updateWeapons(v: VesselConfig, s: SimState, inp: WeaponsStepInput): WeaponsStepResult {
  const w = v.weapons;
  const ws = s.weapons;
  const out: WeaponsStepResult = { strokes: 0, F: { x: 0, y: 0, z: 0 }, M: { x: 0, y: 0, z: 0 } };
  if (!w || !ws) return out;
  const { ctx, R } = inp;
  const dt = ctx.dt;
  const hyd = ctx.hydraulicFactor > 0;
  const T = bankTempK(v.hpAir);
  const atm = v.internalPressure;
  const tcaTotal = () => ws.tca.reduce((a, k) => a + k.mass, 0);
  const tcaCap = w.tca.reduce((a, k) => a + k.capacity, 0) * RHO_NOMINAL;
  const tcaMove = (dm: number) => {
    // + entra nos TCA, dividido em partes iguais (os dois tanques ficam no mesmo nível)
    const n = ws.tca.length;
    for (let k = 0; k < n; k++) {
      ws.tca[k].mass = Math.max(0, ws.tca[k].mass + dm / n);
      ws.tca[k].flow += dm / n / dt / RHO_NOMINAL;
    }
  };
  for (const k of ws.tca) k.flow = 0;
  const cmdCtx: TubeCmdCtx = { v, s, R, sea: (i) => seaPressureAtTube(ctx, w, w.tubes[i], R), log: ctx.log };

  w.tubes.forEach((tc, i) => {
    const t = ws.tubes[i];
    const sea = seaPressureAtTube(ctx, w, tc, R);
    for (const vv of [t.flood, t.vent, t.equalize, t.drain]) out.strokes += updateValve(VALVE, vv, dt, hyd);
    out.strokes += updateValve(doorValve(w), t.door, dt, hyd);
    out.strokes += updateValve(breechValve(w), t.breech, dt, hyd);
    const full = fullWater(w, tc, t, R);

    // alagamento a partir do TCA (o suspiro precisa estar aberto para o ar sair)
    if (t.flood.pos > 0 && t.vent.pos > 0 && t.water < full) {
      const q = Math.min(w.floodRate * RHO_NOMINAL * Math.min(t.flood.pos, t.vent.pos) * dt, full - t.water, tcaTotal());
      t.water += q;
      tcaMove(-q);
    }
    // equalização com o mar: completa a água que faltar e iguala a pressão
    if (t.equalize.pos > 0) {
      if (t.water < full) {
        const q = Math.min(2 * w.floodRate * RHO_NOMINAL * t.equalize.pos * dt, full - t.water);
        t.water += q;
        s.ledger.seaIn += q;
      }
      t.pressure += (sea - t.pressure) * (1 - Math.exp((-dt * t.equalize.pos) / w.equalizeTau));
    } else if (t.door.pos > 0.001) t.pressure = sea;
    else if (t.vent.pos > 0) t.pressure += (atm - t.pressure) * (1 - Math.exp((-dt * t.vent.pos) / 1.0));
    // drenagem para o TCA (porta fechada, isolado do mar, suspiro aberto)
    if (t.drain.pos > 0 && t.vent.pos > 0 && t.door.pos <= 0.001 && t.equalize.pos <= 0.001 && t.water > 0) {
      const q = Math.min(w.drainRate * RHO_NOMINAL * Math.min(t.drain.pos, t.vent.pos) * dt, t.water, Math.max(0, tcaCap - tcaTotal()));
      t.water -= q;
      tcaMove(q);
    }
    // recarga a partir da reserva
    if (t.reload !== null) {
      if (t.breech.pos < 0.999) t.reload = null;
      else {
        t.reload += dt;
        if (t.reload >= w.reloadTime) {
          t.reload = null;
          if (ws.reserve > 0) {
            t.weapon = true;
            t.energized = false;
            ws.reserve -= 1;
            ctx.log(`${tubeName(tc)}: arma carregada da reserva (${ws.reserve} na reserva)`, G);
          }
        }
      }
    }
    // recarga da garrafa de lançamento pelo coletor de ar AP
    const target = Math.min(w.flask.pressure, s.hpAir.manifoldPressure);
    const deficit = flaskMass(w, target, T) - t.flask;
    if (deficit > 1e-6 && t.eject === null) {
      const dm = Math.min(w.flask.rechargeFlow * dt, deficit, manifoldMass(v.hpAir, s));
      if (dm > 0) {
        drawFromManifold(v.hpAir, s, dm);
        t.flask += dm;
      }
    }
    // ejeção: aceleração constante até a cauda passar a boca
    if (t.eject !== null) {
      const travel = ejectTravel(w, tc, R);
      const a = (w.ejectSpeed * w.ejectSpeed) / (2 * travel);
      t.ejectV += a * dt;
      t.eject += t.ejectV * dt;
      // reação: arma + parte da água do tubo aceleradas para vante
      const Fx = -(w.weapon.mass + 0.5 * t.water) * a;
      const at = { x: w.breechX + tubeLength(w, tc, R) / 2, y: tc.y, z: tc.z };
      out.F.x += Fx;
      // M = r × F, F = (Fx, 0, 0)
      out.M.y += at.z * Fx;
      out.M.z += -at.y * Fx;
      if (t.eject >= travel) launch(v, s, inp, i, sea);
    }
    // sequências automáticas
    if (t.auto) runAuto(cmdCtx, i, full, sea);
  });

  // compensação automática das armas (AWC)
  const err = ws.awcRef - weaponsWeight(w, ws);
  let q = Math.max(-w.awcRate * dt, Math.min(w.awcRate * dt, err));
  if (Math.abs(err) < 0.5) q = 0;
  if (q > 0) q = Math.min(q, Math.max(0, tcaCap - tcaTotal()));
  else q = Math.max(q, -tcaTotal());
  if (q !== 0) {
    tcaMove(q);
    if (q > 0) s.ledger.seaIn += q;
    else s.ledger.seaOut += -q;
  }
  ws.awcFlow = q / dt;

  // compensação automática do trim: com os tubos parados, uma transferência TT-AV ↔ TT-AR anula a
  // variação do momento das armas (alagar, disparar, drenar e recarregar levam peso para vante ou ré)
  if (ws.awcMomentRef === undefined) ws.awcMomentRef = weaponsMoment(v, ws, R);
  const busy = ws.tubes.some((t) => t.eject !== null || t.reload !== null || t.flood.pos > 0 || t.drain.pos > 0 || (t.equalize.pos > 0 && t.equalize.pos < 1) || t.breech.pos > 0);
  const tr = s.trim;
  if (!busy && !(tr.dosing && tr.dosing.active) && !tr.pump.cmd && Math.abs(ws.awcFlow) < 1e-6) {
    const lever = v.trim.tankA.center.x - v.trim.tankB.center.x;
    const errM = weaponsMoment(v, ws, R) - ws.awcMomentRef + (ws.awcTrim ?? 0);
    if (Math.abs(errM) > 0.03 * lever * RHO_NOMINAL) {
      const fwd = errM > 0; // proa mais pesada: passar água do TT-AV para o TT-AR
      const src = fwd ? tr.tankA.mass : tr.tankB.mass;
      const kg = Math.min(Math.abs(errM) / lever, Math.max(0, src - 50));
      if (kg >= 20) {
        tr.dosing = newDosing('transferir', kg, fwd ? 'AtoB' : 'BtoA');
        ws.awcTrim = (ws.awcTrim ?? 0) - Math.sign(errM) * kg * lever;
        ctx.log(`Compensação automática das armas: corrigir o trim — transferir ${kg.toFixed(0)} kg ${fwd ? 'TT-AV → TT-AR' : 'TT-AR → TT-AV'}`, G);
      }
    }
  }

  for (const r of ws.runs) updateRun(v, s, inp, r);
  return out;
}

function runAuto(c: TubeCmdCtx, i: number, full: number, sea: number): void {
  const w = c.v.weapons!;
  const t = c.s.weapons!.tubes[i];
  const nm = tubeName(t);
  const flooded = t.water >= full - 2;
  const equalized = flooded && t.equalize.pos > 0.999 && Math.abs(t.pressure - sea) < EQ_TOL;
  switch (t.auto) {
    case 'preparar':
    case 'disparar': {
      if (!t.weapon) {
        t.auto = null;
        return;
      }
      if (!t.energized) {
        t.energized = true;
        c.log(`${nm}: arma alimentada, dados de tiro carregados`, G);
      }
      if (!flooded) {
        if (t.flood.cmd < 1 || t.vent.cmd < 1) {
          t.flood.cmd = 1;
          t.vent.cmd = 1;
          c.log(`${nm}: alagando com a água do TCA`, G);
        }
        return;
      }
      if (t.flood.cmd > 0 || t.vent.cmd > 0) {
        t.flood.cmd = 0;
        t.vent.cmd = 0;
      }
      if (t.flood.pos > 0 || t.vent.pos > 0) return;
      if (!equalized) {
        if (t.equalize.cmd < 1) {
          t.equalize.cmd = 1;
          c.log(`${nm}: tubo alagado; equalizando com o mar (${(sea / BAR).toFixed(1)} bar)`, G);
        }
        return;
      }
      if (t.door.pos < 0.999) {
        if (t.door.cmd < 1) {
          t.door.cmd = 1;
          c.log(`${nm}: equalizado; abrindo a porta da boca`, G);
        }
        return;
      }
      if (t.auto === 'preparar') {
        t.auto = null;
        c.log(`${nm}: PRONTO PARA DISPARO`, G);
      } else fire(c, i);
      return;
    }
    case 'fechar':
      if (t.door.cmd > 0) t.door.cmd = 0;
      if (t.door.pos > 0.001) return;
      t.equalize.cmd = 0;
      if (t.equalize.pos > 0.001) return;
      t.auto = null;
      c.log(`${nm}: porta fechada, tubo isolado do mar`, G);
      return;
    case 'recarregar': {
      if (t.door.pos > 0.001 || t.equalize.pos > 0.001) {
        t.door.cmd = 0;
        t.equalize.cmd = 0;
        return;
      }
      if (t.water > 0.5 && !t.weapon) {
        if (t.drain.pos > 0.999 && tcaFree(w, c.s.weapons!) < 1) {
          // TCA cheios: a drenagem parou (não acontece com a dotação normal de armas)
          t.auto = null;
          c.log(`${nm}: recarga interrompida — TCA cheios`, G);
          return;
        }
        if (t.drain.cmd < 1) {
          t.drain.cmd = 1;
          t.vent.cmd = 1;
          t.flood.cmd = 0;
          c.log(`${nm}: porta fechada; drenando o tubo para o TCA`, G);
        }
        return;
      }
      if (t.drain.cmd > 0) {
        t.drain.cmd = 0;
        t.vent.cmd = 0;
      }
      if (t.drain.pos > 0.001) return;
      if (!t.weapon) {
        if (t.breech.pos < 0.999) {
          if (t.breech.cmd < 1) {
            t.breech.cmd = 1;
            c.log(`${nm}: tubo seco; abrindo a culatra`, G);
          }
          return;
        }
        if (t.reload === null) {
          if (c.s.weapons!.reserve <= 0) {
            c.log(`${nm}: sem armas de reserva`, G);
            t.auto = null;
            t.breech.cmd = 0;
            return;
          }
          t.reload = 0;
          c.log(`${nm}: puxando uma arma da reserva para o tubo (${Math.round(w.reloadTime / 60)} min)`, G);
        }
        return;
      }
      if (t.breech.cmd > 0) {
        t.breech.cmd = 0;
        c.log(`${nm}: arma no tubo; fechando a culatra`, G);
      }
      if (t.breech.pos > 0.001) return;
      t.auto = null;
      c.log(`${nm}: RECARREGADO (tubo seco, culatra fechada)`, G);
      return;
    }
  }
}

/** A cauda passou a boca: a arma sai, a água do mar ocupa o seu lugar e começa a corrida. */
function launch(v: VesselConfig, s: SimState, inp: WeaponsStepInput, i: number, sea: number): void {
  const w = v.weapons!;
  const ws = s.weapons!;
  const tc = w.tubes[i];
  const t = ws.tubes[i];
  const { ctx, R } = inp;
  void sea;
  t.weapon = false;
  t.energized = false;
  t.eject = null;
  const vExit = t.ejectV;
  t.ejectV = 0;
  s.ledger.weaponsOut = (s.ledger.weaponsOut ?? 0) + w.weapon.mass;
  // o mar ocupa no tubo o lugar da arma
  const inflow = w.weapon.volume * ctx.rhoLocal;
  t.water += inflow;
  s.ledger.seaIn += inflow;
  ws.fired += 1;
  // ponto de saída (boca) no referencial NED
  const p = { x: muzzleX(w, tc, R), y: tc.y, z: tc.z };
  const M = ctx.R;
  const n = ctx.pos.x + M[0] * p.x + M[1] * p.y + M[2] * p.z;
  const e = ctx.pos.y + M[3] * p.x + M[4] * p.y + M[5] * p.z;
  const d = ctx.pos.z + M[6] * p.x + M[7] * p.y + M[8] * p.z;
  const hdg = wrap360(inp.heading);
  const vAlong = inp.velNED.x * Math.cos(hdg * DEG) + inp.velNED.y * Math.sin(hdg * DEG);
  const id = `T${ws.fired}`;
  const run: TorpedoRun = {
    id,
    tube: tc.n,
    tFire: s.t,
    n,
    e,
    d,
    heading: hdg,
    speed: Math.max(0, vAlong) + vExit,
    phase: 'afastamento',
    wire: true,
    target: t.presets.target,
    traffic: t.traffic ?? 0,
    presets: { ...t.presets },
    run: 0,
    launch: { n, e },
    cmdHeading: hdg,
    tgt: null,
    closest: Infinity,
    hit: null,
    endReason: null,
    track: [{ n, e, d }],
    trackTimer: 0,
    guideTimer: 0,
  };
  if (t.origin) run.origin = t.origin;
  ws.runs.push(run);
  if (ws.runs.length > 12) ws.runs.splice(0, ws.runs.length - 12);
  ctx.log(`${tubeName(tc)}: arma fora do tubo a ${vExit.toFixed(1)} m/s — torpedo ${id} em corrida (fio de guiagem ligado). Água do mar no tubo; compensação automática em ação.`, G);
}

function updateRun(v: VesselConfig, s: SimState, inp: WeaponsStepInput, r: TorpedoRun): void {
  const w = v.weapons!;
  const W = w.weapon;
  const { ctx } = inp;
  const dt = ctx.dt;
  if (r.phase === 'recolher') return;
  r.trackTimer += dt;
  if (r.trackTimer >= 2) {
    r.trackTimer = 0;
    r.track.push({ n: r.n, e: r.e, d: r.d });
    if (r.track.length > 1500) r.track.splice(0, r.track.length - 1500);
  }
  if (r.phase === 'flutuando') {
    // fim de corrida: o fio se parte e a arma de exercício sobe (lastro largado) para ser recolhida
    if (r.wire) r.wire = false;
    r.speed *= Math.exp(-dt / 4);
    r.d = Math.max(0.3, r.d - W.floatRate * dt);
    r.n += r.speed * Math.cos(r.heading * DEG) * dt;
    r.e += r.speed * Math.sin(r.heading * DEG) * dt;
    if (r.d <= 0.3) {
      r.phase = 'recolher';
      r.speed = 0;
      ctx.log(`Torpedo ${r.id}: na superfície, flutuando para ser recolhido`, G);
    }
    return;
  }
  const origin = r.origin ?? ctx.env.cfg.geo?.origin ?? DEFAULT_ORIGIN;
  // guiagem a 5 Hz
  r.guideTimer += dt;
  if (r.guideTimer >= 0.2) {
    r.guideTimer = 0;
    let tg: Contact | undefined;
    if (r.target) tg = weaponTargets(ctx.env, origin, s.t, r.traffic).find((c) => c.id === r.target);
    if (tg) {
      const dn = tg.n - r.n;
      const de = tg.e - r.e;
      const range = Math.hypot(dn, de);
      const bearing = wrap360(Math.atan2(de, dn) / DEG);
      r.tgt = { n: tg.n, e: tg.e, course: tg.course, speed: tg.speed, name: tg.name, range, bearing };
      r.closest = Math.min(r.closest, range);
      if (r.phase !== 'afastamento' && range < W.hitRadius) {
        r.hit = { t: s.t, dist: range, depth: r.d, target: tg.id, name: tg.name };
        r.endReason = 'acerto';
        r.phase = 'flutuando';
        ctx.log(`Torpedo ${r.id}: ACERTO (exercício) — passou sob ${tg.name} a ${range.toFixed(0)} m, cota ${r.d.toFixed(0)} m. Fim de corrida; a arma sobe para ser recolhida.`, G);
        return;
      }
    } else if (r.target) r.tgt = null;
    const inCone = (b: number) => Math.abs(angDiff(b, r.heading)) <= W.seekerHalfAngle;
    if (r.phase === 'afastamento' && r.run >= W.safeDistance) {
      r.phase = r.wire && r.target ? 'guiado' : 'busca';
      ctx.log(`Torpedo ${r.id}: distância de segurança; ${r.phase === 'guiado' ? 'guiado pelo fio para o alvo' : 'corrida no rumo ajustado'}`, G);
    }
    if (r.tgt && (r.phase === 'guiado' || r.phase === 'busca') && r.tgt.range < W.acquisitionRange && inCone(r.tgt.bearing)) {
      r.phase = 'ataque';
      ctx.log(`Torpedo ${r.id}: autodiretor adquiriu ${r.tgt.name} a ${r.tgt.range.toFixed(0)} m — ataque`, G);
    } else if (r.phase === 'ataque' && (!r.tgt || r.tgt.range > 1.5 * W.acquisitionRange || Math.abs(angDiff(r.tgt.bearing, r.heading)) > W.seekerHalfAngle + 20)) {
      r.phase = r.wire && r.target ? 'guiado' : 'busca';
      ctx.log(`Torpedo ${r.id}: contato perdido pelo autodiretor`, G);
    }
    const presetCourse = r.presets.course ?? r.cmdHeading;
    if (r.phase === 'afastamento') {
      /* mantém o rumo de saída */
    } else if (r.tgt && (r.phase === 'ataque' || (r.phase === 'guiado' && r.wire))) r.cmdHeading = interceptCourse(r, Math.max(r.speed, 1), r.tgt);
    else r.cmdHeading = presetCourse;
  }
  // velocidade (partida do motor e regime)
  const vt = W.speeds[r.presets.speed];
  r.speed += (vt - r.speed) * (1 - Math.exp(-dt / W.spinUp));
  // guinada limitada
  const dh = angDiff(r.cmdHeading, r.heading);
  const maxTurn = W.turnRate * dt;
  r.heading = wrap360(r.heading + Math.max(-maxTurn, Math.min(maxTurn, dh)));
  // cota (sem passar do fundo)
  const bottom = ctx.env.bottomDepthAt(r.n, r.e);
  const dCmd = Math.min(r.presets.depth, bottom - 3);
  const dd = dCmd - r.d;
  r.d += Math.max(-W.depthRate * dt, Math.min(W.depthRate * dt, dd));
  r.n += r.speed * Math.cos(r.heading * DEG) * dt;
  r.e += r.speed * Math.sin(r.heading * DEG) * dt;
  r.run += r.speed * dt;
  if (bottom < 4) {
    r.endReason = 'águas rasas';
    r.phase = 'flutuando';
    ctx.log(`Torpedo ${r.id}: águas rasas (${bottom.toFixed(0)} m) — fim de corrida`, G);
    return;
  }
  if (r.wire && r.run > W.wireLength) {
    r.wire = false;
    ctx.log(`Torpedo ${r.id}: fio de guiagem esgotado`, G);
  }
  if (r.run >= W.range[r.presets.speed]) {
    r.endReason = 'fim da bateria';
    r.phase = 'flutuando';
    ctx.log(`Torpedo ${r.id}: fim da bateria após ${(r.run / 1000).toFixed(1)} km${r.target ? ` (menor distância ao alvo ${r.closest.toFixed(0)} m)` : ''} — a arma sobe para ser recolhida`, G);
  }
}

// ------------------------------------------------------------------ massas

export interface WeaponMass {
  id: string;
  name: string;
  group: 'armas' | 'ar';
  mass: number;
  pos: Vec3;
}

/** Itens de peso dos tubos, das armas e dos TCA (a reserva é a carga deslocável `reserveLoad`). */
export function weaponMassItems(v: VesselConfig, s: SimState, R: RadiusAt): WeaponMass[] {
  const w = v.weapons;
  const ws = s.weapons;
  if (!w || !ws) return [];
  const items: WeaponMass[] = [];
  let flask = 0;
  w.tubes.forEach((tc, i) => {
    const t = ws.tubes[i];
    if (t.weapon) items.push({ id: `arma${tc.n}`, name: `Arma no tubo ${tc.n}`, group: 'armas', mass: w.weapon.mass, pos: { x: stowedWeaponX(w) + (t.eject ?? 0), y: tc.y, z: tc.z } });
    if (t.water > 0) items.push({ id: `aguaTubo${tc.n}`, name: `Água no tubo ${tc.n}`, group: 'armas', mass: t.water, pos: { x: w.breechX + tubeLength(w, tc, R) / 2, y: tc.y, z: tc.z } });
    flask += t.flask;
  });
  w.tca.forEach((tk, k) => items.push({ id: tk.id, name: tk.name, group: 'armas', mass: ws.tca[k].mass, pos: tankWaterCentroid(tk, { mass: ws.tca[k].mass }) }));
  items.push({ id: 'arTubos', name: 'Ar das garrafas de lançamento', group: 'ar', mass: flask, pos: { x: 22.3, y: 0, z: 0.2 } });
  return items;
}

/** Itens de peso da condição de projeto (estado inicial) — entram no cálculo do peso leve. */
export function weaponDesignItems(v: VesselConfig, R: RadiusAt): { m: number; p: Vec3 }[] {
  const w = v.weapons;
  if (!w) return [];
  const T = v.hpAir.temperature + 273.15;
  const out: { m: number; p: Vec3 }[] = [];
  w.tubes.forEach((tc, i) => {
    if (i < w.initialLoaded) out.push({ m: w.weapon.mass, p: { x: stowedWeaponX(w), y: tc.y, z: tc.z } });
  });
  for (const tk of w.tca) out.push({ m: tk.initialVolume * RHO_NOMINAL, p: tankWaterCentroid(tk, { mass: tk.initialVolume * RHO_NOMINAL }) });
  out.push({ m: w.tubes.length * flaskMass(w, w.flask.pressure, T), p: { x: 22.3, y: 0, z: 0.2 } });
  void R;
  return out;
}

export { tubeLength, muzzleX };
export type { ValveState };
