/**
 * COSTA (Sepetiba): dados embutidos, orla na física, transição do fundo e
 * compatibilidade (cenários antigos e arquivos salvos sem costa).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { coastSignedDistance, coastLandHeight } from '../src/sim/environment/coast';
import { Environment, defaultEnvironment } from '../src/sim/environment/environment';
import { buildScenario, SCENARIOS } from '../src/sim/scenarios';
import { deserializeEngine } from '../src/sim/persistence';
import { latLonToNed, DEFAULT_ORIGIN } from '../src/sim/geo';
import { defaultSimConfig } from '../src/sim/config/defaultVessel';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

describe('Costa: dados embutidos (sem internet)', () => {
  it('reconhece terra, mar e a Restinga da Marambaia', () => {
    expect(coastSignedDistance(-22.865, -43.775)).toBeLessThan(-300); // Itaguaí (continente)
    expect(coastLandHeight(-22.865, -43.775, coastSignedDistance(-22.865, -43.775))).toBeGreaterThan(5);
    expect(coastSignedDistance(-22.98, -43.85)).toBeGreaterThan(2000); // meio da baía
    expect(coastSignedDistance(-23.3, -43.85)).toBeGreaterThan(10000); // mar aberto ao sul (fora da grade)
    expect(coastSignedDistance(-23.0655, -43.8)).toBeLessThanOrEqual(25); // restinga (faixa estreita)
    expect(coastSignedDistance(-23.04, -43.8)).toBeGreaterThan(0); // baía ao norte da restinga
    expect(coastSignedDistance(-23.09, -43.8)).toBeGreaterThan(0); // mar ao sul da restinga
  });
});

describe('Costa: fundo e terra na física', () => {
  const env = new Environment({ ...defaultEnvironment(), geo: { origin: DEFAULT_ORIGIN, coast: true, shelfWidth: 1000 } });

  it('longe da orla = fundo configurado; em terra acima d’água', () => {
    const center = latLonToNed(DEFAULT_ORIGIN, { lat: -22.98, lon: -43.85 });
    expect(env.bottomDepthAt(center.n, center.e)).toBe(300);
    const land = latLonToNed(DEFAULT_ORIGIN, { lat: -22.865, lon: -43.775 });
    expect(env.bottomDepthAt(land.n, land.e)).toBeLessThan(-5);
  });

  it('transição contínua do mar até a terra (sem degraus)', () => {
    // linha de 3 km do meio da baía até o continente ao norte da base
    const a = latLonToNed(DEFAULT_ORIGIN, { lat: -22.96, lon: -43.8368 });
    const b = latLonToNed(DEFAULT_ORIGIN, { lat: -22.915, lon: -43.8368 });
    let prev = env.bottomDepthAt(a.n, a.e);
    let maxJump = 0;
    let crossed = false;
    for (let i = 1; i <= 500; i++) {
      const f = i / 500;
      const d = env.bottomDepthAt(a.n + (b.n - a.n) * f, a.e + (b.e - a.e) * f);
      maxJump = Math.max(maxJump, Math.abs(d - prev));
      if (prev > 0 && d <= 0) crossed = true;
      prev = d;
    }
    expect(crossed).toBe(true);
    expect(maxJump).toBeLessThan(12); // passos de 10 m: declive < ~50°
  });

  it('cenários existentes e sessões novas: costa desligada (mar aberto como antes)', () => {
    expect(defaultSimConfig().environment.geo?.coast).toBe(false);
    // cenários costeiros (acrescentados): Sepetiba e Rio de Janeiro
    const costeiros = ['base_itaguai', 'restinga', 'baia_guanabara', 'orla_copacabana'];
    for (const sc of SCENARIOS.filter((x) => !costeiros.includes(x.id))) {
      const e = buildScenario(sc.id);
      expect(e.env.coastDistanceAt(0, 0)).toBeNull();
    }
  });

  it('arquivos salvos antigos (sem referência geográfica) ficam sem costa', () => {
    const e = deserializeEngine(fixture('estado-v1-submerso50.json'));
    expect(e.config.environment.geo).toBeUndefined();
    expect(e.env.coastDistanceAt(0, 0)).toBeNull();
  });
});

describe('Cenários costeiros (acrescentados)', () => {
  it('Saída da base: flutua na bacia do estaleiro, sem contato, fundo dragado sob o casco', () => {
    const e = buildScenario('base_itaguai');
    e.advanceSim(60);
    expect(e.state.contact).toBe(false);
    expect(e.outputs.surfaced).toBe(true);
    expect(e.outputs.bottomDepth).toBeGreaterThanOrEqual(16);
    expect(e.outputs.altitude).toBeGreaterThan(10); // sem alarme crítico de fundo
    expect(e.state.alarms.runtime.BOTTOM_CRIT?.active ?? false).toBe(false);
    const d = e.env.coastDistanceAt(e.state.body.pos.x, e.state.body.pos.y)!;
    expect(d).toBeGreaterThan(150); // longe dos cais e quebra-mares
  });

  it('Restinga: o fundo sobe e o alarme de aproximação dispara antes do contato', () => {
    const e = buildScenario('restinga');
    let warnAt = -1;
    let contactAt = -1;
    const z0 = e.outputs.bottomDepth;
    for (let k = 0; k < 2400 && contactAt < 0; k++) {
      e.advanceSim(1);
      if (warnAt < 0 && e.state.alarms.runtime.BOTTOM_WARN?.active) warnAt = e.state.t;
      if (e.state.contact) contactAt = e.state.t;
    }
    expect(z0).toBeGreaterThan(250);
    expect(warnAt).toBeGreaterThan(0);
    expect(contactAt).toBeGreaterThan(warnAt + 30); // pelo menos 30 s de aviso
  });
});
