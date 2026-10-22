/**
 * SOM E ANÚNCIOS (1MC) DA SALA DE COMANDO. Tudo sintetizado no navegador
 * (Web Audio + síntese de voz pt-BR), sem arquivos: zumbido das máquinas
 * (cresce com a rotação), diesel com o snorkel, chiado do ar AP no sopro,
 * buzina de imersão, sino do telégrafo e bipes de alarme crítico. A voz
 * anuncia as ordens e eventos principais, como no fonoclama de bordo.
 * Só LÊ o estado da simulação (comparando instantâneos).
 */
import type { SimulationEngine } from '../../sim/core/engine';
import { ALARM_DEFS } from '../../sim/systems/alarms';
import { nearestOrder } from '../../sim/telegraph';

export interface Snap {
  vents: number;
  blowing: number;
  order: string;
  peri: boolean;
  snorkel: boolean;
  diesel: boolean;
  surfaced: boolean;
  crit: Set<string>;
}

/** ordem do telégrafo falada */
export function sayOrder(label: string): string {
  return label
    .replace('AV DEV.', 'avante devagar')
    .replace('RÉ DEV.', 'a ré devagar')
    .replace('AV ', 'avante ')
    .replace('RÉ ', 'a ré ')
    .replace('3/4', 'três quartos')
    .replace('MEIA', 'meia força')
    .replace('TODA', 'toda força')
    .replace('PARAR', 'parar')
    .toLowerCase();
}

export function roomSnapshot(e: SimulationEngine): Snap {
  const s = e.state;
  const tanks = Object.values(s.ballast);
  const crit = new Set<string>();
  for (const d of ALARM_DEFS) {
    const r = s.alarms.runtime[d.id];
    if (d.priority <= 2 && r?.active && !r.acked) crit.add(d.id);
  }
  return {
    vents: tanks.filter((t) => t.vent.cmd > 0.5).length,
    blowing: tanks.filter((t) => t.blow.pos > 0.1).length,
    order: nearestOrder(s.propulsion.rpmCmd).label,
    peri: !!s.periscope?.cmd,
    snorkel: s.snorkel.cmd,
    diesel: Object.values(s.electrical.generators).some((g) => g.status === 'EM CARGA' || g.status === 'PARTINDO'),
    surfaced: e.outputs.surfaced,
    crit,
  };
}

/** eventos (texto falado + som) entre dois instantâneos */
export function roomEvents(a: Snap, b: Snap): { say: string[]; klaxon: number; bell: boolean } {
  const say: string[] = [];
  let klaxon = 0;
  let bell = false;
  if (a.vents === 0 && b.vents > 0) {
    say.push('Imergir, imergir!');
    klaxon = 2;
  }
  if (a.blowing === 0 && b.blowing > 0) {
    say.push('Soprar lastro. Emergir, emergir!');
    klaxon = 3;
  }
  if (a.order !== b.order) {
    say.push(`Máquinas, ${sayOrder(b.order)}.`);
    bell = true;
  }
  if (a.peri !== b.peri) say.push(b.peri ? 'Içar periscópio.' : 'Arriar periscópio.');
  if (a.snorkel !== b.snorkel) say.push(b.snorkel ? 'Içar o snorkel.' : 'Arriar o snorkel.');
  if (!a.diesel && b.diesel) say.push('Diesel em partida, carregando bateria.');
  if (a.surfaced !== b.surfaced) say.push(b.surfaced ? 'Submarino na superfície.' : 'Vela submersa.');
  for (const id of b.crit) {
    if (!a.crit.has(id)) say.push(`Alarme: ${ALARM_DEFS.find((d) => d.id === id)?.text ?? id}.`);
  }
  return { say, klaxon, bell };
}

export class RoomAudio {
  sound = false;
  voice = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private humGain: GainNode | null = null;
  private dieselGain: GainNode | null = null;
  private hissGain: GainNode | null = null;
  private humOsc: OscillatorNode | null = null;
  private prev: Snap | null = null;
  private lastBeep = 0;

  /** liga/desliga o som (o AudioContext nasce no clique do usuário) */
  setSound(on: boolean): void {
    this.sound = on;
    if (on && !this.ctx) this.init();
    if (this.ctx && this.master) {
      if (on) void this.ctx.resume();
      this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
    }
  }

  setVoice(on: boolean): void {
    this.voice = on;
    if (!on && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  private init(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    // ruído branco (base do chiado e do ronco)
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = () => {
      const n = ctx.createBufferSource();
      n.buffer = buf;
      n.loop = true;
      n.start();
      return n;
    };
    // zumbido do motor elétrico / ventilação
    this.humOsc = ctx.createOscillator();
    this.humOsc.type = 'sawtooth';
    this.humOsc.frequency.value = 48;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0.02;
    this.humOsc.connect(lp).connect(this.humGain).connect(this.master);
    this.humOsc.start();
    const fan = noise();
    const fanLp = ctx.createBiquadFilter();
    fanLp.type = 'lowpass';
    fanLp.frequency.value = 400;
    const fanG = ctx.createGain();
    fanG.gain.value = 0.025;
    fan.connect(fanLp).connect(fanG).connect(this.master);
    // diesel (ronco pulsante)
    const dz = noise();
    const dzLp = ctx.createBiquadFilter();
    dzLp.type = 'lowpass';
    dzLp.frequency.value = 120;
    this.dieselGain = ctx.createGain();
    this.dieselGain.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 11;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.5;
    lfo.connect(lfoG);
    const pulse = ctx.createGain();
    pulse.gain.value = 0.6;
    lfoG.connect(pulse.gain);
    lfo.start();
    dz.connect(dzLp).connect(pulse).connect(this.dieselGain).connect(this.master);
    // chiado do ar AP
    const hs = noise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    hs.connect(hp).connect(this.hissGain).connect(this.master);
  }

  private tone(freq: number, t0: number, dur: number, type: OscillatorType, vol: number, glideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.linearRampToValueAtTime(glideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
    g.gain.setValueAtTime(vol, t0 + dur - 0.05);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  /** buzina de imersão ("a-uu-gá") */
  private klaxon(n: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.05;
    for (let i = 0; i < n; i++) this.tone(220, t + i * 0.9, 0.7, 'square', 0.12, 330);
  }

  private bell(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.02;
    this.tone(1320, t, 0.5, 'sine', 0.12);
    this.tone(1320, t + 0.25, 0.6, 'sine', 0.1);
  }

  private speak(text: string): void {
    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return;
    if (speechSynthesis.pending) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR';
    u.rate = 1.08;
    const v = speechSynthesis.getVoices().find((x) => x.lang?.toLowerCase().startsWith('pt'));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }

  /** chamado algumas vezes por segundo pela tela */
  update(e: SimulationEngine): void {
    const b = roomSnapshot(e);
    const a = this.prev;
    this.prev = b;
    const ctx = this.ctx;
    if (ctx && this.sound) {
      const rpm = Math.abs(e.outputs.rpm) / e.vessel.propulsion.motor.ratedRpm;
      this.humGain?.gain.setTargetAtTime(0.015 + 0.06 * rpm, ctx.currentTime, 0.3);
      this.humOsc?.frequency.setTargetAtTime(40 + 30 * rpm, ctx.currentTime, 0.4);
      this.dieselGain?.gain.setTargetAtTime(b.diesel ? 0.12 : 0, ctx.currentTime, 0.4);
      this.hissGain?.gain.setTargetAtTime(b.blowing ? 0.05 + 0.02 * b.blowing : 0, ctx.currentTime, 0.1);
      if (b.crit.size && performance.now() - this.lastBeep > 1600) {
        this.lastBeep = performance.now();
        this.tone(880, ctx.currentTime + 0.02, 0.18, 'square', 0.07);
        this.tone(880, ctx.currentTime + 0.3, 0.18, 'square', 0.07);
      }
    }
    if (!a) return;
    const ev = roomEvents(a, b);
    if (this.sound) {
      if (ev.klaxon) this.klaxon(ev.klaxon);
      if (ev.bell) this.bell();
    }
    if (this.voice) for (const t of ev.say.slice(0, 2)) this.speak(t);
  }

  dispose(): void {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    void this.ctx?.close();
    this.ctx = null;
  }
}
