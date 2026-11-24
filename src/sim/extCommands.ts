/**
 * COMANDOS DOS SISTEMAS DA FASE 3 (atmosfera, avarias, distribuição elétrica, corrente, navegação,
 * discrição, ameaça, rebocadores e instrutor). Entram no tipo Command de commands.ts e passam pela mesma
 * via registrada (applyCommand → histórico, gravação e sincronismo entre janelas).
 */
import type { SimulationEngine } from './core/engine';
import type { BreakerId } from './config/extSystems';
import { defaultDamage, defaultTugs } from './config/extSystems';
import { defaultCurrent } from './environment/environment';
import { initAtmosphere, initDamage, initDistribution, initInstructor, initNavFix, initStealth, initThreat, initTugs, type InstructorEvent, type TugMode } from './core/extState';
import { BREAKER_LABEL } from './systems/distribution';
import { applyGpsFix, navError } from './systems/navigation';
import { mastExposure } from './systems/masts';
import { spawnAircraft } from './systems/stealth';
import { launchDecoy, launchHostileTorpedo } from './systems/threat';
import type { Command } from './commands';

export type ExtCommand =
  /** atmosfera interna: absorvedores de CO₂, queimadores de H₂, O₂ de reserva e ventilador pelo snorkel */
  | { type: 'atmosphere'; scrubbers?: boolean; recombiners?: boolean; o2Release?: boolean; ventFan?: boolean }
  /** bomba de esgoto de um compartimento */
  | { type: 'bilge'; id: string; on: boolean }
  /** porta estanque entre compartimentos */
  | { type: 'door'; id: string; open: boolean }
  /** combate a incêndio num compartimento */
  | { type: 'fire'; compartment: string; fight: boolean }
  /** disjuntor de uma carga (distribuição elétrica) */
  | { type: 'loadBreaker'; id: BreakerId; closed: boolean }
  /** rejeição automática de cargas; restore = religar as rejeitadas */
  | { type: 'autoShed'; on?: boolean; restore?: boolean }
  /** corrente marinha (velocidade, direção para onde vai, maré) */
  | { type: 'current'; speed?: number; direction?: number; tidal?: number; period?: number }
  /** correção de posição por GPS agora (se houver antena fora d'água) e/ou correção automática */
  | { type: 'navFix'; now?: boolean; auto?: boolean }
  /** aeronave de patrulha (exercício) */
  | { type: 'aircraft'; action: 'spawn' | 'remove'; range?: number; bearing?: number }
  /** torpedo de exercício contra o SX-1, despistador ou limpar */
  | { type: 'threat'; action: 'launch' | 'decoy' | 'clear'; range?: number; bearing?: number; warhead?: 'exercicio' | 'avaria' }
  /** rebocador (ou 'ALL' com mode 'livre' para largar todos) */
  | { type: 'tug'; id: string; mode?: TugMode; side?: 'BB' | 'BE'; cmd?: number; angle?: number }
  /** eventos programados do instrutor */
  | { type: 'instructor'; action: 'add' | 'remove' | 'clear' | 'rearm'; event?: Omit<InstructorEvent, 'id' | 'fired' | 'firedAt'>; id?: string };

export const EXT_COMMAND_TYPES = new Set(['atmosphere', 'bilge', 'door', 'fire', 'loadBreaker', 'autoShed', 'current', 'navFix', 'aircraft', 'threat', 'tug', 'instructor']);

const onOff = (b: boolean) => (b ? 'LIGADO' : 'DESLIGADO');

export function extCommand(e: SimulationEngine, c: ExtCommand): void {
  const s = e.state;
  const v = e.vessel;
  const log = (text: string, group: string) => e.log(text, group);
  switch (c.type) {
    case 'atmosphere': {
      const a = (s.atmosphere ??= initAtmosphere(v));
      const parts: string[] = [];
      if (c.scrubbers !== undefined) {
        a.scrubbers = c.scrubbers;
        parts.push(`absorvedores de CO₂ ${onOff(c.scrubbers)}`);
      }
      if (c.recombiners !== undefined) {
        a.recombiners = c.recombiners;
        parts.push(`queimadores de H₂ ${onOff(c.recombiners)}`);
      }
      if (c.o2Release !== undefined) {
        a.o2Release = c.o2Release && a.o2Stock > 0;
        parts.push(`O₂ de reserva ${a.o2Release ? 'LIBERANDO' : 'FECHADO'}`);
      }
      if (c.ventFan !== undefined) {
        a.ventFan = c.ventFan;
        parts.push(`ventilador do snorkel ${onOff(c.ventFan)}`);
      }
      if (parts.length) log(`Atmosfera: ${parts.join(', ')}`, 'Atmosfera');
      break;
    }
    case 'bilge': {
      const d = (s.damage ??= initDamage(v));
      const p = (v.damage ?? defaultDamage()).bilgePumps.find((x) => x.id === c.id);
      if (!p) break;
      (d.pumps[c.id] ??= { cmd: false, flow: 0, power: 0 }).cmd = c.on;
      log(`${p.name}: ${c.on ? 'PARTIR' : 'PARAR'}`, 'Avarias');
      break;
    }
    case 'door': {
      const d = (s.damage ??= initDamage(v));
      const p = (v.damage ?? defaultDamage()).doors.find((x) => x.id === c.id);
      if (!p) break;
      (d.doors[c.id] ??= { open: false, flow: 0 }).open = c.open;
      log(`${p.name}: ${c.open ? 'ABRIR' : 'FECHAR'}`, 'Avarias');
      break;
    }
    case 'fire': {
      const d = (s.damage ??= initDamage(v));
      const f = d.fires[c.compartment];
      const comp = v.compartments.find((x) => x.id === c.compartment);
      if (!f || !comp) break;
      f.fighting = c.fight && f.intensity > 0 && d.agent > 0;
      log(`Combate a incêndio — ${comp.name}: ${c.fight ? (f.fighting ? 'INICIADO' : 'sem incêndio ou sem agente') : 'INTERROMPIDO'}`, 'Avarias');
      break;
    }
    case 'loadBreaker': {
      const d = (s.distribution ??= initDistribution(v));
      if (!(c.id in d.breakers)) break;
      d.breakers[c.id] = c.closed;
      if (c.closed) d.shed = d.shed.filter((x) => x !== c.id);
      log(`Disjuntor ${c.id} (${BREAKER_LABEL[c.id]}): ${c.closed ? 'FECHADO' : 'ABERTO'}`, 'Elétrico');
      break;
    }
    case 'autoShed': {
      const d = (s.distribution ??= initDistribution(v));
      if (c.on !== undefined) {
        d.autoShed = c.on;
        log(`Rejeição automática de cargas: ${onOff(c.on)}`, 'Elétrico');
      }
      if (c.restore) {
        for (const id of d.shed) d.breakers[id] = true;
        if (d.shed.length) log(`Cargas religadas: ${d.shed.join(', ')}`, 'Elétrico');
        d.shed = [];
      }
      break;
    }
    case 'current': {
      const env = e.config.environment;
      const cur = (env.current ??= defaultCurrent());
      if (c.speed !== undefined && Number.isFinite(c.speed)) cur.speed = Math.max(0, Math.min(3, c.speed));
      if (c.direction !== undefined && Number.isFinite(c.direction)) cur.direction = ((c.direction % 360) + 360) % 360;
      if (c.tidal !== undefined && Number.isFinite(c.tidal)) cur.tidal = Math.max(0, Math.min(2, c.tidal));
      if (c.period !== undefined && Number.isFinite(c.period)) cur.period = Math.max(600, c.period);
      const kn = (x: number) => ((x * 3600) / 1852).toFixed(1);
      log(`Corrente: ${kn(cur.speed)} nós para ${cur.direction.toFixed(0)}°${cur.tidal ? ` (maré ±${kn(cur.tidal)} nós, ${(cur.period / 3600).toFixed(1)} h)` : ''}`, 'Ambiente');
      break;
    }
    case 'navFix': {
      const nf = (s.navFix ??= initNavFix(s.t, s.nav.distance));
      if (c.auto !== undefined) {
        nf.autoFix = c.auto;
        log(`Correção automática de posição por GPS: ${onOff(c.auto)}`, 'Navegação');
      }
      if (c.now) {
        const ex = mastExposure(v, s, e.outputs.surfaced);
        if (!ex.any) {
          log('Correção de posição recusada: nenhuma antena fora d’água (içar periscópio ou snorkel na cota periscópica)', 'Navegação');
          break;
        }
        const before = navError(s);
        applyGpsFix(s);
        log(`Correção de posição por GPS: erro de ${before.toFixed(0)} m eliminado (${ex.list.join(', ')})`, 'Navegação');
      }
      break;
    }
    case 'aircraft': {
      const st = (s.stealth ??= initStealth(s.rng.seed));
      if (c.action === 'remove') {
        st.aircraft = null;
        log('Aeronave de patrulha retirada do exercício', 'Discrição');
        break;
      }
      const range = Math.max(2000, Math.min(80000, c.range ?? 30000));
      const bearing = c.bearing ?? 0;
      spawnAircraft(v, s, range, bearing);
      log(`Aeronave de patrulha (exercício) em patrulha a ${(range / 1000).toFixed(0)} km, marcação ${bearing.toFixed(0)}°`, 'Discrição');
      break;
    }
    case 'threat': {
      const st = (s.threat ??= initThreat(v));
      if (c.action === 'clear') {
        st.torpedoes = [];
        st.decoys = [];
        log('Ameaças retiradas do exercício', 'Ameaça');
        break;
      }
      if (c.action === 'decoy') {
        if (launchDecoy(v, s)) log(`Despistador lançado (restam ${st.decoyStock})`, 'Ameaça');
        else log('Despistador recusado: estoque esgotado', 'Ameaça');
        break;
      }
      const range = Math.max(1000, Math.min(20000, c.range ?? 6000));
      const bearing = c.bearing ?? (e.outputs.euler.heading + 120) % 360;
      const tp = launchHostileTorpedo(v, s, range, bearing, c.warhead ?? 'exercicio');
      log(`TORPEDO (exercício${tp.warhead === 'avaria' ? ', com avaria' : ''}) lançado contra o SX-1 a ${(range / 1000).toFixed(1)} km, marcação ${bearing.toFixed(0)}°`, 'Ameaça');
      break;
    }
    case 'tug': {
      const st = (s.tugs ??= initTugs(v));
      const ids = c.id === 'ALL' ? Object.keys(st.tugs) : [c.id];
      for (const id of ids) {
        const tg = st.tugs[id];
        const cfg = (v.tugs ?? defaultTugs()).tugs.find((x) => x.id === id);
        if (!tg || !cfg) continue;
        if (c.mode) tg.mode = c.mode;
        if (c.side) tg.side = c.side;
        if (c.cmd !== undefined && Number.isFinite(c.cmd)) tg.cmd = Math.max(0, Math.min(1, c.cmd));
        if (c.angle !== undefined && Number.isFinite(c.angle)) tg.angle = Math.max(-60, Math.min(60, c.angle));
        if (tg.mode === 'livre') tg.cmd = 0;
        log(`${cfg.name}: ${tg.mode === 'livre' ? 'LARGADO' : `${tg.mode} por ${tg.side === 'BE' ? 'boreste' : 'bombordo'}, ${(tg.cmd * 100).toFixed(0)} %, ângulo ${tg.angle.toFixed(0)}°`}`, 'Rebocadores');
      }
      break;
    }
    case 'instructor': {
      const ins = (s.instructor ??= initInstructor());
      if (c.action === 'add' && c.event) {
        const ev: InstructorEvent = { ...structuredClone(c.event), id: `E${++ins.seq}`, fired: false };
        ins.events.push(ev);
        log(`Instrutor: evento programado — ${ev.label}`, 'Instrutor');
      } else if (c.action === 'remove' && c.id) {
        ins.events = ins.events.filter((x) => x.id !== c.id);
      } else if (c.action === 'clear') {
        ins.events = [];
        log('Instrutor: eventos programados removidos', 'Instrutor');
      } else if (c.action === 'rearm') {
        for (const ev of ins.events)
          if (!c.id || ev.id === c.id) {
            ev.fired = false;
            ev.firedAt = undefined;
          }
      }
      break;
    }
  }
}

/** comando do instrutor é válido? (não aceita eventos que programem outros eventos) */
export const instructorCommandAllowed = (c: Command): boolean => c.type !== 'instructor';
