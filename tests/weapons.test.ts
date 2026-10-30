/**
 * TUBOS LANÇADORES E TORPEDOS (src/sim/systems/weapons.ts): sequência de lançamento com os
 * intertravamentos, balanço de massa, compensação automática (peso e trim), reação da ejeção,
 * corrida guiada até o alvo (tiro de exercício), recarga a partir da reserva e estados antigos.
 */
import { describe, it, expect } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { SimulationEngine } from '../src/sim/core/engine';
import { createState } from '../src/sim/core/initialState';
import { defaultSimConfig } from '../src/sim/config/defaultVessel';
import { tubeView, tubeSteps, weaponsWeight, weaponTargets, interceptCourse } from '../src/sim/systems/weapons';
import { makeDepthOf } from '../src/sim/core/context';
import { qToMat3 } from '../src/sim/core/math';
import { DEFAULT_ORIGIN } from '../src/sim/geo';

const run = (e: SimulationEngine, s: number, each?: () => void) => {
  for (let i = 0; i < s / e.config.settings.dt; i++) {
    e.step();
    each?.();
  }
};
const view = (e: SimulationEngine, i: number) =>
  tubeView(e.vessel, e.state, { env: e.env, depthOf: makeDepthOf(e.state.body.pos, qToMat3(e.state.body.quat)), rhoLocal: e.env.densityAt(e.state.body.pos.z) }, e.geom.radiusAt, i);
const last = (e: SimulationEngine) => e.state.commands.at(-1)?.text ?? '';
const nearest = (e: SimulationEngine) => {
  const p = e.state.body.pos;
  return weaponTargets(e.env, e.env.cfg.geo?.origin ?? DEFAULT_ORIGIN, e.state.t, 0).sort((a, b) => Math.hypot(a.n - p.x, a.e - p.y) - Math.hypot(b.n - p.x, b.e - p.y))[0];
};

describe('tubos lançadores: condição inicial', () => {
  it('seis armas nos tubos, duas na reserva e a mesma massa e o mesmo G do navio sem o sistema de armas', () => {
    const e = buildScenario('submerso_50');
    const ws = e.state.weapons!;
    expect(ws.tubes.filter((t) => t.weapon).length).toBe(6);
    expect(ws.reserve).toBe(2);
    expect(e.outputs.massAudit).toBeCloseTo(0, 6);
    // o mesmo navio sem tubos (os 9,6 t das armas de volta à carga de armamento): mesma condição de projeto
    const cfg = defaultSimConfig();
    delete cfg.vessel.weapons;
    cfg.vessel.mass.variableLoads.find((l) => l.id === 'arm')!.mass = 14000;
    const old = new SimulationEngine(cfg, createState(cfg, { depth: 46.9, heading: 0, speed: 3 }, 'x', true));
    const now = new SimulationEngine(defaultSimConfig(), createState(defaultSimConfig(), { depth: 46.9, heading: 0, speed: 3 }, 'x', true));
    expect(now.outputs.mp.mass).toBeCloseTo(old.outputs.mp.mass, 3);
    expect(now.outputs.mp.cg.x).toBeCloseTo(old.outputs.mp.cg.x, 6);
    expect(now.outputs.mp.cg.z).toBeCloseTo(old.outputs.mp.cg.z, 6);
  });

  it('estado antigo sem armas abre com os tubos carregados', () => {
    const e = buildScenario('submerso_50');
    const s = JSON.parse(JSON.stringify(e.state));
    delete s.weapons;
    const e2 = new SimulationEngine(e.config, s);
    expect(e2.state.weapons?.tubes.length).toBe(6);
    expect(e2.state.weapons?.reserve).toBe(2);
  });
});

describe('sequência de lançamento e intertravamentos', () => {
  it('porta só abre equalizada, culatra só com o tubo seco; recusas ficam no histórico', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'tube', tube: 1, action: 'abrirPorta' });
    expect(last(e)).toMatch(/recusado — tubo não equalizado/);
    applyCommand(e, { type: 'tube', tube: 1, action: 'equalizar' });
    expect(last(e)).toMatch(/recusado — tubo não está alagado/);
    applyCommand(e, { type: 'tube', tube: 1, action: 'alagar' });
    run(e, 70);
    expect(view(e, 0).flooded).toBe(true);
    applyCommand(e, { type: 'tube', tube: 1, action: 'abrirCulatra' });
    expect(last(e)).toMatch(/recusado — tubo com água/);
    applyCommand(e, { type: 'tube', tube: 1, action: 'equalizar' });
    run(e, 15);
    expect(view(e, 0).equalized).toBe(true);
    applyCommand(e, { type: 'tube', tube: 1, action: 'abrirPorta' });
    run(e, 14);
    expect(view(e, 0).ready).toBe(false); // arma ainda não alimentada
    applyCommand(e, { type: 'tube', tube: 1, action: 'alimentar' });
    expect(view(e, 0).ready).toBe(true);
    applyCommand(e, { type: 'tube', tube: 1, action: 'recarregar' });
    expect(last(e)).toMatch(/recusado — já há arma no tubo/);
  });

  it('"preparar e disparar": alagar, equalizar, abrir a porta, ejetar; massa conservada e peso compensado', () => {
    const e = buildScenario('submerso_50');
    const ws = e.state.weapons!;
    const ref = ws.awcRef;
    applyCommand(e, { type: 'tube', tube: 2, action: 'disparar' });
    let worstAudit = 0;
    let launchF = 0;
    let fired = -1;
    run(e, 200, () => {
      worstAudit = Math.max(worstAudit, Math.abs(e.outputs.massAudit));
      launchF = Math.min(launchF, e.outputs.forces.launch.F.x);
      if (fired < 0 && ws.fired === 1) fired = e.state.t;
    });
    const log = e.state.commands.filter((c) => c.group === 'Armas').map((c) => c.text);
    const idx = (re: RegExp) => log.findIndex((t) => re.test(t));
    expect(idx(/alagando/)).toBeGreaterThan(-1);
    expect(idx(/equalizando/)).toBeGreaterThan(idx(/alagando/));
    expect(idx(/abrindo a porta/)).toBeGreaterThan(idx(/equalizando/));
    expect(idx(/FOGO/)).toBeGreaterThan(idx(/abrindo a porta/));
    expect(idx(/arma fora do tubo/)).toBeGreaterThan(idx(/FOGO/));
    // sequência leva perto de um minuto e meio; ejeção ≈ 13 m/s
    expect(fired).toBeGreaterThan(60);
    expect(fired).toBeLessThan(110);
    expect(ws.tubes[1].weapon).toBe(false);
    expect(ws.runs[0].speed).toBeGreaterThan(12);
    // reação da ejeção empurra o submarino para ré
    expect(launchF).toBeLessThan(-1e4);
    expect(e.outputs.forces.launch.F.x).toBe(0);
    // balanço de massa (arma saiu, mar entrou no tubo, compensação admitiu a diferença)
    expect(worstAudit).toBeLessThan(1e-3);
    expect(e.state.ledger.weaponsOut).toBe(1600);
    expect(Math.abs(weaponsWeight(e.vessel.weapons!, ws) - ref)).toBeLessThan(1);
    // trim corrigido automaticamente: o submarino volta perto de 0°
    run(e, 150);
    expect(Math.abs(e.outputs.euler.pitch)).toBeLessThan(0.2);
  });

  it('sem ar na garrafa de lançamento o disparo é recusado', () => {
    const e = buildScenario('submerso_50');
    e.state.weapons!.tubes[0].flask = 1;
    for (const b of e.vessel.hpAir.banks) e.state.hpAir.banks[b.id].mass = 0.001;
    applyCommand(e, { type: 'tube', tube: 1, action: 'disparar' });
    run(e, 110);
    expect(e.state.weapons!.fired).toBe(0);
    expect(e.state.commands.some((c) => /garrafa de lançamento abaixo/.test(c.text))).toBe(true);
  });

  it('sem hidráulica a porta da boca não abre', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'failure', target: 'hydraulics', active: true });
    applyCommand(e, { type: 'tube', tube: 1, action: 'preparar' });
    run(e, 120);
    expect(e.state.weapons!.tubes[0].door.pos).toBe(0);
  });
});

describe('corrida do torpedo (tiro de exercício)', () => {
  it('guiado pelo fio até o contato mais próximo: aquisição, acerto (passa sob o alvo) e flutuação', () => {
    const e = buildScenario('submerso_50');
    const tg = nearest(e);
    applyCommand(e, { type: 'tube', tube: 1, action: 'disparar', presets: { target: tg.id, speed: 'alta', depth: 30 } });
    const phases = new Set<string>();
    run(e, 900, () => {
      const r = e.state.weapons!.runs[0];
      if (r) phases.add(r.phase);
    });
    const r = e.state.weapons!.runs[0];
    expect([...phases]).toEqual(expect.arrayContaining(['afastamento', 'guiado', 'ataque', 'flutuando', 'recolher']));
    expect(r.hit?.target).toBe(tg.id);
    expect(r.hit!.dist).toBeLessThan(e.vessel.weapons!.weapon.hitRadius);
    expect(r.hit!.depth).toBeGreaterThan(20);
    expect(r.wire).toBe(false);
    expect(r.d).toBeLessThan(0.5);
    applyCommand(e, { type: 'torpedo', id: r.id, action: 'recolher' });
    expect(e.state.weapons!.runs.length).toBe(0);
  });

  it('sem alvo corre no rumo ajustado até acabar a bateria; o fio pode ser cortado', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'tube', tube: 3, action: 'disparar', presets: { target: null, speed: 'alta', depth: 40, course: 90 } });
    run(e, 120);
    const r = e.state.weapons!.runs[0];
    expect(r.phase).toBe('busca');
    expect(Math.abs(r.heading - 90)).toBeLessThan(1);
    expect(r.d).toBeCloseTo(40, 0);
    applyCommand(e, { type: 'torpedo', id: r.id, action: 'cortarFio' });
    expect(r.wire).toBe(false);
    applyCommand(e, { type: 'torpedo', id: r.id, action: 'rumo', course: 180 });
    expect(last(e)).toMatch(/sem fio/);
  });

  it('rumo de interceptação: aponta à frente de um alvo que cruza', () => {
    const c = interceptCourse({ n: 0, e: 0 }, 20, { n: 5000, e: 0, course: 90, speed: 8 });
    expect(c).toBeGreaterThan(15);
    expect(c).toBeLessThan(30);
  });
});

describe('recarga a partir da reserva', () => {
  it('fecha a porta, drena para o TCA, abre a culatra e carrega; massa conservada', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'tube', tube: 4, action: 'disparar' });
    run(e, 120);
    const ws = e.state.weapons!;
    expect(ws.tubes[3].weapon).toBe(false);
    applyCommand(e, { type: 'tube', tube: 4, action: 'recarregar' });
    let worst = 0;
    run(e, 480, () => (worst = Math.max(worst, Math.abs(e.outputs.massAudit))));
    expect(ws.tubes[3].weapon).toBe(true);
    expect(ws.tubes[3].water).toBeLessThan(1);
    expect(ws.tubes[3].breech.pos).toBe(0);
    expect(ws.tubes[3].auto).toBe(null);
    expect(ws.reserve).toBe(1);
    expect(worst).toBeLessThan(1e-3);
    expect(Math.abs(weaponsWeight(e.vessel.weapons!, ws) - ws.awcRef)).toBeLessThan(1);
    // a reserva sai do peso deslocável (carrinho) e entra no tubo
    const reserve = e.outputs.mp.items.find((it) => it.id === 'desl_torpedos')!;
    expect(reserve.mass).toBe(1600);
  });
});

describe('lançamento manual em ordem (etapas com cor)', () => {
  const steps = (e: SimulationEngine) =>
    tubeSteps(e.vessel, e.state, { env: e.env, depthOf: makeDepthOf(e.state.body.pos, qToMat3(e.state.body.quat)), rhoLocal: e.env.densityAt(e.state.body.pos.z) }, e.geom.radiusAt, 0);
  const st = (e: SimulationEngine, a: string) => steps(e).find((x) => x.action === a)!;

  it('só a próxima etapa fica liberada; cada botão verde é aceito pela física e o ciclo completo funciona', () => {
    const e = buildScenario('submerso_50');
    const order = ['alimentar', 'alagar', 'equalizar', 'abrirPorta', 'fogo', 'fecharPorta', 'drenar', 'abrirCulatra', 'carregar', 'fecharCulatra'] as const;
    for (const a of order) {
      // espera a etapa ficar liberada (as anteriores terminam)
      for (let k = 0; k < 400 && st(e, a).state !== 'liberado'; k++) run(e, 1);
      const all = steps(e);
      expect(st(e, a).state, `${a}: ${st(e, a).why ?? ''}`).toBe('liberado');
      // nenhuma outra etapa do mesmo grupo está verde ao mesmo tempo
      expect(all.filter((x) => x.state === 'liberado').map((x) => x.action)).toEqual([a]);
      const n0 = e.state.commands.length;
      applyCommand(e, { type: 'tube', tube: 1, action: a });
      expect(e.state.commands.slice(n0).some((c) => /recusad/.test(c.text))).toBe(false);
      run(e, 1);
    }
    for (let k = 0; k < 30 && e.state.weapons!.tubes[0].breech.pos > 0; k++) run(e, 1);
    const t = e.state.weapons!.tubes[0];
    expect(t.weapon).toBe(true);
    expect(e.state.weapons!.fired).toBe(1);
    expect(st(e, 'alimentar').state).toBe('liberado');
  });

  it('etapa fora de ordem fica vermelha com o motivo; FOGO recusa com o tubo fechado', () => {
    const e = buildScenario('submerso_50');
    expect(st(e, 'equalizar').state).toBe('bloqueado');
    expect(st(e, 'equalizar').why).toMatch(/antes: Alimentar/);
    applyCommand(e, { type: 'tube', tube: 1, action: 'fogo' });
    expect(last(e)).toMatch(/recusado — arma não alimentada/);
  });

  it('no passo a passo, as válvulas fecham sozinhas no fim do alagamento', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'tube', tube: 1, action: 'alagar' });
    run(e, 80);
    const t = e.state.weapons!.tubes[0];
    expect(view(e, 0).flooded).toBe(true);
    expect(t.flood.cmd).toBe(0);
    expect(t.vent.cmd).toBe(0);
  });
});

describe('submarino inimigo e torpedo de combate', () => {
  it('acrescenta o inimigo como alvo; a arma de combate desce à cota dele, explode e ele afunda', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'enemy', action: 'add', range: 2500, bearing: 0, depth: 70, speed: 2 });
    const x = e.state.weapons!.enemies![0];
    expect(x).toBeTruthy();
    const targets = weaponTargets(e.env, e.env.cfg.geo?.origin ?? DEFAULT_ORIGIN, e.state.t, 0, e.state.weapons);
    expect(targets[0].id).toBe(x.id);
    applyCommand(e, { type: 'tube', tube: 1, action: 'disparar', presets: { target: x.id, speed: 'alta', depth: 30, warhead: 'combate' } });
    let boom = false;
    let dAtHit = 0;
    run(e, 400, () => {
      if (!boom && (e.state.weapons!.explosions ?? []).length > 0) [boom, dAtHit] = [true, x.d];
    });
    expect(boom).toBe(true);
    const r = e.state.weapons!.runs[0];
    expect(r.phase).toBe('explodiu');
    expect(r.hit?.target).toBe(x.id);
    expect(Math.abs(r.hit!.depth - dAtHit)).toBeLessThan(13);
    expect(x.sunk).not.toBeNull();
    expect(x.d).toBeGreaterThan(dAtHit + 50);
    // afundado: deixa de ser alvo
    expect(weaponTargets(e.env, DEFAULT_ORIGIN, e.state.t, 0, e.state.weapons).some((c) => c.id === x.id)).toBe(false);
  });

  it('arma de combate recusada contra um contato que não é inimigo', () => {
    const e = buildScenario('submerso_50');
    const c = nearest(e);
    applyCommand(e, { type: 'tube', tube: 1, action: 'disparar', presets: { target: c.id, warhead: 'combate' } });
    expect(last(e)).toMatch(/recusado — arma de combate só contra um submarino inimigo/);
  });

  it('remover e limpar os inimigos ficam no histórico', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'enemy', action: 'add' });
    applyCommand(e, { type: 'enemy', action: 'add', range: 4000, bearing: -40 });
    expect(e.state.weapons!.enemies!.length).toBe(2);
    applyCommand(e, { type: 'enemy', action: 'remove', id: 'INI1' });
    expect(e.state.weapons!.enemies!.map((k) => k.id)).toEqual(['INI2']);
    // id escolhido de fora: recebe o prefixo e continua sendo alvo da arma de combate
    applyCommand(e, { type: 'enemy', action: 'add', id: 'alvo-1' });
    const x = e.state.weapons!.enemies!.at(-1)!;
    expect(x.id).toBe('INI-alvo-1');
    applyCommand(e, { type: 'tube', tube: 1, action: 'preparar', presets: { target: x.id, warhead: 'combate' } });
    expect(last(e)).not.toMatch(/recusado/);
    applyCommand(e, { type: 'enemy', action: 'clear' });
    expect(e.state.weapons!.enemies!.length).toBe(0);
    expect(last(e)).toMatch(/inimigos removidos/);
  });
});
