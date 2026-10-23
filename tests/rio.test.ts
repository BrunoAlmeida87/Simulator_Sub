/**
 * RIO DE JANEIRO: costa da Baía de Guanabara e da orla (máscara da imagem
 * Sentinel-2, relevo Copernicus), cenários e navios. Sepetiba não muda.
 */
import { describe, it, expect } from 'vitest';
import { coastLandHeight, coastRegionAt, coastSignedDistance } from '../src/sim/environment/coast';
import { buildScenario } from '../src/sim/scenarios';
import { contactsAt, contactsLocal, DEFAULT_ORIGIN, nearRio, rioContactsAt, latLonToNed } from '../src/sim/geo';

describe('Costa do Rio de Janeiro', () => {
  it('terra, morros e água nos lugares certos', () => {
    const land: [string, number, number, number][] = [
      ['Corcovado', -22.9519, -43.2105, 300],
      ['Pedra da Gávea', -22.9978, -43.2847, 400],
      ['Pão de Açúcar', -22.9486, -43.1566, 60],
      ['Ilha do Governador', -22.8, -43.2, 3],
    ];
    for (const [, lat, lon, minH] of land) {
      const sd = coastSignedDistance(lat, lon);
      expect(sd).toBeLessThan(0);
      expect(coastLandHeight(lat, lon, sd)).toBeGreaterThan(minH);
      expect(coastRegionAt(lat, lon)).toBe('rio');
    }
    const sea: [string, number, number][] = [
      ['barra da baía', -22.935, -43.142],
      ['fundeadouro', -22.905, -43.152],
      ['mar de Copacabana', -22.985, -43.18],
      ['norte da baía', -22.78, -43.13],
    ];
    for (const [, lat, lon] of sea) expect(coastSignedDistance(lat, lon)).toBeGreaterThan(300);
  });

  it('Sepetiba continua igual (mesma grade e mesma orla)', () => {
    expect(coastRegionAt(-22.9305, -43.8525)).toBe('sepetiba');
    expect(coastSignedDistance(-22.9305, -43.8525)).toBeCloseTo(212, -1);
  });

  it('cenários do Rio: na água, com fundo abaixo da quilha e a costa ligada', () => {
    for (const id of ['baia_guanabara', 'orla_copacabana']) {
      const e = buildScenario(id);
      expect(e.config.environment.geo?.coast).toBe(true);
      expect(nearRio(e.config.environment.geo!.origin)).toBe(true);
      expect(e.outputs.bottomDepth).toBeGreaterThan(e.outputs.depthKeel + 5);
      expect(e.env.coastDistanceAt(0, 0)!).toBeGreaterThan(300);
      e.advanceSim(10);
      expect(Number.isFinite(e.state.body.pos.z)).toBe(true);
    }
  });

  it('navios do Rio sempre na água; perto do Rio as listas usam os navios da Guanabara', () => {
    for (let t = 0; t < 4000; t += 47) {
      for (const c of rioContactsAt(t)) expect(coastSignedDistance(c.lat, c.lon)).toBeGreaterThan(100);
    }
    const rioOrigin = { lat: -22.905, lon: -43.152 };
    const ids = contactsLocal(0, rioOrigin).map((c) => c.id);
    expect(ids).toContain('B1');
    expect(ids).not.toContain('M1');
    // posição local coerente com a geográfica
    const c = contactsLocal(100, rioOrigin)[0];
    const q = latLonToNed(rioOrigin, c);
    expect(Math.hypot(q.n - c.n, q.e - c.e)).toBeLessThan(1);
    // fora do Rio, como antes
    expect(contactsLocal(0, DEFAULT_ORIGIN).map((x) => x.id)).toEqual(contactsAt(0).map((x) => x.id));
  });
});
