/**
 * POSTO DE GOVERNO (Ship Control): telas do PLANADOR (profundidade, atitude
 * e lemes horizontais), do OFICIAL DE MANOBRA (pilotos automáticos,
 * telégrafo, manobras e periscópio) e do TIMONEIRO (rumo e leme de direção);
 * painel de INSTRUMENTOS DE MERGULHO na antepara de vante (profundímetros,
 * velocidade, rumo, relógio, inclinômetros) e o ANUNCIADOR DE ALARMES.
 * As leituras vêm dos SENSORES (como nos instrumentos reais).
 */
import type { DrawCtx } from './panel';
import type { RoomActions } from './actions';
import { C, angleArc, box, button, clockText, compass, dial, digital, faceBg, lamp, lampButton, plate, rrect, screenBg, stepper, subSilhouette, text } from './draw';
import { TELEGRAPH, nearestOrder } from '../../sim/telegraph';
import { ALARM_DEFS, PRIORITY_LABEL } from '../../sim/systems/alarms';
import { toKnots } from '../../sim/units';

const indDepth = (c: DrawCtx) => 0.5 * (c.e.state.sensors.PRF1.value + c.e.state.sensors.PRF2.value);

/** fita vertical de profundidade (janela de 60 m em torno da cota) */
function depthTape(c: DrawCtx, x: number, y: number, w: number, h: number): void {
  const { g, e } = c;
  const d = indDepth(c);
  const ap = e.state.autopilot;
  const span = 60;
  const top = d - span / 2;
  const k = h / span;
  const Y = (z: number) => y + (z - top) * k;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#071a2a';
  g.fillRect(x, y, w, h);
  if (top < 0) {
    g.fillStyle = '#2b4a66';
    g.fillRect(x, y, w, Y(0) - y);
    g.fillStyle = '#4aa3df';
    g.fillRect(x, Y(0) - 2, w, 4);
  }
  const bot = e.outputs.bottomDepth;
  if (bot < top + span) {
    g.fillStyle = '#5a4126';
    g.fillRect(x, Y(bot), w, y + h - Y(bot));
  }
  for (const [lim, col] of [
    [e.vessel.limits.operatingDepth, C.warn],
    [e.vessel.limits.testDepth, C.alarm],
  ] as const) {
    if (lim > top && lim < top + span) {
      g.fillStyle = col;
      g.fillRect(x, Y(lim) - 2, w, 4);
    }
  }
  for (let z = Math.ceil(top); z <= top + span; z++) {
    if (z < 0) continue;
    const maj = z % 10 === 0;
    const mid = z % 5 === 0;
    g.fillStyle = maj ? '#e9f6ff' : '#6f8da5';
    g.fillRect(x + w - (maj ? 34 : mid ? 22 : 12), Y(z) - (maj ? 1.5 : 0.75), maj ? 34 : mid ? 22 : 12, maj ? 3 : 1.5);
    if (maj) text(g, String(z), x + w - 42, Y(z), 22, '#e9f6ff', 'right', 'bold', true);
  }
  if (ap.depthMode === 'AUTO') {
    const yo = Y(ap.depthSet);
    g.fillStyle = C.cmd;
    g.beginPath();
    g.moveTo(x + 2, yo);
    g.lineTo(x + 22, yo - 12);
    g.lineTo(x + 22, yo + 12);
    g.closePath();
    g.fill();
  }
  g.restore();
  // ponteiro central
  g.fillStyle = '#000';
  g.strokeStyle = C.real;
  g.lineWidth = 3;
  rrect(g, x + 4, y + h / 2 - 24, w - 8, 48, 6);
  g.fill();
  g.stroke();
  text(g, d.toFixed(1), x + w / 2, y + h / 2 + 2, 34, C.real, 'center', 'bold', true);
  g.strokeStyle = C.line;
  g.lineWidth = 2;
  g.strokeRect(x, y, w, h);
}

/** tela do PLANADOR: profundidade, atitude e lemes horizontais */
export function drawPlanesman(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    const s = e.state;
    const ap = s.autopilot;
    const y0 = screenBg(c, 'PLANADOR — PROFUNDIDADE E ATITUDE', 'lemes horizontais de ré e de vante');
    depthTape(c, 18, y0 + 6, 250, H - y0 - 70);
    // velocidade vertical
    const vz = e.outputs.verticalSpeed;
    text(g, 'VEL. VERTICAL', 143, H - 48, 16, C.dim, 'center', 'bold');
    text(g, `${vz >= 0 ? '▼' : '▲'} ${Math.abs(vz).toFixed(2)} m/s`, 143, H - 22, 22, Math.abs(vz) > e.vessel.limits.maxVerticalSpeed ? C.alarm : C.text, 'center', 'bold', true);
    // atitude
    box(g, 285, y0 + 6, 330, 250, 'CATURRO (PITCH)');
    const pitch = s.sensors.INSP.value;
    const cx = 450;
    const cy = y0 + 140;
    g.strokeStyle = '#2a4a63';
    g.lineWidth = 2;
    for (const a of [-20, -10, 0, 10, 20]) {
      const r = (a * Math.PI) / 180;
      for (const side of [1, -1]) {
        g.beginPath();
        g.moveTo(cx + side * Math.cos(r) * 122, cy - side * Math.sin(r) * 122);
        g.lineTo(cx + side * Math.cos(r) * 138, cy - side * Math.sin(r) * 138);
        g.stroke();
      }
      text(g, `${a > 0 ? '+' : ''}${a}`, cx + Math.cos(r) * 152, cy - Math.sin(r) * 152, 13, C.dim, 'center');
    }
    g.strokeStyle = '#335a78';
    g.setLineDash([6, 6]);
    g.beginPath();
    g.moveTo(cx - 140, cy);
    g.lineTo(cx + 140, cy);
    g.stroke();
    g.setLineDash([]);
    subSilhouette(g, cx, cy, 210, pitch, Math.abs(pitch) > e.vessel.limits.maxPitch ? C.alarm : '#cfe6f5');
    text(g, `θ ${pitch >= 0 ? '+' : ''}${pitch.toFixed(1)}°`, cx, y0 + 220, 30, Math.abs(pitch) > e.vessel.limits.maxPitch ? C.alarm : C.real, 'center', 'bold', true);
    text(g, `equilíbrio estático ${e.outputs.staticPitchEq.toFixed(1)}°`, cx, y0 + 246, 15, C.dim, 'center');
    // banda
    box(g, 285, y0 + 266, 330, H - y0 - 340, 'BANDA (ROLL)');
    const roll = s.sensors.INSR.value;
    subSilhouette(g, 380, y0 + 266 + (H - y0 - 340) / 2 + 12, 120, -roll, Math.abs(roll) > e.vessel.limits.maxRoll ? C.alarm : '#cfe6f5', true);
    text(g, `φ ${roll >= 0 ? '+' : ''}${roll.toFixed(1)}°`, 530, y0 + 266 + (H - y0 - 340) / 2, 28, C.real, 'center', 'bold', true);
    text(g, roll > 0.3 ? 'adernado BE' : roll < -0.3 ? 'adernado BB' : 'aprumado', 530, y0 + 266 + (H - y0 - 340) / 2 + 30, 15, C.dim, 'center');
    // lemes horizontais
    const fin = (k: string) => e.vessel.fins.find((f) => f.id === k)!;
    box(g, 630, y0 + 6, 312, H - y0 - 80, 'LEMES HORIZONTAIS');
    angleArc(g, 720, y0 + 150, 72, s.surfaces.stern.cmd, s.surfaces.stern.actual, fin('stern').maxDeflection, 'SUBIR', 'DESCER', 'DE RÉ', true);
    angleArc(g, 720, y0 + 370, 72, s.surfaces.bow.cmd, s.surfaces.bow.actual, fin('bow').maxDeflection, 'SUBIR', 'DESCER', 'DE VANTE', true);
    text(g, `ord. ${s.surfaces.stern.cmd.toFixed(0)}°`, 860, y0 + 186, 16, C.cmd, 'center', 'bold', true);
    text(g, `ord. ${s.surfaces.bow.cmd.toFixed(0)}°`, 860, y0 + 406, 16, C.cmd, 'center', 'bold', true);
    if (s.surfaces.stern.jammed) text(g, 'TRAVADO', 860, y0 + 210, 16, C.alarm, 'center', 'bold');
    if (s.surfaces.bow.jammed) text(g, 'TRAVADO', 860, y0 + 430, 16, C.alarm, 'center', 'bold');
    // rodapé: modo de profundidade e flutuabilidade
    const fy = H - 62;
    box(g, 285, fy, 657, 50);
    const mode = ap.depthMode === 'AUTO' ? `PROF. AUTO ${ap.depthSet.toFixed(0)} m` : ap.pitchMode === 'AUTO' ? `PITCH AUTO ${ap.pitchSet.toFixed(1)}°` : 'PROF. MANUAL (manche)';
    text(g, mode, 300, fy + 25, 20, ap.depthMode === 'AUTO' || ap.pitchMode === 'AUTO' ? C.cmd : C.text, 'left', 'bold');
    const nb = e.outputs.surfaced ? `reserva ${(e.outputs.reserveKg / 1000).toFixed(1)} t` : `flutuab. ${(e.outputs.netBuoyancyKg / 1000).toFixed(2)} t`;
    text(g, nb, 930, fy + 25, 18, Math.abs(e.outputs.netBuoyancyKg) > 2000 && !e.outputs.surfaced ? C.warn : C.dim, 'right', 'bold', true);
    void W;
    void act;
  };
}

/** tela do OFICIAL DE MANOBRA: pilotos automáticos, telégrafo, manobras e periscópio */
export function drawConningOfficer(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W } = c;
    const s = e.state;
    const ap = s.autopilot;
    const y0 = screenBg(c, 'OFICIAL DE MANOBRA', 'pilotos automáticos · máquinas · manobras');
    // pilotos automáticos
    box(g, 14, y0, W - 28, 238, 'PILOTOS AUTOMÁTICOS');
    const rows: { ch: 'heading' | 'depth' | 'pitch'; name: string; mode: 'MANUAL' | 'AUTO'; set: number; steps: number[]; unit: string; meas: number; lim: [number, number] }[] = [
      { ch: 'heading', name: 'RUMO', mode: ap.headingMode, set: ap.headingSet, steps: [-10, -1, 1, 10], unit: '°', meas: s.sensors.GIRO.value, lim: [-1e9, 1e9] },
      { ch: 'depth', name: 'PROFUNDIDADE', mode: ap.depthMode, set: ap.depthSet, steps: [-10, -5, 5, 10], unit: ' m', meas: indDepth(c), lim: [0, 400] },
      { ch: 'pitch', name: 'INCLINAÇÃO', mode: ap.pitchMode, set: ap.pitchSet, steps: [-1, 1], unit: '°', meas: s.sensors.INSP.value, lim: [-15, 15] },
    ];
    rows.forEach((r, i) => {
      const y = y0 + 34 + i * 66;
      text(g, r.name, 28, y + 22, 18, C.text, 'left', 'bold');
      button(c, { id: `ap-${r.ch}-man`, x: 178, y, w: 74, h: 44, label: 'MAN', on: r.mode === 'MANUAL', tone: 'neutral', tip: `${r.name}: modo MANUAL`, action: () => act.cmd({ type: 'autopilot', channel: r.ch, mode: 'MANUAL' }) });
      button(c, { id: `ap-${r.ch}-auto`, x: 258, y, w: 74, h: 44, label: 'AUTO', on: r.mode === 'AUTO', tone: 'cmd', tip: `${r.name}: modo AUTOMÁTICO (assume a leitura atual sem solavanco)`, action: () => act.cmd({ type: 'autopilot', channel: r.ch, mode: 'AUTO' }) });
      const fmtV = (v: number) => (r.ch === 'heading' ? `${String(Math.round(((v % 360) + 360) % 360)).padStart(3, '0')}°` : `${v.toFixed(r.ch === 'pitch' ? 0 : 0)}${r.unit}`);
      const xe = stepper(c, `ap-${r.ch}-set`, 346, y, 44, r.steps, r.set, fmtV, (v) => act.cmd({ type: 'setpoint', channel: r.ch, value: Math.max(r.lim[0], Math.min(r.lim[1], v)) }), `${r.name} ordenado`, 50);
      const tel = r.ch === 'heading' ? ap.tHeading : r.ch === 'depth' ? ap.tDepth : ap.tPitch;
      text(g, r.mode === 'AUTO' ? `erro ${tel.error.toFixed(1)}${tel.saturated ? ' SAT' : ''}` : `lido ${fmtV(r.meas)}`, Math.min(W - 24, xe + 10), y + 22, 16, r.mode === 'AUTO' ? C.cmd : C.dim, 'left', 'bold', true);
    });
    // telégrafo
    const ty = y0 + 248;
    box(g, 14, ty, W - 28, 150, 'TELÉGRAFO DE MÁQUINAS');
    const p = s.propulsion;
    const bw = (W - 28 - 20 - 7 * 6) / 8;
    TELEGRAPH.forEach((t, i) => {
      button(c, { id: `tel-${t.rpm}`, x: 24 + i * (bw + 6), y: ty + 32, w: bw, h: 52, label: t.label, sub: `${t.rpm} rpm`, on: Math.round(p.rpmCmd) === t.rpm, tone: t.rpm < 0 ? 'warn' : t.rpm === 0 ? 'neutral' : 'ok', tip: `Telégrafo: ${t.label} (${t.rpm} rpm)`, action: () => act.cmd({ type: 'telegraph', rpm: t.rpm }), size: 15 });
    });
    digital(g, 24, ty + 94, 210, 46, `${p.rpmCmd.toFixed(0)}`, C.cmd, 'ORDEM rpm');
    digital(g, 244, ty + 94, 210, 46, `${e.outputs.rpm.toFixed(0)}`, C.real, 'EIXO rpm');
    digital(g, 464, ty + 94, 210, 46, `${toKnots(s.sensors.DVLU.value).toFixed(1)}`, '#7dff9c', 'VELOCIDADE nós');
    text(g, nearestOrder(p.rpmCmd).label, 820, ty + 117, 26, p.rpmCmd < 0 ? C.warn : C.real, 'center', 'bold');
    // manobras e periscópio
    const my = ty + 160;
    box(g, 14, my, 600, 640 - my - 12, 'MANOBRAS RÁPIDAS');
    const ms = act.maneuverStatus();
    button(c, { id: 'man-dive', x: 26, y: my + 32, w: 180, h: 52, label: 'IMERGIR', sub: `para ${Math.max(20, Math.round(ap.depthSet / 10) * 10 || 50)} m`, tone: 'cmd', tip: 'Manobra automática: abrir suspiros, alagar os TLP e descer à profundidade ordenada (mín. 20 m)', action: () => act.maneuver('imergir', Math.max(20, Math.round(ap.depthSet / 10) * 10 || 50)) });
    button(c, { id: 'man-surf', x: 214, y: my + 32, w: 180, h: 52, label: 'EMERGIR', sub: 'soprar os TLP', tone: 'ok', tip: 'Manobra automática: subir à cota periscópica e soprar os TLP', action: () => act.maneuver('emergir') });
    button(c, { id: 'man-cancel', x: 402, y: my + 32, w: 200, h: 52, label: 'CANCELAR', tone: 'warn', disabled: !ms, tip: 'Cancelar a manobra em andamento (os comandos já enviados permanecem)', action: () => act.maneuver('cancelar') });
    text(g, ms ?? 'nenhuma manobra em andamento', 30, my + 104, 16, ms ? C.cmd : C.dim, 'left', 'bold', false, 570);
    const pr = s.periscope ?? { cmd: false, pos: 0 };
    box(g, 624, my, W - 638, 640 - my - 12, 'PERISCÓPIO');
    button(c, { id: 'peri-raise', x: 636, y: my + 32, w: 140, h: 52, label: pr.cmd ? 'ARRIAR' : 'IÇAR', sub: `${Math.round(pr.pos * 100)} % içado`, on: pr.cmd, tone: 'cmd', tip: pr.cmd ? 'Arriar o periscópio de ataque' : 'Içar o periscópio de ataque (curso hidráulico)', action: () => act.cmd({ type: 'periscope', raise: !pr.cmd }) });
    button(c, { id: 'peri-view', x: 784, y: my + 32, w: 150, h: 52, label: 'OLHAR', sub: 'visada', tone: 'neutral', tip: 'Abrir a visada do periscópio', action: () => act.periscopeView() });
  };
}

/** tela do TIMONEIRO: rumo e leme de direção */
export function drawHelmsman(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    const s = e.state;
    const ap = s.autopilot;
    const y0 = screenBg(c, 'TIMONEIRO — RUMO E GOVERNO', 'leme de direção');
    const hdg = s.sensors.GIRO.value;
    compass(g, 250, y0 + 250, 220, hdg, ap.headingMode === 'AUTO' ? ap.headingSet : null, s.sensors.INSW.value);
    box(g, 500, y0 + 6, W - 514, 200, 'RUMO');
    digital(g, 514, y0 + 34, 200, 70, `${String(Math.round(((hdg % 360) + 360) % 360)).padStart(3, '0')}°`, '#7dff9c', 'GIRO (verdadeiro)');
    digital(g, 724, y0 + 34, 210, 70, `${String(Math.round(((s.sensors.AGM.value % 360) + 360) % 360)).padStart(3, '0')}°`, '#c8ff7d', 'AGULHA (magnético)');
    text(g, ap.headingMode === 'AUTO' ? `AUTO · ordenado ${String(Math.round(ap.headingSet)).padStart(3, '0')}°` : 'MANUAL (manche)', 514, y0 + 130, 22, ap.headingMode === 'AUTO' ? C.cmd : C.text, 'left', 'bold');
    text(g, `guinada ${s.sensors.INSW.value >= 0 ? '+' : ''}${s.sensors.INSW.value.toFixed(2)} °/s`, 514, y0 + 170, 18, C.dim, 'left', 'normal', true);
    box(g, 500, y0 + 216, W - 514, H - y0 - 230, 'LEME DE DIREÇÃO');
    const rud = s.surfaces.rudder;
    const max = e.vessel.fins.find((f) => f.id === 'rudder')!.maxDeflection;
    angleArc(g, 720, y0 + 420, 120, rud.cmd, rud.actual, max, 'BB', 'BE', '', false);
    text(g, `ordenado ${Math.abs(rud.cmd).toFixed(0)}° ${rud.cmd > 0.5 ? 'BE' : rud.cmd < -0.5 ? 'BB' : 'a meio'}`, 720, y0 + 470, 18, C.cmd, 'center', 'bold');
    if (rud.jammed) text(g, 'LEME TRAVADO', 720, y0 + 500, 18, C.alarm, 'center', 'bold');
    text(g, `vel. ${toKnots(s.sensors.DVLU.value).toFixed(1)} nós`, 250, H - 24, 20, C.text, 'center', 'bold', true);
    void act;
  };
}

/** painel de instrumentos analógicos na antepara de vante (acima do posto de governo) */
export function drawDivingGauges() {
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    const s = e.state;
    faceBg(c, '#c4c6c0');
    const d = indDepth(c);
    const r = H * 0.34;
    const cy = H * 0.5;
    const ap = s.autopilot;
    dial(g, r + 40, cy, r, { value: d, min: 0, max: 300, major: 50, minor: 10, label: 'PROFUNDÍMETRO', unit: 'metros', ordered: ap.depthMode === 'AUTO' ? ap.depthSet : null, amberFrom: e.vessel.limits.operatingDepth, redFrom: e.vessel.limits.testDepth, digits: 1 });
    plate(g, 'PROFUNDIDADE (QUILHA)', 40, H - 46, 2 * r, 30, 17);
    const x2 = 2 * r + 80 + r * 0.8;
    dial(g, x2, cy, r * 0.8, { value: Math.min(40, d), min: 0, max: 40, major: 10, minor: 1, label: 'PRECISÃO', unit: 'm (cota periscópica)', ordered: ap.depthMode === 'AUTO' && ap.depthSet <= 40 ? ap.depthSet : null });
    plate(g, 'PROFUNDÍMETRO FINO', x2 - r * 0.8, H - 46, 1.6 * r, 30, 16);
    const x3 = x2 + r * 0.8 + 40 + r * 0.7;
    dial(g, x3, cy, r * 0.7, { value: toKnots(s.sensors.DVLU.value), min: -6, max: 20, major: 4, minor: 1, label: 'VELOCIDADE', unit: 'nós', digits: 1 });
    plate(g, 'ODÔMETRO', x3 - r * 0.7, H - 46, 1.4 * r, 30, 16);
    // rumo (repetidora)
    const x4 = x3 + r * 0.7 + 40 + r * 0.7;
    compass(g, x4, cy, r * 0.7, s.sensors.GIRO.value, ap.headingMode === 'AUTO' ? ap.headingSet : null);
    plate(g, 'REPETIDORA DA GIRO', x4 - r * 0.7, H - 46, 1.4 * r, 30, 15);
    // relógio
    const x5 = x4 + r * 0.7 + 30 + r * 0.55;
    const t = s.t;
    g.fillStyle = '#2b2d2f';
    g.beginPath();
    g.arc(x5, cy - 30, r * 0.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f4f2ea';
    g.beginPath();
    g.arc(x5, cy - 30, r * 0.55, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.fillStyle = '#111';
      g.fillRect(x5 + Math.sin(a) * r * 0.46 - 2, cy - 30 - Math.cos(a) * r * 0.46 - 2, 4, 4);
    }
    const hand = (frac: number, len: number, wd: number, col: string) => {
      const a = frac * Math.PI * 2;
      g.strokeStyle = col;
      g.lineWidth = wd;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x5, cy - 30);
      g.lineTo(x5 + Math.sin(a) * r * len, cy - 30 - Math.cos(a) * r * len);
      g.stroke();
      g.lineCap = 'butt';
    };
    hand(((t / 3600) % 12) / 12, 0.3, 6, '#111');
    hand(((t / 60) % 60) / 60, 0.45, 4, '#111');
    hand((t % 60) / 60, 0.5, 2, '#c62828');
    digital(g, x5 - r * 0.55, cy + r * 0.45, r * 1.1, 34, clockText(t));
    // inclinômetro de bolha (pitch) e pendular (banda)
    const xi = x5 + r * 0.55 + 30;
    const wi = W - xi - 30;
    const pitch = s.sensors.INSP.value;
    g.fillStyle = '#2b2d2f';
    rrect(g, xi, cy - 90, wi, 50, 25);
    g.fill();
    g.fillStyle = '#d8e7c8';
    rrect(g, xi + 6, cy - 84, wi - 12, 38, 19);
    g.fill();
    for (let a = -15; a <= 15; a += 5) {
      const x = xi + wi / 2 + (a / 15) * (wi / 2 - 30);
      g.fillStyle = '#222';
      g.fillRect(x - 1, cy - 84, 2, a === 0 ? 38 : 12);
      if (a % 10 === 0 || a === 15 || a === -15) text(g, String(Math.abs(a)), x, cy - 30, 14, '#222', 'center', 'bold');
    }
    // a bolha sobe para o lado mais alto: proa para cima ⇒ bolha para vante (direita = vante)
    const bx = xi + wi / 2 + (Math.max(-15, Math.min(15, pitch)) / 15) * (wi / 2 - 30);
    const grd = g.createRadialGradient(bx - 5, cy - 70, 2, bx, cy - 65, 22);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(1, 'rgba(170,200,150,0.6)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(bx, cy - 65, 24, 14, 0, 0, Math.PI * 2);
    g.fill();
    plate(g, 'INCLINÔMETRO (CATURRO) — VANTE ▶', xi, cy - 130, wi, 30, 14);
    // pendular
    const roll = s.sensors.INSR.value;
    const pcx = xi + wi / 2;
    const pcy = cy + 10;
    g.fillStyle = '#f4f2ea';
    g.beginPath();
    g.arc(pcx, pcy, wi * 0.42, 0, Math.PI);
    g.fill();
    g.strokeStyle = '#222';
    g.lineWidth = 2;
    g.stroke();
    for (let a = -30; a <= 30; a += 10) {
      const rr = (a * Math.PI) / 180;
      g.beginPath();
      g.moveTo(pcx + Math.sin(rr) * wi * 0.33, pcy + Math.cos(rr) * wi * 0.33);
      g.lineTo(pcx + Math.sin(rr) * wi * 0.4, pcy + Math.cos(rr) * wi * 0.4);
      g.stroke();
    }
    // o pêndulo fica na vertical verdadeira: em relação ao painel (adernado φ) gira −φ
    const pr = (-Math.max(-35, Math.min(35, roll)) * Math.PI) / 180;
    g.strokeStyle = '#c62828';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(pcx, pcy);
    g.lineTo(pcx + Math.sin(pr) * wi * 0.4, pcy + Math.cos(pr) * wi * 0.4);
    g.stroke();
    g.fillStyle = '#c62828';
    g.beginPath();
    g.arc(pcx + Math.sin(pr) * wi * 0.4, pcy + Math.cos(pr) * wi * 0.4, 7, 0, Math.PI * 2);
    g.fill();
    plate(g, `CLINÔMETRO (BANDA) ${roll >= 0 ? '+' : ''}${roll.toFixed(1)}°`, xi, H - 46, wi, 30, 14);
  };
}

/** quebra um texto em até duas linhas */
function wrap2(s: string, maxChars: number): [string, string] {
  if (s.length <= maxChars) return [s, ''];
  const words = s.split(' ');
  let a = '';
  let i = 0;
  while (i < words.length && (a + ' ' + words[i]).trim().length <= maxChars) a = (a + ' ' + words[i++]).trim();
  let b = words.slice(i).join(' ');
  if (b.length > maxChars) b = b.slice(0, maxChars - 1) + '…';
  return [a, b];
}

/** ANUNCIADOR DE ALARMES: uma janela por alarme (acende quando ativo, pisca até ser reconhecida) */
export function drawAnnunciator(act: RoomActions) {
  return (c: DrawCtx) => {
    const { g, e, W, H } = c;
    faceBg(c, '#b9bcb6');
    plate(g, 'PAINEL ANUNCIADOR DE ALARMES', 20, 14, W - 340, 34, 20);
    const rt = e.state.alarms.runtime;
    const cols = 7;
    const defs = ALARM_DEFS;
    const rows = Math.ceil(defs.length / cols);
    const gx = 20;
    const gy = 58;
    const gw = W - 40;
    const gh = H - gy - 16;
    const tw = gw / cols;
    const th = gh / rows;
    defs.forEach((d, i) => {
      const r = rt[d.id];
      const x = gx + (i % cols) * tw;
      const y = gy + Math.floor(i / cols) * th;
      const active = !!r?.active;
      const vis = !!r && (r.active || !r.acked);
      const blink = !!r && !r.acked && Math.floor(c.now * 3) % 2 === 0;
      const on = (vis && !blink) || c.ui.lampTest;
      const col = d.priority <= 2 ? '#ff4b3a' : d.priority === 3 ? '#ffb300' : '#fffbe0';
      g.fillStyle = '#1b1c1d';
      g.fillRect(x + 3, y + 3, tw - 6, th - 6);
      g.fillStyle = on ? col : '#4a4a44';
      g.fillRect(x + 7, y + 7, tw - 14, th - 14);
      const [l1, l2] = wrap2(d.text, 22);
      const ink = on ? '#111' : '#bdbdb0';
      text(g, l1, x + tw / 2, y + th * (l2 ? 0.36 : 0.45), Math.min(15, th * 0.22), ink, 'center', 'bold', false, tw - 18);
      if (l2) text(g, l2, x + tw / 2, y + th * 0.6, Math.min(15, th * 0.22), ink, 'center', 'bold', false, tw - 18);
      text(g, PRIORITY_LABEL[d.priority], x + tw / 2, y + th * 0.82, Math.min(11, th * 0.16), on ? '#222' : '#8a8a80', 'center');
      if (on && c.glow) {
        c.glow.fillStyle = col;
        c.glow.fillRect(x + 7, y + 7, tw - 14, th - 14);
      }
      c.hit({ id: `al-${d.id}`, x, y, w: tw, h: th, label: `${d.text} (${PRIORITY_LABEL[d.priority]}) — ${active ? 'ATIVO' : vis ? 'normalizado' : 'normal'}${r && !r.acked ? ', não reconhecido. Clique para reconhecer' : ''}`, action: () => act.cmd({ type: 'ack', id: d.id }) });
    });
    lampButton(c, { id: 'al-ack', x: W - 310, y: 8, w: 150, h: 46, label: 'RECONHECER', lit: Object.values(rt).some((r) => r.active && !r.acked), blink: true, color: 'amber', tip: 'Reconhecer todos os alarmes', action: () => act.cmd({ type: 'ack', id: 'ALL' }) });
    lampButton(c, { id: 'al-test', x: W - 152, y: 8, w: 132, h: 46, label: 'TESTE LÂMP.', lit: c.ui.lampTest, color: 'white', tip: 'Teste de lâmpadas: acende todas as lâmpadas dos painéis por 3 s', action: () => {
      c.ui.lampTest = true;
      window.setTimeout(() => (c.ui.lampTest = false), 3000);
    } });
    void lamp;
  };
}
