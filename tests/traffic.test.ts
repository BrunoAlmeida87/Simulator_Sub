/**
 * TRÁFEGO ADICIONAL: quantidade configurável, posições estáveis, só em água
 * com profundidade para o calado e sem navios sobrepostos.
 */
import { describe, it, expect } from 'vitest';
import { Environment, defaultEnvironment } from '../src/sim/environment/environment';
import { buildTraffic, trafficAt, trafficForEnv, segSegDist, MAX_TRAFFIC } from '../src/sim/traffic';
import { contactsAt, contactsLocal, contactRoutes, latLonToNed, DEFAULT_ORIGIN, OFFSHORE_ORIGIN, type LatLon } from '../src/sim/geo';

const MIN_DEPTH: Record<string, number> = { pesqueiro: 6, rebocador: 6, patrulha: 8, mercante: 18 };

function envAt(origin: LatLon, coast: boolean) {
  return new Environment({ ...defaultEnvironment(), geo: { origin, coast, shelfWidth: 1000 } });
}

describe('Tráfego adicional', () => {
  it('a quantidade pedida é respeitada (mar aberto) e 0 não cria navios', () => {
    const env = envAt(OFFSHORE_ORIGIN, false);
    for (const n of [0, 1, 7, MAX_TRAFFIC]) expect(trafficForEnv(env, OFFSHORE_ORIGIN, n).length).toBe(n);
    expect(buildTraffic(OFFSHORE_ORIGIN, 99, () => 300).length).toBe(MAX_TRAFFIC);
  });

  it('é estável: mesma origem e quantidade → mesmos navios; aumentar acrescenta sem trocar os primeiros', () => {
    const a = buildTraffic(OFFSHORE_ORIGIN, 8, () => 300);
    const b = buildTraffic(OFFSHORE_ORIGIN, 8, () => 300);
    expect(b).toEqual(a);
    const c = buildTraffic(OFFSHORE_ORIGIN, 12, () => 300);
    expect(c.slice(0, 8)).toEqual(a);
  });

  for (const [name, origin] of [
    ['baía de Sepetiba (costa ligada)', DEFAULT_ORIGIN],
    ['Itaguaí (costa ligada)', { lat: -22.93041, lon: -43.85273 }],
    ['mar aberto', OFFSHORE_ORIGIN],
  ] as [string, LatLon][]) {
    it(`${name}: todo trecho em água com profundidade para o calado, longe da origem`, () => {
      const env = envAt(origin, true);
      const routes = trafficForEnv(env, origin, MAX_TRAFFIC);
      expect(routes.length).toBeGreaterThan(0);
      for (const r of routes) {
        const A = latLonToNed(origin, r.a);
        const B = latLonToNed(origin, r.b);
        for (let i = 0; i <= 40; i++) {
          const f = i / 40;
          expect(env.bottomDepthAt(A.n + (B.n - A.n) * f, A.e + (B.e - A.e) * f)).toBeGreaterThanOrEqual(MIN_DEPTH[r.kind]);
        }
        expect(segSegDist(A, B, { n: 0, e: 0 }, { n: 0, e: 0 })).toBeGreaterThanOrEqual(500);
      }
    });
  }

  it('nunca há dois navios sobrepostos (adicionais e contatos fixos), em qualquer instante', () => {
    const origin = OFFSHORE_ORIGIN;
    const routes = trafficForEnv(envAt(origin, true), origin, MAX_TRAFFIC);
    // trechos afastados entre si ⇒ navios afastados
    const segs = [...routes.map((r) => [latLonToNed(origin, r.a), latLonToNed(origin, r.b)]), ...contactRoutes().map((r) => [latLonToNed(origin, r.a), latLonToNed(origin, r.b)])];
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (i < routes.length) expect(segSegDist(segs[i][0], segs[i][1], segs[j][0], segs[j][1])).toBeGreaterThanOrEqual(300);
    for (let t = 0; t < 7200; t += 37) {
      const ships = [...contactsLocal(t, origin), ...trafficAt(t, routes, origin)];
      for (let i = 0; i < ships.length; i++) for (let j = i + 1; j < ships.length; j++) expect(Math.hypot(ships[i].n - ships[j].n, ships[i].e - ships[j].e)).toBeGreaterThan(250);
    }
  });

  it('mesma posição geográfica em qualquer origem (mapa × 3D) e contatos fixos inalterados', () => {
    const routes = buildTraffic(OFFSHORE_ORIGIN, 5, () => 300);
    const a = trafficAt(1234, routes, OFFSHORE_ORIGIN);
    const b = trafficAt(1234, routes, DEFAULT_ORIGIN);
    a.forEach((s, i) => {
      expect(Math.abs(s.lat - b[i].lat) * 111_000).toBeLessThan(1);
      expect(Math.abs(s.lon - b[i].lon) * 111_000).toBeLessThan(1);
      expect(s.course).toBeCloseTo(b[i].course, 6);
    });
    expect(contactsAt(0).map((c) => c.id)).toEqual(['M1', 'M2', 'P1', 'R1', 'N1']);
  });
});
