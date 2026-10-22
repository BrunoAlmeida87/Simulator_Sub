/**
 * JANELA DE TELA (monitor extra): uma janela com o simulador completo (todas
 * as abas) que NÃO roda física — espelha a janela de controle. Este módulo
 * leva as automações nos dois sentidos:
 *
 *  - controle → tela: estado das automações (manobra rápida, demonstração,
 *    roteiro automático, rota, checklist), para as telas mostrarem o mesmo;
 *  - tela → controle: as ações do operador nessas automações (iniciar,
 *    avançar, parar…), executadas na janela de controle.
 *
 * Comandos físicos, executar/pausar, aceleração e troca de cenário vão pelo
 * SimRunner remoto (sync.ts).
 */
import type { SimRunner } from '../sim/core/runner';
import type { LatLon } from '../sim/geo';
import { tours, TOURS, type TourSnapshot } from './tours';
import { maneuver, type ManeuverKind, type ManeuverSnapshot } from './maneuvers';
import { demo, type DemoSnapshot } from './demo';
import { route, type RouteSnapshot } from './routeNav';
import { checklist } from './checklist';
import { restoreSession } from './session';

export interface AutomationMirror {
  maneuver: ManeuverSnapshot;
  demo: DemoSnapshot;
  tour: TourSnapshot | null;
  route: RouteSnapshot;
  checklist: unknown;
}

/** janela de controle: estado atual das automações */
export function captureAutomation(): AutomationMirror {
  return { maneuver: maneuver.snapshot(), demo: demo.snapshot(), tour: tours.snapshot(), route: route.snapshot(), checklist: checklist.snapshot() };
}

const last: Record<string, string> = {};
function changed(k: string, v: unknown): boolean {
  const j = JSON.stringify(v ?? null);
  if (last[k] === j) return false;
  last[k] = j;
  return true;
}

/** janela de tela: aplica o estado recebido (só o que mudou, sem emitir comandos) */
export function applyAutomation(r: SimRunner, a: AutomationMirror): void {
  if (changed('maneuver', a.maneuver)) maneuver.restore(a.maneuver);
  if (changed('demo', a.demo)) demo.restore(a.demo);
  const t = a.tour;
  // troca de roteiro/etapa: restauração completa (aplica a vista da etapa); no resto, só o andamento
  if (changed('tourKey', t ? [t.tourId, t.active, t.k] : null)) tours.restore(r, t);
  else if (t && changed('tour', t)) Object.assign(tours, { tStep: t.tStep, dwell: t.dwell, conditionMet: t.conditionMet, outcome: t.outcome, sent: t.sent, finished: t.finished });
  if (changed('route', a.route)) route.restore(a.route);
  // (snapshot sem lista válida faria o restore chamar reset, que aqui é remoto)
  if (Array.isArray((a.checklist as { status?: unknown } | null)?.status) && changed('checklist', a.checklist)) checklist.restore(r.engine, a.checklist as never);
}

/** ações remotas aceitas pela janela de controle */
const CALLS: Record<string, (r: SimRunner, a: unknown[]) => void> = {
  'tours.start': (r, a) => {
    const t = TOURS.find((x) => x.id === a[0]);
    if (t) tours.start(r, t);
  },
  'tours.next': (r) => tours.next(r),
  'tours.stop': (r) => tours.stop(r),
  'tours.pause': (r) => tours.pause(r),
  'maneuver.start': (r, a) => maneuver.start(r, a[0] as ManeuverKind, Number(a[1] ?? 50)),
  'maneuver.cancel': (r) => maneuver.cancel(r),
  'demo.start': (r) => demo.start(r),
  'demo.stop': (r) => demo.stop(r),
  'route.add': (_r, a) => route.add(a[0] as LatLon),
  'route.removeLast': () => route.removeLast(),
  'route.clear': (r) => route.clear(r),
  'route.start': (r) => route.start(r),
  'route.stop': (r) => route.stop(r),
  'checklist.reset': (r) => checklist.reset(r.engine),
  'session.restore': (_r, a) => void restoreSession(a[0], (a[1] ?? {}) as { automations?: boolean }),
};

/** janela de controle: executa uma ação pedida por uma janela de tela */
export function runRemoteCall(r: SimRunner, fn: string, args: unknown[]): void {
  try {
    CALLS[fn]?.(r, args);
  } catch (ex) {
    console.warn('Ação remota recusada:', fn, ex);
  }
}

/** janela de tela: troca as ações das automações por pedidos à janela de controle */
export function installRemoteAutomation(call: (fn: string, args: unknown[]) => void): void {
  tours.start = (_r, t) => call('tours.start', [t.id]);
  tours.next = () => call('tours.next', []);
  tours.stop = () => call('tours.stop', []);
  tours.pause = () => call('tours.pause', []);
  maneuver.start = (_r, kind, target = 50) => call('maneuver.start', [kind, target]);
  maneuver.cancel = () => call('maneuver.cancel', []);
  demo.start = () => call('demo.start', []);
  demo.stop = () => call('demo.stop', []);
  route.add = (p) => call('route.add', [p]);
  route.removeLast = () => call('route.removeLast', []);
  route.clear = () => call('route.clear', []);
  route.start = () => call('route.start', []);
  route.stop = () => call('route.stop', []);
  checklist.reset = () => call('checklist.reset', []);
}
