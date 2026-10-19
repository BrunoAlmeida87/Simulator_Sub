/**
 * Coerência das grandezas mostradas na apresentação (vetores de força,
 * vazões por tanque, indicadores antes do primeiro passo).
 */
import { describe, it, expect } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { verticalBalance, hydroArrows, autoGain } from '../src/sim/forceVectors';
import { tankVolume } from '../src/sim/systems/internalTanks';

describe('Indicadores antes do primeiro avanço', () => {
  it('bateria carregada e barramento energizado mostram tensão e corrente coerentes em t = 0', () => {
    const e = buildScenario('superficie');
    const el = e.state.electrical;
    expect(e.state.t).toBe(0);
    expect(el.energized).toBe(true);
    expect(el.voltage).toBeGreaterThan(400);
    expect(el.current).toBeGreaterThan(0); // cargas de hotel e navegação
    expect(el.totalLoad).toBeGreaterThan(0);
  });
  it('o fechamento do balanço com dt = 0 não altera SoC nem os balanços', () => {
    const e = buildScenario('submerso_50');
    const soc = e.state.electrical.soc;
    const out = e.state.ledger.batteryOut;
    e.primeElectrical();
    expect(e.state.electrical.soc).toBe(soc);
    expect(e.state.ledger.batteryOut).toBe(out);
  });
});

describe('Vetores de peso, empuxo e resultante', () => {
  it('a resultante E − P é a flutuabilidade líquida do motor', () => {
    for (const id of ['superficie', 'submerso_50', 'desajuste']) {
      const e = buildScenario(id);
      e.advanceSim(2);
      const vb = verticalBalance(e);
      expect(vb.netN / vb.g).toBeCloseTo(e.outputs.netBuoyancyKg, 0);
      expect(vb.weightN).toBeCloseTo(vb.massKg * vb.g, 0);
    }
  });

  it('submerso: admitir água aumenta o peso e mantém o empuxo (casco todo imerso)', () => {
    const e = buildScenario('pairando');
    e.advanceSim(1);
    const a = verticalBalance(e);
    applyCommand(e, { type: 'dosing', system: 'compensation', mode: 'admitir', kg: 2000 });
    // mantém a cota (isola o efeito do tanque do efeito da profundidade sobre ρ)
    const z0 = e.state.body.pos.z;
    for (let i = 0; i < 20000; i++) {
      e.step();
      e.state.body.pos.z = z0;
      e.state.body.vel.z = 0;
    }
    e.computeOutputs();
    const b = verticalBalance(e);
    expect(b.immersedFraction).toBeGreaterThan(0.999);
    const dW = (b.weightN - a.weightN) / a.g;
    const dB = (b.buoyancyN - a.buoyancyN) / a.g;
    expect(dW).toBeGreaterThan(1500);
    // na mesma cota o empuxo não muda: só o peso (e a resultante) varia
    expect(Math.abs(dB)).toBeLessThan(0.02 * dW);
    expect(b.compKg - a.compKg).toBeCloseTo(dW, -2);
  });

  it('superfície: alagar os TLP aumenta o peso E o volume imerso', () => {
    const e = buildScenario('superficie');
    e.advanceSim(1);
    const a = verticalBalance(e);
    applyCommand(e, { type: 'mbtVent', tank: 'ALL', open: true });
    e.advanceSim(20);
    const b = verticalBalance(e);
    expect(b.mbtWaterKg).toBeGreaterThan(a.mbtWaterKg + 20000);
    expect(b.weightN).toBeGreaterThan(a.weightN);
    expect(b.displacedM3).toBeGreaterThan(a.displacedM3);
    expect(b.immersedFraction).toBeGreaterThan(a.immersedFraction);
  });

  it('forças hidrodinâmicas: empuxo do hélice para vante e resistência para ré em marcha AV', () => {
    const e = buildScenario('submerso_50');
    e.advanceSim(5);
    const h = hydroArrows(e);
    const prop = h.find((x) => x.id === 'prop')!;
    const drag = h.find((x) => x.id === 'drag')!;
    const R = e.state.body.quat;
    void R;
    // rumo 0 (norte): +x NED é para vante
    expect(prop.forceNED.x).toBeGreaterThan(0);
    expect(drag.forceNED.x).toBeLessThan(0);
    expect(h.some((x) => x.id === 'bow')).toBe(true);
  });

  it('ganho automático da resultante é 1, 2 ou 5 × 10ⁿ', () => {
    const mpn = 14 / 2e7;
    for (const n of [1e2, 3e3, 5e4, 2e6]) {
      const g = autoGain(n, mpn);
      const m = g / Math.pow(10, Math.floor(Math.log10(g)));
      expect([1, 2, 5]).toContain(Math.round(m));
    }
    expect(autoGain(1e9, mpn)).toBe(1);
  });
});

describe('Vazões por tanque (animação de escoamento)', () => {
  it('a vazão diagnóstica da compensação corresponde à variação de volume', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'dosing', system: 'compensation', mode: 'admitir', kg: 3000 });
    e.advanceSim(30);
    const ids = e.vessel.compensation.tanks.map((t) => t.id);
    const v0 = ids.map((id) => tankVolume(e.state.compensation.tanks[id]));
    let integ = ids.map(() => 0);
    for (let i = 0; i < 500; i++) {
      e.step();
      integ = integ.map((x, k) => x + (e.state.compensation.tanks[ids[k]].flow ?? 0) * e.config.settings.dt);
    }
    const v1 = ids.map((id) => tankVolume(e.state.compensation.tanks[id]));
    const tot = integ.reduce((a, b) => a + b, 0);
    expect(tot).toBeGreaterThan(0.05);
    ids.forEach((_, k) => expect(integ[k]).toBeCloseTo(v1[k] - v0[k], 4));
  });
});

import { SimRunner } from '../src/sim/core/runner';
import { ManeuverController } from '../src/ui/maneuvers';
import { ChecklistTracker, PROCEDURE } from '../src/ui/checklist';

describe('Manobras automáticas: etapas, comandos enviados e resultado', () => {
  it('IMERGIR para 50 m termina com SUCESSO, percorrendo as etapas e registrando os comandos', () => {
    const r = new SimRunner(buildScenario('superficie_avante'));
    const m = new ManeuverController();
    m.start(r, 'imergir', 50);
    expect(m.sent.some((c) => /suspiro/i.test(c.text))).toBe(true);
    let maxStep = m.step;
    for (let i = 0; i < 60000 && m.active; i++) {
      r.engine.step();
      m.tick(r);
      maxStep = Math.max(maxStep, m.step);
    }
    expect(m.result?.outcome).toBe('sucesso');
    expect(maxStep).toBe(3);
    expect(Math.abs(r.engine.outputs.depthKeel - 50)).toBeLessThan(2.5);
  });

  it('cancelar registra o resultado CANCELADA', () => {
    const r = new SimRunner(buildScenario('submerso_50'));
    const m = new ManeuverController();
    m.start(r, 'emergir');
    m.cancel(r);
    expect(m.active).toBeNull();
    expect(m.result?.outcome).toBe('cancelada');
  });
});

describe('Checklist do procedimento', () => {
  it('condições verdadeiras no início ficam como "preexistente", não como realizadas', () => {
    const e = buildScenario('submerso_50');
    const c = new ChecklistTracker();
    c.reset(e);
    const pre = c.status.filter((s) => s === 'preexistente').length;
    expect(pre).toBeGreaterThan(2); // TLP alagados, abaixo de 20 m, suspiros fechados, equilíbrio…
    expect(c.status.filter((s) => s === 'realizada').length).toBe(0);
    expect(c.status.length).toBe(PROCEDURE.length);
  });
  it('uma etapa atingida durante a sessão fica "realizada" com o instante', () => {
    const r = new SimRunner(buildScenario('superficie'));
    const c = new ChecklistTracker();
    c.tick(r);
    expect(c.status[1]).toBe('pendente');
    applyCommand(r.engine, { type: 'mbtVent', tank: 'ALL', open: true });
    for (let i = 0; i < 400; i++) {
      r.engine.step();
      c.tick(r);
    }
    expect(c.status[1]).toBe('realizada');
    expect(c.tDone[1]).toBeGreaterThan(0);
  });
});

import { trimBalance } from '../src/sim/forceVectors';

describe('Peso deslocável e trimagem', () => {
  it('na posição neutra não há trim; deslocado para vante, o submarino embica bem visivelmente; o trim compensa', () => {
    const e = buildScenario('pairando');
    e.advanceSim(5);
    expect(Math.abs(e.outputs.euler.pitch)).toBeLessThan(0.5);
    const m0 = e.outputs.mp.internalMass;
    applyCommand(e, { type: 'demoWeight', x: 25 });
    e.advanceSim(120);
    const tb = trimBalance(e);
    expect(tb.demo!.x).toBeCloseTo(25, 5);
    expect(tb.demo!.momentTm).toBeLessThan(-100); // 5 t × 23 m, proa para baixo
    expect(e.outputs.euler.pitch).toBeLessThan(-6); // bem inclinado (proa para baixo)
    expect(e.outputs.mp.internalMass).toBeCloseTo(m0, 3); // só deslocou: massa igual
    // compensação calculada pelos tanques de trim
    expect(tb.compensate.dir).toBe('AtoB');
    expect(tb.compensate.feasible).toBe(true);
    applyCommand(e, { type: 'dosing', system: 'trim', mode: 'transferir', kg: tb.compensate.kg, dir: tb.compensate.dir! });
    e.advanceSim(900);
    const tb2 = trimBalance(e);
    expect(Math.abs(tb2.netTm)).toBeLessThan(0.15 * Math.abs(tb.demo!.momentTm));
    expect(Math.abs(e.outputs.euler.pitch)).toBeLessThan(1.5);
    expect(Math.abs(e.outputs.massAudit)).toBeLessThan(1);
  });

  it('embarcar/desembarcar a carga entra no balanço de massa', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'demoWeight', mass: 8000 });
    e.advanceSim(2);
    expect(Math.abs(e.outputs.massAudit)).toBeLessThan(1);
    expect(e.outputs.netBuoyancyKg).toBeLessThan(-2500);
  });
});

import { TourController, TOURS } from '../src/ui/tours';

describe('Cenário guiado: submergir e descer para 50 m', () => {
  it('percorre todas as etapas pela física e termina equilibrado a 50 m', () => {
    const r = new SimRunner(buildScenario('superficie'));
    const t = new TourController();
    t.start(r, TOURS.find((x) => x.id === 'submergir50')!);
    const dt = r.engine.config.settings.dt;
    let n = 0;
    while (t.active && n < 200000) {
      r.engine.step();
      t.tick(r, dt / r.timeScale);
      n++;
    }
    expect(t.active).toBe(false);
    expect(t.outcome.every((o) => o === 'concluída')).toBe(true);
    expect(Math.abs(r.engine.outputs.depthKeel - 50)).toBeLessThan(2);
    expect(Math.abs(r.engine.outputs.netBuoyancyKg)).toBeLessThan(300);
    expect(t.sent.some((c) => /suspiro/i.test(c.text))).toBe(true);
    // narração sem valores inválidos em todas as etapas
    expect(TOURS[0].steps.every((s) => !/NaN|undefined/.test(s.text(r.engine, { send: () => undefined, mem: {} })))).toBe(true);
  });
});
