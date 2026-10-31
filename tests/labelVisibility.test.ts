import { describe, it, expect } from 'vitest';
import { defaultLabelVisibility, labelCategory, labelIsVisible, parseLabelVisibility } from '../src/render3d/labelVisibility';
import { defaultLayers, LAYER_INFO, SCENE_LAYER_KEYS } from '../src/render3d/layers';

describe('Identificações por categoria e por componente', () => {
  it.each([
    ['tkTLP-AV-BB', 'tanks'], ['vlSuspiro AV', 'valves'], ['pmCompensação', 'pumps'],
    ['pwB', 'energy'], ['pwG', 'energy'], ['airAP1', 'air'], ['shipC1', 'ships'],
    ['rio-Cristo', 'places'], ['estaleiro', 'places'], ['cg_tripulantes', 'cargo'],
    ['dwB', 'cargo'], ['dwP', 'forces'], ['tmN', 'forces'], ['fP', 'forces'],
    ['hrudder', 'forces'], ['drF', 'attitude'], ['pAngH', 'attitude'], ['surf', 'environment'],
    ['torp_T1', 'weapons'], ['ini_INI1', 'weapons'], ['exp_T2', 'weapons'],
  ])('classifica %s como %s', (id, category) => expect(labelCategory(id)).toBe(category));

  it('ocultar um tanque não oculta os demais nem modifica suas camadas', () => {
    const prefs = defaultLabelVisibility();
    const layers = { ...defaultLayers(), tanks: true };
    prefs.hidden['tkTLP-AV-BB'] = 'Tanque de vante';
    expect(labelIsVisible('tkTLP-AV-BB', prefs)).toBe(false);
    expect(labelIsVisible('tkTLP-AV-BE', prefs)).toBe(true);
    expect(layers.tanks).toBe(true);
    const restored = parseLabelVisibility(JSON.parse(JSON.stringify(prefs)));
    expect(labelIsVisible('tkTLP-AV-BB', restored)).toBe(false);
    delete restored.hidden['tkTLP-AV-BB'];
    expect(labelIsVisible('tkTLP-AV-BB', restored)).toBe(true);
  });

  it('restaurar um item não sobrepõe uma categoria desativada', () => {
    const prefs = defaultLabelVisibility();
    prefs.categories.valves = false;
    expect(labelIsVisible('vlSuspiro AV', prefs)).toBe(false);
    expect(labelIsVisible('pmCompensação', prefs)).toBe(true);
  });

  it('valida dados salvos e preserva categorias novas', () => {
    const prefs = parseLabelVisibility({ categories: { tanks: false, pumps: 'não' }, hidden: { tk1: 'Tanque', tk2: 4 }, details: true });
    expect(prefs.categories.tanks).toBe(false);
    expect(prefs.categories.pumps).toBe(true);
    expect(prefs.hidden).toEqual({ tk1: 'Tanque' });
    expect(prefs.details).toBe(true);
    expect(parseLabelVisibility(null)).toEqual(defaultLabelVisibility());
  });

  it('oferece todas as camadas do catálogo uma única vez em cada visualização', () => {
    expect([...SCENE_LAYER_KEYS].sort()).toEqual(Object.keys(LAYER_INFO).sort());
    expect(new Set(SCENE_LAYER_KEYS).size).toBe(SCENE_LAYER_KEYS.length);
  });
});
