/**
 * Tela Operação (fase B): regras do painel de sistemas e dono de cada canal.
 *  - até dois grupos fixados + um livre; abrir outro livre fecha o anterior;
 *  - "nav" (navegação) fica no console, não no painel;
 *  - estado salvo de versões anteriores é saneado;
 *  - dono do leme: PILOTO com o canal em AUTO, MANOBRA na emergida, senão OPERADOR.
 */
import { describe, expect, it } from 'vitest';
import { opsBus, sanitizeOps, SIDE_GROUPS, ALARM_GROUP, GROUP_TITLE } from '../src/ui/ops/opsBus';
import { GROUPS } from '../src/ui/ops/OpsGroups';
import { finOwner } from '../src/ui/ops/OpsConsole';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { SimRunner } from '../src/sim/core/runner';
import { maneuver } from '../src/ui/maneuvers';

describe('Painel de sistemas: até 2 fixados + 1 livre', () => {
  it('abrir um grupo livre fecha o outro; os fixados continuam abertos', () => {
    opsBus.st = { open: [], pinned: [] };
    opsBus.toggle('lastro');
    opsBus.toggle('comp');
    expect(opsBus.st.open).toEqual(['comp']);
    expect(opsBus.isOpen('lastro')).toBe(false);
    opsBus.togglePin('ar');
    opsBus.togglePin('trim');
    opsBus.toggle('energia');
    expect(opsBus.st.pinned).toEqual(['ar', 'trim']);
    expect(opsBus.st.open).toEqual(['energia']);
    // terceiro fixado: o mais antigo sai
    opsBus.togglePin('lastro');
    expect(opsBus.st.pinned).toEqual(['trim', 'lastro']);
    // grupo fixado não recolhe pelo cabeçalho; desafixado continua aberto como livre
    opsBus.toggle('trim');
    expect(opsBus.isOpen('trim')).toBe(true);
    opsBus.togglePin('trim');
    expect(opsBus.st.open).toEqual(['trim']);
    expect(opsBus.st.pinned).toEqual(['lastro']);
  });

  it('focar um grupo (cena, alarme, atalho) abre só ele entre os livres; "nav" não entra no painel', () => {
    opsBus.st = { open: ['comp'], pinned: [] };
    opsBus.focus('alarmes');
    expect(opsBus.st.open).toEqual(['alarmes']);
    opsBus.focus('nav');
    expect(opsBus.st.open).toEqual(['alarmes']);
    expect(opsBus.focusGroup).toBe('nav');
    opsBus.toggle('nav');
    opsBus.togglePin('nav');
    expect(opsBus.st).toEqual({ open: ['alarmes'], pinned: [] });
  });

  it('estado salvo de versões anteriores é saneado', () => {
    expect(sanitizeOps({ open: ['nav', 'lastro', 'comp'], pinned: ['nav', 'ar', 'ar', 'trim', 'energia'] as never })).toEqual({ open: ['comp'], pinned: ['trim', 'energia'] });
    expect(sanitizeOps(null)).toEqual({ open: [], pinned: [] });
  });

  it('todo grupo do painel tem título e corpo; todo alarme leva a um grupo do painel', () => {
    for (const g of SIDE_GROUPS) {
      expect(GROUP_TITLE[g]).toBeTruthy();
      expect(GROUPS[g].Body).toBeTypeOf('function');
    }
    expect(SIDE_GROUPS).not.toContain('nav');
    for (const g of Object.values(ALARM_GROUP)) expect(SIDE_GROUPS).toContain(g);
  });
});

describe('Dono de cada leme', () => {
  it('PILOTO com o canal em AUTO; toque manual volta a OPERADOR', () => {
    const e = buildScenario('submerso_50');
    expect(finOwner(e, 'rudder')).toBe('OPERADOR');
    applyCommand(e, { type: 'autopilot', channel: 'heading', mode: 'AUTO' });
    applyCommand(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
    expect(finOwner(e, 'rudder')).toBe('PILOTO');
    expect(finOwner(e, 'bow')).toBe('PILOTO');
    expect(finOwner(e, 'stern')).toBe('PILOTO');
    applyCommand(e, { type: 'surface', id: 'bow', angle: 5 });
    expect(finOwner(e, 'bow')).toBe('OPERADOR');
    expect(finOwner(e, 'stern')).toBe('OPERADOR');
    expect(finOwner(e, 'rudder')).toBe('PILOTO');
    // piloto de inclinação comanda só os lemes de ré
    applyCommand(e, { type: 'autopilot', channel: 'pitch', mode: 'AUTO' });
    expect(finOwner(e, 'stern')).toBe('PILOTO');
    expect(finOwner(e, 'bow')).toBe('OPERADOR');
  });

  it('na emergida, depois de fechar os suspiros, os lemes de vante e ré são da MANOBRA', () => {
    const r = new SimRunner(buildScenario('submerso_50'));
    maneuver.start(r, 'emergir');
    for (let i = 0; i < 80000 && maneuver.active && maneuver.step < 2; i++) {
      r.engine.step();
      maneuver.tick(r);
    }
    expect(maneuver.step).toBe(2);
    expect(finOwner(r.engine, 'bow')).toBe('MANOBRA');
    expect(finOwner(r.engine, 'stern')).toBe('MANOBRA');
    maneuver.cancel(r);
  });
});

import { clampSideWidth, isCompact, COMPACT_BELOW, SIDE_MIN, SIDE_MAX } from '../src/ui/ops/layout';
import { telegraphStep } from '../src/ui/ops/OpsConsole';
import { TELEGRAPH } from '../src/ui/components/Controls';

describe('Fase C: console compacto e largura do painel', () => {
  it('automático: compacto só quando falta altura; escolha manual vence', () => {
    expect(isCompact('auto', COMPACT_BELOW - 1)).toBe(true); // 1366×768 com o navegador (~490 px)
    expect(isCompact('auto', 600)).toBe(false); // 1366×768 em tela cheia
    expect(isCompact('auto', 0)).toBe(false); // coluna única (celular): altura não conta
    expect(isCompact('compacto', 900)).toBe(true);
    expect(isCompact('completo', 300)).toBe(false);
  });

  it('largura do painel fica entre 340 e 560 px e em no máximo 45 % da janela', () => {
    expect(clampSideWidth(100, 1920)).toBe(SIDE_MIN);
    expect(clampSideWidth(900, 1920)).toBe(SIDE_MAX);
    expect(clampSideWidth(600, 1100)).toBe(Math.round(1100 * 0.45));
    expect(clampSideWidth(450, 1366)).toBe(450);
  });

  it('◀ ▶ do console compacto andam pelas ordens do telégrafo', () => {
    const rpms = TELEGRAPH.map((t) => t.rpm);
    expect(telegraphStep(0, 1)).toBe(rpms[rpms.indexOf(0) + 1]);
    expect(telegraphStep(0, -1)).toBe(rpms[rpms.indexOf(0) - 1]);
    expect(telegraphStep(rpms[rpms.length - 1], 1)).toBe(rpms[rpms.length - 1]);
    expect(telegraphStep(rpms[0], -1)).toBe(rpms[0]);
    // fora das ordens (ajuste fino de ±10 rpm): vai para a ordem seguinte no sentido pedido
    expect(telegraphStep(85, 1)).toBe(rpms.find((r) => r > 85));
    expect(telegraphStep(85, -1)).toBe([...rpms].reverse().find((r) => r < 85));
  });
});
