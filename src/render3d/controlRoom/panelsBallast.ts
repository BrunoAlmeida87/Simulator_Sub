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
import type { Command, FluidSystem } from '../../sim/commands';
import type { ValveState } from '../../sim/core/state';
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
    text(g, 'INDICADOR DE ABERTURAS DO CASCO', 36, oy + 17, 20, '#e8e4d0', 'left', 'bold');
    text(g, '— fechada   O aberta', W - 280, oy + 17, 18, '#d0ccb8', 'right');
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
      text(g, o.name, x + cw / 2, y + 54, 17, '#e8e4d0', 'center', 'bold', false, cw - 12);
      c.hit({ id: `op-${o.id}`, x: x + 4, y, w: cw - 8, h: 70, label: `${o.name}: ${o.open ? 'ABERTA' : 'FECHADA'}${o.fixed ? ' (não modelada: sempre fechada)' : ''}` });
      void col;
    });
    const green = ops.every((o) => !o.open);
    lampButton(c, {
      id: 'greenboard',
      x: W - 256,
      y: oy,
      w: 232,
      h: 92,
      label: green ? 'QUADRO VERDE' : 'QUADRO VERMELHO',
      sub: green ? 'casco estanque' : 'há aberturas',
      lit: true,
      color: green ? 'green' : 'red',
      tip: green ? 'Todas as aberturas do casco fechadas (condição de imersão segura)' : 'Há aberturas do casco abertas (ver indicador)',
    });
    lampButton(c, {
      id: 'ventall-open',
      x: W - 256,
      y: oy + 104,
      w: 112,
      h: 92,
      label: 'ABRIR',
      sub: 'todos suspiros',
      lit: v.ballast.tanks.every((t) => s.ballast[t.id].vent.cmd > 0.5),
      color: 'red',
      tip: 'Abrir os suspiros de todos os TLP (alagar = imergir)',
      action: () => act.cmd({ type: 'mbtVent', tank: 'ALL', open: true }),
    });
    lampButton(c, {
      id: 'ventall-close',
      x: W - 136,
      y: oy + 104,
      w: 112,
      h: 92,
      label: 'FECHAR',
      sub: 'todos suspiros',
      lit: v.ballast.tanks.every((t) => s.ballast[t.id].vent.cmd < 0.5),
      color: 'green',
      tip: 'Fechar os suspiros de todos os TLP',
      action: () => act.cmd({ type: 'mbtVent', tank: 'ALL', open: false }),
    });
    // --- TLP
    const ty = 278;
    plate(g, 'TANQUES DE LASTRO (TLP)', 24, ty, W - 290, 34, 22);
    const tw = (W - 290) / 4;
    v.ballast.tanks.forEach((t, i) => {
      const st = s.ballast[t.id];
      const x = 24 + i * tw;
      g.fillStyle = '#2a2d2f';
      g.fillRect(x + 6, ty + 40, tw - 12, 300);
      text(g, tid(t.id), x + tw / 2, ty + 58, 24, '#f1efe6', 'center', 'bold');
      text(g, t.center.x > 0 ? 'vante' : 'ré', x + tw / 2, ty + 80, 17, '#d0ccb8', 'center');
      // nível
      const f = st.water / t.volume;
      g.fillStyle = '#e8e2b0';
      g.fillRect(x + 30, ty + 90, tw - 60, 100);
      g.fillStyle = '#2f7fc8';
      g.fillRect(x + 30, ty + 90 + 100 * (1 - f), tw - 60, 100 * f);
      g.strokeStyle = '#111';
      g.lineWidth = 2;
      g.strokeRect(x + 30, ty + 90, tw - 60, 100);
      text(g, `${Math.round(f * 100)} %`, x + tw / 2, ty + 140, 28, '#111', 'center', 'bold', true);
      text(g, st.pAir > 0.5e5 ? `ar ${(st.pAir / 1e5).toFixed(2)} bar` : '—', x + tw / 2, ty + 203, 18, '#e0dccb', 'center');
      const vOpen = st.vent.cmd > 0.5;
      lampButton(c, {
        id: `vent-${t.id}`,
        x: x + 14,
        y: ty + 216,
        w: tw / 2 - 18,
        h: 64,
        label: 'SUSPIRO',
        sub: vOpen ? 'ABERTO' : 'FECHADO',
        lit: true,
        blink: valveStatus(st.vent) === 'ABRINDO' || valveStatus(st.vent) === 'FECHANDO',
        color: st.vent.stuck ? 'amber' : vOpen ? 'red' : 'green',
        tip: `Suspiro ${tid(t.id)}: ${valveStatus(st.vent)} — clique para ${vOpen ? 'FECHAR' : 'ABRIR'}`,
        action: () => act.cmd({ type: 'mbtVent', tank: t.id, open: !vOpen }),
      });
      const bOpen = st.blow.cmd > 0.5;
      lampButton(c, {
        id: `blow-${t.id}`,
        x: x + tw / 2 + 4,
        y: ty + 216,
        w: tw / 2 - 18,
        h: 64,
        label: 'SOPRO',
        sub: bOpen ? 'SOPRANDO' : 'FECHADO',
        lit: bOpen || st.blow.pos > 0.02,
        blink: valveStatus(st.blow) === 'ABRINDO' || valveStatus(st.blow) === 'FECHANDO',
        color: st.blow.stuck ? 'red' : 'amber',
        tip: `Sopro ${tid(t.id)}: ${valveStatus(st.blow)} — clique para ${bOpen ? 'FECHAR' : 'ABRIR (ar AP para o tanque)'}`,
        action: () => act.cmd({ type: 'mbtBlow', tank: t.id, open: !bOpen }),
      });
      text(g, st.qWater > 0.01 ? '▲ alagando' : st.qWater < -0.01 ? '▼ esgotando' : '', x + tw / 2, ty + 298, 19, '#f1efe6', 'center', 'bold');
      if (st.mdotVent > 0.05) text(g, 'ar saindo pelo suspiro', x + tw / 2, ty + 322, 16, '#ffb3a8', 'center');
      if (st.mdotBlow + st.mdotEmergencyBlow > 0.05) text(g, `${st.mdotEmergencyBlow > 0.05 ? 'emergência' : 'sopro'} ${(st.mdotBlow + st.mdotEmergencyBlow).toFixed(1)} kg/s`, x + tw / 2, ty + 322, 16, '#ffe08a', 'center');
    });
    lampButton(c, {
      id: 'blowall',
      x: W - 256,
      y: ty + 40,
      w: 112,
      h: 80,
      label: 'SOPRAR',
      sub: 'todos TLP',
      lit: v.ballast.tanks.some((t) => s.ballast[t.id].blow.cmd > 0.5),
      color: 'amber',
      tip: 'Abrir o sopro de todos os TLP (ar AP expulsa a água = emergir)',
      action: () => act.cmd({ type: 'mbtBlow', tank: 'ALL', open: true }),
    });
    lampButton(c, {
      id: 'blowall-close',
      x: W - 136,
      y: ty + 40,
      w: 112,
      h: 80,
      label: 'FECHAR',
      sub: 'sopro',
      lit: v.ballast.tanks.every((t) => s.ballast[t.id].blow.cmd < 0.5),
      color: 'green',
      tip: 'Fechar o sopro de todos os TLP',
      action: () => act.cmd({ type: 'mbtBlow', tank: 'ALL', open: false }),
    });
    // sopro de emergência (alavancas 3D montadas à direita desta área)
    g.fillStyle = '#b3241b';
    g.fillRect(W - 256, ty + 134, 232, 206);
    g.fillStyle = '#f5d33b';
    for (let k = 0; k < 9; k++) g.fillRect(W - 256 + k * 28, ty + 134, 14, 10);
    text(g, 'SOPRO DE', W - 140, ty + 162, 24, '#fff', 'center', 'bold');
    text(g, 'EMERGÊNCIA', W - 140, ty + 188, 24, '#fff', 'center', 'bold');
    text(g, 'VANTE', W - 196, ty + 326, 20, '#fff', 'center', 'bold');
    text(g, 'RÉ', W - 84, ty + 326, 20, '#fff', 'center', 'bold');
    text(g, 'levantar a tampa e puxar', W - 140, ty + 210, 15, '#ffd9d4', 'center');
    // --- ar de alta pressão
    const ay = ty + 352;
    plate(g, 'AR DE ALTA PRESSÃO (AP)', 24, ay, W - 48, 34, 22);
    const r = 50;
    v.hpAir.banks.forEach((b, i) => {
      const st = s.hpAir.banks[b.id];
      const p = bankPressure(v.hpAir, b.id, st.mass) / 1e5;
      const cx = 90 + i * Math.min(140, 560 / v.hpAir.banks.length);
      dial(g, cx, ay + 112, r, { value: p, min: 0, max: 300, major: 50, minor: 10, label: b.id, unit: 'bar', digits: 0 });
      const open = st.valve.cmd > 0.5;
      lampButton(c, {
        id: `hp-${b.id}`,
        x: cx - 55,
        y: ay + 186,
        w: 110,
        h: 46,
        label: open ? 'ABERTO' : 'ISOLADO',
        sub: `isolamento ${b.id}`,
        lit: true,
        color: open ? 'green' : 'white',
        tip: `${b.name}: ${valveStatus(st.valve)} — clique para ${open ? 'ISOLAR' : 'ABRIR'}`,
        action: () => act.cmd({ type: 'hpBankValve', bank: b.id, open: !open }),
      });
    });
    dial(g, 650, ay + 112, r, { value: e.outputs.hpManifoldBar, min: 0, max: 300, major: 50, minor: 10, label: 'COLETOR NORMAL', unit: 'bar', digits: 0 });
    // compressor
    const cx0 = 720;
    g.fillStyle = '#2a2d2f';
    g.fillRect(cx0, ay + 44, 300, 222);
    text(g, 'COMPRESSOR AP', cx0 + 150, ay + 66, 22, '#f1efe6', 'center', 'bold');
    const run = s.hpAir.compressorRunning;
    lamp(c, cx0 + 40, ay + 110, 16, run, 'green');
    text(g, run ? 'EM CARGA' : s.hpAir.compressorCmd ? 'SEM AR/ENERGIA' : 'PARADO', cx0 + 70, ay + 110, 21, '#f1efe6', 'left', 'bold');
    lampButton(c, {
      id: 'comp-start',
      x: cx0 + 16,
      y: ay + 150,
      w: 130,
      h: 60,
      label: 'PARTIR',
      lit: s.hpAir.compressorCmd,
      color: 'green',
      tip: 'Partir o compressor (precisa de ar externo: superfície ou snorkel)',
      action: () => act.cmd({ type: 'compressor', run: true }),
    });
    lampButton(c, {
      id: 'comp-stop',
      x: cx0 + 154,
      y: ay + 150,
      w: 130,
      h: 60,
      label: 'PARAR',
      lit: !s.hpAir.compressorCmd,
      color: 'white',
      tip: 'Parar o compressor',
      action: () => act.cmd({ type: 'compressor', run: false }),
    });
    text(g, 'tomada de ar: ' + (e.outputs.airIntake ? 'disponível' : 'indisponível'), cx0 + 150, ay + 236, 17, '#e0dccb', 'center');
    // flutuabilidade
    const fx = 1040;
    g.fillStyle = '#2a2d2f';
    g.fillRect(fx, ay + 44, W - fx - 24, 222);
    text(g, e.outputs.surfaced ? 'RESERVA' : 'FLUTUABILIDADE', fx + (W - fx - 24) / 2, ay + 66, 21, '#f1efe6', 'center', 'bold');
    digital(g, fx + 16, ay + 90, W - fx - 56, 60, `${((e.outputs.surfaced ? e.outputs.reserveKg : e.outputs.netBuoyancyKg) / 1000).toFixed(2)} t`);
    const fill = v.ballast.tanks.reduce((a, t) => a + s.ballast[t.id].water, 0) / v.ballast.tanks.reduce((a, t) => a + t.volume, 0);
    text(g, `TLP ${Math.round(fill * 100)} % cheios`, fx + (W - fx - 24) / 2, ay + 180, 23, '#f1efe6', 'center', 'bold');
    text(g, e.outputs.surfaced ? 'na superfície' : 'submerso', fx + (W - fx - 24) / 2, ay + 212, 19, '#e0dccb', 'center');
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
    const y0 = screenBg(c, 'COMPENSAÇÃO', 'mar ⇄ TC-1 / TC-2');
    // diagrama: mar → V-AM → coletor → TC; coletor → bomba → V-DM → mar
    const inY = y0 + 58;
    const outY = y0 + 214;
    const manX = 330;
    const manY = y0 + 136;
    g.fillStyle = '#0c3355';
    g.fillRect(12, y0 + 6, 74, 290);
    text(g, 'MAR', 49, y0 + 28, 22, '#9fd0ff', 'center', 'bold');
    const qIn = cs.qIn;
    const qOut = cs.qOut;
    pipe(
      g,
      [
        [86, inY],
        [manX, inY],
        [manX, manY],
      ],
      C.water,
      10,
      qIn > 1e-5 ? 1 : 0,
      now,
    );
    pipe(
      g,
      [
        [manX, manY],
        [manX, outY],
        [86, outY],
      ],
      C.water,
      10,
      qOut > 1e-5 ? 1 : 0,
      now,
    );
    pipe(
      g,
      [
        [manX, manY],
        [W - 40, manY],
      ],
      C.water,
      10,
      Math.abs(qIn - qOut) > 1e-5 ? 1 : 0,
      now,
    );
    // admissão (pressão do mar)
    const vam = valveStatus(cs.inlet);
    valveSym(g, 150, inY, 20, vam);
    button(c, {
      id: 'c-vam',
      x: 96,
      y: inY + 18,
      w: 126,
      h: 54,
      label: 'V-AM',
      sub: vam,
      on: cs.inlet.cmd > 0.5,
      tone: 'ok',
      tip: `${v.compensation.inletValve.name}: ${vam} — clique para ${cs.inlet.cmd > 0.5 ? 'FECHAR' : 'ABRIR'} (o mar entra pela pressão externa)`,
      action: () => act.cmd({ type: 'valve', system: 'compensation', valve: 'inlet', open: cs.inlet.cmd < 0.5 }),
      size: 22,
    });
    text(g, `${(qIn * 1000).toFixed(1)} L/s`, 270, inY - 22, 20, '#a9c3d6', 'center', 'bold', true);
    // descarga com bomba
    const vdm = valveStatus(cs.discharge);
    valveSym(g, 130, outY, 20, vdm);
    pumpSym(g, 254, outY, 28, cs.pump.speed, cs.pump.failed, now);
    button(c, {
      id: 'c-vdm',
      x: 92,
      y: outY + 30,
      w: 116,
      h: 54,
      label: 'V-DM',
      sub: vdm,
      on: cs.discharge.cmd > 0.5,
      tone: 'ok',
      tip: `${v.compensation.dischargeValve.name}: ${vdm} — clique para ${cs.discharge.cmd > 0.5 ? 'FECHAR' : 'ABRIR'}`,
      action: () => act.cmd({ type: 'valve', system: 'compensation', valve: 'discharge', open: cs.discharge.cmd < 0.5 }),
      size: 22,
    });
    const ps = pumpStatus(cs.pump, s.electrical.energized);
    button(c, {
      id: 'c-pump',
      x: 214,
      y: outY + 30,
      w: 140,
      h: 54,
      label: 'BOMBA',
      sub: ps,
      on: cs.pump.cmd,
      tone: cs.pump.failed ? 'danger' : 'ok',
      tip: `${v.compensation.pump.name}: ${ps} — clique para ${cs.pump.cmd ? 'PARAR' : 'PARTIR'} (esgota ao mar)`,
      action: () => act.cmd({ type: 'pump', system: 'compensation', run: !cs.pump.cmd }),
      size: 22,
    });
    text(g, `${(qOut * 1000).toFixed(1)} L/s`, 254, outY - 44, 20, '#a9c3d6', 'center', 'bold', true);
    // tanques de compensação
    v.compensation.tanks.forEach((t, i) => {
      const x = 430 + i * 262;
      const vcfg = v.compensation.tankValves[i];
      const vs = cs.tankValves[vcfg.id];
      const st = valveStatus(vs);
      pipe(
        g,
        [
          [x + 70, manY],
          [x + 70, y0 + 102],
        ],
        C.water,
        9,
        Math.abs(cs.tanks[t.id].flow ?? 0) > 1e-5 ? 1 : 0,
        now,
      );
      tankSym(g, x, y0 + 36, 140, 64, cs.tanks[t.id].mass / tankCapacityMass(t), t.id.replace('TC', 'TC-'));
      valveSym(g, x + 70, manY - 18, 15, st, true);
      text(g, `${tankVolume(cs.tanks[t.id]).toFixed(2)} / ${t.capacity} m³`, x + 70, manY + 30, 19, '#a9c3d6', 'center', 'bold', true);
      button(c, {
        id: `c-${vcfg.id}`,
        x: x + 4,
        y: manY + 52,
        w: 132,
        h: 54,
        label: vcfg.id,
        sub: st,
        on: vs.cmd > 0.5,
        tone: 'ok',
        tip: `${vcfg.name}: ${st} — clique para ${vs.cmd > 0.5 ? 'FECHAR' : 'ABRIR'}`,
        action: () => act.cmd({ type: 'valve', system: 'compensation', valve: vcfg.id, open: vs.cmd < 0.5 }),
        size: 22,
      });
    });
    // dosagem
    const dy = y0 + 304;
    box(g, 12, dy, W - 24, H - dy - 10, 'SEQUÊNCIA AUTOMÁTICA');
    const kg = dose(c, 'comp', 500);
    stepper(
      c,
      'c-dose',
      22,
      dy + 40,
      52,
      [-500, -100, 100, 500],
      kg,
      (x) => `${x} kg`,
      (x) => (c.ui.dose.comp = Math.max(50, Math.min(10000, x))),
      'Quantidade a dosar',
      66,
    );
    const d = cs.dosing;
    button(c, {
      id: 'c-adm',
      x: 584,
      y: dy + 40,
      w: 168,
      h: 52,
      label: 'ADMITIR',
      tone: 'cmd',
      tip: `Admitir ${kg} kg do mar (fica mais pesado)`,
      action: () => act.cmd({ type: 'dosing', system: 'compensation', mode: 'admitir', kg }),
      size: 23,
    });
    button(c, {
      id: 'c-esg',
      x: 758,
      y: dy + 40,
      w: 180,
      h: 52,
      label: 'ESGOTAR',
      tone: 'cmd',
      tip: `Esgotar ${kg} kg ao mar (fica mais leve)`,
      action: () => act.cmd({ type: 'dosing', system: 'compensation', mode: 'esgotar', kg }),
      size: 23,
    });
    text(g, d ? `${d.mode.toUpperCase()} · ${d.phase} · ${d.moved.toFixed(0)}/${d.target.toFixed(0)} kg` : 'sem sequência em andamento', 24, dy + 116, 21, d?.active ? C.cmd : '#a9c3d6', 'left', 'bold', false, 690);
    button(c, {
      id: 'c-abort',
      x: 758,
      y: dy + 98,
      w: 180,
      h: 40,
      label: 'INTERROMPER',
      tone: 'warn',
      disabled: !d?.active,
      tip: 'Interromper a sequência automática',
      action: () => act.cmd({ type: 'dosingAbort', system: 'compensation' }),
      size: 20,
    });
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
      x: 22,
      y: dy + 146,
      w: 420,
      h: 64,
      label: 'AJUSTE CALCULADO',
      sub: Number.isFinite(dm) ? `${dm >= 0 ? 'admitir' : 'esgotar'} ${(Math.abs(dm) / 1000).toFixed(2)} t para ${calcDepth.toFixed(0)} m` : 'indisponível',
      tone: 'ok',
      disabled: !Number.isFinite(dm) || Math.abs(dm) < 10,
      tip: 'Sequência automática com a quantidade que deixa o submarino neutro na cota (cálculo de equilíbrio)',
      action: () => act.cmd({ type: 'dosing', system: 'compensation', mode: dm > 0 ? 'admitir' : 'esgotar', kg: Math.abs(dm) }),
      size: 24,
    });
    const nb = e.outputs.surfaced ? e.outputs.reserveKg : e.outputs.netBuoyancyKg;
    text(g, e.outputs.surfaced ? 'RESERVA' : 'FLUTUABILIDADE', 460, dy + 160, 21, '#a9c3d6', 'left', 'bold');
    text(g, `${(nb / 1000).toFixed(2)} t`, W - 24, dy + 160, 28, nb >= 0 ? C.real : C.warn, 'right', 'bold', true);
    hbar(g, 460, dy + 186, W - 484, 22, 0.5 + Math.max(-1, Math.min(1, nb / 10000)) / 2, nb >= 0 ? C.real : C.warn, 0.5);
  };
}

function transferBlock(c: DrawCtx, act: RoomActions, sys: Exclude<FluidSystem, 'compensation'>, x: number, y: number, w: number, h: number): void {
  const { g, e, now } = c;
  const s = e.state;
  const cfg = e.vessel[sys];
  const st = s[sys];
  const ang = sys === 'trim' ? `θ ${s.sensors.INSP.value.toFixed(1)}° (eq. ${e.outputs.staticPitchEq.toFixed(1)}°)` : `φ ${s.sensors.INSR.value.toFixed(1)}° (eq. ${e.outputs.staticRollEq.toFixed(1)}°)`;
  box(g, x, y, w, h, sys === 'trim' ? 'TRIM (vante ⇄ ré)' : 'BANDA (BB ⇄ BE)');
  text(g, ang, x + w - 14, y + 17, 20, C.real, 'right', 'bold', true);
  const ta = cfg.tankA;
  const tb = cfg.tankB;
  const aLbl = sys === 'trim' ? 'TT-AV' : 'TB-BB';
  const bLbl = sys === 'trim' ? 'TT-AR' : 'TB-BE';
  const ty = y + 60;
  tankSym(g, x + 16, ty, 124, 58, st.tankA.mass / tankCapacityMass(ta), aLbl);
  tankSym(g, x + w - 140, ty, 124, 58, st.tankB.mass / tankCapacityMass(tb), bLbl);
  text(g, `${tankVolume(st.tankA).toFixed(2)} m³`, x + 78, ty + 74, 18, '#a9c3d6', 'center', 'bold', true);
  text(g, `${tankVolume(st.tankB).toFixed(2)} m³`, x + w - 78, ty + 74, 18, '#a9c3d6', 'center', 'bold', true);
  const mid = x + w / 2;
  const py = ty + 29;
  const flowing = Math.abs(st.flow) > 1e-5;
  pipe(
    g,
    [
      [x + 140, py],
      [x + w - 140, py],
    ],
    C.water,
    9,
    flowing ? Math.sign(st.flow) : 0,
    now,
  );
  const va = valveStatus(st.valveA);
  const vb = valveStatus(st.valveB);
  valveSym(g, x + 186, py, 15, va);
  valveSym(g, x + w - 186, py, 15, vb);
  pumpSym(g, mid, py, 24, st.pump.speed, st.pump.failed, now);
  const dirAB = st.direction.cmd < 0.5;
  text(g, dirAB ? `${aLbl} → ${bLbl}` : `${bLbl} → ${aLbl}`, mid, py - 40, 21, C.cmd, 'center', 'bold');
  const bw = (w - 20 - 4 * 6) / 5;
  const by = y + h - 120;
  const B = (i: number) => x + 10 + i * (bw + 6);
  button(c, {
    id: `${sys}-va`,
    x: B(0),
    y: by,
    w: bw,
    h: 54,
    label: cfg.valveA.id,
    sub: va,
    on: st.valveA.cmd > 0.5,
    tone: 'ok',
    tip: `${cfg.valveA.name}: ${va}`,
    action: () => act.cmd({ type: 'valve', system: sys, valve: 'A', open: st.valveA.cmd < 0.5 }),
    size: 21,
  });
  button(c, {
    id: `${sys}-dir`,
    x: B(1),
    y: by,
    w: bw,
    h: 54,
    label: 'SENTIDO',
    sub: dirAB ? 'A→B' : 'B→A',
    tone: 'neutral',
    tip: `Seletor de sentido: inverter para ${dirAB ? `${bLbl} → ${aLbl}` : `${aLbl} → ${bLbl}`}`,
    action: () => act.cmd({ type: 'direction', system: sys, dir: dirAB ? 'BtoA' : 'AtoB' }),
    size: 21,
  });
  const ps = pumpStatus(st.pump, s.electrical.energized);
  button(c, {
    id: `${sys}-pump`,
    x: B(2),
    y: by,
    w: bw,
    h: 54,
    label: 'BOMBA',
    sub: ps,
    on: st.pump.cmd,
    tone: st.pump.failed ? 'danger' : 'ok',
    tip: `${cfg.pump.name}: ${ps}`,
    action: () => act.cmd({ type: 'pump', system: sys, run: !st.pump.cmd }),
    size: 21,
  });
  button(c, {
    id: `${sys}-vb`,
    x: B(3),
    y: by,
    w: bw,
    h: 54,
    label: cfg.valveB.id,
    sub: vb,
    on: st.valveB.cmd > 0.5,
    tone: 'ok',
    tip: `${cfg.valveB.name}: ${vb}`,
    action: () => act.cmd({ type: 'valve', system: sys, valve: 'B', open: st.valveB.cmd < 0.5 }),
    size: 21,
  });
  const kg = dose(c, sys, sys === 'trim' ? 500 : 200);
  button(c, {
    id: `${sys}-dose`,
    x: B(4),
    y: by,
    w: bw,
    h: 54,
    label: `${kg} kg`,
    sub: 'quantidade',
    tone: 'neutral',
    tip: 'Quantidade a transferir: clique para alternar (100 · 200 · 500 · 1000 · 2000 kg)',
    action: () => {
      const opts = [100, 200, 500, 1000, 2000];
      c.ui.dose[sys] = opts[(opts.indexOf(kg) + 1) % opts.length];
    },
    size: 21,
  });
  const d = st.dosing;
  const ay = by + 60;
  const tw = (w - 20 - 2 * 6) / 3;
  button(c, {
    id: `${sys}-ab`,
    x: x + 10,
    y: ay,
    w: tw,
    h: 52,
    label: `${aLbl} → ${bLbl}`,
    sub: d?.active ? `${d.moved.toFixed(0)}/${d.target.toFixed(0)} kg` : `transferir ${kg} kg`,
    tone: 'cmd',
    tip: `Sequência automática: transferir ${kg} kg de ${aLbl} para ${bLbl}`,
    action: () => act.cmd({ type: 'dosing', system: sys, mode: 'transferir', kg, dir: 'AtoB' }),
    size: 21,
  });
  button(c, {
    id: `${sys}-ba`,
    x: x + 16 + tw,
    y: ay,
    w: tw,
    h: 52,
    label: `${bLbl} → ${aLbl}`,
    sub: d ? d.phase : `transferir ${kg} kg`,
    tone: 'cmd',
    tip: `Sequência automática: transferir ${kg} kg de ${bLbl} para ${aLbl}`,
    action: () => act.cmd({ type: 'dosing', system: sys, mode: 'transferir', kg, dir: 'BtoA' }),
    size: 21,
  });
  button(c, {
    id: `${sys}-abort`,
    x: x + 22 + 2 * tw,
    y: ay,
    w: tw,
    h: 52,
    label: 'INTERROMPER',
    tone: 'warn',
    disabled: !d?.active,
    tip: 'Interromper a sequência',
    action: () => act.cmd({ type: 'dosingAbort', system: sys }),
    size: 21,
  });
}

/** tela de TRIM E BANDA (console de segurança do mergulho) */
export function drawTrimHeel(act: RoomActions) {
  return (c: DrawCtx) => {
    const { W, H } = c;
    const y0 = screenBg(c, 'TRIM E BANDA', 'transferência interna de água');
    const hh = (H - y0 - 16) / 2;
    transferBlock(c, act, 'trim', 12, y0, W - 24, hh);
    transferBlock(c, act, 'heel', 12, y0 + hh + 6, W - 24, hh);
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

type ManifoldValve = (typeof MANIFOLD_VALVES)[number];

function manifoldValveState(e: SimulationEngine, m: ManifoldValve): ValveState | undefined {
  const s = e.state;
  if (m.sys === 'hp') return s.hpAir.banks[m.key]?.valve;
  if (m.sys === 'compensation') return m.key === 'inlet' ? s.compensation.inlet : s.compensation.discharge;
  const t = s[m.sys];
  return m.key === 'A' ? t.valveA : t.valveB;
}

/** posição REAL (0…1) de uma válvula do coletor (lâmpadas e giro do volante) */
export function manifoldValveCmd(e: SimulationEngine, m: ManifoldValve): number {
  return manifoldValveState(e, m)?.pos ?? 0;
}

/** posição COMANDADA (0/1) de uma válvula do coletor */
export function manifoldValveOrder(e: SimulationEngine, m: ManifoldValve): number {
  return manifoldValveState(e, m)?.cmd ?? 0;
}

/** comando do volante: inverte a ORDEM atual (mesmo com a válvula ainda em curso) */
export function manifoldToggle(e: SimulationEngine, m: ManifoldValve): Command {
  const open = manifoldValveOrder(e, m) < 0.5;
  return m.sys === 'hp' ? { type: 'hpBankValve', bank: m.key, open } : { type: 'valve', system: m.sys, valve: m.key, open };
}

/** face do COLETOR (válvulas manuais) com a planta hidráulica e manômetros */
export function drawManifold() {
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    const s = e.state;
    const v = e.vessel;
    faceBg(c, '#bfc3bb');
    plate(g, 'COLETOR DE VÁLVULAS · HIDRÁULICA', 20, 12, W - 40, 40, 24);
    const hp = s.hydraulics.pressure / 1e5;
    dial(g, 130, 160, 95, { value: hp, min: 0, max: 250, major: 50, minor: 10, label: 'HIDRÁULICA', unit: 'bar', ordered: null, digits: 0 });
    lamp(c, 60, 290, 13, s.hydraulics.pumpOn, 'green');
    text(g, s.hydraulics.failed ? 'PLANTA EM FALHA' : s.hydraulics.pumpOn ? 'bomba em carga' : 'bomba em espera', 82, 290, 20, '#1a1a1a', 'left', 'bold');
    text(g, `mínimo ${(v.hydraulics.minPressure / 1e5).toFixed(0)} bar`, 60, 318, 18, '#333', 'left');
    v.hpAir.banks.forEach((b, i) => {
      const p = bankPressure(v.hpAir, b.id, s.hpAir.banks[b.id].mass) / 1e5;
      const gap = (W - 490) / v.hpAir.banks.length;
      dial(g, 270 + (i + 0.5) * gap, 140, Math.min(60, gap * 0.36), { value: p, min: 0, max: 300, major: 100, minor: 20, label: b.id, unit: 'bar', digits: 0 });
    });
    dial(g, W - 110, 140, 70, { value: e.outputs.hpManifoldBar, min: 0, max: 300, major: 100, minor: 20, label: 'COLETOR AP', unit: 'bar', digits: 0 });
    // etiquetas sob os volantes (2 fileiras de 4)
    MANIFOLD_VALVES.forEach((m, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const cx = W * (0.125 + col * 0.25);
      const cy = H * (0.57 + row * 0.24);
      const open = manifoldValveCmd(e, m) > 0.5;
      plate(g, m.label, cx - 110, cy + 60, 220, 34, 19);
      lamp(c, cx + 78, cy - 60, 10, open, 'green');
      lamp(c, cx - 78, cy - 60, 10, !open, 'white');
    });
    text(g, 'clique nos volantes para abrir/fechar', W / 2, H - 18, 18, '#2a2a2a', 'center');
  };
}
