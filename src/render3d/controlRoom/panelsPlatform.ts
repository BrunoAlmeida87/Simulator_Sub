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
    const y0 = screenBg(c, 'ENERGIA — BATERIA E GERAÇÃO', 'gestão da plataforma');
    // bateria
    box(g, 14, y0, 450, 250, 'BATERIA PRINCIPAL');
    const soc = el.soc;
    g.fillStyle = '#0a1520';
    g.fillRect(30, y0 + 36, 150, 196);
    g.fillStyle = soc > 0.5 ? C.real : soc > 0.25 ? C.warn : C.alarm;
    g.fillRect(34, y0 + 40 + 188 * (1 - soc), 142, 188 * soc);
    g.strokeStyle = C.line;
    g.lineWidth = 2;
    g.strokeRect(30, y0 + 36, 150, 196);
    text(g, `${(soc * 100).toFixed(0)}%`, 105, y0 + 134, 34, '#fff', 'center', 'bold', true);
    digital(g, 196, y0 + 36, 254, 48, `${el.voltage.toFixed(0)} V`, '#7dff9c', 'TENSÃO');
    digital(g, 196, y0 + 92, 254, 48, `${el.current.toFixed(0)} A`, el.current < -1 ? C.cmd : '#7dff9c', el.current < -1 ? 'CORRENTE (carregando)' : 'CORRENTE (descarga)');
    text(g, el.energized ? 'barramento ENERGIZADO' : 'BARRAMENTO SEM ENERGIA', 196, y0 + 160, 17, el.energized ? C.real : C.alarm, 'left', 'bold');
    const armed = !!c.ui.guards.breaker;
    button(c, {
      id: 'brk',
      x: 196,
      y: y0 + 180,
      w: 254,
      h: 52,
      label: el.breakerClosed ? (armed ? 'CONFIRMAR ABERTURA' : 'DISJUNTOR FECHADO') : 'DISJUNTOR ABERTO',
      sub: el.breakerClosed ? (armed ? 'clique de novo para abrir' : 'clique para abrir') : 'clique para fechar',
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
      size: 16,
    });
    // geradores
    box(g, 476, y0, W - 490, 250, 'DIESEL-GERADORES');
    v.electrical.generators.forEach((gen, i) => {
      const st = el.generators[gen.id];
      const y = y0 + 40 + i * 100;
      text(g, gen.id, 492, y + 24, 22, C.text, 'left', 'bold');
      const col = st.status === 'EM CARGA' ? C.real : st.status === 'PARTINDO' || st.status === 'PARANDO' ? C.warn : st.status === 'FALHA' || st.status === 'SEM AR' ? C.alarm : C.dim;
      text(g, st.status, 560, y + 24, 18, col, 'left', 'bold');
      text(g, `${(st.power / 1000).toFixed(0)} kW / ${(gen.ratedPower / 1000).toFixed(0)}`, 560, y + 54, 16, C.dim, 'left', 'normal', true);
      button(c, { id: `gen-${gen.id}`, x: W - 180, y: y + 4, w: 150, h: 60, label: st.cmd ? 'PARAR' : 'PARTIR', sub: gen.name.replace('Grupo diesel-gerador', 'GD'), on: st.cmd, tone: st.failed ? 'danger' : 'ok', tip: `${gen.name}: ${st.status} — clique para ${st.cmd ? 'PARAR' : 'PARTIR'} (precisa de ar: superfície ou snorkel)`, action: () => act.cmd({ type: 'generator', id: gen.id, run: !st.cmd }) });
    });
    // snorkel
    const sy = y0 + 262;
    box(g, 14, sy, 450, H - sy - 12, 'MASTRO DO SNORKEL');
    const sn = s.snorkel;
    hbar(g, 30, sy + 44, 300, 26, sn.pos, C.cmd);
    text(g, `${Math.round(sn.pos * 100)} % içado`, 340, sy + 57, 18, C.text, 'left', 'bold');
    text(g, `válvula de cabeça ${sn.headValveOpen ? 'ABERTA' : 'FECHADA'}`, 30, sy + 100, 18, sn.headValveOpen ? C.real : C.dim, 'left', 'bold');
    text(g, e.outputs.airIntake ? 'tomada de ar disponível' : 'sem tomada de ar externo', 30, sy + 128, 15, C.dim, 'left');
    button(c, { id: 'snk', x: 30, y: sy + 150, w: 200, h: 56, label: sn.cmd ? 'ARRIAR' : 'IÇAR', sub: 'snorkel', on: sn.cmd, tone: 'cmd', tip: sn.cmd ? 'Arriar o mastro do snorkel' : 'Içar o mastro do snorkel (cota periscópica)', action: () => act.cmd({ type: 'snorkel', raise: !sn.cmd }) });
    // combustível e cargas
    box(g, 476, sy, W - 490, H - sy - 12, 'COMBUSTÍVEL E CARGAS');
    const fuelCap = v.electrical.fuel.tankVolume;
    text(g, 'Combustível', 492, sy + 40, 16, C.dim, 'left', 'bold');
    hbar(g, 600, sy + 30, W - 650, 20, el.fuel / fuelCap, '#d9a441');
    text(g, `${el.fuel.toFixed(1)} m³`, W - 40, sy + 66, 15, C.text, 'right', 'normal', true);
    const loads = Object.entries(el.loads).sort((a, b) => b[1] - a[1]).slice(0, 5);
    loads.forEach(([k, w], i) => {
      text(g, k, 492, sy + 96 + i * 24, 15, C.text, 'left');
      text(g, `${(w / 1000).toFixed(0)} kW`, W - 40, sy + 96 + i * 24, 15, C.text, 'right', 'normal', true);
    });
    text(g, `demanda ${(el.totalLoad / 1000).toFixed(0)} kW · geração ${(el.generation / 1000).toFixed(0)} kW`, 492, H - 30, 15, C.cmd, 'left', 'bold');
  };
}

/** tela de PROPULSÃO E HIDRÁULICA */
export function drawPropulsion(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    const s = e.state;
    const p = s.propulsion;
    const rated = e.vessel.propulsion.motor.ratedRpm;
    const y0 = screenBg(c, 'PROPULSÃO E HIDRÁULICA', 'motor elétrico principal');
    dial(g, 170, y0 + 170, 150, { value: e.outputs.rpm, min: -rated, max: rated, major: 40, minor: 10, label: 'EIXO', unit: 'rpm', ordered: p.rpmCmd, dark: true, digits: 0 });
    box(g, 340, y0, W - 354, 330, 'MOTOR ELÉTRICO PRINCIPAL');
    const rows: [string, string, string?][] = [
      ['Ordem do telégrafo', `${p.rpmCmd.toFixed(0)} rpm`],
      ['Rotação do eixo', `${e.outputs.rpm.toFixed(0)} rpm`],
      ['Potência no eixo', `${(p.shaftPower / 1e6).toFixed(2)} MW`],
      ['Potência elétrica', `${(p.elecPower / 1e6).toFixed(2)} MW`],
      ['Empuxo', `${(p.thrust / 1e3).toFixed(0)} kN`],
      ['Coef. de avanço J', p.advance.toFixed(2)],
      ['Velocidade', `${toKnots(s.sensors.DVLU.value).toFixed(1)} nós`],
      ['Situação', p.failed ? 'MOTOR EM FALHA' : p.powerLimited ? 'POTÊNCIA LIMITADA' : 'normal', p.failed ? C.alarm : p.powerLimited ? C.warn : C.real],
    ];
    rows.forEach(([k, v, col], i) => {
      text(g, k, 360, y0 + 46 + i * 36, 17, C.dim, 'left');
      text(g, v, W - 34, y0 + 46 + i * 36, 19, col ?? C.text, 'right', 'bold', true);
    });
    // hidráulica e compressor
    const hy = y0 + 342;
    const hyd = s.hydraulics;
    const nom = e.vessel.hydraulics.nominalPressure;
    box(g, 14, hy, (W - 38) / 2, H - hy - 12, 'PLANTA HIDRÁULICA');
    hbar(g, 30, hy + 44, (W - 38) / 2 - 40, 24, hyd.pressure / nom, hyd.pressure < e.vessel.hydraulics.minPressure * 1.25 ? C.alarm : C.real, e.vessel.hydraulics.minPressure / nom);
    text(g, `${(hyd.pressure / 1e5).toFixed(0)} bar`, 30, hy + 94, 24, C.text, 'left', 'bold', true);
    text(g, hyd.failed ? 'FALHA DA PLANTA' : hyd.pumpOn ? 'bomba em carga' : 'bomba em espera', 30, hy + 126, 17, hyd.failed ? C.alarm : C.dim, 'left', 'bold');
    text(g, 'lemes, válvulas e mastros', 30, hy + 154, 14, C.dim, 'left');
    const x2 = 24 + (W - 38) / 2;
    box(g, x2, hy, (W - 38) / 2, H - hy - 12, 'COMPRESSOR DE AR AP');
    text(g, s.hpAir.compressorRunning ? 'EM CARGA' : s.hpAir.compressorCmd ? 'SEM AR/ENERGIA' : 'PARADO', x2 + 16, hy + 50, 20, s.hpAir.compressorRunning ? C.real : C.dim, 'left', 'bold');
    text(g, `coletor ${e.outputs.hpManifoldBar.toFixed(0)} bar`, x2 + 16, hy + 82, 17, C.text, 'left', 'normal', true);
    button(c, { id: 'p-comp', x: x2 + 16, y: hy + 104, w: 200, h: 54, label: s.hpAir.compressorCmd ? 'PARAR' : 'PARTIR', sub: 'compressor', on: s.hpAir.compressorCmd, tone: 'ok', tip: 'Compressor de ar AP (precisa de ar externo e energia)', action: () => act.cmd({ type: 'compressor', run: !s.hpAir.compressorCmd }) });
  };
}

const SCALES = [0.5, 1, 2, 5, 10, 20];

/** tela do instrutor: FALHAS (injetar/remover por grupo) */
export function drawInstructorFailures(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    const y0 = screenBg(c, 'INSTRUTOR — FALHAS', 'ambiente controlado de treinamento');
    const cat = failureCatalog(e);
    const groups = [...new Set(cat.map((f) => f.group))];
    const gi = Math.min(groups.length - 1, c.ui.page.instrGroup ?? 0);
    const bw = (W - 28 - (groups.length - 1) * 6) / groups.length;
    groups.forEach((gr, i) => {
      const n = cat.filter((f) => f.group === gr && isFailureActive(e, f.target)).length;
      button(c, { id: `fg-${gr}`, x: 14 + i * (bw + 6), y: y0, w: bw, h: 46, label: gr, sub: n ? `${n} ativa(s)` : undefined, on: i === gi, tone: n ? 'danger' : 'neutral', tip: `Falhas do grupo ${gr}`, action: () => (c.ui.page.instrGroup = i), size: 13 });
    });
    const list = cat.filter((f) => f.group === groups[gi]);
    const pg = c.ui.page.instrPage ?? 0;
    const per = 8;
    const pages = Math.max(1, Math.ceil(list.length / per));
    const cur = Math.min(pg, pages - 1);
    list.slice(cur * per, cur * per + per).forEach((f, i) => {
      const y = y0 + 60 + i * 58;
      const on = isFailureActive(e, f.target);
      button(c, {
        id: `f-${f.target}`,
        x: 14,
        y,
        w: W - 28,
        h: 52,
        label: f.name,
        sub: on ? 'ATIVA — clique para remover' : f.effect,
        on,
        tone: on ? 'danger' : 'neutral',
        tip: `${on ? 'Remover' : 'Injetar'}: ${f.name}${f.param ? ` (${f.param.label} ${f.param.default} ${f.param.unit})` : ''}${f.modes ? ` (modo ${f.modes[0]})` : ''}`,
        action: () => act.cmd({ type: 'failure', target: f.target, active: !on, param: on ? undefined : f.modes ? (f.modes[0] as SensorFailMode) : f.param ? f.param.default : undefined }),
        size: 16,
      });
    });
    if (pages > 1) {
      button(c, { id: 'fp-prev', x: 14, y: H - 56, w: 120, h: 44, label: '◀ anterior', tone: 'neutral', disabled: cur === 0, tip: 'Página anterior', action: () => (c.ui.page.instrPage = cur - 1) });
      text(g, `${cur + 1}/${pages}`, W / 2, H - 34, 18, C.dim, 'center', 'bold');
      button(c, { id: 'fp-next', x: W - 134, y: H - 56, w: 120, h: 44, label: 'próxima ▶', tone: 'neutral', disabled: cur >= pages - 1, tip: 'Próxima página', action: () => (c.ui.page.instrPage = cur + 1) });
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
    SCALES.forEach((k, i) => button(c, { id: `i-ts-${k}`, x: 240 + i * (bw + 6), y: y0 + 34, w: bw, h: 80, label: `×${k}`, on: ts === k, tone: 'cmd', tip: `Aceleração do tempo ×${k} (a física usa sempre o mesmo passo)`, action: () => act.sim.setTimeScale(k), size: 22 }));
    // mar
    const my = y0 + 140;
    box(g, 14, my, W - 28, 100, 'ESTADO DO MAR');
    const ss = Math.round(e.env.cfg.waves?.seaState ?? 0);
    button(c, { id: 'i-sea-', x: 26, y: my + 34, w: 70, h: 54, label: '−', tone: 'neutral', disabled: ss <= 0, tip: 'Mar mais calmo', action: () => act.cmd({ type: 'seaState', value: ss - 1 }), size: 28 });
    text(g, SEA_STATES[ss]?.label ?? String(ss), 110, my + 61, 20, C.text, 'left', 'bold', false, W - 260);
    button(c, { id: 'i-sea+', x: W - 96, y: my + 34, w: 70, h: 54, label: '+', tone: 'neutral', disabled: ss >= SEA_STATES.length - 1, tip: 'Mar mais agitado', action: () => act.cmd({ type: 'seaState', value: ss + 1 }), size: 28 });
    // cenário
    const cy = my + 110;
    box(g, 14, cy, W - 28, 100, 'CENÁRIO');
    const list = act.sim.scenarios();
    const k = ((c.ui.scenario % list.length) + list.length) % list.length;
    button(c, { id: 'i-sc-', x: 26, y: cy + 34, w: 60, h: 54, label: '◀', tone: 'neutral', tip: 'Cenário anterior', action: () => (c.ui.scenario = k - 1), size: 22 });
    text(g, list[k]?.name ?? '—', 100, cy + 61, 19, list[k]?.id === e.state.scenarioId ? C.real : C.text, 'left', 'bold', false, W - 360);
    button(c, { id: 'i-sc+', x: W - 266, y: cy + 34, w: 60, h: 54, label: '▶', tone: 'neutral', tip: 'Próximo cenário', action: () => (c.ui.scenario = k + 1), size: 22 });
    button(c, { id: 'i-sc-load', x: W - 196, y: cy + 34, w: 170, h: 54, label: 'CARREGAR', sub: 'pausado', tone: 'warn', tip: `Carregar o cenário "${list[k]?.name}" (a simulação atual é substituída)`, action: () => list[k] && act.sim.loadScenario(list[k].id) });
    // peso deslocável e iluminação
    const py = cy + 110;
    const dw = e.state.demoWeight;
    const dwc = e.vessel.mass.demoWeight;
    box(g, 14, py, (W - 38) / 2, 640 - py - 12, 'PESO DESLOCÁVEL');
    if (dw && dwc) {
      text(g, `x = ${dw.x.toFixed(1)} m (ordem ${dw.xCmd.toFixed(1)})`, 30, py + 44, 17, C.text, 'left', 'bold', true);
      button(c, { id: 'i-dw-', x: 30, y: py + 66, w: 120, h: 50, label: '◀ RÉ', tone: 'neutral', tip: 'Mover o peso 5 m para ré', action: () => act.cmd({ type: 'demoWeight', x: dw.xCmd - 5 }) });
      button(c, { id: 'i-dw0', x: 156, y: py + 66, w: 100, h: 50, label: 'NEUTRO', tone: 'neutral', tip: 'Peso na posição neutra', action: () => act.cmd({ type: 'demoWeight', x: dwc.xNeutral }) });
      button(c, { id: 'i-dw+', x: 262, y: py + 66, w: 120, h: 50, label: 'VANTE ▶', tone: 'neutral', tip: 'Mover o peso 5 m para vante', action: () => act.cmd({ type: 'demoWeight', x: dw.xCmd + 5 }) });
    } else text(g, 'não configurado nesta embarcação', 30, py + 50, 16, C.dim);
    const lx = 24 + (W - 38) / 2;
    box(g, lx, py, (W - 38) / 2, 640 - py - 12, 'ILUMINAÇÃO DA SALA');
    (
      [
        ['normal', 'NORMAL'],
        ['vermelha', 'VERMELHA'],
        ['azul', 'AZUL'],
      ] as const
    ).forEach(([m, l], i) => button(c, { id: `i-light-${m}`, x: lx + 14 + i * 140, y: py + 66, w: 132, h: 50, label: l, on: c.ui.lighting === m, tone: m === 'vermelha' ? 'danger' : 'cmd', tip: m === 'vermelha' ? 'Iluminação vermelha (noturna: preserva a adaptação ao escuro para o periscópio)' : m === 'azul' ? 'Iluminação azul (preferida por operadores de sonar)' : 'Iluminação normal (branca)', action: () => (c.ui.lighting = m), size: 16 }));
  };
}
