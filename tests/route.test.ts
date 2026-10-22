/**
 * ROTA do mapa tático: o rumo ordenado ao seguir a rota usa a mesma origem
 * geográfica do mapa, do 3D e da física (nos cenários costeiros ela é a do
 * cenário, não a preferência guardada do mapa).
 */
import { describe, it, expect } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { SimRunner } from '../src/sim/core/runner';
import { nedToLatLon } from '../src/sim/geo';
import { route, mapOrigin, geoOriginOf } from '../src/ui/routeNav';

describe('Rota no cenário costeiro', () => {
  it('ponto 2 km ao norte → rumo ordenado ≈ 0°', () => {
    const e = buildScenario('base_itaguai');
    const r = new SimRunner(e);
    const origin = geoOriginOf(e);
    // a origem do cenário difere da preferência do mapa (é o caso que importa)
    expect(Math.hypot(origin.lat - mapOrigin.get().lat, origin.lon - mapOrigin.get().lon)).toBeGreaterThan(0.005);
    const here = nedToLatLon(origin, e.state.body.pos.x, e.state.body.pos.y);
    route.restore({ points: [{ lat: here.lat + 0.018, lon: here.lon }], active: false, idx: 0 });
    route.start(r);
    route.tick(r);
    const set = e.state.autopilot.headingSet;
    expect(Math.min(set, 360 - set)).toBeLessThan(2);
    route.clear(r);
  });
});
