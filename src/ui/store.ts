/**
 * Instância única do executor da simulação (fora do React) e hooks de acesso.
 */
import { useEffect, useReducer } from 'react';
import { SimRunner } from '../sim/core/runner';
import { buildScenario } from '../sim/scenarios';
import { defaultSimConfig } from '../sim/config/defaultVessel';
import type { SimConfig } from '../sim/config/types';
import type { Command } from '../sim/commands';
import { storage } from './storage';
import type { SimulationEngine } from '../sim/core/engine';

/** Configuração base (padrão + parâmetros salvos pelo usuário). */
export function baseConfig(): SimConfig {
  const saved = storage.getConfig();
  const def = defaultSimConfig();
  if (!saved) return def;
  try {
    // mescla raso por seção para tolerar versões antigas
    return {
      vessel: { ...def.vessel, ...saved.vessel },
      environment: { ...def.environment, ...saved.environment, bottom: { ...def.environment.bottom, ...saved.environment?.bottom } },
      settings: { ...def.settings, ...saved.settings },
    };
  } catch {
    return def;
  }
}

export const runner = new SimRunner(buildScenario('superficie', baseConfig()));

export const cmd = (c: Command) => runner.command(c);

/** Re-renderiza o componente em taxa fixa e a cada comando. Retorna o motor atual. */
export function useSim(hz = 12): SimulationEngine {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const unsub = runner.subscribe(force);
    const id = window.setInterval(force, 1000 / hz);
    return () => {
      unsub();
      window.clearInterval(id);
    };
  }, [hz]);
  return runner.engine;
}
