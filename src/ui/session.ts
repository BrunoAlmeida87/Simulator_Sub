/**
 * SESSÃO COMPLETA — salva e retoma a simulação exatamente do ponto em que
 * estava: motor físico (configuração + estado: posição, atitude, velocidades,
 * tanques, ar, bateria, combustível, válvulas, bombas, lemes, piloto, falhas,
 * alarmes, ambiente), automações em andamento (manobra rápida, demonstração,
 * cenário guiado, rota, checklist), fator de aceleração, identificação do
 * submarino e referência geográfica do mapa.
 *
 * Ao carregar, a simulação fica PAUSADA aguardando “Retomar”.
 */
import { runner } from './store';
import { serializeEngine, migrateSave, parseSaveText, type SaveFile } from '../sim/persistence';
import { SimulationEngine } from '../sim/core/engine';
import { maneuver, MANEUVER_STEPS, type ManeuverSnapshot } from './maneuvers';
import { demo, type DemoSnapshot } from './demo';
import { tours, type TourSnapshot } from './tours';
import { route, mapOrigin, type RouteSnapshot } from './routeNav';
import { checklist } from './checklist';
import { presPlayer, type PlayerSnapshot } from './presBuilder/player';
import { identity, type Identity } from './identity';
import type { LatLon } from '../sim/geo';

export interface SessionAutomation {
  maneuver?: ManeuverSnapshot;
  demo?: DemoSnapshot;
  tour?: TourSnapshot | null;
  route?: RouteSnapshot;
  checklist?: unknown;
  /** apresentação do Estúdio em andamento */
  studio?: PlayerSnapshot | null;
}

/**
 * Captura a sessão completa atual. forFile = arquivo para baixar/compartilhar
 * (inclui a imagem do emblema personalizado; no navegador ela já está guardada).
 */
export function captureSession(name: string, forFile = false): SaveFile {
  const automation: SessionAutomation = {
    maneuver: maneuver.snapshot(),
    demo: demo.snapshot(),
    tour: tours.snapshot(),
    route: route.snapshot(),
    checklist: checklist.snapshot(),
    studio: presPlayer.snapshot(),
  };
  return serializeEngine(runner.engine, name, {
    timeScale: runner.timeScale,
    automation: automation as Record<string, unknown>,
    identity: forFile ? identity.get() : { ...identity.get(), emblemImage: undefined },
    ui: { mapOrigin: mapOrigin.get() },
  });
}

export interface RestoreReport {
  name: string;
  simTime: number;
  migratedFrom?: number;
  /** o que foi retomado (automações em andamento) */
  resumed: string[];
}

/** Para todas as automações sem registrar mensagens (antes de trocar de sessão). */
function silenceAutomations(): void {
  maneuver.restore(null);
  demo.restore(null);
  tours.restore(runner, null);
  presPlayer.restore(runner, null);
  route.active = false;
}

/**
 * Restaura uma sessão (qualquer versão aceita). A simulação fica pausada.
 * automations = false: não retoma manobras/roteiros/rota (usado pela
 * reprodução de gravações, que reaplica os comandos gravados).
 */
export function restoreSession(raw: unknown, opts: { automations?: boolean } = {}): RestoreReport {
  const f = migrateSave(raw);
  const e = new SimulationEngine(f.config, f.state);
  silenceAutomations();
  runner.running = false;
  runner.replaceEngine(e);
  const ses = f.session ?? {};
  const a = (opts.automations === false ? {} : (ses.automation ?? {})) as SessionAutomation;
  const resumed: string[] = [];
  maneuver.restore(a.maneuver);
  if (maneuver.active) resumed.push(`manobra ${maneuver.active === 'imergir' ? `IMERGIR para ${maneuver.target} m` : 'EMERGIR'} (etapa ${maneuver.step + 1}/${MANEUVER_STEPS[maneuver.active].length})`);
  demo.restore(a.demo);
  if (demo.active) resumed.push(`demonstração automática (etapa ${demo.k + 1}/${demo.steps.length})`);
  tours.restore(runner, a.tour);
  if (tours.active && tours.tour) resumed.push(`roteiro automático “${tours.tour.name}” (etapa ${tours.k + 1}/${tours.tour.steps.length})`);
  presPlayer.restore(runner, a.studio);
  if (presPlayer.active && presPlayer.pres) resumed.push(`apresentação “${presPlayer.pres.name}” (etapa ${presPlayer.k + 1}/${presPlayer.pres.steps.length})`);
  if (a.route) {
    route.restore(a.route);
    if (route.active) resumed.push(`seguimento de rota (ponto ${route.idx + 1}/${route.points.length})`);
  }
  checklist.restore(e, a.checklist as never);
  if (typeof ses.timeScale === 'number' && Number.isFinite(ses.timeScale) && ses.timeScale > 0) runner.timeScale = Math.min(64, ses.timeScale);
  const o = ses.ui?.mapOrigin as LatLon | undefined;
  if (o && Number.isFinite(o.lat) && Number.isFinite(o.lon)) mapOrigin.set(o);
  if (ses.identity) identity.set(ses.identity as Partial<Identity>, false);
  e.log(`Sessão carregada: “${f.name}” (t = ${f.simTime.toFixed(0)} s${f.migratedFrom ? `, arquivo da versão ${f.migratedFrom} convertido` : ''}) — pausada`, 'Sessão');
  runner.notify();
  return { name: f.name, simTime: f.simTime, migratedFrom: f.migratedFrom, resumed };
}

/** Lê um arquivo escolhido pelo usuário e restaura. */
export async function restoreSessionFile(file: File): Promise<RestoreReport> {
  const f = parseSaveText(await file.text());
  return restoreSession(f);
}

/** Continua a simulação após carregar (botão “Retomar”). */
export function resumeSimulation(): void {
  runner.running = true;
  runner.notify();
}

export function sessionFileName(name: string, t: number): string {
  const clean = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `sx1-sessao-${clean || 'estado'}-${Math.round(t)}s.json`;
}
