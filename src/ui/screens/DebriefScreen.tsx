/** Análise › Instrutor › Debriefing: avaliação pós-exercício (alarmes, reações, limites) e relatório em texto. */
import { runner, useSim } from '../store';
import { Panel } from '../components/Panel';
import { KV, ToneBadge } from '../components/StatusBits';
import { prioBadge, prioText } from '../alarmUi';
import { buildDebrief, debriefText } from '../debrief';
import { downloadText } from '../storage';
import { fmt, fmtTime } from '../format';

export function DebriefScreen() {
  const e = useSim(1);
  const r = buildDebrief(e.vessel, e.state, runner.history);
  const scen = e.state.scenarioId;
  const tone = r.score >= 85 ? '' : r.score >= 60 ? 'warn' : 'alarm';
  return (
    <div className="grid">
      <Panel
        title="Resumo do exercício"
        right={
          <button className="btn sm" onClick={() => downloadText(`debriefing-${scen}-${Math.round(e.state.t)}s.txt`, debriefText(r, `${scen} · t = ${fmtTime(e.state.t)}`), 'text/plain')}>
            Baixar relatório (.txt)
          </button>
        }
      >
        <div className="btnrow">
          <b style={{ fontSize: 28 }}>{r.score}</b>
          <span className="subtle">/ 100 (nota indicativa)</span>
          <ToneBadge tone={tone} text={r.score >= 85 ? 'BOM' : r.score >= 60 ? 'REVISAR' : 'CRÍTICO'} />
        </div>
        <ul className="subtle" style={{ paddingLeft: 18, margin: '4px 0' }}>
          {r.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
        <KV
          rows={[
            ['Duração simulada', fmtTime(r.duration)],
            ['Profundidade máxima', `${fmt(r.maxDepth, 1)} m`],
            ['Pitch / banda máximos', `${fmt(r.maxPitch, 1)}° / ${fmt(r.maxRoll, 1)}°`],
            ['Erro RMS de cota (piloto em AUTO)', r.depthRms !== null ? `${fmt(r.depthRms, 2)} m` : '—'],
            ['Além da profundidade operacional', `${fmt(r.overOperating, 0)} s`],
            ['Reconhecimento de alarmes', r.ackMean !== null ? `média ${fmt(r.ackMean, 1)} s · pior ${fmt(r.ackMax ?? 0, 0)} s` : '—'],
          ]}
        />
        <p className="subtle">Calculado do registro de alarmes, dos comandos e do histórico (1 amostra/s). Use junto com a tela Histórico (gráficos) e a gravação de comandos.</p>
      </Panel>
      <Panel title={`Eventos do instrutor (${r.events.length})`}>
        {r.events.length === 0 ? (
          <p className="subtle">Nenhum evento disparado. Programe-os em Instrutor.</p>
        ) : (
          <div className="p3-scroll">
            <table className="t p3-table">
              <thead>
                <tr>
                  <th>Instante</th>
                  <th>Evento</th>
                  <th>Reação</th>
                </tr>
              </thead>
              <tbody>
                {r.events.map((ev, i) => (
                  <tr key={i}>
                    <td className="num">{fmtTime(ev.fired)}</td>
                    <td>{ev.label}</td>
                    <td>{ev.reaction !== null ? <span title={ev.firstCommand ?? ''}>{fmt(ev.reaction, 0)} s — {ev.firstCommand}</span> : <ToneBadge tone="warn" text="SEM REAÇÃO" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title={`Alarmes (${r.alarms.length})`} className="span-all">
        {r.alarms.length === 0 ? (
          <p className="subtle">Nenhum alarme registrado.</p>
        ) : (
          <div className="p3-scroll" style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table className="t p3-table">
              <thead>
                <tr>
                  <th>Instante</th>
                  <th>Prioridade</th>
                  <th>Alarme</th>
                  <th>Reconhecido</th>
                </tr>
              </thead>
              <tbody>
                {r.alarms
                  .slice()
                  .reverse()
                  .map((a, i) => (
                    <tr key={i}>
                      <td className="num">{fmtTime(a.raised)}</td>
                      <td>
                        <span className={`badge ${prioBadge(a.priority)}`}>{prioText(a.priority)}</span>
                      </td>
                      <td>{a.text}</td>
                      <td className="num">{a.acked !== null ? `em ${fmt(a.acked - a.raised, 0)} s` : '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
