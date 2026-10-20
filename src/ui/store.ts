/**
 * Instância única do executor da simulação (fora do React) e hooks de acesso.
 */
import { useEffect, useReducer } from 'react';
import { SimRunner } from '../sim/core/runner';
import { buildScenario } from '../sim/scenarios';
import { defaultSimConfig } from '../sim/config/defaultVessel';
import type { SimConfig } from '../sim/config/types';
import { defaultGeo, type BottomConfig } from '../sim/environment/environment';
import { mapOrigin } from './routeNav';
import type { Command } from '../sim/commands';
import { storage } from './storage';
import type { SimulationEngine } from '../sim/core/engine';

/** fundo padrão das versões anteriores (relevo com 420 m na origem) */
const OLD_DEFAULT_BOTTOM = { baseDepth: 420, slopeNorth: 6, slopeEast: -3, roughness: 25, wavelength: 1800 };

/**
 * Parâmetros de fundo salvos por versões antigas (sem "modo"): se forem os
 * padrões antigos, passam ao novo padrão (uniforme 300 m); se o usuário os
 * tinha alterado, são mantidos em modo relevo.
 */
function migrateBottom(def: BottomConfig, saved: Partial<BottomConfig> | undefined): BottomConfig {
  if (!saved) return { ...def };
  if (saved.mode) return { ...def, ...saved };
  const untouched = (Object.keys(OLD_DEFAULT_BOTTOM) as (keyof typeof OLD_DEFAULT_BOTTOM)[]).every((k) => saved[k] === undefined || saved[k] === OLD_DEFAULT_BOTTOM[k]);
  return untouched ? { ...def } : { ...def, ...saved, mode: 'relevo' };
}

/** Configuração base (padrão + parâmetros salvos pelo usuário). */
export function baseConfig(): SimConfig {
  const saved = storage.getConfig();
  const def = defaultSimConfig();
  // referência geográfica dos cenários: a posição escolhida no mapa tático
  const geo = { ...defaultGeo(), ...saved?.environment?.geo, origin: mapOrigin.get() };
  if (!saved) return { ...def, environment: { ...def.environment, geo } };
  try {
    // mescla raso por seção para tolerar versões antigas
    return {
      vessel: { ...def.vessel, ...saved.vessel },
      environment: { ...def.environment, ...saved.environment, bottom: migrateBottom(def.environment.bottom, saved.environment?.bottom), geo },
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
