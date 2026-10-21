/**
 * CONSOLES MULTIFUNÇÃO DO SISTEMA DE COMBATE (fictício, sem armamento):
 * sonar passivo (cascata), interceptação de radar (MAGE/ESM, só com mastro
 * fora d'água), quadro tático com tabela de contatos e NAVEGAÇÃO (INS, GPS,
 * ecobatímetro, rota). E a MESA TÁTICA (carta horizontal no centro da sala).
 * Os contatos são os mesmos do mapa tático e da cena 3D. O modelo acústico é
 * ilustrativo (perdas esféricas, ruído próprio crescendo com a velocidade e
 * zona cega a ré) — não representa nenhum sonar real.
 */
import type { DrawCtx } from './panel';
import type { RoomActions } from './actions';
import type { SimulationEngine } from '../../sim/core/engine';
import { C, box, button, digital, rrect, screenBg, text } from './draw';
import { bearingRange, contactsLocal, cpa, fmtLat, fmtLon, nedToLatLon, EXERCISE_AREA, latLonToNed, type Contact } from '../../sim/geo';
import { trafficAt, trafficForEnv } from '../../sim/traffic';
import { periscopeCfg } from '../../sim/systems/actuation';
import { toKnots } from '../../sim/units';
import { rng } from './textures';

export interface RoomContact extends Contact {
  brg: number;
  rng: number;
  rel: number;
}

const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/** contatos (fixos + tráfego) com marcação e distância a partir do próprio navio */
export function roomContacts(e: SimulationEngine, act: RoomActions): RoomContact[] {
  const s = e.state;
  const origin = act.geoOrigin();
  const own = { n: s.body.pos.x, e: s.body.pos.y };
  const hdg = e.outputs.euler.heading;
  const all = [...contactsLocal(s.t, origin), ...trafficAt(s.t, trafficForEnv(e.env, origin, act.traffic()), origin)];
  return all.map((c) => {
    const br = bearingRange(own, c);
    return { ...c, brg: br.brg, rng: br.rng, rel: wrap180(br.brg - hdg) };
  });
}

/** antena/óptica fora d'água: periscópio ou snorkel IÇADOS com a cabeça emersa, ou na superfície (mastros recolhidos não contam) */
export function mastOut(e: SimulationEngine): boolean {
  const v = e.vessel;
  const o = e.outputs;
  if (o.surfaced) return true;
  const base = v.hull.diameter + v.hull.sail.height;
  const heads: number[] = [];
  const pp = e.state.periscope?.pos ?? 0;
  if (pp > 0.95) heads.push(base + 0.3 + periscopeCfg(v).extension * pp);
  if (e.state.snorkel.pos > 0.95) heads.push(base + v.hull.snorkelMast.extension * e.state.snorkel.pos);
  return heads.some((h) => o.depthKeel - h < -0.2);
}

const SL: Record<Contact['kind'], number> = { mercante: 152, pesqueiro: 136, rebocador: 142, patrulha: 146 };

/** excesso de sinal (dB, ilustrativo) de um contato no sonar passivo */
export function signalExcess(e: SimulationEngine, c: RoomContact): number {
  const kn = toKnots(Math.abs(e.outputs.speed));
  const ss = e.env.cfg.waves?.seaState ?? 0;
  const own = 58 + 0.22 * kn * kn + 2.5 * ss;
  const tl = 20 * Math.log10(Math.max(50, c.rng)) + 0.00008 * c.rng;
  const baffle = Math.abs(c.rel) > 150 ? 25 : 0;
  return SL[c.kind] - tl - own + 18 - baffle;
}

/** sonar passivo: cascata (marcação relativa × tempo) */
export function drawSonarWaterfall(act: RoomActions) {
  let wf: HTMLCanvasElement | null = null;
  let lastT = -1;
  const rnd = rng(77);
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    const y0 = screenBg(c, 'SONAR PASSIVO — CASCATA', 'marcação relativa à proa');
    const x0 = 40;
    const ww = W - 80;
    const hh = H - y0 - 54;
    if (!wf || wf.width !== ww || wf.height !== hh) {
      wf = document.createElement('canvas');
      wf.width = ww;
      wf.height = hh;
      const w0 = wf.getContext('2d')!;
      w0.fillStyle = '#000';
      w0.fillRect(0, 0, ww, hh);
      lastT = e.state.t;
    }
    const wg = wf.getContext('2d')!;
    const t = e.state.t;
    if (t < lastT) lastT = t;
    let rows = Math.min(40, Math.floor((t - lastT) / 0.5));
    if (rows > 0) {
      lastT += rows * 0.5;
      const cts = roomContacts(e, act);
      const step = 2;
      wg.drawImage(wf, 0, rows * step);
      while (rows-- > 0) {
        const img = wg.createImageData(ww, step);
        for (let x = 0; x < ww; x++) {
          const rel = (x / ww) * 360 - 180;
          let v = 0.12 + rnd() * 0.22;
          for (const ct of cts) {
            const se = signalExcess(e, ct);
            if (se < -12) continue;
            const d = wrap180(rel - ct.rel);
            v += Math.max(0, Math.min(1, (se + 12) / 26)) * Math.exp(-(d * d) / 5) * (0.75 + rnd() * 0.25);
          }
          if (Math.abs(rel) > 150) v *= 0.45;
          const k = Math.max(0, Math.min(1, v));
          for (let yy = 0; yy < step; yy++) {
            const i = (yy * ww + x) * 4;
            img.data[i] = 20 * k;
            img.data[i + 1] = 255 * k;
            img.data[i + 2] = 90 * k;
            img.data[i + 3] = 255;
          }
        }
        wg.putImageData(img, 0, rows * step);
      }
    }
    g.drawImage(wf, x0, y0);
    g.strokeStyle = C.line;
    g.lineWidth = 2;
    g.strokeRect(x0, y0, ww, hh);
    for (let a = -180; a <= 180; a += 30) {
      const x = x0 + ((a + 180) / 360) * ww;
      g.fillStyle = '#6f8da5';
      g.fillRect(x - 1, y0 + hh, 2, 10);
      text(g, a === 0 ? 'PROA' : a === 180 || a === -180 ? 'POPA' : `${a > 0 ? 'BE' : 'BB'} ${Math.abs(a)}`, x, y0 + hh + 24, 14, a === 0 ? C.warn : C.dim, 'center', 'bold');
    }
    g.fillStyle = 'rgba(255,80,60,0.12)';
    g.fillRect(x0, y0, (30 / 360) * ww, hh);
    g.fillRect(x0 + ww - (30 / 360) * ww, y0, (30 / 360) * ww, hh);
    text(g, 'zona cega', x0 + 10, y0 + 16, 13, '#ff9c8c');
    const kn = toKnots(Math.abs(e.outputs.speed));
    text(g, `ruído próprio ${(58 + 0.22 * kn * kn).toFixed(0)} dB · ${kn.toFixed(1)} nós`, W - 46, y0 + 16, 14, kn > 10 ? C.warn : C.dim, 'right', 'bold');
  };
}

/** sonar: tabela de contatos detectados (marcação, classificação, sinal) e MAGE/ESM */
export function drawSonarContacts(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    const y0 = screenBg(c, 'CONTATOS ACÚSTICOS E MAGE', 'detecção passiva');
    const cts = roomContacts(e, act)
      .map((ct) => ({ ct, se: signalExcess(e, ct) }))
      .filter((x) => x.se > -4)
      .sort((a, b) => b.se - a.se)
      .slice(0, 7);
    box(g, 14, y0, W - 28, 300, 'SONAR PASSIVO');
    text(g, 'TRILHA', 30, y0 + 40, 14, C.dim, 'left', 'bold');
    text(g, 'MARCAÇÃO', 150, y0 + 40, 14, C.dim, 'left', 'bold');
    text(g, 'RELATIVA', 300, y0 + 40, 14, C.dim, 'left', 'bold');
    text(g, 'CLASSIFICAÇÃO', 450, y0 + 40, 14, C.dim, 'left', 'bold');
    text(g, 'SINAL', W - 40, y0 + 40, 14, C.dim, 'right', 'bold');
    if (!cts.length) text(g, 'nenhum contato acima do ruído', W / 2, y0 + 150, 20, C.dim, 'center');
    cts.forEach(({ ct, se }, i) => {
      const y = y0 + 72 + i * 32;
      text(g, `S${i + 1}`, 30, y, 18, C.real, 'left', 'bold', true);
      text(g, `${String(Math.round(ct.brg)).padStart(3, '0')}°`, 150, y, 18, C.text, 'left', 'bold', true);
      text(g, `${ct.rel >= 0 ? 'BE' : 'BB'} ${Math.abs(ct.rel).toFixed(0)}°`, 300, y, 18, C.text, 'left', 'normal', true);
      text(g, se > 8 ? ct.kind.toUpperCase() : 'em classificação', 450, y, 17, se > 8 ? C.text : C.dim, 'left');
      g.fillStyle = C.real;
      g.fillRect(W - 180, y - 7, Math.max(4, Math.min(140, (se + 4) * 5)), 14);
    });
    // MAGE (interceptação de radar)
    const my = y0 + 310;
    box(g, 14, my, W - 28, H - my - 12, 'MAGE — INTERCEPTAÇÃO DE RADAR');
    const out = mastOut(e);
    if (!out) {
      text(g, 'ANTENA SUBMERSA — içar o periscópio ou o snorkel na cota periscópica', W / 2, my + (H - my) / 2, 18, C.warn, 'center', 'bold', false, W - 60);
      return;
    }
    const em = roomContacts(e, act)
      .filter((ct) => (ct.kind === 'patrulha' || ct.kind === 'mercante') && ct.rng < 40000)
      .slice(0, 4);
    if (!em.length) text(g, 'nenhum emissor interceptado', W / 2, my + 90, 18, C.dim, 'center');
    em.forEach((ct, i) => {
      const y = my + 50 + i * 34;
      text(g, `E${i + 1}`, 30, y, 18, C.warn, 'left', 'bold', true);
      text(g, `${String(Math.round(ct.brg)).padStart(3, '0')}°`, 120, y, 18, C.text, 'left', 'bold', true);
      text(g, ct.kind === 'patrulha' ? 'radar de busca (banda I)' : 'radar de navegação (banda X)', 250, y, 17, C.text, 'left');
      text(g, ct.rng < 12000 ? 'FORTE' : 'fraco', W - 40, y, 17, ct.rng < 12000 ? C.alarm : C.dim, 'right', 'bold');
    });
  };
}

const SCALES_KM = [2, 5, 10, 20, 50];

/** plotagem tática (norte para cima) centrada no próprio navio */
function plot(c: DrawCtx, act: RoomActions, x: number, y: number, w: number, h: number, scaleKm: number, opts: { land?: boolean; table?: boolean } = {}): RoomContact[] {
  const { g, e } = c;
  const s = e.state;
  const own = { n: s.body.pos.x, e: s.body.pos.y };
  const R = Math.min(w, h) / 2 - 10;
  const k = R / (scaleKm * 1000);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const P = (n: number, ee: number) => [cx + (ee - own.e) * k, cy - (n - own.n) * k] as const;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = opts.table ? '#06223a' : '#04131f';
  g.fillRect(x, y, w, h);
  if (opts.land) drawLand(c, x, y, w, h, own, k);
  // área de exercícios
  const origin = act.geoOrigin();
  g.strokeStyle = 'rgba(255,210,63,0.55)';
  g.setLineDash([8, 6]);
  g.lineWidth = 2;
  g.beginPath();
  EXERCISE_AREA.forEach((p, i) => {
    const q = latLonToNed(origin, p);
    const [px, py] = P(q.n, q.e);
    if (i) g.lineTo(px, py);
    else g.moveTo(px, py);
  });
  g.closePath();
  g.stroke();
  g.setLineDash([]);
  // anéis de distância
  g.strokeStyle = 'rgba(80,140,190,0.35)';
  g.lineWidth = 1.5;
  for (let i = 1; i <= 4; i++) {
    g.beginPath();
    g.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2);
    g.stroke();
    text(g, `${((scaleKm * i) / 4).toFixed(scaleKm < 5 ? 1 : 0)} km`, cx + (R * i) / 4 - 4, cy - 8, 12, '#5f8fb5', 'right');
  }
  g.beginPath();
  g.moveTo(cx, y);
  g.lineTo(cx, y + h);
  g.moveTo(x, cy);
  g.lineTo(x + w, cy);
  g.stroke();
  text(g, 'N', cx, y + 14, 16, C.warn, 'center', 'bold');
  // derrota
  const tr = s.nav.trail;
  if (tr.length > 1) {
    g.strokeStyle = 'rgba(73,167,255,0.8)';
    g.lineWidth = 2;
    g.beginPath();
    tr.forEach((p, i) => {
      const [px, py] = P(p.n, p.e);
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    });
    g.lineTo(cx, cy);
    g.stroke();
  }
  // rota planejada
  const rt = act.route();
  if (rt.points.length) {
    g.strokeStyle = '#ffe14d';
    g.lineWidth = 2;
    g.setLineDash([6, 5]);
    g.beginPath();
    g.moveTo(cx, cy);
    rt.points.slice(rt.active ? rt.idx : 0).forEach((p) => {
      const q = latLonToNed(origin, p);
      const [px, py] = P(q.n, q.e);
      g.lineTo(px, py);
    });
    g.stroke();
    g.setLineDash([]);
  }
  // contatos
  const cts = roomContacts(e, act);
  for (const ct of cts) {
    const [px, py] = P(ct.n, ct.e);
    if (px < x - 20 || px > x + w + 20 || py < y - 20 || py > y + h + 20) continue;
    const col = ct.kind === 'patrulha' ? '#49a7ff' : '#4cd964';
    g.strokeStyle = col;
    g.lineWidth = 2.5;
    if (ct.kind === 'patrulha') {
      g.beginPath();
      g.arc(px, py, 9, 0, Math.PI * 2);
      g.stroke();
    } else {
      g.save();
      g.translate(px, py);
      g.rotate(Math.PI / 4);
      g.strokeRect(-7, -7, 14, 14);
      g.restore();
    }
    // vetor de 6 min
    const vn = Math.cos((ct.course * Math.PI) / 180) * ct.speed * 360;
    const ve = Math.sin((ct.course * Math.PI) / 180) * ct.speed * 360;
    const [qx, qy] = P(ct.n + vn, ct.e + ve);
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(qx, qy);
    g.stroke();
    text(g, ct.id, px + 12, py - 12, 13, col, 'left', 'bold');
  }
  // próprio navio (semicírculo aberto em cima = submarino amigo) e vetor de 6 min
  const hdg = (e.outputs.euler.heading * Math.PI) / 180;
  const vel = e.outputs.velNED;
  const [vx, vy] = P(own.n + vel.x * 360, own.e + vel.y * 360);
  g.strokeStyle = '#49a7ff';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(vx, vy);
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, 12, 0, Math.PI);
  g.stroke();
  g.fillStyle = '#49a7ff';
  g.beginPath();
  g.arc(cx, cy, 3, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = C.warn;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + Math.sin(hdg) * 30, cy - Math.cos(hdg) * 30);
  g.stroke();
  g.restore();
  g.strokeStyle = C.line;
  g.lineWidth = 2;
  g.strokeRect(x, y, w, h);
  return cts;
}

let landCache: { key: string; img: HTMLCanvasElement } | null = null;

/** terra e águas rasas (amostradas do mesmo fundo da física), refeitas quando o centro/escala mudam */
function drawLand(c: DrawCtx, x: number, y: number, w: number, h: number, own: { n: number; e: number }, k: number): void {
  const e = c.e;
  if (!e.env.cfg.geo?.coast && e.env.cfg.bottom.mode !== 'relevo') return;
  const cell = 8;
  const key = `${Math.round(own.n / 200)}|${Math.round(own.e / 200)}|${k.toFixed(6)}|${w}x${h}|${JSON.stringify(e.env.cfg.bottom)}|${e.env.cfg.geo?.coast}`;
  if (!landCache || landCache.key !== key) {
    const img = document.createElement('canvas');
    img.width = Math.ceil(w / cell);
    img.height = Math.ceil(h / cell);
    const ig = img.getContext('2d')!;
    const id = ig.createImageData(img.width, img.height);
    for (let j = 0; j < img.height; j++)
      for (let i = 0; i < img.width; i++) {
        const ee = own.e + ((i + 0.5) * cell - w / 2) / k;
        const n = own.n - ((j + 0.5) * cell - h / 2) / k;
        const d = e.env.bottomDepthAt(n, ee);
        const p = (j * img.width + i) * 4;
        if (d <= 0.5) {
          id.data[p] = 120;
          id.data[p + 1] = 104;
          id.data[p + 2] = 70;
          id.data[p + 3] = 255;
        } else {
          const f = Math.max(0, Math.min(1, d / 120));
          id.data[p] = 6 + (1 - f) * 40;
          id.data[p + 1] = 34 + (1 - f) * 70;
          id.data[p + 2] = 58 + (1 - f) * 80;
          id.data[p + 3] = 255;
        }
      }
    ig.putImageData(id, 0, 0);
    landCache = { key, img };
  }
  c.g.imageSmoothingEnabled = true;
  c.g.drawImage(landCache.img, x, y, w, h);
}

/** console do sistema de combate: quadro tático + contatos com PMA (CPA) */
export function drawTacticalConsole(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    const y0 = screenBg(c, 'SISTEMA DE COMBATE — QUADRO TÁTICO', 'fictício · sem armamento');
    const si = c.ui.page.tacScale ?? 2;
    const scale = SCALES_KM[si];
    const ph = H - y0 - 10;
    const cts = plot(c, act, 10, y0, ph, ph, scale);
    const x1 = ph + 22;
    SCALES_KM.forEach((km, i) =>
      button(c, {
        id: `tc-sc-${km}`,
        x: x1 + i * ((W - x1 - 14) / 5),
        y: y0,
        w: (W - x1 - 14) / 5 - 6,
        h: 40,
        label: `${km} km`,
        on: i === si,
        tone: 'cmd',
        tip: `Escala do quadro: ${km} km`,
        action: () => (c.ui.page.tacScale = i),
        size: 14,
      }),
    );
    const own = { n: e.state.body.pos.x, e: e.state.body.pos.y, vn: e.outputs.velNED.x, ve: e.outputs.velNED.y };
    text(g, 'CONTATO', x1, y0 + 64, 13, C.dim, 'left', 'bold');
    text(g, 'MARC.', x1 + 90, y0 + 64, 13, C.dim, 'left', 'bold');
    text(g, 'DIST.', x1 + 160, y0 + 64, 13, C.dim, 'left', 'bold');
    text(g, 'PMA', x1 + 250, y0 + 64, 13, C.dim, 'left', 'bold');
    cts
      .sort((a, b) => a.rng - b.rng)
      .slice(0, 12)
      .forEach((ct, i) => {
        const y = y0 + 92 + i * 34;
        const cp = cpa(own, ct);
        text(g, ct.id, x1, y, 16, ct.kind === 'patrulha' ? '#49a7ff' : '#4cd964', 'left', 'bold', true);
        text(g, `${String(Math.round(ct.brg)).padStart(3, '0')}°`, x1 + 90, y, 16, C.text, 'left', 'normal', true);
        text(g, `${(ct.rng / 1852).toFixed(1)} mn`, x1 + 160, y, 16, C.text, 'left', 'normal', true);
        text(g, cp.tcpa > 0 ? `${(cp.dcpa / 1852).toFixed(1)} mn` : 'afast.', x1 + 250, y, 16, cp.dcpa < 1852 && cp.tcpa > 0 && cp.tcpa < 1800 ? C.alarm : C.dim, 'left', 'normal', true);
        void W;
      });
  };
}

/** console de NAVEGAÇÃO: posição (INS/GPS), rumo, velocidade, profundidade, fundo e rota */
export function drawNavigation(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    const s = e.state;
    const o = e.outputs;
    const y0 = screenBg(c, 'NAVEGAÇÃO', 'sistema de navegação inercial · GPS · ecobatímetro');
    const origin = act.geoOrigin();
    const ll = nedToLatLon(origin, s.body.pos.x, s.body.pos.y);
    box(g, 14, y0, W - 28, 170, 'POSIÇÃO');
    text(g, 'INS', 30, y0 + 48, 16, C.dim, 'left', 'bold');
    text(g, `${fmtLat(ll.lat)}   ${fmtLon(ll.lon)}`, 100, y0 + 48, 24, C.real, 'left', 'bold', true);
    const gps = mastOut(e);
    text(g, 'GPS', 30, y0 + 90, 16, C.dim, 'left', 'bold');
    text(g, gps ? 'FIXO VÁLIDO (antena fora d’água)' : 'SEM SINAL — antena submersa', 100, y0 + 90, 20, gps ? C.real : C.warn, 'left', 'bold');
    const drErr = Math.hypot(s.nav.drNorth - s.body.pos.x, s.nav.drEast - s.body.pos.y);
    text(g, `posição estimada (navegação estimada): erro ${drErr.toFixed(0)} m · distância percorrida ${(s.nav.distance / 1852).toFixed(2)} mn`, 30, y0 + 132, 16, C.dim, 'left', 'normal', false, W - 60);
    const rows: [string, string][] = [
      ['RUMO (GIRO)', `${String(Math.round(((s.sensors.GIRO.value % 360) + 360) % 360)).padStart(3, '0')}°`],
      ['RUMO NO FUNDO', `${String(Math.round(((o.courseOverGround % 360) + 360) % 360)).padStart(3, '0')}°`],
      ['VELOCIDADE (DVL)', `${toKnots(s.sensors.DVLU.value).toFixed(1)} nós`],
      ['PROFUNDIDADE', `${(0.5 * (s.sensors.PRF1.value + s.sensors.PRF2.value)).toFixed(1)} m`],
      ['ALTITUDE (ECO)', `${s.sensors.ECO.value.toFixed(0)} m`],
      ['FUNDO LOCAL', `${o.bottomDepth.toFixed(0)} m`],
    ];
    rows.forEach(([k, v], i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const bx = 14 + col * ((W - 28) / 3);
      const by = y0 + 182 + row * 110;
      digital(g, bx + 4, by + 24, (W - 28) / 3 - 10, 70, v, '#7dff9c', k);
    });
    const ry = y0 + 410;
    box(g, 14, ry, W - 28, H - ry - 12, 'ROTA (MAPA TÁTICO)');
    const rt = act.route();
    if (!rt.points.length) text(g, 'sem rota — trace pontos no Mapa tático', 30, ry + 50, 17, C.dim, 'left');
    else {
      const next = rt.points[Math.min(rt.idx, rt.points.length - 1)];
      const q = latLonToNed(origin, next);
      const br = bearingRange({ n: s.body.pos.x, e: s.body.pos.y }, q);
      text(g, `${rt.points.length} ponto(s) · ${rt.active ? `seguindo para P${rt.idx + 1}` : 'rota parada'}`, 30, ry + 46, 18, rt.active ? C.cmd : C.text, 'left', 'bold');
      text(g, `próximo: marcação ${String(Math.round(br.brg)).padStart(3, '0')}° · ${(br.rng / 1852).toFixed(2)} mn`, 30, ry + 80, 18, C.text, 'left', 'normal', true);
    }
  };
}

/** MESA TÁTICA: carta horizontal grande com terra, contatos, derrota e escala */
export function drawPlotTable(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    g.fillStyle = '#020a12';
    g.fillRect(0, 0, W, H);
    const si = c.ui.page.tableScale ?? 2;
    const scale = SCALES_KM[si];
    plot(c, act, 0, 0, W, H, scale, { land: true, table: true });
    // barra de botões de escala e legenda
    g.fillStyle = 'rgba(3,15,25,0.8)';
    rrect(g, 10, H - 64, 580, 54, 8);
    g.fill();
    SCALES_KM.forEach((km, i) =>
      button(c, {
        id: `tb-sc-${km}`,
        x: 18 + i * 92,
        y: H - 58,
        w: 86,
        h: 42,
        label: `${km} km`,
        on: i === si,
        tone: 'cmd',
        tip: `Escala da mesa tática: ${km} km (raio vertical)`,
        action: () => (c.ui.page.tableScale = i),
        size: 15,
      }),
    );
    text(g, 'MESA TÁTICA', W - 20, 24, 22, '#9fd0ff', 'right', 'bold');
    const origin = act.geoOrigin();
    const ll = nedToLatLon(origin, e.state.body.pos.x, e.state.body.pos.y);
    text(g, `${fmtLat(ll.lat)} ${fmtLon(ll.lon)} · rumo ${Math.round(e.outputs.euler.heading)}° · ${toKnots(e.outputs.speed).toFixed(1)} nós`, W - 20, 52, 16, C.text, 'right', 'normal', true);
  };
}
