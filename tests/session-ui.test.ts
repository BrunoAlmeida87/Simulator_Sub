/**
 * Sessão completa pela camada da interface: uma manobra automática em
 * andamento (IMERGIR) é salva no meio e, ao carregar, continua da mesma
 * etapa, sem repetir comandos, chegando ao mesmo resultado.
 */
import { describe, it, expect } from 'vitest';
import { runner } from '../src/ui/store';
import { maneuver } from '../src/ui/maneuvers';
import { captureSession, restoreSession } from '../src/ui/session';
import { saveToText, parseSaveText } from '../src/sim/persistence';
import { buildScenario } from '../src/sim/scenarios';

/** laço principal equivalente ao do navegador: passos fixos + automação entre quadros */
function run(frames: number, stepsPerFrame = 25): void {
  for (let i = 0; i < frames; i++) {
    runner.stepOnce(stepsPerFrame);
    maneuver.tick(runner);
  }
}

describe('Sessão completa com automação em andamento', () => {
  it('IMERGIR salvo no meio retoma na mesma etapa e chega ao mesmo estado', () => {
    runner.replaceEngine(buildScenario('superficie_avante'));
    maneuver.start(runner, 'imergir', 40);
    runner.running = false;
    run(120); // 60 s
    expect(maneuver.active).toBe('imergir');
    const stepAtSave = maneuver.step;
    const nSent = maneuver.sent.length;
    const text = saveToText(captureSession('meio da manobra'));
    run(400); // +200 s
    const ref = JSON.stringify({ ...runner.engine.state, commands: [] });
    const refStep = maneuver.step;
    const refActive = maneuver.active;

    // carrega o arquivo salvo e repete o mesmo trecho
    const rep = restoreSession(parseSaveText(text));
    expect(runner.running).toBe(false); // carregado pausado
    expect(rep.resumed.join(' ')).toMatch(/IMERGIR/);
    expect(maneuver.active).toBe('imergir');
    expect(maneuver.step).toBe(stepAtSave);
    expect(maneuver.sent.length).toBe(nSent);
    run(400);
    expect(JSON.stringify({ ...runner.engine.state, commands: [] })).toBe(ref);
    expect(maneuver.step).toBe(refStep);
    expect(maneuver.active).toBe(refActive);
  });
});
