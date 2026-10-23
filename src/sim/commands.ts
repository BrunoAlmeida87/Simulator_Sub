/**
 * COMANDOS — única via pela qual a interface (ou um script de cenário) altera
 * a simulação. Cada comando é aplicado entre passos de integração e é
 * registrado em ordem cronológica (tempo de simulação + descrição).
 */
import type { SimulationEngine } from './core/engine';
import type { SensorFailMode } from './core/state';
import { newDosing } from './systems/internalTanks';
import { acknowledgeAlarm } from './systems/alarms';
import { bumplessInit } from './systems/autopilot';
import { sensorDef } from './systems/sensors';

export type FluidSystem = 'compensation' | 'trim' | 'heel';

export type Command =
  | { type: 'compensationRoute'; source: string; destination: string }
  | { type: 'compensationTransferPump'; run: boolean }
  | { type: 'compensationDirection'; reverse?: boolean; position?: 'direta' | 'inversa' }
  | { type: 'mbtVent'; tank: string; open: boolean }
  | { type: 'mbtBlow'; tank: string; open: boolean }
  | { type: 'emergencyBlow' }
  | { type: 'hpBankValve'; bank: string; open: boolean }
  | { type: 'compressor'; run: boolean }
  | { type: 'valve'; system: FluidSystem; valve: string; open: boolean }
  | { type: 'pump'; system: FluidSystem; run: boolean }
  | { type: 'direction'; system: 'trim' | 'heel'; dir: 'AtoB' | 'BtoA' }
  | { type: 'dosing'; system: FluidSystem; mode: 'admitir' | 'esgotar' | 'transferir'; kg: number; dir?: 'AtoB' | 'BtoA' }
  | { type: 'dosingAbort'; system: FluidSystem }
  | { type: 'telegraph'; rpm: number }
  | { type: 'surface'; id: string; angle: number }
  | { type: 'autopilot'; channel: 'heading' | 'depth' | 'pitch'; mode: 'MANUAL' | 'AUTO' }
  | { type: 'setpoint'; channel: 'heading' | 'depth' | 'pitch'; value: number }
  | { type: 'snorkel'; raise: boolean }
  | { type: 'generator'; id: string; run: boolean }
  | { type: 'breaker'; closed: boolean }
  | { type: 'ack'; id: string }
  | { type: 'seaState'; value: number; direction?: number }
  | { type: 'demoWeight'; x?: number; mass?: number }
  | { type: 'failure'; target: string; active: boolean; param?: number | string };

const SYS_NAME: Record<FluidSystem, string> = { compensation: 'Compensação', trim: 'Trim', heel: 'Banda' };

function tankName(e: SimulationEngine, id: string): string {
  return e.vessel.ballast.tanks.find((t) => t.id === id)?.name ?? id;
}

export function applyCommand(e: SimulationEngine, c: Command): void {
  const s = e.state;
  const v = e.vessel;
  const log = (text: string, group: string) => e.log(text, group);
  switch (c.type) {
    case 'compensationRoute': {
      const tr = s.compensation.transfer;
      const valid = [v.heel.tankA.id, v.heel.tankB.id, ...v.compensation.tanks.filter(t => t.id === 'TC0').map(t => t.id)];
      if (!tr || tr.pump.cmd || tr.pump.speed > 0.001 || tr.valveA.pos > 0.001 || tr.valveB.pos > 0.001 || c.source === c.destination || !valid.includes(c.source) || !valid.includes(c.destination)) break;
      tr.source = c.source;
      tr.destination = c.destination;
      log(`Transferência de compensação: ${c.source} ↔ ${c.destination}`, 'Compensação');
      break;
    }
    case 'compensationDirection': {
      const tr = s.compensation.transfer;
      if (!tr) break;
      const position = c.position ?? (c.reverse ? 'inversa' : 'direta');
      if (position !== 'direta' && position !== 'inversa') break;
      tr.direction.cmd = position === 'inversa' ? 1 : 0;
      log(`VDC 4/2: ${position} — ${position === 'inversa' ? 'B → T / P → A' : 'A → T / P → B'}`, 'Compensação');
      break;
    }
    case 'compensationTransferPump': {
      const cs = s.compensation;
      const tr = cs.transfer;
      if (!tr) break;
      if (c.run) {
        if (cs.dosing?.active) { cs.dosing.active = false; cs.dosing.phase = 'abortado'; cs.dosing.message = 'Cancelada para transferência interna'; }
        cs.inlet.cmd = 0;
        cs.discharge.cmd = 0;
        cs.pump.cmd = false;
      }
      tr.valveA.cmd = tr.valveB.cmd = c.run ? 1 : 0;
      tr.pump.cmd = c.run;
      log(`BTC: ${c.run ? 'PARTIR' : 'PARAR'} transferência interna`, 'Compensação');
      break;
    }
    case 'mbtVent': {
      const ids = c.tank === 'ALL' ? v.ballast.tanks.map((t) => t.id) : [c.tank];
      for (const id of ids) s.ballast[id].vent.cmd = c.open ? 1 : 0;
      log(`${c.open ? 'ABRIR' : 'FECHAR'} suspiro ${c.tank === 'ALL' ? 'de todos os TLP' : tankName(e, c.tank)}`, 'Lastro');
      break;
    }
    case 'mbtBlow': {
      const ids = c.tank === 'ALL' ? v.ballast.tanks.map((t) => t.id) : [c.tank];
      for (const id of ids) s.ballast[id].blow.cmd = c.open ? 1 : 0;
      log(`${c.open ? 'ABRIR' : 'FECHAR'} sopro ${c.tank === 'ALL' ? 'de todos os TLP' : tankName(e, c.tank)}`, 'Lastro');
      break;
    }
    case 'emergencyBlow': {
      for (const t of v.ballast.tanks) {
        s.ballast[t.id].vent.cmd = 0;
        s.ballast[t.id].blow.cmd = 1;
      }
      for (const b of v.hpAir.banks) s.hpAir.banks[b.id].valve.cmd = 1;
      log('SOPRO DE EMERGÊNCIA: suspiros fechados, sopro aberto em todos os TLP, grupos AP abertos', 'Lastro');
      break;
    }
    case 'hpBankValve':
      s.hpAir.banks[c.bank].valve.cmd = c.open ? 1 : 0;
      log(`${c.open ? 'ABRIR' : 'FECHAR'} isolamento ${v.hpAir.banks.find((b) => b.id === c.bank)?.name}`, 'Ar AP');
      break;
    case 'compressor':
      s.hpAir.compressorCmd = c.run;
      log(`${c.run ? 'PARTIR' : 'PARAR'} compressor de ar AP`, 'Ar AP');
      break;
    case 'valve': {
      const sysSt = s[c.system];
      if (sysSt.dosing?.active) {
        sysSt.dosing.active = false;
        sysSt.dosing.phase = 'abortado';
        sysSt.dosing.message = 'Sequência cancelada por comando manual';
      }
      const val = c.open ? 1 : 0;
      let name = c.valve;
      if (c.system === 'compensation') {
        const cs = s.compensation;
        if (c.valve === 'inlet') {
          cs.inlet.cmd = val;
          name = v.compensation.inletValve.name;
        } else if (c.valve === 'discharge') {
          cs.discharge.cmd = val;
          name = v.compensation.dischargeValve.name;
        } else if (cs.tankValves[c.valve]) {
          cs.tankValves[c.valve].cmd = val;
          name = v.compensation.tankValves.find((x) => x.id === c.valve)?.name ?? c.valve;
        }
      } else {
        const ts = s[c.system];
        const tc = v[c.system];
        if (c.valve === 'A') {
          ts.valveA.cmd = val;
          name = tc.valveA.name;
        } else if (c.valve === 'B') {
          ts.valveB.cmd = val;
          name = tc.valveB.name;
        }
      }
      log(`${SYS_NAME[c.system]}: ${c.open ? 'ABRIR' : 'FECHAR'} ${name}`, SYS_NAME[c.system]);
      break;
    }
    case 'pump': {
      const sysSt = s[c.system];
      if (sysSt.dosing?.active) {
        sysSt.dosing.active = false;
        sysSt.dosing.phase = 'abortado';
        sysSt.dosing.message = 'Sequência cancelada por comando manual';
      }
      sysSt.pump.cmd = c.run;
      log(`${SYS_NAME[c.system]}: ${c.run ? 'PARTIR' : 'PARAR'} bomba`, SYS_NAME[c.system]);
      break;
    }
    case 'direction': {
      const ts = s[c.system];
      ts.direction.cmd = c.dir === 'BtoA' ? 1 : 0;
      const tc = v[c.system];
      log(`${SYS_NAME[c.system]}: seletor de sentido ${c.dir === 'AtoB' ? tc.tankA.name + ' → ' + tc.tankB.name : tc.tankB.name + ' → ' + tc.tankA.name}`, SYS_NAME[c.system]);
      break;
    }
    case 'dosing': {
      const kg = Math.abs(c.kg);
      if (!Number.isFinite(kg) || kg <= 0 || (c.system === 'compensation' && c.mode === 'transferir')) break;
      if (c.system === 'compensation') {
        if (s.compensation.transfer) { s.compensation.transfer.pump.cmd = false; s.compensation.transfer.valveA.cmd = s.compensation.transfer.valveB.cmd = 0; }
        s.compensation.dosing = newDosing(c.mode, kg);
        log(`Compensação: sequência automática — ${c.mode.toUpperCase()} ${kg.toFixed(0)} kg`, 'Compensação');
      } else {
        s[c.system].dosing = newDosing('transferir', kg, c.dir ?? 'AtoB');
        const tc = v[c.system];
        const d = c.dir === 'BtoA' ? `${tc.tankB.name} → ${tc.tankA.name}` : `${tc.tankA.name} → ${tc.tankB.name}`;
        log(`${SYS_NAME[c.system]}: sequência automática — TRANSFERIR ${kg.toFixed(0)} kg (${d})`, SYS_NAME[c.system]);
      }
      break;
    }
    case 'dosingAbort': {
      const d = s[c.system].dosing;
      if (d && d.active) {
        d.phase = 'finalizando';
        d.message = 'Interrompida pelo operador';
      }
      log(`${SYS_NAME[c.system]}: interromper sequência`, SYS_NAME[c.system]);
      break;
    }
    case 'telegraph': {
      const rated = v.propulsion.motor.ratedRpm;
      s.propulsion.rpmCmd = Math.max(-rated, Math.min(rated, c.rpm));
      log(`Telégrafo: ${c.rpm > 0 ? 'AVANTE' : c.rpm < 0 ? 'A RÉ' : 'PARAR'} ${Math.abs(c.rpm).toFixed(0)} rpm`, 'Propulsão');
      break;
    }
    case 'surface': {
      const st = s.surfaces[c.id];
      if (!st) break;
      const ap = s.autopilot;
      if (c.id === 'rudder' && ap.headingMode === 'AUTO') {
        ap.headingMode = 'MANUAL';
        log('Rumo: piloto automático DESENGAJADO por ação manual no leme', 'Controle automático');
      }
      if ((c.id === 'stern' || c.id === 'bow') && (ap.depthMode === 'AUTO' || (c.id === 'stern' && ap.pitchMode === 'AUTO'))) {
        if (ap.depthMode === 'AUTO') log('Profundidade: piloto automático DESENGAJADO por ação manual nos lemes', 'Controle automático');
        ap.depthMode = 'MANUAL';
        if (c.id === 'stern') ap.pitchMode = 'MANUAL';
      }
      const fin = v.fins.find((f) => f.id === c.id)!;
      st.cmd = Math.max(-fin.maxDeflection, Math.min(fin.maxDeflection, c.angle));
      const dirTxt = c.id === 'rudder' ? (c.angle > 0 ? 'BORESTE' : c.angle < 0 ? 'BOMBORDO' : 'A MEIO') : c.angle > 0 ? 'SUBIR' : c.angle < 0 ? 'DESCER' : 'ZERO';
      log(`${fin.name}: ${Math.abs(st.cmd).toFixed(0)}° ${dirTxt}`, 'Governo');
      break;
    }
    case 'autopilot': {
      const ap = s.autopilot;
      const r = e.apReadings;
      if (c.mode === 'AUTO') bumplessInit(s, c.channel, r);
      if (c.channel === 'heading') ap.headingMode = c.mode;
      else if (c.channel === 'depth') {
        ap.depthMode = c.mode;
        if (c.mode === 'AUTO') ap.pitchMode = 'MANUAL';
      } else {
        ap.pitchMode = c.mode;
        if (c.mode === 'AUTO') ap.depthMode = 'MANUAL';
      }
      const nm = { heading: 'Rumo', depth: 'Profundidade', pitch: 'Atitude (pitch)' }[c.channel];
      log(`${nm}: modo ${c.mode === 'AUTO' ? 'AUTOMÁTICO' : 'MANUAL'}`, 'Controle automático');
      break;
    }
    case 'setpoint': {
      const ap = s.autopilot;
      if (c.channel === 'heading') ap.headingSet = ((c.value % 360) + 360) % 360;
      else if (c.channel === 'depth') ap.depthSet = Math.max(0, c.value);
      else ap.pitchSet = Math.max(-20, Math.min(20, c.value));
      const nm = { heading: 'Rumo ordenado', depth: 'Profundidade ordenada', pitch: 'Pitch ordenado' }[c.channel];
      log(`${nm}: ${c.value.toFixed(c.channel === 'pitch' ? 1 : 0)}${c.channel === 'depth' ? ' m' : '°'}`, 'Controle automático');
      break;
    }
    case 'snorkel':
      s.snorkel.cmd = c.raise;
      log(`Mastro do snorkel: ${c.raise ? 'IÇAR' : 'ARRIAR'}`, 'Energia');
      break;
    case 'generator':
      s.electrical.generators[c.id].cmd = c.run;
      log(`${v.electrical.generators.find((g) => g.id === c.id)?.name}: ${c.run ? 'PARTIR' : 'PARAR'}`, 'Energia');
      break;
    case 'breaker':
      s.electrical.breakerClosed = c.closed;
      log(`Disjuntor principal da bateria: ${c.closed ? 'FECHAR' : 'ABRIR'}`, 'Energia');
      break;
    case 'ack':
      acknowledgeAlarm(s, c.id);
      break;
    case 'seaState': {
      e.env.setSeaState(c.value, c.direction);
      const w = e.env.waves;
      log(`Estado do mar: ${Math.round(c.value)} (Hs = ${w.hs.toFixed(1)} m, Tp = ${w.tp.toFixed(1)} s)`, 'Ambiente');
      break;
    }
    case 'demoWeight': {
      const dwc = v.mass.demoWeight;
      const d = s.demoWeight;
      if (!dwc || !d) break;
      if (c.x !== undefined) {
        d.xCmd = Math.max(dwc.xMin, Math.min(dwc.xMax, c.x));
        log(`Peso deslocável: mover para x = ${d.xCmd.toFixed(1)} m (${d.xCmd > dwc.xNeutral ? 'para vante' : d.xCmd < dwc.xNeutral ? 'para ré' : 'posição neutra'})`, 'Trim');
      }
      if (c.mass !== undefined) {
        const m = Math.max(0, Math.min(20000, c.mass));
        s.ledger.cargoIn = (s.ledger.cargoIn ?? 0) + (m - d.mass);
        log(`Peso deslocável: massa ${(d.mass / 1000).toFixed(1)} t → ${(m / 1000).toFixed(1)} t (${m > d.mass ? 'embarcada' : 'desembarcada'} ${(Math.abs(m - d.mass) / 1000).toFixed(1)} t)`, 'Trim');
        d.mass = m;
      }
      break;
    }
    case 'failure':
      applyFailure(e, c.target, c.active, c.param);
      break;
  }
}

/** Catálogo de falhas injetáveis (ambiente controlado de treinamento). */
export interface FailureDef {
  target: string;
  name: string;
  group: string;
  effect: string;
  param?: { label: string; default: number; unit: string };
  modes?: SensorFailMode[];
}

export function failureCatalog(e: SimulationEngine): FailureDef[] {
  const v = e.vessel;
  const list: FailureDef[] = [
    ...(v.compensation.transfer ? [{ target: 'pump:compensationTransfer', name: v.compensation.transfer.pump.name, group: 'Bombas', effect: 'Sem transferência interna de compensação.' }, { target: 'valve:compensation:direction', name: v.compensation.transfer.directionValve.name, group: 'Válvulas', effect: 'Seletor de sentido imobilizado.' }] : []),
    { target: 'pump:compensation', name: v.compensation.pump.name, group: 'Bombas', effect: 'A bomba para; sequências de esgoto são abortadas.' },
    { target: 'pump:trim', name: v.trim.pump.name, group: 'Bombas', effect: 'Sem transferência de trim — usar lemes para corrigir atitude.' },
    { target: 'pump:heel', name: v.heel.pump.name, group: 'Bombas', effect: 'Sem correção de banda.' },
    { target: 'motor', name: 'Motor elétrico principal', group: 'Propulsão', effect: 'Torque nulo; o submarino desacelera pela resistência (inércia conservada).' },
    { target: 'battery', name: 'Bateria principal (isolamento por falha)', group: 'Energia', effect: 'Barramento depende apenas dos geradores (se disponíveis).' },
    { target: 'hydraulics', name: 'Planta hidráulica', group: 'Hidráulica', effect: 'Lemes e válvulas imobilizados quando a pressão cai abaixo do mínimo.' },
  ];
  for (const t of v.ballast.tanks) {
    list.push({ target: `valve:ballast:${t.id}:vent`, name: t.ventValve.name + ' — travada', group: 'Válvulas', effect: 'Válvula imobilizada na posição atual.' });
    list.push({ target: `valve:ballast:${t.id}:blow`, name: t.blowValve.name + ' — travada', group: 'Válvulas', effect: 'Válvula imobilizada na posição atual.' });
    list.push({ target: `ventLeak:${t.id}`, name: `Vazamento no suspiro ${t.name}`, group: 'Lastro', effect: 'Perda lenta de ar ⇒ alagamento gradual do TLP e perda de empuxo.', param: { label: 'Área', default: 5, unit: 'cm²' } });
  }
  list.push({ target: 'valve:compensation:inlet', name: v.compensation.inletValve.name + ' — travada', group: 'Válvulas', effect: 'Admissão de mar imobilizada.' });
  list.push({ target: 'valve:compensation:discharge', name: v.compensation.dischargeValve.name + ' — travada', group: 'Válvulas', effect: 'Descarga ao mar imobilizada.' });
  list.push({ target: 'valve:trim:A', name: v.trim.valveA.name + ' — travada', group: 'Válvulas', effect: 'Transferência de trim bloqueada se fechada.' });
  for (const f of v.fins.filter((x) => x.maxDeflection > 0)) {
    list.push({ target: `surface:${f.id}`, name: `${f.name} — travado`, group: 'Governo', effect: 'Superfície imobilizada no ângulo atual.' });
  }
  for (const g of v.electrical.generators) list.push({ target: `generator:${g.id}`, name: g.name, group: 'Energia', effect: 'Gerador indisponível.' });
  for (const c of v.compartments) {
    list.push({ target: `flooding:${c.id}`, name: `Alagamento — ${c.name}`, group: 'Compartimentos', effect: 'Entrada de água Q = C_d·A·√(2Δp/ρ): cresce com a profundidade.', param: { label: 'Área do rombo', default: 15, unit: 'cm²' } });
  }
  for (const id of ['PRF1', 'PRF2', 'GIRO', 'AGM', 'INSP', 'INSR', 'DVLU', 'ECO']) {
    list.push({ target: `sensor:${id}`, name: sensorDef(id).name, group: 'Sensores', effect: 'Leitura degradada; o controle automático usa a leitura (não o valor real).', modes: ['congelado', 'deriva', 'zero', 'ruido'] });
  }
  return list;
}

export function isFailureActive(e: SimulationEngine, target: string): boolean {
  const s = e.state;
  const [kind, a, b, c] = target.split(':');
  switch (kind) {
    case 'pump':
      if (a === 'compensationTransfer') return s.compensation.transfer?.pump.failed ?? false;
      return s[a as FluidSystem].pump.failed;
    case 'motor':
      return s.propulsion.failed;
    case 'battery':
      return s.electrical.batteryFailed;
    case 'hydraulics':
      return s.hydraulics.failed;
    case 'valve':
      if (a === 'ballast') return s.ballast[b][c as 'vent' | 'blow'].stuck;
      if (a === 'compensation' && b === 'direction') return s.compensation.transfer?.direction.stuck ?? false;
      if (a === 'compensation') return (b === 'inlet' ? s.compensation.inlet : s.compensation.discharge).stuck;
      if (a === 'trim') return s.trim.valveA.stuck;
      return false;
    case 'ventLeak':
      return s.ballast[a].ventLeak > 0;
    case 'surface':
      return s.surfaces[a].jammed;
    case 'generator':
      return s.electrical.generators[a].failed;
    case 'flooding':
      return s.flooding[a].breachArea > 0;
    case 'sensor':
      return s.sensors[a].failMode !== 'normal';
  }
  return false;
}

function applyFailure(e: SimulationEngine, target: string, active: boolean, param?: number | string): void {
  const s = e.state;
  const [kind, a, b, c] = target.split(':');
  let label = target;
  switch (kind) {
    case 'pump':
      if (a === 'compensationTransfer') {
        if (s.compensation.transfer) s.compensation.transfer.pump.failed = active;
        label = 'Bomba de transferência de compensação';
        break;
      }
      s[a as FluidSystem].pump.failed = active;
      label = e.vessel[a as FluidSystem].pump.name;
      break;
    case 'motor':
      s.propulsion.failed = active;
      label = 'Motor elétrico principal';
      break;
    case 'battery':
      s.electrical.batteryFailed = active;
      label = 'Bateria principal';
      break;
    case 'hydraulics':
      s.hydraulics.failed = active;
      label = 'Planta hidráulica';
      break;
    case 'valve': {
      let vs;
      if (a === 'ballast') vs = s.ballast[b][c as 'vent' | 'blow'];
      else if (a === 'compensation') vs = b === 'direction' ? s.compensation.transfer?.direction : b === 'inlet' ? s.compensation.inlet : s.compensation.discharge;
      else vs = s.trim.valveA;
      if (vs) vs.stuck = active;
      label = `Válvula ${b}${c ? ' ' + c : ''}`;
      break;
    }
    case 'ventLeak':
      s.ballast[a].ventLeak = active ? (Number(param ?? 5) * 1e-4) : 0;
      label = `Vazamento suspiro ${a}`;
      break;
    case 'surface':
      s.surfaces[a].jammed = active;
      label = `Leme ${a} travado`;
      break;
    case 'generator':
      s.electrical.generators[a].failed = active;
      label = `Gerador ${a}`;
      break;
    case 'flooding':
      s.flooding[a].breachArea = active ? Number(param ?? 15) * 1e-4 : 0;
      label = `Alagamento ${a}${active ? ` (${Number(param ?? 15).toFixed(0)} cm²)` : ''}`;
      break;
    case 'sensor':
      s.sensors[a].failMode = active ? ((param as SensorFailMode) ?? 'congelado') : 'normal';
      s.sensors[a].drift = 0;
      label = `Sensor ${a}${active ? ` (${param ?? 'congelado'})` : ''}`;
      break;
  }
  e.log(`FALHA ${active ? 'INJETADA' : 'REMOVIDA'}: ${label}`, 'Falhas');
}
