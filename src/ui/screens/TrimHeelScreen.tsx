/** Tela 3 — Trim longitudinal e banda. */
import { useState } from 'react';
import { cmd, useSim } from '../store';
import { Panel } from '../components/Panel';
import { Readout } from '../components/Readout';
import { Pipe, PumpGlyph, TankGlyph, ValveGlyph } from '../components/Schematic';
import { MomentExplain } from '../components/Explain';
import { valveStatus, pumpStatus } from '../../sim/systems/components';
import { tankVolume } from '../../sim/systems/internalTanks';
import type { SimulationEngine } from '../../sim/core/engine';
import type { TransferSystemConfig } from '../../sim/config/types';
import type { TransferState } from '../../sim/core/state';
import { RAD } from '../../sim/core/math';
import { fmt, fmtMass, fmtMoment } from '../format';

function TransferControls({ e, sys }: { e: SimulationEngine; sys: 'trim' | 'heel' }) {
  const c: TransferSystemConfig = e.vessel[sys];
  const st: TransferState = e.state[sys];
  const [kg, setKg] = useState(sys === 'trim' ? 500 : 300);
  const dirAB = st.direction.cmd < 0.5;
  const arm = sys === 'trim' ? c.tankA.center.x - c.tankB.center.x : c.tankB.center.y - c.tankA.center.y;
  const stiff = sys === 'trim' ? e.outputs.pitchStiffness : e.outputs.rollStiffness;
  const predAB = Math.atan((kg * 9.80665 * arm) / stiff) * RAD;
  const lblA = c.tankA.id;
  const lblB = c.tankB.id;
  const d = st.dosing;
  const VB = (v: typeof st.valveA, label: string, which: 'A' | 'B') => (
    <span className="row" style={{ gap: 4 }}>
      {label}: <span className={`badge ${valveStatus(v) === 'ABERTA' ? 'ok' : valveStatus(v) === 'FECHADA' ? 'off' : valveStatus(v) === 'TRAVADA' ? 'alarm' : 'warn'}`}>{valveStatus(v)}</span>
      <button className="btn sm" onClick={() => cmd({ type: 'valve', system: sys, valve: which, open: v.cmd < 0.5 })}>
        {v.cmd > 0.5 ? 'Fechar' : 'Abrir'}
      </button>
    </span>
  );
  return (
    <div className="col">
      <div className="row">
        {VB(st.valveA, lblA, 'A')}
        {VB(st.valveB, lblB, 'B')}
      </div>
      <div className="row">
        <span>Seletor de sentido:</span>
        <div className="seg">
          <button className={dirAB ? 'on' : ''} onClick={() => cmd({ type: 'direction', system: sys, dir: 'AtoB' })}>
            {lblA} → {lblB}
          </button>
          <button className={!dirAB ? 'on' : ''} onClick={() => cmd({ type: 'direction', system: sys, dir: 'BtoA' })}>
            {lblB} → {lblA}
          </button>
        </div>
        <span className="badge info">{st.direction.pos < 0.02 ? `${lblA}→${lblB}` : st.direction.pos > 0.98 ? `${lblB}→${lblA}` : 'EM TRÂNSITO'}</span>
      </div>
      <div className="row">
        <span>{c.pump.name}:</span>
        <span className={`badge ${st.pump.failed ? 'alarm' : st.pump.speed > 0.01 ? 'ok' : 'off'}`}>{pumpStatus(st.pump, e.state.electrical.energized)}</span>
        <button className="btn sm" onClick={() => cmd({ type: 'pump', system: sys, run: !st.pump.cmd })}>
          {st.pump.cmd ? 'Parar' : 'Partir'}
        </button>
        <span className="subtle mono">
          {(Math.abs(st.flow) * 1000).toFixed(1)} L/s · {(st.pump.power / 1e3).toFixed(1)} kW · Δp {(st.pump.dp / 1e5).toFixed(2)} bar
        </span>
      </div>
      {(st.pump.deadhead || st.pump.noSuction) && <span className="badge warn">Bomba sem fluxo (válvulas/seletor/tanque)</span>}
      <div className="row">
        <b>Sequência:</b>
        <input type="number" value={kg} min={10} step={50} onChange={(ev) => setKg(Number(ev.target.value))} /> kg
        <button className="btn" onClick={() => cmd({ type: 'dosing', system: sys, mode: 'transferir', kg, dir: 'AtoB' })}>
          {lblA} → {lblB}
        </button>
        <button className="btn" onClick={() => cmd({ type: 'dosing', system: sys, mode: 'transferir', kg, dir: 'BtoA' })}>
          {lblB} → {lblA}
        </button>
        <button className="btn warn" disabled={!d?.active} onClick={() => cmd({ type: 'dosingAbort', system: sys })}>
          Interromper
        </button>
      </div>
      {d && (
        <div className="subtle">
          Fase <b>{d.phase}</b>: {fmtMass(d.moved)} de {fmtMass(d.target)}. {d.message}
        </div>
      )}
      <div className="note">
        Previsão estática <span className="kind CALC">CALC</span>: transferir {fmtMass(kg)} {lblA}→{lblB} ⇒ Δ{sys === 'trim' ? 'θ' : 'φ'} ≈ <b className="mono">{fmt(predAB, 2)}°</b> ({sys === 'trim' ? 'proa para cima' : 'adernar para BE'}); sentido oposto ⇒ {fmt(-predAB, 2)}°. Rigidez {sys === 'trim' ? 'longitudinal' : 'transversal'}: {fmt(stiff / 1e6, 2)} MN·m/rad.
      </div>
    </div>
  );
}

function TrimDiagram({ e }: { e: SimulationEngine }) {
  const s = e.state;
  const v = e.vessel;
  const o = e.outputs;
  const W = 760;
  const X = (x: number) => 30 + (x + 35) * 10;
  const Y = (z: number) => 95 + z * 14;
  const top: string[] = [];
  const bot: string[] = [];
  for (let i = 0; i <= 100; i++) {
    const x = -35 + (i / 100) * 70;
    const r = e.geom.radiusAt(x);
    top.push(`${X(x)},${Y(-r)}`);
    bot.unshift(`${X(x)},${Y(r)}`);
  }
  // distribuição longitudinal (faixas de 5 m) dos itens de massa variáveis
  const bins = new Array(14).fill(0);
  for (const it of o.mp.items) {
    if (it.group === 'leve') continue;
    const k = Math.max(0, Math.min(13, Math.floor((it.pos.x + 35) / 5)));
    bins[k] += it.mass;
  }
  const maxBin = Math.max(...bins, 1);
  const c = v.trim;
  const st = s.trim;
  const xa = X(c.tankA.center.x);
  const xb = X(c.tankB.center.x);
  const yT = Y(2.2) - 12;
  const pipeY = Y(3.1) + 30;
  return (
    <svg viewBox={`0 0 ${W} 290`} className="svgbox">
      <g transform={`rotate(${-o.euler.pitch} ${X(0)} ${Y(0)})`}>
        <path d={`M${top.join(' L')} L${bot.join(' L')} Z`} fill="#1a2838" stroke="#9fb7cf" />
        <line x1={X(o.mp.cg.x)} x2={X(o.mp.cg.x)} y1={Y(-3.5)} y2={Y(3.5)} stroke="#ffb347" strokeWidth="2" />
        <text x={X(o.mp.cg.x) + 4} y={Y(-3.6)} fontSize="10" fill="#ffb347">G</text>
        <line x1={X(o.forces.hs.center.x)} x2={X(o.forces.hs.center.x)} y1={Y(-3.5)} y2={Y(3.5)} stroke="#36c5f0" strokeWidth="2" strokeDasharray="4 2" />
        <text x={X(o.forces.hs.center.x) - 12} y={Y(-3.6)} fontSize="10" fill="#36c5f0">B</text>
        <TankGlyph x={xa - 26} y={yT} w={52} h={22} fill={tankVolume(st.tankA) / c.tankA.capacity} label="TT-AV" sub={`${tankVolume(st.tankA).toFixed(2)} m³`} inspect="trim" />
        <TankGlyph x={xb - 26} y={yT} w={52} h={22} fill={tankVolume(st.tankB) / c.tankB.capacity} label="TT-AR" sub={`${tankVolume(st.tankB).toFixed(2)} m³`} inspect="trim" />
      </g>
      <Pipe d={`M${xb},${pipeY} L${xa},${pipeY}`} flow={st.flow === 0 ? 0 : -st.flow} width={3} />
      <ValveGlyph x={xa} y={pipeY} st={st.valveA} label="VTAV" onToggle={() => cmd({ type: 'valve', system: 'trim', valve: 'A', open: st.valveA.cmd < 0.5 })} inspect="trim" />
      <ValveGlyph x={xb} y={pipeY} st={st.valveB} label="VTAR" onToggle={() => cmd({ type: 'valve', system: 'trim', valve: 'B', open: st.valveB.cmd < 0.5 })} inspect="trim" />
      <PumpGlyph x={(xa + xb) / 2} y={pipeY} st={st.pump} label="BT" reverse={st.direction.pos < 0.5} onToggle={() => cmd({ type: 'pump', system: 'trim', run: !st.pump.cmd })} inspect="trim" />
      {/* barras de distribuição */}
      {bins.map((m, k) => {
        const h = (m / maxBin) * 50;
        return (
          <g key={k}>
            <rect x={X(-35 + k * 5) + 2} y={285 - h} width={46} height={h} fill="#3a5878" />
            <text x={X(-35 + k * 5) + 25} y={283 - h} fontSize="8.5" textAnchor="middle" fill="#a9bdd2">
              {m > 500 ? (m / 1000).toFixed(0) : ''}
            </text>
          </g>
        );
      })}
      <text x={8} y={226} fontSize="9.5" fill="#7f93a8">
        distribuição longitudinal das massas variáveis (t por faixa de 5 m) — ré ← → vante
      </text>
    </svg>
  );
}

function FrontView({ e }: { e: SimulationEngine }) {
  const o = e.outputs;
  const s = e.state;
  const c = e.vessel.heel;
  const S = 220;
  const k = 22;
  const cx = S / 2;
  const cy = S / 2 + 10;
  const R = e.vessel.hull.diameter / 2;
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="svgbox" style={{ maxWidth: 280 }}>
      <rect width={S} height={S} fill="#08192a" rx="4" />
      <line x1="0" x2={S} y1={cy} y2={cy} stroke="#2c4260" strokeDasharray="3 3" />
      <line x1={cx} x2={cx} y1="0" y2={S} stroke="#2c4260" strokeDasharray="3 3" />
      <g transform={`rotate(${o.euler.roll} ${cx} ${cy})`}>
        <circle cx={cx} cy={cy} r={R * k} fill="#1a2838" stroke="#9fb7cf" strokeWidth="1.5" />
        <rect x={cx - 0.75 * k} y={cy - (R + 5.2) * k * 0.55} width={1.5 * k} height={5.2 * k * 0.55 - R * k * 0.55 + R * k * 0.55} fill="#1a2838" stroke="#9fb7cf" />
        <TankGlyph x={cx + c.tankA.center.y * k - 14} y={cy + c.tankA.center.z * k - 12} w={28} h={24} fill={tankVolume(s.heel.tankA) / c.tankA.capacity} label="BB" inspect="heel" />
        <TankGlyph x={cx + c.tankB.center.y * k - 14} y={cy + c.tankB.center.z * k - 12} w={28} h={24} fill={tankVolume(s.heel.tankB) / c.tankB.capacity} label="BE" inspect="heel" />
        <circle cx={cx + o.mp.cg.y * k * 20} cy={cy + o.mp.cg.z * k} r="4" fill="#ffb347">
          <title>G (deslocamento lateral ampliado 20×)</title>
        </circle>
        <circle cx={cx} cy={cy + o.forces.hs.center.z * k} r="4" fill="none" stroke="#36c5f0" strokeWidth="2">
          <title>B</title>
        </circle>
      </g>
      <text x="6" y="14" fontSize="10" fill="#a9bdd2">
        vista de vante (olhando para ré)
      </text>
      <text x="6" y={S - 6} fontSize="10" fill="#a9bdd2">
        BB
      </text>
      <text x={S - 6} y={S - 6} fontSize="10" textAnchor="end" fill="#a9bdd2">
        BE
      </text>
      <text x={cx} y={S - 6} fontSize="12" textAnchor="middle" fill="#d8e4f0" fontFamily="var(--mono)">
        φ {fmt(o.euler.roll, 2)}°
      </text>
    </svg>
  );
}

export function TrimHeelScreen() {
  const e = useSim(10);
  const o = e.outputs;
  const s = e.state;
  const dyn = o.euler.pitch - o.staticPitchEq;
  return (
    <div className="grid g2">
      <Panel title="Trim longitudinal — diagrama e distribuição de massa" inspect="trim" className="span-all">
        <TrimDiagram e={e} />
      </Panel>
      <Panel title="Trim: grandezas" inspect="trim">
        <div className="readouts">
          <Readout label="Pitch medido" value={s.sensors.INSP.value} unit="°" digits={2} kind="MED" truth={o.euler.pitch} />
          <Readout label="Pitch de equilíbrio estático" value={o.staticPitchEq} unit="°" digits={2} kind="CALC" title="Somente pesos e empuxo" />
          <Readout label="Parcela dinâmica (lemes/hidrodinâmica)" value={dyn} unit="°" digits={2} kind="CALC" />
          <Readout label="Momento dos pesos (G–B long.)" value={fmtMoment(o.weightTrimMoment)} kind="CALC" />
          <Readout label="Momento hidrostático total" value={fmtMoment(o.staticPitchMoment)} kind="CALC" />
          <Readout label="Posição longitudinal de G" value={o.mp.cg.x} unit="m" digits={3} kind="CALC" />
          <Readout label="Posição longitudinal de B" value={o.forces.hs.center.x} unit="m" digits={3} kind="CALC" />
          <Readout label="BG (vertical)" value={o.BG} unit="m" digits={3} kind="CALC" />
          <Readout label="TT-AV" value={tankVolume(s.trim.tankA)} unit="m³" digits={2} kind="MED" />
          <Readout label="TT-AR" value={tankVolume(s.trim.tankB)} unit="m³" digits={2} kind="MED" />
        </div>
        <div className="note">
          <b>Tendência de trim</b>: {Math.abs(o.staticPitchEq - o.euler.pitch) < 0.2 ? 'atitude coincide com o equilíbrio estático.' : o.staticPitchEq > o.euler.pitch ? 'os pesos tendem a levantar a proa.' : 'os pesos tendem a abaixar a proa.'} A redistribuição de pesos muda o <b>equilíbrio estático</b> (mesmo parado); os lemes produzem uma atitude <b>dinâmica</b> que depende da velocidade e desaparece quando a velocidade cai.
        </div>
      </Panel>
      <Panel title="Trim: comandos" inspect="trim">
        <TransferControls e={e} sys="trim" />
      </Panel>
      <Panel title="Banda — vista frontal" inspect="heel">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <FrontView e={e} />
          <div className="readouts" style={{ flex: 1 }}>
            <Readout label="Banda medida" value={s.sensors.INSR.value} unit="°" digits={2} kind="MED" truth={o.euler.roll} />
            <Readout label="Banda de equilíbrio estático" value={o.staticRollEq} unit="°" digits={2} kind="CALC" />
            <Readout label="Momento transversal dos pesos" value={fmtMoment(o.weightHeelMoment)} kind="CALC" />
            <Readout label="Posição transversal de G" value={o.mp.cg.y * 1000} unit="mm" digits={1} kind="CALC" />
            <Readout label="Rigidez transversal" value={o.rollStiffness / 1e6} unit="MN·m/rad" digits={2} kind="CALC" />
            <Readout label="TB-BB / TB-BE" value={`${tankVolume(s.heel.tankA).toFixed(2)} / ${tankVolume(s.heel.tankB).toFixed(2)}`} unit="m³" kind="MED" />
          </div>
        </div>
        <div className="note">
          Arquitetura <b>fictícia</b> de tanques laterais. Submerso, a estabilidade transversal vem de BG (G abaixo de B): momento restaurador ≈ W·BG·sen φ. Tendência de retorno: {Math.abs(o.euler.roll - o.staticRollEq) < 0.05 ? 'em equilíbrio.' : `retorna para ${fmt(o.staticRollEq, 2)}°.`}
        </div>
      </Panel>
      <Panel title="Banda: comandos" inspect="heel">
        <TransferControls e={e} sys="heel" />
      </Panel>
      <Panel title="Momentos de pitch por origem" inspect="trim">
        <MomentExplain e={e} axis="pitch" />
      </Panel>
      <Panel title="Momentos de banda por origem" inspect="heel">
        <MomentExplain e={e} axis="roll" />
      </Panel>
    </div>
  );
}
