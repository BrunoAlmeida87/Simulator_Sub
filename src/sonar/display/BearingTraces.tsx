import { useId, useMemo, useState, type CSSProperties, type PointerEvent } from 'react';
import { usePersisted } from '../../ui/persist';
import { values, wrap, type SonarState, type Measurement } from '../types';
import { timeLabel } from '../tma/plotModel';
import { bearingTrace, trackColor } from './bearingTraces';
const W = 900,
  H = 420,
  X = 62,
  Y = 40,
  WIDTH = 814,
  HEIGHT = 344;
interface Props {
  state: SonarState;
  now: number;
  selectedTime: number | null;
  onSelect: (id: string, time: number | null) => void;
  onLive: () => void;
}
export function BearingTraces({ state, now, selectedTime, onSelect, onLive }: Props) {
  const clip = useId().replace(/:/g, '');
  const [seconds, setSeconds] = usePersisted('sonar.traces.seconds', 120);
  const [center, setCenter] = usePersisted('sonar.traces.center', 0);
  const [smooth, setSmooth] = usePersisted('sonar.traces.smooth', true);
  const [onlySelected, setOnlySelected] = useState(false),
    [hover, setHover] = useState<{ id: string; m: Measurement } | null>(null);
  const tracks = useMemo(
    () => state.tracks.map((track) => ({ track, trace: bearingTrace(values(track.history), now, seconds, center, smooth) })).filter((t) => t.trace.observations.length > 0),
    [state, state.version, now, seconds, center, smooth],
  );
  const shown = tracks.filter((t) => !onlySelected || !state.settings.selected || t.track.id === state.settings.selected);
  // Draw selected last, keeping its hit target accessible where traces cross.
  const ordered = [...shown].sort((a, b) => Number(a.track.id === state.settings.selected) - Number(b.track.id === state.settings.selected));
  const selected = tracks.find((t) => t.track.id === state.settings.selected);
  const selectedObservation = selectedTime === null ? undefined : selected?.trace.observations.find((o) => o.measurement.t === selectedTime);
  const picked = hover && tracks.some((t) => t.track.id === hover.id) ? hover : selectedObservation ? { id: selected!.track.id, m: selectedObservation.measurement } : null;
  const nearest = (ev: PointerEvent<SVGElement>, observations: (typeof shown)[number]['trace']['observations']) => {
    const svg = ev.currentTarget.ownerSVGElement!;
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    return observations.reduce((a, b) => (Math.abs(Y + b.point.y * HEIGHT - p.y) < Math.abs(Y + a.point.y * HEIGHT - p.y) ? b : a)).measurement;
  };
  return (
    <section className="sonar-card trails-card">
      <div className="sonar-card-title">
        <h3>Histórico de marcações · trilhas</h3>
        <span>Direção na horizontal · tempo na vertical</span>
      </div>
      <div className="bearing-trace-controls">
        <label>
          Janela
          <select aria-label="Janela das trilhas" value={seconds} onChange={(ev) => setSeconds(+ev.target.value)}>
            {[30, 60, 120, 180].map((v) => (
              <option key={v} value={v}>
                {v} s
              </option>
            ))}
          </select>
        </label>
        <label>
          Eixo
          <select aria-label="Centro angular das trilhas" value={center} onChange={(ev) => setCenter(+ev.target.value)}>
            <option value={0}>180° — 0° — 180°</option>
            <option value={180}>0° — 180° — 360°</option>
          </select>
        </label>
        <label className="bearing-trace-check">
          <input type="checkbox" checked={smooth} onChange={(ev) => setSmooth(ev.target.checked)} />
          Traço suave
        </label>
        <button aria-pressed={onlySelected} className={onlySelected ? 'active' : ''} disabled={!state.settings.selected} onClick={() => setOnlySelected(!onlySelected)}>
          {onlySelected ? 'Mostrar todas' : 'Só selecionado'}
        </button>
      </div>
      <svg className="bearing-traces" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Histórico multitrilha: marcação horizontal e tempo vertical" onPointerLeave={() => setHover(null)}>
        <defs>
          <clipPath id={clip}>
            <rect x={X} y={Y} width={WIDTH} height={HEIGHT} />
          </clipPath>
        </defs>
        <rect width={W} height={H} fill="#050d10" />
        {Array.from({ length: 13 }, (_, i) => (
          <g key={i}>
            <line x1={X + (i / 12) * WIDTH} x2={X + (i / 12) * WIDTH} y1={Y} y2={Y + HEIGHT} stroke="#80502b" opacity={i === 6 ? 0.95 : 0.6} />
            <text className={i % 2 === 1 ? 'bearing-minor-tick' : ''} x={X + (i / 12) * WIDTH} y="25" fill={i === 6 ? '#f5c086' : '#ce8c50'} fontSize="12" textAnchor="middle">
              {center === 180 && i === 12 ? 360 : wrap(center - 180 + i * 30)}°
            </text>
          </g>
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={X} x2={X + WIDTH} y1={Y + (i / 4) * HEIGHT} y2={Y + (i / 4) * HEIGHT} stroke="#80502b" opacity=".6" />
            <text x={X - 9} y={Y + (i / 4) * HEIGHT + 4} fill="#bc915f" textAnchor="end" fontSize="11">
              {i === 0 ? 'agora' : `−${Math.round((seconds * i) / 4)}s`}
            </text>
          </g>
        ))}
        <g clipPath={`url(#${clip})`}>
          {ordered.map(({ track, trace }) => {
            const active = track.id === state.settings.selected,
              color = trackColor(track.id);
            const d = trace.segments.map((segment) => segment.map((p, i) => `${i ? 'L' : 'M'}${(X + p.x * WIDTH).toFixed(2)},${(Y + p.y * HEIGHT).toFixed(2)}`).join(' ')).join(' ');
            const last = trace.observations.at(-1)!;
            return (
              <g
                key={track.id}
                className="bearing-trace-line"
                data-track-id={track.id}
                role="button"
                tabIndex={0}
                aria-label={`Selecionar trilha ${track.id}`}
                aria-pressed={active}
                onPointerMove={(ev) => setHover({ id: track.id, m: nearest(ev, trace.observations) })}
                onPointerDown={(ev) => {
                  if (ev.button === 0) {
                    ev.preventDefault();
                    const m = nearest(ev, trace.observations);
                    onSelect(track.id, m.t);
                    setHover({ id: track.id, m });
                  }
                }}
                onFocus={() => setHover({ id: track.id, m: last.measurement })}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    onSelect(track.id, last.measurement.t);
                  }
                }}
              >
                {active && <path d={d} fill="none" stroke={color} strokeWidth="7" opacity=".14" pointerEvents="none" />}
                <path d={d} fill="none" stroke={color} strokeWidth={active ? 2.8 : 1.8} opacity={state.settings.selected && !active ? 0.72 : 1} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
                <path className="bearing-trace-hit" d={d} fill="none" stroke="transparent" strokeWidth="16" />
                <circle cx={X + last.point.x * WIDTH} cy={Y + last.point.y * HEIGHT} r={active ? 4 : 2.5} fill={color} pointerEvents="none" />
                <circle cx={X + last.point.x * WIDTH} cy={Y + last.point.y * HEIGHT} r="10" fill="transparent" />
                <title>
                  {track.id} · {last.measurement.bearing.toFixed(1)}° · {timeLabel(last.measurement.t)}
                </title>
              </g>
            );
          })}
          {selectedTime !== null && selectedTime <= now && selectedTime >= now - seconds && (
            <line x1={X} x2={X + WIDTH} y1={Y + ((now - selectedTime) / seconds) * HEIGHT} y2={Y + ((now - selectedTime) / seconds) * HEIGHT} stroke="#e4e4d1" strokeDasharray="4 5" opacity=".7" pointerEvents="none" />
          )}
          {selectedObservation && <circle cx={X + selectedObservation.point.x * WIDTH} cy={Y + selectedObservation.point.y * HEIGHT} r="7" fill="none" stroke="#fff8e2" strokeWidth="1.5" pointerEvents="none" />}
        </g>
        {!shown.length && (
          <g fill="#8d9d9e" textAnchor="middle">
            <text x={W / 2} y={H / 2 - 8} fontSize="17">
              Aguardando trilhas acústicas
            </text>
            <text x={W / 2} y={H / 2 + 18} fontSize="12">
              Inicie a escuta. Cada contato terá sua própria linha.
            </text>
          </g>
        )}
        <text x={X} y={H - 12} fill="#849697" fontSize="11">
          MARCAÇÃO VERDADEIRA · NORTE = 0°
        </text>
        <text x={X + WIDTH} y={H - 12} fill="#849697" fontSize="11" textAnchor="end">
          Mais recente no topo ↓ passado
        </text>
      </svg>
      <div className="bearing-trace-legend" aria-label="Legenda das trilhas">
        {tracks.map(({ track }) => (
          <button
            key={track.id}
            style={{ '--track-color': trackColor(track.id) } as CSSProperties}
            className={track.id === state.settings.selected ? 'active' : ''}
            aria-pressed={track.id === state.settings.selected}
            onClick={() => onSelect(track.id, null)}
          >
            <span className="track-swatch" />
            <b>{track.id}</b>
            <small>{track.bearing.toFixed(0)}°</small>
          </button>
        ))}
      </div>
      <div className="bearing-trace-readout" role="status">
        <span>
          {picked ? (
            <>
              <b style={{ color: trackColor(picked.id) }}>{picked.id}</b> · {picked.m.bearing.toFixed(1)}° medidos · {timeLabel(picked.m.t)} · SNR {picked.m.snr.toFixed(1)} dB
            </>
          ) : (
            'Clique numa linha para selecionar contato e instante no TMA.'
          )}
        </span>
        {selectedTime !== null && <button onClick={onLive}>Voltar ao vivo</button>}
      </div>
    </section>
  );
}
