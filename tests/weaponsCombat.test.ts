/**
 * SALA DE TORPEDOS: lançamento passo a passo (etapas em ordem com a cor de tubeSteps, a mesma regra dos
 * intertravamentos), submarino inimigo e arma de combate (explosão e afundamento).
 *
 * As corridas longas são feitas em trechos com uma pausa assíncrona entre eles (`runAsync`): o processo do
 * teste devolve a vez ao vitest, que senão espera demais pela resposta do trabalhador em máquinas lentas.
 */
import { describe, it, expect } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import type { SimulationEngine } from '../src/sim/core/engine';
import { tubeSteps, tubeView, weaponTargets } from '../src/sim/systems/weapons';
import { makeDepthOf } from '../src/sim/core/context';
import { qToMat3 } from '../src/sim/core/math';
import { DEFAULT_ORIGIN } from '../src/sim/geo';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
/** avança s segundos de simulação em trechos de 10 s, cedendo a vez entre eles; para quando `until` for verdadeiro */
async function runAsync(e: SimulationEngine, s: number, until?: () => boolean): Promise<void> {
  const n = Math.round(s / e.config.settings.dt);
  for (let i = 0; i < n; i++) {
    e.step();
    if (until?.()) return;
    if (i % 500 === 499) await tick();
  }
}
const run = (e: SimulationEngine, s: number) => {
  for (let i = 0; i < s / e.config.settings.dt; i++) e.step();
};
const sea = (e: SimulationEngine) => ({ env: e.env, depthOf: makeDepthOf(e.state.body.pos, qToMat3(e.state.body.quat)), rhoLocal: e.env.densityAt(e.state.body.pos.z) });
const view = (e: SimulationEngine, i: number) => tubeView(e.vessel, e.state, sea(e), e.geom.radiusAt, i);
const last = (e: SimulationEngine) => e.state.commands.at(-1)?.text ?? '';
const nearest = (e: SimulationEngine) => {
  const p = e.state.body.pos;
  return weaponTargets(e.env, e.env.cfg.geo?.origin ?? DEFAULT_ORIGIN, e.state.t, 0).sort((a, b) => Math.hypot(a.n - p.x, a.e - p.y) - Math.hypot(b.n - p.x, b.e - p.y))[0];
};

describe('lançamento manual em ordem (etapas com cor)', () => {
  const steps = (e: SimulationEngine) => tubeSteps(e.vessel, e.state, sea(e), e.geom.radiusAt, 0);
  const st = (e: SimulationEngine, a: string) => steps(e).find((x) => x.action === a)!;

  it('só a próxima etapa fica liberada; cada botão verde é aceito pela física e o ciclo completo funciona', async () => {
    const e = buildScenario('submerso_50');
    const order = ['alimentar', 'alagar', 'equalizar', 'abrirPorta', 'fogo', 'fecharPorta', 'drenar', 'abrirCulatra', 'carregar', 'fecharCulatra'] as const;
    for (const a of order) {
      // espera a etapa ficar liberada (as anteriores terminam)
      await runAsync(e, 400, () => st(e, a).state === 'liberado');
      const all = steps(e);
      expect(st(e, a).state, `${a}: ${st(e, a).why ?? ''}`).toBe('liberado');
      // nenhuma outra etapa do mesmo grupo está verde ao mesmo tempo
      expect(all.filter((x) => x.state === 'liberado').map((x) => x.action)).toEqual([a]);
      const n0 = e.state.commands.length;
      applyCommand(e, { type: 'tube', tube: 1, action: a });
      expect(e.state.commands.slice(n0).some((c) => /recusad/.test(c.text))).toBe(false);
      run(e, 1);
    }
    await runAsync(e, 30, () => e.state.weapons!.tubes[0].breech.pos <= 0);
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

  it('no passo a passo, as válvulas fecham sozinhas no fim do alagamento', async () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'tube', tube: 1, action: 'alagar' });
    await runAsync(e, 80);
    const t = e.state.weapons!.tubes[0];
    expect(view(e, 0).flooded).toBe(true);
    expect(t.flood.cmd).toBe(0);
    expect(t.vent.cmd).toBe(0);
  });
});

describe('submarino inimigo e torpedo de combate', () => {
  it('acrescenta o inimigo como alvo; a arma de combate desce à cota dele, explode e ele afunda', async () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'enemy', action: 'add', range: 2500, bearing: 0, depth: 70, speed: 2 });
    const x = e.state.weapons!.enemies![0];
    expect(x).toBeTruthy();
    const targets = weaponTargets(e.env, e.env.cfg.geo?.origin ?? DEFAULT_ORIGIN, e.state.t, 0, e.state.weapons);
    expect(targets[0].id).toBe(x.id);
    applyCommand(e, { type: 'tube', tube: 1, action: 'disparar', presets: { target: x.id, speed: 'alta', depth: 30, warhead: 'combate' } });
    await runAsync(e, 400, () => (e.state.weapons!.explosions ?? []).length > 0);
    const boom = (e.state.weapons!.explosions ?? []).length > 0;
    const dAtHit = x.d;
    expect(boom).toBe(true);
    const r = e.state.weapons!.runs[0];
    expect(r.phase).toBe('explodiu');
    expect(r.hit?.target).toBe(x.id);
    expect(Math.abs(r.hit!.depth - dAtHit)).toBeLessThan(13);
    expect(x.sunk).not.toBeNull();
    await runAsync(e, 90);
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
