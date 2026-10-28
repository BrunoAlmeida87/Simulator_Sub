/**
 * PAINEL DE LANÇAMENTO DE ARMAS (console tático, tela de baixo): os seis tubos com o estado, o tubo
 * escolhido com as lâmpadas da sequência (arma, alagado, equalizado, porta aberta, pronto), o alvo
 * (contatos mais próximos), a velocidade de corrida e os botões PREPARAR / DISPARAR / FECHAR /
 * RECARREGAR / CANCELAR, e os torpedos em corrida (cortar o fio). Tiro de exercício (F21).
 * Cada botão só monta um comando ('tube' ou 'torpedo'); a física fica em src/sim/systems/weapons.ts.
 */
import type { DrawCtx } from './panel';
import type { RoomActions } from './actions';
import type { SimulationEngine } from '../../sim/core/engine';
import type { TubePresets } from '../../sim/core/state';
import { C, box, button, lamp, screenBg, text } from './draw';
import { roomContacts } from './panelsCombat';
import { makeDepthOf } from '../../sim/core/context';
import { qToMat3 } from '../../sim/core/math';
import { tubeView, type TubeAction } from '../../sim/systems/weapons';

const KT = 1852 / 3600;
const PHASE: Record<string, string> = { afastamento: 'AFASTAMENTO', guiado: 'GUIADO', busca: 'CORRIDA', ataque: 'ATAQUE', flutuando: 'FIM', recolher: 'FLUTUANDO' };

function seaCtx(e: SimulationEngine) {
  const s = e.state;
  return { env: e.env, depthOf: makeDepthOf(s.body.pos, qToMat3(s.body.quat)), rhoLocal: e.env.densityAt(Math.max(0, s.body.pos.z)) };
}

export function drawLaunchPanel(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W, H, ui } = c;
    const w = e.vessel.weapons;
    const ws = e.state.weapons;
    const y0 = screenBg(c, 'LANÇAMENTO DE ARMAS', 'tiro de exercício · F21');
    if (!w || !ws) {
      text(g, 'sem tubos lançadores nesta configuração', W / 2, H / 2, 26, C.dim, 'center', 'bold');
      return;
    }
    const sctx = seaCtx(e);
    const views = w.tubes.map((_, i) => tubeView(e.vessel, e.state, sctx, e.geom.radiusAt, i));
    const selN = ui.page['armas.tubo'] ?? 1;
    const si = Math.max(
      0,
      w.tubes.findIndex((t) => t.n === selN),
    );
    const tc = w.tubes[si];
    const t = ws.tubes[si];
    const tv = views[si];
    // ---- seis tubos (bombordo à esquerda, como visto de ré)
    box(g, 12, y0, 330, 300, 'TUBOS');
    const order = [...w.tubes].sort((a, b) => a.row - b.row || (a.side === 'BB' ? -1 : 1));
    order.forEach((x, k) => {
      const i = w.tubes.indexOf(x);
      const vw = views[i];
      const col = k % 2;
      const row = Math.floor(k / 2);
      button(c, {
        id: `tubo${x.n}`,
        x: 24 + col * 156,
        y: y0 + 40 + row * 84,
        w: 146,
        h: 74,
        label: `TUBO ${x.n}`,
        sub: vw.ready ? 'PRONTO' : !ws.tubes[i].weapon ? 'VAZIO' : vw.tone === 'busy' ? 'EM SEQUÊNCIA' : 'CARREGADO',
        on: x.n === tc.n,
        tone: vw.ready ? 'ok' : vw.tone === 'warn' ? 'warn' : 'cmd',
        tip: `Escolher o tubo ${x.n} (${x.side === 'BE' ? 'boreste' : 'bombordo'}): ${vw.status}`,
        action: () => (ui.page['armas.tubo'] = x.n),
      });
    });
    // ---- tubo escolhido: lâmpadas da sequência
    const bx = 354;
    box(g, bx, y0, W - bx - 12, 300, `TUBO ${tc.n} — ${tv.status}`);
    const lamps: [string, boolean, 'green' | 'amber' | 'red' | 'white'][] = [
      ['ARMA', t.weapon, 'white'],
      ['ALIMENTADA', t.energized, 'amber'],
      ['ALAGADO', tv.flooded, 'green'],
      ['EQUALIZADO', tv.equalized, 'green'],
      ['PORTA ABERTA', t.door.pos > 0.999, 'amber'],
      ['PRONTO', tv.ready, 'red'],
    ];
    lamps.forEach(([l, lit, color], k) => {
      const lx = bx + 34 + (k % 3) * 190;
      const ly = y0 + 62 + Math.floor(k / 3) * 46;
      lamp(c, lx, ly, 13, lit, color);
      text(g, l, lx + 22, ly, 19, lit ? C.text : C.dim, 'left', 'bold', false, 160);
    });
    // alvo e velocidade
    const cts = roomContacts(e, act)
      .sort((a, b) => a.rng - b.rng)
      .slice(0, 6);
    const ti = Math.min(ui.page['armas.alvo'] ?? 0, cts.length);
    const tgt = ti > 0 ? cts[ti - 1] : null;
    const fast = (ui.page['armas.vel'] ?? 1) === 1;
    const presets: Partial<TubePresets> = { target: tgt?.id ?? null, speed: fast ? 'alta' : 'baixa' };
    button(c, {
      id: 'alvo',
      x: bx + 12,
      y: y0 + 160,
      w: 360,
      h: 60,
      label: tgt ? tgt.name.replace(' (fictício)', '').toUpperCase() : 'SEM ALVO',
      sub: tgt ? `${(tgt.rng / 1000).toFixed(1)} km · ${String(Math.round(tgt.brg)).padStart(3, '0')}°` : 'corrida no rumo do submarino',
      tone: 'neutral',
      tip: 'Alvo: o próximo dos seis contatos mais próximos (ou sem alvo)',
      action: () => (ui.page['armas.alvo'] = (ti + 1) % (cts.length + 1)),
    });
    button(c, {
      id: 'vel',
      x: bx + 384,
      y: y0 + 160,
      w: W - bx - 408,
      h: 60,
      label: fast ? 'ALTA' : 'BAIXA',
      sub: `${Math.round(w.weapon.speeds[fast ? 'alta' : 'baixa'] / KT)} nós`,
      tone: 'neutral',
      tip: 'Velocidade de corrida da arma (alta: alcance menor)',
      action: () => (ui.page['armas.vel'] = fast ? 0 : 1),
    });
    text(
      g,
      `água ${(t.water / 1025).toFixed(2)} m³ · tubo ${(t.pressure / 1e5).toFixed(1)} bar · mar ${(tv.seaPressure / 1e5).toFixed(1)} bar · garrafa ${tv.flaskBar.toFixed(0)} bar`,
      bx + 14,
      y0 + 244,
      18,
      C.dim,
      'left',
      'normal',
      false,
      W - bx - 40,
    );
    text(g, `reserva ${ws.reserve} · lançados ${ws.fired}`, bx + 14, y0 + 274, 18, C.dim, 'left', 'normal', false, W - bx - 40);
    // ---- ordens
    const send = (action: TubeAction) => act.cmd({ type: 'tube', tube: tc.n, action, presets, origin: act.geoOrigin(), traffic: act.traffic() });
    const busy = t.auto !== null || t.eject !== null || t.reload !== null;
    const by = y0 + 312;
    const bw = (W - 24 - 4 * 10) / 5;
    const btns: [string, string, TubeAction, 'cmd' | 'danger' | 'warn' | 'neutral', boolean, string][] = [
      ['prep', 'PREPARAR', 'preparar', 'cmd', !t.weapon || busy || tv.ready, 'Alimentar, alagar, equalizar e abrir a porta da boca'],
      ['fogo', tv.ready ? 'DISPARAR' : 'PREP. E DISP.', 'disparar', 'danger', !t.weapon || t.eject !== null || t.reload !== null, 'Disparo por ar comprimido (prepara antes, se preciso)'],
      ['fechar', 'FECHAR', 'fechar', 'neutral', busy || t.door.pos <= 0.001, 'Fechar a porta da boca (o tubo fica alagado)'],
      ['recarga', 'RECARREGAR', 'recarregar', 'neutral', busy || t.weapon || ws.reserve <= 0, 'Drenar, abrir a culatra e puxar uma arma da reserva'],
      ['cancelar', 'CANCELAR', 'cancelar', 'warn', !t.auto, 'Cancelar a sequência automática'],
    ];
    btns.forEach(([id, label, a, tone, disabled, tip], k) => button(c, { id, x: 12 + k * (bw + 10), y: by, w: bw, h: 64, label, tone, disabled, tip: `Tubo ${tc.n}: ${tip}`, action: () => send(a), size: 22 }));
    // ---- torpedos em corrida
    const ry = by + 76;
    box(g, 12, ry, W - 24, H - ry - 10, 'TORPEDOS EM CORRIDA');
    const runs = ws.runs.slice(-3);
    if (!runs.length) text(g, 'nenhum torpedo lançado', W / 2, ry + 80, 22, C.dim, 'center', 'bold');
    runs.forEach((r, k) => {
      const yy = ry + 56 + k * 46;
      text(g, r.id, 30, yy, 24, r.hit ? C.real : C.cmd, 'left', 'bold', true);
      text(g, PHASE[r.phase] ?? r.phase, 90, yy, 20, r.phase === 'ataque' ? C.warn : C.text, 'left', 'bold', false, 170);
      text(g, `${Math.round(r.speed / KT)} nós · ${r.d.toFixed(0)} m · ${(r.run / 1000).toFixed(1)} km`, 270, yy, 19, C.text, 'left', 'normal', true, 290);
      text(g, r.hit ? `ACERTO ${r.hit.dist.toFixed(0)} m` : r.tgt ? `alvo ${(r.tgt.range / 1000).toFixed(1)} km` : r.wire ? 'fio ligado' : 'sem fio', 570, yy, 19, r.hit ? C.real : C.dim, 'left', 'bold', false, 200);
      if (r.wire && r.phase !== 'flutuando' && r.phase !== 'recolher')
        button(c, {
          id: `fio_${r.id}`,
          x: W - 170,
          y: yy - 19,
          w: 146,
          h: 38,
          label: 'CORTAR FIO',
          tone: 'warn',
          tip: `Torpedo ${r.id}: cortar o fio de guiagem`,
          action: () => act.cmd({ type: 'torpedo', id: r.id, action: 'cortarFio' }),
          size: 17,
        });
      else if (r.phase === 'recolher')
        button(c, {
          id: `rec_${r.id}`,
          x: W - 170,
          y: yy - 19,
          w: 146,
          h: 38,
          label: 'RECOLHER',
          tone: 'ok',
          tip: `Torpedo ${r.id}: recolher a arma de exercício`,
          action: () => act.cmd({ type: 'torpedo', id: r.id, action: 'recolher' }),
          size: 17,
        });
    });
  };
}
