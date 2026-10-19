/**
 * CENÁRIOS GUIADOS — roteiros automáticos e narrados, executados com calma,
 * etapa por etapa. Diferem dos cenários (condições iniciais) e das manobras
 * rápidas: aqui o simulador conduz a operação sozinho, explica o que está
 * acontecendo com os valores ao vivo, troca câmera e camadas a cada etapa e
 * espera um tempo mínimo de leitura antes de avançar.
 *
 * Os roteiros apenas EMITEM COMANDOS (registrados, como os do operador); toda
 * a resposta é a da física. Cada etapa só avança quando a condição física é
 * atingida (ou por tempo esgotado, que fica registrado).
 */
import type { SimRunner } from '../sim/core/runner';
import type { SimulationEngine } from '../sim/core/engine';
import { applyCommand, type Command } from '../sim/commands';
import { verticalBalance, hydroArrows, toTf } from '../sim/forceVectors';
import { toKnots } from '../sim/units';
import type { SceneLayers } from '../render3d/layers';
import type { ViewMode } from '../render3d/SubmarineScene';
import { pres } from './presentation';

export interface TourCtx {
  send: (c: Command) => void;
  /** valores guardados entre etapas (ex.: peso inicial) */
  mem: Record<string, number>;
}

export interface TourStep {
  title: string;
  /** narração (o que está acontecendo), com valores ao vivo */
  text: (e: SimulationEngine, ctx: TourCtx) => string;
  /** explicação física curta (por que acontece) */
  why?: string;
  enter?: (e: SimulationEngine, ctx: TourCtx) => void;
  view?: ViewMode;
  layers?: Partial<SceneLayers>;
  timeScale?: number;
  /** condição física para concluir a etapa */
  done: (e: SimulationEngine, tStep: number, ctx: TourCtx) => boolean;
  /** descrição da condição (mostrada enquanto aguarda) */
  waitFor: string;
  /** tempo mínimo de leitura (s reais, com a simulação rodando) */
  minDwell: number;
  /** limite em tempo de simulação (s) */
  timeout: number;
}

export interface Tour {
  id: string;
  name: string;
  description: string;
  scenario: string;
  sea?: number;
  steps: TourStep[];
}

export type TourOutcome = 'pendente' | 'em curso' | 'concluída' | 'tempo esgotado' | 'pulada';

// --------------------------------------------------------------- utilitários
const f1 = (x: number, d = 1) => x.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d });
const mbtFill = (e: SimulationEngine) => e.vessel.ballast.tanks.reduce((a, t) => a + e.state.ballast[t.id].water, 0) / e.vessel.ballast.tanks.reduce((a, t) => a + t.volume, 0);
const mbtIds = (e: SimulationEngine) => e.vessel.ballast.tanks.map((t) => t.id);
const PE = (e: SimulationEngine) => {
  const vb = verticalBalance(e);
  return { P: toTf(vb.weightN, vb.g), E: toTf(vb.buoyancyN, vb.g), R: toTf(vb.netN, vb.g), imm: vb.immersedFraction * 100, vb };
};
const hydro = (e: SimulationEngine, id: string) => (hydroArrows(e).find((h) => h.id === id)?.magnitudeN ?? 0) / 1000;

// --------------------------------------------------------------- roteiros
export const TOURS: Tour[] = [
  {
    id: 'submergir50',
    name: 'Submergir e descer para 50 m',
    description: 'Da superfície até a cota de 50 m, com o simulador conduzindo tudo: seguimento, alagamento dos TLP, fechamento dos suspiros, descida com os lemes, nivelamento e equilíbrio pela compensação.',
    scenario: 'superficie',
    sea: 1,
    steps: [
      {
        title: 'Situação inicial: flutuando na superfície',
        view: 'forcas',
        layers: { vectors: true, hydroVectors: false, trimVectors: false, tanks: true, pipes: true, flows: true, labels: true, wake: true, markers: false, highlight: null, tankFilter: null },
        timeScale: 1,
        enter: (e, c) => {
          c.mem.P0 = PE(e).P;
        },
        text: (e) => {
          const v = PE(e);
          return `O submarino está parado na superfície. Os tanques de lastro principal (TLP, em azul) estão cheios de ar e os suspiros fechados. O empuxo E = ${f1(v.E)} tf equilibra o peso P = ${f1(v.P)} tf, com ${f1(v.imm)} % do casco imerso. A reserva de flutuabilidade é de ${f1(e.outputs.reserveKg / 1000)} t: é a água que precisa entrar para o submarino submergir por completo.`;
        },
        why: 'Flutuar = peso igual ao empuxo. Na superfície, parte do casco fica fora d’água; o empuxo corresponde só ao volume imerso.',
        waitFor: 'leitura',
        done: () => true,
        minDwell: 14,
        timeout: 60,
      },
      {
        title: 'Ganhar seguimento (velocidade)',
        view: 'superficie',
        layers: { vectors: false, hydroVectors: true, tanks: false, wake: true, markers: true, labels: true },
        timeScale: 2,
        enter: (_e, c) => c.send({ type: 'telegraph', rpm: 75 }),
        text: (e) => `Telégrafo em AVANTE MEIA (75 rpm). O hélice empurra com ${f1(hydro(e, 'prop'))} kN e a água resiste com ${f1(hydro(e, 'drag'))} kN. Pela massa de ~${f1(e.outputs.mp.mass / 1000, 0)} t o casco acelera devagar: ${f1(toKnots(e.state.body.vel.x))} nós. Repare na esteira, na onda de proa e no rastro do hélice.`,
        why: 'Os lemes de profundidade só geram força com escoamento (∝ U²). Por isso o mergulho é feito em movimento.',
        waitFor: 'velocidade acima de 4 nós',
        done: (e) => toKnots(e.state.body.vel.x) > 4,
        minDwell: 12,
        timeout: 400,
      },
      {
        title: 'Abrir os suspiros dos TLP',
        view: 'tanques',
        layers: { vectors: true, hydroVectors: false, tanks: true, pipes: true, flows: true, labels: true, wake: true, markers: false, highlight: null },
        timeScale: 1,
        enter: (e, c) => {
          pres.setLayers({ tankFilter: mbtIds(e) });
          c.send({ type: 'mbtVent', tank: 'ALL', open: true });
        },
        text: (e, c) => {
          const v = PE(e);
          return `Suspiros abertos: o ar escapa pelo topo dos TLP (jatos brancos sobre o casco) e a água do mar entra pelos embornais no fundo (setas azuis). Os TLP estão ${f1(mbtFill(e) * 100, 0)} % cheios (${f1(v.vb.mbtWaterKg / 1000)} t de água). O peso subiu ${f1(v.P - (c.mem.P0 ?? v.P))} tf e o casco afunda: o empuxo acompanha (${f1(v.E)} tf) porque mais volume fica imerso (${f1(v.imm)} %).`;
        },
        why: 'A água só entra se o ar puder sair: o suspiro é a “tampa” do tanque; o embornal no fundo fica sempre aberto para o mar.',
        waitFor: 'TLP mais da metade cheios',
        done: (e) => mbtFill(e) > 0.5,
        minDwell: 14,
        timeout: 300,
      },
      {
        title: 'TLP cheios: a reserva de flutuabilidade acabou',
        view: 'forcas',
        timeScale: 1,
        text: (e) => {
          const v = PE(e);
          return `Os TLP estão ${f1(mbtFill(e) * 100, 0)} % cheios. Reserva de flutuabilidade: ${f1(Math.max(0, e.outputs.reserveKg) / 1000)} t. Com o casco quase todo imerso (${f1(v.imm)} %), o empuxo deixa de crescer e o submarino fica perto do neutro: P = ${f1(v.P)} tf, E = ${f1(v.E)} tf.`;
        },
        why: 'Depois que o casco submerge por completo, o volume deslocado não aumenta mais: o empuxo fica praticamente constante.',
        waitFor: 'TLP acima de 97 %',
        done: (e) => mbtFill(e) > 0.97,
        minDwell: 12,
        timeout: 300,
      },
      {
        title: 'Fechar os suspiros',
        view: 'tanques',
        layers: { tanks: true, pipes: true, flows: true, vectors: false },
        timeScale: 1,
        enter: (_e, c) => c.send({ type: 'mbtVent', tank: 'ALL', open: false }),
        text: (e) => {
          const open = e.vessel.ballast.tanks.filter((t) => e.state.ballast[t.id].vent.pos > 0.05).length;
          return open ? `Fechando as válvulas dos suspiros (${open} ainda em curso, âmbar). Elas levam alguns segundos para fechar.` : 'Suspiros fechados (vermelhos). O pouco ar que restou fica retido e os TLP estão prontos para o sopro na hora de emergir.';
        },
        why: 'Com os suspiros fechados, o ar comprimido do sopro expulsa a água pelos embornais sem escapar por cima.',
        waitFor: 'todas as válvulas de suspiro fechadas',
        done: (e) => e.vessel.ballast.tanks.every((t) => e.state.ballast[t.id].vent.pos < 0.03),
        minDwell: 10,
        timeout: 120,
      },
      {
        title: 'Descer com os lemes até 50 m',
        view: 'submerso',
        layers: { vectors: false, hydroVectors: true, tanks: false, tankFilter: null, markers: true, wake: true, labels: true },
        timeScale: 2,
        enter: (_e, c) => {
          c.send({ type: 'autopilot', channel: 'depth', mode: 'AUTO' });
          c.send({ type: 'setpoint', channel: 'depth', value: 50 });
          c.send({ type: 'autopilot', channel: 'heading', mode: 'AUTO' });
        },
        text: (e) =>
          `Piloto automático de profundidade ordenado para 50 m. Os lemes de vante (${f1(e.state.surfaces.bow.actual, 0)}°) e de ré (${f1(e.state.surfaces.stern.actual, 0)}°) inclinam a proa (pitch ${f1(e.outputs.euler.pitch)}°) e geram forças de ${f1(hydro(e, 'bow'))} kN e ${f1(hydro(e, 'stern'))} kN. Profundidade ${f1(e.outputs.depthKeel)} m, descendo ${f1(e.outputs.verticalSpeed, 2)} m/s.`,
        why: 'Quase neutro, quem controla a profundidade em movimento são os lemes: a força hidrodinâmica é pequena perto do peso, mas basta para vencer o pequeno desequilíbrio.',
        waitFor: 'profundidade acima de 30 m',
        done: (e) => e.outputs.depthKeel > 30,
        minDwell: 12,
        timeout: 600,
      },
      {
        title: 'Chegando à cota e nivelando',
        view: 'piloto',
        layers: { hydroVectors: true, vectors: false },
        timeScale: 2,
        text: (e) => `Perto de 50 m o piloto reduz a razão de descida e nivela o submarino. Profundidade ${f1(e.outputs.depthKeel)} m · ${e.outputs.verticalSpeed >= 0 ? 'descendo' : 'subindo'} ${f1(Math.abs(e.outputs.verticalSpeed), 2)} m/s · pitch ${f1(e.outputs.euler.pitch)}°.`,
        why: 'O controle é em cascata: o erro de profundidade vira um pitch ordenado, e o pitch é obtido com os lemes.',
        waitFor: 'na cota (±1,5 m), estável e nivelado',
        done: (e) => Math.abs(e.outputs.depthKeel - 50) < 1.5 && Math.abs(e.outputs.verticalSpeed) < 0.1 && Math.abs(e.outputs.euler.pitch) < 2,
        minDwell: 12,
        timeout: 600,
      },
      {
        title: 'Equilíbrio hidrostático pela compensação',
        view: 'forcas',
        layers: { vectors: true, hydroVectors: false, tanks: true, pipes: true, flows: true, labels: true, markers: false },
        timeScale: 3,
        enter: (e, c) => {
          pres.setLayers({ tankFilter: e.vessel.compensation.tanks.map((t) => t.id) });
          const net = e.outputs.netBuoyancyKg;
          c.mem.net0 = net;
          if (Math.abs(net) > 250) c.send({ type: 'dosing', system: 'compensation', mode: net > 0 ? 'admitir' : 'esgotar', kg: Math.abs(net) });
        },
        text: (e, c) => {
          const v = PE(e);
          const d = e.state.compensation.dosing;
          const n0 = c.mem.net0 ?? 0;
          const first = Math.abs(n0) > 250 ? `Na cota havia uma resultante de ${f1(n0 / 1000, 2)} t (${n0 > 0 ? 'leve: tende a subir' : 'pesado: tende a descer'}); o piloto compensava com os lemes. A compensação ${n0 > 0 ? 'admite' : 'esgota'} essa água nos tanques TC (verde). ` : 'O submarino chegou praticamente neutro. ';
          return `${first}Agora: E − P = ${f1(v.R, 2)} tf${d && d.active ? ` · dosagem ${f1(d.moved, 0)}/${f1(d.target, 0)} kg` : ''}. Com o casco todo submerso, só o peso muda; o empuxo fica em ${f1(v.E)} tf.`;
        },
        why: 'Submerso, o ajuste fino do peso é feito pelos tanques de compensação: pequenas quantidades de água tornam a resultante nula sem depender dos lemes.',
        waitFor: 'resultante menor que 300 kg e dosagem concluída',
        done: (e) => Math.abs(e.outputs.netBuoyancyKg) < 300 && !(e.state.compensation.dosing && e.state.compensation.dosing.active),
        minDwell: 14,
        timeout: 900,
      },
      {
        title: 'Concluído: submerso e equilibrado a 50 m',
        view: 'submerso',
        layers: { vectors: false, hydroVectors: false, tanks: false, tankFilter: null, markers: true },
        timeScale: 1,
        text: (e) => `Submarino a ${f1(e.outputs.depthKeel)} m, ${f1(toKnots(e.state.body.vel.x))} nós, pitch ${f1(e.outputs.euler.pitch)}°, resultante ${f1(e.outputs.netBuoyancyKg / 1000, 2)} t. Sequência: seguimento → suspiros abertos (TLP alagados) → suspiros fechados → descida com os lemes → nivelamento → compensação.`,
        waitFor: 'leitura',
        done: () => true,
        minDwell: 10,
        timeout: 60,
      },
    ],
  },
];

// --------------------------------------------------------------- controlador
export class TourController {
  tour: Tour | null = null;
  active = false;
  k = 0;
  tStep = 0; // s de simulação na etapa
  dwell = 0; // s reais com a simulação rodando na etapa
  conditionMet = false;
  outcome: TourOutcome[] = [];
  sent: { t: number; text: string; step: number }[] = [];
  finished: { ok: number; timeout: number; skipped: number; duration: number } | null = null;
  private ctx: TourCtx = { send: () => undefined, mem: {} };
  private lastT = 0;
  private t0 = 0;
  private runner: SimRunner | null = null;

  start(r: SimRunner, tour: Tour): void {
    this.runner = r;
    pres.prepare(r, { id: 'tour:' + tour.id, name: tour.name, scenario: tour.scenario, sea: tour.sea, view: tour.steps[0].view ?? 'forcas', layers: tour.steps[0].layers ?? {}, note: tour.description });
    this.tour = tour;
    this.active = true;
    this.k = 0;
    this.outcome = tour.steps.map(() => 'pendente');
    this.sent = [];
    this.finished = null;
    this.ctx = {
      mem: {},
      send: (c) => {
        const e = r.engine;
        const log = e.state.commands;
        const last = log[log.length - 1];
        applyCommand(e, c);
        let i = log.length - 1;
        while (i >= 0 && log[i] !== last) i--;
        for (const rec of log.slice(i + 1)) this.sent.push({ t: rec.t, text: rec.text, step: this.k });
      },
    };
    r.engine.log(`CENÁRIO GUIADO iniciado: ${tour.name}`, 'Cenário guiado');
    this.t0 = r.engine.state.t;
    this.enterStep(r);
    r.running = true;
    r.notify();
  }

  private enterStep(r: SimRunner): void {
    const st = this.tour!.steps[this.k];
    const e = r.engine;
    this.tStep = 0;
    this.dwell = 0;
    this.conditionMet = false;
    this.lastT = e.state.t;
    this.outcome[this.k] = 'em curso';
    e.log(`Cenário guiado — etapa ${this.k + 1}/${this.tour!.steps.length}: ${st.title}`, 'Cenário guiado');
    if (st.layers) pres.setLayers(st.layers);
    if (st.view) pres.setView(st.view);
    if (st.timeScale) r.timeScale = st.timeScale;
    st.enter?.(e, this.ctx);
    e.computeOutputs();
    r.notify();
  }

  get step(): TourStep | null {
    return this.tour && this.active ? this.tour.steps[this.k] : null;
  }

  text(e: SimulationEngine): string {
    const st = this.step;
    return st ? st.text(e, this.ctx) : '';
  }

  pause(r: SimRunner): void {
    r.running = !r.running;
    r.notify();
  }

  /** avança já para a próxima etapa (a atual fica registrada) */
  next(r: SimRunner): void {
    if (!this.active) return;
    this.outcome[this.k] = this.conditionMet ? 'concluída' : 'pulada';
    this.advance(r);
  }

  stop(r: SimRunner): void {
    if (!this.active) return;
    r.engine.log('Cenário guiado encerrado pelo operador', 'Cenário guiado');
    this.outcome[this.k] = 'pulada';
    this.active = false;
    this.summarize(r);
    r.notify();
  }

  private summarize(r: SimRunner): void {
    this.finished = {
      ok: this.outcome.filter((o) => o === 'concluída').length,
      timeout: this.outcome.filter((o) => o === 'tempo esgotado').length,
      skipped: this.outcome.filter((o) => o === 'pulada').length,
      duration: r.engine.state.t - this.t0,
    };
  }

  private advance(r: SimRunner): void {
    this.k++;
    if (this.k >= this.tour!.steps.length) {
      this.active = false;
      this.summarize(r);
      r.engine.log(`Cenário guiado concluído: ${this.finished!.ok}/${this.tour!.steps.length} etapas`, 'Cenário guiado');
      r.timeScale = 1;
      r.notify();
      return;
    }
    this.enterStep(r);
  }

  tick(r: SimRunner, realDt: number): void {
    if (!this.active || !this.tour) return;
    if (r !== this.runner) this.runner = r;
    const e = r.engine;
    const dt = e.state.t - this.lastT;
    this.lastT = e.state.t;
    if (dt < 0) {
      // estado substituído (reinício): encerra
      this.active = false;
      return;
    }
    if (!r.running) return;
    this.tStep += dt;
    this.dwell += Math.min(0.25, realDt);
    const st = this.tour.steps[this.k];
    if (!this.conditionMet && st.done(e, this.tStep, this.ctx)) {
      this.conditionMet = true;
      e.log(`Cenário guiado — etapa ${this.k + 1} cumprida: ${st.waitFor}`, 'Cenário guiado');
      r.notify();
    }
    if (this.conditionMet && this.dwell >= st.minDwell) {
      this.outcome[this.k] = 'concluída';
      this.advance(r);
    } else if (!this.conditionMet && this.tStep > st.timeout) {
      this.outcome[this.k] = 'tempo esgotado';
      e.log(`Cenário guiado — etapa ${this.k + 1}: TEMPO ESGOTADO (${st.waitFor})`, 'Cenário guiado');
      this.advance(r);
    }
  }

  /** segundos reais restantes de leitura antes de avançar */
  get remaining(): number {
    const st = this.step;
    return st ? Math.max(0, st.minDwell - this.dwell) : 0;
  }
}

export const tours = new TourController();
