/**
 * Retrato da física: roda cenários, roteiros guiados, apresentações prontas,
 * manobras rápidas e alguns ensaios ativos, e grava as grandezas principais
 * ao longo do tempo. Serve para comparar o comportamento antes e depois de
 * uma mudança no motor.
 *
 *   npx vite-node scripts/physics-snapshot.ts -- saida.json
 *   npx vite-node scripts/physics-snapshot.ts -- --compare antes.json depois.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { SCENARIOS, buildScenario } from '../src/sim/scenarios';
import { SimRunner } from '../src/sim/core/runner';
import { applyCommand, type Command } from '../src/sim/commands';
import type { SimulationEngine } from '../src/sim/core/engine';
import { TourController, TOURS } from '../src/ui/tours';
import { ManeuverController } from '../src/ui/maneuvers';
import { PresPlayer } from '../src/ui/presBuilder/player';
import { BUILTIN_PRESENTATIONS } from '../src/ui/presBuilder/templates';

type Sample = Record<string, number>;
interface Run {
  samples: Sample[];
  final: Record<string, number | string | boolean>;
}

function sample(e: SimulationEngine): Sample {
  const o = e.outputs;
  const s = e.state;
  const mbt = e.vessel.ballast.tanks.reduce((a, t) => a + s.ballast[t.id].water, 0);
  const alarms = Object.values(s.alarms.runtime).filter((a) => a.active).length;
  return {
    t: +s.t.toFixed(2),
    depth: +o.depthKeel.toFixed(3),
    pitch: +o.euler.pitch.toFixed(3),
    roll: +o.euler.roll.toFixed(3),
    heading: +o.euler.heading.toFixed(2),
    u: +s.body.vel.x.toFixed(3),
    net: +o.netBuoyancyKg.toFixed(1),
    soc: +(s.electrical.soc * 100).toFixed(3),
    mbt: +mbt.toFixed(2),
    alarms,
  };
}

function finalOf(e: SimulationEngine): Run['final'] {
  const s = e.state;
  const active = Object.entries(s.alarms.runtime)
    .filter(([, a]) => a.active)
    .map(([k]) => k)
    .sort()
    .join(',');
  return { ...sample(e), alarmIds: active };
}

/** passo a passo, amostrando a cada `every` s de simulação */
function runFor(e: SimulationEngine, seconds: number, every = 10, onStep?: (e: SimulationEngine) => void): Run {
  const dt = e.config.settings.dt;
  const n = Math.round(seconds / dt);
  const k = Math.round(every / dt);
  const samples: Sample[] = [sample(e)];
  for (let i = 1; i <= n; i++) {
    e.step();
    onStep?.(e);
    if (i % k === 0) samples.push(sample(e));
  }
  return { samples, final: finalOf(e) };
}

const send = (e: SimulationEngine, ...cs: Command[]) => cs.forEach((c) => applyCommand(e, c));

function runTour(id: string): Run {
  const tour = TOURS.find((x) => x.id === id)!;
  const r = new SimRunner(buildScenario(tour.scenario));
  const t = new TourController();
  t.start(r, tour);
  const dt = r.engine.config.settings.dt;
  const samples: Sample[] = [];
  let n = 0;
  while (t.active && n < 400000) {
    r.engine.step();
    t.tick(r, dt / r.timeScale);
    if (n % 500 === 0) samples.push(sample(r.engine));
    n++;
  }
  return { samples, final: { ...finalOf(r.engine), outcome: t.outcome.join('|') } };
}

function runPres(i: number): Run {
  const p = BUILTIN_PRESENTATIONS[i];
  const r = new SimRunner(buildScenario('superficie'));
  const pl = new PresPlayer();
  pl.start(r, p);
  const dt = r.engine.config.settings.dt;
  const samples: Sample[] = [];
  let n = 0;
  let wait = 0;
  let k = -1;
  while (pl.active && n < 2_000_000) {
    if (pl.k !== k) {
      k = pl.k;
      wait = 0;
    }
    const st = pl.pres!.steps[pl.k];
    if (st.advance.mode === 'manual' && (wait += dt) > 20) {
      pl.next(r);
      continue;
    }
    if (r.running) r.engine.step();
    pl.tick(r, dt / r.timeScale);
    if (n % 500 === 0) samples.push(sample(r.engine));
    n++;
  }
  return { samples, final: { ...finalOf(r.engine), outcome: pl.outcome.join('|') } };
}

function runManeuver(scenario: string, kind: 'imergir' | 'emergir'): Run {
  const r = new SimRunner(buildScenario(scenario));
  const m = new ManeuverController();
  m.start(r, kind, 50);
  const samples: Sample[] = [];
  let n = 0;
  while (m.active && n < 200000) {
    r.engine.step();
    m.tick(r);
    if (n % 500 === 0) samples.push(sample(r.engine));
    n++;
  }
  return { samples, final: { ...finalOf(r.engine), outcome: m.result?.outcome ?? '-' } };
}

function snapshot(): Record<string, Run> {
  const out: Record<string, Run> = {};
  for (const sc of SCENARIOS) out['cenario:' + sc.id] = runFor(buildScenario(sc.id), 240);
  for (const tr of TOURS) out['roteiro:' + tr.id] = runTour(tr.id);
  BUILTIN_PRESENTATIONS.forEach((p, i) => (out['apresentacao:' + p.id] = runPres(i)));
  out['manobra:imergir'] = runManeuver('superficie', 'imergir');
  out['manobra:emergir'] = runManeuver('submerso_50', 'emergir');

  let e = buildScenario('submerso_50');
  send(
    e,
    { type: 'telegraph', rpm: 120 },
    { type: 'autopilot', channel: 'depth', mode: 'AUTO' },
    { type: 'setpoint', channel: 'depth', value: 80 },
    { type: 'autopilot', channel: 'heading', mode: 'AUTO' },
    { type: 'setpoint', channel: 'heading', value: (e.outputs.euler.heading + 60) % 360 },
  );
  out['ensaio:piloto_80m_rumo60'] = runFor(e, 400);

  e = buildScenario('submerso_50');
  send(e, { type: 'emergencyBlow', open: true });
  out['ensaio:sopro_emergencia'] = runFor(e, 120, 5);

  e = buildScenario('submerso_50');
  send(e, { type: 'telegraph', rpm: -60 }, { type: 'autopilot', channel: 'depth', mode: 'AUTO' }, { type: 'setpoint', channel: 'depth', value: 50 });
  out['ensaio:re_piloto_profundidade'] = runFor(e, 300);

  e = buildScenario('submerso_50');
  send(e, { type: 'surface', id: 'stern', angle: 15 }, { type: 'surface', id: 'rudder', angle: 20 }, { type: 'telegraph', rpm: 150 });
  out['ensaio:lemes_cheios'] = runFor(e, 200);

  e = buildScenario('superficie');
  send(e, { type: 'generator', id: 'GD1', run: true }, { type: 'generator', id: 'GD2', run: true });
  out['ensaio:geradores'] = runFor(e, 600, 30);
  return out;
}

function compare(a: Record<string, Run>, b: Record<string, Run>): void {
  const keys = ['depth', 'pitch', 'roll', 'heading', 'u', 'net', 'soc', 'mbt'];
  for (const name of Object.keys(a)) {
    const ra = a[name];
    const rb = b[name];
    if (!rb) {
      console.log(`${name}: ausente no segundo arquivo`);
      continue;
    }
    const diffs: string[] = [];
    for (const k of keys) {
      let max = 0;
      let at = 0;
      const n = Math.min(ra.samples.length, rb.samples.length);
      for (let i = 0; i < n; i++) {
        let d = Math.abs((ra.samples[i][k] ?? 0) - (rb.samples[i][k] ?? 0));
        if (k === 'heading') d = Math.min(d, 360 - d);
        if (d > max) {
          max = d;
          at = ra.samples[i].t;
        }
      }
      if (max > 1e-6) diffs.push(`${k} Δmáx ${max.toFixed(3)} (t=${at})`);
    }
    const fa = ra.final;
    const fb = rb.final;
    const finals = ['t', 'outcome', 'alarmIds'].filter((k) => fa[k] !== fb[k]).map((k) => `${k}: ${fa[k]} → ${fb[k]}`);
    if (ra.samples.length !== rb.samples.length) finals.push(`amostras ${ra.samples.length} → ${rb.samples.length}`);
    console.log(`${diffs.length || finals.length ? '≠' : '='} ${name}${diffs.length ? '\n    ' + diffs.join('; ') : ''}${finals.length ? '\n    ' + finals.join('; ') : ''}`);
  }
}

const args = process.argv.slice(2).filter((x) => x !== '--');
if (args[0] === '--compare') {
  compare(JSON.parse(readFileSync(args[1], 'utf8')), JSON.parse(readFileSync(args[2], 'utf8')));
} else {
  const file = args[0] ?? 'physics-snapshot.json';
  writeFileSync(file, JSON.stringify(snapshot()));
  console.log('gravado em', file);
}
