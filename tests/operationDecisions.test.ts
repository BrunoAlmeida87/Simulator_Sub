/**
 * Decisões da revisão da tela Operação (fase A):
 *  1. sopro de emergência põe profundidade/pitch em MANUAL, mantém o rumo, zera
 *     os lemes de vante e de ré e cancela a manobra rápida;
 *  2. nova ordem de profundidade durante IMERGIR vira o alvo da manobra;
 *  3. ordem enviada em MANUAL é pré-seleção: vale ao passar para AUTO
 *     (hold = AUTO na condição atual, como "Manter cota").
 */
import { describe, expect, it } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { SimRunner } from '../src/sim/core/runner';
import { ManeuverController } from '../src/ui/maneuvers';

describe('Sopro de emergência assume a subida', () => {
  it('desliga profundidade e pitch, mantém o rumo e zera os lemes de vante e de ré', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
    applyCommand(e, { type: 'setpoint', channel: 'depth', value: 90 });
    applyCommand(e, { type: 'autopilot', channel: 'heading', mode: 'AUTO' });
    e.advanceSim(20);
    expect(Math.abs(e.state.surfaces.stern.cmd)).toBeGreaterThan(1); // o piloto está mandando descer
    applyCommand(e, { type: 'emergencyBlow' });
    const ap = e.state.autopilot;
    expect(ap.depthMode).toBe('MANUAL');
    expect(ap.pitchMode).toBe('MANUAL');
    expect(ap.headingMode).toBe('AUTO');
    expect(e.state.surfaces.bow.cmd).toBe(0);
    expect(e.state.surfaces.stern.cmd).toBe(0);
    e.advanceSim(5);
    expect(e.state.surfaces.stern.cmd).toBe(0); // o piloto não volta a comandar os lemes
    expect(e.state.commands.some((c) => /DESENGAJADO pelo sopro de emergência/.test(c.text))).toBe(true);
  });

  it('acionar tanque a tanque registra a troca de comando uma vez só', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
    for (const t of e.vessel.ballast.tanks) applyCommand(e, { type: 'emergencyBlow', tank: t.id });
    expect(e.state.commands.filter((c) => /sopro de emergência\)$/.test(c.text)).length).toBe(1);
  });

  it('cancela IMERGIR e EMERGIR em andamento', () => {
    for (const [scenario, kind] of [
      ['superficie_avante', 'imergir'],
      ['submerso_50', 'emergir'],
    ] as const) {
      const r = new SimRunner(buildScenario(scenario));
      const m = new ManeuverController();
      m.start(r, kind, 50);
      for (let i = 0; i < 500; i++) {
        r.engine.step();
        m.tick(r);
      }
      expect(m.active).toBe(kind);
      applyCommand(r.engine, { type: 'emergencyBlow' });
      r.engine.step();
      m.tick(r);
      expect(m.active).toBeNull();
      expect(m.result?.outcome).toBe('cancelada');
      expect(m.result?.why).toMatch(/sopro de emergência/);
    }
  });
});

describe('IMERGIR segue a ordem do piloto de profundidade', () => {
  it('ordem trocada de 50 para 70 m no meio da imersão termina com sucesso em 70 m', () => {
    const r = new SimRunner(buildScenario('superficie_avante'));
    const m = new ManeuverController();
    m.start(r, 'imergir', 50);
    let changed = false;
    for (let i = 0; i < 80000 && m.active; i++) {
      r.engine.step();
      m.tick(r);
      if (!changed && r.engine.outputs.depthKeel > 25) {
        applyCommand(r.engine, { type: 'setpoint', channel: 'depth', value: 70 });
        changed = true;
      }
    }
    expect(changed).toBe(true);
    expect(m.result?.outcome).toBe('sucesso');
    expect(m.target).toBe(70);
    expect(Math.abs(r.engine.outputs.depthKeel - 70)).toBeLessThan(2.5);
  });
});

describe('Pré-seleção da ordem em MANUAL', () => {
  it('ordem enviada em MANUAL vale ao passar para AUTO', () => {
    const e = buildScenario('submerso_50');
    expect(e.state.autopilot.depthMode).toBe('MANUAL');
    applyCommand(e, { type: 'setpoint', channel: 'depth', value: 80 });
    applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
    expect(e.state.autopilot.depthSet).toBe(80);
    expect(e.state.commands.some((c) => /pré-selecionada 80 m/.test(c.text))).toBe(true);
    // rumo também
    applyCommand(e, { type: 'setpoint', channel: 'heading', value: 135 });
    applyCommand(e, { type: 'autopilot', channel: 'heading', mode: 'AUTO' });
    expect(e.state.autopilot.headingSet).toBe(135);
  });

  it('sem pré-seleção, AUTO assume a condição atual (sem salto)', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
    expect(e.state.autopilot.depthSet).toBe(Math.round(e.apReadings.depth));
    // ordem dada em AUTO não vira pré-seleção: ao voltar para AUTO vale a cota atual
    applyCommand(e, { type: 'setpoint', channel: 'depth', value: 70 });
    applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'MANUAL' });
    applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
    expect(e.state.autopilot.depthSet).toBe(Math.round(e.apReadings.depth));
  });

  it('a pré-seleção é usada uma vez; hold (Manter cota) ignora a pré-seleção', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'setpoint', channel: 'depth', value: 80 });
    applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO', hold: true });
    expect(e.state.autopilot.depthSet).toBe(Math.round(e.apReadings.depth));
    applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'MANUAL' });
    applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
    expect(e.state.autopilot.depthSet).toBe(Math.round(e.apReadings.depth));
  });

  it('estado salvo antes da pré-seleção (sem o campo) continua funcionando', () => {
    const e = buildScenario('submerso_50');
    delete e.state.autopilot.preset;
    applyCommand(e, { type: 'setpoint', channel: 'depth', value: 60 });
    applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
    expect(e.state.autopilot.depthSet).toBe(60);
  });
});
