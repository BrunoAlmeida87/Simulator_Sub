/**
 * COMANDOS — única via pela qual a interface (ou um script de cenário) altera
 * a simulação. Cada comando é aplicado entre passos de integração e é
 * registrado em ordem cronológica (tempo de simulação + descrição).
 */
import type { SimulationEngine } from './core/engine';
import type { CargoLoad, SensorFailMode } from './core/state';
import { newDosing } from './systems/internalTanks';
import { acknowledgeAlarm } from './systems/alarms';
import { bumplessInit } from './systems/autopilot';
import { sensorDef } from './systems/sensors';
import { defaultGeo, type BottomConfig, type EnvironmentConfig, type GeoConfig } from './environment/environment';

/** Alterações de ambiente aplicáveis durante a simulação (o estado é mantido). */
export type EnvironmentPatch = Partial<Pick<EnvironmentConfig, 'salinity' | 'deepSalinity' | 'surfaceTemperature' | 'deepTemperature' | 'thermoclineDepth' | 'thermoclineThickness' | 'magneticDeclination'>> & {
  bottom?: Partial<BottomConfig>;
  /** costa e referência geográfica (origem do referencial local) */
  geo?: Partial<GeoConfig>;
};

const ENV_LABEL: Record<string, [string, string]> = {
  salinity: ['salinidade superficial', 'PSU'],
  deepSalinity: ['salinidade profunda', 'PSU'],
  surfaceTemperature: ['temperatura superficial', '°C'],
  deepTemperature: ['temperatura profunda', '°C'],
  thermoclineDepth: ['termoclina', 'm'],
  thermoclineThickness: ['espessura da termoclina', 'm'],
  magneticDeclination: ['declinação magnética', '°'],
  'bottom.mode': ['modo do fundo', ''],
  'bottom.baseDepth': ['fundo na origem', 'm'],
  'bottom.slopeNorth': ['declive N', 'm/km'],
  'bottom.slopeEast': ['declive L', 'm/km'],
  'bottom.roughness': ['rugosidade', 'm'],
  'bottom.wavelength': ['comprimento do relevo', 'm'],
  'geo.coast': ['costa', ''],
  'geo.shelfWidth': ['faixa costeira', 'm'],
  'geo.origin': ['posição geográfica', ''],
};

export type FluidSystem = 'compensation' | 'trim' | 'heel';

export type Command =
  | { type: 'compensationRoute'; source: string; destination: string }
  | { type: 'compensationTransferPump'; run: boolean }
  | { type: 'compensationDirection'; reverse?: boolean; position?: 'direta' | 'inversa' }
  | { type: 'mbtVent'; tank: string; open: boolean }
  | { type: 'mbtBlow'; tank: string; open: boolean }
  | { type: 'emergencyBlow'; open?: boolean; tank?: string }
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
  | { type: 'periscope'; raise: boolean }
  | { type: 'generator'; id: string; run: boolean }
  | { type: 'breaker'; closed: boolean }
  | { type: 'ack'; id: string }
  | { type: 'seaState'; value: number; direction?: number }
  | { type: 'cargoUpsert'; load: CargoLoad }
  | { type: 'cargoRemove'; id: string }
  | { type: 'environment'; patch: EnvironmentPatch }
  | { type: 'demoWeight'; x?: number; mass?: number }
  /** desloca uma carga a bordo (id ou 'ALL' com home) para x, ou de volta à estiva (home) */
  | { type: 'shiftLoad'; id: string; x?: number; home?: boolean }
  /** referência dos vetores de trim (variação de água nos tanques de trim) = condição atual */
  | { type: 'trimReference' }
  | { type: 'failure'; target: string; active: boolean; param?: number | string };

const SYS_NAME: Record<FluidSystem, string> = { compensation: 'Compensação', trim: 'Trim', heel: 'Banda' };

function tankName(e: SimulationEngine, id: string): string {
  return e.vessel.ballast.tanks.find((t) => t.id === id)?.name ?? id;
}

/** Origem dos comandos em curso: 'operador' ou o nome da automação que os emite. */
let cmdSource = 'operador';

/** Executa fn marcando os comandos emitidos com a origem dada (ex.: 'manobra'). */
export function withCommandSource<T>(source: string, fn: () => T): T {
  const prev = cmdSource;
  cmdSource = source;
  try {
    return fn();
  } finally {
    cmdSource = prev;
  }
}

export const currentCommandSource = (): string => cmdSource;

/**
 * Aplica um comando (única via de alteração do estado pela interface e pelas
 * automações). Passa antes pelos ganchos de gravação/reprodução do motor.
 */
export function applyCommand(e: SimulationEngine, c: Command): void {
  if (e.commandGate && !e.commandGate(c, cmdSource)) return;
  e.commandTap?.(c, cmdSource);
  e.busy++;
  try {
    applyCommandInner(e, c);
  } finally {
    e.busy--;
  }
}

function applyCommandInner(e: SimulationEngine, c: Command): void {
  const s = e.state;
  const v = e.vessel;
  const log = (text: string, group: string) => e.log(text, group);
  switch (c.type) {
    case 'compensationRoute': {
      const tr = s.compensation.transfer;
      const valid = [v.heel.tankA.id, v.heel.tankB.id, ...v.compensation.tanks.map(t => t.id)];
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
      const open = c.open !== false;
      for (const t of v.ballast.tanks) {
        if (c.tank && c.tank !== 'ALL' && t.id !== c.tank) continue;
        s.ballast[t.id].emergencyBlow.cmd = open ? 1 : 0;
        if (open) {
          s.ballast[t.id].vent.cmd = 0;
          s.ballast[t.id].blow.cmd = 0;
        }
      }
      if (open) for (const b of v.hpAir.banks) if (b.purpose === 'emergency') s.hpAir.banks[b.id].valve.cmd = 1;
      log(`${open ? 'SOPRO DE EMERGÊNCIA: suspiros e sopro normal fechados; ampolas dedicadas; compressor automático com ar/energia' : 'FECHAR sopro de emergência'} — ${c.tank && c.tank !== 'ALL' ? tankName(e, c.tank) : 'todos os TLP'}`, 'Lastro');
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
          name = v.compensation.tankValves.find((x) => x.id === c.valve)?.name ?? v.compensation.heelBranches?.find((b) => b.valve.id === c.valve)?.valve.name ?? c.valve;
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
    case 'periscope':
      (s.periscope ??= { cmd: false, pos: 0 }).cmd = c.raise;
      log(`Periscópio de ataque: ${c.raise ? 'IÇAR' : 'ARRIAR'}`, 'Navegação');
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
    case 'cargoUpsert': {
      const l = c.load;
      const { x, y, z } = l.position;
      const mass = l.quantity * l.unitMass;
      if (!l.id || !l.name.trim() || !['pessoas', 'carga', 'torpedos', 'equipamentos'].includes(l.category)
        || ![l.quantity, l.unitMass, mass, x, y, z].every(Number.isFinite)
        || !Number.isInteger(l.quantity) || l.quantity < 1 || l.unitMass <= 0 || mass > 200000
        || Math.abs(x) > v.hull.length / 2 || Math.hypot(y, z) > e.geom.radiusAt(x)) {
        log('Carga recusada: confira massa, quantidade e posição dentro do casco.', 'Cargas');
        break;
      }
      const loads = s.cargoLoads ??= [];
      const index = loads.findIndex(item => item.id === l.id);
      const previous = index < 0 ? 0 : loads[index].quantity * loads[index].unitMass;
      const next = structuredClone({ ...l, name: l.name.trim().slice(0, 80) });
      if (index < 0) loads.push(next); else loads[index] = next;
      s.ledger.cargoIn = (s.ledger.cargoIn ?? 0) + mass - previous;
      log(`${index < 0 ? 'Embarcar' : 'Atualizar/mover'} ${next.name}: ${l.quantity} × ${l.unitMass} kg; posição (${x}, ${y}, ${z}) m`, 'Cargas');
      break;
    }
    case 'cargoRemove': {
      const load = s.cargoLoads?.find(l => l.id === c.id);
      if (!load) break;
      s.ledger.cargoIn = (s.ledger.cargoIn ?? 0) - load.quantity * load.unitMass;
      s.cargoLoads = s.cargoLoads!.filter(l => l.id !== c.id);
      log(`Desembarcar ${load.name}: ${load.quantity * load.unitMass} kg`, 'Cargas');
      break;
    }
    case 'environment': {
      const env = e.config.environment;
      const changes: string[] = [];
      const note = (key: string, v: unknown) => {
        const [lbl, unit] = ENV_LABEL[key] ?? [key, ''];
        changes.push(`${lbl} ${typeof v === 'number' ? Number(v.toFixed(2)) : String(v)}${unit ? ' ' + unit : ''}`);
      };
      const { bottom, geo, ...rest } = c.patch;
      if (geo) {
        const cur = (env.geo ??= defaultGeo());
        if (typeof geo.coast === 'boolean') {
          cur.coast = geo.coast;
          changes.push(`costa ${geo.coast ? 'LIGADA (terra e fundo costeiro na física)' : 'desligada'}`);
        }
        if (typeof geo.shelfWidth === 'number' && Number.isFinite(geo.shelfWidth)) {
          cur.shelfWidth = Math.max(50, Math.min(20000, geo.shelfWidth));
          note('geo.shelfWidth', cur.shelfWidth);
        }
        if (geo.origin && Number.isFinite(geo.origin.lat) && Number.isFinite(geo.origin.lon)) {
          cur.origin = { lat: geo.origin.lat, lon: geo.origin.lon };
          changes.push(`posição geográfica do referencial ${geo.origin.lat.toFixed(4)}°, ${geo.origin.lon.toFixed(4)}°`);
        }
      }
      for (const [k, val] of Object.entries(rest)) {
        if (typeof val !== 'number' || !Number.isFinite(val)) continue;
        (env as unknown as Record<string, number>)[k] = val;
        note(k, val);
      }
      if (bottom) {
        for (const [k, val] of Object.entries(bottom)) {
          if (k === 'mode' ? val !== 'uniforme' && val !== 'relevo' : typeof val !== 'number' || !Number.isFinite(val)) continue;
          (env.bottom as unknown as Record<string, unknown>)[k] = k === 'baseDepth' ? Math.max(8, val as number) : val;
          note('bottom.' + k, val);
        }
      }
      e.rebuildEnvironment();
      log(`Ambiente alterado (estado mantido): ${changes.join(', ') || 'sem mudanças'}`, 'Ambiente');
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
        // a carga já está a bordo: muda só quanto dela anda no trilho (massa total do navio inalterada)
        const m = Math.max(0, Math.min(dwc.mass, c.mass));
        log(`Peso deslocável: parcela deslocada ${(Math.min(d.mass, dwc.mass) / 1000).toFixed(1)} t → ${(m / 1000).toFixed(1)} t (de ${(dwc.mass / 1000).toFixed(0)} t a bordo; massa total inalterada)`, 'Trim');
        d.mass = m;
      }
      break;
    }
    case 'trimReference':
      s.trimRef = { a: s.trim.tankA.mass, b: s.trim.tankB.mass };
      log(`Referência dos vetores de trim: condição atual (TT-AV ${(s.trim.tankA.mass / 1000).toFixed(2)} t, TT-AR ${(s.trim.tankB.mass / 1000).toFixed(2)} t)`, 'Trim');
      break;
    case 'shiftLoad': {
      const list = v.mass.shiftLoads ?? [];
      const st = (s.shiftLoads ??= {});
      const targets = c.id === 'ALL' ? list : list.filter((l) => l.id === c.id);
      if (!targets.length || (!c.home && (c.x === undefined || !Number.isFinite(c.x)))) {
        log('Deslocamento de carga recusado: carga desconhecida ou posição inválida.', 'Trim');
        break;
      }
      for (const lc of targets) {
        const l = (st[lc.id] ??= { x: lc.home.x, xCmd: lc.home.x });
        const x = c.home ? lc.home.x : Math.max(lc.xMin, Math.min(lc.xMax, c.x!));
        l.xCmd = x;
        const mass = lc.quantity * lc.unitMass;
        const where = Math.abs(x - lc.home.x) < 0.05 ? 'posição de estiva' : x > lc.home.x ? 'para vante' : 'para ré';
        log(`${lc.name} (${lc.quantity} × ${lc.unitMass} kg = ${(mass / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} t): deslocar para x = ${x.toFixed(1)} m (${where}; massa total inalterada)`, 'Trim');
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
    { target: 'hydraulics', name: 'Planta hidráulica', group: 'Hidráulica', effect: 'Lemes e válvulas hidráulicas imobilizados quando a pressão cai abaixo do mínimo (o sopro de emergência tem acionamento próprio).' },
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
