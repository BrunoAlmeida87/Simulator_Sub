/** Todas as vistas externas usam o mesmo catálogo e guardam qualquer camada acionada. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCENE_LAYER_KEYS, LAYER_INFO } from '../src/render3d/layers';

describe('camadas do painel são iguais e persistem em cada tela', () => {
  it('o catálogo comum inclui todas as camadas disponíveis uma vez', () => {
    expect([...SCENE_LAYER_KEYS].sort()).toEqual(Object.keys(LAYER_INFO).sort());
    expect(new Set(SCENE_LAYER_KEYS).size).toBe(SCENE_LAYER_KEYS.length);
  });

  for (const [file, keys] of [
    ['src/ui/screens/View3DScreen.tsx', 'V3D_LAYER_KEYS'],
    ['src/ui/screens/PilotScreen.tsx', 'PILOT_LAYER_KEYS'],
  ]) {
    it(file, () => {
      const src = readFileSync(join(__dirname, '..', file), 'utf-8');
      expect(src).toContain(`const ${keys}: LayerKey[] = SCENE_LAYER_KEYS;`);
      expect(src).toMatch(/setLay\(\{\s*\.\.\.laySaved,\s*\.\.\.p\s*\}\)/);
      expect(src).toContain(`keys={${keys}}`);
    });
  }
});
