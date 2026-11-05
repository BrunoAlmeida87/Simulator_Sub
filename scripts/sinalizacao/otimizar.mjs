/**
 * Copia e otimiza os GLBs da biblioteca "Submarine Signalling 3D" (gerada fora do projeto) para
 * public/models/sinalizacao/, e os sprites usados pelos efeitos para public/textures/sinalizacao/.
 *
 *  - GLBs: dedup + prune (mantendo os nós auxiliares vazios) + texturas em WebP (EXT_texture_webp, no máximo 512 px). A geometria, os nomes dos
 *    nós auxiliares (SMOKE_EMITTER, LIGHT_EMITTER, BUOY_WATERLINE…), os materiais e os clipes ficam intactos
 *    (sem quantização: os clipes animam a escala dos núcleos emissivos);
 *  - só as variantes de cor (o arquivo principal de cada tipo é igual a uma delas) e os modelos sem variantes.
 *
 * Uso: npm run sinalizacao:assets -- "C:\Users\...\kimi\workspace\submarine_signalling_3d"
 *      (sem argumento: a pasta do Kimi no computador do autor)
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lib = process.argv[2] ?? 'C:/Users/Bruno/Documents/kimi/workspace/submarine_signalling_3d';
const outModels = join(root, 'public', 'models', 'sinalizacao');
const outTex = join(root, 'public', 'textures', 'sinalizacao');
mkdirSync(outModels, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const files = [
  ...readdirSync(join(lib, 'glb', 'variants'))
    .filter((f) => f.endsWith('.glb'))
    .map((f) => join(lib, 'glb', 'variants', f)),
  ...['parachute', 'combined_signal', 'emergency_buoy', 'submarine_release_visual', 'control_panel'].map((f) => join(lib, 'glb', `${f}.glb`)),
];
let a = 0;
let b = 0;
for (const src of files) {
  const name = basename(src);
  const doc = await io.read(src);
  await doc.transform(dedup(), prune({ keepLeaves: true, keepExtras: true }), textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 88, resize: [512, 512] }));
  doc.getRoot().getAsset().generator = 'Submarine Signalling 3D (Blender) + gltf-transform (SX-1)';
  const out = join(outModels, name);
  await io.write(out, doc);
  a += statSync(src).size;
  b += statSync(out).size;
}
console.log(`${files.length} GLBs: ${(a / 1048576).toFixed(2)} MB → ${(b / 1048576).toFixed(2)} MB`);

// sprites dos efeitos (fumaça, brilho, bolhas, água)
const sprites = {
  smoke: ['smoke_small', 'smoke_medium', 'smoke_dispersed', 'smoke_dense', 'smoke_light', 'smoke_residual'],
  glow: ['halo_red', 'halo_yellow', 'halo_green', 'halo_white', 'flash_intense', 'light_particle', 'light_streak', 'glow_residual'],
  bubbles: ['bubble_small', 'bubble_irregular'],
  water: ['splash_small', 'water_drops', 'wave_ring', 'surface_foam', 'water_disturbance'],
};
for (const [dir, names] of Object.entries(sprites)) {
  mkdirSync(join(outTex, dir), { recursive: true });
  for (const n of names) copyFileSync(join(lib, 'textures', dir, `${n}.png`), join(outTex, dir, `${n}.png`));
}
console.log(`sprites: ${Object.values(sprites).flat().length} PNGs em public/textures/sinalizacao`);
