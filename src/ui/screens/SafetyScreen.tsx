/** Tela 5 — Segurança: alarmes, registro, sensores e injeção de falhas. */
import { useMemo, useState } from 'react';
import { cmd, useSim } from '../store';
import { Panel } from '../components/Panel';
import { ALARM_DEFS, PRIORITY_LABEL, visibleAlarms } from '../../sim/systems/alarms';
import { SENSOR_DEFS } from '../../sim/systems/sensors';
import { failureCatalog, isFailureActive } from '../../sim/commands';
import { fmt, fmtTime } from '../format';
import type { SensorFailMode } from '../../sim/core/state';
import { isPanelWindow } from '../sync';

export function SafetyScreen() {
  const e = useSim(6);
  const s = e.state;
  const vis = visibleAlarms(s);
  const [filter, setFilter] = useState<'todos' | 'alarmes' | 'comandos'>('todos');
  const catalog = useMemo(() => failureCatalog(e), [e]);
  const [params, setParams] = useState<Record<string, string>>({});
  const groups = Array.from(new Set(catalog.map((c) => c.group)));
  const log = [
    ...(filter !== 'comandos' ? s.alarms.log.map((a) => ({ t: a.t, kind: 'alarm' as const, prio: a.priority, text: `${a.event}: ${a.text}` })) : []),
    ...(filter !== 'alarmes' ? s.commands.map((c) => ({ t: c.t, kind: 'cmd' as const, prio: 5, text: `[${c.group}] ${c.text}` })) : []),
  ]
    .sort((a, b) => b.t - a.t)
    .slice(0, 250);
  const L = e.vessel.limits;
  return (
    <div className="grid g2">
      <Panel title={`Alarmes ativos / não reconhecidos (${vis.length})`} right={<button className="btn sm" onClick={() => cmd({ type: 'ack', id: 'ALL' })}>Reconhecer todos</button>} className="span-all">
        {vis.length === 0 ? (
          <div className="okc">Nenhum alarme ativo.</div>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>Prioridade</th>
                <th>Desde</th>
                <th>Sistema</th>
                <th>Alarme</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {vis.map((a) => (
                <tr key={a.def.id} className={`alarmrow ${a.acked ? '' : 'unack'}`}>
                  <td className={`prio${a.def.priority}`}>
                    <span className={!a.acked && a.active ? 'blink' : ''}>●</span> {PRIORITY_LABEL[a.def.priority]}
                  </td>
                  <td className="num">{fmtTime(a.since)}</td>
                  <td>{a.def.system}</td>
                  <td>{a.def.text}</td>
                  <td>{a.active ? (a.acked ? 'ATIVO · RECONHECIDO' : 'ATIVO') : 'NORMALIZADO'}</td>
                  <td>{!a.acked && <button className="btn sm" onClick={() => cmd({ type: 'ack', id: a.def.id })}>Reconhecer</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="Registro cronológico de eventos" right={<div className="seg">{(['todos', 'alarmes', 'comandos'] as const).map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f}</button>)}</div>}>
        <div className="scroll" style={{ maxHeight: 420 }}>
          <table className="t">
            <tbody>
              {log.map((l, i) => (
                <tr key={i}>
                  <td className="num" style={{ width: 70 }}>
                    {fmtTime(l.t)}
                  </td>
                  <td className={l.kind === 'alarm' ? `prio${l.prio}` : 'mutedc'}>{l.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Sensores e redundância">
        <table className="t">
          <thead>
            <tr>
              <th>Sensor</th>
              <th>Leitura</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {SENSOR_DEFS.map((d) => {
              const st = s.sensors[d.id];
              return (
                <tr key={d.id}>
                  <td>
                    <b>{d.id}</b> {d.name}
                  </td>
                  <td className="num">
                    {fmt(st.value, d.unit === 'bar' ? 2 : 2)} {d.unit}
                  </td>
                  <td>
                    <span className={`badge ${st.failMode !== 'normal' ? 'alarm' : st.valid ? 'ok' : 'warn'}`}>{st.failMode !== 'normal' ? st.failMode.toUpperCase() : st.valid ? 'OK' : 'FORA DE ALCANCE'}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row mt8 subtle">
          <span>
            Divergência PRF-1 × PRF-2: <b className="mono">{fmt(Math.abs(s.sensors.PRF1.value - s.sensors.PRF2.value), 2)} m</b>
          </span>
          <span>
            Erro DR (estimada × real): <b className="mono">{fmt(Math.hypot(s.nav.drNorth - s.body.pos.x, s.nav.drEast - s.body.pos.y), 1)} m</b>
          </span>
        </div>
        <label className="chk mt8">
          <input
            type="checkbox"
            checked={e.config.settings.advancedInstrumentation}
            disabled={isPanelWindow}
            title={isPanelWindow ? 'Ajuste da janela principal' : undefined}
            onChange={(ev) => {
              e.config.settings.advancedInstrumentation = ev.target.checked;
              e.log(`Instrumentação avançada (ruído/atraso): ${ev.target.checked ? 'LIGADA' : 'DESLIGADA'}`, 'Configuração');
            }}
          />
          Modo avançado: ruído e atraso nos sensores
        </label>
      </Panel>
      <Panel title="Injeção de falhas (ambiente controlado)" className="span-all">
        <div className="note">As falhas afetam a física e a lógica: uma bomba em falha não move água, uma válvula travada não muda de posição, sem hidráulica os lemes param, um rombo admite água conforme a pressão externa. Limites e respostas são exclusivamente educacionais.</div>
        <div className="grid">
          {groups.map((g) => (
            <div key={g} className="panel">
              <header>
                <h3>{g}</h3>
              </header>
              <div className="body">
                <table className="t">
                  <tbody>
                    {catalog
                      .filter((c) => c.group === g)
                      .map((c) => {
                        const active = isFailureActive(e, c.target);
                        return (
                          <tr key={c.target} title={c.effect}>
                            <td>{c.name}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {c.param && !active && (
                                <>
                                  <input type="number" style={{ width: 54 }} value={params[c.target] ?? String(c.param.default)} onChange={(ev) => setParams({ ...params, [c.target]: ev.target.value })} /> {c.param.unit}{' '}
                                </>
                              )}
                              {c.modes && !active && (
                                <select value={params[c.target] ?? c.modes[0]} onChange={(ev) => setParams({ ...params, [c.target]: ev.target.value })}>
                                  {c.modes.map((m) => (
                                    <option key={m}>{m}</option>
                                  ))}
                                </select>
                              )}{' '}
                              <button
                                className={`btn sm ${active ? 'danger on' : ''}`}
                                onClick={() =>
                                  cmd({
                                    type: 'failure',
                                    target: c.target,
                                    active: !active,
                                    param: c.modes ? ((params[c.target] ?? c.modes[0]) as SensorFailMode) : c.param ? Number(params[c.target] ?? c.param.default) : undefined,
                                  })
                                }
                              >
                                {active ? 'Remover' : 'Injetar'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Limites fictícios configurados (educacionais)">
        <table className="t">
          <tbody>
            <tr><td>Profundidade operacional</td><td className="num">{L.operatingDepth} m</td></tr>
            <tr><td>Profundidade de teste</td><td className="num">{L.testDepth} m</td></tr>
            <tr><td>Pitch máximo</td><td className="num">{L.maxPitch}°</td></tr>
            <tr><td>Banda máxima</td><td className="num">{L.maxRoll}°</td></tr>
            <tr><td>Velocidade vertical máxima</td><td className="num">{L.maxVerticalSpeed} m/s</td></tr>
            <tr><td>Altitude mínima (alerta / crítica)</td><td className="num">{L.minAltitudeWarn} / {L.minAltitudeCrit} m</td></tr>
          </tbody>
        </table>
        <div className="subtle mt8">Editáveis em Cenários → Parâmetros. Catálogo: {ALARM_DEFS.length} alarmes com prioridade, retardo e registro.</div>
      </Panel>
    </div>
  );
}
