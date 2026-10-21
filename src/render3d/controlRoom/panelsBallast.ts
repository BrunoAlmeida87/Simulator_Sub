/**
 * PAINEL DE CONTROLE DO LASTRO (encarregado de quarto / "Chief of the
 * Watch"): indicador de aberturas do casco ("árvore de Natal": verde =
 * fechada, vermelho = aberta), suspiros e sopro de cada TLP, ar de alta
 * pressão e compressor; CONSOLE DE SEGURANÇA DO MERGULHO (compensação, trim
 * e banda, com sequências automáticas de dosagem) e o COLETOR DE VÁLVULAS
 * MANUAIS com a planta hidráulica.
 */
import type { DrawCtx } from './panel';
import type { RoomActions } from './actions';
import type { SimulationEngine } from '../../sim/core/engine';
import type { FluidSystem } from '../../sim/commands';
import { C, box, button, dial, digital, faceBg, hbar, lamp, lampButton, pipe, plate, pumpSym, screenBg, stepper, tankSym, text, valveSym } from './draw';
import { valveStatus, pumpStatus } from '../../sim/systems/components';
import { tankVolume, tankCapacityMass } from '../../sim/systems/internalTanks';
import { bankPressure } from '../../sim/systems/hpAir';
import { dieselExhaust } from '../../sim/systems/exhaust';
import { solveNeutralCompensation } from '../../sim/equilibrium';

export interface HullOpening {
  id: string;
  name: string;
  open: boolean;
  /** escotilhas não são modeladas: sempre fechadas */
  fixed?: boolean;
}

/** Aberturas do casco mostradas no indicador (estado lido da simulação). */
export function hullOpenings(e: SimulationEngine): HullOpening[] {
  const s = e.state;
  const v = e.vessel;
  const list: HullOpening[] = v.ballast.tanks.map((t) => ({ id: `vent-${t.id}`, name: `Suspiro ${t.id.replace('TLP', 'TLP-')}`, open: s.ballast[t.id].vent.pos > 0.02 }));
  list.push({ id: 'vam', name: 'Admissão de mar V-AM', open: s.compensation.inlet.pos > 0.02 });
  list.push({ id: 'vdm', name: 'Descarga ao mar V-DM', open: s.compensation.discharge.pos > 0.02 });
  list.push({ id: 'snk', name: 'Indução (válv. cabeça)', open: s.snorkel.headValveOpen });
  list.push({ id: 'exh', name: 'Descarga dos diesel', open: dieselExhaust(v, s).route !== null });
  list.push({ id: 'hat-t', name: 'Escotilha da torre', open: false, fixed: true });
  list.push({ id: 'hat-v', name: 'Escotilha de vante', open: false, fixed: true });
  list.push({ id: 'hat-r', name: 'Escotilha de ré', open: false, fixed: true });
  return list;
}

/** "quadro verde": todas as aberturas do casco fechadas */
export const greenBoard = (e: SimulationEngine) => hullOpenings(e).every((o) => !o.open);

const tid = (id: string) => id.replace('TLP', 'TLP-');

/** face do PAINEL DE CONTROLE DO LASTRO */
export function drawBallastPanel(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    const s = e.state;
    const v = e.vessel;
    faceBg(c, '#c9c6b8');
    plate(g, 'PAINEL DE CONTROLE DO LASTRO', 24, 14, W - 290, 38, 22);
    // --- indicador de aberturas do casco
    const ops = hullOpenings(e);
    const oy = 64;
    g.fillStyle = '#26292b';
    g.fillRect(24, oy, W - 290, 196);
    text(g, 'INDICADOR DE ABERTURAS DO CASCO', 36, oy + 16, 15, '#e8e4d0', 'left', 'bold');
    text(g, '— fechada (verde)   O aberta (vermelho)', W - 280, oy + 16, 13, '#b8b4a2', 'right');
    const cols = 6;
    const cw = (W - 300) / cols;
    ops.forEach((o, i) => {
      const x = 30 + (i % cols) * cw;
      const y = oy + 34 + Math.floor(i / cols) * 78;
      const lit = true;
      const col = o.open ? 'red' : 'green';
      g.fillStyle = '#111';
      g.fillRect(x + 4, y, cw - 8, 70);
      const on = lit || c.ui.lampTest;
      g.fillStyle = on ? (o.open ? '#ff3b30' : '#38f06a') : '#333';
      g.fillRect(x + cw / 2 - 26, y + 6, 52, 30);
      text(g, o.open ? 'O' : '—', x + cw / 2, y + 22, 26, '#111', 'center', 'bold');
      if (c.glow) {
        c.glow.fillStyle = o.open ? '#ff3b30' : '#38f06a';
        c.glow.fillRect(x + cw / 2 - 26, y + 6, 52, 30);
      }
      text(g, o.name, x + cw / 2, y + 52, 13, '#e8e4d0', 'center', 'bold', false, cw - 14);
      c.hit({ id: `op-${o.id}`, x: x + 4, y, w: cw - 8, h: 70, label: `${o.name}: ${o.open ? 'ABERTA' : 'FECHADA'}${o.fixed ? ' (não modelada: sempre fechada)' : ''}` });
      void col;
    });
    const green = ops.every((o) => !o.open);
    lampButton(c, { id: 'greenboard', x: W - 256, y: oy, w: 232, h: 92, label: green ? 'QUADRO VERDE' : 'QUADRO VERMELHO', sub: green ? 'casco estanque' : 'há aberturas', lit: true, color: green ? 'green' : 'red', tip: green ? 'Todas as aberturas do casco fechadas (condição de imersão segura)' : 'Há aberturas do casco abertas (ver indicador)' });
    lampButton(c, { id: 'ventall-open', x: W - 256, y: oy + 104, w: 112, h: 92, label: 'ABRIR', sub: 'todos suspiros', lit: v.ballast.tanks.every((t) => s.ballast[t.id].vent.cmd > 0.5), color: 'red', tip: 'Abrir os suspiros de todos os TLP (alagar = imergir)', action: () => act.cmd({ type: 'mbtVent', tank: 'ALL', open: true }) });
    lampButton(c, { id: 'ventall-close', x: W - 136, y: oy + 104, w: 112, h: 92, label: 'FECHAR', sub: 'todos suspiros', lit: v.ballast.tanks.every((t) => s.ballast[t.id].vent.cmd < 0.5), color: 'green', tip: 'Fechar os suspiros de todos os TLP', action: () => act.cmd({ type: 'mbtVent', tank: 'ALL', open: false }) });
    // --- TLP
    const ty = 278;
    plate(g, 'LASTRO PRINCIPAL — TANQUES DE LASTRO (TLP)', 24, ty, W - 290, 30, 16);
    const tw = (W - 290) / 4;
    v.ballast.tanks.forEach((t, i) => {
      const st = s.ballast[t.id];
      const x = 24 + i * tw;
      g.fillStyle = '#2a2d2f';
      g.fillRect(x + 6, ty + 40, tw - 12, 300);
      text(g, tid(t.id), x + tw / 2, ty + 58, 18, '#f1efe6', 'center', 'bold');
      text(g, t.center.x > 0 ? 'vante' : 'ré', x + tw / 2, ty + 78, 13, '#b8b4a2', 'center');
      // nível
      const f = st.water / t.volume;
      g.fillStyle = '#e8e2b0';
      g.fillRect(x + 30, ty + 90, tw - 60, 100);
      g.fillStyle = '#2f7fc8';
      g.fillRect(x + 30, ty + 90 + 100 * (1 - f), tw - 60, 100 * f);
      g.strokeStyle = '#111';
      g.lineWidth = 2;
      g.strokeRect(x + 30, ty + 90, tw - 60, 100);
      text(g, `${Math.round(f * 100)} %`, x + tw / 2, ty + 140, 22, '#111', 'center', 'bold', true);
      text(g, st.pAir > 0.5e5 ? `ar ${(st.pAir / 1e5).toFixed(2)} bar` : '—', x + tw / 2, ty + 202, 13, '#d8d4c2', 'center');
      const vOpen = st.vent.cmd > 0.5;
      lampButton(c, { id: `vent-${t.id}`, x: x + 14, y: ty + 216, w: tw / 2 - 18, h: 64, label: 'SUSPIRO', sub: vOpen ? 'ABERTO' : 'FECHADO', lit: true, blink: valveStatus(st.vent) === 'ABRINDO' || valveStatus(st.vent) === 'FECHANDO', color: st.vent.stuck ? 'amber' : vOpen ? 'red' : 'green', tip: `Suspiro ${tid(t.id)}: ${valveStatus(st.vent)} — clique para ${vOpen ? 'FECHAR' : 'ABRIR'}`, action: () => act.cmd({ type: 'mbtVent', tank: t.id, open: !vOpen }) });
      const bOpen = st.blow.cmd > 0.5;
      lampButton(c, { id: `blow-${t.id}`, x: x + tw / 2 + 4, y: ty + 216, w: tw / 2 - 18, h: 64, label: 'SOPRO', sub: bOpen ? 'SOPRANDO' : 'FECHADO', lit: bOpen || st.blow.pos > 0.02, blink: valveStatus(st.blow) === 'ABRINDO' || valveStatus(st.blow) === 'FECHANDO', color: st.blow.stuck ? 'red' : 'amber', tip: `Sopro ${tid(t.id)}: ${valveStatus(st.blow)} — clique para ${bOpen ? 'FECHAR' : 'ABRIR (ar AP para o tanque)'}`, action: () => act.cmd({ type: 'mbtBlow', tank: t.id, open: !bOpen }) });
      text(g, st.qWater > 0.01 ? '▲ alagando' : st.qWater < -0.01 ? '▼ esgotando' : '', x + tw / 2, ty + 298, 14, '#f1efe6', 'center', 'bold');
      if (st.mdotVent > 0.05) text(g, 'ar saindo pelo suspiro', x + tw / 2, ty + 320, 12, '#ffb3a8', 'center');
      if (st.mdotBlow > 0.05) text(g, `sopro ${st.mdotBlow.toFixed(1)} kg/s`, x + tw / 2, ty + 320, 12, '#ffe08a', 'center');
    });
    lampButton(c, { id: 'blowall', x: W - 256, y: ty + 40, w: 112, h: 80, label: 'SOPRAR', sub: 'todos TLP', lit: v.ballast.tanks.some((t) => s.ballast[t.id].blow.cmd > 0.5), color: 'amber', tip: 'Abrir o sopro de todos os TLP (ar AP expulsa a água = emergir)', action: () => act.cmd({ type: 'mbtBlow', tank: 'ALL', open: true }) });
    lampButton(c, { id: 'blowall-close', x: W - 136, y: ty + 40, w: 112, h: 80, label: 'FECHAR', sub: 'sopro', lit: v.ballast.tanks.every((t) => s.ballast[t.id].blow.cmd < 0.5), color: 'green', tip: 'Fechar o sopro de todos os TLP', action: () => act.cmd({ type: 'mbtBlow', tank: 'ALL', open: false }) });
    // sopro de emergência (alavancas 3D montadas à direita desta área)
    g.fillStyle = '#b3241b';
    g.fillRect(W - 256, ty + 134, 232, 206);
    g.fillStyle = '#f5d33b';
    for (let k = 0; k < 9; k++) g.fillRect(W - 256 + k * 28, ty + 134, 14, 10);
    text(g, 'SOPRO DE', W - 140, ty + 162, 20, '#fff', 'center', 'bold');
    text(g, 'EMERGÊNCIA', W - 140, ty + 184, 20, '#fff', 'center', 'bold');
    text(g, 'VANTE', W - 196, ty + 326, 16, '#fff', 'center', 'bold');
    text(g, 'RÉ', W - 84, ty + 326, 16, '#fff', 'center', 'bold');
    text(g, 'levantar a tampa e puxar', W - 140, ty + 204, 12, '#ffd9d4', 'center');
    // --- ar de alta pressão
    const ay = ty + 352;
    plate(g, 'AR DE ALTA PRESSÃO (AP)', 24, ay, W - 48, 30, 16);
    const r = 64;
    v.hpAir.banks.forEach((b, i) => {
      const st = s.hpAir.banks[b.id];
      const p = bankPressure(v.hpAir, b.id, st.mass) / 1e5;
      const cx = 120 + i * 240;
      dial(g, cx, ay + 112, r, { value: p, min: 0, max: 300, major: 50, minor: 10, label: b.id, unit: 'bar', digits: 0 });
      const open = st.valve.cmd > 0.5;
      lampButton(c, { id: `hp-${b.id}`, x: cx - 70, y: ay + 186, w: 140, h: 46, label: open ? 'ABERTO' : 'ISOLADO', sub: `isolamento ${b.id}`, lit: true, color: open ? 'green' : 'white', tip: `${b.name}: ${valveStatus(st.valve)} — clique para ${open ? 'ISOLAR' : 'ABRIR'}`, action: () => act.cmd({ type: 'hpBankValve', bank: b.id, open: !open }) });
    });
    dial(g, 600, ay + 112, r, { value: e.outputs.hpManifoldBar, min: 0, max: 300, major: 50, minor: 10, label: 'COLETOR', unit: 'bar', digits: 0 });
    // compressor
    const cx0 = 720;
    g.fillStyle = '#2a2d2f';
    g.fillRect(cx0, ay + 44, 300, 222);
    text(g, 'COMPRESSOR DE AR AP', cx0 + 150, ay + 66, 16, '#f1efe6', 'center', 'bold');
    const run = s.hpAir.compressorRunning;
    lamp(c, cx0 + 40, ay + 110, 16, run, 'green');
    text(g, run ? 'EM CARGA' : s.hpAir.compressorCmd ? 'SEM AR/ENERGIA' : 'PARADO', cx0 + 70, ay + 110, 16, '#f1efe6', 'left', 'bold');
    lampButton(c, { id: 'comp-start', x: cx0 + 16, y: ay + 150, w: 130, h: 60, label: 'PARTIR', lit: s.hpAir.compressorCmd, color: 'green', tip: 'Partir o compressor (precisa de ar externo: superfície ou snorkel)', action: () => act.cmd({ type: 'compressor', run: true }) });
    lampButton(c, { id: 'comp-stop', x: cx0 + 154, y: ay + 150, w: 130, h: 60, label: 'PARAR', lit: !s.hpAir.compressorCmd, color: 'white', tip: 'Parar o compressor', action: () => act.cmd({ type: 'compressor', run: false }) });
    text(g, 'tomada de ar: ' + (e.outputs.airIntake ? 'disponível' : 'indisponível'), cx0 + 150, ay + 236, 13, '#d8d4c2', 'center');
    // flutuabilidade
    const fx = 1040;
    g.fillStyle = '#2a2d2f';
    g.fillRect(fx, ay + 44, W - fx - 24, 222);
    text(g, e.outputs.surfaced ? 'RESERVA DE FLUTUAB.' : 'FLUTUAB. LÍQUIDA', fx + (W - fx - 24) / 2, ay + 66, 15, '#f1efe6', 'center', 'bold');
    digital(g, fx + 16, ay + 90, W - fx - 56, 60, `${((e.outputs.surfaced ? e.outputs.reserveKg : e.outputs.netBuoyancyKg) / 1000).toFixed(2)} t`);
    const fill = v.ballast.tanks.reduce((a, t) => a + s.ballast[t.id].water, 0) / v.ballast.tanks.reduce((a, t) => a + t.volume, 0);
    text(g, `TLP ${Math.round(fill * 100)} % cheios`, fx + (W - fx - 24) / 2, ay + 180, 18, '#f1efe6', 'center', 'bold');
    text(g, e.outputs.surfaced ? 'na superfície' : 'submerso', fx + (W - fx - 24) / 2, ay + 210, 15, '#d8d4c2', 'center');
    void H;
  };
}

/** dose escolhida (kg) num sistema, com limites */
const dose = (c: DrawCtx, k: string, def: number) => (c.ui.dose[k] ??= def);

let compCache: { e: SimulationEngine; t: number; depth: number; need: number } | null = null;

/** tela de COMPENSAÇÃO (console de segurança do mergulho) */
export function drawCompensation(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W, H, now } = c;
    const s = e.state;
    const v = e.vessel;
    const cs = s.compensation;
    const y0 = screenBg(c, 'COMPENSAÇÃO', 'ajuste fino do peso — mar ⇄ TC-1/TC-2');
    // diagrama
    const seaX = 40;
    const manY = y0 + 150;
    g.fillStyle = '#0c3355';
    g.fillRect(14, y0 + 10, 70, 260);
    text(g, 'MAR', 49, y0 + 30, 16, '#9fd0ff', 'center', 'bold');
    const qIn = cs.qIn;
    const qOut = cs.qOut;
    pipe(g, [[seaX + 40, y0 + 80], [300, y0 + 80], [300, manY]], C.water, 9, qIn > 1e-5 ? 1 : 0, now);
    pipe(g, [[300, manY], [300, y0 + 220], [seaX + 40, y0 + 220]], C.water, 9, qOut > 1e-5 ? 1 : 0, now);
    pipe(g, [[300, manY], [880, manY]], C.water, 9, Math.abs(qIn - qOut) > 1e-5 ? 1 : 0, now);
    // admissão
    const vam = valveStatus(cs.inlet);
    valveSym(g, 170, y0 + 80, 18, vam);
    button(c, { id: 'c-vam', x: 120, y: y0 + 100, w: 100, h: 38, label: 'V-AM', sub: vam, on: cs.inlet.cmd > 0.5, tone: 'ok', tip: `${v.compensation.inletValve.name}: ${vam} — clique para ${cs.inlet.cmd > 0.5 ? 'FECHAR' : 'ABRIR'} (o mar entra pela pressão externa)`, action: () => act.cmd({ type: 'valve', system: 'compensation', valve: 'inlet', open: cs.inlet.cmd < 0.5 }), size: 15 });
    text(g, `${(qIn * 1000).toFixed(1)} L/s`, 250, y0 + 66, 14, C.dim, 'center', 'normal', true);
    // descarga + bomba
    const vdm = valveStatus(cs.discharge);
    valveSym(g, 130, y0 + 220, 18, vdm);
    button(c, { id: 'c-vdm', x: 84, y: y0 + 240, w: 100, h: 38, label: 'V-DM', sub: vdm, on: cs.discharge.cmd > 0.5, tone: 'ok', tip: `${v.compensation.dischargeValve.name}: ${vdm} — clique para ${cs.discharge.cmd > 0.5 ? 'FECHAR' : 'ABRIR'}`, action: () => act.cmd({ type: 'valve', system: 'compensation', valve: 'discharge', open: cs.discharge.cmd < 0.5 }), size: 15 });
    pumpSym(g, 230, y0 + 220, 24, cs.pump.speed, cs.pump.failed, now);
    const ps = pumpStatus(cs.pump, s.electrical.energized);
    button(c, { id: 'c-pump', x: 196, y: y0 + 252, w: 104, h: 38, label: 'BOMBA BC', sub: ps, on: cs.pump.cmd, tone: cs.pump.failed ? 'danger' : 'ok', tip: `${v.compensation.pump.name}: ${ps} — clique para ${cs.pump.cmd ? 'PARAR' : 'PARTIR'} (esgota ao mar)`, action: () => act.cmd({ type: 'pump', system: 'compensation', run: !cs.pump.cmd }), size: 14 });
    text(g, `${(qOut * 1000).toFixed(1)} L/s`, 230, y0 + 186, 14, C.dim, 'center', 'normal', true);
    // tanques
    v.compensation.tanks.forEach((t, i) => {
      const x = 430 + i * 250;
      const vcfg = v.compensation.tankValves[i];
      const vs = cs.tankValves[vcfg.id];
      const st = valveStatus(vs);
      pipe(g, [[x + 60, manY], [x + 60, manY - 34]], C.water, 8, Math.abs(cs.tanks[t.id].flow ?? 0) > 1e-5 ? 1 : 0, now);
      valveSym(g, x + 60, manY - 50, 15, st, true);
      tankSym(g, x, y0 + 30, 120, 50, cs.tanks[t.id].mass / tankCapacityMass(t), t.id.replace('TC', 'TC-'), `${tankVolume(cs.tanks[t.id]).toFixed(2)}/${t.capacity} m³`);
      button(c, { id: `c-${vcfg.id}`, x: x + 4, y: manY + 16, w: 112, h: 38, label: vcfg.id, sub: st, on: vs.cmd > 0.5, tone: 'ok', tip: `${vcfg.name}: ${st} — clique para ${vs.cmd > 0.5 ? 'FECHAR' : 'ABRIR'}`, action: () => act.cmd({ type: 'valve', system: 'compensation', valve: vcfg.id, open: vs.cmd < 0.5 }), size: 15 });
    });
    // dosagem
    const dy = y0 + 300;
    box(g, 14, dy, W - 28, H - dy - 12, 'SEQUÊNCIA AUTOMÁTICA (DOSAGEM)');
    const kg = dose(c, 'comp', 500);
    stepper(c, 'c-dose', 24, dy + 30, 44, [-500, -100, 100, 500], kg, (x) => `${x} kg`, (x) => (c.ui.dose.comp = Math.max(50, Math.min(10000, x))), 'Quantidade a dosar', 64);
    const d = cs.dosing;
    button(c, { id: 'c-adm', x: 520, y: dy + 30, w: 130, h: 44, label: 'ADMITIR', tone: 'cmd', tip: `Admitir ${kg} kg do mar (fica mais pesado)`, action: () => act.cmd({ type: 'dosing', system: 'compensation', mode: 'admitir', kg }) });
    button(c, { id: 'c-esg', x: 658, y: dy + 30, w: 130, h: 44, label: 'ESGOTAR', tone: 'cmd', tip: `Esgotar ${kg} kg ao mar (fica mais leve)`, action: () => act.cmd({ type: 'dosing', system: 'compensation', mode: 'esgotar', kg }) });
    button(c, { id: 'c-abort', x: 796, y: dy + 30, w: 140, h: 44, label: 'INTERROMPER', tone: 'warn', disabled: !d?.active, tip: 'Interromper a sequência automática', action: () => act.cmd({ type: 'dosingAbort', system: 'compensation' }) });
    text(g, d ? `${d.mode.toUpperCase()} · ${d.phase} · ${d.moved.toFixed(0)}/${d.target.toFixed(0)} kg ${d.message ? '· ' + d.message : ''}` : 'sem sequência', 24, dy + 96, 16, d?.active ? C.cmd : C.dim, 'left', 'bold', false, W - 60);
    // ajuste calculado (equilíbrio neutro) — recalculado a cada 5 s de simulação
    const calcDepth = e.outputs.surfaced ? 40 : Math.max(0, s.body.pos.z);
    if (!compCache || compCache.e !== e || Math.abs(s.t - compCache.t) > 5 || Math.abs(calcDepth - compCache.depth) > 3) {
      try {
        const sol = solveNeutralCompensation(e, calcDepth, false);
        compCache = { e, t: s.t, depth: calcDepth, need: Object.values(sol.compensation).reduce((a, b) => a + b, 0) };
      } catch {
        compCache = { e, t: s.t, depth: calcDepth, need: NaN };
      }
    }
    const cur = v.compensation.tanks.reduce((a, t) => a + cs.tanks[t.id].mass, 0);
    const dm = compCache.need - cur;
    button(c, {
      id: 'c-calc',
      x: 24,
      y: dy + 120,
      w: 420,
      h: 50,
      label: 'AJUSTE CALCULADO',
      sub: Number.isFinite(dm) ? `${dm >= 0 ? 'admitir' : 'esgotar'} ${(Math.abs(dm) / 1000).toFixed(2)} t para ${calcDepth.toFixed(0)} m` : 'indisponível',
      tone: 'ok',
      disabled: !Number.isFinite(dm) || Math.abs(dm) < 10,
      tip: 'Sequência automática com a quantidade que deixa o submarino neutro na cota (cálculo de equilíbrio)',
      action: () => act.cmd({ type: 'dosing', system: 'compensation', mode: dm > 0 ? 'admitir' : 'esgotar', kg: Math.abs(dm) }),
    });
    const nb = e.outputs.surfaced ? e.outputs.reserveKg : e.outputs.netBuoyancyKg;
    text(g, e.outputs.surfaced ? 'RESERVA (superfície)' : 'FLUTUABILIDADE LÍQUIDA', 470, dy + 134, 15, C.dim, 'left', 'bold');
    hbar(g, 470, dy + 150, 340, 18, 0.5 + Math.max(-1, Math.min(1, nb / 10000)) / 2, nb >= 0 ? C.real : C.warn, 0.5);
    text(g, `${(nb / 1000).toFixed(2)} t`, W - 28, dy + 159, 20, nb >= 0 ? C.real : C.warn, 'right', 'bold', true);
  };
}

function transferBlock(c: DrawCtx, act: RoomActions, sys: Exclude<FluidSystem, 'compensation'>, x: number, y: number, w: number, h: number): void {
  const { g, e, now } = c;
  const s = e.state;
  const cfg = e.vessel[sys];
  const st = s[sys];
  const name = sys === 'trim' ? 'TRIM (vante ⇄ ré)' : 'BANDA (BB ⇄ BE)';
  box(g, x, y, w, h, name);
  const ta = cfg.tankA;
  const tb = cfg.tankB;
  const aLbl = sys === 'trim' ? 'TT-AV' : 'TB-BB';
  const bLbl = sys === 'trim' ? 'TT-AR' : 'TB-BE';
  tankSym(g, x + 20, y + 50, 110, 70, st.tankA.mass / tankCapacityMass(ta), aLbl, `${tankVolume(st.tankA).toFixed(2)} m³`);
  tankSym(g, x + w - 130, y + 50, 110, 70, st.tankB.mass / tankCapacityMass(tb), bLbl, `${tankVolume(st.tankB).toFixed(2)} m³`);
  const mid = x + w / 2;
  const flowing = Math.abs(st.flow) > 1e-5;
  pipe(g, [[x + 130, y + 86], [x + w - 130, y + 86]], C.water, 8, flowing ? Math.sign(st.flow) : 0, now);
  const va = valveStatus(st.valveA);
  const vb = valveStatus(st.valveB);
  valveSym(g, x + 168, y + 86, 13, va);
  valveSym(g, x + w - 168, y + 86, 13, vb);
  pumpSym(g, mid, y + 86, 20, st.pump.speed, st.pump.failed, now);
  const dirAB = st.direction.cmd < 0.5;
  text(g, dirAB ? `${aLbl} → ${bLbl}` : `${bLbl} → ${aLbl}`, mid, y + 56, 15, C.cmd, 'center', 'bold');
  const bw = (w - 40) / 5;
  const by = y + 140;
  button(c, { id: `${sys}-va`, x: x + 14, y: by, w: bw, h: 44, label: cfg.valveA.id, sub: va, on: st.valveA.cmd > 0.5, tone: 'ok', tip: `${cfg.valveA.name}: ${va}`, action: () => act.cmd({ type: 'valve', system: sys, valve: 'A', open: st.valveA.cmd < 0.5 }), size: 14 });
  button(c, { id: `${sys}-dir`, x: x + 20 + bw, y: by, w: bw, h: 44, label: 'SENTIDO', sub: dirAB ? 'A→B' : 'B→A', tone: 'neutral', tip: `Seletor de sentido: inverter para ${dirAB ? `${bLbl} → ${aLbl}` : `${aLbl} → ${bLbl}`}`, action: () => act.cmd({ type: 'direction', system: sys, dir: dirAB ? 'BtoA' : 'AtoB' }), size: 14 });
  const ps = pumpStatus(st.pump, s.electrical.energized);
  button(c, { id: `${sys}-pump`, x: x + 26 + 2 * bw, y: by, w: bw, h: 44, label: 'BOMBA', sub: ps, on: st.pump.cmd, tone: st.pump.failed ? 'danger' : 'ok', tip: `${cfg.pump.name}: ${ps}`, action: () => act.cmd({ type: 'pump', system: sys, run: !st.pump.cmd }), size: 14 });
  button(c, { id: `${sys}-vb`, x: x + 32 + 3 * bw, y: by, w: bw, h: 44, label: cfg.valveB.id, sub: vb, on: st.valveB.cmd > 0.5, tone: 'ok', tip: `${cfg.valveB.name}: ${vb}`, action: () => act.cmd({ type: 'valve', system: sys, valve: 'B', open: st.valveB.cmd < 0.5 }), size: 14 });
  const kg = dose(c, sys, sys === 'trim' ? 500 : 200);
  button(c, { id: `${sys}-dose`, x: x + 38 + 4 * bw, y: by, w: bw, h: 44, label: `${kg} kg`, sub: 'quantidade', tone: 'neutral', tip: 'Quantidade a transferir: clique para alternar (100 · 200 · 500 · 1000 · 2000 kg)', action: () => {
    const opts = [100, 200, 500, 1000, 2000];
    c.ui.dose[sys] = opts[(opts.indexOf(kg) + 1) % opts.length];
  }, size: 14 });
  const d = st.dosing;
  const ay = by + 54;
  button(c, { id: `${sys}-ab`, x: x + 14, y: ay, w: (w - 40) / 3, h: 44, label: `${aLbl} → ${bLbl}`, sub: `transferir ${kg} kg`, tone: 'cmd', tip: `Sequência automática: transferir ${kg} kg de ${aLbl} para ${bLbl}`, action: () => act.cmd({ type: 'dosing', system: sys, mode: 'transferir', kg, dir: 'AtoB' }), size: 15 });
  button(c, { id: `${sys}-ba`, x: x + 20 + (w - 40) / 3, y: ay, w: (w - 40) / 3, h: 44, label: `${bLbl} → ${aLbl}`, sub: `transferir ${kg} kg`, tone: 'cmd', tip: `Sequência automática: transferir ${kg} kg de ${bLbl} para ${aLbl}`, action: () => act.cmd({ type: 'dosing', system: sys, mode: 'transferir', kg, dir: 'BtoA' }), size: 15 });
  button(c, { id: `${sys}-abort`, x: x + 26 + (2 * (w - 40)) / 3, y: ay, w: (w - 40) / 3, h: 44, label: 'INTERROMPER', tone: 'warn', disabled: !d?.active, tip: 'Interromper a sequência', action: () => act.cmd({ type: 'dosingAbort', system: sys }), size: 15 });
  if (d) text(g, `${d.phase} · ${d.moved.toFixed(0)}/${d.target.toFixed(0)} kg ${d.message ? '· ' + d.message : ''}`, x + 14, ay + 60, 14, d.active ? C.cmd : C.dim, 'left', 'bold', false, w - 28);
}

/** tela de TRIM E BANDA (console de segurança do mergulho) */
export function drawTrimHeel(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    const y0 = screenBg(c, 'TRIM E BANDA', 'transferência interna de água');
    const hh = (H - y0 - 70) / 2;
    transferBlock(c, act, 'trim', 14, y0, W - 28, hh);
    transferBlock(c, act, 'heel', 14, y0 + hh + 8, W - 28, hh);
    const o = e.outputs;
    text(g, `θ ${e.state.sensors.INSP.value.toFixed(1)}° (equilíbrio ${o.staticPitchEq.toFixed(1)}°)   ·   φ ${e.state.sensors.INSR.value.toFixed(1)}° (equilíbrio ${o.staticRollEq.toFixed(1)}°)`, W / 2, H - 30, 19, C.text, 'center', 'bold', true);
  };
}

/** válvulas manuais do coletor (volantes 3D) — ordem e rótulos */
export const MANIFOLD_VALVES: { id: string; label: string; sys: 'hp' | FluidSystem; key: string }[] = [
  { id: 'AP1', label: 'ISOL. AP-1', sys: 'hp', key: 'AP1' },
  { id: 'AP2', label: 'ISOL. AP-2', sys: 'hp', key: 'AP2' },
  { id: 'VAM', label: 'ADM. MAR V-AM', sys: 'compensation', key: 'inlet' },
  { id: 'VDM', label: 'DESC. MAR V-DM', sys: 'compensation', key: 'discharge' },
  { id: 'VTAV', label: 'TRIM VANTE', sys: 'trim', key: 'A' },
  { id: 'VTAR', label: 'TRIM RÉ', sys: 'trim', key: 'B' },
  { id: 'VBBB', label: 'BANDA BB', sys: 'heel', key: 'A' },
  { id: 'VBBE', label: 'BANDA BE', sys: 'heel', key: 'B' },
];

/** posição comandada (0/1) de uma válvula do coletor */
export function manifoldValveCmd(e: SimulationEngine, m: (typeof MANIFOLD_VALVES)[number]): number {
  const s = e.state;
  if (m.sys === 'hp') return s.hpAir.banks[m.key]?.valve.pos ?? 0;
  if (m.sys === 'compensation') return (m.key === 'inlet' ? s.compensation.inlet : s.compensation.discharge).pos;
  const t = s[m.sys];
  return (m.key === 'A' ? t.valveA : t.valveB).pos;
}

/** face do COLETOR (válvulas manuais) com a planta hidráulica e manômetros */
export function drawManifold() {
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    const s = e.state;
    const v = e.vessel;
    faceBg(c, '#bfc3bb');
    plate(g, 'COLETOR DE VÁLVULAS · HIDRÁULICA', 20, 14, W - 40, 34, 19);
    const hp = s.hydraulics.pressure / 1e5;
    dial(g, 130, 160, 95, { value: hp, min: 0, max: 250, major: 50, minor: 10, label: 'HIDRÁULICA', unit: 'bar', ordered: null, digits: 0 });
    lamp(c, 60, 290, 13, s.hydraulics.pumpOn, 'green');
    text(g, s.hydraulics.failed ? 'PLANTA EM FALHA' : s.hydraulics.pumpOn ? 'bomba em carga' : 'bomba em espera', 82, 290, 15, '#1a1a1a', 'left', 'bold');
    text(g, `mínimo ${(v.hydraulics.minPressure / 1e5).toFixed(0)} bar`, 60, 316, 13, '#333', 'left');
    v.hpAir.banks.forEach((b, i) => {
      const p = bankPressure(v.hpAir, b.id, s.hpAir.banks[b.id].mass) / 1e5;
      dial(g, 330 + i * 170, 140, 70, { value: p, min: 0, max: 300, major: 100, minor: 20, label: b.id, unit: 'bar', digits: 0 });
    });
    dial(g, W - 110, 140, 70, { value: e.outputs.hpManifoldBar, min: 0, max: 300, major: 100, minor: 20, label: 'COLETOR AP', unit: 'bar', digits: 0 });
    // etiquetas sob os volantes (2 fileiras de 4)
    MANIFOLD_VALVES.forEach((m, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const cx = W * (0.125 + col * 0.25);
      const cy = H * (0.57 + row * 0.24);
      const open = manifoldValveCmd(e, m) > 0.5;
      plate(g, m.label, cx - 95, cy + 62, 190, 28, 14);
      lamp(c, cx + 78, cy - 60, 10, open, 'green');
      lamp(c, cx - 78, cy - 60, 10, !open, 'white');
    });
    text(g, 'volantes: clique para abrir/fechar (mesmas válvulas dos consoles)', W / 2, H - 16, 13, '#2a2a2a', 'center');
  };
}
