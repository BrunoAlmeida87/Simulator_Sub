/** Tela 7 — Histórico: gráficos sincronizados e comparação antes/depois. */
import { useState } from 'react';
import { runner, useSim } from '../store';
import { Panel } from '../components/Panel';
import { StripChart } from '../components/StripChart';
import { CHANNELS } from '../../sim/history';
import { downloadText } from '../storage';
import { fmt, fmtTime } from '../format';

const CHARTS: { title: string; series: { id: string; color: string; dashed?: boolean }[]; invert?: boolean; minSpan?: number }[] = [
  { title: 'Profundidade', minSpan: 2, invert: true, series: [{ id: 'depth', color: '#36c5f0' }, { id: 'depthInd', color: '#3ddc84', dashed: true }, { id: 'depthSet', color: '#ffb347', dashed: true }] },
  { title: 'Velocidade', minSpan: 1, series: [{ id: 'speed', color: '#36c5f0' }] },
  { title: 'Eixo', minSpan: 10, series: [{ id: 'rpm', color: '#3ddc84' }, { id: 'rpmCmd', color: '#ffb347', dashed: true }] },
  { title: 'Rumo', minSpan: 2, series: [{ id: 'heading', color: '#36c5f0' }, { id: 'headingSet', color: '#ffb347', dashed: true }] },
  { title: 'Pitch e banda', minSpan: 1, series: [{ id: 'pitch', color: '#36c5f0' }, { id: 'pitchEq', color: '#b48cff', dashed: true }, { id: 'roll', color: '#f5b041' }] },
  { title: 'Volumes dos tanques', minSpan: 1, series: [{ id: 'mbt', color: '#57a8ff' }, { id: 'comp', color: '#3ddc84' }, { id: 'trimA', color: '#ffb347' }, { id: 'trimB', color: '#ff7b54' }, { id: 'heelA', color: '#b48cff' }, { id: 'heelB', color: '#e889ff' }] },
  { title: 'Lemes (comando × real)', minSpan: 4, series: [{ id: 'bowCmd', color: '#3ddc84', dashed: true }, { id: 'bow', color: '#3ddc84' }, { id: 'sternCmd', color: '#36c5f0', dashed: true }, { id: 'stern', color: '#36c5f0' }, { id: 'rudderCmd', color: '#ffb347', dashed: true }, { id: 'rudder', color: '#ffb347' }] },
  { title: 'Flutuabilidade e velocidade vertical', minSpan: 0.5, series: [{ id: 'net', color: '#b48cff' }, { id: 'vz', color: '#f5b041' }] },
  { title: 'Energia', minSpan: 1, series: [{ id: 'soc', color: '#3ddc84' }] },
  { title: 'Demanda elétrica', minSpan: 20, series: [{ id: 'power', color: '#ffb347' }] },
  { title: 'Ar AP e densidade', minSpan: 5, series: [{ id: 'hp', color: '#c9d6e3' }] },
];

const COMPARE = ['depth', 'vz', 'speed', 'heading', 'pitch', 'pitchEq', 'roll', 'net', 'mbt', 'comp', 'trimA', 'trimB', 'rho'];

export function HistoryScreen() {
  const e = useSim(4);
  const h = runner.history;
  const [win, setWin] = useState(600);
  const [sel, setSel] = useState<number | null>(null);
  const [after, setAfter] = useState(60);
  const markers = e.state.commands.map((c) => ({ t: c.t, text: c.text }));
  const cmds = [...e.state.commands].reverse().slice(0, 120);
  const selCmd = sel !== null ? e.state.commands.find((c) => c.t === sel) : null;
  const tNow = e.state.t;
  return (
    <div className="grid g2">
      <Panel
        title="Registro histórico (amostragem 1 s, até 2 h)"
        className="span-all"
        right={
          <div className="row">
            <div className="seg">
              {[120, 300, 600, 1800, 7200].map((w) => (
                <button key={w} className={win === w ? 'on' : ''} onClick={() => setWin(w)}>
                  {w < 3600 ? `${w / 60} min` : `${w / 3600} h`}
                </button>
              ))}
            </div>
            <button className="btn sm" onClick={() => downloadText(`sx1-historico-${Math.round(tNow)}s.csv`, h.toCSV(), 'text/csv')}>
              Exportar CSV
            </button>
          </div>
        }
      >
        <div className="subtle">Passe o cursor sobre um gráfico para sincronizar todos. Linhas tracejadas âmbar verticais marcam comandos do operador. Tracejados nas séries: comandos/referências.</div>
      </Panel>
      {CHARTS.map((c) => (
        <Panel key={c.title} title={c.title}>
          <StripChart history={h} series={c.series} window={win} title="" invert={c.invert} minSpan={c.minSpan} markers={markers} version={h.version} />
        </Panel>
      ))}
      <Panel title="Comandos realizados">
        <div className="scroll" style={{ maxHeight: 360 }}>
          <table className="t">
            <tbody>
              {cmds.map((c, i) => (
                <tr key={i} className={sel === c.t ? 'sel' : ''} onClick={() => setSel(c.t)} style={{ cursor: 'pointer' }}>
                  <td className="num" style={{ width: 70 }}>
                    {fmtTime(c.t)}
                  </td>
                  <td className="mutedc">{c.group}</td>
                  <td>{c.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Comparação antes × depois de uma ação">
        {!selCmd ? (
          <div className="subtle">Selecione um comando na lista ao lado.</div>
        ) : (
          <>
            <div className="row mb8">
              <b>{fmtTime(selCmd.t)}</b> {selCmd.text}
            </div>
            <div className="row mb8">
              Comparar com
              <div className="seg">
                {[30, 60, 120, 300].map((a) => (
                  <button key={a} className={after === a ? 'on' : ''} onClick={() => setAfter(a)}>
                    +{a}s
                  </button>
                ))}
              </div>
            </div>
            <table className="t">
              <thead>
                <tr>
                  <th>Grandeza</th>
                  <th>Antes (−5 s)</th>
                  <th>Depois (+{after} s)</th>
                  <th>Δ</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((id) => {
                  const c = CHANNELS.find((x) => x.id === id)!;
                  const a = h.valueAt(id, selCmd.t - 5);
                  const tb = Math.min(tNow, selCmd.t + after);
                  const b = h.valueAt(id, tb);
                  return (
                    <tr key={id}>
                      <td>
                        {c.label} <span className="subtle">({c.unit})</span>
                      </td>
                      <td className="num">{fmt(a, 2)}</td>
                      <td className="num">{fmt(b, 2)}</td>
                      <td className="num" style={{ color: Math.abs(b - a) > 1e-3 ? '#ffb347' : undefined }}>
                        {fmt(b - a, 2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {selCmd.t + after > tNow && <div className="subtle mt8">Ainda não decorreram {after} s após o comando: usando o valor atual.</div>}
          </>
        )}
      </Panel>
    </div>
  );
}
