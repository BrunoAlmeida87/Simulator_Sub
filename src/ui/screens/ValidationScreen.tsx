/** Validação: executa no navegador os mesmos cenários dos testes automáticos. */
import { useState } from 'react';
import { Panel } from '../components/Panel';
import { VALIDATION_CASES, runValidation, type ValidationResult, type Series } from '../../sim/validation/suite';

function MiniPlot({ series }: { series: Series[] }) {
  const W = 420;
  const H = 120;
  const all = series.flatMap((s) => s.y.filter(Number.isFinite));
  const xs = series.flatMap((s) => s.t);
  if (!all.length) return null;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const t0 = Math.min(...xs);
  const t1 = Math.max(...xs);
  const X = (t: number) => 34 + ((t - t0) / Math.max(1e-9, t1 - t0)) * (W - 40);
  const Y = (v: number) => H - 14 - ((v - lo) / Math.max(1e-9, hi - lo)) * (H - 22);
  const colors = ['#36c5f0', '#ffb347', '#3ddc84'];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="svgbox">
      <rect width={W} height={H} fill="#0a121b" rx="4" />
      <text x="2" y="12" fontSize="9" fill="#7f93a8">
        {hi.toPrecision(4)}
      </text>
      <text x="2" y={H - 14} fontSize="9" fill="#7f93a8">
        {lo.toPrecision(4)}
      </text>
      {series.map((s, i) => (
        <polyline key={i} fill="none" stroke={colors[i % 3]} strokeWidth="1.5" points={s.t.map((t, k) => `${X(t)},${Y(s.y[k])}`).join(' ')} />
      ))}
      <text x={W - 4} y={H - 3} fontSize="9" textAnchor="end" fill="#7f93a8">
        {series.map((s) => `${s.label} (${s.unit})`).join(' · ')} — eixo x: {t1 - t0 > 0 ? `${t0.toFixed(0)}…${t1.toFixed(0)}` : ''}
      </text>
    </svg>
  );
}

export function ValidationScreen() {
  const [res, setRes] = useState<Record<string, ValidationResult>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const runAll = async () => {
    for (const c of VALIDATION_CASES) {
      setBusy(c.id);
      await new Promise((r) => setTimeout(r, 30));
      const r = runValidation(c);
      setRes((x) => ({ ...x, [c.id]: r }));
    }
    setBusy(null);
  };
  const runOne = async (id: string) => {
    const c = VALIDATION_CASES.find((x) => x.id === id)!;
    setBusy(id);
    await new Promise((r) => setTimeout(r, 30));
    const r = runValidation(c);
    setRes((x) => ({ ...x, [id]: r }));
    setBusy(null);
  };
  const done = Object.values(res);
  return (
    <div className="grid g2">
      <Panel title="Validação física" className="span-all" right={<button className="btn" disabled={!!busy} onClick={runAll}>{busy ? `Executando ${busy}…` : 'Executar todos'}</button>}>
        <div>
          Cada caso executa um cenário independente (em memória, sem afetar a simulação em curso) e verifica <b>métricas numéricas</b> contra critérios. Os mesmos casos rodam nos testes automáticos (<code>npm test</code>).
        </div>
        {done.length > 0 && (
          <div className="mt8">
            Resultado: <b className={done.every((r) => r.passed) ? 'okc' : 'alarmc'}>{done.filter((r) => r.passed).length} / {done.length} aprovados</b>
          </div>
        )}
      </Panel>
      {VALIDATION_CASES.map((c) => {
        const r = res[c.id];
        return (
          <Panel key={c.id} title={c.title} tag={r ? <span className={`badge ${r.passed ? 'ok' : 'alarm'}`}>{r.passed ? 'APROVADO' : 'REPROVADO'}</span> : undefined} right={<button className="btn sm" disabled={!!busy} onClick={() => runOne(c.id)}>Executar</button>}>
            <div className="subtle mb8">{c.description}</div>
            {r && (
              <>
                <table className="t">
                  <thead>
                    <tr>
                      <th>Métrica</th>
                      <th>Valor</th>
                      <th>Critério</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {r.metrics.map((m) => (
                      <tr key={m.name}>
                        <td>{m.name}</td>
                        <td className="num">
                          {Number.isFinite(m.value) ? (Math.abs(m.value) >= 1e5 || (Math.abs(m.value) < 1e-3 && m.value !== 0) ? m.value.toExponential(3) : m.value.toFixed(4)) : '—'} {m.unit}
                        </td>
                        <td className="subtle">{m.criterion}</td>
                        <td className={m.pass ? 'okc' : 'alarmc'}>{m.pass ? '✓' : '✗'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {r.series.length > 0 && <MiniPlot series={r.series} />}
                <div className="note">
                  {r.notes} ({r.durationMs.toFixed(0)} ms)
                </div>
              </>
            )}
          </Panel>
        );
      })}
    </div>
  );
}
