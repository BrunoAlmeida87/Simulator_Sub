import type { SimulationEngine } from '../../sim/core/engine';
import { contactsLocal, DEFAULT_ORIGIN, type Contact } from '../../sim/geo';
import { trafficAt, trafficForEnv } from '../../sim/traffic';
import type { Observer } from '../types';
/** The sole world adapter. Same routes, local geographic frame and bathymetry as Ships/map. */
export function worldSources(e: SimulationEngine): Contact[] {
  const origin = e.env.cfg.geo?.origin ?? DEFAULT_ORIGIN;
  return [...contactsLocal(e.state.t, origin), ...trafficAt(e.state.t, trafficForEnv(e.env, origin, e.state.sonar?.settings.traffic ?? 0), origin)];
}
export function observer(e: SimulationEngine): Observer {
  return { n: e.state.body.pos.x, e: e.state.body.pos.y, depth: Math.max(0.5, e.state.body.pos.z), heading: e.outputs.euler.heading, vn: e.outputs.velNED.x, ve: e.outputs.velNED.y };
}
