/**
 * CONSOLE DA PLATAFORMA (gestão integrada: energia e propulsão) e ESTAÇÃO DO
 * INSTRUTOR (simulador: falhas, ambiente, tempo e cenários).
 */
import type { DrawCtx } from './panel';
import type { RoomActions } from './actions';
import { C, box, button, dial, digital, hbar, screenBg, text } from './draw';
import { failureCatalog, isFailureActive } from '../../sim/commands';
import type { SensorFailMode } from '../../sim/core/state';
import { SEA_STATES } from '../../sim/environment/waves';
import { toKnots } from '../../sim/units';

/** tela de ENERGIA: bateria, disjuntor, diesel-geradores, snorkel, combustível e cargas */
export function drawEnergy(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    const s = e.state;
    const el = s.electrical;
    const v = e.vessel;
    const y0 = screenBg(c, 'ENERGIA', 'bateria e geração');
    // bateria
    box(g, 12, y0, 458, 262, 'BATERIA');
    const soc = el.soc;
    g.fillStyle = '#0a1520';
    g.fillRect(26, y0 + 40, 140, 206);
    g.fillStyle = soc > 0.5 ? C.real : soc > 0.25 ? C.warn : C.alarm;
    g.fillRect(30, y0 + 44 + 198 * (1 - soc), 132, 198 * soc);
    g.strokeStyle = C.line;
    g.lineWidth = 2;
    g.strokeRect(26, y0 + 40, 140, 206);
    text(g, `${(soc * 100).toFixed(0)}%`, 96, y0 + 143, 42, '#fff', 'center', 'bold', true);
    digital(g, 178, y0 + 40, 280, 58, `${el.voltage.toFixed(0)} V`, '#7dff9c', 'TENSÃO');
    digital(g, 178, y0 + 104, 280, 58, `${el.current.toFixed(0)} A`, el.current < -1 ? C.cmd : '#7dff9c', el.current < -1 ? 'CORRENTE (carga)' : 'CORRENTE (descarga)');
    const armed = !!c.ui.guards.breaker;
    button(c, {
      id: 'brk',
      x: 178,
      y: y0 + 176,
      w: 280,
      h: 70,
      label: el.breakerClosed ? (armed ? 'CONFIRMAR ABERTURA' : 'DISJUNTOR FECHADO') : 'DISJUNTOR ABERTO',
      sub: el.breakerClosed ? (armed ? 'clique de novo para abrir' : el.energized ? 'barramento energizado' : 'SEM ENERGIA') : 'clique para fechar',
      on: el.breakerClosed,
      tone: armed ? 'danger' : el.breakerClosed ? 'ok' : 'warn',
      tip: el.breakerClosed ? 'Disjuntor principal da bateria (abrir exige confirmação: segundo clique)' : 'Fechar o disjuntor principal da bateria',
      action: () => {
        if (!el.breakerClosed) act.cmd({ type: 'breaker', closed: true });
        else if (armed) {
          c.ui.guards.breaker = false;
          act.cmd({ type: 'breaker', closed: false });
        } else {
          c.ui.guards.breaker = true;
          window.setTimeout(() => (c.ui.guards.breaker = false), 4000);
        }
      },
      size: 22,
    });
    // geradores
    box(g, 480, y0, W - 492, 262, 'DIESEL-GERADORES');
    v.electrical.generators.forEach((gen, i) => {
      const st = el.generators[gen.id];
      const y = y0 + 42 + i * 108;
      text(g, gen.id, 496, y + 26, 30, C.text, 'left', 'bold');
      const col = st.status === 'EM CARGA' ? C.real : st.status === 'PARTINDO' || st.status === 'PARANDO' ? C.warn : st.status === 'FALHA' || st.status === 'SEM AR' ? C.alarm : '#a9c3d6';
      text(g, st.status, 496, y + 66, 22, col, 'left', 'bold');
      text(g, `${(st.power / 1000).toFixed(0)} kW`, 660, y + 26, 24, C.text, 'left', 'bold', true);
      button(c, {
        id: `gen-${gen.id}`,
        x: W - 186,
        y: y + 4,
        w: 166,
        h: 78,
        label: st.cmd ? 'PARAR' : 'PARTIR',
        sub: gen.id,
        on: st.cmd,
        tone: st.failed ? 'danger' : 'ok',
        tip: `${gen.name}: ${st.status} — clique para ${st.cmd ? 'PARAR' : 'PARTIR'} (precisa de ar: superfície ou snorkel)`,
        action: () => act.cmd({ type: 'generator', id: gen.id, run: !st.cmd }),
        size: 26,
      });
    });
    // snorkel
    const sy = y0 + 272;
    box(g, 12, sy, 458, H - sy - 10, 'SNORKEL');
    const sn = s.snorkel;
    hbar(g, 26, sy + 44, 250, 30, sn.pos, C.cmd);
    text(g, `${Math.round(sn.pos * 100)} % içado`, 290, sy + 59, 24, C.text, 'left', 'bold');
    text(g, `cabeça ${sn.headValveOpen ? 'ABERTA' : 'FECHADA'}`, 26, sy + 104, 24, sn.headValveOpen ? C.real : '#a9c3d6', 'left', 'bold');
    text(g, e.outputs.airIntake ? 'com tomada de ar' : 'sem tomada de ar', 26, sy + 140, 21, '#a9c3d6', 'left');
    button(c, {
      id: 'snk',
      x: 26,
      y: sy + 172,
      w: 430,
      h: 70,
      label: sn.cmd ? 'ARRIAR SNORKEL' : 'IÇAR SNORKEL',
      on: sn.cmd,
      tone: 'cmd',
      tip: sn.cmd ? 'Arriar o mastro do snorkel' : 'Içar o mastro do snorkel (cota periscópica)',
      action: () => act.cmd({ type: 'snorkel', raise: !sn.cmd }),
      size: 26,
    });
    // combustível e cargas
    box(g, 480, sy, W - 492, H - sy - 10, 'COMBUSTÍVEL E CARGAS');
    const fuelCap = v.electrical.fuel.tankVolume;
    hbar(g, 496, sy + 44, W - 640, 26, el.fuel / fuelCap, '#d9a441');
    text(g, `${el.fuel.toFixed(0)} m³`, W - 26, sy + 57, 24, C.text, 'right', 'bold', true);
    const loads = Object.entries(el.loads)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    loads.forEach(([k, w], i) => {
      text(g, k, 496, sy + 100 + i * 34, 22, C.text, 'left');
      text(g, `${(w / 1000).toFixed(0)} kW`, W - 26, sy + 100 + i * 34, 22, C.text, 'right', 'bold', true);
    });
    text(g, `demanda ${(el.totalLoad / 1000).toFixed(0)} · geração ${(el.generation / 1000).toFixed(0)} kW`, 496, H - 32, 21, C.cmd, 'left', 'bold', false, W - 520);
  };
}

/** tela de PROPULSÃO E HIDRÁULICA */
export function drawPropulsion(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    const s = e.state;
    const p = s.propulsion;
    const rated = e.vessel.propulsion.motor.ratedRpm;
    const y0 = screenBg(c, 'PROPULSÃO', 'motor e hidráulica');
    dial(g, 166, y0 + 166, 152, { value: e.outputs.rpm, min: -rated, max: rated, major: 40, minor: 10, label: 'EIXO', unit: 'rpm', ordered: p.rpmCmd, dark: true, digits: 0 });
    box(g, 334, y0, W - 346, 342, 'MOTOR PRINCIPAL');
    const rows: [string, string, string?][] = [
      ['Ordem', `${p.rpmCmd.toFixed(0)} rpm`],
      ['Eixo', `${e.outputs.rpm.toFixed(0)} rpm`],
      ['Potência no eixo', `${(p.shaftPower / 1e6).toFixed(2)} MW`],
      ['Empuxo', `${(p.thrust / 1e3).toFixed(0)} kN`],
      ['Velocidade', `${toKnots(s.sensors.DVLU.value).toFixed(1)} nós`],
      ['Situação', p.failed ? 'FALHA' : p.powerLimited ? 'LIMITADO' : 'normal', p.failed ? C.alarm : p.powerLimited ? C.warn : C.real],
    ];
    rows.forEach(([k, v, col], i) => {
      text(g, k, 352, y0 + 58 + i * 48, 23, '#a9c3d6', 'left');
      text(g, v, W - 30, y0 + 58 + i * 48, 27, col ?? C.text, 'right', 'bold', true);
    });
    // hidráulica e compressor
    const hy = y0 + 352;
    const hyd = s.hydraulics;
    const nom = e.vessel.hydraulics.nominalPressure;
    const hw = (W - 34) / 2;
    box(g, 12, hy, hw, H - hy - 10, 'HIDRÁULICA');
    hbar(g, 26, hy + 46, hw - 28, 28, hyd.pressure / nom, hyd.pressure < e.vessel.hydraulics.minPressure * 1.25 ? C.alarm : C.real, e.vessel.hydraulics.minPressure / nom);
    text(g, `${(hyd.pressure / 1e5).toFixed(0)} bar`, 26, hy + 112, 36, C.text, 'left', 'bold', true);
    text(g, hyd.failed ? 'FALHA DA PLANTA' : hyd.pumpOn ? 'bomba em carga' : 'bomba em espera', 26, hy + 160, 22, hyd.failed ? C.alarm : '#a9c3d6', 'left', 'bold');
    const x2 = 22 + hw;
    box(g, x2, hy, hw, H - hy - 10, 'COMPRESSOR AP');
    text(g, s.hpAir.compressorRunning ? 'EM CARGA' : s.hpAir.compressorCmd ? 'SEM AR/ENERGIA' : 'PARADO', x2 + 14, hy + 58, 24, s.hpAir.compressorRunning ? C.real : '#a9c3d6', 'left', 'bold');
    text(g, `coletor ${e.outputs.hpManifoldBar.toFixed(0)} bar`, x2 + 14, hy + 96, 22, C.text, 'left', 'bold', true);
    button(c, {
      id: 'p-comp',
      x: x2 + 14,
      y: hy + 124,
      w: hw - 28,
      h: 62,
      label: s.hpAir.compressorCmd ? 'PARAR' : 'PARTIR',
      sub: 'compressor',
      on: s.hpAir.compressorCmd,
      tone: 'ok',
      tip: 'Compressor de ar AP (precisa de ar externo e energia)',
      action: () => act.cmd({ type: 'compressor', run: !s.hpAir.compressorCmd }),
      size: 26,
    });
  };
}

const SCALES = [0.5, 1, 2, 5, 10, 20];

/** tela do instrutor: FALHAS (injetar/remover por grupo) */
export function drawInstructorFailures(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    const y0 = screenBg(c, 'INSTRUTOR — FALHAS');
    const cat = failureCatalog(e);
    const groups = [...new Set(cat.map((f) => f.group))];
    const gi = Math.min(groups.length - 1, c.ui.page.instrGroup ?? 0);
    // abas dos grupos em duas fileiras
    const perRow = Math.ceil(groups.length / 2);
    const bw = (W - 24 - (perRow - 1) * 6) / perRow;
    groups.forEach((gr, i) => {
      const n = cat.filter((f) => f.group === gr && isFailureActive(e, f.target)).length;
      button(c, {
        id: `fg-${gr}`,
        x: 12 + (i % perRow) * (bw + 6),
        y: y0 + Math.floor(i / perRow) * 52,
        w: bw,
        h: 46,
        label: n ? `${gr} (${n})` : gr,
        on: i === gi,
        tone: n ? 'danger' : 'neutral',
        tip: `Falhas do grupo ${gr}${n ? ` — ${n} ativa(s)` : ''}`,
        action: () => (c.ui.page.instrGroup = i),
        size: 19,
      });
    });
    const list = cat.filter((f) => f.group === groups[gi]);
    const pg = c.ui.page.instrPage ?? 0;
    const per = 6;
    const pages = Math.max(1, Math.ceil(list.length / per));
    const cur = Math.min(pg, pages - 1);
    const ly = y0 + 110;
    list.slice(cur * per, cur * per + per).forEach((f, i) => {
      const y = ly + i * 66;
      const on = isFailureActive(e, f.target);
      button(c, {
        id: `f-${f.target}`,
        x: 12,
        y,
        w: W - 24,
        h: 60,
        label: f.name,
        sub: on ? 'ATIVA — clique para remover' : f.effect,
        on,
        tone: on ? 'danger' : 'neutral',
        tip: `${on ? 'Remover' : 'Injetar'}: ${f.name}${f.param ? ` (${f.param.label} ${f.param.default} ${f.param.unit})` : ''}${f.modes ? ` (modo ${f.modes[0]})` : ''}`,
        action: () => act.cmd({ type: 'failure', target: f.target, active: !on, param: on ? undefined : f.modes ? (f.modes[0] as SensorFailMode) : f.param ? f.param.default : undefined }),
        size: 22,
      });
    });
    if (pages > 1) {
      button(c, { id: 'fp-prev', x: 12, y: H - 58, w: 170, h: 48, label: '◀ anterior', tone: 'neutral', disabled: cur === 0, tip: 'Página anterior', action: () => (c.ui.page.instrPage = cur - 1), size: 22 });
      text(g, `${cur + 1}/${pages}`, W / 2, H - 34, 24, '#a9c3d6', 'center', 'bold');
      button(c, { id: 'fp-next', x: W - 182, y: H - 58, w: 170, h: 48, label: 'próxima ▶', tone: 'neutral', disabled: cur >= pages - 1, tip: 'Próxima página', action: () => (c.ui.page.instrPage = cur + 1), size: 22 });
    }
    if (gi !== (c.ui.page.instrGroupPrev ?? gi)) c.ui.page.instrPage = 0;
    c.ui.page.instrGroupPrev = gi;
  };
}

/** tela do instrutor: SIMULAÇÃO E AMBIENTE (executar, aceleração, mar, cenário, peso deslocável, iluminação) */
export function drawInstructorSim(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W } = c;
    const y0 = screenBg(c, 'INSTRUTOR — SIMULAÇÃO E AMBIENTE');
    box(g, 14, y0, W - 28, 130, 'TEMPO DA SIMULAÇÃO');
    const run = act.sim.running();
    button(c, { id: 'i-run', x: 26, y: y0 + 34, w: 200, h: 80, label: run ? '❚❚ PAUSAR' : '▶ EXECUTAR', on: run, tone: 'ok', tip: 'Executar/pausar a simulação', action: () => act.sim.toggleRun(), size: 22 });
    const ts = act.sim.timeScale();
    const bw = (W - 290 - 5 * 6) / 6;
    SCALES.forEach((k, i) =>
      button(c, {
        id: `i-ts-${k}`,
        x: 240 + i * (bw + 6),
        y: y0 + 34,
        w: bw,
        h: 80,
        label: `×${k}`,
        on: ts === k,
        tone: 'cmd',
        tip: `Aceleração do tempo ×${k} (a física usa sempre o mesmo passo)`,
        action: () => act.sim.setTimeScale(k),
        size: 22,
      }),
    );
    // mar
    const my = y0 + 140;
    box(g, 14, my, W - 28, 100, 'ESTADO DO MAR');
    const ss = Math.round(e.env.cfg.waves?.seaState ?? 0);
    button(c, { id: 'i-sea-', x: 26, y: my + 34, w: 70, h: 54, label: '−', tone: 'neutral', disabled: ss <= 0, tip: 'Mar mais calmo', action: () => act.cmd({ type: 'seaState', value: ss - 1 }), size: 28 });
    text(g, SEA_STATES[ss]?.label ?? String(ss), 110, my + 61, 24, C.text, 'left', 'bold', false, W - 260);
    button(c, {
      id: 'i-sea+',
      x: W - 96,
      y: my + 34,
      w: 70,
      h: 54,
      label: '+',
      tone: 'neutral',
      disabled: ss >= SEA_STATES.length - 1,
      tip: 'Mar mais agitado',
      action: () => act.cmd({ type: 'seaState', value: ss + 1 }),
      size: 28,
    });
    // cenário
    const cy = my + 110;
    box(g, 14, cy, W - 28, 100, 'CENÁRIO');
    const list = act.sim.scenarios();
    const k = ((c.ui.scenario % list.length) + list.length) % list.length;
    button(c, { id: 'i-sc-', x: 26, y: cy + 34, w: 60, h: 54, label: '◀', tone: 'neutral', tip: 'Cenário anterior', action: () => (c.ui.scenario = k - 1), size: 22 });
    text(g, list[k]?.name ?? '—', 100, cy + 61, 22, list[k]?.id === e.state.scenarioId ? C.real : C.text, 'left', 'bold', false, W - 380);
    button(c, { id: 'i-sc+', x: W - 266, y: cy + 34, w: 60, h: 54, label: '▶', tone: 'neutral', tip: 'Próximo cenário', action: () => (c.ui.scenario = k + 1), size: 22 });
    button(c, {
      id: 'i-sc-load',
      x: W - 196,
      y: cy + 34,
      w: 170,
      h: 54,
      label: 'CARREGAR',
      sub: 'pausado',
      tone: 'warn',
      tip: `Carregar o cenário "${list[k]?.name}" (a simulação atual é substituída)`,
      action: () => list[k] && act.sim.loadScenario(list[k].id),
    });
    // peso deslocável e iluminação
    const py = cy + 110;
    const dw = e.state.demoWeight;
    const dwc = e.vessel.mass.demoWeight;
    box(g, 14, py, (W - 38) / 2, 640 - py - 12, 'PESO DESLOCÁVEL');
    if (dw && dwc) {
      text(g, `x = ${dw.x.toFixed(1)} m (ordem ${dw.xCmd.toFixed(1)})`, 28, py + 50, 21, C.text, 'left', 'bold', true);
      button(c, { id: 'i-dw-', x: 26, y: py + 78, w: 128, h: 58, label: '◀ RÉ', tone: 'neutral', tip: 'Mover o peso 5 m para ré', action: () => act.cmd({ type: 'demoWeight', x: dw.xCmd - 5 }), size: 22 });
      button(c, { id: 'i-dw0', x: 160, y: py + 78, w: 122, h: 58, label: 'NEUTRO', tone: 'neutral', tip: 'Peso na posição neutra', action: () => act.cmd({ type: 'demoWeight', x: dwc.xNeutral }), size: 22 });
      button(c, { id: 'i-dw+', x: 288, y: py + 78, w: 150, h: 58, label: 'VANTE ▶', tone: 'neutral', tip: 'Mover o peso 5 m para vante', action: () => act.cmd({ type: 'demoWeight', x: dw.xCmd + 5 }), size: 22 });
    } else text(g, 'não configurado nesta embarcação', 30, py + 50, 20, '#a9c3d6');
    const lx = 24 + (W - 38) / 2;
    box(g, lx, py, (W - 38) / 2, 640 - py - 12, 'ILUMINAÇÃO DA SALA');
    (
      [
        ['normal', 'NORMAL'],
        ['vermelha', 'VERMELHA'],
        ['azul', 'AZUL'],
      ] as const
    ).forEach(([m, l], i) =>
      button(c, {
        id: `i-light-${m}`,
        x: lx + 12 + i * 148,
        y: py + 78,
        w: 140,
        h: 58,
        label: l,
        on: c.ui.lighting === m,
        tone: m === 'vermelha' ? 'danger' : 'cmd',
        tip: m === 'vermelha' ? 'Iluminação vermelha (noturna: preserva a adaptação ao escuro para o periscópio)' : m === 'azul' ? 'Iluminação azul (preferida por operadores de sonar)' : 'Iluminação normal (branca)',
        action: () => (c.ui.lighting = m),
        size: 21,
      }),
    );
  };
}
