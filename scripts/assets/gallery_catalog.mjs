import { readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const folder = fileURLToPath(new URL('../../public/models/', import.meta.url));
const existing = new Set([
  'graneleiro.glb', 'carga.glb', 'rebocador.glb',
  'rebocador_asd.glb', 'rebocador_trator_voith.glb',
  'rebocador_convencional.glb', 'rebocadores_frota.glb', 'torpedo_f21.glb',
]);
const internal = new Set(['sx1-alta.glb', 'sx1-leve.glb', 'sx1-interior.glb', 'sx1-f21.glb']);
const names = {
  'fragata_tamandare.glb': 'Fragata Tamandaré',
  'sm39_exocet.glb': 'Míssil SM39 Exocet',
  'SM39_exocet_collection.glb': 'Coleção SM39 Exocet',
  'SM_39VSM.glb': 'SM39 no lançador vertical',
};

export function displayName(file) {
  return names[file] ?? path.basename(file, '.glb').replace(/[_-]+/g, ' ').replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase('pt-BR'));
}

export function extraGalleryModels(files) {
  return files.filter((file) => file.toLowerCase().endsWith('.glb') && !existing.has(file) && !internal.has(file))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map((file) => ({ file, name: displayName(file) }));
}

export function needsBlender(files) {
  return files.some((file) => file.toLowerCase().endsWith('.blend') && !files.includes(file.slice(0, -6) + '.glb'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = await readdir(folder);
  if (process.argv.includes('--needs-blender')) {
    process.stdout.write(String(needsBlender(files)) + '\n');
  } else {
    const assets = extraGalleryModels(files);
    await writeFile(path.join(folder, 'catalog.json'), JSON.stringify({ assets }, null, 2) + '\n');
    process.stdout.write(`Catálogo de modelos: ${existing.size + assets.length} itens (${assets.length} adicionais).\n`);
  }
}
