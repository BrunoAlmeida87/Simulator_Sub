/**
 * MODELOS DA SINALIZAÇÃO (public/models/sinalizacao/, da biblioteca "Submarine Signalling 3D" via
 * scripts/sinalizacao/otimizar.mjs). Confere o contrato com SignalVis.ts e SignalPreview.ts: todo arquivo pedido para
 * qualquer dispositivo/cor existe, tem os nós auxiliares usados (linha d'água, emissores, alvos de câmera, origem do
 * lançamento) e os clipes tocados pelo código; os sprites dos efeitos existem; nada disso entra na galeria.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { PANEL_FILE, PARACHUTE_FILE, RELEASE_FILE, ascentFile, deviceFiles, flareFile, surfaceFile } from '../src/render3d/SignalVis';
import { SIGNAL_INFO, SIGNAL_KINDS } from '../src/sim/systems/signals';
import { extraGalleryModels } from '../scripts/assets/gallery_catalog.mjs';

const dir = join(__dirname, '..', 'public', 'models', 'sinalizacao');
const docs = new Map<string, Document>();
const all = new Set<string>([RELEASE_FILE, PARACHUTE_FILE, PANEL_FILE]);
for (const k of SIGNAL_KINDS) for (const c of SIGNAL_INFO[k].colors) for (const f of deviceFiles(k, c)) all.add(f);

beforeAll(async () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const f of all) if (existsSync(join(dir, f))) docs.set(f, await io.read(join(dir, f)));
});
const names = (f: string) =>
  new Set(
    docs
      .get(f)!
      .getRoot()
      .listNodes()
      .map((n) => n.getName()),
  );
const clips = (f: string) =>
  new Set(
    docs
      .get(f)!
      .getRoot()
      .listAnimations()
      .map((a) => a.getName()),
  );

describe('modelos da sinalização', () => {
  it('todo arquivo pedido por algum dispositivo/cor existe', () => {
    for (const f of all) expect(existsSync(join(dir, f)), f).toBe(true);
    expect(all.size).toBeGreaterThanOrEqual(20);
  });

  it('cilindros de subida: SIGNAL_TRAIL_ORIGIN e SIGNAL_CAMERA_TARGET', () => {
    for (const k of SIGNAL_KINDS)
      for (const c of SIGNAL_INFO[k].colors) {
        const f = ascentFile(k, c);
        if (k === 'boia') continue;
        for (const n of ['SIGNAL_TRAIL_ORIGIN', 'SIGNAL_CAMERA_TARGET']) expect(names(f).has(n), `${f} ${n}`).toBe(true);
      }
  });

  it('flutuadores: linha d’água, emissores, alvos de câmera e clipes de estado', () => {
    for (const k of SIGNAL_KINDS)
      for (const c of SIGNAL_INFO[k].colors) {
        const f = surfaceFile(k, c);
        const eff = SIGNAL_INFO[k].effect;
        const n = names(f);
        if (eff === 'luz') {
          for (const x of ['WATERLINE_REFERENCE', 'LIGHT_EMITTER', 'LIGHT_CAMERA_TARGET']) expect(n.has(x), `${f} ${x}`).toBe(true);
          for (const x of ['OFF', 'LOW_INTENSITY', 'ACTIVE', 'FADING']) expect(clips(f).has(x), `${f} ${x}`).toBe(true);
        } else if (eff === 'fumaca') {
          for (const x of ['WATERLINE_REFERENCE', 'SMOKE_EMITTER', 'SMOKE_CAMERA_TARGET']) expect(n.has(x), `${f} ${x}`).toBe(true);
        } else if (eff === 'combinado') {
          for (const x of ['WATERLINE_REFERENCE', 'SMOKE_EMITTER', 'LIGHT_EMITTER', 'SMOKE_VISUAL_PROXY']) expect(n.has(x), `${f} ${x}`).toBe(true);
          for (const x of ['INACTIVE', 'LIGHT_ACTIVE', 'SMOKE_ACTIVE', 'LIGHT_SMOKE_ACTIVE', 'ENDED']) expect(clips(f).has(x), `${f} ${x}`).toBe(true);
        } else if (eff === 'boia') {
          for (const x of ['BUOY_WATERLINE', 'BUOY_LIGHT', 'BUOY_ANTENNA', 'BUOY_CAMERA_TARGET']) expect(n.has(x), `${f} ${x}`).toBe(true);
          for (const x of ['BUOY_FLOAT', 'BUOY_IDLE', 'BUOY_LIGHT_FLASH', 'BUOY_LIGHT_OFF']) expect(clips(f).has(x), `${f} ${x}`).toBe(true);
        }
      }
  });

  it('estrela e paraquedas: origem das partículas, ponto de suspensão e clipes', () => {
    for (const c of SIGNAL_INFO.estrela.colors) {
      const f = flareFile(c);
      expect(names(f).has('FLARE_PARTICLE_ORIGIN'), f).toBe(true);
      for (const x of ['FLARE_GLOW', 'FLARE_FADE']) expect(clips(f).has(x), `${f} ${x}`).toBe(true);
    }
    expect(names(PARACHUTE_FILE).has('PARACHUTE_SUSPENSION_POINT')).toBe(true);
    for (const x of ['PARACHUTE_CLOSED_VISUAL', 'PARACHUTE_OPEN', 'PARACHUTE_SWAY']) expect(clips(PARACHUTE_FILE).has(x)).toBe(true);
  });

  it('lançador e painel: SIGNAL_RELEASE_ORIGIN e indicadores', () => {
    expect(names(RELEASE_FILE).has('SIGNAL_RELEASE_ORIGIN')).toBe(true);
    for (const x of ['INDICATOR_READY', 'INDICATOR_ACTIVE', 'INDICATOR_FAULT', 'INDICATOR_SIGNAL_SELECTED', 'INDICATOR_BUOY_STATUS']) expect(names(PANEL_FILE).has(x), x).toBe(true);
  });

  it('cores: cada variante usada tem a cor do dispositivo no nome do arquivo', () => {
    expect(ascentFile('vermelho', 'vermelho')).toBe('underwater_signal_red.glb');
    expect(surfaceFile('verde', 'verde')).toBe('floating_light_signal_green.glb');
    expect(surfaceFile('fumaca', 'laranja')).toBe('floating_smoke_signal_orange.glb');
    expect(flareFile('amarelo')).toBe('star_flare_yellow.glb');
    expect(ascentFile('combinado', 'laranja')).toBe('underwater_signal_neutral.glb');
  });

  it('sprites dos efeitos existem; a subpasta não entra na galeria', () => {
    const tex = join(__dirname, '..', 'public', 'textures', 'sinalizacao');
    for (const f of [
      'smoke/smoke_dense.png',
      'smoke/smoke_dispersed.png',
      'bubbles/bubble_small.png',
      'glow/light_particle.png',
      'glow/flash_intense.png',
      'water/wave_ring.png',
      'water/surface_foam.png',
      'water/water_drops.png',
    ])
      expect(existsSync(join(tex, f)), f).toBe(true);
    for (const c of ['red', 'yellow', 'green', 'white']) expect(existsSync(join(tex, 'glow', `halo_${c}.png`))).toBe(true);
    const top = readdirSync(join(__dirname, '..', 'public', 'models'));
    expect(extraGalleryModels(top).some((m: { file: string }) => m.file.includes('signal'))).toBe(false);
  });
});
