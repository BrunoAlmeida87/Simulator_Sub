/**
 * Otimiza os .glb crus exportados pelo Blender (build/modelo/sx1-*.raw.glb) e grava
 * public/models/sx1-alta.glb e public/models/sx1-leve.glb.
 *
 *  - malhas: dedup + prune + meshopt (reordenação, quantização e EXT_meshopt_compression);
 *  - texturas: já saem do Blender em WebP (EXT_texture_webp) — 2K na alta, 1K na leve.
 *
 * A quantização mexe só nos nós das malhas ("…_Malha"): os nós com os nomes fixos das
 * peças móveis (pivôs) ficam intactos — o teste tests/subModelFile.test.ts confere.
 *
 * Uso: npm run modelo:otimizar
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { statSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIMITE = { alta: 6 * 1024 * 1024, leve: 2 * 1024 * 1024 };

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

mkdirSync(join(root, 'public', 'models'), { recursive: true });
let falhou = false;
for (const nivel of ['alta', 'leve']) {
  const src = join(root, 'build', 'modelo', `sx1-${nivel}.raw.glb`);
  const out = join(root, 'public', 'models', `sx1-${nivel}.glb`);
  const doc = await io.read(src);
  await doc.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  doc.getRoot().getAsset().generator = 'SX-1 build_sx1.py (Blender) + gltf-transform';
  await io.write(out, doc);
  const a = statSync(src).size;
  const b = statSync(out).size;
  const ok = b <= LIMITE[nivel];
  if (!ok) falhou = true;
  console.log(`${nivel}: ${(a / 1048576).toFixed(2)} MB → ${(b / 1048576).toFixed(2)} MB (limite ${LIMITE[nivel] / 1048576} MB) ${ok ? 'ok' : 'ACIMA DO LIMITE'}`);
}
if (falhou) process.exit(1);
