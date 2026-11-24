/**
 * Sistemas da Fase 3: atmosfera interna, controle de avarias (esgoto, portas, incêndio), distribuição elétrica,
 * corrente e navegação com correção, discrição (aeronave), ameaça (torpedo e despistador), rebocadores e instrutor.
 */
import { describe, expect, it } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { defaultSimConfig } from '../src/sim/config/defaultVessel';
import { applyCommand, failureCatalog } from '../src/sim/commands';
import { atmosphereEndurance, atmospherePercent, updateAtmosphere } from '../src/sim/systems/atmosphere';
import { bilgeFlow, compartmentMaxWater } from '../src/sim/systems/damage';
import { navError, navUncertainty } from '../src/sim/systems/navigation';
import { counterDetectionRange, indiscretionRatio } from '../src/sim/systems/stealth';
import { mastExposure } from '../src/sim/systems/masts';
import { serializeEngine, deserializeEngine } from '../src/sim/persistence';
import type { SimulationEngine } from '../src/sim/core/engine';

const run = (e: SimulationEngine, sec: number) => {
  for (let i = 0; i < Math.round(sec / e.config.settings.dt); i++) e.step();
};
const sub = (id = 'submerso_50') => buildScenario(id, defaultSimConfig());

describe('atmosfera interna', () => {
  it('começa com o ar normal e o CO₂ sobe sem os absorvedores', () => {
    const e = sub();
    const p0 = atmospherePercent(e.state)!;
    expect(p0.o2).toBeCloseTo(20.95, 1);
    expect(p0.co2).toBeLessThan(0.05);
    const s = e.state;
    s.atmosphere!.scrubbers = false;
    for (let i = 0; i < 3600; i++) updateAtmosphere(e.vessel, s, 1, true);
    const p1 = atmospherePercent(s)!;
    expect(p1.co2).toBeGreaterThan(p0.co2 + 0.05);
    expect(p1.o2).toBeLessThan(p0.o2);
    expect(atmosphereEndurance(e.vessel, s).hours).toBeGreaterThan(1);
  });

  it('absorvedores levam o CO₂ a um equilíbrio; ventilação pelo snorkel restaura o ar', () => {
    const e = sub();
    const s = e.state;
    s.atmosphere!.co2 *= 40; // ~1,6 %
    for (let i = 0; i < 6 * 3600; i++) updateAtmosphere(e.vessel, s, 1, true);
    expect(atmospherePercent(s)!.co2).toBeLessThan(1.6);
    s.snorkel.headValveOpen = true;
    for (let i = 0; i < 1800; i++) updateAtmosphere(e.vessel, s, 1, true);
    expect(atmospherePercent(s)!.co2).toBeLessThan(0.3);
    expect(s.atmosphere!.ach).toBeGreaterThan(0);
  });

  it('a recarga no fim da carga libera H₂ e os queimadores o reduzem', () => {
    const e = sub();
    const s = e.state;
    s.electrical.soc = 0.95;
    s.electrical.current = -1500;
    s.atmosphere!.recombiners = false;
    for (let i = 0; i < 1800; i++) updateAtmosphere(e.vessel, s, 1, true);
    const h = atmospherePercent(s)!.h2;
    expect(h).toBeGreaterThan(0.3);
    s.electrical.current = 0;
    s.atmosphere!.recombiners = true;
    for (let i = 0; i < 3600; i++) updateAtmosphere(e.vessel, s, 1, true);
    expect(atmospherePercent(s)!.h2).toBeLessThan(h);
  });
});

describe('controle de avarias', () => {
  it('bomba de esgoto perde vazão com a profundidade e para abaixo do limite', () => {
    const shut = 12e5;
    expect(bilgeFlow(0.03, shut, 0)).toBeCloseTo(0.03, 6);
    expect(bilgeFlow(0.03, shut, 6e5)).toBeLessThan(bilgeFlow(0.03, shut, 2e5));
    expect(bilgeFlow(0.03, shut, 13e5)).toBe(0);
  });

  it('esgota o alagamento a 50 m com o balanço de massa fechado', () => {
    const e = sub();
    applyCommand(e, { type: 'failure', target: 'flooding:CM', active: true, param: 15 });
    run(e, 40);
    applyCommand(e, { type: 'failure', target: 'flooding:CM', active: false });
    const w0 = e.state.flooding.CM.water;
    expect(w0).toBeGreaterThan(500);
    applyCommand(e, { type: 'bilge', id: 'BE3', on: true });
    run(e, 30);
    expect(e.state.flooding.CM.water).toBeLessThan(w0);
    expect(e.state.ledger.floodOut).toBeGreaterThan(0);
    expect(Math.abs(e.outputs.massAudit)).toBeLessThan(1);
    expect(e.state.electrical.loads.ESG).toBeGreaterThan(0);
  });

  it('porta estanque aberta divide a água acima da soleira sem mudar a massa total', () => {
    const e = sub();
    const cm = e.vessel.compartments.find((c) => c.id === 'CM')!;
    e.state.flooding.CM.water = 0.6 * compartmentMaxWater(e.vessel, cm);
    const total = () => Object.values(e.state.flooding).reduce((a, f) => a + f.water, 0);
    const t0 = total();
    run(e, 5);
    expect(e.state.flooding.CC.water).toBe(0); // porta fechada
    applyCommand(e, { type: 'door', id: 'PE2', open: true });
    run(e, 60);
    expect(e.state.flooding.CC.water).toBeGreaterThan(100);
    expect(total()).toBeCloseTo(t0, 3);
  });

  it('incêndio cresce, é detectado, consome O₂, produz CO e é combatido', () => {
    const e = sub();
    expect(failureCatalog(e).some((f) => f.target === 'fire:CC')).toBe(true);
    applyCommand(e, { type: 'failure', target: 'fire:CC', active: true, param: 5 });
    run(e, 60);
    const f = e.state.damage!.fires.CC;
    expect(f.intensity).toBeGreaterThan(0.05);
    expect(f.detected).toBe(true);
    expect(e.state.alarms.runtime.FIRE.active).toBe(true);
    expect(atmospherePercent(e.state)!.coPpm).toBeGreaterThan(1);
    applyCommand(e, { type: 'fire', compartment: 'CC', fight: true });
    run(e, 60);
    expect(e.state.damage!.fires.CC.intensity).toBe(0);
    expect(e.state.damage!.agent).toBeLessThan(e.vessel.damage!.fire.agent);
  });
});

describe('distribuição elétrica', () => {
  it('disjuntor aberto tira a carga do balanço e o equipamento não funciona', () => {
    const e = sub();
    applyCommand(e, { type: 'loadBreaker', id: 'HID', closed: false });
    run(e, 2);
    expect(e.state.electrical.loads.HID ?? 0).toBe(0);
    applyCommand(e, { type: 'loadBreaker', id: 'MEP', closed: false });
    applyCommand(e, { type: 'telegraph', rpm: 150 });
    run(e, 5);
    expect(Math.abs(e.state.propulsion.motorTorque)).toBeLessThan(1);
  });

  it('a temperatura da bateria sobe com corrente alta', () => {
    const e = sub();
    const t0 = e.state.distribution!.batteryTemp;
    applyCommand(e, { type: 'telegraph', rpm: 220 });
    run(e, 120);
    expect(e.state.distribution!.batteryHeat).toBeGreaterThan(0);
    expect(e.state.distribution!.batteryTemp).not.toBe(t0);
  });
});

describe('corrente e navegação estimada', () => {
  it('a corrente arrasta o submarino e a posição estimada erra; o GPS corrige só com antena fora d’água', () => {
    const e = sub();
    applyCommand(e, { type: 'current', speed: 0.5, direction: 90 });
    const y0 = e.state.body.pos.y;
    run(e, 200);
    expect(e.state.body.pos.y - y0).toBeGreaterThan(70);
    const err = navError(e.state);
    expect(err).toBeGreaterThan(50);
    expect(navUncertainty(e.state)).toBeGreaterThan(10);
    applyCommand(e, { type: 'navFix', now: true });
    expect(navError(e.state)).toBeCloseTo(err, 0); // submerso a 50 m: recusado
    // na superfície a correção vale
    const s2 = sub('superficie');
    applyCommand(s2, { type: 'current', speed: 0.8, direction: 0 });
    run(s2, 120);
    expect(mastExposure(s2.vessel, s2.state, s2.outputs.surfaced).any).toBe(true);
    applyCommand(s2, { type: 'navFix', now: true });
    expect(navError(s2.state)).toBeLessThan(60);
  });

  it('sem corrente o comportamento é o mesmo de antes (velocidade na água = sobre o fundo)', () => {
    const a = sub();
    const b = sub();
    applyCommand(b, { type: 'current', speed: 0 });
    run(a, 20);
    run(b, 20);
    expect(b.state.body.pos.x).toBe(a.state.body.pos.x);
    expect(b.state.body.vel.x).toBe(a.state.body.vel.x);
  });
});

describe('discrição', () => {
  it('a aeronave detecta o submarino exposto na superfície e conta a indiscrição', () => {
    const e = sub('superficie');
    applyCommand(e, { type: 'aircraft', action: 'spawn', range: 5000, bearing: 0 });
    run(e, 300);
    expect(e.state.stealth!.detections).toBeGreaterThan(0);
    expect(indiscretionRatio(e.state)).toBeGreaterThan(0.9);
    expect(e.state.alarms.log.some((l) => l.id === 'AIR_DETECT')).toBe(true);
  });

  it('submerso sem mastros a aeronave não detecta', () => {
    const e = sub();
    applyCommand(e, { type: 'aircraft', action: 'spawn', range: 3000, bearing: 0 });
    run(e, 200);
    expect(e.state.stealth!.detections).toBe(0);
    expect(indiscretionRatio(e.state)).toBe(0);
  });

  it('alcance de contra-detecção cresce com o nível irradiado', () => {
    expect(counterDetectionRange(130, 60, 15, 8)).toBeGreaterThan(counterDetectionRange(115, 60, 15, 8) * 3);
    expect(counterDetectionRange(60, 80, 15, 8)).toBe(0);
  });
});

describe('ameaça: torpedo e despistador', () => {
  it('torpedo com avaria atinge o submarino parado e abre um rombo', () => {
    const e = sub();
    applyCommand(e, { type: 'threat', action: 'launch', range: 3000, bearing: 0, warhead: 'avaria' });
    let tp = e.state.threat!.torpedoes[0];
    for (let i = 0; i < 300 && tp.phase !== 'impacto'; i++) run(e, 1);
    tp = e.state.threat!.torpedoes[0];
    expect(tp.phase).toBe('impacto');
    expect(Object.values(e.state.flooding).some((f) => f.breachArea > 0)).toBe(true);
  });

  it('despistador entre o torpedo e um submarino silencioso seduz a arma', () => {
    const e = sub();
    applyCommand(e, { type: 'telegraph', rpm: 0 });
    applyCommand(e, { type: 'threat', action: 'launch', range: 3000, bearing: 0, warhead: 'exercicio' });
    // despistador a 600 m na direção do torpedo
    e.state.threat!.decoys.push({ id: 'DX', n: e.state.body.pos.x + 600, e: e.state.body.pos.y, d: e.state.body.pos.z, t0: e.state.t });
    let seduced = false;
    for (let i = 0; i < 120 && !seduced; i++) {
      run(e, 1);
      seduced = e.state.threat!.torpedoes[0].phase === 'enganado';
    }
    expect(seduced).toBe(true);
    expect(e.state.commands.some((c) => c.text.includes('seduzido'))).toBe(true);
  });
});

describe('rebocadores', () => {
  it('empurram o casco na superfície e desligam quando o submarino mergulha', () => {
    const e = sub('superficie');
    const y0 = e.state.body.pos.y;
    applyCommand(e, { type: 'tug', id: 'ALL', mode: 'empurrar', side: 'BE', cmd: 1, angle: 0 });
    run(e, 90);
    expect(e.state.tugs!.F.y).toBeLessThan(0); // de boreste para bombordo
    const sideways = Math.abs(e.state.body.pos.y - y0);
    expect(sideways).toBeGreaterThan(1);
    const d = sub();
    applyCommand(d, { type: 'tug', id: 'R1', mode: 'puxar', cmd: 1 });
    run(d, 10);
    expect(d.state.tugs!.tugs.R1.connected).toBe(false);
    expect(d.state.tugs!.tugs.R1.level).toBe(0);
  });
});

describe('instrutor', () => {
  it('dispara um evento por tempo e outro por condição, uma vez cada, e salva com a sessão', () => {
    const e = sub();
    applyCommand(e, { type: 'instructor', action: 'add', event: { label: 'Falha da bomba de trim', at: 3, command: { type: 'failure', target: 'pump:trim', active: true } } });
    applyCommand(e, {
      type: 'instructor',
      action: 'add',
      event: { label: 'Leme travado ao passar de 51 m', cond: { variable: 'depth', op: '>', value: -1 }, command: { type: 'failure', target: 'surface:stern', active: true } },
    });
    const restored = deserializeEngine(serializeEngine(e, 'x'));
    expect(restored.state.instructor!.events.length).toBe(2);
    run(e, 5);
    expect(e.state.trim.pump.failed).toBe(true);
    expect(e.state.instructor!.events.every((x) => x.fired)).toBe(true);
    applyCommand(e, { type: 'failure', target: 'pump:trim', active: false });
    run(e, 2);
    expect(e.state.trim.pump.failed).toBe(false); // não dispara de novo
    expect(e.state.commands.some((c) => c.text.startsWith('INSTRUTOR'))).toBe(true);
  });
});

describe('cenários novos da Fase 3', () => {
  it('avariado no fundo: pousado, pesado, atmosfera degradada e bomba de esgoto sem vazão', () => {
    const e = sub('avaria_fundo');
    run(e, 30);
    expect(e.state.contact).toBe(true);
    expect(atmospherePercent(e.state)!.co2).toBeGreaterThan(2);
    applyCommand(e, { type: 'bilge', id: 'BE3', on: true });
    run(e, 5);
    expect(e.state.damage!.pumps.BE3.flow).toBe(0);
    expect(Math.abs(e.outputs.massAudit)).toBeLessThan(1);
  });

  it('evasão de torpedo: o evento do instrutor lança a arma aos 20 s', () => {
    const e = sub('evasao_torpedo');
    run(e, 21);
    expect(e.state.threat!.torpedoes.length).toBe(1);
    expect(e.state.alarms.runtime.TORPEDO.active).toBe(true);
  });

  it('snorkel sob ameaça aérea e porto com rebocadores começam prontos', () => {
    const a = sub('snorkel_aeronave');
    expect(a.state.stealth!.aircraft).not.toBeNull();
    const p = sub('porto_rebocadores');
    expect(p.state.tugs!.tugs.R1.mode).toBe('empurrar');
    applyCommand(p, { type: 'tug', id: 'ALL', cmd: 0.8 });
    run(p, 40);
    expect(Math.abs(p.state.tugs!.F.y)).toBeGreaterThan(1e4);
    expect(p.state.contact).toBe(false);
  });
});
