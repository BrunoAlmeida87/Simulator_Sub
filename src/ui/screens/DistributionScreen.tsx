/** Propulsão e energia › Distribuição: disjuntores por carga, rejeição automática e temperatura da bateria. */
import { cmd, useSim } from '../store';
import { Panel } from '../components/Panel';
import { KV, LevelRow, OnOff, Toggle } from '../components/StatusBits';
import { BREAKER_IDS } from '../../sim/core/extState';
import { BREAKER_LABEL } from '../../sim/systems/distribution';
import { defaultDistribution } from '../../sim/config/extSystems';
import { fmt, fmtPower } from '../format';

export function DistributionScreen() {
  const e = useSim(4);
  const s = e.state;
  const d = s.distribution;
  if (!d) return <div className="panel">Distribuição indisponível.</div>;
  const cfg = e.vessel.distribution ?? defaultDistribution();
  const el = s.electrical;
  return (
    <div className="grid">
      <Panel title="Quadro de distribuição" className="span-all">
        <div className="btnrow">
          <Toggle on={d.autoShed} onClick={() => cmd({ type: 'autoShed', on: !d.autoShed })} title="Abre o disjuntor da carga de menor prioridade quando falta energia">
            Rejeição automática de cargas
          </Toggle>
          <OnOff on={d.autoShed} onText="ATIVA" offText="DESLIGADA" />
          {d.shed.length > 0 && (
            <button className="btn sm" onClick={() => cmd({ type: 'autoShed', restore: true })}>
              Religar rejeitadas ({d.shed.join(', ')})
            </button>
          )}
          <span className="subtle">
            Barramento {el.energized ? 'energizado' : 'DESENERGIZADO'} · demanda {fmtPower(el.totalLoad)} · não atendida {fmtPower(el.unservedPower ?? 0)}
          </span>
        </div>
        <div className="p3-scroll">
          <table className="t p3-table">
            <thead>
              <tr>
                <th>Carga</th>
                <th>Prioridade</th>
                <th>Consumo</th>
                <th>Disjuntor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {BREAKER_IDS.map((id) => {
                const closed = d.breakers[id];
                return (
                  <tr key={id}>
                    <td>
                      <b>{id}</b> <span className="subtle">{BREAKER_LABEL[id]}</span>
                    </td>
                    <td className="num">{cfg.priority[id] === 1 ? '1 (nunca rejeitar)' : cfg.priority[id]}</td>
                    <td className="num">{fmtPower(el.loads[id] ?? 0)}</td>
                    <td>
                      <OnOff on={closed} onText="FECHADO" offText={d.shed.includes(id) ? 'REJEITADO' : 'ABERTO'} />
                    </td>
                    <td>
                      <Toggle on={!closed} onClick={() => cmd({ type: 'loadBreaker', id, closed: !closed })}>
                        {closed ? 'Abrir' : 'Fechar'}
                      </Toggle>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="subtle">
          Disjuntor aberto: o equipamento fica sem energia (bombas param, o motor perde o torque, a hidráulica deixa de recarregar) e a carga sai do balanço. NAV
          alimenta também o sonar. A rejeição automática só age com o barramento energizado e sobrecarregado.
        </p>
      </Panel>
      <Panel title="Temperatura da bateria">
        <LevelRow label="Temperatura" value={d.batteryTemp} unit="°C" digits={1} min={10} max={65} warn={cfg.battery.warnTemp} alarm={cfg.battery.critTemp} />
        <KV
          rows={[
            ['Corrente', `${fmt(el.current, 0)} A ${el.current < 0 ? '(recarga)' : '(descarga)'}`],
            ['Calor gerado I²R', fmtPower(d.batteryHeat)],
            ['Troca com o mar', `${fmt(cfg.battery.cooling / 1000, 1)} kW/K`],
            ['Constante de tempo', `${fmt(cfg.battery.heatCapacity / cfg.battery.cooling / 3600, 1)} h`],
          ]}
        />
        <p className="subtle">Indicação e alarme: a temperatura não altera a tensão nem a capacidade nesta versão (ver Limitações).</p>
      </Panel>
    </div>
  );
}
