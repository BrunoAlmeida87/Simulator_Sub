/**
 * MÍSSIL ANTINAVIO SM39 (EXOCET) LANÇADO PELO TUBO DE TORPEDOS — sistema da física.
 *
 * Sequência (fontes públicas: MBDA, CSIS Missile Threat, EDR Magazine — "Exocet: an evolving family"):
 *  1. o tubo ejeta a cápsula estanque VSM (Véhicule Sous-Marin, 5,8 m, 533 mm, ≈ 1,35 t) como um torpedo
 *     (a sequência do tubo é a mesma: alimentar, alagar, equalizar, abrir a porta, FOGO — weapons.ts);
 *  2. 1 a 2 s depois o motor de propelente sólido da cápsula acende (≈ 20 m/s); a cápsula, governada pelo jato,
 *     sobe para a superfície em ≈ 45° (ou quase na vertical, de cotas maiores) e pode desviar para um bordo
 *     para não denunciar a posição do submarino;
 *  3. ao romper a superfície um gerador de gás ejeta o nariz da cápsula; a ≈ 20 m de altura o míssil se separa
 *     (as asas e as aletas se abrem) e a cápsula cai no mar;
 *  4. alguns segundos depois o acelerador acende e o míssil se comporta como um Exocet lançado de navio:
 *     subida curta, descida ao cruzeiro rasante com navegação inercial até o ponto de busca, autodiretor
 *     ativo de radar ligado a ≈ 12 km, fase terminal rente ao mar (2–3 m, mais alto com o mar grosso) e impacto;
 *     ogiva de 165 kg (espoleta de impacto). Alcance ≈ 50 km, Mach ≈ 0,93.
 *  Alvo em terra (licença do simulador: no Exocet a capacidade costeira é do Bloco 3, com GPS): navegação por
 *  pontos até o alvo, subida e mergulho final.
 *
 * Tiro de EXERCÍCIO: o míssil sem ogiva sobe no fim para passar por cima do alvo, registra o acerto e cai no mar
 * no fim do combustível. Tiro de COMBATE (só contra alvos hostis: fragata, submarino inimigo na superfície ou
 * alvo em terra): explosão no impacto; a fragata pega fogo e para (cada míssil causa `damage`; com 1 ela afunda).
 *
 * Cinemática simples, sem aerodinâmica do míssil; tudo no referencial NED (d = cota, negativa no ar).
 * Os alvos hostis (state.weapons.hostiles) são acrescentados pelo comando 'hostile'.
 */
import type { MissileSpec, VesselConfig, WeaponsConfig } from '../config/types';
import type { EnemySub, Hostile, MissileRun, SimState, TubePresets, WeaponKind, WeaponsState } from '../core/state';
import type { StepContext } from '../core/context';
import type { Environment } from '../environment/environment';
import { contactsLocal, DEFAULT_ORIGIN, type Contact, type LatLon } from '../geo';
import { trafficAt, trafficForEnv } from '../traffic';

const DEG = Math.PI / 180;
const G = 9.81;
const KN = 1852 / 3600;
const LOG = 'Armas';
const wrap360 = (a: number) => ((a % 360) + 360) % 360;
const angDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Tipo da arma num tubo (ausente = F21). */
export const kindOf = (t: { kind?: WeaponKind }): WeaponKind => t.kind ?? 'f21';

/** Massa (kg), volume deslocado (m³), comprimento (m) e nome curto de cada tipo de arma. */
export function weaponDims(w: WeaponsConfig, kind: WeaponKind): { mass: number; volume: number; length: number; name: string } {
  if (kind === 'sm39' && w.missile) return { mass: w.missile.mass, volume: w.missile.volume, length: w.missile.length, name: 'SM39' };
  return { mass: w.weapon.mass, volume: w.weapon.volume, length: w.weapon.length, name: 'F21' };
}

/** Alvos hostis de superfície/terra: ids com prefixo FRG (fragata) ou TER (alvo em terra). */
export const isHostileId = (id: string | null | undefined) => !!id && (id.startsWith('FRG') || id.startsWith('TER'));

/** Cota (m) de um submarino inimigo navegando na superfície (o casco aflora ≈ 1,5 m). */
export const ENEMY_SURFACE_D = 1.8;

/** Fragata classe Tamandaré: comprimento, boca e altura usados para o impacto e o desenho (m). */
export const FRIGATE = { L: 107.2, B: 15.95, H: 22, draft: 5.2, maxSpeed: 26 * KN };
/** Instalação em terra (alvo fictício): planta e altura (m). */
export const LAND_SITE = { L: 46, B: 34, H: 14 };

/** Alvo possível do míssil: navio do quadro tático, fragata, submarino inimigo na superfície ou alvo em terra. */
export interface MissileTarget {
  id: string;
  name: string;
  kind: Contact['kind'] | 'fragata' | 'submarino' | 'terra';
  n: number;
  e: number;
  course: number;
  speed: number;
  /** caixa de impacto: comprimento, boca e altura acima da água/terreno (m); altura do terreno (m) */
  L: number;
  B: number;
  H: number;
  ground: number;
  /** alvo hostil (aceita o tiro de combate) */
  hostile: boolean;
}

const CONTACT_BOX: Record<Contact['kind'], [number, number, number]> = {
  mercante: [200, 32, 26],
  pesqueiro: [24, 7, 7],
  patrulha: [55, 9, 12],
  rebocador: [30, 10, 9],
};

const hostileTarget = (h: Hostile): MissileTarget =>
  h.type === 'terra'
    ? { id: h.id, name: h.name, kind: 'terra', n: h.n, e: h.e, course: h.course, speed: 0, L: LAND_SITE.L, B: LAND_SITE.B, H: LAND_SITE.H, ground: h.ground, hostile: true }
    : { id: h.id, name: h.name, kind: 'fragata', n: h.n, e: h.e, course: h.course, speed: h.speed, L: FRIGATE.L, B: FRIGATE.B, H: Math.max(3, FRIGATE.H - 2 * h.sink), ground: 0, hostile: true };

/** Todos os alvos de superfície e em terra vistos pelo sistema do míssil (os navios do quadro tático e os hostis). */
export function missileTargets(env: Environment, origin: LatLon, t: number, traffic: number, ws?: WeaponsState): MissileTarget[] {
  const out: MissileTarget[] = [];
  for (const h of ws?.hostiles ?? []) if (h.sunk === null) out.push(hostileTarget(h));
  for (const x of ws?.enemies ?? [])
    if (x.sunk === null && x.d <= ENEMY_SURFACE_D + 2) out.push({ id: x.id, name: x.name, kind: 'submarino', n: x.n, e: x.e, course: x.course, speed: x.speed, L: 62, B: 6.6, H: 8, ground: 0, hostile: true });
  const cs = [...contactsLocal(t, origin), ...(traffic > 0 ? trafficAt(t, trafficForEnv(env, origin, traffic), origin) : [])];
  for (const c of cs) {
    const [L, B, H] = CONTACT_BOX[c.kind];
    out.push({ id: c.id, name: c.name, kind: c.kind, n: c.n, e: c.e, course: c.course, speed: c.speed, L, B, H, ground: 0, hostile: false });
  }
  return out;
}

/** Motivo de recusa do tiro do SM39 contra um alvo (null = aceito). */
export function missileRefusal(ws: WeaponsState | undefined, p: TubePresets): string | null {
  if (!p.target) return null;
  const combat = p.warhead === 'combate';
  const isEnemySub = p.target.startsWith('INI');
  if (isEnemySub) {
    const x = ws?.enemies?.find((k) => k.id === p.target);
    if (x && x.d > ENEMY_SURFACE_D + 2) return 'o míssil só atinge um submarino inimigo na superfície (este está submerso)';
    return null;
  }
  if (combat && !isHostileId(p.target)) return 'tiro de combate só contra alvo hostil (fragata, submarino inimigo na superfície ou alvo em terra)';
  return null;
}

/** Ponto previsto do alvo (interceptação a `speed`, depois de `delay` s), para a navegação inercial. */
function predictPoint(from: { n: number; e: number }, tg: { n: number; e: number; course: number; speed: number }, speed: number, delay: number): { n: number; e: number } {
  const vn = Math.cos(tg.course * DEG) * tg.speed;
  const ve = Math.sin(tg.course * DEG) * tg.speed;
  let T = delay;
  let p = { n: tg.n + vn * T, e: tg.e + ve * T };
  for (let k = 0; k < 4; k++) {
    T = delay + Math.hypot(p.n - from.n, p.e - from.e) / speed;
    p = { n: tg.n + vn * T, e: tg.e + ve * T };
  }
  return p;
}

/** Cria o míssil (ainda na cápsula) no instante em que a cápsula sai pela boca do tubo. */
export function createMissile(
  v: VesselConfig,
  s: SimState,
  env: Environment,
  p: { id: string; tube: number; n: number; e: number; d: number; heading: number; speed: number; presets: TubePresets; traffic: number; origin?: LatLon },
  log: (text: string, group: string) => void,
): MissileRun {
  const M = v.weapons!.missile!;
  const origin = p.origin ?? env.cfg.geo?.origin ?? DEFAULT_ORIGIN;
  const r: MissileRun = {
    id: p.id,
    tube: p.tube,
    tFire: s.t,
    n: p.n,
    e: p.e,
    d: p.d,
    heading: p.heading,
    pitch: 0,
    speed: p.speed,
    phase: 'capsula',
    tPhase: s.t,
    target: p.presets.target,
    traffic: p.traffic,
    presets: { ...p.presets },
    run: 0,
    launch: { n: p.n, e: p.e },
    launchHeading: p.heading,
    aim: null,
    tgt: null,
    seeker: false,
    vsm: { n: p.n, e: p.e, d: p.d, heading: p.heading, pitch: 0, speed: p.speed, vz: 0, tBreach: null, tNose: null, tSep: null, tSplash: null },
    nose: null,
    vz: 0,
    closest: Infinity,
    hit: null,
    endReason: null,
    track: [{ n: p.n, e: p.e, d: p.d }],
    trackTimer: 0,
    guideTimer: 0,
  };
  if (p.origin) r.origin = p.origin;
  // ponto de busca da navegação inercial: posição prevista do alvo (ou um ponto no rumo ajustado)
  const tg = p.presets.target ? missileTargets(env, origin, s.t, p.traffic, s.weapons).find((x) => x.id === p.presets.target) : undefined;
  const delay = Math.max(0, p.d) / (M.vsm.speed * 0.7) + M.vsm.ignition + M.boosterDelay + M.boosterTime + 4;
  if (tg) r.aim = tg.kind === 'terra' ? { n: tg.n, e: tg.e } : predictPoint(p, tg, M.cruiseSpeed, delay);
  else {
    const c = (p.presets.course ?? p.heading) * DEG;
    r.aim = { n: p.n + Math.cos(c) * 0.6 * M.range, e: p.e + Math.sin(c) * 0.6 * M.range };
  }
  const dist = Math.hypot(r.aim.n - p.n, r.aim.e - p.e);
  log(
    `Míssil ${p.id}: cápsula VSM fora do tubo ${p.tube} — ${tg ? `alvo ${tg.name}, ponto de busca a ${(dist / 1000).toFixed(1)} km` : `tiro no rumo, ponto de busca a ${(dist / 1000).toFixed(1)} km`}${p.presets.warhead === 'combate' ? ' (ogiva de COMBATE)' : ' (EXERCÍCIO)'}`,
    LOG,
  );
  return r;
}

export interface MissileStepInput {
  ctx: StepContext;
}

const ACTIVE: MissileRun['phase'][] = ['capsula', 'superficie', 'separacao', 'acelerador', 'cruzeiro', 'busca', 'terminal', 'subida', 'mergulho', 'passagem', 'caindo'];
export const missileActive = (r: MissileRun) => ACTIVE.includes(r.phase);

/** Altitude do míssil (m acima do nível do mar). */
export const missileAlt = (r: { d: number }) => -r.d;

function setPhase(r: MissileRun, phase: MissileRun['phase'], t: number): void {
  r.phase = phase;
  r.tPhase = t;
}

/** Avança os mísseis, as cápsulas e os alvos hostis (um passo fixo). */
export function updateMissiles(v: VesselConfig, s: SimState, inp: MissileStepInput): void {
  const ws = s.weapons;
  const M = v.weapons?.missile;
  if (!ws || !M) return;
  updateHostiles(s, inp.ctx);
  for (const r of ws.missiles ?? []) stepMissile(M, s, inp.ctx, r);
}

function moveAlong(o: { n: number; e: number; d: number; heading: number; pitch: number; speed: number }, dt: number): void {
  const h = o.heading * DEG;
  const g = o.pitch * DEG;
  o.n += o.speed * Math.cos(g) * Math.cos(h) * dt;
  o.e += o.speed * Math.cos(g) * Math.sin(h) * dt;
  o.d -= o.speed * Math.sin(g) * dt;
}

/** voo balístico (sem empuxo): a gravidade curva a trajetória; vz em m/s, + para cima */
function ballistic(o: { n: number; e: number; d: number; heading: number; pitch: number; speed: number; vz: number }, dt: number, drag: number): void {
  const vh = o.speed * Math.cos(o.pitch * DEG) * Math.exp(-dt / drag);
  o.vz -= G * dt;
  o.n += vh * Math.cos(o.heading * DEG) * dt;
  o.e += vh * Math.sin(o.heading * DEG) * dt;
  o.d -= o.vz * dt;
  o.speed = Math.hypot(vh, o.vz);
  o.pitch = Math.atan2(o.vz, Math.max(1e-3, vh)) / DEG;
}

const turnToward = (cur: number, cmd: number, rate: number, dt: number) => wrap360(cur + clamp(angDiff(cmd, cur), -rate * dt, rate * dt));

function stepMissile(M: MissileSpec, s: SimState, ctx: StepContext, r: MissileRun): void {
  const dt = ctx.dt;
  const t = s.t;
  const c = r.vsm;
  // ---- cápsula depois da separação: cai no mar e afunda (só para o desenho e o histórico)
  if (c.tSep !== null && c.tSplash === null) {
    ballistic(c, dt, 6);
    if (c.d >= 0) {
      c.tSplash = t;
      c.d = 0.5;
      c.speed = 0;
    }
  } else if (c.tSplash !== null && c.d < 40) c.d += 0.6 * dt;
  if (!missileActive(r)) return;
  r.trackTimer += dt;
  if (r.trackTimer >= (r.phase === 'capsula' || r.phase === 'superficie' ? 0.5 : 1)) {
    r.trackTimer = 0;
    r.track.push({ n: r.n, e: r.e, d: r.d });
    if (r.track.length > 1200) r.track.splice(0, r.track.length - 1200);
  }
  const age = t - r.tFire;
  switch (r.phase) {
    case 'capsula': {
      // cápsula na água: inércia da ejeção; depois o motor acende e ela sobe em ângulo para a superfície
      if (age < M.vsm.ignition) {
        c.speed *= Math.exp(-dt / 5);
        c.d += 0.35 * dt; // ligeiramente pesada antes da ignição
      } else {
        if (age - dt < M.vsm.ignition) ctx.log(`Míssil ${r.id}: motor da cápsula aceso — subindo para a superfície`, LOG);
        c.speed += (M.vsm.speed - c.speed) * (1 - Math.exp(-dt / M.vsm.tau));
        const climb = r.presets.climb === 'vertical' ? M.vsm.climb.vertical : M.vsm.climb.obliqua;
        c.pitch += clamp(climb - c.pitch, -M.vsm.pitchRate * dt, M.vsm.pitchRate * dt);
        const dog = clamp(r.presets.dogleg ?? 0, -M.vsm.maxDogleg, M.vsm.maxDogleg);
        c.heading = turnToward(c.heading, wrap360(r.launchHeading + dog), M.vsm.turnRate, dt);
      }
      moveAlong(c, dt);
      // fundo: a cápsula não passa do fundo (lançamento em águas rasas)
      const bottom = ctx.env.bottomDepthAt(c.n, c.e);
      if (c.d > bottom - 1) c.d = bottom - 1;
      if (c.d <= 0) {
        c.tBreach = t;
        c.vz = c.speed * Math.sin(c.pitch * DEG);
        setPhase(r, 'superficie', t);
        ctx.log(`Míssil ${r.id}: cápsula rompe a superfície a ${Math.hypot(c.n - r.launch.n, c.e - r.launch.e).toFixed(0)} m do ponto de lançamento`, LOG);
      }
      copyPose(r, c);
      break;
    }
    case 'superficie': {
      // fora d'água com o motor da cápsula ainda queimando: o nariz é ejetado e a cápsula sobe até a separação
      c.pitch += clamp(12 - c.pitch, -8 * dt, 8 * dt);
      c.speed += (M.vsm.speed - c.speed) * (1 - Math.exp(-dt / M.vsm.tau));
      moveAlong(c, dt);
      if (c.tNose === null && t - c.tBreach! >= M.vsm.noseDelay) {
        c.tNose = t;
        r.nose = { n: c.n, e: c.e, d: c.d, heading: c.heading };
        ctx.log(`Míssil ${r.id}: nariz da cápsula ejetado`, LOG);
      }
      copyPose(r, c);
      if (-c.d >= M.vsm.separationAlt || t - c.tBreach! > 3) {
        c.tSep = t;
        c.vz = c.speed * Math.sin(c.pitch * DEG);
        // o míssil sai pela frente da cápsula, um pouco mais rápido
        r.speed = c.speed + 4;
        r.vz = r.speed * Math.sin(r.pitch * DEG);
        c.speed *= 0.85;
        setPhase(r, 'separacao', t);
        ctx.log(`Míssil ${r.id}: separação a ${(-c.d).toFixed(0)} m de altura — asas abertas; a cápsula cai no mar`, LOG);
      }
      break;
    }
    case 'separacao': {
      // voo balístico curto até o acelerador acender
      ballistic(r, dt, 30);
      if (t - r.tPhase >= M.boosterDelay) {
        setPhase(r, 'acelerador', t);
        ctx.log(`Míssil ${r.id}: acelerador aceso`, LOG);
      }
      break;
    }
    default:
      flight(M, s, ctx, r);
  }
}

/** pose do míssil = pose da cápsula (enquanto está dentro dela) */
function copyPose(r: MissileRun, c: MissileRun['vsm']): void {
  r.n = c.n;
  r.e = c.e;
  r.d = c.d;
  r.heading = c.heading;
  r.pitch = c.pitch;
  r.speed = c.speed;
}

/** Voo propulsado: altitude, rumo, autodiretor, alvo em terra, impacto e fim do combustível. */
function flight(M: MissileSpec, s: SimState, ctx: StepContext, r: MissileRun): void {
  const dt = ctx.dt;
  const t = s.t;
  const env = ctx.env;
  const ws = s.weapons!;
  const combat = r.presets.warhead === 'combate';
  const origin = r.origin ?? env.cfg.geo?.origin ?? DEFAULT_ORIGIN;
  const alt = -r.d;
  if (r.phase === 'caindo') {
    // sem combustível: planeia e cai no mar
    r.speed *= Math.exp(-dt / 8);
    r.pitch += clamp(-30 - r.pitch, -6 * dt, 6 * dt);
    moveAlong(r, dt);
    const gnd = Math.max(0, -env.bottomDepthAt(r.n, r.e));
    if (-r.d <= gnd) end(s, ctx, r, null, gnd > 0 ? 'terra' : 'mar');
    return;
  }
  // ---- empuxo
  if (r.phase === 'acelerador') {
    r.speed += (M.cruiseSpeed - r.speed) * (1 - Math.exp(-dt / (M.boosterTime / 3)));
    if (t - r.tPhase >= M.boosterTime) {
      setPhase(r, 'cruzeiro', t);
      ctx.log(`Míssil ${r.id}: fim do acelerador, motor de cruzeiro — ${Math.round(r.speed * 3.6)} km/h, navegação inercial`, LOG);
    }
  } else r.speed += (M.cruiseSpeed - r.speed) * (1 - Math.exp(-dt / 3));
  r.run += r.speed * dt;
  // ---- guiagem (5 Hz)
  r.guideTimer += dt;
  const land = !!r.target && r.target.startsWith('TER');
  if (r.guideTimer >= 0.2) {
    r.guideTimer = 0;
    guide(M, s, env, origin, r, land, combat, ctx);
  }
  // ---- altitude ordenada
  const sea = Math.max(M.terminalAlt, 0.8 * env.waves.hs + 1.5);
  let hCmd = M.cruiseAlt;
  const tg = r.tgt;
  const tgDist = tg ? Math.hypot(tg.n - r.n, tg.e - r.e) : r.aim ? Math.hypot(r.aim.n - r.n, r.aim.e - r.e) : Infinity;
  if (r.phase === 'acelerador') hCmd = M.climbAlt;
  else if (r.phase === 'busca') hCmd = tgDist < 9000 ? sea + 2 : M.cruiseAlt;
  else if (r.phase === 'terminal') hCmd = sea;
  else if (r.phase === 'passagem') hCmd = (tg ? tg.alt : 0) + 18;
  else if (r.phase === 'subida') hCmd = (tg?.alt ?? 0) + M.popUpAlt;
  // exercício: sobe no fim para passar por cima do alvo
  if (!combat && tg && r.phase === 'terminal' && tgDist < 900) setPhase(r, 'passagem', t);
  // relevo à frente (sobre terra o míssil sobe para passar por cima)
  const ahead = (k: number) => Math.max(0, -env.bottomDepthAt(r.n + Math.cos(r.heading * DEG) * k, r.e + Math.sin(r.heading * DEG) * k));
  const relief = Math.max(ahead(0), ahead(300), ahead(800), ahead(1500));
  if (relief > 0 && r.phase !== 'mergulho') hCmd = Math.max(hCmd, relief + 45);
  // ---- ângulo de trajetória
  let pitchCmd: number;
  if (r.phase === 'mergulho' && tg) {
    const dh = Math.hypot(tg.n - r.n, tg.e - r.e);
    pitchCmd = Math.atan2(tg.alt + 4 - alt, Math.max(1, dh)) / DEG;
  } else {
    const vzCmd = clamp((hCmd - alt) / 2.2, -35, 45);
    pitchCmd = Math.asin(clamp(vzCmd / Math.max(1, r.speed), -0.9, 0.9)) / DEG;
  }
  const pr = r.phase === 'mergulho' ? 2 * M.pitchRate : M.pitchRate;
  r.pitch += clamp(pitchCmd - r.pitch, -pr * dt, pr * dt);
  // ---- rumo ordenado
  let hdgCmd = r.heading;
  if (tg && (r.phase === 'terminal' || r.phase === 'passagem' || r.phase === 'subida' || r.phase === 'mergulho' || (land && r.phase !== 'acelerador'))) {
    hdgCmd = leadCourse(r, tg);
  } else if (r.aim) hdgCmd = wrap360(Math.atan2(r.aim.e - r.e, r.aim.n - r.n) / DEG);
  const tr = r.phase === 'acelerador' ? M.turnRate * 0.6 : M.turnRate;
  r.heading = turnToward(r.heading, hdgCmd, tr, dt);
  // ---- movimento (com sub-passos para o impacto não "atravessar" o alvo a 300 m/s)
  const sub = 3;
  for (let k = 0; k < sub; k++) {
    moveAlong(r, dt / sub);
    if (tg && checkImpact(M, s, ctx, r, combat)) return;
  }
  const a2 = -r.d;
  const gnd = Math.max(0, -env.bottomDepthAt(r.n, r.e));
  if (a2 <= gnd + 0.3) return end(s, ctx, r, null, gnd > 0 ? 'terra' : 'mar');
  if (r.run >= M.range) {
    setPhase(r, 'caindo', t);
    r.endReason = 'fim do combustível';
    ctx.log(`Míssil ${r.id}: fim do combustível após ${(r.run / 1000).toFixed(1)} km${r.target && Number.isFinite(r.closest) ? ` (menor distância ao alvo ${r.closest.toFixed(0)} m)` : ''}`, LOG);
  }
  void ws;
}

/** Rumo de interceptação do alvo (perseguição com avanço), limitado ao alcance de cálculo. */
function leadCourse(r: MissileRun, tg: NonNullable<MissileRun['tgt']>): number {
  const rn = tg.n - r.n;
  const re = tg.e - r.e;
  const vn = Math.cos(tg.course * DEG) * tg.speed;
  const ve = Math.sin(tg.course * DEG) * tg.speed;
  const T = Math.hypot(rn, re) / Math.max(50, r.speed * Math.cos(r.pitch * DEG));
  return wrap360(Math.atan2(re + ve * T, rn + vn * T) / DEG);
}

/** Navegação e autodiretor (5 Hz). */
function guide(M: MissileSpec, s: SimState, env: Environment, origin: LatLon, r: MissileRun, land: boolean, combat: boolean, ctx: StepContext): void {
  const t = s.t;
  const all = missileTargets(env, origin, t, r.traffic, s.weapons);
  const toAim = r.aim ? Math.hypot(r.aim.n - r.n, r.aim.e - r.e) : Infinity;
  const set = (x: MissileTarget) => {
    const dn = x.n - r.n;
    const de = x.e - r.e;
    const range = Math.hypot(dn, de);
    r.tgt = { n: x.n, e: x.e, course: x.course, speed: x.speed, name: x.name, range, bearing: wrap360(Math.atan2(de, dn) / DEG), alt: x.ground };
    r.closest = Math.min(r.closest, range);
  };
  if (land) {
    // alvo em terra: ponto fixo (navegação por pontos); subida e mergulho no fim
    const x = all.find((k) => k.id === r.target);
    if (!x) {
      if (r.tgt === null && r.phase !== 'acelerador') r.tgt = null;
    } else set(x);
    if (!r.tgt || r.phase === 'acelerador') return;
    if (r.phase === 'cruzeiro' && r.tgt.range < M.popUpRange) {
      setPhase(r, 'subida', t);
      ctx.log(`Míssil ${r.id}: a ${(r.tgt.range / 1000).toFixed(1)} km do alvo em terra — subida para o mergulho`, LOG);
    } else if (r.phase === 'subida' && r.tgt.range < M.diveRange + 0.6 * (r.tgt.alt + M.popUpAlt + r.d)) {
      setPhase(r, 'mergulho', t);
      ctx.log(`Míssil ${r.id}: mergulho sobre ${r.tgt.name}`, LOG);
    }
    return;
  }
  if (r.phase === 'acelerador') return;
  if (r.phase === 'cruzeiro' && toAim <= M.seekerOn) {
    r.seeker = true;
    setPhase(r, 'busca', t);
    ctx.log(`Míssil ${r.id}: autodiretor ligado a ${(toAim / 1000).toFixed(1)} km do ponto de busca`, LOG);
  }
  if (!r.seeker) return;
  // o autodiretor vê os ecos no cone à frente, dentro do alcance
  const seen = all.filter((x) => {
    if (x.kind === 'terra') return false;
    const dn = x.n - r.n;
    const de = x.e - r.e;
    const range = Math.hypot(dn, de);
    return range < M.seekerRange && Math.abs(angDiff(wrap360(Math.atan2(de, dn) / DEG), r.heading)) <= M.seekerHalfAngle;
  });
  if (r.phase === 'busca') {
    // varredura da antena: o primeiro travamento leva ≈ 1 s depois de ligar
    if (t - r.tPhase < 1) return;
    // o alvo designado, se estiver no cone; senão (combate) o hostil mais perto do ponto de busca; exercício sem alvo: o eco mais perto
    let pick = seen.find((x) => x.id === r.target);
    if (!pick && !r.target) {
      const pool = combat ? seen.filter((x) => x.hostile) : seen;
      const ref = r.aim ?? { n: r.n, e: r.e };
      pick = pool.sort((a, b) => Math.hypot(a.n - ref.n, a.e - ref.e) - Math.hypot(b.n - ref.n, b.e - ref.e))[0];
    }
    if (pick) {
      set(pick);
      if (!r.target) {
        r.target = pick.id;
        r.presets = { ...r.presets, target: pick.id };
      }
      setPhase(r, 'terminal', t);
      ctx.log(`Míssil ${r.id}: autodiretor travou em ${pick.name} a ${(r.tgt!.range / 1000).toFixed(1)} km — fase terminal rente ao mar`, LOG);
    } else if (r.aim && toAim < 50 && r.tgt === null) {
      // passou do ponto de busca sem eco: segue no rumo até o fim do combustível
      r.aim = { n: r.n + Math.cos(r.heading * DEG) * 1e5, e: r.e + Math.sin(r.heading * DEG) * 1e5 };
      ctx.log(`Míssil ${r.id}: nenhum eco no ponto de busca — segue no rumo`, LOG);
    }
    return;
  }
  if (r.phase === 'terminal' || r.phase === 'passagem') {
    const x = all.find((k) => k.id === r.target);
    if (x) set(x);
    else if (r.phase === 'terminal') {
      r.tgt = null;
      setPhase(r, 'busca', t);
      ctx.log(`Míssil ${r.id}: alvo perdido pelo autodiretor — volta a buscar`, LOG);
    }
  }
}

/** Impacto (combate) ou passagem sobre o alvo (exercício). Retorna true quando o voo termina. */
function checkImpact(M: MissileSpec, s: SimState, ctx: StepContext, r: MissileRun, combat: boolean): boolean {
  const tg = r.tgt!;
  const x = missileTargets(ctx.env, r.origin ?? ctx.env.cfg.geo?.origin ?? DEFAULT_ORIGIN, s.t, r.traffic, s.weapons).find((k) => k.id === r.target);
  if (!x) return false;
  const dn = r.n - x.n;
  const de = r.e - x.e;
  const c = x.course * DEG;
  const along = dn * Math.cos(c) + de * Math.sin(c);
  const across = -dn * Math.sin(c) + de * Math.cos(c);
  const h = -r.d - x.ground;
  const inPlan = Math.abs(along) < x.L / 2 + 2 && Math.abs(across) < x.B / 2 + 2;
  if (combat) {
    if (inPlan && h < x.H) {
      impact(M, s, ctx, r, x, { along, across, h: Math.max(1, h) });
      return true;
    }
    return false;
  }
  if (inPlan && !r.hit) {
    r.hit = { t: s.t, dist: Math.hypot(along, across), target: x.id, name: x.name, alt: h };
    const hst = s.weapons?.hostiles?.find((k) => k.id === x.id);
    if (hst) hst.hits += 1;
    ctx.log(`Míssil ${r.id}: ACERTO (exercício) — passou por cima de ${x.name} a ${h.toFixed(0)} m de altura`, LOG);
    if (x.kind === 'terra') {
      end(s, ctx, r, null, 'terra');
      return true;
    }
  }
  void tg;
  return false;
}

function impact(M: MissileSpec, s: SimState, ctx: StepContext, r: MissileRun, x: MissileTarget, rel: { along: number; across: number; h: number }): void {
  const ws = s.weapons!;
  const t = s.t;
  ws.explosions = [...(ws.explosions ?? []), { id: r.id, t, n: r.n, e: r.e, d: r.d, target: x.id, kind: 'missil' as const }].slice(-8);
  r.hit = { t, dist: Math.hypot(rel.along, rel.across), target: x.id, name: x.name, alt: rel.h };
  r.endReason = 'impacto';
  r.speed = 0;
  setPhase(r, 'impacto', t);
  const own = Math.hypot(ctx.pos.x - r.n, ctx.pos.y - r.e);
  const h = ws.hostiles?.find((k) => k.id === x.id);
  if (h) {
    h.damage += h.type === 'terra' ? 1 : M.damage;
    h.tHit ??= t;
    h.impacts = [...h.impacts, { t, x: rel.along, y: rel.across, z: rel.h }].slice(-6);
    if (h.damage >= 1 && h.sunk === null) h.sunk = t;
    const what = h.type === 'terra' ? 'DESTRUÍDO' : h.sunk !== null ? 'atingido — perdido, afundando' : 'atingido — incêndio a bordo, perdendo velocidade';
    ctx.log(`Míssil ${r.id}: IMPACTO — ${x.name} ${what} (${(own / 1000).toFixed(1)} km do SX-1)`, LOG);
    return;
  }
  const e = ws.enemies?.find((k) => k.id === x.id) as EnemySub | undefined;
  if (e) {
    e.sunk = t;
    e.evading = false;
    ctx.log(`Míssil ${r.id}: IMPACTO — ${x.name} atingido na superfície e afundando (${(own / 1000).toFixed(1)} km do SX-1)`, LOG);
    return;
  }
  ctx.log(`Míssil ${r.id}: IMPACTO em ${x.name}`, LOG);
}

/** fim do voo no mar ou em terra (sem alvo): a arma de combate explode */
function end(s: SimState, ctx: StepContext, r: MissileRun, _x: null, where: 'mar' | 'terra'): void {
  const ws = s.weapons!;
  r.speed = 0;
  r.endReason ??= where === 'mar' ? 'caiu no mar' : 'caiu em terra';
  if (r.presets.warhead === 'combate' && where === 'terra') ws.explosions = [...(ws.explosions ?? []), { id: r.id, t: s.t, n: r.n, e: r.e, d: r.d, target: null, kind: 'missil' as const }].slice(-8);
  r.d = where === 'mar' ? 0 : r.d;
  setPhase(r, r.hit && where === 'terra' ? 'impacto' : 'perdido', s.t);
  ctx.log(`Míssil ${r.id}: ${r.hit && where === 'terra' ? 'fim do voo sobre o alvo' : r.endReason}`, LOG);
}

// ------------------------------------------------------------------ alvos hostis

export type HostileAction = 'add' | 'remove' | 'clear';

export interface HostileParams {
  id?: string;
  kind?: 'fragata' | 'terra';
  name?: string;
  /** distância (m) e marcação relativa à proa (°) a partir do SX-1 */
  range?: number;
  bearing?: number;
  /** rumo verdadeiro (°; omitido = cruzando a proa do SX-1) e velocidade (m/s) */
  course?: number;
  speed?: number;
}

export interface HostileCmdCtx {
  s: SimState;
  env: Environment;
  heading: number;
  log: (text: string, group: string) => void;
}

/** Acrescenta, remove ou limpa os alvos de superfície (fragata) e em terra. */
export function hostileCommand(c: HostileCmdCtx, action: HostileAction, p: HostileParams = {}): void {
  const ws = c.s.weapons;
  if (!ws) return;
  const list = (ws.hostiles ??= []);
  if (action === 'clear') {
    if (!list.length) return;
    ws.hostiles = [];
    c.log(`Alvos de superfície e em terra removidos (${list.length})`, LOG);
    return;
  }
  if (action === 'remove') {
    const x = list.find((k) => k.id === p.id);
    if (!x) return c.log(`Ordem recusada: alvo ${p.id ?? '?'} não existe.`, LOG);
    ws.hostiles = list.filter((k) => k !== x);
    c.log(`${x.name} removido`, LOG);
    return;
  }
  const own = c.s.body.pos;
  const kind = p.kind ?? 'fragata';
  const brg = wrap360(c.heading + (p.bearing ?? 15));
  ws.hostileCount = (ws.hostileCount ?? 0) + 1;
  const k = ws.hostileCount;
  const base: Omit<Hostile, 'id' | 'name' | 'type' | 'n' | 'e' | 'course' | 'speed' | 'cmdCourse' | 'cmdSpeed' | 'ground'> = { damage: 0, tHit: null, sunk: null, sink: 0, list: 0, evading: false, hits: 0, impacts: [] };
  const uniq = (id: string) => {
    while (list.some((x) => x.id === id)) id = `${id}'`;
    return id;
  };
  if (kind === 'terra') {
    // primeiro ponto em terra na marcação, a partir da distância pedida (até 60 km), e um pouco para dentro
    const r0 = Math.max(500, Math.min(60000, p.range ?? 15000));
    let found: { n: number; e: number; h: number } | null = null;
    for (let r = r0; r <= 60000 && !found; r += 100) {
      const n = own.x + Math.cos(brg * DEG) * r;
      const e = own.y + Math.sin(brg * DEG) * r;
      // terra firme (≥ 1 m acima do mar); o alvo fica um pouco para dentro, se ainda houver terra
      if (c.env.bottomDepthAt(n, e) < -1) {
        const n2 = n + Math.cos(brg * DEG) * 150;
        const e2 = e + Math.sin(brg * DEG) * 150;
        const ok = c.env.bottomDepthAt(n2, e2) < -1;
        found = ok ? { n: n2, e: e2, h: -c.env.bottomDepthAt(n2, e2) } : { n, e, h: -c.env.bottomDepthAt(n, e) };
      }
    }
    if (!found) {
      ws.hostileCount -= 1;
      return c.log(`Alvo em terra recusado — nenhuma terra na marcação ${Math.round(brg).toString().padStart(3, '0')}° até 60 km (cenário sem costa?)`, LOG);
    }
    const id = uniq(p.id ? (isHostileId(p.id) ? p.id : `TER-${p.id}`) : `TER${k}`);
    const name = p.name ?? `Alvo em terra ${k} (instalação fictícia)`;
    list.push({ ...base, id, name, type: 'terra', n: found.n, e: found.e, course: brg, speed: 0, cmdCourse: brg, cmdSpeed: 0, ground: found.h });
    const rng = Math.hypot(found.n - own.x, found.e - own.y);
    c.log(`${name} a ${(rng / 1000).toFixed(1)} km, marcação ${Math.round(brg).toString().padStart(3, '0')}°, ${found.h.toFixed(0)} m de altitude`, LOG);
    return;
  }
  const range = Math.max(800, Math.min(80000, p.range ?? 25000));
  const n = own.x + Math.cos(brg * DEG) * range;
  const e = own.y + Math.sin(brg * DEG) * range;
  const bottom = c.env.bottomDepthAt(n, e);
  if (bottom < 12) {
    ws.hostileCount -= 1;
    return c.log(`Fragata recusada — águas rasas ou terra no ponto escolhido (${bottom.toFixed(0)} m de fundo)`, LOG);
  }
  const course = wrap360(p.course ?? brg + 90);
  const speed = Math.max(0, Math.min(FRIGATE.maxSpeed, p.speed ?? 15 * KN));
  const id = uniq(p.id ? (isHostileId(p.id) ? p.id : `FRG-${p.id}`) : `FRG${k}`);
  const name = p.name ?? `Fragata ${k} (classe Tamandaré, alvo fictício)`;
  list.push({ ...base, id, name, type: 'fragata', n, e, course, speed, cmdCourse: course, cmdSpeed: speed, ground: 0 });
  c.log(`${name} a ${(range / 1000).toFixed(1)} km, marcação ${Math.round(brg).toString().padStart(3, '0')}°, rumo ${Math.round(course).toString().padStart(3, '0')}°, ${(speed / KN).toFixed(0)} nós`, LOG);
}

/** Fragatas: rumo e velocidade; manobra evasiva com míssil detectado; incêndio, perda de velocidade e afundamento. */
function updateHostiles(s: SimState, ctx: StepContext): void {
  const ws = s.weapons!;
  const list = ws.hostiles;
  if (!list?.length) return;
  const dt = ctx.dt;
  for (const h of list) {
    if (h.type === 'terra') continue;
    if (h.sunk !== null) {
      // perdido: para, aderna e afunda
      const age = s.t - h.sunk;
      h.speed *= Math.exp(-dt / 20);
      h.list += (32 - h.list) * (1 - Math.exp(-dt / 90));
      h.sink = Math.min(45, h.sink + dt * Math.min(0.25, 0.01 + age * 0.0015));
    } else {
      let course = h.cmdCourse;
      let speed = h.cmdSpeed;
      if (h.tHit !== null) {
        // atingido: incêndio, perde a propulsão aos poucos e aderna um pouco
        speed = 0;
        h.list += (5 * h.damage - h.list) * (1 - Math.exp(-dt / 30));
        h.sink = Math.min(1.2, h.sink + dt * 0.002);
      }
      // míssil em fase terminal contra ela, a menos de 9 km (horizonte radar de um alvo rasante): manobra evasiva
      let threat: MissileRun | null = null;
      for (const r of ws.missiles ?? []) if ((r.phase === 'terminal' || r.phase === 'busca') && r.target === h.id && Math.hypot(r.n - h.n, r.e - h.e) < 9000) threat = r;
      if (threat && !h.evading && h.tHit === null) ctx.log(`${h.name}: míssil detectado — manobra evasiva a toda força`, LOG);
      h.evading = !!threat && h.tHit === null;
      if (h.evading && threat) {
        // proa para o míssil (menor seção ao radar) e velocidade máxima
        course = wrap360(Math.atan2(threat.e - h.e, threat.n - h.n) / DEG);
        speed = FRIGATE.maxSpeed;
      }
      const ahead = ctx.env.bottomDepthAt(h.n + Math.cos(h.course * DEG) * 600, h.e + Math.sin(h.course * DEG) * 600);
      if (ahead < 15) course = wrap360(h.course + 90);
      h.course = turnToward(h.course, course, 1.4, dt);
      h.speed += clamp(speed - h.speed, -0.1 * dt, 0.15 * dt);
    }
    h.n += h.speed * Math.cos(h.course * DEG) * dt;
    h.e += h.speed * Math.sin(h.course * DEG) * dt;
  }
}
