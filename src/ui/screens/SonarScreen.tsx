import { useEffect, useMemo, useState } from 'react';
import { cmd, runner, useSim } from '../store';
import { usePersisted } from '../persist';
import { visualOut, isVisualWindow, isPanelWindow } from '../sync';
import { defaultLayers } from '../../render3d/layers';
import { observer } from '../../sonar/integration/world';
import { clamp, values, wrap, type SonarSettings, type TmaMotion } from '../../sonar/types';
import { estimateMotion, positionAt, seedHypothesis, timeLabel } from '../../sonar/tma/plotModel';
import { TmaPlot, BearingHistory } from '../../sonar/display/TmaPlot';
import { Waterfall, InstantSpectrum, type DisplayMode } from '../../sonar/display/Waterfall';
import { Aural } from '../../sonar/display/Aural';
import { PingAudio } from '../../sonar/display/PingAudio';
import { PulseView } from '../../sonar/visualization/PulseView';
import { AdvancedSonarScreen } from './AdvancedSonarScreen';
import '../../sonar/display/console.css';

export function SonarScreen() {
  const e = useSim(10),
    s = e.state.sonar!,
    cfg = s.settings;
  const [advanced, setAdvanced] = useState(false),
    [focus, setFocus] = useState<'tma' | 'pulse' | 'listen'>('tma');
  const [mode, setMode] = usePersisted<DisplayMode>('sonar.mode', 'broadband');
  const [gain, setGain] = usePersisted('sonar.gain', 0),
    [seconds, setSeconds] = usePersisted('sonar.seconds', 120);
  const [contrast, setContrast] = usePersisted('sonar.contrast', 1),
    [fmin, setFmin] = useState(0),
    [fmax, setFmax] = useState(500);
  const [cursor, setCursor] = useState<number | null>(null),
    [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [editing, setEditing] = useState(false),
    [editHeading, setEditHeading] = useState(0),
    [manual, setManual] = useState(''),
    [notice, setNotice] = useState('');
  const [age, setAge] = useState(0),
    [playing, setPlaying] = useState(false),
    [rate, setRate] = usePersisted('sonar.pulseRate', 0.25);
  const [linesOnly, setLinesOnly] = usePersisted('sonar.pulseLines', false),
    [cameraKey, setCameraKey] = useState(0),
    [epoch, setEpoch] = useState(0);
  const set = (patch: Partial<SonarSettings>) => cmd({ type: 'sonar', action: 'settings', patch });
  const selected = s.tracks.find((t) => t.id === cfg.selected);
  const rows = useMemo(() => (selected ? values(selected.history) : []), [selected, s.version]);
  const estimate = useMemo(() => estimateMotion(rows, selected?.tma), [rows, selected?.tma]);
  const own = observer(e),
    point = estimate.motion ? positionAt(estimate.motion, Math.min(e.state.t, (rows.at(-1)?.t ?? e.state.t) + 30)) : null;
  const range = point ? Math.hypot(point.n - own.n, point.e - own.e) : selected?.range;
  const course = estimate.motion ? wrap((Math.atan2(estimate.motion.ve, estimate.motion.vn) * 180) / Math.PI) : null;
  const speed = estimate.motion ? Math.hypot(estimate.motion.vn, estimate.motion.ve) * 1.94384 : null;
  const powered = cfg.enabled && e.state.electrical.energized;
  const busy = !!s.ping && e.state.t - s.ping.start < s.ping.duration;
  useEffect(
    () =>
      runner.onEngineReplaced(() => {
        setEpoch((v) => v + 1);
        setSelectedTime(null);
        setEditing(false);
        setNotice('');
      }),
    [],
  );
  useEffect(() => {
    setSelectedTime(null);
    setEditing(false);
    setManual(selected?.manual ?? '');
    setNotice('');
  }, [selected?.id]);
  useEffect(() => {
    setAge(0);
    setPlaying(!!s.ping && e.state.t - s.ping.start < s.ping.duration);
  }, [s.ping?.start, epoch]);
  useEffect(() => {
    if (!playing || !s.ping || advanced) return;
    let prev = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now(),
        dt = (now - prev) / 1000;
      prev = now;
      setAge((v) => {
        const next = Math.min(s.ping!.duration, v + dt * rate);
        if (next >= s.ping!.duration) setPlaying(false);
        return next;
      });
    }, 40);
    return () => clearInterval(id);
  }, [playing, rate, s.ping, advanced]);
  useEffect(() => {
    if (advanced || isVisualWindow || isPanelWindow) return;
    visualOut.view = 'sonar';
    visualOut.layers = {
      ...defaultLayers(),
      vectors: false,
      hydroVectors: false,
      trimVectors: false,
      tanks: false,
      pipes: false,
      flows: false,
      labels: false,
      markers: false,
      sonarWave: true,
      sonarEchoes: true,
      sonarOpacity: 0.9,
      sonarReplayTime: age,
      noWater: true,
    };
  }, [advanced, age]);
  const saveMotion = (motion: TmaMotion) => {
    if (selected) {
      if (Math.hypot(motion.vn, motion.ve) > 0.001) setEditHeading(wrap((Math.atan2(motion.ve, motion.vn) * 180) / Math.PI));
      cmd({ type: 'sonar', action: 'tma', id: selected.id, motion });
    }
  };
  const edit = () => {
    if (!selected) return;
    if (editing) {
      setEditing(false);
      return;
    }
    const motion = estimate.motion ?? seedHypothesis(rows);
    if (motion) {
      saveMotion(!estimate.motion ? { ...motion, vn: 3, ve: 0 } : motion);
      setEditHeading(course ?? 0);
      setEditing(true);
      setSelectedTime(null);
    }
  };
  const changeMotion = (heading: number, knots: number) => {
    if (!estimate.motion || !Number.isFinite(heading) || !Number.isFinite(knots)) return;
    saveMotion({ ...estimate.motion, vn: (Math.cos((heading * Math.PI) / 180) * clamp(knots, 0, 48)) / 1.94384, ve: (Math.sin((heading * Math.PI) / 180) * clamp(knots, 0, 48)) / 1.94384 });
  };
  const emit = () => {
    set({ section: selected?.bearing ?? cfg.beam });
    cmd({ type: 'sonar', action: 'ping' });
    if (powered && !runner.running) runner.running = true;
  };
  const max = mode === 'broadband' ? 360 : mode === 'demon' ? Math.min(128, fmax) : fmax;
  const min = mode === 'broadband' ? 0 : Math.min(fmin, max - 1);
  const contacts = [...s.tracks].sort((a, b) => b.lastSeen - a.lastSeen || b.snr - a.snr);
  if (advanced)
    return (
      <div className="sonar-advanced">
        <div className="sonar-back">
          <button className="btn" onClick={() => setAdvanced(false)}>
            ← Voltar à estação visual
          </button>
          <span>Console avançado · modelo acústico e diagnóstico científico</span>
        </div>
        <AdvancedSonarScreen />
      </div>
    );
  return (
    <div className={`sonar-station focus-${focus}`}>
      <header className="sonar-topline">
        <div>
          <span className="sonar-eyebrow">SX-1 / ESTAÇÃO ACÚSTICA</span>
          <h2>
            Sonar <span>· análise de movimento</span>
          </h2>
        </div>
        <div className="sonar-mode-tabs" aria-label="Área de trabalho">
          {(
            [
              ['tma', 'TMA'],
              ['listen', 'Escuta'],
              ['pulse', 'Sonar 3D'],
            ] as const
          ).map(([id, text]) => (
            <button key={id} className={focus === id ? 'active' : ''} aria-pressed={focus === id} onClick={() => setFocus(id)}>
              {text}
            </button>
          ))}
          <button onClick={() => setAdvanced(true)}>Avançado ↗</button>
        </div>
      </header>
      <div className="sonar-statusbar">
        <span className={powered && runner.running ? 'sonar-live' : ''}>
          ● {!cfg.enabled ? 'Sonar desligado' : !e.state.electrical.energized ? 'Sem energia' : runner.running ? 'Escuta em andamento' : 'Simulação pausada'}
        </span>
        <span>
          {timeLabel(e.state.t)} <small>tempo simulado</small>
        </span>
        <span>{contacts.filter((t) => e.state.t - t.lastSeen < 30).length} contatos recentes</span>
        <button
          onClick={() => {
            if (!cfg.enabled) set({ enabled: true });
            runner.running = !runner.running;
          }}
        >
          {runner.running ? 'Ⅱ Pausar simulação' : '▶ Iniciar escuta'}
        </button>
      </div>
      <div className="sonar-workspace">
        <section className="sonar-card tma-card">
          <div className="sonar-card-title">
            <h3>Plotagem TMA</h3>
            <span>
              {selected?.id ?? 'Nenhum contato selecionado'} <i className="sonar-tag">{estimate.kind === 'manual' ? 'HIPÓTESE MANUAL' : estimate.motion ? 'ESTIMATIVA' : 'COLETANDO'}</i>
            </span>
          </div>
          <TmaPlot
            key={epoch}
            track={selected}
            own={own}
            frames={values(s.history)}
            estimate={estimate}
            now={e.state.t}
            range={cfg.range}
            selectedTime={selectedTime}
            onTime={setSelectedTime}
            editing={editing}
            onMotion={saveMotion}
          />
          <div className="sonar-toolbar">
            <button disabled={!selected} onClick={() => selected && cmd({ type: 'sonar', action: 'mark', bearing: selected.bearing })}>
              ⌖ Marcar
            </button>
            <button disabled={!selected} className={editing ? 'active' : ''} onClick={edit}>
              {editing ? '✓ Concluir ajuste' : 'Ajustar solução'}
            </button>
            <button
              disabled={!selected}
              onClick={() => {
                if (!selected) return;
                cmd({ type: 'sonar', action: 'tma', id: selected.id, motion: null });
                setEditing(false);
                setNotice(estimateMotion(rows).reason);
              }}
            >
              Estimar solução
            </button>
            {selectedTime !== null && <button onClick={() => setSelectedTime(null)}>Ao vivo · sair de {timeLabel(selectedTime)}</button>}
          </div>
          <p className="sonar-guidance" role="status">
            {notice || (selected ? estimate.reason : 'Inicie a escuta e selecione um contato. A plotagem usa suas marcações, sem revelar a posição real do alvo.')}
          </p>
          {editing && estimate.motion && (
            <div className="sonar-toolbar tma-numeric">
              <label>
                Rumo da hipótese (°)
                <input
                  type="number"
                  aria-label="Rumo TMA"
                  min="0"
                  max="359"
                  value={Math.round(editHeading)}
                  onChange={(ev) => {
                    setEditHeading(+ev.target.value);
                    changeMotion(+ev.target.value, speed ?? 0);
                  }}
                />
              </label>
              <label>
                Velocidade (nós)
                <input type="number" aria-label="Velocidade TMA" min="0" max="48" step=".5" value={+(speed ?? 0).toFixed(1)} onChange={(ev) => changeMotion(editHeading, +ev.target.value)} />
              </label>
              <span>Arraste o círculo âmbar para ajustar a posição.</span>
            </div>
          )}
        </section>
        <section className="sonar-card pulse-card">
          <div className="sonar-card-title">
            <h3>Propagação do ping</h3>
            <span>3D didático</span>
          </div>
          <div className="sonar-pulse-stage">
            <PulseView age={age} linesOnly={linesOnly} resetKey={cameraKey} />
            <div className="pulse-caption">
              <span className="cyan">● Emissão</span>
              <span className="amber">● Retorno</span>
            </div>
            {!s.ping && (
              <div className="pulse-invitation">
                <b>Veja o som atravessar a água</b>
                <span>Emita um ping para acompanhar o pulso e seus ecos.</span>
              </div>
            )}
            <div className="pulse-scale">Profundidade e símbolos ampliados · envelope ilustrativo</div>
          </div>
          <div className="ping-actions">
            <button className="ping-button" disabled={busy || !powered} onClick={emit}>
              {busy ? '◉ Aguardando ecos' : '◉ EMITIR PING'}
            </button>
            <button aria-label="Reposicionar câmera do sonar" title="Reposicionar câmera" onClick={() => setCameraKey((v) => v + 1)}>
              ⌖
            </button>
            <button className={linesOnly ? 'active' : ''} aria-pressed={linesOnly} onClick={() => setLinesOnly(!linesOnly)}>
              {linesOnly ? 'Linhas' : 'Pulso'}
            </button>
          </div>
          <div className="sonar-playback">
            <button
              disabled={!s.ping}
              title="Reiniciar replay"
              aria-label="Reiniciar replay do ping"
              onClick={() => {
                setAge(0);
                setPlaying(true);
              }}
            >
              ↺
            </button>
            <button
              disabled={!s.ping}
              aria-label={playing ? 'Pausar replay do ping' : 'Reproduzir replay do ping'}
              onClick={() => {
                if (s.ping && age >= s.ping.duration) setAge(0);
                setPlaying(!playing);
              }}
            >
              {playing ? 'Ⅱ' : '▶'}
            </button>
            <button
              disabled={!s.ping}
              aria-label="Avançar um quadro do ping"
              onClick={() => {
                setPlaying(false);
                setAge(Math.min(s.ping?.duration ?? 0, age + 0.05));
              }}
            >
              ▸│
            </button>
            <input
              type="range"
              aria-label="Tempo do pulso"
              disabled={!s.ping}
              min="0"
              max={s.ping?.duration ?? 1}
              step=".01"
              value={age}
              onChange={(ev) => {
                setPlaying(false);
                setAge(+ev.target.value);
              }}
            />
            <select aria-label="Velocidade do replay" value={rate} onChange={(ev) => setRate(+ev.target.value)}>
              {[0.1, 0.25, 0.5, 1].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
          </div>
          <div className="sonar-pulse-foot">
            <span>Replay visual {age.toFixed(2)} s · escuta em tempo real</span>
            <PingAudio state={s} time={e.state.t} />
          </div>
        </section>
        <section className="sonar-card bearing-card">
          <div className="sonar-card-title">
            <h3>Marcação × tempo</h3>
            <span>
              <i className="cyan">● Medidas</i> <i className="amber">— Previsão</i>
            </span>
          </div>
          <BearingHistory rows={rows} motion={estimate.motion} selectedTime={selectedTime} onTime={setSelectedTime} />
        </section>
        <section className="sonar-card contact-card">
          <div className="sonar-card-title">
            <h3>{selected ? `Contato ${selected.id}` : 'Contatos'}</h3>
            <span>{selected ? `${Math.max(0, e.state.t - selected.lastSeen).toFixed(0)} s desde a última medida` : 'Selecione para acompanhar'}</span>
          </div>
          <div className="sonar-contact-strip" aria-label="Contatos recebidos">
            {contacts.slice(0, 48).map((t) => (
              <button key={t.id} className={selected?.id === t.id ? 'active' : ''} onClick={() => set({ selected: t.id })}>
                {t.id}
                <small>
                  {t.bearing.toFixed(0)}°{e.state.t - t.lastSeen > 30 ? ' · antigo' : ''}
                </small>
              </button>
            ))}
            {!contacts.length && <p>Reduza a velocidade para ouvir melhor. A escuta começa com o avanço da simulação.</p>}
          </div>
          <div className="sonar-readings">
            <div>
              <small>Marcação</small>
              <strong>{selected ? `${selected.bearing.toFixed(0).padStart(3, '0')}°` : '—'}</strong>
            </div>
            <div>
              <small>{estimate.kind === 'manual' ? 'Distância da hipótese' : estimate.motion ? 'Distância estimada' : 'Último eco'}</small>
              <strong>{range !== undefined ? `${(range / 1000).toFixed(2)} km` : '—'}</strong>
            </div>
            <div>
              <small>Rumo / velocidade</small>
              <strong className="compact">{course !== null ? `${course.toFixed(0)}° / ${speed!.toFixed(1)} nós` : 'Em formação'}</strong>
            </div>
            <div>
              <small>Resíduo TMA</small>
              <strong className="compact">{estimate.residual !== undefined ? `${estimate.residual.toFixed(2)}°` : 'Sem solução'}</strong>
            </div>
          </div>
          {selected?.rangeTime !== undefined && (
            <div className="sonar-small-note">
              Último eco há {Math.max(0, e.state.t - selected.rangeTime).toFixed(0)} s · ±{(selected.rangeSigma ?? 0).toFixed(0)} m
            </div>
          )}
          <div className="sonar-noise">
            <span>
              Ruído próprio <b>{s.noise.own.toFixed(0)} dB</b>
            </span>
            <meter min="30" max="120" value={s.noise.own} />
            <small>{s.noise.own > 85 ? 'Alto · reduza velocidade e máquinas' : s.noise.own > 65 ? 'Moderado' : 'Baixo'}</small>
          </div>
        </section>
        <section className="sonar-card waterfall-card">
          <div className="sonar-card-title">
            <h3>Cascata acústica</h3>
            <div className="sonar-mode-tabs">
              {(['broadband', 'lofar', 'demon'] as const).map((m) => (
                <button
                  key={m}
                  className={mode === m ? 'active' : ''}
                  onClick={() => {
                    setMode(m);
                    setCursor(null);
                  }}
                >
                  {m === 'broadband' ? 'Banda larga' : m.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="waterfall-caption">
            <span>
              {mode === 'broadband' ? 'Direção × tempo' : 'Frequência × tempo'} · feixe {s.frame?.beam.toFixed(0) ?? cfg.beam}°
            </span>
            <span>{cursor !== null ? `Cursor ${cursor.toFixed(1)} ${mode === 'broadband' ? '°' : 'Hz'}` : 'Clique para posicionar o cursor'}</span>
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
          <div className="sonar-toolbar waterfall-tools">
            <label>
              Ganho {gain} dB
              <input aria-label="Ganho da cascata" type="range" min="-20" max="30" value={gain} onChange={(ev) => setGain(+ev.target.value)} />
            </label>
            <label>
              Histórico
              <select value={seconds} onChange={(ev) => setSeconds(+ev.target.value)}>
                {[30, 60, 120, 240].map((v) => (
                  <option key={v} value={v}>
                    {v} s
                  </option>
                ))}
              </select>
            </label>
            <button disabled={mode !== 'broadband' || cursor === null} onClick={() => cursor !== null && cmd({ type: 'sonar', action: 'mark', bearing: cursor })}>
              ⌖ Marcar na cascata
            </button>
            <details>
              <summary>Ajustar display</summary>
              <div className="sonar-toolbar">
                <label>
                  Contraste
                  <input type="range" min=".4" max="3" step=".1" value={contrast} onChange={(ev) => setContrast(+ev.target.value)} />
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
              </div>
            </details>
          </div>
          <p className="sonar-small-note">
            {mode === 'broadband'
              ? 'Duplo clique cria uma marcação. Selecionar um contato orienta o feixe de escuta.'
              : mode === 'lofar'
                ? 'Tons do sinal recebido. Cada linha conserva o feixe escutado naquele instante.'
                : `Modulação do envelope · picos: ${
                    s.frame?.modulation
                      .slice(0, 4)
                      .map((v) => `${v.toFixed(1)} Hz`)
                      .join(' · ') || 'aguardando sinal'
                  }.`}
          </p>
        </section>
        <section className="sonar-card listening-card">
          <div className="sonar-card-title">
            <h3>Escuta e identificação</h3>
            <span>{selected?.id ?? 'Feixe manual'}</span>
          </div>
          <div className="sonar-listening-body">
            <Aural state={s} running={runner.running && powered} timeScale={runner.timeScale} />
            <details>
              <summary>Feixe e alcance</summary>
              <div className="sonar-toolbar">
                <label>
                  Feixe manual (°)
                  <input type="number" min="0" max="359" value={cfg.beam} onChange={(ev) => set({ beam: +ev.target.value, selected: null })} />
                </label>
                <label>
                  Alcance do ping
                  <select value={cfg.range} onChange={(ev) => set({ range: +ev.target.value })}>
                    {Array.from(new Set([1000, 3000, 6000, 10000, 20000, cfg.range]))
                      .sort((a, b) => a - b)
                      .map((v) => (
                        <option key={v} value={v}>
                          {v / 1000} km
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            </details>
            {selected && (
              <>
                <div className="sonar-classification">
                  <small>ASSINATURA SUGERIDA</small>
                  <b>{selected.classification}</b>
                  <span>
                    Confiança {(selected.confidence * 100).toFixed(0)}% · SNR {selected.snr.toFixed(1)} dB
                  </span>
                </div>
                <label className="sonar-classify-label">
                  Hipótese do operador
                  <input type="text" aria-label="Classificação do contato" placeholder="Ex.: mercante provável" maxLength={60} value={manual} onChange={(ev) => setManual(ev.target.value)} />
                </label>
                <button onClick={() => cmd({ type: 'sonar', action: 'classify', id: selected.id, label: manual })}>Registrar classificação</button>
                {selected.manual && <p className="sonar-small-note">Registrado: {selected.manual}</p>}
              </>
            )}
            <p className="sonar-small-note">
              Perfis de água, fontes, biblioteca, integração e camadas científicas estão em{' '}
              <button className="sonar-link" onClick={() => setAdvanced(true)}>
                Avançado
              </button>
              .
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
