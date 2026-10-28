/**
 * CHECKLIST DO PROCEDIMENTO — acompanhado continuamente (no laço principal,
 * mesmo com o painel fechado) e salvo no navegador.
 *
 * Cada etapa distingue:
 *  - "preexistente": a condição já era verdadeira quando o checklist começou
 *    (não foi realizada pelo operador nesta sessão);
 *  - "realizada": a condição passou a ser verdadeira durante a sessão (com o
 *    instante de simulação em que isso ocorreu);
 *  - "pendente".
 */
import type { SimRunner } from '../sim/core/runner';
import type { SimulationEngine } from '../sim/core/engine';
import { KNOT } from '../sim/units';

export interface ProcStep {
  title: string;
  hint: string;
  ok: (e: SimulationEngine, ctx: { h0: number }) => boolean;
}

const tanksFill = (e: SimulationEngine) => e.vessel.ballast.tanks.reduce((a, t) => a + e.state.ballast[t.id].water, 0) / e.vessel.ballast.tanks.reduce((a, t) => a + t.volume, 0);

export const PROCEDURE: ProcStep[] = [
  { title: 'Preparar: ordenar seguimento ≥ 4 nós (7.4 km/h)', hint: 'Telégrafo AV MEIA (75 rpm). Os lemes precisam de escoamento para atuar.', ok: (e) => e.state.body.vel.x > 4 * KNOT },
  { title: 'Abrir os suspiros dos TLP', hint: 'Lastro → "Abrir suspiros". O ar escapa e a água entra pelos embornais.', ok: (e) => e.vessel.ballast.tanks.some((t) => e.state.ballast[t.id].vent.pos > 0.9) || tanksFill(e) > 0.95 },
  { title: 'TLP alagados (> 95 %)', hint: 'A reserva de flutuabilidade desaparece; o submarino fica próximo do neutro.', ok: (e) => tanksFill(e) > 0.95 },
  { title: 'Descer com os lemes abaixo de 20 m', hint: 'Lemes de vante a DESCER e de ré levemente a DESCER (ou piloto de profundidade).', ok: (e) => e.outputs.depthKeel > 20 },
  { title: 'Fechar os suspiros', hint: 'Evita perda de ar e prepara o sopro de emersão.', ok: (e) => e.vessel.ballast.tanks.every((t) => e.state.ballast[t.id].vent.cmd < 0.5) && e.outputs.depthKeel > 15 },
  { title: 'Estabilizar na cota (|ż| < 0,1 m/s)', hint: 'Nivelar com os lemes ou usar o piloto automático de profundidade.', ok: (e) => e.outputs.depthKeel > 20 && Math.abs(e.outputs.verticalSpeed) < 0.1 && Math.abs(e.outputs.euler.pitch) < 3 },
  { title: 'Equilíbrio hidrostático (|flutuab.| < 300 kg)', hint: 'Compensação: "Executar ajuste calculado" ou dosagens manuais.', ok: (e) => e.outputs.depthKeel > 15 && Math.abs(e.outputs.netBuoyancyKg) < 300 },
  { title: 'Trim estático corrigido (|θ_eq| < 0,5°)', hint: 'Trim: transferir água entre TT-AV e TT-AR conforme a previsão.', ok: (e) => e.outputs.depthKeel > 15 && Math.abs(e.outputs.staticPitchEq) < 0.5 },
  { title: 'Banda corrigida (|φ_eq| < 0,3°)', hint: 'Banda: transferir água entre TB-BB e TB-BE.', ok: (e) => e.outputs.depthKeel > 15 && Math.abs(e.outputs.staticRollEq) < 0.3 },
  { title: 'Alterar o rumo em pelo menos 30°', hint: 'Leme de direção a BE/BB ou piloto de rumo com nova referência.', ok: (e, c) => e.outputs.depthKeel > 15 && Math.abs(((e.outputs.euler.heading - c.h0 + 540) % 360) - 180) > 30 },
  { title: 'Subir à cota periscópica (< 18 m)', hint: 'Lemes a SUBIR ou piloto de profundidade com 14 m.', ok: (e) => e.outputs.depthKeel < 18 && e.state.t > 60 && tanksFill(e) > 0.5 },
  { title: 'Soprar os TLP e emergir (quilha < 8 m)', hint: 'Lastro → "Soprar TLP"; fechar o sopro quando vazios.', ok: (e) => e.outputs.depthKeel < 8 && tanksFill(e) < 0.3 && e.state.t > 120 },
];

export type ProcStatus = 'pendente' | 'preexistente' | 'realizada';

interface Saved {
  scenarioId: string;
  t0: number;
  tSaved: number;
  h0: number;
  status: ProcStatus[];
  tDone: (number | null)[];
}

const KEY = 'sx1.checklist.v1';

export class ChecklistTracker {
  status: ProcStatus[] = PROCEDURE.map(() => 'pendente');
  tDone: (number | null)[] = PROCEDURE.map(() => null);
  h0 = 0;
  t0 = 0;
  version = 0;
  private engine: SimulationEngine | null = null;
  private lastEval = -1;

  /** Reinicia a partir da condição atual (as condições já verdadeiras ficam como "preexistentes"). */
  reset(e: SimulationEngine): void {
    this.engine = e;
    this.h0 = e.outputs.euler.heading;
    this.t0 = e.state.t;
    this.status = PROCEDURE.map((s) => (s.ok(e, { h0: this.h0 }) ? 'preexistente' : 'pendente'));
    this.tDone = PROCEDURE.map(() => null);
    this.version++;
    this.save();
  }

  private save(): void {
    if (!this.engine) return;
    const d: Saved = { scenarioId: this.engine.state.scenarioId, t0: this.t0, tSaved: this.engine.state.t, h0: this.h0, status: this.status, tDone: this.tDone };
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      /* sem armazenamento */
    }
  }

  /** Motor novo: retoma o checklist salvo se for a mesma sessão (estado retomado), senão reinicia. */
  private adopt(e: SimulationEngine): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw && e.state.t > 0) {
        const d = JSON.parse(raw) as Saved;
        if (d.scenarioId === e.state.scenarioId && d.t0 <= e.state.t && Array.isArray(d.status) && d.status.length === PROCEDURE.length) {
          this.engine = e;
          this.status = d.status;
          this.tDone = d.tDone.map((x) => (x !== null && x <= e.state.t ? x : null));
          this.status = this.status.map((s, i) => (s === 'realizada' && this.tDone[i] === null ? 'pendente' : s));
          this.h0 = d.h0;
          this.t0 = d.t0;
          this.version++;
          return;
        }
      }
    } catch {
      /* ignora dados inválidos */
    }
    this.reset(e);
  }

  snapshot(): Saved | null {
    if (!this.engine) return null;
    return { scenarioId: this.engine.state.scenarioId, t0: this.t0, tSaved: this.engine.state.t, h0: this.h0, status: [...this.status], tDone: [...this.tDone] };
  }

  /** adota o checklist salvo junto com a sessão (ou reinicia se não houver) */
  restore(e: SimulationEngine, d: Partial<Saved> | null | undefined): void {
    if (d && Array.isArray(d.status) && d.status.length === PROCEDURE.length && Array.isArray(d.tDone)) {
      this.engine = e;
      this.status = d.status as ProcStatus[];
      this.tDone = d.tDone as (number | null)[];
      this.h0 = Number(d.h0 ?? e.outputs.euler.heading);
      this.t0 = Number(d.t0 ?? e.state.t);
      this.version++;
      this.save();
    } else this.reset(e);
  }

  tick(r: SimRunner): void {
    const e = r.engine;
    if (e !== this.engine) this.adopt(e);
    const t = e.state.t;
    if (t === this.lastEval) return;
    this.lastEval = t;
    let changed = false;
    PROCEDURE.forEach((s, i) => {
      if (this.status[i] !== 'pendente') return;
      if (s.ok(e, { h0: this.h0 })) {
        this.status[i] = 'realizada';
        this.tDone[i] = t;
        changed = true;
      }
    });
    if (changed) {
      this.version++;
      this.save();
    }
  }

  get current(): number {
    return this.status.findIndex((s) => s === 'pendente');
  }
}

export const checklist = new ChecklistTracker();
