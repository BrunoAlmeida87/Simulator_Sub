/**
 * Controles de operação reutilizáveis: lemes, telégrafo, piloto automático,
 * comandos rápidos de lastro.
 */
import { useEffect, useState } from 'react';
import { cmd, runner } from '../store';
import type { SimulationEngine } from '../../sim/core/engine';
import { AngleBar } from './gauges';
import { fmt } from '../format';
import { KindTag } from './Readout';
import { useInspectable } from '../uiContext';

export function SurfaceControl({ e, id, vertical }: { e: SimulationEngine; id: 'bow' | 'stern' | 'rudder'; vertical?: boolean }) {
  const fin = e.vessel.fins.find((f) => f.id === id)!;
  const st = e.state.surfaces[id];
  const insp = useInspectable('fin:' + id);
  const [val, setVal] = useState(st.cmd);
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    if (!drag) setVal(st.cmd);
  }, [st.cmd, drag]);
  const send = (a: number) => cmd({ type: 'surface', id, angle: Math.round(a) });
  const isRudder = id === 'rudder';
  const neg = isRudder ? 'BB' : 'DESCER';
  const pos = isRudder ? 'BE' : 'SUBIR';
  const steps = isRudder ? [-30, -15, -5, 0, 5, 15, 30] : [-20, -10, -5, 0, 5, 10, 20];
  return (
    <div className="col" {...insp}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b style={{ fontSize: 12 }}>{fin.name}</b>
        <span className="subtle">
          <KindTag kind="CMD" /> {fmt(st.cmd, 0)}° · <KindTag kind="MED" /> {fmt(st.actual, 1)}°{st.jammed && <span className="badge alarm"> TRAVADO</span>}
        </span>
      </div>
      <AngleBar actual={st.actual} cmd={st.cmd} max={fin.maxDeflection} neg={neg} pos={pos} vertical={vertical} />
      <input
        type="range"
        min={-fin.maxDeflection}
        max={fin.maxDeflection}
        step={1}
        value={val}
        onChange={(ev) => {
          setDrag(true);
          setVal(Number(ev.target.value));
        }}
        onPointerUp={() => {
          setDrag(false);
          send(val);
        }}
        onKeyUp={() => {
          setDrag(false);
          send(val);
        }}
        aria-label={fin.name}
      />
      <div className="btngroup">
        {steps.map((a) => (
          <button key={a} className={`btn sm ${Math.round(st.cmd) === a ? 'on' : ''}`} onClick={() => send(a)}>
            {a === 0 ? (isRudder ? 'A MEIO' : '0') : `${Math.abs(a)}${a > 0 ? (isRudder ? ' BE' : '↑') : isRudder ? ' BB' : '↓'}`}
          </button>
        ))}
      </div>
    </div>
  );
}

export const TELEGRAPH: { label: string; rpm: number }[] = [
  { label: 'RÉ TODA', rpm: -110 },
  { label: 'RÉ MEIA', rpm: -60 },
  { label: 'RÉ DEV.', rpm: -30 },
  { label: 'PARAR', rpm: 0 },
  { label: 'AV DEV.', rpm: 40 },
  { label: 'AV MEIA', rpm: 75 },
  { label: 'AV 3/4', rpm: 115 },
  { label: 'AV TODA', rpm: 160 },
];

export function Telegraph({ e }: { e: SimulationEngine }) {
  const p = e.state.propulsion;
  const rated = e.vessel.propulsion.motor.ratedRpm;
  const [val, setVal] = useState(p.rpmCmd);
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    if (!drag) setVal(p.rpmCmd);
  }, [p.rpmCmd, drag]);
  const insp = useInspectable('propulsion');
  return (
    <div className="col" {...insp}>
      <div className="btngroup">
        {TELEGRAPH.map((t) => (
          <button key={t.label} className={`btn sm ${Math.round(p.rpmCmd) === t.rpm ? 'on' : ''} ${t.rpm < 0 ? 'warn' : ''}`} onClick={() => cmd({ type: 'telegraph', rpm: t.rpm })}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="row">
        <input
          type="range"
          min={-rated}
          max={rated}
          step={1}
          value={val}
          onChange={(ev) => {
            setDrag(true);
            setVal(Number(ev.target.value));
          }}
          onPointerUp={() => {
            setDrag(false);
            cmd({ type: 'telegraph', rpm: val });
          }}
          onKeyUp={() => {
            setDrag(false);
            cmd({ type: 'telegraph', rpm: val });
          }}
          style={{ flex: 1 }}
          aria-label="Ordem de rpm"
        />
        <span className="mono" style={{ minWidth: 70, textAlign: 'right' }}>
          {fmt(val, 0)} rpm
        </span>
      </div>
    </div>
  );
}

export function NumSet({ value, onSet, step, unit, min, max }: { value: number; onSet: (v: number) => void; step: number; unit: string; min?: number; max?: number }) {
  const [v, setV] = useState(String(Math.round(value * 10) / 10));
  useEffect(() => setV(String(Math.round(value * 10) / 10)), [value]);
  const commit = (x: number) => {
    let y = x;
    if (min !== undefined) y = Math.max(min, y);
    if (max !== undefined) y = Math.min(max, y);
    onSet(y);
  };
  return (
    <span className="row" style={{ gap: 4 }}>
      <button className="btn sm" onClick={() => commit(value - step)}>
        −{step}
      </button>
      <input type="number" value={v} onChange={(ev) => setV(ev.target.value)} onBlur={() => commit(Number(v))} onKeyDown={(ev) => ev.key === 'Enter' && commit(Number(v))} style={{ width: 70 }} />
      <button className="btn sm" onClick={() => commit(value + step)}>
        +{step}
      </button>
      <span className="subtle">{unit}</span>
    </span>
  );
}

export function AutopilotPanel({ e }: { e: SimulationEngine }) {
  const ap = e.state.autopilot;
  const insp = useInspectable('autopilot');
  const row = (label: string, ch: 'heading' | 'depth' | 'pitch', mode: 'MANUAL' | 'AUTO', set: number, unit: string, step: number, tel: typeof ap.tHeading, min?: number, max?: number) => (
    <tr>
      <td>
        <b>{label}</b>
      </td>
      <td>
        <div className="seg">
          <button className={mode === 'MANUAL' ? 'on' : ''} onClick={() => cmd({ type: 'autopilot', channel: ch, mode: 'MANUAL' })}>
            MAN
          </button>
          <button className={mode === 'AUTO' ? 'on' : ''} onClick={() => cmd({ type: 'autopilot', channel: ch, mode: 'AUTO' })}>
            AUTO
          </button>
        </div>
      </td>
      <td>
        <NumSet value={set} step={step} unit={unit} min={min} max={max} onSet={(v) => cmd({ type: 'setpoint', channel: ch, value: v })} />
      </td>
      <td className="num">{mode === 'AUTO' ? fmt(tel.measured, 1) : '—'}</td>
      <td className="num">{mode === 'AUTO' ? fmt(tel.error, 1) : '—'}</td>
      <td className="num" title="Contribuições P / I / D">
        {mode === 'AUTO' ? `${fmt(tel.p, 1)} / ${fmt(tel.i, 1)} / ${fmt(tel.d, 1)}` : '—'}
      </td>
      <td className="num">
        {mode === 'AUTO' ? fmt(tel.output, 1) + '°' : '—'}
        {mode === 'AUTO' && tel.saturated && <span className="badge warn"> SAT</span>}
        {mode === 'AUTO' && tel.lowEffectiveness && <span className="badge alarm"> BAIXA EFETIV.</span>}
      </td>
    </tr>
  );
  const pitchTel = ap.depthMode === 'AUTO' || ap.pitchMode === 'AUTO' ? ap.tPitch : ap.tPitch;
  return (
    <div {...insp} className="scroll">
      <table className="t">
        <thead>
          <tr>
            <th>Canal</th>
            <th>Modo</th>
            <th>
              Referência <KindTag kind="CMD" />
            </th>
            <th>
              Medido <KindTag kind="MED" />
            </th>
            <th>
              Erro <KindTag kind="CALC" />
            </th>
            <th>P / I / D</th>
            <th>Atuação</th>
          </tr>
        </thead>
        <tbody>
          {row('Rumo', 'heading', ap.headingMode, ap.headingSet, '°', 5, ap.tHeading, 0, 359)}
          {row('Profundidade', 'depth', ap.depthMode, ap.depthSet, 'm', 5, ap.tDepth, 0, 400)}
          {row('Pitch', 'pitch', ap.pitchMode, ap.pitchSet, '°', 1, pitchTel, -15, 15)}
        </tbody>
      </table>
      {ap.depthMode === 'AUTO' && (
        <div className="subtle mt8">
          Cascata de profundidade: θ ordenado = <b className="mono">{fmt(ap.tDepth.output, 1)}°</b> → lemes de ré {fmt(ap.tPitch.output, 1)}°; lemes de vante {fmt(ap.tBow.output, 1)}°.
        </div>
      )}
      <div className="note">
        Os controladores usam as leituras dos sensores. Mover manualmente um leme desengaja o canal correspondente. Ganhos escalonados com (U₀/U)²; a baixa velocidade os lemes perdem efetividade.
      </div>
    </div>
  );
}

export function QuickBallast({ e }: { e: SimulationEngine }) {
  const tanks = e.vessel.ballast.tanks;
  const anyVent = tanks.some((t) => e.state.ballast[t.id].vent.cmd > 0.5);
  const anyBlow = tanks.some((t) => e.state.ballast[t.id].blow.cmd > 0.5);
  const fill = tanks.reduce((a, t) => a + e.state.ballast[t.id].water, 0) / tanks.reduce((a, t) => a + t.volume, 0);
  return (
    <div className="col">
      <div className="col ballast-actions">
        <div className="row" role="group" aria-label="Suspiros">
          <button className={`btn ${anyVent ? 'on' : ''}`} onClick={() => cmd({ type: 'mbtVent', tank: 'ALL', open: true })}>
            Abrir suspiros
          </button>
          <button className="btn" onClick={() => cmd({ type: 'mbtVent', tank: 'ALL', open: false })}>
            Fechar suspiros
          </button>
        </div>
        <div className="row" role="group" aria-label="Sopro normal">
          <button className={`btn ok ${anyBlow ? 'on' : ''}`} onClick={() => cmd({ type: 'mbtBlow', tank: 'ALL', open: true })}>
            Soprar TLP
          </button>
          <button className="btn" onClick={() => cmd({ type: 'mbtBlow', tank: 'ALL', open: false })}>
            Fechar sopro
          </button>
        </div>
        <div className="row" role="group" aria-label="Sopro de emergência">
          <button className="btn danger" onClick={() => cmd({ type: 'emergencyBlow' })}>
            SOPRO DE EMERGÊNCIA
          </button>
          <button className="btn" onClick={() => cmd({ type: 'emergencyBlow', open: false })}>
            Fechar emergência
          </button>
        </div>
      </div>
      <div className="row subtle">
        <span>
          TLP: <b className="mono">{(fill * 100).toFixed(0)} %</b> cheios
        </span>
        <span>
          AP: <b className="mono">{fmt(e.outputs.hpManifoldBar, 0)} bar</b>
        </span>
        {tanks.map((t) => (
          <span key={t.id} className="mono">
            {t.id.replace('TLP', '')}: {((e.state.ballast[t.id].water / t.volume) * 100).toFixed(0)}%
          </span>
        ))}
      </div>
    </div>
  );
}

export function SimSpeedButtons() {
  const scales = [0.5, 1, 2, 5, 10, 20];
  return (
    <div className="seg" title="Aceleração do tempo (a física usa sempre o mesmo passo fixo)">
      {scales.map((s) => (
        <button key={s} className={runner.timeScale === s ? 'on' : ''} onClick={() => ((runner.timeScale = s), runner.notify())}>
          ×{s}
        </button>
      ))}
    </div>
  );
}
