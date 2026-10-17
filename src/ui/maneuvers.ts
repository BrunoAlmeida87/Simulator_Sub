/**
 * Manobras rápidas da tela de pilotagem. Não alteram a física: apenas emitem,
 * em sequência, os mesmos comandos que o operador daria manualmente (todos
 * registrados), avançando quando a condição física é atingida.
 */
import type { SimRunner } from '../sim/core/runner';
import { applyCommand } from '../sim/commands';
import type { SimulationEngine } from '../sim/core/engine';

export type ManeuverKind = 'imergir' | 'emergir';

const fill = (e: SimulationEngine) => e.vessel.ballast.tanks.reduce((a, t) => a + e.state.ballast[t.id].water, 0) / e.vessel.ballast.tanks.reduce((a, t) => a + t.volume, 0);

export class ManeuverController {
  active: ManeuverKind | null = null;
  phase = '';
  target = 50;

  start(r: SimRunner, kind: ManeuverKind, target = 50): void {
    const e = r.engine;
    this.active = kind;
    this.target = target;
    e.log(`Manobra rápida: ${kind === 'imergir' ? `IMERGIR para ${target} m` : 'EMERGIR'}`, 'Manobra');
    if (kind === 'imergir') {
      if (e.state.propulsion.rpmCmd < 75) applyCommand(e, { type: 'telegraph', rpm: 75 });
      applyCommand(e, { type: 'mbtBlow', tank: 'ALL', open: false });
      applyCommand(e, { type: 'mbtVent', tank: 'ALL', open: true });
      applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
      applyCommand(e, { type: 'setpoint', channel: 'depth', value: target });
      applyCommand(e, { type: 'autopilot', channel: 'heading', mode: 'AUTO' });
      this.phase = 'Alagando os TLP (suspiros abertos)';
    } else {
      if (e.state.propulsion.rpmCmd < 75) applyCommand(e, { type: 'telegraph', rpm: 75 });
      applyCommand(e, { type: 'mbtVent', tank: 'ALL', open: false });
      applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
      applyCommand(e, { type: 'setpoint', channel: 'depth', value: 14 });
      this.phase = 'Subindo com os lemes até a cota periscópica';
    }
    r.running = true;
    r.notify();
  }

  cancel(r: SimRunner): void {
    if (this.active) r.engine.log('Manobra rápida cancelada pelo operador', 'Manobra');
    this.active = null;
    this.phase = '';
    r.notify();
  }

  tick(r: SimRunner): void {
    if (!this.active) return;
    const e = r.engine;
    const s = e.state;
    const o = e.outputs;
    if (this.active === 'imergir') {
      if (s.ballast.TLP1BB.vent.cmd > 0.5 && fill(e) > 0.97) {
        applyCommand(e, { type: 'mbtVent', tank: 'ALL', open: false });
        this.phase = `TLP cheios — descendo para ${this.target} m com o piloto de profundidade`;
        r.notify();
      }
      if (s.autopilot.depthMode !== 'AUTO') return this.finish(r, 'piloto desengajado manualmente');
      if (fill(e) > 0.97 && Math.abs(o.depthKeel - this.target) < 2 && Math.abs(o.verticalSpeed) < 0.1) this.finish(r, `na cota de ${this.target} m`);
    } else {
      const blowing = s.ballast.TLP1BB.blow.cmd > 0.5;
      if (!blowing && fill(e) > 0.05 && o.depthKeel < 18) {
        applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'MANUAL' });
        applyCommand(e, { type: 'mbtBlow', tank: 'ALL', open: true });
        applyCommand(e, { type: 'surface', id: 'bow', angle: 5 });
        applyCommand(e, { type: 'surface', id: 'stern', angle: 3 });
        this.phase = 'Soprando os TLP com ar comprimido';
        r.notify();
      }
      if (blowing && fill(e) < 0.04) {
        applyCommand(e, { type: 'mbtBlow', tank: 'ALL', open: false });
        applyCommand(e, { type: 'surface', id: 'bow', angle: 0 });
        applyCommand(e, { type: 'surface', id: 'stern', angle: 0 });
        this.finish(r, 'na superfície, TLP soprados');
      }
    }
  }

  private finish(r: SimRunner, why: string): void {
    r.engine.log(`Manobra rápida concluída: ${why}`, 'Manobra');
    this.active = null;
    this.phase = '';
    r.notify();
  }
}

export const maneuver = new ManeuverController();
