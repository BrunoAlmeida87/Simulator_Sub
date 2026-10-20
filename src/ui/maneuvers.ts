/**
 * Manobras rápidas da tela de pilotagem/apresentação. Não alteram a física:
 * apenas emitem, em sequência, os mesmos comandos que o operador daria
 * manualmente (todos registrados), avançando quando a condição física é
 * atingida. Expõem a etapa atual, os comandos enviados e o resultado
 * (sucesso, tempo esgotado, cancelada ou falha).
 */
import type { SimRunner } from '../sim/core/runner';
import { applyCommand, withCommandSource, type Command } from '../sim/commands';
import { replayLock } from './replayLock';
import type { SimulationEngine } from '../sim/core/engine';

export type ManeuverKind = 'imergir' | 'emergir';
export type ManeuverOutcome = 'sucesso' | 'tempo esgotado' | 'cancelada' | 'falha';

const fill = (e: SimulationEngine) => e.vessel.ballast.tanks.reduce((a, t) => a + e.state.ballast[t.id].water, 0) / e.vessel.ballast.tanks.reduce((a, t) => a + t.volume, 0);

export const MANEUVER_STEPS: Record<ManeuverKind, string[]> = {
  imergir: ['Seguimento, suspiros abertos e piloto de profundidade', 'TLP alagando (ar sai pelos suspiros)', 'TLP cheios: suspiros fechados, descendo com os lemes', 'Estabilizado na cota ordenada'],
  emergir: ['Suspiros fechados, piloto de profundidade em 14 m', 'Subindo com os lemes até a cota periscópica', 'Soprando os TLP com ar comprimido', 'Na superfície, sopro fechado'],
};

const TIMEOUT: Record<ManeuverKind, number> = { imergir: 1200, emergir: 1200 };

export interface SentCommand {
  t: number;
  text: string;
}

export interface ManeuverSnapshot {
  active: ManeuverKind | null;
  phase: string;
  step: number;
  target: number;
  t0: number;
  sent: SentCommand[];
  result: { kind: ManeuverKind; outcome: ManeuverOutcome; why: string; t: number; duration: number } | null;
}

export class ManeuverController {
  active: ManeuverKind | null = null;
  phase = '';
  step = 0;
  target = 50;
  t0 = 0;
  sent: SentCommand[] = [];
  result: { kind: ManeuverKind; outcome: ManeuverOutcome; why: string; t: number; duration: number } | null = null;

  /** envia um comando e guarda o texto registrado pelo motor */
  private send(e: SimulationEngine, c: Command): void {
    const log = e.state.commands;
    const last = log[log.length - 1];
    withCommandSource('manobra', () => applyCommand(e, c));
    let i = log.length - 1;
    while (i >= 0 && log[i] !== last) i--;
    for (const r of log.slice(i + 1)) this.sent.push({ t: r.t, text: r.text });
    if (this.sent.length > 30) this.sent.splice(0, this.sent.length - 30);
  }

  private setStep(r: SimRunner, k: number, phase: string): void {
    this.step = k;
    this.phase = phase;
    r.engine.log(`Manobra — etapa ${k + 1}/${MANEUVER_STEPS[this.active!].length}: ${phase}`, 'Manobra');
    r.notify();
  }

  start(r: SimRunner, kind: ManeuverKind, target = 50): void {
    if (replayLock.active) return;
    const e = r.engine;
    this.active = kind;
    this.target = target;
    this.sent = [];
    this.result = null;
    this.t0 = e.state.t;
    e.log(`Manobra rápida: ${kind === 'imergir' ? `IMERGIR para ${target} m` : 'EMERGIR'}`, 'Manobra');
    if (kind === 'imergir') {
      if (e.state.propulsion.rpmCmd < 75) this.send(e, { type: 'telegraph', rpm: 75 });
      this.send(e, { type: 'mbtBlow', tank: 'ALL', open: false });
      this.send(e, { type: 'mbtVent', tank: 'ALL', open: true });
      this.send(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
      this.send(e, { type: 'setpoint', channel: 'depth', value: target });
      this.send(e, { type: 'autopilot', channel: 'heading', mode: 'AUTO' });
      this.setStep(r, 1, 'Alagando os TLP (suspiros abertos)');
    } else {
      if (e.state.propulsion.rpmCmd < 75) this.send(e, { type: 'telegraph', rpm: 75 });
      this.send(e, { type: 'mbtVent', tank: 'ALL', open: false });
      this.send(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
      this.send(e, { type: 'setpoint', channel: 'depth', value: 14 });
      this.setStep(r, 1, 'Subindo com os lemes até a cota periscópica');
    }
    r.running = true;
    r.notify();
  }

  cancel(r: SimRunner): void {
    if (this.active) this.finish(r, 'cancelada', 'cancelada pelo operador');
  }

  tick(r: SimRunner): void {
    if (!this.active || replayLock.active) return;
    const e = r.engine;
    const s = e.state;
    const o = e.outputs;
    if (s.t - this.t0 > TIMEOUT[this.active]) return this.finish(r, 'tempo esgotado', `condição final não atingida em ${TIMEOUT[this.active] / 60} min`);
    if (o.depthKeel > e.vessel.limits.testDepth) return this.finish(r, 'falha', 'profundidade de teste excedida');
    if (this.active === 'imergir') {
      if (s.ballast.TLP1BB.vent.cmd > 0.5 && fill(e) > 0.97) {
        this.send(e, { type: 'mbtVent', tank: 'ALL', open: false });
        this.setStep(r, 2, `TLP cheios — descendo para ${this.target} m com o piloto de profundidade`);
      }
      if (s.autopilot.depthMode !== 'AUTO') return this.finish(r, 'cancelada', 'piloto desengajado manualmente');
      if (fill(e) > 0.97 && Math.abs(o.depthKeel - this.target) < 2 && Math.abs(o.verticalSpeed) < 0.1) {
        this.step = 3;
        this.finish(r, 'sucesso', `na cota de ${this.target} m`);
      }
    } else {
      const blowing = s.ballast.TLP1BB.blow.cmd > 0.5;
      if (!blowing && fill(e) > 0.05 && o.depthKeel < 18) {
        this.send(e, { type: 'autopilot', channel: 'depth', mode: 'MANUAL' });
        this.send(e, { type: 'mbtBlow', tank: 'ALL', open: true });
        this.send(e, { type: 'surface', id: 'bow', angle: 5 });
        this.send(e, { type: 'surface', id: 'stern', angle: 3 });
        this.setStep(r, 2, 'Soprando os TLP com ar comprimido');
      }
      if (blowing && e.outputs.hpManifoldBar < 5 && fill(e) > 0.3) return this.finish(r, 'falha', 'ar comprimido insuficiente para soprar os TLP');
      if (blowing && fill(e) < 0.04) {
        this.send(e, { type: 'mbtBlow', tank: 'ALL', open: false });
        this.send(e, { type: 'surface', id: 'bow', angle: 0 });
        this.send(e, { type: 'surface', id: 'stern', angle: 0 });
        this.step = 3;
        this.finish(r, 'sucesso', 'na superfície, TLP soprados');
      }
    }
  }

  /** dados para salvar a sessão (retomada da manobra em andamento) */
  snapshot(): ManeuverSnapshot {
    return { active: this.active, phase: this.phase, step: this.step, target: this.target, t0: this.t0, sent: [...this.sent], result: this.result };
  }

  /** restaura a manobra salva (sem emitir comandos: o estado físico já os contém) */
  restore(d: Partial<ManeuverSnapshot> | null | undefined): void {
    this.active = d?.active === 'imergir' || d?.active === 'emergir' ? d.active : null;
    this.phase = String(d?.phase ?? '');
    this.step = Number(d?.step ?? 0);
    this.target = Number(d?.target ?? 50);
    this.t0 = Number(d?.t0 ?? 0);
    this.sent = Array.isArray(d?.sent) ? d!.sent.slice(-30) : [];
    this.result = d?.result ?? null;
  }

  private finish(r: SimRunner, outcome: ManeuverOutcome, why: string): void {
    const e = r.engine;
    const kind = this.active!;
    e.log(`Manobra rápida — ${outcome.toUpperCase()}: ${why}`, 'Manobra');
    this.result = { kind, outcome, why, t: e.state.t, duration: e.state.t - this.t0 };
    this.active = null;
    this.phase = '';
    r.notify();
  }
}

export const maneuver = new ManeuverController();
