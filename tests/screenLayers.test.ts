/**
 * Toda camada que aparece no painel "Camadas" de uma tela precisa ser gravada ao clicar.
 * A Vista 3D e a Operação só gravam as chaves de *_LAYER_DEFAULTS (ou as tratadas à parte em setLayers);
 * uma camada fora delas aparece no painel, mas o clique não faz nada (aconteceu com "Meio casco aberto").
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** chaves de um objeto/lista constante do arquivo-fonte (const NOME = { … } ou [ … ]) */
function keysOf(src: string, name: string): string[] {
  const i = src.indexOf(`const ${name}`);
  if (i < 0) throw new Error(`${name} não encontrado`);
  const m = src.slice(i).match(/=\s*([[{])([\s\S]*?)\n[\]}]/);
  if (!m) throw new Error(`${name}: lista não reconhecida`);
  return m[1] === '[' ? [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]) : [...m[2].matchAll(/^\s*(\w+):/gm)].map((x) => x[1]);
}

/** chaves gravadas à parte no setLayers (if (p.X !== undefined) …) e as de setVecLayers */
function handled(src: string): string[] {
  const body = src.slice(src.indexOf('const setLayers'));
  const own = [...body.slice(0, body.indexOf('};')).matchAll(/p\.(\w+) !== undefined/g)].map((x) => x[1]);
  return [...own, 'vectors', 'hydroVectors', 'trimVectors', 'hiddenVectors'];
}

describe('camadas do painel são gravadas ao clicar', () => {
  for (const [file, keys, defs] of [
    ['src/ui/screens/View3DScreen.tsx', 'V3D_LAYER_KEYS', 'V3D_LAYER_DEFAULTS'],
    ['src/ui/screens/PilotScreen.tsx', 'PILOT_LAYER_KEYS', 'PILOT_LAYER_DEFAULTS'],
  ]) {
    it(file, () => {
      const src = readFileSync(join(__dirname, '..', file), 'utf-8');
      const saved = new Set([...keysOf(src, defs), ...handled(src)]);
      const panel = keysOf(src, keys);
      expect(panel.length).toBeGreaterThan(10);
      expect(panel.filter((k) => !saved.has(k))).toEqual([]);
    });
  }
});
