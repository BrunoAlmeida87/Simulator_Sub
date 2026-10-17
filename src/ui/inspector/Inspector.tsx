/** Painel lateral do modo engenharia. */
import { runner, useSim } from '../store';
import { useUi } from '../uiContext';
import { inspectorContent } from './registry';
import { KindTag } from '../components/Readout';
import { MomentExplain, VerticalExplain } from '../components/Explain';
import { StripChart } from '../components/StripChart';
import { CHANNELS } from '../../sim/history';
import { fmt, fmtTime } from '../format';

const COLORS = ['#36c5f0', '#ffb347', '#3ddc84', '#b48cff', '#ff7b54', '#e889ff', '#c9d6e3'];

export function Inspector() {
  const e = useSim(5);
  const ui = useUi();
  const id = ui.inspect ?? 'buoyancy';
  const c = inspectorContent(e, id);
  const last = e.state.commands[e.state.commands.length - 1];
  const h = runner.history;
  return (
    <aside className="inspector">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="badge info">MODO ENGENHARIA</span>
        <button className="btn sm" onClick={() => ui.setInspect(null)}>
          Fechar ✕
        </button>
      </div>
      {!c ? (
        <p className="subtle">Selecione um componente (tanque, válvula, bomba, leme, instrumento) para inspecionar.</p>
      ) : (
        <>
          <h2 className="mt8">{c.title}</h2>
          <h4>Função</h4>
          <div>{c.func}</div>
          <h4>Estado atual</h4>
          <div>
            <b>{c.state}</b>
          </div>
          <h4>Variáveis</h4>
          <table className="t">
            <tbody>
              {c.vars.map((v) => (
                <tr key={v.name}>
                  <td>{v.name}</td>
                  <td className="num">{v.value}</td>
                  <td>
                    <KindTag kind={v.kind} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4>Influência na dinâmica</h4>
          <div>{c.influence}</div>
          <h4>Equações simplificadas</h4>
          {c.equations.map((q) => (
            <div className="eq" key={q}>
              {q}
            </div>
          ))}
          <h4>Consequências previstas</h4>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {c.predictions.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {c.channels && c.channels.length > 0 && (
            <>
              <h4>Antes × depois (últimos minutos; marcas = comandos)</h4>
              <StripChart
                history={h}
                series={c.channels.filter((x) => CHANNELS.some((k) => k.id === x)).slice(0, 4).map((x, i) => ({ id: x, color: COLORS[i] }))}
                window={last ? Math.max(120, e.state.t - last.t + 60) : 300}
                height={120}
                title=""
                markers={e.state.commands.map((x) => ({ t: x.t, text: x.text }))}
                version={h.version}
              />
            </>
          )}
        </>
      )}
      {last && (
        <>
          <h4>Última ação: {fmtTime(last.t)}</h4>
          <div className="subtle">{last.text}</div>
          <table className="t">
            <thead>
              <tr>
                <th>Grandeza</th>
                <th>Antes</th>
                <th>Agora</th>
                <th>Δ</th>
              </tr>
            </thead>
            <tbody>
              {['depth', 'vz', 'pitch', 'roll', 'heading', 'speed', 'net'].map((k) => {
                const ch = CHANNELS.find((x) => x.id === k)!;
                const a = h.valueAt(k, last.t - 1);
                const b = ch.get(e);
                return (
                  <tr key={k}>
                    <td>
                      {ch.label} <span className="subtle">{ch.unit}</span>
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
        </>
      )}
      <h4>Por que sobe ou desce?</h4>
      <VerticalExplain e={e} />
      <h4>Por que muda o pitch?</h4>
      <MomentExplain e={e} axis="pitch" />
      <h4>Por que guina?</h4>
      <MomentExplain e={e} axis="yaw" />
      <h4>Por que aderna?</h4>
      <MomentExplain e={e} axis="roll" />
      <h4>Balanços de verificação</h4>
      <div className="subtle mono">
        Massa interna: erro {fmt(e.outputs.massAudit, 4)} kg · Bateria: erro {fmt(e.outputs.energyAudit, 4)} J
      </div>
    </aside>
  );
}
