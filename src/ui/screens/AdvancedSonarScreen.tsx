import { SourceEditor } from '../../sonar/visualization/SourceEditor';
import { useEffect, useMemo, useState } from 'react';
import { cmd, runner, useSim } from '../store';
import { usePersisted } from '../persist';
import { Panel } from '../components/Panel';
import { Scene3D } from '../components/Scene3D';
import { SceneLayerPanel } from '../components/SceneLayerPanel';
import { defaultLayers, type SceneLayers } from '../../render3d/layers';
import { type SonarSettings, values, clamp } from '../../sonar/types';
import { Waterfall, InstantSpectrum, type DisplayMode } from '../../sonar/display/Waterfall';
import { Aural } from '../../sonar/display/Aural';
import { diagnostic } from '../../sonar/visualization/diagnostic';
import { SONAR_LAYERS } from '../../sonar/visualization/SonarVis';
import { Profile, Section } from '../../sonar/visualization/Section';
import { PRESETS } from '../../sonar/acoustics/environment';
import { LIBRARY } from '../../sonar/sources/signatures';
import { solveTma } from '../../sonar/tma/solve';
import { useGraphics, graphics } from '../graphics';
import type { ViewMode } from '../../render3d/SubmarineScene';

export function AdvancedSonarScreen() {
  const e = useSim(5),
    s = e.state.sonar!,
    cfg = s.settings,
    g = useGraphics();
  const [mode, setMode] = usePersisted<DisplayMode>('sonar.mode', 'broadband');
  const [gain, setGain] = usePersisted('sonar.gain', 0),
    [contrast, setContrast] = usePersisted('sonar.contrast', 1);
  const [seconds, setSeconds] = usePersisted('sonar.seconds', 120),
    [science, setScience] = usePersisted('sonar.science', false);
  const [cursor, setCursor] = useState<number | null>(null),
    [fmin, setFmin] = useState(0),
    [fmax, setFmax] = useState(500);
  const [manual, setManual] = useState(''),
    [replay, setReplay] = useState<number | null>(null),
    [playing, setPlaying] = useState(false),
    [rate, setRate] = useState(1);
  const [camera, setCamera] = useState<ViewMode>('sonar');
  const [savedLayers, setLayers] = usePersisted<Partial<SceneLayers>>('sonar.layers', {
    sonarRays: true,
    sonarWave: true,
    sonarThermocline: true,
    sonarSurface: true,
    sonarBottom: true,
    sonarEchoes: true,
    sonarRulers: true,
    noWater: true,
  });
  const layers = { ...defaultLayers(), ...savedLayers, sonarReplayTime: replay ?? -1 };
  const set = (patch: Partial<SonarSettings>) => cmd({ type: 'sonar', action: 'settings', patch });
  const selected = s.tracks.find((c) => c.id === cfg.selected);
  const solution = useMemo(() => solveTma(selected ? values(selected.history) : []), [selected, s.version]);
  const diag = useMemo(
    () => (science ? (s.ping?.propagation ?? diagnostic(e)) : null),
    [
      e,
      science,
      s.ping,
      Math.floor(e.state.t / 5),
      cfg.section,
      cfg.range,
      cfg.rayCount,
      cfg.homogeneous,
      e.env.cfg.surfaceTemperature,
      e.env.cfg.deepTemperature,
      e.env.cfg.thermoclineDepth,
      e.env.cfg.thermoclineThickness,
      e.env.cfg.salinity,
    ],
  );
  useEffect(() => {
    setReplay(null);
    setPlaying(false);
  }, [s.ping?.start]);
  useEffect(() => {
    if (!playing || !s.ping) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now(),
        dt = (now - last) / 1000;
      last = now;
      setReplay((v) => {
        const next = Math.min(s.ping!.duration, (v ?? 0) + dt * rate);
        if (next >= s.ping!.duration) setPlaying(false);
        return next;
      });
    }, 50);
    return () => clearInterval(id);
  }, [playing, rate, s.ping]);
  const changeMode = (m: DisplayMode) => {
    setMode(m);
    setCursor(null);
  };
  const max = mode === 'broadband' ? 360 : mode === 'demon' ? Math.min(fmax, 128) : fmax;
  const min = mode === 'broadband' ? 0 : Math.min(fmin, max - 1);
  const age = s.ping ? (replay ?? e.state.t - s.ping.start) : null;
  const pingBusy = !!s.ping && e.state.t - s.ping.start < s.ping.duration;
  return (
    <div className="acoustic-console">
      <div className="acoustic-heading">
        <div>
          <span className="acoustic-kicker">SX-1 / SISTEMAS ACÚSTICOS</span>
          <h2>Estação de sonar</h2>
          <p className="subtle">Medições acústicas · assinaturas sintéticas · tempo do simulador</p>
        </div>
        <span className={`badge ${runner.running && cfg.enabled && e.state.electrical.energized ? 'ok' : ''}`}>
          {!cfg.enabled ? 'DESLIGADO' : !e.state.electrical.energized ? 'SEM ENERGIA' : runner.running ? 'EM AQUISIÇÃO' : 'SIMULAÇÃO PAUSADA'}
        </span>
      </div>
      <div className="acoustic-stats">
        <div>
          <small>RUÍDO PRÓPRIO</small>
          <b>
            {s.noise.own.toFixed(1)} <small>dB</small>
          </b>
        </div>
        <div>
          <small>AMBIENTE</small>
          <b>
            {s.noise.ambient.toFixed(1)} <small>dB</small>
          </b>
        </div>
        <div>
          <small>CONTATOS RECENTES</small>
          <b>{s.tracks.filter((c) => e.state.t - c.lastSeen < 30).length}</b>
        </div>
        <div>
          <small>FEIXE VERDADEIRO</small>
          <b>{(s.frame?.beam ?? cfg.beam).toFixed(1)}°</b>
        </div>
        <div>
          <small>HISTÓRICO</small>
          <b>
            {s.history.size} <small>/ {s.history.capacity} s</small>
          </b>
        </div>
      </div>
      <div className="acoustic-grid">
        <div>
          <Panel
            title="Escuta passiva"
            right={
              <div className="seg">
                {(['broadband', 'lofar', 'demon'] as const).map((m) => (
                  <button key={m} className={mode === m ? 'on' : ''} onClick={() => changeMode(m)}>
                    {m === 'broadband' ? 'Banda larga' : m.toUpperCase()}
                  </button>
                ))}
              </div>
            }
          >
            <div className="acoustic-display-caption">
              <span>{mode === 'broadband' ? 'Marcação verdadeira × tempo' : 'Frequência (Hz) × tempo'}</span>
              <span>{cursor === null ? 'Clique para posicionar o cursor' : `Cursor ${cursor.toFixed(1)} ${mode === 'broadband' ? '°' : 'Hz'}`}</span>
            </div>
            <Waterfall
              state={s}
              mode={mode}
              gain={gain}
              contrast={contrast}
              seconds={seconds}
              min={min}
              max={max}
              cursor={cursor}
              onCursor={setCursor}
              onMark={(bearing) => cmd({ type: 'sonar', action: 'mark', bearing })}
            />
            {mode !== 'broadband' && <InstantSpectrum bins={s.frame?.[mode] ?? []} max={mode === 'demon' ? 128 : 1024} />}
            <div className="acoustic-controls">
              <label>
                Ganho {gain} dB
                <input type="range" min="-20" max="30" value={gain} onChange={(ev) => setGain(+ev.target.value)} />
              </label>
              <label>
                Contraste ×{contrast.toFixed(1)}
                <input type="range" min="0.4" max="3" step="0.1" value={contrast} onChange={(ev) => setContrast(+ev.target.value)} />
              </label>
              <label>
                Janela temporal
                <select value={seconds} onChange={(ev) => setSeconds(+ev.target.value)}>
                  {[30, 60, 120, 240].map((v) => (
                    <option key={v} value={v}>
                      {v} s
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Memória (s)
                <input type="number" min="30" max="900" step="30" value={cfg.historySeconds} onChange={(ev) => set({ historySeconds: +ev.target.value })} />
              </label>
              <label>
                Integração (s)
                <input type="number" min="1" max="30" value={cfg.integration} onChange={(ev) => set({ integration: +ev.target.value })} />
              </label>
              <label>
                Cobertura angular
                <select value={cfg.coverage} onChange={(ev) => set({ coverage: +ev.target.value })}>
                  {[90, 180, 270, 360].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              {mode !== 'broadband' && (
                <>
                  <label>
                    Mín. Hz
                    <input type="number" min="0" max={max - 1} value={min} onChange={(ev) => setFmin(clamp(+ev.target.value, 0, max - 1))} />
                  </label>
                  <label>
                    Máx. Hz
                    <input type="number" min={min + 1} max={mode === 'demon' ? 128 : 1024} value={max} onChange={(ev) => setFmax(clamp(+ev.target.value, min + 1, mode === 'demon' ? 128 : 1024))} />
                  </label>
                </>
              )}
              <button className="btn" disabled={mode !== 'broadband' || cursor === null} onClick={() => cursor !== null && cmd({ type: 'sonar', action: 'mark', bearing: cursor })}>
                Marcar contato
              </button>
            </div>
            {mode === 'demon' && (
              <div className="note">
                DEMON mede modulação do envelope do ruído. Linhas:{' '}
                {(s.frame?.modulation ?? [])
                  .slice(0, 4)
                  .map((v) => `${v.toFixed(1)} Hz`)
                  .join(' · ') || 'sem picos significativos'}
                . Uma linha pode corresponder à rotação, passagem de pás ou harmônico; quantidade de pás permanece ambígua.
              </div>
            )}
            <div className="subtle">LOFAR/DEMON guardam o feixe recebido em cada instante. Clique duplo na cascata de banda larga cria uma marcação manual.</div>
          </Panel>
          <Panel title="Análise aural">
            <div className="acoustic-controls">
              <label>
                Feixe manual (°)
                <input type="number" min="0" max="359" value={cfg.beam} onChange={(ev) => set({ beam: +ev.target.value, selected: null })} />
              </label>
              <button className="btn" onClick={() => set({ selected: null })}>
                Usar feixe manual
              </button>
            </div>
            <Aural state={s} running={runner.running && cfg.enabled && e.state.electrical.energized} timeScale={runner.timeScale} />
          </Panel>
          <Panel title="Sonar ativo">
            <div className="acoustic-controls">
              <button className="btn warn" disabled={pingBusy || !cfg.enabled || !e.state.electrical.energized} onClick={() => cmd({ type: 'sonar', action: 'ping' })}>
                {pingBusy ? 'Pulso em propagação' : 'Emitir pulso'}
              </button>
              <label>
                Alcance de escuta (m)
                <input type="number" min="500" max="20000" step="500" value={cfg.range} onChange={(ev) => set({ range: +ev.target.value })} />
              </label>
              <label>
                <input type="checkbox" checked={cfg.intercept} onChange={(ev) => set({ intercept: ev.target.checked })} /> Emissões didáticas das patrulhas
              </label>
            </div>
            <p className="subtle">Distância estimada pelo tempo de ida e volta; ecos chegam conforme o relógio da simulação. Interceptações fornecem apenas marcação.</p>
            {s.ping && (
              <div className="mono">
                Emissão em {s.ping.start.toFixed(1)} s · decorrido {Math.max(0, e.state.t - s.ping.start).toFixed(2)} s · c local {s.ping.speed.toFixed(1)} m/s
              </div>
            )}
          </Panel>
        </div>
        <aside>
          <Panel title="Contatos medidos">
            <div className="acoustic-track-list">
              {s.tracks.length === 0 && <p className="subtle">Sem detecções. Execute a simulação; a escuta depende de geometria, ruído próprio e ambiente.</p>}
              {s.tracks.map((c) => (
                <button key={c.id} className={`acoustic-track ${cfg.selected === c.id ? 'selected' : ''}`} onClick={() => set({ selected: c.id })}>
                  <b>{c.id}</b>
                  <span>
                    {c.bearing.toFixed(1)}° ±{c.sigma.toFixed(1)}°
                  </span>
                  <small>
                    {c.snr.toFixed(1)} dB · {c.mode === 'passive' ? 'passivo' : c.mode === 'active' ? 'ativo' : 'interceptação'} · há {(e.state.t - c.lastSeen).toFixed(0)}s
                  </small>
                </button>
              ))}
            </div>
          </Panel>
          <Panel title={selected ? `Análise · ${selected.id}` : 'Análise de contato'}>
            {selected ? (
              <>
                <p>
                  Marcação medida: <b>{selected.bearing.toFixed(1)}°</b>
                  <br />
                  SNR medido: <b>{selected.snr.toFixed(1)} dB</b>
                </p>
                <p>
                  {selected.range !== undefined
                    ? `Distância ativa: ${(selected.range / 1000).toFixed(2)} ±${((selected.rangeSigma ?? 0) / 1000).toFixed(2)} km (há ${(e.state.t - selected.rangeTime!).toFixed(0)} s)`
                    : 'Distância: não observada pelo passivo.'}
                </p>
                <p>
                  Classe sugerida: <b>{selected.classification}</b> · {(selected.confidence * 100).toFixed(0)}%<br />
                  Classificação manual: {selected.manual || 'não registrada'}
                </p>
                <div className="acoustic-controls">
                  <input type="text" aria-label="Classificação manual" placeholder="Hipótese do operador" value={manual} maxLength={60} onChange={(ev) => setManual(ev.target.value)} />
                  <button
                    className="btn"
                    onClick={() => {
                      cmd({ type: 'sonar', action: 'classify', id: selected.id, label: manual });
                      setManual('');
                    }}
                  >
                    Registrar
                  </button>
                </div>
                <p className="subtle">Tons medidos: {selected.peaks.map((v) => v.toFixed(1)).join(', ') || 'selecione e aguarde aquisição'} Hz</p>
                <h4>TMA · estimativa</h4>
                <p>{solution.reason}</p>
                {solution.observable && (
                  <p className="mono">
                    {(solution.range! / 1000).toFixed(2)} ±{(solution.uncertainty! / 1000).toFixed(2)} km
                    <br />
                    {solution.course!.toFixed(0)}° · {(solution.speed! * 1.94384).toFixed(1)} nós
                    <br />
                    Resíduo {solution.residual!.toFixed(2)}°
                  </p>
                )}
              </>
            ) : (
              <p className="subtle">Selecione uma trilha para direcionar o feixe, escutar e comparar espectros.</p>
            )}
          </Panel>
          <Panel title="Ambiente e operação">
            <div className="acoustic-controls vertical">
              <label>
                <input type="checkbox" checked={cfg.enabled} onChange={(ev) => set({ enabled: ev.target.checked })} /> Sonar ligado
              </label>
              <label>
                Estado do mar {e.env.cfg.waves?.seaState ?? 0}
                <input type="range" min="0" max="9" value={e.env.cfg.waves?.seaState ?? 0} onChange={(ev) => cmd({ type: 'seaState', value: +ev.target.value })} />
              </label>
              <label>
                Tráfego adicional existente
                <input
                  type="number"
                  min="0"
                  max="20"
                  value={g.traffic}
                  onChange={(ev) => {
                    set({ traffic: +ev.target.value });
                    graphics.set({ traffic: +ev.target.value });
                  }}
                />
              </label>
              <label>
                Ruído de tráfego distante
                <input type="range" min="0" max="1" step="0.05" value={cfg.shipping} onChange={(ev) => set({ shipping: +ev.target.value })} />
              </label>
              <label>
                Atividade biológica
                <input type="range" min="0" max="1" step="0.05" value={cfg.biological} onChange={(ev) => set({ biological: +ev.target.value })} />
              </label>
            </div>
          </Panel>
          <Panel title="Biblioteca sintética" fold="sonar.library" foldOpen={false}>
            {Object.values(LIBRARY).map((v) => (
              <p key={v.category}>
                <b>{v.category}</b>
                <br />
                <span className="mono">{v.tones.join(' / ')} Hz</span>
                <br />
                <small>
                  Referência genérica; tons variam com a propulsão. DEMON: {v.shaftHz} Hz de eixo × hipótese de {v.blades} pás.
                </small>
              </p>
            ))}
          </Panel>
        </aside>
      </div>
      <button className={`btn ${science ? 'on' : ''}`} onClick={() => setScience(!science)}>
        {science ? 'Ocultar' : 'Abrir'} diagnóstico científico
      </button>
      {science && diag && (
        <Panel title="Diagnóstico científico · verdade do ambiente">
          <p className="note">
            Raios em corte vertical 2D projetados na cena existente. A densidade amostrada de raios não demonstra sombra absoluta nem representa uma solução acústica 3D. O perfil e o fundo são os mesmos usados pelo motor
            acústico.
          </p>
          <div className="acoustic-controls">
            <label>
              Preset ambiental
              <select
                value=""
                onChange={(ev) => {
                  if (ev.target.value === 'homogeneous') set({ homogeneous: true });
                  else {
                    set({ homogeneous: false });
                    cmd({ type: 'environment', patch: PRESETS[ev.target.value] });
                  }
                }}
              >
                <option value="">Escolher perfil…</option>
                {Object.keys(PRESETS).map((p) => (
                  <option key={p}>{p}</option>
                ))}
                <option value="homogeneous">Homogêneo acústico (1500 m/s)</option>
              </select>
            </label>
            <label>
              Temperatura superficial °C
              <input
                type="number"
                min="-2"
                max="35"
                value={e.env.cfg.surfaceTemperature}
                onChange={(ev) => {
                  set({ homogeneous: false });
                  cmd({ type: 'environment', patch: { surfaceTemperature: +ev.target.value } });
                }}
              />
            </label>
            <label>
              Temperatura profunda °C
              <input type="number" min="-2" max="35" value={e.env.cfg.deepTemperature} onChange={(ev) => cmd({ type: 'environment', patch: { deepTemperature: +ev.target.value } })} />
            </label>
            <label>
              Centro da termoclina (m)
              <input type="number" min="1" max="2000" value={e.env.cfg.thermoclineDepth} onChange={(ev) => cmd({ type: 'environment', patch: { thermoclineDepth: +ev.target.value } })} />
            </label>
            <label>
              Espessura da termoclina (m)
              <input type="number" min="1" max="1000" value={e.env.cfg.thermoclineThickness} onChange={(ev) => cmd({ type: 'environment', patch: { thermoclineThickness: +ev.target.value } })} />
            </label>
            <label>
              Salinidade (PSU)
              <input type="number" min="0" max="42" value={e.env.cfg.salinity} onChange={(ev) => cmd({ type: 'environment', patch: { salinity: +ev.target.value } })} />
            </label>
            <label>
              Plano do corte (°)
              <input type="number" min="0" max="359" value={cfg.section} onChange={(ev) => set({ section: +ev.target.value })} />
            </label>
            <label>
              Raios
              <select value={cfg.rayCount} onChange={(ev) => set({ rayCount: +ev.target.value })}>
                {[8, 16, 32, 64, 128, 256, 512].map((v) => (
                  <option key={v} value={v}>
                    {v}
                    {v > 128 ? ' · alta qualidade' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Opacidade
              <input type="range" min="0.05" max="1" step="0.05" value={layers.sonarOpacity} onChange={(ev) => setLayers({ ...savedLayers, sonarOpacity: +ev.target.value })} />
            </label>
          </div>
          {s.ping && <div className="note">Replay conserva o ambiente e o corte da emissão. Novos ajustes de perfil, plano e raios serão usados no próximo pulso.</div>}
          <SceneLayerPanel e={e} keys={[...SONAR_LAYERS, 'noWater', 'ships']} value={layers} onChange={(patch) => setLayers({ ...savedLayers, ...patch })} />
          <div className="acoustic-science-grid">
            <Section data={diag} age={age} layers={layers} echoes={s.ping?.echoPaths} />
            <Profile data={diag} />
          </div>
          <div className="acoustic-controls">
            <button className="btn" onClick={() => setCamera('sonar')}>
              Vista acústica
            </button>
            <button className="btn" onClick={() => setCamera('livre')}>
              Câmera livre
            </button>
            <button className="btn" disabled={!s.ping} onClick={() => setCamera('ping')}>
              Ping Cam
            </button>
            <span className="subtle">Câmeras alteram apenas a visualização.</span>
          </div>
          <div className="acoustic-scene">
            <Scene3D view={camera} layers={layers} fog={false} quality="baixa" persistKey="sonar-science" />
          </div>
          <SourceEditor engine={e} />
          <h4>Replay acústico</h4>
          <div className="acoustic-controls">
            <button
              className="btn"
              disabled={!s.ping}
              onClick={() => {
                setPlaying(false);
                setReplay(null);
              }}
            >
              Ao vivo
            </button>
            <button
              className="btn"
              disabled={!s.ping}
              onClick={() => {
                setReplay(replay ?? 0);
                setPlaying(!playing);
              }}
            >
              {playing ? 'Pausar replay' : 'Reproduzir replay'}
            </button>
            <button
              className="btn"
              disabled={!s.ping}
              onClick={() => {
                setPlaying(false);
                setReplay(Math.max(0, (replay ?? 0) - 0.05));
              }}
            >
              −1 quadro
            </button>
            <button
              className="btn"
              disabled={!s.ping}
              onClick={() => {
                setPlaying(false);
                setReplay(Math.min(s.ping!.duration, (replay ?? 0) + 0.05));
              }}
            >
              +1 quadro
            </button>
            <label>
              Velocidade
              <select value={rate} onChange={(ev) => setRate(+ev.target.value)}>
                {[0.1, 0.25, 0.5, 1].map((v) => (
                  <option key={v} value={v}>
                    ×{v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tempo do replay {(replay ?? 0).toFixed(2)} s
              <input
                aria-label="Tempo do replay acústico"
                type="range"
                disabled={!s.ping}
                min="0"
                max={s.ping?.duration ?? 1}
                step="0.01"
                value={replay ?? 0}
                onChange={(ev) => {
                  setPlaying(false);
                  setReplay(+ev.target.value);
                }}
              />
            </label>
          </div>
          <div className="acoustic-controls">
            {s.ping?.events.map((ev, i) => (
              <button
                key={i}
                className="btn sm"
                onClick={() => {
                  setPlaying(false);
                  setReplay(ev.t);
                }}
              >
                {ev.t.toFixed(2)}s · {ev.label}
              </button>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
