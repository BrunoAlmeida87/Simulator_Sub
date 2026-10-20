/** Cenários, configuração de parâmetros e salvamento de estados. */
import { useRef, useState } from 'react';
import { baseConfig, runner, useSim } from '../store';
import { Panel } from '../components/Panel';
import { SCENARIOS, LOAD_LABELS, buildScenario, type LoadCondition } from '../../sim/scenarios';
import { defaultSimConfig } from '../../sim/config/defaultVessel';
import type { SimConfig } from '../../sim/config/types';
import { SimulationEngine } from '../../sim/core/engine';
import { parseSaveText, saveToText, type SaveFile } from '../../sim/persistence';
import { captureSession, restoreSession, sessionFileName } from '../session';
import { storage, downloadText } from '../storage';
import { useUi } from '../uiContext';
import { fmtTime } from '../format';

interface Param {
  label: string;
  unit: string;
  get: (c: SimConfig) => number;
  set: (c: SimConfig, v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}

const ENV_PARAMS: Param[] = [
  { label: 'Salinidade superficial', unit: 'PSU', get: (c) => c.environment.salinity, set: (c, v) => (c.environment.salinity = v), step: 0.1, min: 0, max: 42 },
  { label: 'Salinidade profunda', unit: 'PSU', get: (c) => c.environment.deepSalinity, set: (c, v) => (c.environment.deepSalinity = v), step: 0.1, min: 0, max: 42 },
  { label: 'Temperatura superficial', unit: '°C', get: (c) => c.environment.surfaceTemperature, set: (c, v) => (c.environment.surfaceTemperature = v), step: 0.5, min: -2, max: 35 },
  { label: 'Temperatura profunda', unit: '°C', get: (c) => c.environment.deepTemperature, set: (c, v) => (c.environment.deepTemperature = v), step: 0.5, min: -2, max: 35 },
  { label: 'Profundidade da termoclina', unit: 'm', get: (c) => c.environment.thermoclineDepth, set: (c, v) => (c.environment.thermoclineDepth = v), step: 5, min: 0, max: 1000 },
  { label: 'Espessura da termoclina', unit: 'm', get: (c) => c.environment.thermoclineThickness, set: (c, v) => (c.environment.thermoclineThickness = v), step: 1, min: 1, max: 500 },
  { label: 'Fundo na origem', unit: 'm', get: (c) => c.environment.bottom.baseDepth, set: (c, v) => (c.environment.bottom.baseDepth = v), step: 10, min: 20, max: 2900 },
  { label: 'Declividade para o Norte', unit: 'm/km', get: (c) => c.environment.bottom.slopeNorth, set: (c, v) => (c.environment.bottom.slopeNorth = v), step: 1 },
  { label: 'Declividade para o Leste', unit: 'm/km', get: (c) => c.environment.bottom.slopeEast, set: (c, v) => (c.environment.bottom.slopeEast = v), step: 1 },
  { label: 'Rugosidade do relevo', unit: 'm', get: (c) => c.environment.bottom.roughness, set: (c, v) => (c.environment.bottom.roughness = v), step: 1, min: 0, max: 300 },
  { label: 'Comprimento de onda do relevo', unit: 'm', get: (c) => c.environment.bottom.wavelength, set: (c, v) => (c.environment.bottom.wavelength = v), step: 50, min: 100, max: 20000 },
  { label: 'Estado do mar (0–6)', unit: '', get: (c) => c.environment.waves?.seaState ?? 0, set: (c, v) => (c.environment.waves = { seed: 4242, direction: 60, ...c.environment.waves, seaState: Math.round(v) }), step: 1, min: 0, max: 6 },
  { label: 'Direção das ondas (para onde vão)', unit: '°', get: (c) => c.environment.waves?.direction ?? 60, set: (c, v) => (c.environment.waves = { seed: 4242, seaState: 3, ...c.environment.waves, direction: v }), step: 10, min: 0, max: 359 },
  { label: 'Declinação magnética', unit: '°', get: (c) => c.environment.magneticDeclination, set: (c, v) => (c.environment.magneticDeclination = v), step: 0.5, min: -60, max: 60 },
];

const VESSEL_PARAMS: Param[] = [
  { label: 'BG de projeto', unit: 'm', get: (c) => c.vessel.mass.designBG, set: (c, v) => (c.vessel.mass.designBG = v), step: 0.02, min: 0.05, max: 1.5 },
  { label: 'Compressibilidade do casco', unit: '×10⁻¹⁰/Pa', get: (c) => c.vessel.hull.compressibility * 1e10, set: (c, v) => (c.vessel.hull.compressibility = v * 1e-10), step: 0.2, min: 0, max: 20 },
  { label: 'Coef. de resistência C_t', unit: '', get: (c) => c.vessel.hydro.totalResistanceCoeff, set: (c, v) => (c.vessel.hydro.totalResistanceCoeff = v), step: 0.0001, min: 0.0005, max: 0.02 },
  { label: 'Coef. de escoamento cruzado', unit: '', get: (c) => c.vessel.hydro.crossflowDrag, set: (c, v) => (c.vessel.hydro.crossflowDrag = v), step: 0.05, min: 0.1, max: 2 },
  { label: 'Fator do momento de Munk', unit: '', get: (c) => c.vessel.hydro.munkFactor, set: (c, v) => (c.vessel.hydro.munkFactor = v), step: 0.05, min: 0, max: 1.2 },
  { label: 'Reação do torque do eixo (banda)', unit: '×', get: (c) => c.vessel.hydro.propTorqueRollFactor, set: (c, v) => (c.vessel.hydro.propTorqueRollFactor = v), step: 0.1, min: 0, max: 1 },
  { label: 'Potência nominal do motor', unit: 'MW', get: (c) => c.vessel.propulsion.motor.ratedPower / 1e6, set: (c, v) => (c.vessel.propulsion.motor.ratedPower = v * 1e6), step: 0.1, min: 0.2, max: 10 },
  { label: 'Rampa de rotação', unit: 'rpm/s', get: (c) => c.vessel.propulsion.motor.rpmRampRate, set: (c, v) => (c.vessel.propulsion.motor.rpmRampRate = v), step: 1, min: 0.5, max: 60 },
  { label: 'Capacidade da bateria', unit: 'Ah', get: (c) => c.vessel.electrical.battery.capacityAh, set: (c, v) => (c.vessel.electrical.battery.capacityAh = v), step: 500, min: 500, max: 50000 },
  { label: 'Vazão da bomba de compensação', unit: 'L/s', get: (c) => c.vessel.compensation.pump.ratedFlow * 1000, set: (c, v) => (c.vessel.compensation.pump.ratedFlow = v / 1000), step: 1, min: 1, max: 60 },
  { label: 'Pressão de shutoff da bomba BC', unit: 'bar', get: (c) => c.vessel.compensation.pump.shutoffPressure / 1e5, set: (c, v) => (c.vessel.compensation.pump.shutoffPressure = v * 1e5), step: 5, min: 5, max: 200 },
  { label: 'Limitador de admissão', unit: 'L/s', get: (c) => c.vessel.compensation.inletRegulatorFlow * 1000, set: (c, v) => (c.vessel.compensation.inletRegulatorFlow = v / 1000), step: 1, min: 1, max: 100 },
  { label: 'Vazão da bomba de trim', unit: 'L/s', get: (c) => c.vessel.trim.pump.ratedFlow * 1000, set: (c, v) => (c.vessel.trim.pump.ratedFlow = v / 1000), step: 1, min: 1, max: 60 },
  { label: 'Vazão da bomba de banda', unit: 'L/s', get: (c) => c.vessel.heel.pump.ratedFlow * 1000, set: (c, v) => (c.vessel.heel.pump.ratedFlow = v / 1000), step: 1, min: 1, max: 60 },
  { label: 'Área dos suspiros dos TLP (escala)', unit: '×', get: (c) => c.vessel.ballast.tanks[0].ventArea / 0.035, set: (c, v) => c.vessel.ballast.tanks.forEach((t, i) => (t.ventArea = (i < 2 ? 0.035 : 0.028) * v)), step: 0.1, min: 0.1, max: 5 },
  { label: 'Orifício de sopro (escala)', unit: '×', get: (c) => c.vessel.ballast.tanks[0].blowArea / 3e-4, set: (c, v) => c.vessel.ballast.tanks.forEach((t, i) => (t.blowArea = (i < 2 ? 3e-4 : 2.5e-4) * v)), step: 0.1, min: 0.1, max: 5 },
  { label: 'Pressão inicial das garrafas AP', unit: 'bar', get: (c) => c.vessel.hpAir.banks[0].initialPressure / 1e5, set: (c, v) => c.vessel.hpAir.banks.forEach((b) => (b.initialPressure = Math.min(b.maxPressure, v * 1e5))), step: 10, min: 10, max: 250 },
  { label: 'Velocidade dos lemes de vante', unit: '°/s', get: (c) => c.vessel.fins.find((f) => f.id === 'bow')!.rate, set: (c, v) => (c.vessel.fins.find((f) => f.id === 'bow')!.rate = v), step: 0.5, min: 0.5, max: 20 },
  { label: 'Velocidade dos lemes de ré', unit: '°/s', get: (c) => c.vessel.fins.find((f) => f.id === 'stern')!.rate, set: (c, v) => (c.vessel.fins.find((f) => f.id === 'stern')!.rate = v), step: 0.5, min: 0.5, max: 20 },
  { label: 'Velocidade do leme de direção', unit: '°/s', get: (c) => c.vessel.fins.find((f) => f.id === 'rudder')!.rate, set: (c, v) => (c.vessel.fins.find((f) => f.id === 'rudder')!.rate = v), step: 0.5, min: 0.5, max: 20 },
  { label: 'Batente lemes horizontais', unit: '°', get: (c) => c.vessel.fins.find((f) => f.id === 'stern')!.maxDeflection, set: (c, v) => c.vessel.fins.filter((f) => f.id === 'stern' || f.id === 'bow').forEach((f) => (f.maxDeflection = v)), step: 1, min: 5, max: 40 },
  { label: 'Batente leme de direção', unit: '°', get: (c) => c.vessel.fins.find((f) => f.id === 'rudder')!.maxDeflection, set: (c, v) => (c.vessel.fins.find((f) => f.id === 'rudder')!.maxDeflection = v), step: 1, min: 5, max: 40 },
  { label: 'Limite operacional (fictício)', unit: 'm', get: (c) => c.vessel.limits.operatingDepth, set: (c, v) => (c.vessel.limits.operatingDepth = v), step: 10, min: 20, max: 2000 },
  { label: 'Limite de teste (fictício)', unit: 'm', get: (c) => c.vessel.limits.testDepth, set: (c, v) => (c.vessel.limits.testDepth = v), step: 10, min: 20, max: 2000 },
  { label: 'Pitch máximo (alarme)', unit: '°', get: (c) => c.vessel.limits.maxPitch, set: (c, v) => (c.vessel.limits.maxPitch = v), step: 1, min: 1, max: 45 },
  { label: 'Banda máxima (alarme)', unit: '°', get: (c) => c.vessel.limits.maxRoll, set: (c, v) => (c.vessel.limits.maxRoll = v), step: 1, min: 1, max: 45 },
  { label: 'Velocidade vertical máxima', unit: 'm/s', get: (c) => c.vessel.limits.maxVerticalSpeed, set: (c, v) => (c.vessel.limits.maxVerticalSpeed = v), step: 0.1, min: 0.1, max: 10 },
  { label: 'Altitude mínima (alerta)', unit: 'm', get: (c) => c.vessel.limits.minAltitudeWarn, set: (c, v) => (c.vessel.limits.minAltitudeWarn = v), step: 5, min: 1, max: 500 },
  { label: 'Ruído do profundímetro σ', unit: 'm', get: (c) => c.vessel.sensors.depth, set: (c, v) => (c.vessel.sensors.depth = v), step: 0.01, min: 0, max: 5 },
];

function ParamGrid({ params, cfg, onChange }: { params: Param[]; cfg: SimConfig; onChange: () => void }) {
  return (
    <div className="formgrid">
      {params.map((p) => (
        <label className="field" key={p.label}>
          <span>
            {p.label} {p.unit && `(${p.unit})`}
          </span>
          <input
            type="number"
            step={p.step}
            min={p.min}
            max={p.max}
            value={Number(p.get(cfg).toPrecision(6))}
            onChange={(ev) => {
              const v = Number(ev.target.value);
              if (Number.isFinite(v)) {
                p.set(cfg, p.min !== undefined ? Math.max(p.min, p.max !== undefined ? Math.min(p.max, v) : v) : v);
                onChange();
              }
            }}
            style={{ width: '100%' }}
          />
        </label>
      ))}
    </div>
  );
}

export function ScenarioScreen() {
  const e = useSim(2);
  const ui = useUi();
  const [load, setLoad] = useState<LoadCondition>('normal');
  const [pre, setPre] = useState(true);
  const [draft, setDraft] = useState<SimConfig>(() => structuredClone(baseConfig()));
  const [, bump] = useState(0);
  const [saveName, setSaveName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const saves = storage.listSaves();
  const auto = storage.getAutosave();

  const start = (id: string) => {
    runner.running = false;
    runner.replaceEngine(buildScenario(id, baseConfig(), { load, precompensated: pre }));
    ui.toast(`Cenário carregado (pausado). Pressione ▶ para iniciar.`);
    ui.setScreen('comando');
  };
  const applyEnvNow = () => {
    const cfg = structuredClone(e.config);
    cfg.environment = structuredClone(draft.environment);
    const ne = new SimulationEngine(cfg, structuredClone(e.state));
    ne.log('Ambiente alterado (salinidade/temperatura/fundo) — estado mantido', 'Configuração');
    runner.replaceEngine(ne, true);
    ui.toast('Ambiente aplicado ao estado atual.');
  };
  const applyAll = () => {
    storage.setConfig(draft);
    runner.running = false;
    runner.replaceEngine(buildScenario(e.state.scenarioId, structuredClone(draft), { load, precompensated: pre }));
    ui.toast('Parâmetros salvos e cenário reiniciado.');
  };
  const loadSave = (f: SaveFile) => {
    try {
      const r = restoreSession(f);
      ui.toast(`Estado "${r.name}" recuperado (t = ${fmtTime(r.simTime)}), pausado.${r.resumed.length ? ` Em andamento: ${r.resumed.join(', ')}.` : ''}`);
    } catch (ex) {
      ui.toast('Falha ao carregar: ' + (ex instanceof Error ? ex.message : String(ex)));
    }
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
      <Panel title="Salvar e recuperar estados">
        <div className="row">
          <input type="text" placeholder="Nome do estado" value={saveName} onChange={(ev) => setSaveName(ev.target.value)} style={{ flex: 1 }} />
          <button
            className="btn"
            onClick={() => {
              const ok = storage.addSave(captureSession(saveName || `Estado t=${fmtTime(e.state.t)}`));
              ui.toast(ok ? 'Estado salvo no navegador.' : 'Armazenamento local indisponível — use Exportar.');
              setSaveName('');
              bump((x) => x + 1);
            }}
          >
            Salvar
          </button>
          <button className="btn" onClick={() => downloadText(sessionFileName(saveName || 'exportado', e.state.t), saveToText(captureSession(saveName || 'exportado')))}>
            Exportar arquivo
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Importar arquivo
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={async (ev) => {
              const f = ev.target.files?.[0];
              if (!f) return;
              try {
                loadSave(parseSaveText(await f.text()));
              } catch (ex) {
                ui.toast('Arquivo inválido: ' + String(ex));
              }
              ev.target.value = '';
            }}
          />
        </div>
        {auto && (
          <div className="row mt8">
            <span className="subtle">
              Salvamento automático: t = {fmtTime(auto.simTime)} ({new Date(auto.savedAt).toLocaleString('pt-BR')})
            </span>
            <button className="btn sm" onClick={() => loadSave(auto)}>
              Retomar
            </button>
          </div>
        )}
        <table className="t mt8">
          <tbody>
            {saves.length === 0 && (
              <tr>
                <td className="subtle">Nenhum estado salvo.</td>
              </tr>
            )}
            {saves.map((f) => (
              <tr key={f.savedAt}>
                <td>
                  <b>{f.name}</b>
                  <div className="subtle">
                    {new Date(f.savedAt).toLocaleString('pt-BR')} · cenário {f.scenarioId} · t = {fmtTime(f.simTime)}
                  </div>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={() => loadSave(f)}>
                    Carregar
                  </button>{' '}
                  <button className="btn sm" onClick={() => downloadText(sessionFileName(f.name, f.simTime), saveToText(f))}>
                    Exportar
                  </button>{' '}
                  <button
                    className="btn sm danger"
                    onClick={() => {
                      storage.deleteSave(f.savedAt);
                      bump((x) => x + 1);
                    }}
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="note">Salvo no armazenamento local deste navegador (até 12 estados + salvamento automático a cada 20 s). O arquivo exportado contém a configuração completa e o estado físico.</div>
      </Panel>
      <Panel title="Simulação">
        <div className="formgrid">
          <label className="field">
            <span>Passo fixo de integração</span>
            <select
              value={draft.settings.dt}
              onChange={(ev) => {
                draft.settings.dt = Number(ev.target.value);
                bump((x) => x + 1);
              }}
            >
              <option value={0.01}>0,01 s (100 Hz)</option>
              <option value={0.02}>0,02 s (50 Hz) — padrão</option>
              <option value={0.05}>0,05 s (20 Hz)</option>
            </select>
          </label>
          <label className="field">
            <span>Semente do ruído</span>
            <input
              type="number"
              value={draft.settings.seed}
              onChange={(ev) => {
                draft.settings.seed = Number(ev.target.value) | 0;
                bump((x) => x + 1);
              }}
            />
          </label>
          <label className="chk">
            <input
              type="checkbox"
              checked={draft.settings.advancedInstrumentation}
              onChange={(ev) => {
                draft.settings.advancedInstrumentation = ev.target.checked;
                bump((x) => x + 1);
              }}
            />
            Instrumentação avançada (ruído/atraso)
          </label>
        </div>
        <div className="note">Passo e semente valem ao reiniciar. Atual: dt = {e.config.settings.dt} s.</div>
      </Panel>
      <Panel title="Ambiente oceânico" right={<button className="btn sm" onClick={applyEnvNow}>Aplicar agora (mantém o estado)</button>}>
        <ParamGrid params={ENV_PARAMS} cfg={draft} onChange={() => bump((x) => x + 1)} />
        <div className="note">Densidade calculada pela EOS-80 a partir de S, T e pressão. A termoclina cria camadas de densidade que alteram o empuxo.</div>
      </Panel>
      <Panel title="Parâmetros fictícios da embarcação" right={<button className="btn sm" onClick={applyAll}>Salvar e reiniciar</button>}>
        <ParamGrid params={VESSEL_PARAMS} cfg={draft} onChange={() => bump((x) => x + 1)} />
        <div className="row mt8">
          <button className="btn" onClick={applyAll}>
            Salvar como padrão e reiniciar cenário
          </button>
          <button
            className="btn warn"
            onClick={() => {
              storage.clearConfig();
              setDraft(structuredClone(defaultSimConfig()));
              ui.toast('Parâmetros padrão restaurados (aplique para reiniciar).');
            }}
          >
            Restaurar padrões
          </button>
        </div>
        <div className="note">O peso leve e seu CG são recalculados automaticamente para manter a condição de projeto (neutro, trim nulo, BG especificado). Todos os valores são fictícios.</div>
      </Panel>
    </div>
  );
}
