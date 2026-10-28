/**
 * REGISTRO HISTÓRICO — amostragem periódica (tempo de simulação) das variáveis
 * principais em buffers circulares, para gráficos sincronizados.
 */
import type { SimulationEngine } from './core/engine';
import { toKnots } from './units';
import { bankPressure } from './systems/hpAir';
import { tankVolume } from './systems/internalTanks';

export interface ChannelDef {
  id: string;
  label: string;
  unit: string;
  get: (e: SimulationEngine) => number;
  kind: 'MED' | 'CALC' | 'CMD' | 'VERD';
}

export const CHANNELS: ChannelDef[] = [
  { id: 'depth', label: 'Profundidade (quilha)', unit: 'm', kind: 'VERD', get: (e) => e.outputs.depthKeel },
  { id: 'depthInd', label: 'Profundidade indicada', unit: 'm', kind: 'MED', get: (e) => 0.5 * (e.state.sensors.PRF1.value + e.state.sensors.PRF2.value) },
  { id: 'depthSet', label: 'Profundidade ordenada', unit: 'm', kind: 'CMD', get: (e) => (e.state.autopilot.depthMode === 'AUTO' ? e.state.autopilot.depthSet : NaN) },
  { id: 'bottom', label: 'Fundo', unit: 'm', kind: 'VERD', get: (e) => e.outputs.bottomDepth },
  { id: 'vz', label: 'Velocidade vertical (+ desc.)', unit: 'm/s', kind: 'VERD', get: (e) => e.outputs.verticalSpeed },
  { id: 'speed', label: 'Velocidade', unit: 'nós', kind: 'VERD', get: (e) => toKnots(e.state.body.vel.x) },
  { id: 'speedKmh', label: 'Velocidade', unit: 'km/h', kind: 'VERD', get: (e) => e.state.body.vel.x * 3.6 },
  { id: 'rpm', label: 'RPM do eixo', unit: 'rpm', kind: 'MED', get: (e) => e.outputs.rpm },
  { id: 'rpmCmd', label: 'RPM ordenada', unit: 'rpm', kind: 'CMD', get: (e) => e.state.propulsion.rpmCmd },
  { id: 'heading', label: 'Rumo', unit: '°', kind: 'VERD', get: (e) => e.outputs.euler.heading },
  { id: 'headingSet', label: 'Rumo ordenado', unit: '°', kind: 'CMD', get: (e) => (e.state.autopilot.headingMode === 'AUTO' ? e.state.autopilot.headingSet : NaN) },
  { id: 'pitch', label: 'Pitch', unit: '°', kind: 'VERD', get: (e) => e.outputs.euler.pitch },
  { id: 'pitchEq', label: 'Pitch de equilíbrio estático', unit: '°', kind: 'CALC', get: (e) => e.outputs.staticPitchEq },
  { id: 'roll', label: 'Banda', unit: '°', kind: 'VERD', get: (e) => e.outputs.euler.roll },
  { id: 'mbt', label: 'Água nos TLP', unit: 'm³', kind: 'VERD', get: (e) => Object.values(e.state.ballast).reduce((a, t) => a + t.water, 0) },
  { id: 'comp', label: 'Água de compensação', unit: 'm³', kind: 'VERD', get: (e) => Object.values(e.state.compensation.tanks).reduce((a, t) => a + tankVolume(t), 0) },
  { id: 'trimA', label: 'TT-AV', unit: 'm³', kind: 'VERD', get: (e) => tankVolume(e.state.trim.tankA) },
  { id: 'trimB', label: 'TT-AR', unit: 'm³', kind: 'VERD', get: (e) => tankVolume(e.state.trim.tankB) },
  { id: 'heelA', label: 'TB-BB', unit: 'm³', kind: 'VERD', get: (e) => tankVolume(e.state.heel.tankA) },
  { id: 'heelB', label: 'TB-BE', unit: 'm³', kind: 'VERD', get: (e) => tankVolume(e.state.heel.tankB) },
  { id: 'net', label: 'Flutuabilidade líquida', unit: 't', kind: 'CALC', get: (e) => e.outputs.netBuoyancyKg / 1000 },
  { id: 'bowCmd', label: 'Lemes vante (cmd)', unit: '°', kind: 'CMD', get: (e) => e.state.surfaces.bow.cmd },
  { id: 'bow', label: 'Lemes vante (real)', unit: '°', kind: 'MED', get: (e) => e.state.surfaces.bow.actual },
  { id: 'sternCmd', label: 'Lemes ré (cmd)', unit: '°', kind: 'CMD', get: (e) => e.state.surfaces.stern.cmd },
  { id: 'stern', label: 'Lemes ré (real)', unit: '°', kind: 'MED', get: (e) => e.state.surfaces.stern.actual },
  { id: 'rudderCmd', label: 'Leme direção (cmd)', unit: '°', kind: 'CMD', get: (e) => e.state.surfaces.rudder.cmd },
  { id: 'rudder', label: 'Leme direção (real)', unit: '°', kind: 'MED', get: (e) => e.state.surfaces.rudder.actual },
  { id: 'soc', label: 'Carga da bateria', unit: '%', kind: 'CALC', get: (e) => e.state.electrical.soc * 100 },
  { id: 'power', label: 'Demanda elétrica total', unit: 'kW', kind: 'MED', get: (e) => e.state.electrical.totalLoad / 1000 },
  { id: 'hp', label: 'Pressão AP (grupo 1)', unit: 'bar', kind: 'MED', get: (e) => bankPressure(e.vessel.hpAir, e.vessel.hpAir.banks[0].id, e.state.hpAir.banks[e.vessel.hpAir.banks[0].id].mass) / 1e5 },
  { id: 'rho', label: 'Densidade local', unit: 'kg/m³', kind: 'CALC', get: (e) => e.outputs.rhoLocal },
];

export interface HistorySnapshot {
  t: Float64Array;
  data: Record<string, Float32Array>;
  count: number;
  head: number;
  lastT: number;
}

export class HistoryRecorder {
  readonly capacity: number;
  readonly interval: number;
  t: Float64Array;
  data: Record<string, Float32Array>;
  count = 0;
  head = 0; // próxima posição de escrita
  private lastT = -Infinity;
  version = 0;

  constructor(capacity = 7200, interval = 1.0) {
    this.capacity = capacity;
    this.interval = interval;
    this.t = new Float64Array(capacity);
    this.data = {};
    for (const c of CHANNELS) this.data[c.id] = new Float32Array(capacity);
  }

  clear(): void {
    this.count = 0;
    this.head = 0;
    this.lastT = -Infinity;
    this.version++;
  }

  sample(e: SimulationEngine, force = false): void {
    const t = e.state.t;
    if (!force && t - this.lastT < this.interval - 1e-9) return;
    this.lastT = t;
    const i = this.head;
    this.t[i] = t;
    for (const c of CHANNELS) this.data[c.id][i] = c.get(e);
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    this.version++;
  }

  /** cópia do registro (janela de tela espelhada recebe o histórico da janela de controle) */
  snapshot(): HistorySnapshot {
    return { t: this.t.slice(), data: Object.fromEntries(Object.entries(this.data).map(([k, v]) => [k, v.slice()])), count: this.count, head: this.head, lastT: this.lastT };
  }

  /** substitui o registro por uma cópia (mesma capacidade) */
  restore(h: HistorySnapshot): void {
    if (h.t.length !== this.capacity) return;
    this.t = h.t;
    for (const c of CHANNELS) if (h.data[c.id]?.length === this.capacity) this.data[c.id] = h.data[c.id];
    this.count = h.count;
    this.head = h.head;
    this.lastT = h.lastT;
    this.version++;
  }

  /** Índice físico da k-ésima amostra em ordem cronológica. */
  idx(k: number): number {
    return (this.head - this.count + k + this.capacity) % this.capacity;
  }

  /** Valor interpolado de um canal no tempo t. */
  valueAt(id: string, t: number): number {
    if (this.count === 0) return NaN;
    let lo = 0;
    let hi = this.count - 1;
    if (t <= this.t[this.idx(0)]) return this.data[id][this.idx(0)];
    if (t >= this.t[this.idx(hi)]) return this.data[id][this.idx(hi)];
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.t[this.idx(m)] <= t) lo = m;
      else hi = m;
    }
    const t0 = this.t[this.idx(lo)];
    const t1 = this.t[this.idx(hi)];
    const a = (t - t0) / Math.max(1e-9, t1 - t0);
    return this.data[id][this.idx(lo)] * (1 - a) + this.data[id][this.idx(hi)] * a;
  }

  toCSV(): string {
    const head = ['t_s', ...CHANNELS.map((c) => `${c.id}_${c.unit}`)].join(';');
    const rows = [head];
    for (let k = 0; k < this.count; k++) {
      const i = this.idx(k);
      rows.push([this.t[i].toFixed(1), ...CHANNELS.map((c) => (Number.isFinite(this.data[c.id][i]) ? this.data[c.id][i].toFixed(4) : ''))].join(';'));
    }
    return rows.join('\n');
  }
}
