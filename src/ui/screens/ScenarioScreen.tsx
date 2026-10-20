/** Cenários de treinamento (condições iniciais). Parâmetros e sessões ficam em Configurações. */
import { baseConfig, runner, useSim } from '../store';
import { Panel } from '../components/Panel';
import { SCENARIOS, LOAD_LABELS, buildScenario, type LoadCondition } from '../../sim/scenarios';
import { useUi } from '../uiContext';
import { usePersisted } from '../persist';

/** condição de carga escolhida (também usada ao reiniciar pelas Configurações) */
export function useScenarioOptions() {
  const [load, setLoad] = usePersisted<LoadCondition>('scenario.load', 'normal');
  const [pre, setPre] = usePersisted('scenario.precompensated', true);
  return { load, setLoad, pre, setPre };
}

export function ScenarioScreen() {
  const e = useSim(2);
  const ui = useUi();
  const { load, setLoad, pre, setPre } = useScenarioOptions();

  const start = (id: string) => {
    runner.running = false;
    runner.replaceEngine(buildScenario(id, baseConfig(), { load, precompensated: pre }));
    ui.toast(`Cenário carregado (pausado). Pressione ▶ para iniciar.`);
    ui.setScreen('comando');
  };
  return (
    <div className="grid g2">
      <Panel title="Cenários de treinamento" className="span-all">
        <div className="row mb8">
          <label className="field">
            <span>Condição de carga</span>
            <select value={load} onChange={(ev) => setLoad(ev.target.value as LoadCondition)}>
              {(Object.keys(LOAD_LABELS) as LoadCondition[]).map((k) => (
                <option key={k} value={k}>
                  {LOAD_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="chk">
            <input type="checkbox" checked={pre} onChange={(ev) => setPre(ev.target.checked)} />
            Compensação pré-calculada para a carga real
          </label>
          <span className="subtle">Desmarque para iniciar com a compensação da condição de projeto (o operador precisa corrigir).</span>
          <button className="btn sm" onClick={() => ui.setScreen('config')} title="Ambiente, fundo, parâmetros da embarcação, identificação, gráficos e sessões salvas">
            ⚙ Configurações e sessões salvas
          </button>
        </div>
        <div className="grid">
          {SCENARIOS.map((s) => (
            <div className="panel" key={s.id}>
              <header>
                <h3>{s.name}</h3>
              </header>
              <div className="body col">
                <div className="subtle">{s.description}</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {s.objectives.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
                <button className={`btn ${e.state.scenarioId === s.id ? 'on' : ''}`} onClick={() => start(s.id)}>
                  Iniciar cenário
                </button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
