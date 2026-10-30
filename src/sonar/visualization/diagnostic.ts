import type { SimulationEngine } from '../../sim/core/engine';
import { propagation } from '../acoustics/propagation';
import { observer } from '../integration/world';
import type { Propagation } from '../types';
const cache = new WeakMap<SimulationEngine, { key: string; data: Propagation }>();
export function diagnostic(e: SimulationEngine): Propagation {
  const s = e.state.sonar!,
    cfg = s.settings;
  const key = JSON.stringify([Math.floor(e.state.t / 5), cfg.section, cfg.range, cfg.rayCount, cfg.homogeneous, e.env.cfg]);
  let c = cache.get(e);
  if (!c || c.key !== key) {
    c = { key, data: propagation(e.env, observer(e), cfg.section, cfg.range, cfg.rayCount, cfg.homogeneous) };
    cache.set(e, c);
  }
  return c.data;
}
