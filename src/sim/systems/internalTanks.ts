/**
 * TANQUES INTERNOS (dentro do casco resistente, à pressão interna):
 *  - Compensação de peso: troca de água com o mar (admissão por pressão do
 *    mar através de orifício + limitador de vazão; descarga por bomba contra
 *    a pressão do mar).
 *  - Trim longitudinal (vante ↔ ré) e banda (BB ↔ BE): transferência interna
 *    por bomba com seletor de sentido de 4 vias e válvulas de isolamento.
 *
 * Água dentro do casco é contabilizada em MASSA (kg); o volume indicado usa
 * ρ_nom = 1025 kg/m³. A água admitida tem a densidade do mar no nível da
 * tomada à pressão atmosférica (descomprimida ao entrar).
 *
 *  Admissão:  Q = min(C_d·A·a·√(2Δp/ρ), Q_reg),   Δp = p_mar − p_interna
 *  Descarga:  Q = Q_bomba(Δp),                    P = Q·Δp/η + P₀·s
 *  Transferência: Δp = ρ·g·(z_nível_origem − z_topo_destino) + k·Q²
 */
import type { CompensationConfig, InternalTankConfig, TransferSystemConfig } from '../config/types';
import type { CompensationState, DosingState, InternalTankState, TransferState } from '../core/state';
import { RHO_NOMINAL, type StepContext } from '../core/context';
import type { Vec3 } from '../core/math';
import { pumpFlow, pumpFlowWithLine, pumpPower, updatePumpSpeed, updateValve } from './components';

export const tankVolume = (st: InternalTankState) => st.mass / RHO_NOMINAL;
export const tankCapacityMass = (cfg: InternalTankConfig) => cfg.capacity * RHO_NOMINAL;

/** Centroide da água (corpo): o tanque enche a partir do fundo. */
export function tankWaterCentroid(cfg: InternalTankConfig, st: InternalTankState): Vec3 {
  const A = cfg.capacity / cfg.height;
  const h = Math.min(cfg.height, tankVolume(st) / A);
  return { x: cfg.center.x, y: cfg.center.y, z: cfg.center.z + cfg.height / 2 - h / 2 };
}

function levelDepth(cfg: InternalTankConfig, st: InternalTankState, ctx: StepContext): number {
  const A = cfg.capacity / cfg.height;
  const h = Math.min(cfg.height, tankVolume(st) / A);
  return ctx.depthOf({ x: cfg.center.x, y: cfg.center.y, z: cfg.center.z + cfg.height / 2 - h });
}

function topDepth(cfg: InternalTankConfig, ctx: StepContext): number {
  return ctx.depthOf({ x: cfg.center.x, y: cfg.center.y, z: cfg.center.z - cfg.height / 2 });
}

export interface InternalStepResult {
  seaIn: number; // kg
  seaOut: number; // kg
  strokes: number;
  power: number; // W
}

export function newDosing(mode: DosingState['mode'], target: number, dir?: 'AtoB' | 'BtoA'): DosingState {
  return { active: true, mode, target: Math.abs(target), moved: 0, phase: 'alinhando', dir, timer: 0, message: '' };
}

// ------------------------------------------------------------------ compensação

function runCompensationDosing(cfg: CompensationConfig, st: CompensationState, ctx: StepContext, expectedRate: number): void {
  const d = st.dosing;
  if (!d || !d.active) return;
  d.timer += ctx.dt;
  const tankIds = cfg.tankValves.map((v) => v.id);
  if (d.phase === 'alinhando') {
    for (const id of tankIds) st.tankValves[id].cmd = 1;
    if (d.mode === 'admitir') {
      st.discharge.cmd = 0;
      st.pump.cmd = false;
      st.inlet.cmd = 1;
      const ready = st.inlet.pos > 0.98 && tankIds.some((id) => st.tankValves[id].pos > 0.98);
      if (ready || st.qIn > 0) d.phase = 'escoando';
    } else {
      st.inlet.cmd = 0;
      st.discharge.cmd = 1;
      const ready = st.discharge.pos > 0.98 && tankIds.some((id) => st.tankValves[id].pos > 0.98);
      if (ready) {
        st.pump.cmd = true;
        d.phase = 'escoando';
      }
    }
    if (d.timer > 60) {
      d.phase = 'finalizando';
      d.message = 'Alinhamento não confirmado (válvula/energia) — sequência abortada';
    }
  } else if (d.phase === 'escoando') {
    const remaining = d.target - d.moved;
    // antecipa o fechamento: a válvula leva t_curso para fechar
    const lead = d.mode === 'admitir' ? expectedRate * cfg.inletValve.strokeTime * 0.5 : expectedRate * cfg.pump.spinUpTime * 0.33;
    if (remaining <= lead || remaining <= 0) d.phase = 'finalizando';
    if (d.mode === 'esgotar' && st.pump.failed) {
      d.phase = 'finalizando';
      d.message = 'Falha da bomba durante a sequência';
    }
  }
  if (d.phase === 'finalizando') {
    st.inlet.cmd = 0;
    st.pump.cmd = false;
    if (st.pump.speed <= 0.001) st.discharge.cmd = 0;
    const closed = st.inlet.pos < 0.001 && st.pump.speed <= 0.001;
    if (closed) {
      for (const id of tankIds) st.tankValves[id].cmd = 0;
      d.phase = 'concluido';
      d.active = false;
      if (!d.message) d.message = `Concluído: ${(d.moved / 1000).toFixed(2)} t movimentadas`;
    }
  }
}

export function updateCompensation(cfg: CompensationConfig, st: CompensationState, ctx: StepContext): InternalStepResult {
  const dt = ctx.dt;
  const hyd = ctx.hydraulicFactor > 0;
  const zConn = ctx.depthOf(cfg.seaConnection);
  const pSea = ctx.env.pressureAt(zConn);
  const rhoSea = ctx.env.densityAtmosphericAt(Math.max(0, zConn));
  const pInt = ctx.cfg.internalPressure;
  const dpSea = pSea - pInt;

  runCompensationDosing(cfg, st, ctx, Math.max(st.qIn, st.qOut) * RHO_NOMINAL);

  let strokes = updateValve(cfg.inletValve, st.inlet, dt, hyd) + updateValve(cfg.dischargeValve, st.discharge, dt, hyd);
  cfg.tankValves.forEach((v) => {
    strokes += updateValve(v, st.tankValves[v.id], dt, hyd);
  });
  updatePumpSpeed(cfg.pump, st.pump, dt, ctx.busPowered);

  const tanks = cfg.tanks.map((t, i) => ({ cfg: t, st: st.tanks[t.id], valve: st.tankValves[cfg.tankValves[i].id] }));
  const fillable = tanks.filter((t) => t.valve.pos > 0.02 && t.st.mass < tankCapacityMass(t.cfg) - 0.5);
  const drainable = tanks.filter((t) => t.valve.pos > 0.02 && t.st.mass > 0.5);

  // admissão (pressão do mar)
  let mIn = 0;
  if (st.inlet.pos > 0.02 && dpSea > 0 && zConn > 0) {
    const qOrif = 0.62 * cfg.inletArea * st.inlet.pos * Math.sqrt((2 * dpSea) / rhoSea);
    mIn = Math.min(qOrif, cfg.inletRegulatorFlow * st.inlet.pos) * rhoSea * dt;
  }
  // descarga por bomba
  let mOut = 0;
  const dpOut = Math.max(0, dpSea);
  st.pump.deadhead = st.pump.speed > 0.05 && st.discharge.pos < 0.02;
  st.pump.noSuction = st.pump.speed > 0.05 && drainable.length === 0 && mIn <= 0;
  if (st.pump.speed > 0 && st.discharge.pos > 0.02 && !st.pump.noSuction) {
    const throttle = Math.min(1, st.discharge.pos / 0.3);
    mOut = pumpFlow(cfg.pump, st.pump.speed, dpOut) * throttle * RHO_NOMINAL * dt;
  }

  let net = mIn - mOut;
  for (const t of tanks) t.st.flow = 0;
  if (net > 0) {
    const wsum = fillable.reduce((a, t) => a + t.valve.pos, 0);
    let placed = 0;
    for (const t of fillable) {
      const share = (net * t.valve.pos) / wsum;
      const room = tankCapacityMass(t.cfg) - t.st.mass;
      const m = Math.min(share, room);
      t.st.mass += m;
      t.st.flow = m / (RHO_NOMINAL * dt);
      placed += m;
    }
    if (placed < net) mIn -= net - placed;
    net = placed;
  } else if (net < 0) {
    const wsum = drainable.reduce((a, t) => a + t.valve.pos, 0);
    let taken = 0;
    for (const t of drainable) {
      const share = (-net * t.valve.pos) / wsum;
      const m = Math.min(share, t.st.mass);
      t.st.mass -= m;
      t.st.flow = -m / (RHO_NOMINAL * dt);
      taken += m;
    }
    if (taken < -net) mOut -= -net - taken;
  }
  st.qIn = mIn / (rhoSea * dt);
  st.qOut = mOut / (RHO_NOMINAL * dt);
  st.pump.flow = st.qOut;
  st.pump.dp = dpOut;
  st.pump.power = pumpPower(cfg.pump, st.pump.speed, st.qOut, dpOut);
  if (st.dosing && st.dosing.active && st.dosing.phase !== 'alinhando') st.dosing.moved += Math.abs(mIn - mOut);
  return { seaIn: mIn, seaOut: mOut, strokes, power: st.pump.power };
}

// ------------------------------------------------------------------ transferência

function runTransferDosing(cfg: TransferSystemConfig, st: TransferState, ctx: StepContext): void {
  const d = st.dosing;
  if (!d || !d.active) return;
  d.timer += ctx.dt;
  if (d.phase === 'alinhando') {
    st.direction.cmd = d.dir === 'BtoA' ? 1 : 0;
    st.valveA.cmd = 1;
    st.valveB.cmd = 1;
    const dirOk = d.dir === 'BtoA' ? st.direction.pos > 0.98 : st.direction.pos < 0.02;
    if (dirOk && st.valveA.pos > 0.98 && st.valveB.pos > 0.98) {
      st.pump.cmd = true;
      d.phase = 'escoando';
    }
    if (d.timer > 60) {
      d.phase = 'finalizando';
      d.message = 'Alinhamento não confirmado — sequência abortada';
    }
  } else if (d.phase === 'escoando') {
    const rate = Math.abs(st.flow) * RHO_NOMINAL;
    if (d.target - d.moved <= rate * cfg.pump.spinUpTime * 0.33) d.phase = 'finalizando';
    if (st.pump.failed) {
      d.phase = 'finalizando';
      d.message = 'Falha da bomba durante a sequência';
    }
    if (d.timer > 5 && rate < 1e-3 && st.pump.speed > 0.99) {
      d.phase = 'finalizando';
      d.message = 'Sem vazão (tanque vazio/cheio ou carga excessiva)';
    }
  }
  if (d.phase === 'finalizando') {
    st.pump.cmd = false;
    if (st.pump.speed <= 0.001) {
      st.valveA.cmd = 0;
      st.valveB.cmd = 0;
      d.phase = 'concluido';
      d.active = false;
      if (!d.message) d.message = `Concluído: ${(d.moved / 1000).toFixed(2)} t transferidas`;
    }
  }
}

export function updateTransfer(cfg: TransferSystemConfig, st: TransferState, ctx: StepContext): InternalStepResult {
  const dt = ctx.dt;
  const hyd = ctx.hydraulicFactor > 0;
  runTransferDosing(cfg, st, ctx);
  const strokes =
    updateValve(cfg.valveA, st.valveA, dt, hyd) +
    updateValve(cfg.valveB, st.valveB, dt, hyd) +
    updateValve(cfg.directionValve, st.direction, dt, hyd);
  updatePumpSpeed(cfg.pump, st.pump, dt, ctx.busPowered);

  const aToB = st.direction.pos < 0.02;
  const bToA = st.direction.pos > 0.98;
  const open = Math.min(st.valveA.pos, st.valveB.pos);
  const src = aToB ? { c: cfg.tankA, s: st.tankA } : { c: cfg.tankB, s: st.tankB };
  const dst = aToB ? { c: cfg.tankB, s: st.tankB } : { c: cfg.tankA, s: st.tankA };
  const g = ctx.env.cfg.gravity;
  const head = RHO_NOMINAL * g * (levelDepth(src.c, src.s, ctx) - topDepth(dst.c, ctx));
  let q = 0;
  st.pump.deadhead = st.pump.speed > 0.05 && (open < 0.02 || (!aToB && !bToA));
  st.pump.noSuction = st.pump.speed > 0.05 && src.s.mass <= 0.5;
  if (st.pump.speed > 0 && !st.pump.deadhead && !st.pump.noSuction) {
    q = pumpFlowWithLine(cfg.pump, st.pump.speed, Math.max(-cfg.pump.shutoffPressure * 0.2, head), cfg.lineLoss) * Math.min(1, open / 0.3);
    const maxM = Math.min(src.s.mass, tankCapacityMass(dst.c) - dst.s.mass);
    const m = Math.max(0, Math.min(q * RHO_NOMINAL * dt, maxM));
    src.s.mass -= m;
    dst.s.mass += m;
    q = m / (RHO_NOMINAL * dt);
  }
  st.flow = aToB ? q : -q;
  const dpTot = Math.max(0, head) + cfg.lineLoss * (q / cfg.pump.ratedFlow) ** 2;
  st.pump.flow = q;
  st.pump.dp = dpTot;
  st.pump.power = pumpPower(cfg.pump, st.pump.speed, q, dpTot);
  if (st.dosing && st.dosing.active && st.dosing.phase !== 'alinhando') st.dosing.moved += q * RHO_NOMINAL * dt;
  return { seaIn: 0, seaOut: 0, strokes, power: st.pump.power };
}
