import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, SCREEN_IDS, alarmMarks, groupMark, groupOf, groupTarget, isScreenId, screenForKey } from '../src/ui/nav';

describe('navegação em dois níveis (grupos → telas)', () => {
  const all = NAV_GROUPS.flatMap((g) => g.screens.map((s) => s.id));

  it('toda tela aparece exatamente uma vez', () => {
    for (const id of SCREEN_IDS) expect(all.filter((x) => x === id).length, id).toBe(1);
    expect(all.length).toBe(SCREEN_IDS.length);
  });

  it('Sala de comando é a última (último item do último grupo)', () => {
    expect(all[all.length - 1]).toBe('sala');
    expect(NAV_GROUPS[NAV_GROUPS.length - 1].id).toBe('sala');
  });

  it('teclas 0–8 abrem as mesmas telas de antes', () => {
    const before: Record<string, string> = { '0': 'pilotagem', '1': 'comando', '2': 'lastro', '3': 'trim', '4': 'propulsao', '5': 'seguranca', '6': 'v3d', '7': 'historico', '8': 'sala' };
    for (const [k, id] of Object.entries(before)) expect(screenForKey(k), k).toBe(id);
    const keys = NAV_GROUPS.flatMap((g) => g.screens.filter((s) => s.key).map((s) => s.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(screenForKey('9')).toBeNull();
  });

  it('grupos: rótulos curtos, sem grupo vazio, e o clique volta à última tela usada', () => {
    for (const g of NAV_GROUPS) {
      expect(g.screens.length).toBeGreaterThan(0);
      expect(g.short.length).toBeLessThanOrEqual(10);
    }
    const sis = groupOf('trim');
    expect(sis.id).toBe('sistemas');
    expect(groupTarget(sis, {})).toBe('sistemas');
    expect(groupTarget(sis, { sistemas: 'trim' })).toBe('trim');
    expect(groupTarget(sis, { sistemas: 'mapa' })).toBe('sistemas'); // tela de outro grupo: ignora
    expect(isScreenId('pilotagem')).toBe(true);
    expect(isScreenId('aba-removida')).toBe(false);
  });

  it('marcas de alarme vão para a tela do sistema, para Segurança e para o grupo', () => {
    const m = alarmMarks([
      { def: { system: 'Hidráulica', priority: 2 }, active: true, acked: false },
      { def: { system: 'Atitude', priority: 3 }, active: false, acked: false },
    ]);
    expect(m.get('auxiliares')).toBe('alarm');
    expect(m.get('trim')).toBe('warn');
    expect(m.get('seguranca')).toBe('alarm');
    expect(groupMark(groupOf('lastro'), m)).toBe('alarm');
    expect(groupMark(groupOf('historico'), m)).toBeUndefined();
  });
});
