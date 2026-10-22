/**
 * Janela de tela (monitor extra): ações remotas executadas na janela de
 * controle, espelho das automações e cópia do histórico.
 */
import { describe, it, expect } from 'vitest';
import { runner } from '../src/ui/store';
import { maneuver } from '../src/ui/maneuvers';
import { route } from '../src/ui/routeNav';
import { applyAutomation, captureAutomation, runRemoteCall } from '../src/ui/mirror';
import { buildScenario } from '../src/sim/scenarios';
import { HistoryRecorder } from '../src/sim/history';

describe('Janela de tela', () => {
  it('ação remota inicia e cancela a manobra na janela de controle', () => {
    runner.replaceEngine(buildScenario('superficie_avante'));
    runRemoteCall(runner, 'maneuver.start', ['imergir', 40]);
    expect(maneuver.active).toBe('imergir');
    expect(maneuver.target).toBe(40);
    expect(runner.running).toBe(true);
    runRemoteCall(runner, 'maneuver.cancel', []);
    expect(maneuver.active).toBeNull();
    expect(maneuver.result?.outcome).toBe('cancelada');
    runner.running = false;
  });

  it('ação desconhecida é ignorada', () => {
    expect(() => runRemoteCall(runner, 'nada.existe', [])).not.toThrow();
  });

  it('o estado das automações chega à tela sem emitir comandos', () => {
    runner.replaceEngine(buildScenario('superficie_avante'));
    route.restore({ points: [], active: false, idx: 0 });
    runRemoteCall(runner, 'maneuver.start', ['imergir', 50]);
    runRemoteCall(runner, 'route.add', [{ lat: -22.9, lon: -43.8 }]);
    const snap = structuredClone(captureAutomation());
    const nCmd = runner.engine.state.commands.length;
    // a "tela" parte de automações vazias e recebe o espelho
    maneuver.restore(null);
    route.restore(null);
    applyAutomation(runner, snap);
    expect(maneuver.active).toBe('imergir');
    expect(maneuver.step).toBe(snap.maneuver.step);
    expect(route.points).toHaveLength(1);
    expect(runner.engine.state.commands.length).toBe(nCmd);
    maneuver.restore(null);
    route.restore(null);
    runner.running = false;
  });

  it('histórico copiado tem as mesmas amostras', () => {
    const e = buildScenario('superficie_avante');
    const a = new HistoryRecorder();
    for (let i = 0; i < 150; i++) {
      e.step();
      a.sample(e);
    }
    const b = new HistoryRecorder();
    b.restore(structuredClone(a.snapshot()));
    expect(b.count).toBe(a.count);
    expect(b.valueAt('depth', e.state.t - 1)).toBeCloseTo(a.valueAt('depth', e.state.t - 1), 6);
    // continua amostrando a partir do ponto copiado
    for (let i = 0; i < 60; i++) e.step();
    b.sample(e);
    expect(b.count).toBe(a.count + 1);
  });
});
