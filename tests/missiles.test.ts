/**
 * MÍSSIL SM39 (Exocet na cápsula VSM): troca de arma, peso compensado, voo completo (cápsula → superfície →
 * separação → acelerador → cruzeiro → autodiretor → impacto), exercício, alvo em terra e submarino na superfície.
 */
import { describe, it, expect } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import type { SimulationEngine } from '../src/sim/core/engine';
import type { MissilePhase } from '../src/sim/core/state';
import { weaponsWeight } from '../src/sim/systems/weapons';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function runAsync(e: SimulationEngine, s: number, until?: () => boolean, each?: () => void): Promise<void> {
  const n = Math.round(s / e.config.settings.dt);
  for (let i = 0; i < n; i++) {
    e.step();
    each?.();
    if (until?.()) return;
    if (i % 500 === 499) await tick();
  }
}
const last = (e: SimulationEngine) => e.state.commands.at(-1)?.text ?? '';
const fire = { speed: 'alta' as const, depth: 30, course: null };

describe('míssil SM39', () => {
  it('cenário: tubos 5 e 6 com o SM39, fragata a 28 km; o peso inicial é o de projeto', () => {
    const e = buildScenario('ataque_exocet');
    const ws = e.state.weapons!;
    expect(ws.tubes.map((t) => t.kind ?? 'f21')).toEqual(['f21', 'f21', 'f21', 'f21', 'sm39', 'sm39']);
    expect(ws.reserveSm39).toBe(2);
    expect(ws.hostiles?.[0]?.type).toBe('fragata');
    expect(ws.awcRef).toBeCloseTo(weaponsWeight(e.vessel.weapons!, ws), 3);
  });

  it('combate contra a fragata: todas as fases, impacto, explosão e incêndio', async () => {
    const e = buildScenario('ataque_exocet');
    const ws = e.state.weapons!;
    const f = ws.hostiles![0];
    const m0 = e.outputs.mp.mass;
    applyCommand(e, { type: 'tube', tube: 5, action: 'disparar', presets: { target: f.id, warhead: 'combate', ...fire } });
    expect(last(e)).not.toMatch(/recusad/);
    const seen = new Set<MissilePhase>();
    let maxAlt = 0;
    let skim = Infinity;
    await runAsync(
      e,
      400,
      () => !!ws.missiles?.[0] && ws.missiles[0].phase === 'impacto',
      () => {
        const r = ws.missiles?.[0];
        if (!r) return;
        seen.add(r.phase);
        if (r.phase === 'cruzeiro' || r.phase === 'acelerador') maxAlt = Math.max(maxAlt, -r.d);
        if (r.phase === 'terminal') skim = Math.min(skim, -r.d);
      },
    );
    const r = ws.missiles![0];
    for (const p of ['capsula', 'superficie', 'separacao', 'acelerador', 'cruzeiro', 'busca', 'terminal', 'impacto'] as MissilePhase[]) expect(seen.has(p), p).toBe(true);
    expect(r.vsm.tBreach).not.toBeNull();
    expect(r.vsm.tNose).not.toBeNull();
    expect(r.hit?.target).toBe(f.id);
    expect(f.tHit).not.toBeNull();
    // um míssil de combate destrói a fragata
    expect(f.damage).toBeGreaterThanOrEqual(1);
    expect(f.sunk).not.toBeNull();
    expect((ws.explosions ?? []).some((x) => x.kind === 'missil')).toBe(true);
    expect(maxAlt).toBeLessThan(80);
    expect(skim).toBeLessThan(8);
    expect(skim).toBeGreaterThan(1);
    // ~ 28 km a Mach 0,9: menos de 3 min do disparo ao impacto
    expect(r.tPhase - r.tFire).toBeLessThan(170);
    // a fragata para depois do impacto; a cápsula caiu no mar
    await runAsync(e, 150);
    expect(f.speed).toBeLessThan(2);
    expect(r.vsm.tSplash).not.toBeNull();
    // compensação automática repõe o peso (a cápsula pesa 1345 kg)
    expect(Math.abs(e.outputs.mp.mass - m0)).toBeLessThan(80);
  });

  it('um impacto de combate destrói a fragata: ela afunda', async () => {
    const e = buildScenario('ataque_exocet');
    const ws = e.state.weapons!;
    const f = ws.hostiles![0];
    applyCommand(e, { type: 'tube', tube: 5, action: 'disparar', presets: { target: f.id, warhead: 'combate', ...fire } });
    await runAsync(e, 600, () => f.sunk !== null);
    expect(f.sunk).not.toBeNull();
    expect(ws.missiles!.filter((r) => r.phase === 'impacto')).toHaveLength(1);
    await runAsync(e, 200);
    expect(f.sink).toBeGreaterThan(3);
  });

  it('exercício: sai da rota de colisão e cai no mar ao lado da fragata, sem explosão nem dano', async () => {
    const e = buildScenario('ataque_exocet');
    const ws = e.state.weapons!;
    const f = ws.hostiles![0];
    applyCommand(e, { type: 'tube', tube: 6, action: 'disparar', presets: { target: f.id, warhead: 'exercicio', ...fire } });
    const seen = new Set<MissilePhase>();
    await runAsync(
      e,
      400,
      () => ws.missiles?.[0]?.phase === 'perdido',
      () => {
        const r = ws.missiles?.[0];
        if (r) seen.add(r.phase);
      },
    );
    const r = ws.missiles![0];
    expect(seen.has('passagem')).toBe(true);
    expect(r.phase).toBe('perdido');
    expect(r.d).toBe(0);
    expect(r.hit?.target).toBe(f.id);
    // caiu no mar perto do costado (≈ 40 m), sem tocar no navio
    expect(r.hit!.dist).toBeGreaterThan(10);
    expect(r.hit!.dist).toBeLessThan(120);
    expect(r.endReason).toMatch(/caiu no mar a \d+ m do costado/);
    expect(ws.explosions ?? []).toHaveLength(0);
    expect(f.hits).toBe(1);
    expect(f.damage).toBe(0);
    expect(f.sunk).toBeNull();
    expect(f.tHit).toBeNull();
  });

  it('combate só contra alvo hostil; submarino submerso recusado', () => {
    const e = buildScenario('ataque_exocet');
    applyCommand(e, { type: 'enemy', action: 'add', range: 5000, bearing: 0, depth: 60, speed: 2 });
    const x = e.state.weapons!.enemies![0];
    applyCommand(e, { type: 'tube', tube: 5, action: 'disparar', presets: { target: x.id, warhead: 'combate' } });
    expect(last(e)).toMatch(/recusado — o míssil só atinge um submarino inimigo na superfície/);
  });

  it('submarino inimigo na superfície: atingido e afundado', async () => {
    const e = buildScenario('ataque_exocet');
    applyCommand(e, { type: 'enemy', action: 'add', range: 12000, bearing: 0, depth: 0, speed: 3 });
    const x = e.state.weapons!.enemies![0];
    expect(x.d).toBeLessThan(3);
    applyCommand(e, { type: 'tube', tube: 5, action: 'disparar', presets: { target: x.id, warhead: 'combate' } });
    await runAsync(e, 300, () => x.sunk !== null);
    expect(x.sunk).not.toBeNull();
  });

  it('alvo em terra: voo por pontos, subida, mergulho e destruição', async () => {
    const e = buildScenario('exocet_terra');
    const ws = e.state.weapons!;
    const h = ws.hostiles!.find((k) => k.type === 'terra')!;
    expect(h).toBeTruthy();
    expect(h.ground).toBeGreaterThan(0);
    applyCommand(e, { type: 'tube', tube: 5, action: 'disparar', presets: { target: h.id, warhead: 'combate' } });
    const seen = new Set<MissilePhase>();
    await runAsync(
      e,
      300,
      () => h.sunk !== null || ws.missiles?.[0]?.phase === 'perdido',
      () => {
        const r = ws.missiles?.[0];
        if (r) seen.add(r.phase);
      },
    );
    expect(seen.has('mergulho')).toBe(true);
    expect(h.sunk).not.toBeNull();
  });

  it('alvo em terra no exercício: cai ao lado da instalação, que fica inteira', async () => {
    const e = buildScenario('exocet_terra');
    const ws = e.state.weapons!;
    const h = ws.hostiles!.find((k) => k.type === 'terra')!;
    applyCommand(e, { type: 'tube', tube: 5, action: 'disparar', presets: { target: h.id, warhead: 'exercicio' } });
    await runAsync(e, 300, () => ws.missiles?.[0]?.phase === 'perdido');
    const r = ws.missiles![0];
    expect(r.phase).toBe('perdido');
    expect(r.hit?.target).toBe(h.id);
    expect(r.hit!.dist).toBeLessThan(150);
    expect(h.sunk).toBeNull();
    expect(h.hits).toBe(1);
    expect(ws.explosions ?? []).toHaveLength(0);
  });

  it('troca de arma: o F21 volta à reserva e o SM39 entra no tubo', async () => {
    const e = buildScenario('submerso_50');
    const ws = e.state.weapons!;
    const r0 = ws.reserve;
    applyCommand(e, { type: 'tube', tube: 1, action: 'trocar', presets: { load: 'sm39' } });
    expect(last(e)).not.toMatch(/recusad/);
    // troca rápida: poucos segundos
    await runAsync(e, 6);
    expect(ws.tubes[0].kind).toBe('sm39');
    expect(ws.tubes[0].weapon).toBe(true);
    expect(ws.reserve).toBe(r0 + 1);
    expect(ws.reserveSm39).toBe(1);
    expect(Math.abs(ws.awcRef - weaponsWeight(e.vessel.weapons!, ws))).toBeLessThan(5);
  });

  it('lançado da superfície: a cápsula empina, o míssil separa a ~20 m e não cai no mar', async () => {
    for (const sc of ['superficie', 'superficie_avante']) {
      const e = buildScenario(sc);
      const ws = e.state.weapons!;
      applyCommand(e, { type: 'tube', tube: 1, action: 'trocar', presets: { load: 'sm39' } });
      await runAsync(e, 6);
      applyCommand(e, { type: 'hostile', action: 'add', kind: 'fragata', range: 15000, bearing: 0, speed: 5 });
      const f = ws.hostiles![0];
      applyCommand(e, { type: 'tube', tube: 1, action: 'disparar', presets: { target: f.id, warhead: 'combate', ...fire } });
      let sepAlt = 0;
      await runAsync(
        e,
        400,
        () => ['impacto', 'perdido'].includes(ws.missiles?.[0]?.phase ?? ''),
        () => {
          const r = ws.missiles?.[0];
          if (r?.phase === 'separacao' && !sepAlt) sepAlt = -r.d;
        },
      );
      expect(sepAlt, sc).toBeGreaterThan(15);
      expect(ws.missiles![0].phase, sc).toBe('impacto');
    }
  });

  it('troca recusada com a porta da boca aberta', () => {
    const e = buildScenario('submerso_50');
    e.state.weapons!.tubes[0].door.pos = 1;
    applyCommand(e, { type: 'tube', tube: 1, action: 'trocar', presets: { load: 'sm39' } });
    expect(last(e)).toMatch(/recusado — porta da boca aberta/);
  });

  it('alvo em terra recusado sem costa', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'hostile', action: 'add', kind: 'terra', range: 5000, bearing: 0 });
    expect(last(e)).toMatch(/recusado — nenhuma terra/);
  });
});
