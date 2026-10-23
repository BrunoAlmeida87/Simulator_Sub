/**
 * Biblioteca de cenários: condições iniciais (só posicionam), situações de aula
 * (posicionam e enquadram, pausado) e roteiros automáticos (executam sozinhos).
 * Parâmetros e sessões ficam em Configurações.
 */
import { useMemo } from 'react';
import { baseConfig, runner, useSim } from '../store';
import { Panel } from '../components/Panel';
import { TourList } from '../components/TourCard';
import { SCENARIOS, LOAD_LABELS, buildScenario, type LoadCondition } from '../../sim/scenarios';
import { pres, PRESETS } from '../presentation';
import { useUi } from '../uiContext';
import { usePersisted } from '../persist';
import { presLibrary } from '../presBuilder/library';
import { presPlayer } from '../presBuilder/player';
import { isPanelWindow } from '../sync';

/** condição de carga escolhida (também usada ao reiniciar pelas Configurações) */
export function useScenarioOptions() {
  const [load, setLoad] = usePersisted<LoadCondition>('scenario.load', 'normal');
  const [pre, setPre] = usePersisted('scenario.precompensated', true);
  return { load, setLoad, pre, setPre };
}

/** o cenário liga a costa? (os que não fixam a costa seguem o que está em Configurações) */
function coastOf(id: string): boolean {
  const c = baseConfig();
  SCENARIOS.find((s) => s.id === id)?.env?.(c);
  return !!c.environment.geo?.coast;
}

function Badges({ kind, coast }: { kind: string; coast: boolean }) {
  return (
    <div className="row" style={{ gap: 4 }}>
      <span className="badge info">{kind}</span>
      <span className={`badge ${coast ? 'ok' : 'off'}`} title={coast ? 'Terra, orla e estruturas do litoral aparecem no 3D e no fundo' : 'Sem terra por perto (a costa pode ser ligada em Configurações)'}>
        {coast ? 'com costa' : 'mar aberto'}
      </span>
    </div>
  );
}

export function ScenarioScreen() {
  const e = useSim(2);
  const ui = useUi();
  const { load, setLoad, pre, setPre } = useScenarioOptions();
  // calculado ao abrir a aba (a costa pode mudar em Configurações)
  const coast = useMemo(() => Object.fromEntries(SCENARIOS.map((s) => [s.id, coastOf(s.id)])), []);
  const scenarioName = (id: string) => SCENARIOS.find((s) => s.id === id)?.name ?? id;

  const start = (id: string) => {
    runner.running = false;
    runner.replaceEngine(buildScenario(id, baseConfig(), { load, precompensated: pre }));
    ui.toast(`Cenário carregado (pausado). Pressione ▶ para iniciar.`);
    ui.setScreen('comando');
  };
  const openSituation = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    pres.prepare(runner, p);
    ui.toast(`Situação de aula preparada (pausado). Pressione ▶ Executar.`);
    ui.setScreen('apresentacao');
  };
  return (
    <div className="grid g2">
      <Panel title="Biblioteca de cenários" className="span-all">
        <div className="lib-kinds">
          <div>
            <span className="badge info">só posiciona</span> <b>Condição inicial</b>
            <div className="subtle">Coloca o navio numa situação de partida (local, cota, velocidade, carga) e para. O operador conduz.</div>
          </div>
          <div>
            <span className="badge info">posiciona e enquadra</span> <b>Situação de aula</b>
            <div className="subtle">Parte de uma condição inicial e já ajusta mar, câmera e camadas para explicar um tema. Abre na Apresentação, pausado.</div>
          </div>
          <div>
            <span className="badge info">executa sozinho</span> <b>Roteiro automático</b>
            <div className="subtle">O simulador conduz a operação etapa por etapa, com narração e valores ao vivo.</div>
          </div>
          <div>
            <span className="badge info">você cria</span> <b>Apresentação do Estúdio</b>
            <div className="subtle">Etapas montadas por você: texto formatado, câmera e camadas, ações e gatilhos para avançar. Criadas e editadas em Apresentação › Estúdio.</div>
          </div>
        </div>
      </Panel>

      <Panel title="Condições iniciais" className="span-all">
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
                <Badges kind="só posiciona" coast={coast[s.id]} />
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

      <Panel title="Situações de aula" className="span-all">
        <div className="subtle mb8">Também podem ser escolhidas na própria Apresentação. Usam a condição de carga de projeto.</div>
        <div className="grid">
          {PRESETS.map((x) => (
            <div className="panel" key={x.id}>
              <header>
                <h3>{x.name}</h3>
              </header>
              <div className="body col">
                <Badges kind="posiciona e enquadra" coast={coast[x.scenario] ?? false} />
                <div className="subtle">{x.note}</div>
                <div className="subtle">Parte de: {scenarioName(x.scenario)}</div>
                <button className="btn" onClick={() => openSituation(x.id)}>
                  ▶ Abrir na Apresentação
                </button>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Roteiros automáticos" className="span-all">
        <TourList goTo extra={(tr) => <Badges kind="executa sozinho" coast={coast[tr.scenario] ?? false} />} />
      </Panel>

      <Panel
        title="Apresentações do Estúdio"
        className="span-all"
        right={
          <button className="btn sm" onClick={() => ui.setScreen('estudio')} title="Criar e editar apresentações">
            ✎ Abrir o Estúdio
          </button>
        }
      >
        <div className="grid">
          {[...presLibrary.mine(), ...presLibrary.builtins()].map((p) => (
            <div className="panel" key={p.id}>
              <header>
                <h3>{p.name}</h3>
              </header>
              <div className="body col">
                <Badges kind={p.builtin ? 'modelo' : 'você cria'} coast={p.start.mode === 'cenario' ? (coast[p.start.scenario] ?? false) : false} />
                {p.description && <div className="subtle">{p.description}</div>}
                <div className="subtle">
                  {p.steps.length} etapas · parte de: {p.start.mode === 'cenario' ? scenarioName(p.start.scenario) : p.start.mode === 'estado' ? 'estado guardado' : 'situação atual'}
                </div>
                <button
                  className="btn"
                  disabled={isPanelWindow}
                  title={isPanelWindow ? 'Apresente pela janela principal' : undefined}
                  onClick={() => {
                    if (presPlayer.start(runner, p)) ui.setScreen('estudio');
                  }}
                >
                  ▶ Apresentar
                </button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
