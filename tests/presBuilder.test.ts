/**
 * Estúdio de apresentações: texto formatado, valores ao vivo, condições,
 * catálogo de ações, validação de arquivos e execução das apresentações pela física.
 */
import { describe, it, expect } from 'vitest';
import { buildScenario } from '../src/sim/scenarios';
import { SimRunner } from '../src/sim/core/runner';
import { parseRich, plainText } from '../src/ui/presBuilder/richText';
import { fillTemplate, testCondition, describeCondition, unknownPlaceholders, PRES_VARS, readVar, evalConditions } from '../src/ui/presBuilder/variables';
import { ACTION_TYPES, ADVANCED_COMMAND_TYPES, describeAction, runAction, actionProblem, parseCommandJson, type ActionCtx } from '../src/ui/presBuilder/actions';
import { normalizePresentation, newPresentation, newStep, newAction, clonePresentation, presentationProblems, NEXT_END, droneToStep, droneFromStep } from '../src/ui/presBuilder/model';
import { PresPlayer } from '../src/ui/presBuilder/player';
import { submergir50Template, recursosTemplate, BUILTIN_PRESENTATIONS } from '../src/ui/presBuilder/templates';
import { scriptMarkdown, exportText } from '../src/ui/presBuilder/library';
import { serializeEngine } from '../src/sim/persistence';

const ctx0 = { tStep: 0, maneuver: false };

describe('Texto formatado', () => {
  it('negrito, itálico, sublinhado, realce e cores, com estilos aninhados', () => {
    const b = parseRich('Peso **P = [vermelho]100[/vermelho] tf** e *empuxo* __E__ ==igual==');
    expect(b).toHaveLength(1);
    const l = b[0].lines[0];
    expect(l.map((x) => x.text).join('')).toBe('Peso P = 100 tf e empuxo E igual');
    expect(l.find((x) => x.text === '100')).toMatchObject({ b: true, color: '#ff6b6b' });
    expect(l.find((x) => x.text === 'empuxo')).toMatchObject({ i: true });
    expect(l.find((x) => x.text === 'E')).toMatchObject({ u: true });
    expect(l.find((x) => x.text === 'igual')).toMatchObject({ mark: true });
  });
  it('títulos, listas, parágrafos e quebras de linha', () => {
    const b = parseRich('# Título\n## Sub\nlinha 1\nlinha 2\n\n- item a\n- item b\nfim');
    expect(b.map((x) => x.kind)).toEqual(['h1', 'h2', 'p', 'li', 'li', 'p']);
    expect(b[2].lines).toHaveLength(2);
    expect(plainText('**a** [azul]b[/azul]\n- c')).toBe('a b\n• c');
  });
  it('cor desconhecida e marcação solta ficam como texto, sem quebrar', () => {
    const b = parseRich('[rosa]x[/rosa] **aberto');
    expect(b[0].lines[0].map((x) => x.text).join('')).toBe('[rosa]x[/rosa] aberto');
  });
});

describe('Valores ao vivo e condições', () => {
  const e = buildScenario('submerso_50');
  e.advanceSim(1);
  it('substitui valores, casas decimais e variações Δ', () => {
    const d = e.outputs.depthKeel;
    expect(fillTemplate('{prof} m', e, ctx0)).toBe(`${d.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`);
    expect(fillTemplate('{prof:0}', e, ctx0)).toBe(Math.round(d).toString());
    expect(fillTemplate('{Δprof}', e, ctx0, { prof: d - 2 })).toBe('+2,0');
    expect(fillTemplate('{naSuperficie}', e, ctx0)).toBe('não');
    expect(fillTemplate('{xyz} {prof', e, ctx0)).toBe('{xyz} {prof');
    expect(unknownPlaceholders('{prof} {xyz} {Δabc:2}')).toEqual(['{xyz}', '{Δabc:2}']);
  });
  it('toda variável do catálogo é lida sem erro e sem NaN', () => {
    for (const id of ['superficie', 'submerso_50']) {
      const en = buildScenario(id);
      en.advanceSim(1);
      for (const v of PRES_VARS) expect(Number.isFinite(readVar(v.id, en, ctx0)), v.id).toBe(true);
    }
  });
  it('operadores, tolerância e variáveis sim/não', () => {
    expect(testCondition({ v: 'prof', op: '>', value: 30, tol: 1 }, 31)).toBe(true);
    expect(testCondition({ v: 'prof', op: '≈', value: 50, tol: 1.5 }, 51.4)).toBe(true);
    expect(testCondition({ v: 'prof', op: '≈', value: 50, tol: 1.5 }, 51.6)).toBe(false);
    expect(testCondition({ v: 'naSuperficie', op: '=', value: 1, tol: 0 }, 1)).toBe(true);
    expect(testCondition({ v: 'naSuperficie', op: '≠', value: 1, tol: 0 }, 1)).toBe(false);
    expect(testCondition({ v: 'prof', op: '<', value: 3, tol: 0 }, NaN)).toBe(false);
    expect(evalConditions([], 'todas', e, ctx0)).toBe(true);
    expect(describeCondition({ v: 'prof', op: '>', value: 30, tol: 0 })).toBe('Profundidade (quilha) > 30 m');
    expect(describeCondition({ v: 'suspirosFechados', op: '=', value: 1, tol: 0 })).toBe('Todos os suspiros fechados: sim');
  });
});

/** contexto de ações sobre um executor isolado (sem a interface) */
function testCtx(r: SimRunner, log: string[]): ActionCtx {
  return {
    r,
    send: (c) => {
      log.push(c.type);
      r.command(c);
    },
    setView: () => undefined,
    setLayers: () => undefined,
    markBefore: () => undefined,
    restoreBefore: () => undefined,
    restoreStart: () => undefined,
    loadScenario: (id) => r.replaceEngine(buildScenario(id)),
  };
}

describe('Catálogo de ações', () => {
  it('toda ação, com os valores padrão, executa sem erro e se descreve sem “undefined”/NaN', () => {
    for (const scen of ['superficie', 'submerso_50']) {
      for (const t of ACTION_TYPES) {
        const r = new SimRunner(buildScenario(scen));
        const log: string[] = [];
        const a = newAction(t.id);
        expect(actionProblem(a), t.id).toBeNull();
        expect(runAction(a, testCtx(r, log)), t.id).toBe(true);
        r.engine.advanceSim(0.5);
        const d = describeAction(a, r.engine);
        expect(d, t.id).not.toMatch(/undefined|NaN/);
        expect(d.length, t.id).toBeGreaterThan(5);
      }
    }
  });
  it('as ações do submarino passam por comandos registrados', () => {
    const r = new SimRunner(buildScenario('superficie'));
    const log: string[] = [];
    runAction(newAction('suspiros', { alvo: 'vante', abrir: true }), testCtx(r, log));
    expect(log).toEqual(['mbtVent', 'mbtVent']);
    expect(r.engine.state.ballast.TLP1BB.vent.cmd).toBe(1);
    expect(r.engine.state.ballast.TLP2BB.vent.cmd).toBe(0);
    runAction(newAction('pilotoProf', { cota: 80 }), testCtx(r, log));
    expect(r.engine.state.autopilot.depthMode).toBe('AUTO');
    expect(r.engine.state.autopilot.depthSet).toBe(80);
    expect(actionProblem(newAction('comando', { json: '{"type":"naoExiste"}' }))).not.toBeNull();
  });

  it('comando JSON avançado: campo faltando ou com tipo errado é recusado (sem NaN no estado)', () => {
    for (const bad of [
      '{"type":"telegraph"}',
      '{"type":"telegraph","rpm":"40"}',
      '{"type":"setpoint","channel":"depth"}',
      '{"type":"autopilot","channel":"depth","mode":"auto"}',
      '{"type":"mbtVent","tank":"ALL"}',
      '{"type":"dosing","system":"trim","mode":"transferir","kg":0}',
      '{"type":"demoWeight"}',
      '[1]',
      'null',
      '{"rpm":40}',
    ]) {
      expect(parseCommandJson(bad), bad).toBeNull();
      expect(actionProblem(newAction('comando', { json: bad })), bad).not.toBeNull();
    }
    const good: Record<string, unknown> = {
      mbtVent: { tank: 'ALL', open: true },
      mbtBlow: { tank: 'ALL', open: false },
      emergencyBlow: {},
      hpBankValve: { bank: 'AP1', open: true },
      compressor: { run: true },
      valve: { system: 'compensation', valve: 'inlet', open: true },
      pump: { system: 'trim', run: false },
      direction: { system: 'heel', dir: 'BtoA' },
      dosing: { system: 'compensation', mode: 'admitir', kg: 500 },
      dosingAbort: { system: 'compensation' },
      telegraph: { rpm: 40 },
      surface: { id: 'stern', angle: -5 },
      autopilot: { channel: 'depth', mode: 'AUTO' },
      setpoint: { channel: 'depth', value: 60 },
      snorkel: { raise: true },
      periscope: { raise: false },
      generator: { id: 'GD1', run: true },
      breaker: { closed: true },
      ack: { id: 'ALL' },
      seaState: { value: 2 },
      environment: { patch: { salinity: 35 } },
      demoWeight: { x: 10 },
      failure: { target: 'pump:trim', active: true },
    };
    expect(Object.keys(good).sort()).toEqual([...ADVANCED_COMMAND_TYPES].sort());
    const r = new SimRunner(buildScenario('submerso_50'));
    for (const [type, fields] of Object.entries(good)) {
      const json = JSON.stringify({ type, ...(fields as object) });
      expect(parseCommandJson(json), json).not.toBeNull();
      expect(runAction(newAction('comando', { json }), testCtx(r, [])), json).toBe(true);
    }
    r.engine.advanceSim(1);
    expect(Number.isFinite(r.engine.state.propulsion.rpmCmd)).toBe(true);
    expect(Number.isFinite(r.engine.outputs.depthKeel)).toBe(true);
  });
});

describe('Arquivo de apresentação', () => {
  it('qualquer entrada vira uma apresentação válida; ida e volta pelo JSON preserva tudo', () => {
    const bad = normalizePresentation({
      name: 3,
      steps: [{ title: 'x', advance: { mode: 'voar', conditions: [{ v: 'nada' }, { v: 'prof', op: '>', value: '12' }] }, actions: [{ t: 'naoExiste' }, { t: 'telegrafo', p: { rpm: 40 } }] }],
    });
    expect(bad.steps[0].advance.mode).toBe('manual');
    expect(bad.steps[0].advance.conditions).toEqual([{ v: 'prof', op: '>', value: 12, tol: 1 }]);
    expect(bad.steps[0].actions.map((a) => a.t)).toEqual(['telegrafo']);
    expect(normalizePresentation(null).steps.length).toBe(1);
    for (const p of BUILTIN_PRESENTATIONS) {
      const back = normalizePresentation(JSON.parse(exportText(p)));
      expect(back.steps).toEqual(p.steps);
      expect(back.start).toEqual(p.start);
    }
  });
  it('cópia mantém os desvios entre etapas com ids novos', () => {
    const p = newPresentation('t');
    const a = newStep({ title: 'A' });
    const b = newStep({ title: 'B' });
    a.advance.next = b.id;
    p.steps = [a, b];
    const c = clonePresentation(p);
    expect(c.id).not.toBe(p.id);
    expect(c.steps[0].id).not.toBe(a.id);
    expect(c.steps[0].advance.next).toBe(c.steps[1].id);
  });
  it('roteiro em texto e avisos', () => {
    const md = scriptMarkdown(submergir50Template());
    expect(md).toContain('## 3. Abrir os suspiros dos TLP');
    expect(md).toContain('Abrir suspiros — todos os TLP');
    const p = newPresentation();
    p.steps[0].advance.mode = 'condicao';
    p.steps[0].loadState = true;
    expect(presentationProblems(p).length).toBe(2);
  });
});

describe('Execução das apresentações pela física', () => {
  it('modelo “Submergir e descer para 50 m” (relógio em tempo real) termina equilibrado a 50 m', () => {
    const r = new SimRunner(buildScenario('superficie'));
    const pl = new PresPlayer();
    expect(pl.start(r, submergir50Template())).toBe(true);
    const dt = r.engine.config.settings.dt;
    let n = 0;
    while (pl.active && n < 400000) {
      // última etapa é manual: o apresentador encerra
      if (pl.k === pl.pres!.steps.length - 1) {
        pl.next(r);
        break;
      }
      if (r.running) r.engine.step();
      pl.tick(r, dt / r.timeScale);
      n++;
    }
    expect(pl.active).toBe(false);
    expect(pl.outcome.slice(0, -1).every((o) => o === 'concluída')).toBe(true);
    expect(Math.abs(r.engine.outputs.depthKeel - 50)).toBeLessThan(2);
    expect(Math.abs(r.engine.outputs.netBuoyancyKg)).toBeLessThan(300);
    expect(pl.sent.some((c) => /suspiro/i.test(c.text))).toBe(true);
  });

  it('modelo “Exemplo: recursos” percorre todas as etapas (avanço acelerado) e volta à superfície', () => {
    const r = new SimRunner(buildScenario('superficie'));
    const pl = new PresPlayer();
    pl.start(r, recursosTemplate());
    pl.runToEnd(r);
    expect(pl.active).toBe(false);
    expect(pl.finished!.ok).toBe(pl.pres!.steps.length);
    expect(r.engine.outputs.surfaced).toBe(true);
    expect(readVar('tlp', r.engine, ctx0)).toBeLessThan(4);
  });

  it('textos de todas as etapas dos modelos sem valores inválidos', () => {
    for (const p of BUILTIN_PRESENTATIONS) {
      const r = new SimRunner(buildScenario('superficie'));
      const pl = new PresPlayer();
      pl.start(r, p);
      for (let i = 0; i < p.steps.length; i++) {
        const c = pl.card(r.engine)!;
        expect(c.text + c.title + c.why, `${p.id} etapa ${i + 1}`).not.toMatch(/NaN|undefined|\{[A-Za-zΔ]/);
        expect(pl.hud(r.engine).every((h) => !/NaN|undefined/.test(h.value))).toBe(true);
        pl.next(r);
      }
      expect(pl.active).toBe(false);
    }
  });

  it('voltar e repetir a etapa restauram a física do início da etapa', () => {
    const r = new SimRunner(buildScenario('superficie'));
    const pl = new PresPlayer();
    pl.start(r, submergir50Template());
    pl.next(r); // etapa 2: seguimento
    const t2 = r.engine.state.t;
    for (let i = 0; i < 2000; i++) {
      r.engine.step();
      pl.tick(r, 0.02);
    }
    expect(r.engine.state.t).toBeGreaterThan(t2 + 30);
    pl.restartStep(r);
    expect(r.engine.state.t).toBeCloseTo(t2, 6);
    expect(pl.k).toBe(1);
    pl.prev(r);
    expect(pl.k).toBe(0);
    expect(r.engine.state.t).toBeCloseTo(0, 6);
  });

  it('etapa com estado guardado começa sempre do mesmo ponto; ir para uma etapa adiante acelera', async () => {
    const r = new SimRunner(buildScenario('superficie'));
    const p = newPresentation('teste');
    const deep = buildScenario('submerso_50');
    deep.advanceSim(5);
    p.steps = [
      newStep({ title: 'A' }),
      newStep({ title: 'B', state: serializeEngine(deep, 'b'), loadState: true }),
      newStep({ title: 'C', actions: [newAction('telegrafo', { rpm: 0 })], advance: { ...newStep().advance, next: NEXT_END } }),
    ];
    const pl = new PresPlayer();
    pl.start(r, p);
    expect(pl.goto(r, 1)).toBe('estado');
    expect(r.engine.outputs.depthKeel).toBeGreaterThan(45);
    pl.goto(r, 0);
    expect(pl.k).toBe(0);
    const how = pl.goto(r, 2);
    expect(how).toBe('acelerada');
    await new Promise((res) => setTimeout(res, 50));
    for (let i = 0; i < 100 && pl.ff; i++) await new Promise((res) => setTimeout(res, 10));
    expect(pl.k).toBe(2);
    expect(r.engine.state.propulsion.rpmCmd).toBe(0);
  });

  it('gatilho por condição com “manter por N s” e limite de tempo', () => {
    const r = new SimRunner(buildScenario('submerso_50'));
    const p = newPresentation('t');
    p.start.mode = 'atual';
    p.steps = [
      newStep({ title: 'mantém', advance: { ...newStep().advance, mode: 'condicao', conditions: [{ v: 'prof', op: '>', value: 10, tol: 0 }], hold: 3, minDwell: 0 } }),
      newStep({ title: 'nunca', advance: { ...newStep().advance, mode: 'condicao', conditions: [{ v: 'prof', op: '>', value: 999, tol: 0 }], timeout: 5, onTimeout: 'avancar', minDwell: 0 } }),
      newStep({ title: 'fim' }),
    ];
    const pl = new PresPlayer();
    pl.start(r, p);
    const dt = r.engine.config.settings.dt;
    let n = 0;
    while (pl.k === 0 && n < 1000) {
      r.engine.step();
      pl.tick(r, dt);
      n++;
    }
    expect(n * dt).toBeGreaterThan(2.9);
    expect(n * dt).toBeLessThan(3.2);
    n = 0;
    while (pl.k === 1 && n < 1000) {
      r.engine.step();
      pl.tick(r, dt);
      n++;
    }
    expect(pl.outcome[1]).toBe('tempo esgotado');
    expect(pl.k).toBe(2);
  });

  it('sessão: retoma a etapa sem repetir as ações', () => {
    const r = new SimRunner(buildScenario('superficie'));
    const pl = new PresPlayer();
    pl.start(r, submergir50Template());
    pl.next(r);
    const nSent = pl.sent.length;
    const snap = JSON.parse(JSON.stringify(pl.snapshot()));
    const pl2 = new PresPlayer();
    pl2.restore(r, snap);
    expect(pl2.active).toBe(true);
    expect(pl2.k).toBe(1);
    expect(pl2.sent.length).toBe(nSent);
    expect(pl2.fired.size).toBe(1);
  });
});

import { runner } from '../src/ui/store';
import { presPlayer } from '../src/ui/presBuilder/player';
import { captureSession, restoreSession } from '../src/ui/session';
import { saveToText, parseSaveText } from '../src/sim/persistence';

describe('Sessão completa com apresentação do Estúdio em andamento', () => {
  it('salva no meio de uma etapa e retoma na mesma etapa, pausada, sem repetir comandos', () => {
    presPlayer.start(runner, submergir50Template());
    presPlayer.next(runner);
    presPlayer.next(runner); // etapa 3: abrir os suspiros
    const nSent = presPlayer.sent.length;
    const text = saveToText(captureSession('meio da apresentação'));
    presPlayer.stop(runner);
    const rep = restoreSession(parseSaveText(text));
    expect(rep.resumed.join(' ')).toMatch(/apresentação “Submergir/);
    expect(runner.running).toBe(false);
    expect(presPlayer.active).toBe(true);
    expect(presPlayer.k).toBe(2);
    expect(presPlayer.sent.length).toBe(nSent);
    expect(runner.engine.state.ballast.TLP1BB.vent.cmd).toBe(1);
    presPlayer.stop(runner);
  });
});

import { droneCtl } from '../src/ui/droneCtl';

describe('Câmeras com posição guardada e ponto de partida', () => {
  it('drone e passadiço guardados na etapa sobrevivem ao arquivo; o drone é aplicado ao entrar na etapa', () => {
    const p = newPresentation('câmeras');
    const drone = { n: 120, e: -340, up: 45, yaw: 210, pitch: -12 };
    p.steps = [
      newStep({ title: 'drone', visual: { ...newStep().visual, view: 'drone', drone, droneFrame: 'mapa' } }),
      newStep({ title: 'passadiço', visual: { ...newStep().visual, view: 'passadico', bridge: { bearing: 30, elev: 0, fov: 8.7 } } }),
    ];
    const back = normalizePresentation(JSON.parse(exportText(p)));
    expect(back.steps[0].visual.drone).toEqual(drone);
    expect(back.steps[1].visual.bridge).toEqual({ bearing: 30, elev: 0, fov: 8.7 });
    expect(normalizePresentation({ steps: [{ visual: { view: 'drone', drone: { n: 'x' } } }] }).steps[0].visual.drone).toBeNull();
    droneCtl.pose = null;
    const r = new SimRunner(buildScenario('superficie'));
    const pl = new PresPlayer();
    pl.start(r, back);
    expect(droneCtl.pose).toEqual(drone);
    pl.stop(r);
  });

  it('drone “em relação ao submarino”: mesmo enquadramento com o submarino em outro lugar e outro rumo', () => {
    // guardado com o submarino na origem aproado a 90° (Leste): drone 100 m à ré, 20 m a boreste, olhando para a proa
    const world = { n: -20, e: -100, up: 40, yaw: 90, pitch: -15 };
    const stored = droneToStep(world, { n: 0, e: 0, heading: 90 }, 'submarino');
    expect(stored.n).toBeCloseTo(-100, 6);
    expect(stored.e).toBeCloseTo(20, 6);
    expect(stored.yaw).toBeCloseTo(0, 6);
    // depois: submarino em (1000, 500) aproado ao Norte (0°) → drone 100 m ao Sul e 20 m a Leste dele, olhando para o Norte
    const back = droneFromStep(stored, { n: 1000, e: 500, heading: 0 }, 'submarino');
    expect(back.n).toBeCloseTo(900, 6);
    expect(back.e).toBeCloseTo(520, 6);
    expect(back.yaw).toBeCloseTo(0, 6);
    expect(back.up).toBe(40);
    expect(droneFromStep(droneToStep(world, { n: 7, e: 9, heading: 33 }, 'mapa'), { n: 0, e: 0, heading: 0 }, 'mapa')).toEqual(world);
  });

  it('“Apresentar” sempre volta ao cenário escolhido no ponto de partida (com o mar escolhido)', () => {
    const r = new SimRunner(buildScenario('submerso_50'));
    r.engine.advanceSim(30);
    const p = newPresentation('início');
    p.start = { ...p.start, mode: 'cenario', scenario: 'pairando', sea: 4 };
    const pl = new PresPlayer();
    for (let rep = 0; rep < 2; rep++) {
      pl.start(r, p);
      expect(r.engine.state.scenarioId).toBe('pairando');
      expect(r.engine.state.t).toBe(0);
      expect(Math.abs(r.engine.outputs.depthKeel - 80)).toBeLessThan(6);
      expect(r.engine.config.environment.waves?.seaState).toBe(4);
      r.engine.advanceSim(20);
      pl.stop(r);
    }
  });
});
