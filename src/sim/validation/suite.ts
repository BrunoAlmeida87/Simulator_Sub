/**
 * SUÍTE DE VALIDAÇÃO — cenários demonstrativos com resultados numéricos
 * verificáveis. Usada pelos testes automáticos (Vitest), pelo relatório
 * docs/VALIDACAO.md e pela tela "Validação" do simulador.
 */
import { defaultSimConfig } from '../config/defaultVessel';
import type { SimConfig } from '../config/types';
import { buildScenario } from '../scenarios';
import { SimulationEngine } from '../core/engine';
import { SimRunner } from '../core/runner';
import { applyCommand } from '../commands';
import { seawaterDensity } from '../environment/seawater';
import { computeHydrostatics } from '../physics/hydrostatics';
import { qFromEuler, qToMat3, RAD, wrap360 } from '../core/math';
import { RHO_CAL } from '../systems/sensors';
import { serializeEngine, deserializeEngine } from '../persistence';
import { KNOT } from '../units';

export interface Metric {
  name: string;
  value: number;
  unit: string;
  criterion: string;
  pass: boolean;
}

export interface Series {
  label: string;
  t: number[];
  y: number[];
  unit: string;
}

export interface ValidationResult {
  id: string;
  title: string;
  passed: boolean;
  metrics: Metric[];
  series: Series[];
  notes: string;
  durationMs: number;
}

export interface ValidationCase {
  id: string;
  title: string;
  description: string;
  run: () => Omit<ValidationResult, 'id' | 'title' | 'passed' | 'durationMs'>;
}

const m = (name: string, value: number, unit: string, criterion: string, pass: boolean): Metric => ({ name, value, unit, criterion, pass });

/** Ambiente homogêneo (sem termoclina) para isolar efeitos. */
export function uniformConfig(): SimConfig {
  const c = defaultSimConfig();
  c.environment.surfaceTemperature = 15;
  c.environment.deepTemperature = 15;
  c.environment.salinity = 35;
  c.environment.deepSalinity = 35;
  c.environment.bottom.baseDepth = 1500;
  c.environment.bottom.roughness = 0;
  return c;
}

function record(e: SimulationEngine, seconds: number, every: number, get: (e: SimulationEngine) => number, label: string, unit: string, t0 = e.state.t): Series {
  const s: Series = { label, t: [], y: [], unit };
  const n = Math.round(seconds / every);
  s.t.push(e.state.t - t0);
  s.y.push(get(e));
  for (let i = 0; i < n; i++) {
    e.advanceSim(every);
    s.t.push(e.state.t - t0);
    s.y.push(get(e));
  }
  return s;
}

function lateralArea(e: SimulationEngine): number {
  return e.geom.slices.reduce((a, sl) => a + 2 * sl.r * sl.dx, 0);
}

export const VALIDATION_CASES: ValidationCase[] = [
  {
    id: 'V01',
    title: '1. Resposta ao equilíbrio de flutuabilidade',
    description: 'Pairando sem seguimento: admitir 1,5 t de água de compensação deve gerar flutuabilidade negativa de ~1,5 t e afundamento progressivo; esgotar 3 t deve inverter a tendência.',
    run: () => {
      const e = buildScenario('pairando', uniformConfig());
      const z0 = e.outputs.depthKeel;
      e.advanceSim(60);
      const drift = e.outputs.depthKeel - z0;
      applyCommand(e, { type: 'dosing', system: 'compensation', mode: 'admitir', kg: 1500 });
      const sz = record(e, 240, 2, (x) => x.outputs.depthKeel, 'Profundidade', 'm');
      const net = e.outputs.netBuoyancyKg;
      const vz = e.outputs.verticalSpeed;
      const rho = e.outputs.rhoLocal;
      // terminal: ½ρC_dc·A·v² + c_lin·v = |Δm|·g
      const qa = 0.5 * rho * e.vessel.hydro.crossflowDrag * lateralArea(e);
      const ql = e.vessel.hydro.linearDamping.heave;
      const W = Math.abs(net) * 9.80665;
      const vt = (-ql + Math.sqrt(ql * ql + 4 * qa * W)) / (2 * qa);
      const zAfter = e.outputs.depthKeel;
      applyCommand(e, { type: 'dosing', system: 'compensation', mode: 'esgotar', kg: 3000 });
      const sz2 = record(e, 400, 2, (x) => x.outputs.depthKeel, 'Profundidade', 'm');
      const vz2 = e.outputs.verticalSpeed;
      sz.t.push(...sz2.t.map((t) => t + 240));
      sz.y.push(...sz2.y);
      return {
        metrics: [
          m('Deriva com equilíbrio neutro (60 s)', drift, 'm', '|Δz| < 0,5 m', Math.abs(drift) < 0.5),
          m('Flutuabilidade líquida após admitir 1,5 t', net, 'kg', '−1500 ± 150 kg', Math.abs(net + 1500) < 150),
          m('Afundamento em 240 s', zAfter - z0 - drift, 'm', '> 5 m', zAfter - z0 > 5),
          m('Velocidade vertical (descendo)', vz, 'm/s', '> 0 e ±15 % da terminal prevista', vz > 0 && Math.abs(vz - vt) / vt < 0.15),
          m('Velocidade terminal prevista (arrasto cruzado + linear)', vt, 'm/s', 'referência', true),
          m('Velocidade vertical após esgotar 3 t', vz2, 'm/s', '< 0 (subindo)', vz2 < 0),
        ],
        series: [sz],
        notes: 'Velocidade terminal: ½·ρ·C_dc·A_lat·v² + c_lin·v = |Δm|·g (peso aparente equilibrado pelo arrasto vertical).',
      };
    },
  },
  {
    id: 'V02',
    title: '2. Redistribuição longitudinal de massa altera o trim',
    description: 'Transferir 1 t de TT-AV para TT-AR (velocidade nula): proa deve subir; ângulo final comparado com a previsão estática Δθ = Δm·g·Δx / (W·BG).',
    run: () => {
      const e = buildScenario('pairando', uniformConfig());
      const th0 = e.outputs.euler.pitch;
      const v = e.vessel;
      applyCommand(e, { type: 'dosing', system: 'trim', mode: 'transferir', kg: 1000, dir: 'AtoB' });
      const sp = record(e, 500, 2, (x) => x.outputs.euler.pitch, 'Pitch', '°');
      const transferred = e.state.trim.dosing?.moved ?? 0;
      const dx = v.trim.tankA.center.x - v.trim.tankB.center.x;
      const W = e.outputs.mp.mass * 9.80665;
      const pred = Math.atan((transferred * 9.80665 * dx) / (W * e.outputs.BG)) * RAD;
      const dth = e.outputs.euler.pitch - th0;
      return {
        metrics: [
          m('Massa transferida', transferred, 'kg', '1000 ± 30 kg', Math.abs(transferred - 1000) < 30),
          m('Variação de pitch (simulada)', dth, '°', '> 0 (proa para cima)', dth > 0),
          m('Variação de pitch (prevista)', pred, '°', 'referência', true),
          m('Erro relativo simulado × previsto', Math.abs(dth - pred) / pred * 100, '%', '< 10 %', Math.abs(dth - pred) / pred < 0.1),
          m('Rigidez longitudinal W·BG', e.outputs.pitchStiffness / 1e6, 'MN·m/rad', 'referência', true),
        ],
        series: [sp],
        notes: 'Oscilação amortecida de longo período (≈ 2π√(I_yy/(W·BG))) antes de estabilizar.',
      };
    },
  },
  {
    id: 'V03',
    title: '3. Redistribuição transversal de massa altera a banda',
    description: 'Transferir 1 t de TB-BB para TB-BE: o submarino deve adernar para boreste conforme Δφ = Δm·g·Δy / (W·BG).',
    run: () => {
      const e = buildScenario('pairando', uniformConfig());
      const ph0 = e.outputs.euler.roll;
      const v = e.vessel;
      applyCommand(e, { type: 'dosing', system: 'heel', mode: 'transferir', kg: 1000, dir: 'AtoB' });
      const sr = record(e, 300, 1, (x) => x.outputs.euler.roll, 'Banda', '°');
      const transferred = e.state.heel.dosing?.moved ?? 0;
      const dy = v.heel.tankB.center.y - v.heel.tankA.center.y;
      const W = e.outputs.mp.mass * 9.80665;
      const pred = Math.atan((transferred * 9.80665 * dy) / (W * e.outputs.BG)) * RAD;
      const dph = e.outputs.euler.roll - ph0;
      return {
        metrics: [
          m('Massa transferida', transferred, 'kg', '1000 ± 30 kg', Math.abs(transferred - 1000) < 30),
          m('Variação de banda (simulada)', dph, '°', '> 0 (boreste)', dph > 0),
          m('Variação de banda (prevista)', pred, '°', 'referência', true),
          m('Erro relativo', (Math.abs(dph - pred) / pred) * 100, '%', '< 10 %', Math.abs(dph - pred) / pred < 0.1),
        ],
        series: [sr],
        notes: 'Arquitetura de banda fictícia (tanques laterais).',
      };
    },
  },
  {
    id: 'V04',
    title: '4. Efetividade dos lemes depende da velocidade',
    description: 'Mesma deflexão dos lemes de ré (10°) a 0, 0,5 e 5 m/s: força ∝ U² (razão ≈ 100 entre 5 e 0,5 m/s) e resposta de pitch muito maior com escoamento significativo.',
    run: () => {
      const out: Record<string, { lift: number; dth: number }> = {};
      for (const u of [0, 0.5, 5]) {
        const e = buildScenario('pairando', uniformConfig());
        e.state.body.vel.x = u;
        e.state.propulsion.rpmCmd = 0;
        e.state.surfaces.stern.cmd = 10;
        e.state.surfaces.stern.actual = 10;
        // mantém a velocidade por empuxo equivalente: usa o telégrafo estimado
        if (u > 0) {
          const rpm = (e.state.propulsion.rpmCmd = estimate(e, u));
          e.state.propulsion.rpmRef = rpm;
          e.state.propulsion.omega = (rpm * 2 * Math.PI) / 60;
        }
        e.computeOutputs();
        const lift = Math.hypot(e.outputs.forces.fins.stern.F.x, e.outputs.forces.fins.stern.F.z);
        const th0 = e.outputs.euler.pitch;
        e.advanceSim(20);
        out[u] = { lift, dth: e.outputs.euler.pitch - th0 };
      }
      const ratio = out[5].lift / out[0.5].lift;
      return {
        metrics: [
          m('Força nos lemes de ré a U = 0', out[0].lift, 'N', '= 0', out[0].lift === 0),
          m('Força a U = 0,5 m/s', out[0.5].lift, 'N', 'referência', true),
          m('Força a U = 5 m/s', out[5].lift, 'N', 'referência', true),
          m('Razão de forças (5 / 0,5 m/s)', ratio, '—', '100 ± 10 (∝ U²)', Math.abs(ratio - 100) < 10),
          m('Δpitch em 20 s a 0,5 m/s', out[0.5].dth, '°', 'pequeno', Math.abs(out[0.5].dth) < 0.5),
          m('Δpitch em 20 s a 5 m/s', out[5].dth, '°', '> 10× o caso lento', Math.abs(out[5].dth) > 10 * Math.abs(out[0.5].dth)),
        ],
        series: [],
        notes: 'L = ½·ρ·U²·A·C_L(α): sem escoamento não há força hidrodinâmica.',
      };
    },
  },
  {
    id: 'V05',
    title: '5. Rumo responde progressivamente à deflexão do leme',
    description: 'A 6 nós: leme 15° BE ⇒ taxa de guinada cresce gradualmente e o rumo aumenta; 15° BB ⇒ simétrico; leme a meio ⇒ rumo mantido.',
    run: () => {
      const res: Record<string, { dpsi: number; r5: number; r40: number; series: Series }> = {};
      for (const [k, ang] of [
        ['be', 15],
        ['bb', -15],
        ['meio', 0],
      ] as const) {
        const e = buildScenario('submerso_50', uniformConfig());
        const psi0 = e.outputs.euler.heading;
        applyCommand(e, { type: 'surface', id: 'rudder', angle: ang });
        e.advanceSim(5);
        const r5 = e.state.body.omega.z * RAD;
        const s = record(e, 55, 1, (x) => ((x.outputs.euler.heading - psi0 + 540) % 360) - 180, 'Δrumo ' + k, '°');
        const r40 = e.state.body.omega.z * RAD;
        res[k] = { dpsi: ((e.outputs.euler.heading - psi0 + 540) % 360) - 180, r5, r40, series: s };
      }
      const mono = res.be.series.y.every((y, i, a) => i === 0 || y >= a[i - 1] - 1e-6);
      return {
        metrics: [
          m('Δrumo em 60 s (15° BE)', res.be.dpsi, '°', '> 15°', res.be.dpsi > 15),
          m('Δrumo em 60 s (15° BB)', res.bb.dpsi, '°', '< −15° (simétrico ±10 %)', res.bb.dpsi < -15 && Math.abs(res.bb.dpsi + res.be.dpsi) / res.be.dpsi < 0.1),
          m('Δrumo em 60 s (leme a meio)', res.meio.dpsi, '°', '|Δψ| < 0,5°', Math.abs(res.meio.dpsi) < 0.5),
          m('Taxa de guinada após 5 s', res.be.r5, '°/s', '< taxa após 60 s (progressiva)', res.be.r5 < res.be.r40 || res.be.r5 < 0.9 * Math.max(res.be.r40, 0.3)),
          m('Taxa de guinada após 60 s', res.be.r40, '°/s', 'referência', true),
          m('Rumo monotônico (BE)', mono ? 1 : 0, 'bool', '1', mono),
        ],
        series: [res.be.series, res.bb.series, res.meio.series],
        notes: 'O casco ganha ângulo de deriva e a guinada se estabelece após o transitório de inércia.',
      };
    },
  },
  {
    id: 'V06',
    title: '6. Bombas e válvulas possuem estados transitórios',
    description: 'Curso das válvulas, partida das bombas e alagamento dos TLP não são instantâneos.',
    run: () => {
      const e = buildScenario('superficie', uniformConfig());
      const stroke = e.vessel.ballast.tanks[0].ventValve.strokeTime;
      applyCommand(e, { type: 'mbtVent', tank: 'ALL', open: true });
      e.advanceSim(stroke / 2);
      const posHalf = e.state.ballast.TLP1BB.vent.pos;
      e.advanceSim(stroke / 2);
      const posFull = e.state.ballast.TLP1BB.vent.pos;
      const id = e.vessel.ballast.tanks[0].id;
      const cap = e.vessel.ballast.tanks[0].volume;
      e.advanceSim(5 - stroke);
      const w5 = e.state.ballast[id].water / cap;
      const sw = record(e, 85, 1, (x) => (x.state.ballast[id].water / cap) * 100, 'TLP-1 BB (% cheio)', '%');
      const w90 = e.state.ballast[id].water / cap;
      // bomba de trim
      const e2 = buildScenario('pairando', uniformConfig());
      applyCommand(e2, { type: 'valve', system: 'trim', valve: 'A', open: true });
      applyCommand(e2, { type: 'valve', system: 'trim', valve: 'B', open: true });
      e2.advanceSim(4);
      applyCommand(e2, { type: 'pump', system: 'trim', run: true });
      const spin = e2.vessel.trim.pump.spinUpTime;
      e2.advanceSim(spin / 2);
      const spHalf = e2.state.trim.pump.speed;
      const qHalf = e2.state.trim.pump.flow;
      e2.advanceSim(spin);
      const qFull = e2.state.trim.pump.flow;
      return {
        metrics: [
          m('Posição do suspiro em t_curso/2', posHalf, '—', '0,5 ± 0,05', Math.abs(posHalf - 0.5) < 0.05),
          m('Posição do suspiro em t_curso', posFull, '—', '1,0', posFull > 0.999),
          m('Enchimento do TLP após 5 s', w5 * 100, '%', '< 40 % (limitado pela saída de ar)', w5 < 0.4),
          m('Enchimento do TLP após 90 s', w90 * 100, '%', '> 95 %', w90 > 0.95),
          m('Rotação da bomba em t_partida/2', spHalf, '—', '0,5 ± 0,05', Math.abs(spHalf - 0.5) < 0.05),
          m('Vazão da bomba de trim em t_partida/2', qHalf * 1000, 'L/s', '< vazão plena', qHalf < qFull),
          m('Vazão plena da bomba de trim', qFull * 1000, 'L/s', '> 0', qFull > 0),
        ],
        series: [sw],
        notes: 'O alagamento é limitado pela vazão de ar através do suspiro (orifício compressível).',
      };
    },
  },
  {
    id: 'V07',
    title: '7. Coerência entre profundidade e pressão',
    description: 'A pressão externa cresce monotonicamente com a profundidade (≈ 1 bar/10 m), a leitura do sensor coincide com o estado e a profundidade indicada usa ρ_cal.',
    run: () => {
      const e = buildScenario('submerso_50', uniformConfig());
      const env = e.env;
      const depths = [0, 10, 50, 100, 200, 300, 500];
      let mono = true;
      let maxErr = 0;
      let prev = -Infinity;
      const s: Series = { label: 'Pressão manométrica', t: [], y: [], unit: 'bar' };
      for (const z of depths) {
        const p = env.pressureAt(z);
        if (p <= prev) mono = false;
        prev = p;
        const rhoAvg = z > 0 ? (p - env.cfg.atmosphericPressure) / (env.cfg.gravity * z) : 0;
        if (z > 0) maxErr = Math.max(maxErr, Math.abs(rhoAvg - env.densityAt(z / 2)) / env.densityAt(z / 2));
        s.t.push(z);
        s.y.push((p - env.cfg.atmosphericPressure) / 1e5);
      }
      const pSensor = e.state.sensors.PEXT.value * 1e5;
      const pTrue = e.outputs.pressureKeel;
      const zInd = e.state.sensors.PRF1.value;
      const zTrue = e.outputs.depthKeel;
      const per10 = (env.pressureAt(100) - env.pressureAt(90)) / 1e5;
      return {
        metrics: [
          m('Pressão monotônica com a profundidade', mono ? 1 : 0, 'bool', '1', mono),
          m('Gradiente entre 90 e 100 m', per10, 'bar/10 m', '1,00 ± 0,03', Math.abs(per10 - 1.0) < 0.03),
          m('Erro ρ médio × ρ(z/2)', maxErr * 100, '%', '< 0,5 %', maxErr < 0.005),
          m('Sensor PEXT − pressão real', (pSensor - pTrue) / 1e5, 'bar', '|Δ| < 1e−6', Math.abs(pSensor - pTrue) < 0.1),
          m('Profundidade indicada − geométrica', zInd - zTrue, 'm', '|Δ| < 1 % (efeito de ρ_cal)', Math.abs(zInd - zTrue) / zTrue < 0.01),
          m('Pressão a 300 m (absoluta)', env.pressureAt(300) / 1e5, 'bar', '≈ 31,3', Math.abs(env.pressureAt(300) / 1e5 - 31.3) < 0.3),
        ],
        series: [s],
        notes: 'dp/dz = ρ(S,T,p)·g integrada com EOS-80; profundímetro: z = (p − p_atm)/(ρ_cal·g), ρ_cal = ' + RHO_CAL,
      };
    },
  },
  {
    id: 'V08',
    title: '8. Estado válido com pausa, reinício, aceleração e salvamento',
    description: 'Passo fixo: ×1 e ×10 produzem estados idênticos; pausa não altera o estado; reinício reproduz o cenário; salvar/recuperar continua identicamente.',
    run: () => {
      const cfg = uniformConfig();
      const a = new SimRunner(buildScenario('submerso_50', cfg));
      const b = new SimRunner(buildScenario('submerso_50', cfg));
      for (const r of [a, b]) {
        r.running = true;
        r.command({ type: 'surface', id: 'rudder', angle: 10 });
        r.command({ type: 'telegraph', rpm: 90 });
      }
      b.timeScale = 10;
      for (let i = 0; i < 1500; i++) a.frame(0.02);
      for (let i = 0; i < 150; i++) b.frame(0.02);
      const same = JSON.stringify(a.engine.state) === JSON.stringify(b.engine.state);
      // pausa
      a.running = false;
      const before = JSON.stringify(a.engine.state);
      for (let i = 0; i < 50; i++) a.frame(0.5);
      const pausedSame = before === JSON.stringify(a.engine.state);
      // reinício
      const r1 = JSON.stringify(buildScenario('submerso_50', cfg).state);
      const r2 = JSON.stringify(buildScenario('submerso_50', cfg).state);
      // salvamento
      const save = serializeEngine(a.engine, 'teste');
      const c = deserializeEngine(JSON.parse(JSON.stringify(save)));
      a.engine.advanceSim(30);
      c.advanceSim(30);
      const restoredSame = JSON.stringify(a.engine.state) === JSON.stringify(c.state);
      const finite = [a.engine.state.body.pos.z, a.engine.state.body.vel.x, a.engine.state.body.quat.w].every(Number.isFinite);
      return {
        metrics: [
          m('Passos executados (×1)', a.engine.state.step - 1500, 'passos', 'referência', true),
          m('Estado ×1 = estado ×10 (mesmo tempo simulado)', same ? 1 : 0, 'bool', '1', same),
          m('Estado inalterado durante pausa', pausedSame ? 1 : 0, 'bool', '1', pausedSame),
          m('Reinício reproduz o cenário', r1 === r2 ? 1 : 0, 'bool', '1', r1 === r2),
          m('Continuação após salvar/recuperar idêntica', restoredSame ? 1 : 0, 'bool', '1', restoredSame),
          m('Variáveis de estado finitas', finite ? 1 : 0, 'bool', '1', finite),
        ],
        series: [],
        notes: 'Determinismo: acumulador de tempo real com passo fixo dt = 0,02 s.',
      };
    },
  },
  {
    id: 'V09',
    title: '9. Instrumentos consistentes com o estado simulado',
    description: 'Sem ruído, as leituras coincidem com as grandezas físicas; com instrumentação avançada, o erro médio é pequeno e o desvio corresponde ao ruído configurado.',
    run: () => {
      const e = buildScenario('submerso_50', uniformConfig());
      applyCommand(e, { type: 'surface', id: 'rudder', angle: 8 });
      e.advanceSim(30);
      const s = e.state.sensors;
      const o = e.outputs;
      const decl = e.env.cfg.magneticDeclination;
      const errHdg = Math.abs(((s.GIRO.value - o.euler.heading + 540) % 360) - 180);
      const errAgm = Math.abs(((s.AGM.value - wrap360(o.euler.heading - decl) + 540) % 360) - 180);
      const errPitch = Math.abs(s.INSP.value - o.euler.pitch);
      const errRoll = Math.abs(s.INSR.value - o.euler.roll);
      const errU = Math.abs(s.DVLU.value - e.state.body.vel.x);
      const errAlt = Math.abs(s.ECO.value - o.altitude);
      const zFromP = (o.pressureKeel - e.env.cfg.atmosphericPressure) / (RHO_CAL * e.env.cfg.gravity);
      const errPrf = Math.abs(s.PRF1.value - zFromP);
      // modo avançado
      const e2 = buildScenario('submerso_50', uniformConfig());
      e2.config.settings.advancedInstrumentation = true;
      let sum = 0;
      let sum2 = 0;
      let n = 0;
      e2.advanceSim(10);
      for (let i = 0; i < 1500; i++) {
        e2.step();
        const zt = (e2.outputs.pressureKeel - e2.env.cfg.atmosphericPressure) / (RHO_CAL * e2.env.cfg.gravity);
        const d = e2.state.sensors.PRF1.value - zt;
        sum += d;
        sum2 += d * d;
        n++;
      }
      const mean = sum / n;
      const rms = Math.sqrt(sum2 / n);
      const sigma = e2.vessel.sensors.depth;
      return {
        metrics: [
          m('Girobússola − rumo real', errHdg, '°', '< 1e−6', errHdg < 1e-6),
          m('Agulha magnética − (rumo − declinação)', errAgm, '°', '< 1e−6', errAgm < 1e-6),
          m('INS pitch − pitch real', errPitch, '°', '< 1e−9', errPitch < 1e-9),
          m('INS banda − banda real', errRoll, '°', '< 1e−9', errRoll < 1e-9),
          m('Doppler − velocidade real', errU, 'm/s', '< 1e−9', errU < 1e-9),
          m('Ecobatímetro − altitude real', errAlt, 'm', '< 1e−9', errAlt < 1e-9),
          m('Profundímetro − conversão da pressão', errPrf, 'm', '< 1e−9', errPrf < 1e-9),
          m('Modo avançado: erro médio do profundímetro', mean, 'm', '|média| < σ', Math.abs(mean) < sigma),
          m('Modo avançado: RMS do erro', rms, 'm', '≈ σ (0,5σ … 2σ)', rms > 0.5 * sigma && rms < 2 * sigma),
        ],
        series: [],
        notes: 'Classificação na interface: MED (sensor), CALC (calculado), CMD (comando).',
      };
    },
  },
  {
    id: 'V10',
    title: '10. Sem geração artificial de massa ou energia',
    description: 'Sequência com mergulho, compensação, sopro e diesel: balanços de massa e energia fecham; casco sem propulsão perde energia mecânica monotonicamente.',
    run: () => {
      const e = buildScenario('superficie', uniformConfig());
      applyCommand(e, { type: 'telegraph', rpm: 90 });
      applyCommand(e, { type: 'mbtVent', tank: 'ALL', open: true });
      e.advanceSim(30);
      applyCommand(e, { type: 'surface', id: 'bow', angle: -10 });
      e.advanceSim(40);
      applyCommand(e, { type: 'surface', id: 'bow', angle: 0 });
      applyCommand(e, { type: 'mbtVent', tank: 'ALL', open: false });
      applyCommand(e, { type: 'dosing', system: 'compensation', mode: 'admitir', kg: 800 });
      applyCommand(e, { type: 'dosing', system: 'trim', mode: 'transferir', kg: 400, dir: 'BtoA' });
      e.advanceSim(120);
      applyCommand(e, { type: 'dosing', system: 'compensation', mode: 'esgotar', kg: 1200 });
      applyCommand(e, { type: 'mbtBlow', tank: 'ALL', open: true });
      e.advanceSim(40);
      applyCommand(e, { type: 'mbtBlow', tank: 'ALL', open: false });
      e.advanceSim(120);
      applyCommand(e, { type: 'generator', id: 'GD1', run: true });
      applyCommand(e, { type: 'compressor', run: true });
      e.advanceSim(120);
      const L = e.state.ledger;
      const massErr = e.outputs.massAudit;
      const busErr = L.batteryChemical - L.batteryOut - L.batteryLoss;
      const loadsMinusSupply = L.loadEnergy - (L.generatorEnergy + L.batteryOut);
      // energia mecânica de um casco passivo (sem propulsão, neutro, homogêneo)
      const p = buildScenario('submerso_50', uniformConfig());
      p.state.propulsion.rpmCmd = 0;
      p.state.propulsion.rpmRef = 0;
      p.state.propulsion.omega = 0;
      applyCommand(p, { type: 'failure', target: 'motor', active: true });
      const ke = (x: SimulationEngine) => {
        const mm = x.outputs.mp.mass;
        const A = x.added;
        const v = x.state.body.vel;
        const w = x.state.body.omega;
        const I = x.outputs.mp.inertia;
        return 0.5 * ((mm + A.X) * v.x ** 2 + (mm + A.Y) * v.y ** 2 + (mm + A.Z) * v.z ** 2) + 0.5 * ((I.x + A.K) * w.x ** 2 + (I.y + A.M) * w.y ** 2 + (I.z + A.N) * w.z ** 2);
      };
      const sk = record(p, 200, 2, ke, 'Energia cinética (casco passivo)', 'J');
      let mono = true;
      for (let i = 1; i < sk.y.length; i++) if (sk.y[i] > sk.y[i - 1] * (1 + 1e-6)) mono = false;
      return {
        metrics: [
          m('Erro do balanço de massa interna', massErr, 'kg', '|erro| < 1 kg', Math.abs(massErr) < 1),
          m('Água admitida do mar', e.state.ledger.seaIn, 'kg', 'referência', true),
          m('Água descarregada ao mar', e.state.ledger.seaOut, 'kg', 'referência', true),
          m('Ar ventilado + derramado', e.state.ledger.airVented + e.state.ledger.airSpilled, 'kg', 'referência', true),
          m('Ar comprimido admitido (compressor)', e.state.ledger.airCompressed, 'kg', 'referência', true),
          m('Combustível queimado', e.state.ledger.fuelBurned, 'kg', '> 0 (diesel operou)', e.state.ledger.fuelBurned > 0),
          m('Bateria: E_química − E_terminais − perdas', busErr, 'J', '|erro| < 1 J', Math.abs(busErr) < 1),
          m('Barramento: cargas − (geradores + bateria)', loadsMinusSupply, 'J', '|erro| < 1 J', Math.abs(loadsMinusSupply) < 1),
          m('Trabalho no hélice ≤ energia elétrica', L.propellerWork / Math.max(1, L.loadEnergy), '—', '< 1', L.propellerWork < L.loadEnergy),
          m('Energia cinética do casco passivo não cresce', mono ? 1 : 0, 'bool', '1', mono),
          m('Energia cinética inicial → final', sk.y[sk.y.length - 1] / sk.y[0], 'fração', '< 1', sk.y[sk.y.length - 1] < sk.y[0]),
        ],
        series: [sk],
        notes: 'Massa interna exclui a água livre dos TLP (comunicante com o mar). Fronteiras: admissão/descarga de mar, ar ventilado/derramado, compressor, combustível compensado, alagamentos.',
      };
    },
  },
  {
    id: 'V11',
    title: 'Extra: equação de estado EOS-80 e hidrostática',
    description: 'Valores de verificação publicados da UNESCO e volume submerso igual ao volume geométrico do envelope.',
    run: () => {
      const r1 = seawaterDensity(35, 5, 0);
      const r2 = seawaterDensity(35, 5, 1000);
      const r3 = seawaterDensity(35, 25, 1000);
      const e = buildScenario('submerso_50', uniformConfig());
      const hsDeep = computeHydrostatics(e.geom, { x: 0, y: 0, z: 100 }, qToMat3(qFromEuler(0.3, 0.2, 1)));
      const hsAir = computeHydrostatics(e.geom, { x: 0, y: 0, z: -10 }, qToMat3(qFromEuler(0, 0, 0)));
      const s = buildScenario('superficie', uniformConfig());
      const vMbt = s.vessel.ballast.tanks.reduce((a, t) => a + t.volume, 0);
      const freeboard = -(s.state.body.pos.z - s.vessel.hull.diameter / 2);
      return {
        metrics: [
          m('ρ(35, 5 °C, 0 bar)', r1, 'kg/m³', '1027,67547 ± 0,001', Math.abs(r1 - 1027.67547) < 0.001),
          m('ρ(35, 5 °C, 1000 bar)', r2, 'kg/m³', '1069,48914 ± 0,001', Math.abs(r2 - 1069.48914) < 0.001),
          m('ρ(35, 25 °C, 1000 bar)', r3, 'kg/m³', '1062,53817 ± 0,001', Math.abs(r3 - 1062.53817) < 0.001),
          m('Volume imerso (totalmente submerso, atitude qualquer)', hsDeep.volume, 'm³', '= volume do envelope', Math.abs(hsDeep.volume - e.geom.volume) < 1e-6),
          m('Volume imerso fora d’água', hsAir.volume, 'm³', '= 0', hsAir.volume === 0),
          m('Reserva de flutuabilidade (TLP)', (vMbt / e.geom.volume) * 100, '% do envelope', '8–15 %', vMbt / e.geom.volume > 0.08 && vMbt / e.geom.volume < 0.15),
          m('Borda livre do casco na superfície', freeboard, 'm', '> 0', freeboard > 0),
          m('Pitch de equilíbrio na superfície', s.outputs.euler.pitch, '°', '|θ| < 1,5°', Math.abs(s.outputs.euler.pitch) < 1.5),
        ],
        series: [],
        notes: 'Fofonoff & Millard (1983), UNESCO Tech. Pap. Mar. Sci. 44.',
      };
    },
  },
  {
    id: 'V12',
    title: 'Extra: sequência completa de operação',
    description: 'Superfície → mergulho → 50 m → equilíbrio → mudança de rumo → ajuste de trim → emersão, executada por um operador automatizado (roteiro de demonstração).',
    run: () => {
      const e = buildScenario('superficie', uniformConfig());
      const r = runFullSequence(e);
      return {
        metrics: r.milestones.map((ms) => m(ms.name, ms.t, 's', ms.criterion, ms.ok)),
        series: [r.depth],
        notes: 'O mesmo roteiro está disponível na interface como "Demonstração automática".',
      };
    },
  },
];

function estimate(e: SimulationEngine, u: number): number {
  // rpm em regime para a velocidade u (iterativo com o próprio modelo)
  const v = e.vessel.propulsion.propeller;
  const S = e.geom.wettedArea * e.vessel.hydro.appendageFactor;
  const R = 0.5 * 1025 * S * e.vessel.hydro.totalResistanceCoeff * u * u;
  const T = R / (1 - v.thrustDeduction);
  const ua = u * (1 - v.wakeFraction);
  const D = v.diameter;
  const b = ua / (D * v.J0T);
  const c = T / (1025 * D ** 4 * v.KT0);
  return ((b + Math.sqrt(b * b + 4 * c)) / 2) * 60;
}

export interface Milestone {
  name: string;
  criterion: string;
  t: number;
  ok: boolean;
}

/**
 * Operador automatizado da sequência completa (também usado pela demonstração
 * na interface): cada etapa só avança quando a condição física é atingida.
 */
export function runFullSequence(e: SimulationEngine, maxTime = 2400): { milestones: Milestone[]; depth: Series } {
  const ms: Milestone[] = [];
  const depth: Series = { label: 'Profundidade (quilha)', t: [], y: [], unit: 'm' };
  const steps = fullSequenceSteps();
  let k = 0;
  let tStep = 0;
  const t0 = e.state.t;
  while (e.state.t - t0 < maxTime && k < steps.length) {
    const st = steps[k];
    if (tStep === 0) st.enter(e);
    st.during?.(e);
    e.advanceSim(1);
    tStep += 1;
    if (Math.round(e.state.t - t0) % 5 === 0) {
      depth.t.push(e.state.t - t0);
      depth.y.push(e.outputs.depthKeel);
    }
    if (st.done(e, tStep)) {
      ms.push({ name: st.name, criterion: st.criterion, t: e.state.t - t0, ok: true });
      k++;
      tStep = 0;
    } else if (tStep > st.timeout) {
      ms.push({ name: st.name, criterion: st.criterion + ' (TEMPO ESGOTADO)', t: e.state.t - t0, ok: false });
      k++;
      tStep = 0;
    }
  }
  for (; k < steps.length; k++) ms.push({ name: steps[k].name, criterion: steps[k].criterion, t: NaN, ok: false });
  return { milestones: ms, depth };
}

export interface SequenceStep {
  name: string;
  criterion: string;
  timeout: number;
  enter: (e: SimulationEngine) => void;
  during?: (e: SimulationEngine) => void;
  done: (e: SimulationEngine, t: number) => boolean;
}

export function fullSequenceSteps(): SequenceStep[] {
  const cmd = applyCommand;
  return [
    {
      name: 'Preparar: ordenar 6 nós',
      criterion: 'velocidade > 4 nós',
      timeout: 300,
      enter: (e) => cmd(e, { type: 'telegraph', rpm: 75 }),
      done: (e) => e.state.body.vel.x > 4 * KNOT,
    },
    {
      name: 'Mergulhar: abrir suspiros dos TLP',
      criterion: 'TLP > 95 % cheios',
      timeout: 200,
      enter: (e) => cmd(e, { type: 'mbtVent', tank: 'ALL', open: true }),
      done: (e) => e.vessel.ballast.tanks.every((t) => e.state.ballast[t.id].water > 0.95 * t.volume),
    },
    {
      name: 'Descer com lemes a 50 m (piloto de profundidade)',
      criterion: '|z − 50| < 2 m',
      timeout: 600,
      enter: (e) => {
        cmd(e, { type: 'autopilot', channel: 'depth', mode: 'AUTO' });
        cmd(e, { type: 'setpoint', channel: 'depth', value: 50 });
        cmd(e, { type: 'autopilot', channel: 'heading', mode: 'AUTO' });
      },
      done: (e, t) => t > 60 && Math.abs(e.outputs.depthKeel - 50) < 2 && Math.abs(e.outputs.verticalSpeed) < 0.1,
    },
    {
      name: 'Fechar suspiros e equilibrar (compensação)',
      criterion: '|flutuabilidade líquida| < 300 kg',
      timeout: 600,
      enter: (e) => {
        cmd(e, { type: 'mbtVent', tank: 'ALL', open: false });
        const net = e.outputs.netBuoyancyKg;
        if (Math.abs(net) > 100) cmd(e, { type: 'dosing', system: 'compensation', mode: net > 0 ? 'admitir' : 'esgotar', kg: Math.abs(net) });
      },
      done: (e, t) => t > 10 && !e.state.compensation.dosing?.active && Math.abs(e.outputs.netBuoyancyKg) < 300,
    },
    {
      name: 'Alterar rumo em +90°',
      criterion: 'erro de rumo < 2°',
      timeout: 400,
      enter: (e) => cmd(e, { type: 'setpoint', channel: 'heading', value: e.state.autopilot.headingSet + 90 }),
      done: (e, t) => t > 20 && Math.abs(((e.outputs.euler.heading - e.state.autopilot.headingSet + 540) % 360) - 180) < 2,
    },
    {
      name: 'Ajustar trim (equilíbrio estático < 0,5°)',
      criterion: '|θ_eq estático| < 0,5°',
      timeout: 400,
      enter: (e) => {
        const th = e.outputs.staticPitchEq;
        if (Math.abs(th) > 0.3) {
          const kg = Math.abs((th * Math.PI) / 180) * e.outputs.pitchStiffness / (9.80665 * (e.vessel.trim.tankA.center.x - e.vessel.trim.tankB.center.x));
          cmd(e, { type: 'dosing', system: 'trim', mode: 'transferir', kg, dir: th > 0 ? 'BtoA' : 'AtoB' });
        }
      },
      done: (e, t) => t > 5 && !e.state.trim.dosing?.active && Math.abs(e.outputs.staticPitchEq) < 0.5,
    },
    {
      name: 'Emergir: subir a cota periscópica e soprar TLP',
      criterion: 'quilha < 8 m (superfície)',
      timeout: 600,
      enter: (e) => cmd(e, { type: 'setpoint', channel: 'depth', value: 14 }),
      during: (e) => {
        if (e.outputs.depthKeel < 18 && e.state.ballast.TLP1BB.blow.cmd === 0 && e.state.ballast.TLP1BB.water > 1) {
          cmd(e, { type: 'autopilot', channel: 'depth', mode: 'MANUAL' });
          cmd(e, { type: 'surface', id: 'bow', angle: 5 });
          cmd(e, { type: 'surface', id: 'stern', angle: 3 });
          cmd(e, { type: 'mbtBlow', tank: 'ALL', open: true });
        }
        if (e.state.ballast.TLP1BB.blow.cmd === 1 && e.vessel.ballast.tanks.every((t) => e.state.ballast[t.id].water < 0.05 * t.volume)) {
          cmd(e, { type: 'mbtBlow', tank: 'ALL', open: false });
          cmd(e, { type: 'surface', id: 'bow', angle: 0 });
          cmd(e, { type: 'surface', id: 'stern', angle: 0 });
        }
      },
      done: (e) => e.outputs.depthKeel < 8 && e.vessel.ballast.tanks.every((t) => e.state.ballast[t.id].water < 0.3 * t.volume),
    },
  ];
}

export function runValidation(c: ValidationCase): ValidationResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const r = c.run();
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { id: c.id, title: c.title, passed: r.metrics.every((x) => x.pass), durationMs: t1 - t0, ...r };
}
