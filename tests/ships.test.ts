/**
 * NAVIOS NO 3D × MESA TÁTICA: cada navio desenhado corresponde ao mesmo
 * contato do mapa (mesma posição geográfica, rumo e velocidade), qualquer
 * que seja a origem geográfica escolhida para o submarino.
 */
import { describe, it, expect } from 'vitest';
import { contactsAt, contactsLocal, nedToLatLon, DEFAULT_ORIGIN, OFFSHORE_ORIGIN } from '../src/sim/geo';
import { modelFor, ShipsLayer } from '../src/render3d/Ships';
import { buildScenario } from '../src/sim/scenarios';
import type { Contact } from '../src/sim/geo';

describe('Navios da mesa tática no cenário 3D', () => {
  for (const origin of [DEFAULT_ORIGIN, OFFSHORE_ORIGIN, { lat: -23.1, lon: -44.05 }]) {
    it(`posição local → mesma latitude/longitude do mapa (origem ${origin.lat}, ${origin.lon})`, () => {
      for (const t of [0, 1234, 98765]) {
        const map = contactsAt(t);
        const loc = contactsLocal(t, origin);
        expect(loc.map((c) => c.id)).toEqual(map.map((c) => c.id));
        loc.forEach((c, i) => {
          const m = map[i];
          const llMap = nedToLatLon(DEFAULT_ORIGIN, m.n, m.e);
          const ll3d = nedToLatLon(origin, c.n, c.e);
          // < 1 m de diferença (aproximação de plano tangente local)
          expect(Math.abs(ll3d.lat - llMap.lat) * 111_000).toBeLessThan(1);
          expect(Math.abs(ll3d.lon - llMap.lon) * 111_000 * Math.cos((llMap.lat * Math.PI) / 180)).toBeLessThan(1);
          expect(c.course).toBe(m.course);
          expect(c.speed).toBe(m.speed);
        });
      }
    });
  }
  it('cada tipo de contato tem um modelo 3D', () => {
    const models = contactsAt(0).map((c) => modelFor(c));
    expect(models).toEqual(['graneleiro', 'conteineiro', 'pesqueiro', 'rebocador', 'rebocador', 'rebocador', 'rebocador', 'patrulha']);
  });
  it('o mesmo id que passa a ser outro tipo de navio troca o modelo 3D (tráfego sorteado de novo)', () => {
    const e = buildScenario('superficie');
    const layer = new ShipsLayer();
    const proj = () => ({ x: 0, y: 0, visible: true });
    const ship = (kind: Contact['kind'], name: string): Contact => ({ id: 'T01', name, kind, n: 300, e: 300, course: 0, speed: 2 });
    const lengthOf = () => {
      let L = 0;
      layer.group.traverse((o) => {
        if (o.visible && o.userData.length && o.parent === layer.group) L = Math.max(L, o.userData.length as number);
      });
      return L;
    };
    const upd = (c: Contact) => layer.update(e, 0, 0, 0, OFFSHORE_ORIGIN, 12, true, null, proj, [c]);
    upd(ship('mercante', 'Graneleiro 1 (fictício)'));
    const big = lengthOf();
    upd(ship('rebocador', 'Rebocador 1 (fictício)'));
    const small = lengthOf();
    expect(big).toBeGreaterThan(100);
    expect(small).toBeLessThan(60);
    expect(layer.group.children.filter((g) => g.userData.length).length).toBeLessThanOrEqual(contactsAt(0).length + 1);
  });
});
