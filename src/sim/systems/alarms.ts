/**
 * SUPERVISÃO E ALARMES (limites fictícios, exclusivamente educacionais).
 *
 * Cada alarme tem: prioridade (1 = CRÍTICO … 4 = INFORMATIVO), condição de
 * disparo avaliada sobre o estado/saídas, retardo de confirmação, registro
 * cronológico (ATIVADO / RECONHECIDO / NORMALIZADO) e reconhecimento.
 * Um alarme normalizado e não reconhecido permanece na lista até o
 * reconhecimento.
 */
import { CAVITATION_ALARM_ON, CAVITATION_ALARM_OFF, CAVITATION_ALARM_DELAY } from './cavitation';
import type { SimState } from '../core/state';
import type { VesselConfig } from '../config/types';
import { atmospherePercent } from './atmosphere';
import { nearestThreat } from './threat';

/** composição da atmosfera em % (cache por passo não é necessário: poucas contas) */
const atm = (s: SimState) => atmospherePercent(s);

export interface AlarmEvalContext {
  cfg: VesselConfig;
  s: SimState;
  depthTrue: number;
  altitude: number;
  verticalSpeed: number; // m/s (+ descendo)
  pitch: number;
  roll: number;
  netBuoyancyKg: number;
  hpMinPressureBar: number;
  stuckValves: string[];
  unpoweredValves: string[];
  failedPumps: string[];
  contact: boolean;
  speed: number;
  declination: number;
  cavitation: number;
}

export interface AlarmDef {
  id: string;
  priority: 1 | 2 | 3 | 4;
  text: string;
  delay: number; // s
  cond: (c: AlarmEvalContext) => boolean;
  detail?: (c: AlarmEvalContext) => string;
  system: string;
}

export const PRIORITY_LABEL: Record<number, string> = { 1: 'CRÍTICO', 2: 'ALTO', 3: 'MÉDIO', 4: 'INFO' };

export const ALARM_DEFS: AlarmDef[] = [
  { id: 'CAVITATION', priority: 3, text: 'Cavitação na hélice (estimativa)', delay: CAVITATION_ALARM_DELAY, system: 'Propulsão',
    cond: (c) => c.cavitation >= (c.s.alarms.runtime.CAVITATION?.active ? CAVITATION_ALARM_OFF : CAVITATION_ALARM_ON),
    detail: (c) => `intensidade ${(c.cavitation * 100).toFixed(0)}% · reduzir rotação ou aumentar a profundidade, respeitando a folga do fundo e os limites operacionais` },
  { id: 'DEPTH_TEST', priority: 1, text: 'Profundidade além do limite de teste fictício', delay: 0.5, system: 'Segurança', cond: (c) => c.depthTrue > c.cfg.limits.testDepth },
  { id: 'DEPTH_OP', priority: 2, text: 'Profundidade além do limite operacional fictício', delay: 1, system: 'Segurança', cond: (c) => c.depthTrue > c.cfg.limits.operatingDepth },
  { id: 'BOTTOM_CRIT', priority: 1, text: 'Proximidade crítica do fundo', delay: 0.5, system: 'Navegação', cond: (c) => c.altitude < c.cfg.limits.minAltitudeCrit, detail: (c) => `altitude ${c.altitude.toFixed(1)} m` },
  { id: 'BOTTOM_WARN', priority: 2, text: 'Aproximação do fundo', delay: 1, system: 'Navegação', cond: (c) => c.altitude < c.cfg.limits.minAltitudeWarn, detail: (c) => `altitude ${c.altitude.toFixed(1)} m` },
  { id: 'CONTACT', priority: 1, text: 'Contato com o fundo', delay: 0, system: 'Navegação', cond: (c) => c.contact },
  { id: 'VSPEED', priority: 2, text: 'Velocidade vertical elevada', delay: 2, system: 'Segurança', cond: (c) => Math.abs(c.verticalSpeed) > c.cfg.limits.maxVerticalSpeed, detail: (c) => `${c.verticalSpeed.toFixed(2)} m/s` },
  { id: 'PITCH_CRIT', priority: 1, text: 'Ângulo de pitch crítico', delay: 1, system: 'Atitude', cond: (c) => Math.abs(c.pitch) > c.cfg.limits.maxPitch * 1.6 },
  { id: 'PITCH', priority: 2, text: 'Ângulo de pitch excessivo', delay: 2, system: 'Atitude', cond: (c) => Math.abs(c.pitch) > c.cfg.limits.maxPitch, detail: (c) => `${c.pitch.toFixed(1)}°` },
  { id: 'ROLL', priority: 2, text: 'Ângulo de banda excessivo', delay: 2, system: 'Atitude', cond: (c) => Math.abs(c.roll) > c.cfg.limits.maxRoll, detail: (c) => `${c.roll.toFixed(1)}°` },
  { id: 'DEPTH_DIV', priority: 3, text: 'Divergência entre profundímetros', delay: 3, system: 'Instrumentação', cond: (c) => Math.abs(c.s.sensors.PRF1.value - c.s.sensors.PRF2.value) > 2, detail: (c) => `Δ = ${Math.abs(c.s.sensors.PRF1.value - c.s.sensors.PRF2.value).toFixed(1)} m` },
  { id: 'HDG_DIV', priority: 3, text: 'Divergência girobússola × agulha magnética', delay: 3, system: 'Instrumentação', cond: (c) => { const expected = c.s.sensors.GIRO.value - c.declination; const diff = ((((c.s.sensors.AGM.value - expected) % 360) + 540) % 360) - 180; return Math.abs(diff) > 3; }, detail: (c) => { const expected = c.s.sensors.GIRO.value - c.declination; const diff = ((((c.s.sensors.AGM.value - expected) % 360) + 540) % 360) - 180; return `Δ = ${diff.toFixed(1)}°`; } },
  { id: 'PUMP_FAIL', priority: 2, text: 'Falha de bomba', delay: 0, system: 'Fluidos', cond: (c) => c.failedPumps.length > 0, detail: (c) => c.failedPumps.join(', ') },
  { id: 'VALVE_FAIL', priority: 2, text: 'Falha de atuação de válvula', delay: 1, system: 'Fluidos', cond: (c) => c.stuckValves.length > 0, detail: (c) => c.stuckValves.join(', ') },
  { id: 'VALVE_NOHYD', priority: 2, text: 'Válvula comandada sem pressão hidráulica', delay: 2, system: 'Hidráulica', cond: (c) => c.unpoweredValves.length > 0, detail: (c) => c.unpoweredValves.join(', ') },
  { id: 'POWER_LOSS', priority: 1, text: 'Perda de energia no barramento principal', delay: 0, system: 'Elétrico', cond: (c) => !c.s.electrical.energized },
  { id: 'BATT_LOW', priority: 3, text: 'Carga da bateria baixa', delay: 1, system: 'Elétrico', cond: (c) => c.s.electrical.soc < 0.2, detail: (c) => `${(c.s.electrical.soc * 100).toFixed(0)} %` },
  { id: 'BATT_CRIT', priority: 2, text: 'Carga da bateria crítica', delay: 1, system: 'Elétrico', cond: (c) => c.s.electrical.soc < 0.08 },
  { id: 'OVERLOAD', priority: 3, text: 'Demanda elétrica acima da capacidade — propulsão limitada', delay: 2, system: 'Elétrico', cond: (c) => c.s.electrical.chargeLimited || c.s.propulsion.powerLimited },
  { id: 'HYD_LOW', priority: 2, text: 'Pressão hidráulica baixa', delay: 2, system: 'Hidráulica', cond: (c) => c.s.hydraulics.pressure < c.cfg.hydraulics.minPressure * 1.25 },
  { id: 'HP_LOW', priority: 3, text: 'Reserva de ar AP baixa', delay: 2, system: 'Ar comprimido', cond: (c) => c.hpMinPressureBar < 100, detail: (c) => `${c.hpMinPressureBar.toFixed(0)} bar` },
  { id: 'FLOOD', priority: 1, text: 'ALAGAMENTO de compartimento', delay: 0, system: 'Compartimentos', cond: (c) => Object.values(c.s.flooding).some((f) => f.rate > 0 || f.water > 200), detail: (c) => c.cfg.compartments.filter((x) => c.s.flooding[x.id].water > 0).map((x) => `${x.name}: ${(c.s.flooding[x.id].water / 1000).toFixed(1)} t`).join('; ') },
  { id: 'PUMP_NOSUC', priority: 4, text: 'Bomba operando sem sucção ou com descarga fechada', delay: 3, system: 'Fluidos', cond: (c) => [c.s.compensation.pump, c.s.trim.pump, c.s.heel.pump].some((p) => p.noSuction || p.deadhead) },
  { id: 'SNORKEL_HEAD', priority: 3, text: 'Válvula de cabeça do snorkel fechada com diesel comandado', delay: 2, system: 'Propulsão', cond: (c) => Object.values(c.s.electrical.generators).some((g) => g.status === 'SEM AR') },
  { id: 'SURF_JAM', priority: 2, text: 'Leme travado', delay: 0, system: 'Governo', cond: (c) => Object.values(c.s.surfaces).some((x) => x.jammed), detail: (c) => Object.entries(c.s.surfaces).filter(([, x]) => x.jammed).map(([k]) => k).join(', ') },
  { id: 'NEG_BUOY', priority: 3, text: 'Flutuabilidade negativa elevada (> 5 t)', delay: 5, system: 'Lastro', cond: (c) => c.netBuoyancyKg < -5000 && c.depthTrue > 15 },
  { id: 'SIG_FAULT', priority: 3, text: 'Falha na sinalização de emergência', delay: 0, system: 'Sinalização',
    cond: (c) => !!c.s.signals && (c.s.signals.launcher.state === 'falha' || c.s.signals.runs.some((r) => r.fault !== null && r.fault !== 'extinção prematura' && (r.phase === 'falha' || r.tx === 'falha'))),
    detail: (c) => { const ss = c.s.signals!; return ss.launcher.state === 'falha' ? 'lançador em falha — reset necessário' : ss.runs.filter((r) => r.fault !== null && (r.phase === 'falha' || r.tx === 'falha')).map((r) => `${r.id}: ${r.fault}`).join(', '); } },
  { id: 'SIG_BUOY', priority: 4, text: 'Boia de emergência na água', delay: 0, system: 'Sinalização',
    cond: (c) => !!c.s.signals?.runs.some((r) => r.kind === 'boia'),
    detail: (c) => { const b = c.s.signals!.runs.find((r) => r.kind === 'boia')!; return b.phase === 'ativo' ? (b.tx === 'ok' ? 'transmitindo (fictício)' : 'transmissão em falha') : b.phase; } },
  // --- sistemas da Fase 3 (atmosfera, avarias, distribuição, discrição, ameaça)
  { id: 'ATM_CO2_HIGH', priority: 2, text: 'CO₂ elevado na atmosfera interna', delay: 3, system: 'Atmosfera', cond: (c) => (atm(c.s)?.co2 ?? 0) > 3, detail: (c) => `${atm(c.s)!.co2.toFixed(2)} %` },
  { id: 'ATM_CO2', priority: 3, text: 'CO₂ acima do normal', delay: 5, system: 'Atmosfera', cond: (c) => (atm(c.s)?.co2 ?? 0) > 1.5, detail: (c) => `${atm(c.s)!.co2.toFixed(2)} %` },
  { id: 'ATM_O2_LOW', priority: 2, text: 'O₂ baixo na atmosfera interna', delay: 3, system: 'Atmosfera', cond: (c) => (atm(c.s)?.o2 ?? 21) < 16, detail: (c) => `${atm(c.s)!.o2.toFixed(1)} %` },
  { id: 'ATM_O2', priority: 3, text: 'O₂ abaixo do normal', delay: 5, system: 'Atmosfera', cond: (c) => (atm(c.s)?.o2 ?? 21) < 18, detail: (c) => `${atm(c.s)!.o2.toFixed(1)} %` },
  { id: 'ATM_H2_CRIT', priority: 1, text: 'H₂ perigoso (próximo do limite de explosividade)', delay: 1, system: 'Atmosfera', cond: (c) => (atm(c.s)?.h2 ?? 0) > 3, detail: (c) => `${atm(c.s)!.h2.toFixed(2)} % (LIE ≈ 4 %)` },
  { id: 'ATM_H2', priority: 2, text: 'H₂ elevado (recarga da bateria)', delay: 3, system: 'Atmosfera', cond: (c) => (atm(c.s)?.h2 ?? 0) > 2, detail: (c) => `${atm(c.s)!.h2.toFixed(2)} %` },
  { id: 'ATM_CO', priority: 2, text: 'CO na atmosfera interna', delay: 3, system: 'Atmosfera', cond: (c) => (atm(c.s)?.coPpm ?? 0) > 50, detail: (c) => `${atm(c.s)!.coPpm.toFixed(0)} ppm` },
  { id: 'FIRE', priority: 1, text: 'INCÊNDIO', delay: 0, system: 'Avarias', cond: (c) => Object.values(c.s.damage?.fires ?? {}).some((f) => f.detected && f.intensity > 0), detail: (c) => c.cfg.compartments.filter((x) => c.s.damage?.fires[x.id]?.detected && c.s.damage.fires[x.id].intensity > 0).map((x) => `${x.name}: ${(c.s.damage!.fires[x.id].intensity * 100).toFixed(0)} %`).join('; ') },
  { id: 'BILGE_DEPTH', priority: 3, text: 'Bomba de esgoto sem vazão (pressão do mar acima da bomba)', delay: 5, system: 'Avarias', cond: (c) => Object.entries(c.s.damage?.pumps ?? {}).some(([id, p]) => p.cmd && p.power > 0 && p.flow < 1e-5 && (c.s.flooding[(c.cfg.damage?.bilgePumps.find((b) => b.id === id)?.compartment) ?? '']?.water ?? 0) > 0) },
  { id: 'BATT_TEMP_CRIT', priority: 2, text: 'Temperatura da bateria crítica', delay: 2, system: 'Elétrico', cond: (c) => (c.s.distribution?.batteryTemp ?? 0) > (c.cfg.distribution?.battery.critTemp ?? 55), detail: (c) => `${c.s.distribution!.batteryTemp.toFixed(1)} °C` },
  { id: 'BATT_TEMP', priority: 3, text: 'Temperatura da bateria elevada', delay: 5, system: 'Elétrico', cond: (c) => (c.s.distribution?.batteryTemp ?? 0) > (c.cfg.distribution?.battery.warnTemp ?? 45), detail: (c) => `${c.s.distribution!.batteryTemp.toFixed(1)} °C` },
  { id: 'LOAD_SHED', priority: 3, text: 'Cargas rejeitadas automaticamente', delay: 0, system: 'Elétrico', cond: (c) => (c.s.distribution?.shed.length ?? 0) > 0, detail: (c) => c.s.distribution!.shed.join(', ') },
  { id: 'ESM_AIR', priority: 3, text: 'MAGE: radar de aeronave de patrulha interceptado', delay: 0, system: 'Discrição', cond: (c) => !!c.s.stealth?.aircraft?.esmWarned },
  { id: 'AIR_DETECT', priority: 2, text: 'Detectado por aeronave de patrulha (exercício)', delay: 0, system: 'Discrição', cond: (c) => c.s.stealth?.aircraft?.detectedAt != null && c.s.t - c.s.stealth.aircraft.detectedAt < 60 },
  { id: 'TORPEDO', priority: 1, text: 'TORPEDO EM APROXIMAÇÃO (exercício)', delay: 0, system: 'Ameaça', cond: (c) => nearestThreat(c.s) < (c.cfg.threat?.warnRange ?? 6000), detail: (c) => `${(nearestThreat(c.s) / 1000).toFixed(2)} km` },
  { id: 'SENSOR_FAIL', priority: 3, text: 'Sensor em falha', delay: 0, system: 'Instrumentação', cond: (c) => Object.values(c.s.sensors).some((x) => x.failMode !== 'normal'), detail: (c) => Object.entries(c.s.sensors).filter(([, x]) => x.failMode !== 'normal').map(([k, x]) => `${k} (${x.failMode})`).join(', ') },
];

export function evaluateAlarms(c: AlarmEvalContext, dt: number): void {
  const s = c.s;
  for (const d of ALARM_DEFS) {
    let rt = s.alarms.runtime[d.id];
    if (!rt) rt = s.alarms.runtime[d.id] = { active: false, acked: true, since: 0, pending: 0 };
    const on = d.cond(c);
    if (on) {
      rt.pending += dt;
      if (!rt.active && rt.pending >= d.delay) {
        rt.active = true;
        rt.acked = false;
        rt.since = s.t;
        const det = d.detail ? d.detail(c) : '';
        s.alarms.log.push({ t: s.t, id: d.id, priority: d.priority, text: d.text + (det ? ` — ${det}` : ''), event: 'ATIVADO' });
      }
    } else {
      rt.pending = 0;
      if (rt.active) {
        rt.active = false;
        s.alarms.log.push({ t: s.t, id: d.id, priority: d.priority, text: d.text, event: 'NORMALIZADO' });
      }
    }
  }
  if (s.alarms.log.length > 600) s.alarms.log.splice(0, s.alarms.log.length - 600);
}

export function acknowledgeAlarm(s: SimState, id: string | 'ALL'): void {
  for (const d of ALARM_DEFS) {
    if (id !== 'ALL' && d.id !== id) continue;
    const rt = s.alarms.runtime[d.id];
    if (rt && !rt.acked) {
      rt.acked = true;
      s.alarms.log.push({ t: s.t, id: d.id, priority: d.priority, text: d.text, event: 'RECONHECIDO' });
    }
  }
}

/** Alarmes a exibir: ativos ou normalizados ainda não reconhecidos. */
export function visibleAlarms(s: SimState): { def: AlarmDef; active: boolean; acked: boolean; since: number }[] {
  const out: { def: AlarmDef; active: boolean; acked: boolean; since: number }[] = [];
  for (const d of ALARM_DEFS) {
    const rt = s.alarms.runtime[d.id];
    if (rt && (rt.active || !rt.acked)) out.push({ def: d, active: rt.active, acked: rt.acked, since: rt.since });
  }
  return out.sort((a, b) => a.def.priority - b.def.priority || b.since - a.since);
}
