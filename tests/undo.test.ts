/**
 * “Desfazer” das trocas da simulação inteira (src/ui/undo.ts): Reiniciar e
 * Carregar cenário guardam a sessão anterior e a devolvem (pausada) dentro do
 * prazo; sem nada a perder não há oferta; depois do prazo não desfaz.
 */
import { describe, it, expect } from 'vitest';
import { runner, cmd, baseConfig } from '../src/ui/store';
import { buildScenario } from '../src/sim/scenarios';
import { replaceUndo, UNDO_MS, type UndoOffer } from '../src/ui/undo';
import { loadScenario } from '../src/ui/ops/OpsGroups';

const reset = () => runner.replaceEngine(buildScenario(runner.engine.state.scenarioId, baseConfig()));

describe('Desfazer reinício e troca de cenário', () => {
  it('cenário recém-carregado: nada a perder, nenhuma oferta', () => {
    runner.replaceEngine(buildScenario('superficie', baseConfig()));
    expect(replaceUndo.worthKeeping()).toBe(false);
    expect(replaceUndo.run('Cenário reiniciado', reset)).toBe(false);
    expect(replaceUndo.available()).toBe(false);
  });

  it('Reiniciar depois de operar: oferece e devolve o tempo, os comandos e o estado', () => {
    runner.replaceEngine(buildScenario('superficie', baseConfig()));
    cmd({ type: 'telegraph', rpm: 60 });
    runner.running = false;
    runner.stepOnce(500); // 10 s
    const t = runner.engine.state.t;
    const rpm = runner.engine.state.propulsion.rpmCmd;
    const nCmd = runner.engine.state.commands.length;
    const offers: UndoOffer[] = [];
    replaceUndo.onOffer = (o) => offers.push(o);
    expect(replaceUndo.run('Cenário reiniciado', reset)).toBe(true);
    expect(offers.map((o) => o.label)).toEqual(['Cenário reiniciado']);
    expect(runner.engine.state.t).toBe(0);
    expect(replaceUndo.undo()).toBe(true);
    expect(runner.running).toBe(false);
    expect(runner.engine.state.t).toBeCloseTo(t, 6);
    expect(runner.engine.state.propulsion.rpmCmd).toBe(rpm);
    expect(runner.engine.state.commands.length).toBeGreaterThanOrEqual(nCmd);
    expect(replaceUndo.undo()).toBe(false); // só uma vez
    replaceUndo.onOffer = null;
  });

  it('Carregar cenário também oferece desfazer', () => {
    runner.replaceEngine(buildScenario('superficie', baseConfig()));
    runner.stepOnce(50);
    loadScenario('submerso_50');
    expect(runner.engine.state.scenarioId).toBe('submerso_50');
    expect(replaceUndo.available()).toBe(true);
    expect(replaceUndo.undo()).toBe(true);
    expect(runner.engine.state.scenarioId).toBe('superficie');
  });

  it('depois do prazo não desfaz', () => {
    runner.replaceEngine(buildScenario('superficie', baseConfig()));
    runner.stepOnce(50);
    replaceUndo.run('Cenário reiniciado', reset);
    const late = performance.now() + UNDO_MS + 1;
    expect(replaceUndo.available(late)).toBe(false);
    expect(replaceUndo.undo(late)).toBe(false);
    expect(runner.engine.state.t).toBe(0);
  });
});
