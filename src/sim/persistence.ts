/**
 * Serialização do estado completo da simulação (configuração + estado físico).
 * O formato é JSON puro: pode ser salvo no armazenamento local do navegador
 * ou exportado como arquivo.
 */
import type { SimConfig } from './config/types';
import type { SimState } from './core/state';
import { SimulationEngine } from './core/engine';

export const SAVE_FORMAT = 'sx1-simulador';
export const SAVE_VERSION = 1;

export interface SaveFile {
  format: string;
  version: number;
  name: string;
  savedAt: string;
  simTime: number;
  scenarioId: string;
  config: SimConfig;
  state: SimState;
}

export function serializeEngine(e: SimulationEngine, name: string): SaveFile {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    name,
    savedAt: new Date().toISOString(),
    simTime: e.state.t,
    scenarioId: e.state.scenarioId,
    config: structuredClone(e.config),
    state: structuredClone(e.state),
  };
}

export function deserializeEngine(f: SaveFile): SimulationEngine {
  if (f.format !== SAVE_FORMAT) throw new Error('Arquivo não reconhecido (formato inválido).');
  if (f.version > SAVE_VERSION) throw new Error('Versão de arquivo mais nova que o simulador.');
  return new SimulationEngine(structuredClone(f.config), structuredClone(f.state));
}
