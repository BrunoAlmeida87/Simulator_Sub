/** Debriefing: respostas aos alarmes, reação aos eventos do instrutor e nota indicativa (src/ui/debrief.ts). */
import { describe, expect, it } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { HistoryRecorder } from '../src/sim/history';
import { alarmResponses, buildDebrief, debriefText } from '../src/ui/debrief';
import { paletteMatches } from '../src/ui/components/CommandPalette';

describe('debriefing', () => {
  it('mede o tempo de reconhecimento e a reação ao evento do instrutor', () => {
    const e = buildScenario('submerso_50');
    const h = new HistoryRecorder();
    applyCommand(e, { type: 'instructor', action: 'add', event: { label: 'Falha da bomba de trim', at: 2, command: { type: 'failure', target: 'pump:trim', active: true } } });
    for (let i = 0; i < 250; i++) {
      e.step();
      h.sample(e);
    }
    applyCommand(e, { type: 'ack', id: 'ALL' });
    applyCommand(e, { type: 'telegraph', rpm: 80 });
    const r = buildDebrief(e.vessel, e.state, h);
    const pf = alarmResponses(e.state).find((a) => a.id === 'PUMP_FAIL');
    expect(pf?.acked).not.toBeNull();
    expect(r.events.length).toBe(1);
    expect(r.events[0].reaction).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(100);
    expect(r.score).toBeGreaterThan(0);
    expect(debriefText(r, 'teste')).toContain('DEBRIEFING');
  });

  it('busca da paleta ignora acentos e aceita várias palavras', () => {
    expect(paletteMatches('Segurança · Controle de avarias', 'avaria seguranca')).toBe(true);
    expect(paletteMatches('Laboratórios', 'labor')).toBe(true);
    expect(paletteMatches('Mapa tático', 'sonar')).toBe(false);
  });
});
