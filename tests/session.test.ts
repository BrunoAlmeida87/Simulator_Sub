/**
 * SALVAR E CONTINUAR A SIMULAÇÃO: o arquivo de sessão preserva tudo o que é
 * necessário para continuar exatamente do mesmo ponto, e arquivos antigos
 * (formato v1) continuam abrindo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { serializeEngine, deserializeEngine, saveToText, parseSaveText, migrateSave, SAVE_VERSION } from '../src/sim/persistence';
import type { SimulationEngine } from '../src/sim/core/engine';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const physics = (e: SimulationEngine) => JSON.stringify({ ...e.state, commands: [] });

describe('Sessão: continuação exata', () => {
  it('salvar a 50 m / 6 nós com automações e continuar dá o mesmo resultado que não parar', () => {
    const a = buildScenario('submerso_50');
    applyCommand(a, { type: 'telegraph', rpm: 80 });
    applyCommand(a, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
    applyCommand(a, { type: 'setpoint', channel: 'depth', value: 55 });
    applyCommand(a, { type: 'autopilot', channel: 'heading', mode: 'AUTO' });
    applyCommand(a, { type: 'setpoint', channel: 'heading', value: 40 });
    applyCommand(a, { type: 'dosing', system: 'trim', mode: 'transferir', kg: 600, dir: 'AtoB' });
    applyCommand(a, { type: 'seaState', value: 2 });
    applyCommand(a, { type: 'failure', target: 'sensor:GIRO', active: true, param: 'deriva' });
    a.advanceSim(37.3);
    expect(a.state.trim.dosing?.active).toBe(true); // sequência automática em andamento
    // salva (texto do arquivo) e restaura em outro motor
    const text = saveToText(serializeEngine(a, 'teste'));
    const b = deserializeEngine(parseSaveText(text));
    expect(physics(b)).toBe(physics(a));
    a.advanceSim(90);
    b.advanceSim(90);
    expect(b.state.t).toBe(a.state.t);
    expect(physics(b)).toBe(physics(a));
    expect(b.outputs.depthKeel).toBe(a.outputs.depthKeel);
  });

  it('preserva números não finitos (NaN/∞) que o JSON perderia', () => {
    const e = buildScenario('superficie');
    e.state.autopilot.tDepth.d = NaN;
    e.state.autopilot.tPitch.d = Infinity;
    const f = parseSaveText(saveToText(serializeEngine(e, 'nf')));
    expect(Number.isNaN(f.state.autopilot.tDepth.d)).toBe(true);
    expect(f.state.autopilot.tPitch.d).toBe(Infinity);
  });

  it('guarda as automações da interface na seção "session"', () => {
    const e = buildScenario('superficie');
    const f = parseSaveText(saveToText(serializeEngine(e, 'x', { timeScale: 4, automation: { maneuver: { active: 'imergir', step: 1 } } })));
    expect(f.version).toBe(SAVE_VERSION);
    expect(f.session?.timeScale).toBe(4);
    expect((f.session?.automation?.maneuver as { active: string }).active).toBe('imergir');
  });
});

describe('Sessão: compatibilidade com arquivos antigos', () => {
  for (const name of ['estado-v1-submerso50.json', 'estado-v1-antigo.json']) {
    it(`abre ${name} (formato v1), mantém a condição e continua sem valores inválidos`, () => {
      const raw = fixture(name);
      const f = migrateSave(raw);
      expect(f.migratedFrom).toBe(1);
      const e = deserializeEngine(raw);
      expect(e.state.t).toBeCloseTo(raw.state.t, 9);
      expect(e.state.body.pos.z).toBe(raw.state.body.pos.z);
      expect(e.state.electrical.soc).toBe(raw.state.electrical.soc);
      expect(e.state.compensation.dosing?.active).toBe(true);
      expect(e.state.sensors.ECO.failMode).toBe('deriva');
      e.advanceSim(30);
      for (const v of [e.outputs.depthKeel, e.outputs.netBuoyancyKg, e.state.body.vel.x, e.state.electrical.soc, e.outputs.euler.pitch, e.outputs.bottomDepth]) expect(Number.isFinite(v)).toBe(true);
      expect(e.outputs.depthKeel).toBeGreaterThan(20);
    });
  }

  it('arquivo antigo sem ondas continua com mar calmo (a ausência é respeitada)', () => {
    const e = deserializeEngine(fixture('estado-v1-antigo.json'));
    expect(e.config.environment.waves).toBeUndefined();
    expect(e.env.waves.active).toBe(false);
  });

  it('rejeita com mensagem clara arquivos de versão mais nova, gravações e arquivos estranhos', () => {
    const raw = fixture('estado-v1-submerso50.json');
    expect(() => migrateSave({ ...raw, version: 99, simVersion: '9.0.0' })).toThrow(/versão mais nova/);
    expect(() => migrateSave({ format: 'sx1-gravacao', version: 1 })).toThrow(/GRAVAÇÃO/);
    expect(() => migrateSave({ foo: 1 })).toThrow(/não reconhecido/);
    expect(() => parseSaveText('{ quebrado')).toThrow(/JSON/);
  });
});
