/**
 * SINALIZAÇÃO PIROTÉCNICA E DE EMERGÊNCIA: fluxo do lançador, inventário, subida, superfície, efeitos,
 * estrela com paraquedas, boia, falhas de treinamento (F01–F07), alarmes e intertravamentos.
 */
import { describe, it, expect } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand, failureCatalog, isFailureActive } from '../src/sim/commands';
import type { SimulationEngine } from '../src/sim/core/engine';
import type { SignalColor, SignalKind } from '../src/sim/config/types';
import { SIGNAL_FAULTS, SIGNAL_KINDS, inUse, signalLight, signalSmoke, signalsCfg, signalsStatus } from '../src/sim/systems/signals';

const run = (e: SimulationEngine, s: number, until?: () => boolean) => {
  const n = Math.round(s / e.config.settings.dt);
  for (let i = 0; i < n; i++) {
    e.step();
    if (until?.()) return;
  }
};
const sig = (e: SimulationEngine) => e.state.signals!;
const log = (e: SimulationEngine) => e.state.commands.filter((c) => c.group === 'Sinalização').map((c) => c.text);

/** selecionar, preparar (espera o PRONTO) e liberar */
function launch(e: SimulationEngine, kind: SignalKind, color?: SignalColor) {
  applyCommand(e, { type: 'signal', action: 'select', kind, color });
  applyCommand(e, { type: 'signal', action: 'prepare' });
  run(e, signalsCfg(e.vessel).prepareTime + 0.1);
  expect(sig(e).launcher.state).toBe('pronto');
  applyCommand(e, { type: 'signal', action: 'release' });
}

describe('sinalização', () => {
  it('estado inicial: inventário da configuração, lançador ocioso, sistema PRONTO', () => {
    const e = buildScenario('submerso_50');
    const ss = sig(e);
    expect(ss.inventory).toEqual(signalsCfg(e.vessel).stock);
    expect(ss.launcher.state).toBe('ocioso');
    expect(signalsStatus(ss, e.state.body.pos.z, signalsCfg(e.vessel)).status).toBe('PRONTO');
    expect(SIGNAL_KINDS).toHaveLength(8);
  });

  it('intertravamentos: não prepara sem seleção, não libera sem PRONTO, cancelar volta a selecionado', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'signal', action: 'prepare' });
    expect(sig(e).launcher.state).toBe('ocioso');
    applyCommand(e, { type: 'signal', action: 'select', kind: 'vermelho' });
    applyCommand(e, { type: 'signal', action: 'release' });
    expect(sig(e).runs).toHaveLength(0);
    applyCommand(e, { type: 'signal', action: 'prepare' });
    expect(sig(e).launcher.state).toBe('preparando');
    applyCommand(e, { type: 'signal', action: 'select', kind: 'verde' });
    expect(sig(e).launcher.kind).toBe('vermelho');
    applyCommand(e, { type: 'signal', action: 'cancel' });
    expect(sig(e).launcher.state).toBe('cancelado');
    run(e, 2.5);
    expect(sig(e).launcher.state).toBe('selecionado');
    expect(sig(e).inventory.vermelho).toBe(4);
  });

  it('sinal vermelho: sai do casco, sobe, chega à superfície, acende luz e fumaça curta e se extingue', () => {
    const e = buildScenario('submerso_50');
    launch(e, 'vermelho');
    const ss = sig(e);
    expect(ss.inventory.vermelho).toBe(3);
    expect(inUse(ss, 'vermelho')).toBe(1);
    const r = ss.runs[0];
    expect(r.d).toBeGreaterThan(40);
    expect(r.d).toBeLessThan(e.state.body.pos.z);
    run(e, 120, () => r.phase === 'superficie');
    expect(r.phase).toBe('superficie');
    // subida de ≈ 45 m a ≈ 1,8 m/s
    expect(r.tSurf! - r.tRel).toBeGreaterThan(18);
    expect(r.tSurf! - r.tRel).toBeLessThan(40);
    expect(Math.abs(r.d + e.env.waves.elevation(r.n, r.e, e.state.t))).toBeLessThan(0.05);
    expect(signalsStatus(ss, e.state.body.pos.z, signalsCfg(e.vessel)).status).toBe('ATIVO');
    run(e, 3);
    expect(r.phase).toBe('ativo');
    expect(signalLight(r, e.state.t)).toBeGreaterThan(0.9);
    expect(signalSmoke(r, e.state.t, signalsCfg(e.vessel))).toBeGreaterThan(0.3);
    run(e, 40);
    expect(signalSmoke(r, e.state.t, signalsCfg(e.vessel))).toBe(0);
    run(e, 120, () => r.phase === 'extinto');
    expect(r.phase).toBe('extinto');
    expect(signalLight(r, e.state.t)).toBe(0);
    const txt = log(e).join('\n');
    for (const w of ['SELECIONADO', 'PREPARANDO', 'PRONTO', 'LIBERADO', 'CHEGOU À SUPERFÍCIE', 'ATIVO', 'EXTINTO']) expect(txt).toContain(w);
  });

  it('o dispositivo é independente do submarino: perde a velocidade dele e fica para ré', () => {
    const e = buildScenario('submerso_50');
    run(e, 1);
    const v0 = Math.hypot(e.outputs.velNED.x, e.outputs.velNED.y);
    launch(e, 'branco');
    const r = sig(e).runs[0];
    run(e, 15);
    const vh = Math.hypot(r.vn, r.ve);
    if (v0 > 1) expect(vh).toBeLessThan(0.5 * v0);
    expect(r.vd).toBeLessThan(-1);
  });

  it('fumaça com cor escolhida e estrela com paraquedas', () => {
    const e = buildScenario('cota_periscopica');
    launch(e, 'fumaca', 'verde');
    expect(sig(e).runs[0].color).toBe('verde');
    run(e, 3);
    launch(e, 'estrela', 'vermelho');
    const st = sig(e).runs[1];
    run(e, 60, () => st.phase === 'ativo');
    expect(st.flare).not.toBeNull();
    let apex = 0;
    run(e, 12, () => {
      apex = Math.max(apex, st.flare?.alt ?? 0);
      return false;
    });
    expect(apex).toBeGreaterThan(80);
    expect(st.flare!.chute).toBe(1);
    expect(st.flare!.vz).toBeLessThan(0);
    expect(signalLight(st, e.state.t)).toBeGreaterThan(0.5);
    run(e, 80, () => st.flare === null);
    expect(st.phase).toBe('extinto');
    expect(st.flare).toBeNull();
  });

  it('boia de emergência: sobe do convés, flutua e transmite; o alarme informativo aparece', () => {
    const e = buildScenario('submerso_50');
    launch(e, 'boia');
    const b = sig(e).runs[0];
    expect(b.id.startsWith('B')).toBe(true);
    expect(sig(e).inventory.boia).toBe(0);
    run(e, 90, () => b.phase === 'ativo');
    expect(b.phase).toBe('ativo');
    expect(b.tx).toBe('ok');
    run(e, 1);
    expect(e.state.alarms.runtime.SIG_BUOY?.active).toBe(true);
    // reabastecer recolhe a boia
    applyCommand(e, { type: 'signal', action: 'restock' });
    expect(sig(e).inventory.boia).toBe(1);
    expect(sig(e).runs.some((r) => r.kind === 'boia')).toBe(false);
  });

  it('profundidade além do máximo de liberação: preparação recusada', () => {
    const e = buildScenario('submerso_50');
    e.state.body.pos.z = signalsCfg(e.vessel).maxDepth + 10;
    applyCommand(e, { type: 'signal', action: 'select', kind: 'amarelo' });
    applyCommand(e, { type: 'signal', action: 'prepare' });
    expect(sig(e).launcher.state).toBe('selecionado');
    expect(log(e).at(-1)).toContain('profundidade');
  });

  it('inventário esgotado: não prepara; manutenção ajusta a quantidade', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'signal', action: 'stock', kind: 'verde', count: 0 });
    applyCommand(e, { type: 'signal', action: 'select', kind: 'verde' });
    applyCommand(e, { type: 'signal', action: 'prepare' });
    expect(sig(e).launcher.state).toBe('selecionado');
    expect(signalsStatus(sig(e), 50, signalsCfg(e.vessel)).status).toBe('DEGRADADO');
    applyCommand(e, { type: 'signal', action: 'stock', kind: 'verde', count: 2 });
    expect(sig(e).inventory.verde).toBe(2);
  });

  it('falhas F01–F07 entram no catálogo comum e mudam o comportamento', () => {
    const e = buildScenario('submerso_50');
    const cat = failureCatalog(e).filter((f) => f.group === 'Sinalização');
    expect(cat.map((f) => f.target)).toEqual(SIGNAL_FAULTS.map((f) => `signal:${f.id}`));
    const fail = (id: string, on = true) => applyCommand(e, { type: 'failure', target: `signal:${id}`, active: on });

    // F01: não libera, lançador em FALHA, alarme; o dispositivo não é gasto
    fail('release');
    expect(isFailureActive(e, 'signal:release')).toBe(true);
    launch(e, 'vermelho');
    expect(sig(e).launcher.state).toBe('falha');
    expect(sig(e).runs).toHaveLength(0);
    expect(sig(e).inventory.vermelho).toBe(4);
    run(e, 0.2);
    expect(e.state.alarms.runtime.SIG_FAULT?.active).toBe(true);
    expect(signalsStatus(sig(e), 50, signalsCfg(e.vessel)).status).toBe('FALHA');
    fail('release', false);
    applyCommand(e, { type: 'signal', action: 'reset' });
    expect(sig(e).launcher.state).toBe('ocioso');

    // F02: para no meio da subida e afunda
    fail('ascent');
    launch(e, 'amarelo');
    const a = sig(e).runs.at(-1)!;
    run(e, 30);
    expect(a.phase).toBe('falha');
    expect(a.fault).toBe('subida');
    expect(a.d).toBeGreaterThan(5);
    fail('ascent', false);

    // F03: chega à superfície e não ativa
    fail('activation');
    launch(e, 'verde');
    const g = sig(e).runs.at(-1)!;
    run(e, 60, () => g.phase === 'falha' || g.phase === 'ativo');
    expect(g.phase).toBe('falha');
    expect(g.tSurf).not.toBeNull();
    expect(signalLight(g, e.state.t)).toBe(0);
    fail('activation', false);

    // F04 + F05: extinção prematura e fumaça degradada
    fail('premature');
    fail('smoke');
    launch(e, 'fumaca');
    const f = sig(e).runs.at(-1)!;
    run(e, 60, () => f.phase === 'ativo');
    expect(f.smokeK).toBeLessThan(0.5);
    expect(f.life).toBeCloseTo(signalsCfg(e.vessel).duration.smoke * signalsCfg(e.vessel).prematureFactor, 6);
    run(e, f.life + 1);
    expect(f.phase).toBe('extinto');
    fail('premature', false);
    fail('smoke', false);

    // F06: a boia não sai
    fail('buoyRelease');
    launch(e, 'boia');
    expect(sig(e).launcher.state).toBe('falha');
    expect(sig(e).inventory.boia).toBe(1);
    fail('buoyRelease', false);
    applyCommand(e, { type: 'signal', action: 'reset' });

    // F07: boia flutua sem transmissão
    fail('buoyTx');
    launch(e, 'boia');
    const b = sig(e).runs.at(-1)!;
    run(e, 90, () => b.phase === 'ativo');
    expect(b.tx).toBe('falha');
    const txt = log(e).join('\n');
    for (const c of ['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07']) expect(txt).toContain(c);
  });

  it('vários dispositivos ao mesmo tempo', () => {
    const e = buildScenario('cota_periscopica');
    for (const k of ['vermelho', 'fumaca', 'combinado', 'estrela'] as SignalKind[]) {
      launch(e, k);
      run(e, 2.2);
    }
    expect(sig(e).runs).toHaveLength(4);
    run(e, 30);
    expect(sig(e).runs.filter((r) => r.phase === 'ativo')).toHaveLength(4);
  });
});
