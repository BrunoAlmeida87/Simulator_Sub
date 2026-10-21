/**
 * SALA DE COMANDO: periscópio (estado, comando, hidráulica, arquivos
 * antigos), indicador de aberturas do casco e os PAINÉIS da cena 3D — cada
 * botão desenhado gera um comando válido do simulador (o mesmo tipo usado
 * pelas outras telas). Os painéis são desenhados num contexto 2D falso
 * (os testes rodam sem navegador).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand, type Command } from '../src/sim/commands';
import { deserializeEngine } from '../src/sim/persistence';
import type { SimulationEngine } from '../src/sim/core/engine';
import type { RoomActions } from '../src/render3d/controlRoom/actions';
import type { DrawCtx, HitRegion, RoomUiState } from '../src/render3d/controlRoom/panel';
import { drawAnnunciator, drawConningOfficer, drawDivingGauges, drawHelmsman, drawPlanesman } from '../src/render3d/controlRoom/panelsShip';
import { drawBallastPanel, drawCompensation, drawManifold, drawTrimHeel, greenBoard, hullOpenings, MANIFOLD_VALVES } from '../src/render3d/controlRoom/panelsBallast';
import { drawEnergy, drawInstructorFailures, drawInstructorSim, drawPropulsion } from '../src/render3d/controlRoom/panelsPlatform';
import { drawNavigation, drawPlotTable, drawSonarContacts, drawSonarWaterfall, drawTacticalConsole, mastOut, roomContacts, signalExcess } from '../src/render3d/controlRoom/panelsCombat';
import { STATIONS } from '../src/render3d/controlRoom/stations';
import { DEFAULT_ORIGIN } from '../src/sim/geo';
import { periscopeHeadZ } from '../src/sim/systems/actuation';

/** contexto 2D falso: aceita qualquer chamada */
function stubCtx(): CanvasRenderingContext2D {
  const t: Record<string | symbol, unknown> = {};
  return new Proxy(t, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'measureText') return () => ({ width: 60 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
      if (k === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) });
      return () => undefined;
    },
    set(o, k, v) {
      o[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

beforeAll(() => {
  // canvas fora da tela (cascata do sonar, terra da mesa tática)
  (globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => stubCtx() }) };
  (globalThis as unknown as { window: unknown }).window = { setTimeout: () => 0, clearTimeout: () => undefined };
});

function mockActs(sent: Command[]): RoomActions {
  return {
    cmd: (c) => sent.push(c),
    maneuver: () => undefined,
    maneuverStatus: () => null,
    periscopeView: () => undefined,
    focus: () => undefined,
    sim: { running: () => false, toggleRun: () => undefined, timeScale: () => 1, setTimeScale: () => undefined, scenarios: () => [{ id: 'superficie', name: 'Superfície' }], loadScenario: () => undefined },
    traffic: () => 0,
    geoOrigin: () => DEFAULT_ORIGIN,
    route: () => ({ points: [], idx: 0, active: false }),
  };
}

const newUi = (): RoomUiState => ({ dose: {}, page: {}, lampTest: false, guards: {}, lighting: 'normal', scenario: 0 });

function drawRegions(draw: (c: DrawCtx) => void, e: SimulationEngine, ui: RoomUiState, px: [number, number] = [960, 640]): HitRegion[] {
  const regions: HitRegion[] = [];
  draw({ g: stubCtx(), glow: stubCtx(), W: px[0], H: px[1], e, now: 1, ui, hit: (r) => regions.push(r), hover: null });
  return regions;
}

const run = (e: SimulationEngine, s: number) => {
  for (let i = 0; i < s / e.config.settings.dt; i++) e.step();
};

describe('Periscópio', () => {
  it('iça e arria pelo comando registrado, no tempo do mastro hidráulico', () => {
    const e = buildScenario('submerso_50');
    expect(e.state.periscope).toEqual({ cmd: false, pos: 0 });
    applyCommand(e, { type: 'periscope', raise: true });
    expect(e.state.commands.at(-1)?.text).toMatch(/Periscópio de ataque: IÇAR/);
    run(e, 4);
    const mid = e.state.periscope!.pos;
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.8);
    run(e, 6);
    expect(e.state.periscope!.pos).toBe(1);
    applyCommand(e, { type: 'periscope', raise: false });
    run(e, 10);
    expect(e.state.periscope!.pos).toBe(0);
  });
  it('sem hidráulica o mastro não se move', () => {
    const e = buildScenario('submerso_50');
    applyCommand(e, { type: 'failure', target: 'hydraulics', active: true });
    applyCommand(e, { type: 'periscope', raise: true });
    run(e, 5);
    expect(e.state.periscope!.pos).toBe(0);
  });
  it('arquivos antigos (sem periscópio) abrem com o periscópio arriado', () => {
    const raw = JSON.parse(readFileSync(new URL('./fixtures/estado-v1-antigo.json', import.meta.url), 'utf8'));
    const e = deserializeEngine(raw);
    expect(e.state.periscope).toEqual({ cmd: false, pos: 0 });
  });
  it('mastro fora d’água (GPS/MAGE) só na cota periscópica com o periscópio içado', () => {
    const e = buildScenario('submerso_50');
    expect(mastOut(e)).toBe(false);
    e.state.periscope = { cmd: true, pos: 1 };
    expect(mastOut(e)).toBe(false);
    // cabeça acima da quilha: diâmetro + vela + curso
    const head = -periscopeHeadZ(e.vessel, 1) + e.vessel.hull.diameter / 2;
    expect(head).toBeGreaterThan(15);
    expect(head).toBeLessThan(20);
  });
});

describe('Indicador de aberturas do casco', () => {
  it('quadro verde com tudo fechado; suspiro aberto acende em vermelho', () => {
    const e = buildScenario('submerso_50');
    expect(greenBoard(e)).toBe(true);
    applyCommand(e, { type: 'mbtVent', tank: 'TLP1BB', open: true });
    run(e, 3);
    const op = hullOpenings(e).find((o) => o.id === 'vent-TLP1BB')!;
    expect(op.open).toBe(true);
    expect(greenBoard(e)).toBe(false);
  });
});

describe('Painéis da sala de comando', () => {
  const panels: [string, (a: RoomActions) => (c: DrawCtx) => void, [number, number]][] = [
    ['planador', drawPlanesman, [960, 640]],
    ['oficial', drawConningOfficer, [960, 640]],
    ['timoneiro', drawHelmsman, [960, 640]],
    ['instrumentos', () => drawDivingGauges(), [1420, 400]],
    ['anunciador', drawAnnunciator, [1240, 400]],
    ['lastro', drawBallastPanel, [1360, 920]],
    ['compensação', drawCompensation, [960, 640]],
    ['trim', drawTrimHeel, [960, 640]],
    ['coletor', () => drawManifold(), [1000, 846]],
    ['energia', drawEnergy, [960, 640]],
    ['propulsão', drawPropulsion, [960, 640]],
    ['falhas', drawInstructorFailures, [960, 640]],
    ['simulação', drawInstructorSim, [960, 640]],
    ['sonar', drawSonarWaterfall, [960, 640]],
    ['contatos', drawSonarContacts, [960, 640]],
    ['tático', drawTacticalConsole, [960, 640]],
    ['navegação', drawNavigation, [960, 640]],
    ['mesa', drawPlotTable, [1024, 640]],
  ];

  it('cada painel desenha sem erro, com regiões identificadas e explicadas', () => {
    const e = buildScenario('submerso_50');
    for (const [name, make, px] of panels) {
      const regions = drawRegions(make(mockActs([])), e, newUi(), px);
      const ids = regions.map((r) => r.id);
      expect(new Set(ids).size, `ids repetidos em ${name}`).toBe(ids.length);
      for (const r of regions) {
        expect(r.label.length, `${name}:${r.id}`).toBeGreaterThan(3);
        expect(r.x + r.w, `${name}:${r.id} fora do canvas`).toBeLessThanOrEqual(px[0] + 1);
        expect(r.y + r.h, `${name}:${r.id} fora do canvas`).toBeLessThanOrEqual(px[1] + 1);
      }
    }
  });

  it('todo botão gera comandos válidos e, juntos, cobrem os comandos do simulador', () => {
    const types = new Set<string>();
    for (const [name, make, px] of panels) {
      const e = buildScenario('submerso_50');
      const ui = newUi();
      const sent: Command[] = [];
      const draw = make(mockActs(sent));
      const regions = drawRegions(draw, e, ui, px);
      for (const r of regions) {
        if (!r.action) continue;
        r.action();
        // ações com confirmação (disjuntor): segundo clique no estado armado
        if (r.id === 'brk')
          drawRegions(draw, e, ui, px)
            .find((x) => x.id === 'brk')
            ?.action?.();
      }
      for (const c of sent) {
        types.add(c.type);
        expect(() => applyCommand(e, c), `${name}: ${JSON.stringify(c)}`).not.toThrow();
      }
      expect(() => run(e, 1), name).not.toThrow();
    }
    for (const t of [
      'mbtVent',
      'mbtBlow',
      'hpBankValve',
      'compressor',
      'valve',
      'pump',
      'direction',
      'dosing',
      'telegraph',
      'autopilot',
      'setpoint',
      'snorkel',
      'periscope',
      'generator',
      'breaker',
      'ack',
      'seaState',
      'failure',
      'demoWeight',
    ]) {
      expect(types.has(t), `nenhum botão envia '${t}'`).toBe(true);
    }
  });

  it('as válvulas do coletor correspondem às válvulas do simulador', () => {
    const e = buildScenario('submerso_50');
    for (const m of MANIFOLD_VALVES) {
      if (m.sys === 'hp') expect(e.state.hpAir.banks[m.key]).toBeDefined();
      else if (m.sys === 'compensation') expect(['inlet', 'discharge']).toContain(m.key);
      else expect(['A', 'B']).toContain(m.key);
    }
  });

  it('estações com nomes, explicações e enquadramentos', () => {
    const ids = STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STATIONS) {
      expect(s.info.length).toBeGreaterThan(40);
      expect(s.view.pos.every(Number.isFinite) && s.view.look.every(Number.isFinite)).toBe(true);
    }
  });
});

describe('Sonar (modelo ilustrativo)', () => {
  it('o ruído próprio cresce com a velocidade e reduz o sinal dos contatos', () => {
    const e = buildScenario('submerso_50');
    const acts = mockActs([]);
    const c = roomContacts(e, acts).sort((a, b) => a.rng - b.rng)[0];
    const slow = signalExcess(e, c);
    e.outputs.speed = 8;
    expect(signalExcess(e, c)).toBeLessThan(slow);
  });
});
