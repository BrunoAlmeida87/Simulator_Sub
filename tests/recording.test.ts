/**
 * GRAVAÇÃO E REPRODUÇÃO DE COMANDOS — com passos fixos, reaplicar os mesmos
 * comandos nos mesmos passos a partir do estado inicial gravado reproduz
 * exatamente a mesma evolução; automações não executam seus comandos duas
 * vezes; comandos de fora da gravação são bloqueados durante a reprodução.
 */
import { describe, it, expect } from 'vitest';
import { runner, cmd } from '../src/ui/store';
import { maneuver } from '../src/ui/maneuvers';
import { recorder } from '../src/ui/recorder';
import { buildScenario } from '../src/sim/scenarios';
import { parseRecording, recordingToText } from '../src/sim/recording';

/** laço principal equivalente ao do navegador: passos fixos + automações entre quadros */
function frames(n: number, steps = 25): void {
  for (let i = 0; i < n; i++) {
    runner.stepOnce(steps);
    maneuver.tick(runner);
  }
}
const physics = () => JSON.stringify({ ...runner.engine.state, commands: [] });
const count = (re: RegExp) => runner.engine.state.commands.filter((c) => re.test(c.text)).length;

describe('Gravação e reprodução de comandos', () => {
  it('reproduz exatamente comandos manuais + manobra automática, sem duplicar a automação', () => {
    runner.replaceEngine(buildScenario('superficie_avante'));
    runner.running = false;
    frames(20); // 10 s antes de gravar
    recorder.start('teste');
    expect(recorder.mode).toBe('gravando');
    frames(10);
    cmd({ type: 'surface', id: 'rudder', angle: 10 });
    frames(30);
    cmd({ type: 'surface', id: 'rudder', angle: 0 });
    maneuver.start(runner, 'imergir', 35); // automação: emite vários comandos e narrações
    runner.running = false;
    frames(240);
    cmd({ type: 'failure', target: 'sensor:ECO', active: true, param: 'deriva' });
    cmd({ type: 'dosing', system: 'trim', mode: 'transferir', kg: 400, dir: 'BtoA' });
    frames(200);
    recorder.stopRecording();
    const rec = recorder.rec!;
    const final = physics();
    const vents = count(/suspiro/);
    expect(rec.events.filter((e) => e.cmd && e.src === 'operador').length).toBe(4);
    expect(rec.events.filter((e) => e.cmd && e.src === 'manobra').length).toBeGreaterThan(3);
    expect(rec.events.some((e) => e.note)).toBe(true);
    expect(rec.checkpoints.length).toBeGreaterThan(20);

    // arquivo → carregar → reproduzir
    const { rec: loaded, warnings } = parseRecording(recordingToText(rec));
    expect(warnings).toEqual([]);
    recorder.load(loaded);
    recorder.play();
    expect(recorder.mode).toBe('reproduzindo');
    expect(maneuver.active).toBe(null); // a manobra NÃO é retomada: seus comandos vêm da gravação
    // tentativa de comando manual durante a reprodução: bloqueada
    const before = physics();
    cmd({ type: 'telegraph', rpm: -40 });
    expect(physics()).toBe(before);
    expect(recorder.blocked).toBe(1);
    // tentar iniciar uma manobra também não faz nada
    maneuver.start(runner, 'emergir');
    expect(maneuver.active).toBe(null);
    let guard = 0;
    while (!recorder.finished && guard++ < 10000) frames(1);
    expect(recorder.finished).toBe(true);
    expect(physics()).toBe(final);
    expect(count(/suspiro/)).toBe(vents);
    const chk = recorder.checkSummary;
    expect(chk.n).toBe(rec.checkpoints.length);
    expect(chk.exact).toBe(chk.n);
    expect(chk.maxPos).toBe(0);
    recorder.endReplay();
    expect(recorder.mode).toBe('parado');
    // depois de encerrar, o operador volta a comandar
    cmd({ type: 'telegraph', rpm: 30 });
    expect(runner.engine.state.propulsion.rpmCmd).toBe(30);
  });

  it('trocar de cenário encerra a gravação automaticamente (o trecho gravado é mantido)', () => {
    runner.replaceEngine(buildScenario('submerso_50'));
    recorder.start('troca');
    frames(4);
    cmd({ type: 'telegraph', rpm: 60 });
    runner.replaceEngine(buildScenario('pairando'));
    expect(recorder.mode).toBe('parado');
    expect(recorder.lastStop).toMatch(/cenário/);
    expect(recorder.rec!.events.filter((e) => e.cmd).length).toBe(1);
  });

  it('avisa sobre versão diferente e recusa arquivos que não são gravações', () => {
    runner.replaceEngine(buildScenario('submerso_50'));
    recorder.start('v');
    frames(2);
    recorder.stopRecording();
    const raw = JSON.parse(recordingToText(recorder.rec!));
    raw.simVersion = '0.1.9';
    expect(parseRecording(raw).warnings.join(' ')).toMatch(/0\.1\.9/);
    expect(() => parseRecording({ format: 'sx1-simulador', version: 2 })).toThrow(/SESSÃO/);
    expect(() => parseRecording({ ...raw, version: 9 })).toThrow(/mais nova/);
  });
});
