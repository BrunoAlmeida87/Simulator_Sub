import { useEffect, useId, useRef, useState } from 'react';
import { angleDiff, clamp, values, wrap, type AcousticFrame, type Measurement, type Observer, type TmaMotion, type Track } from '../types';
import { positionAt, measuredPosition, predictedBearing, timeLabel, unwrapBearings, type PlotEstimate } from '../tma/plotModel';
interface Props {
  track?: Track;
  own: Observer;
  frames: AcousticFrame[];
  estimate: PlotEstimate;
  now: number;
  range: number;
  selectedTime: number | null;
  onTime: (t: number | null) => void;
  editing: boolean;
  onMotion: (m: TmaMotion) => void;
}
const W = 900,
  H = 460,
  D = Math.PI / 180;
export function TmaPlot({ track, own, frames, estimate, now, range, selectedTime, onTime, editing, onMotion }: Props) {
  const clip = useId().replace(/:/g, ''),
    svg = useRef<SVGSVGElement>(null);
  const [span, setSpan] = useState(range * 1.5),
    [center, setCenter] = useState({ n: own.n + range * 0.22, e: own.e + range * 0.22 });
  const [ruler, setRuler] = useState(false),
    [rule, setRule] = useState<{ n: number; e: number }[]>([]);
  const [draft, setDraft] = useState<TmaMotion | null>(null);
  const drag = useRef<{ x: number; y: number; center: typeof center; kind: 'pan' | 'target' | 'vector'; motion?: TmaMotion } | null>(null);
  const rows = track ? values(track.history) : [],
    motion = draft ?? estimate.motion;
  const at = selectedTime ?? Math.min(now, (rows.at(-1)?.t ?? now) + 30);
  const scale = W / span;
  const xy = (p: { n: number; e: number }) => ({ x: W / 2 + (p.e - center.e) * scale, y: H / 2 - (p.n - center.n) * scale });
  const world = (x: number, y: number) => ({ e: center.e + (x - W / 2) / scale, n: center.n - (y - H / 2) / scale });
  const point = (ev: React.PointerEvent<SVGSVGElement>) => {
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  const target = motion ? positionAt(motion, at) : null;
  const tp = target ? xy(target) : null;
  const vector = target && motion ? xy({ n: target.n + motion.vn * 120, e: target.e + motion.ve * 120 }) : null;
  const ownHistory = frames.filter((f) => f.observer && f.t <= at).map((f) => ({ ...f.observer!, t: f.t }));
  const ownAt = selectedTime !== null ? ([...rows].reverse().find((m) => m.t <= at)?.observer ?? ownHistory.at(-1) ?? own) : own;
  const op = xy(ownAt),
    last = rows.filter((m) => m.t <= at).at(-1);
  const shown = rows.filter((m) => m.t <= at).filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / 12)) === 0 || i === a.length - 1);
  const fit = () => {
    const p = estimate.motion
      ? positionAt(estimate.motion, at)
      : last?.range !== undefined
        ? measuredPosition(last)
        : { n: own.n + Math.cos((track?.bearing ?? 45) * D) * range * 0.6, e: own.e + Math.sin((track?.bearing ?? 45) * D) * range * 0.6 };
    setCenter({ n: (own.n + p.n) / 2, e: (own.e + p.e) / 2 });
    setSpan(clamp(Math.max(Math.abs(p.e - own.e) * 1.8, ((Math.abs(p.n - own.n) * W) / H) * 1.8, 2000), 500, 100000));
  };
  useEffect(() => {
    setDraft(null);
  }, [track?.id, track?.tma]);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      setSpan((v) => clamp(v * Math.exp(ev.deltaY * 0.001), 500, 100000));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const ownLabels = ownHistory.filter((_, i) => i % Math.max(1, Math.ceil(ownHistory.length / 6)) === 0).filter((p, i, all) => i === 0 || Math.hypot(p.n - all[i - 1].n, p.e - all[i - 1].e) * scale > 40);
  const ticks: { n: number; e: number }[] = [],
    gridStep = 10 ** Math.floor(Math.log10(span / 6));
  const step = span / gridStep > 16 ? gridStep * 5 : span / gridStep > 8 ? gridStep * 2 : gridStep;
  for (let e = Math.floor((center.e - span / 2) / step) * step; e < center.e + span / 2; e += step) ticks.push({ e, n: NaN });
  for (let n = Math.floor((center.n - H / scale / 2) / step) * step; n < center.n + H / scale / 2; n += step) ticks.push({ n, e: NaN });
  const ruleA = rule[0] ? xy(rule[0]) : null,
    ruleB = rule[1] ? xy(rule[1]) : null;
  function finish(ev: React.PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    if (drag.current.kind !== 'pan' && draft) onMotion(draft);
    drag.current = null;
    setDraft(null);
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) ev.currentTarget.releasePointerCapture(ev.pointerId);
  }
  return (
    <>
      <div className="tma-map-wrap">
        <svg
          ref={svg}
          className="tma-map"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Plotagem TMA interativa: posições próprias, marcações e estimativa do contato"
          onPointerDown={(ev) => {
            if (ev.button !== 0) return;
            const p = point(ev);
            if (ruler) {
              setRule(rule.length === 1 ? [...rule, world(p.x, p.y)] : [world(p.x, p.y)]);
              return;
            }
            const kind = editing && motion ? (ev.target as Element).getAttribute('data-handle') : null;
            drag.current = { ...p, center: { ...center }, kind: kind === 'target' || kind === 'vector' ? kind : 'pan', motion };
            ev.currentTarget.setPointerCapture(ev.pointerId);
          }}
          onPointerMove={(ev) => {
            const d = drag.current;
            if (!d) return;
            const p = point(ev);
            if (d.kind === 'pan') setCenter({ e: d.center.e - (p.x - d.x) / scale, n: d.center.n + (p.y - d.y) / scale });
            else if (d.motion) {
              const w = world(p.x, p.y),
                base = positionAt(d.motion, at);
              if (d.kind === 'target') setDraft({ ...d.motion, t: at, n: w.n, e: w.e });
              else {
                const vn = (w.n - base.n) / 120,
                  ve = (w.e - base.e) / 120,
                  f = Math.min(1, 25 / Math.max(1e-6, Math.hypot(vn, ve)));
                setDraft({ ...d.motion, vn: vn * f, ve: ve * f });
              }
            }
          }}
          onPointerUp={finish}
          onPointerCancel={() => {
            drag.current = null;
            setDraft(null);
          }}
        >
          <defs>
            <radialGradient id={`${clip}bg`}>
              <stop stopColor="#103448" />
              <stop offset="1" stopColor="#05121f" />
            </radialGradient>
            <clipPath id={clip}>
              <rect width={W} height={H} rx="8" />
            </clipPath>
            <marker id={`${clip}arrow`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0 0L6 3L0 6" fill="none" stroke="#ffc76b" />
            </marker>
          </defs>
          <rect width={W} height={H} fill={`url(#${clip}bg)`} />
          <g clipPath={`url(#${clip})`}>
            {ticks.map((p, i) =>
              Number.isNaN(p.n) ? (
                <line key={i} x1={xy({ ...p, n: 0 }).x} x2={xy({ ...p, n: 0 }).x} y1="0" y2={H} stroke="#284453" opacity=".4" />
              ) : (
                <line key={i} x1="0" x2={W} y1={xy({ ...p, e: 0 }).y} y2={xy({ ...p, e: 0 }).y} stroke="#284453" opacity=".4" />
              ),
            )}
            {[1, 2, 3, 4].map((i) => (
              <g key={i}>
                <circle cx={op.x} cy={op.y} r={step * i * scale} fill="none" stroke="#29879b" strokeDasharray="5 8" opacity=".28" />
                <text x={op.x + 5} y={op.y - step * i * scale + 14} fill="#6992a7" fontSize="11">
                  {((step * i) / 1852).toFixed(1)} MN
                </text>
              </g>
            ))}
            {last &&
              last.range === undefined &&
              !motion &&
              (() => {
                const a = (last.bearing - last.sigma * 2) * D,
                  b = (last.bearing + last.sigma * 2) * D,
                  o = xy(last.observer),
                  r = span * scale;
                return <path d={`M${o.x} ${o.y}L${o.x + Math.sin(a) * r} ${o.y - Math.cos(a) * r}A${r} ${r} 0 0 1 ${o.x + Math.sin(b) * r} ${o.y - Math.cos(b) * r}Z`} fill="#3dd9e4" opacity=".07" />;
              })()}
            {shown.map((m, i) => {
              const p = xy(m.observer),
                a = m.bearing * D,
                length = m.range ?? span,
                end = xy({ n: m.observer.n + Math.cos(a) * length, e: m.observer.e + Math.sin(a) * length });
              return (
                <g key={`${m.t}/${i}`} opacity={selectedTime === m.t ? 1 : 0.2 + (0.55 * (i + 1)) / shown.length}>
                  <line x1={p.x} y1={p.y} x2={end.x} y2={end.y} stroke={m.mode === 'active' ? '#ffc76b' : '#61e0ec'} strokeWidth={selectedTime === m.t ? 2 : 1} />
                  {m.range !== undefined && <circle cx={end.x} cy={end.y} r="5" fill="#ffc76b" />}
                  <circle cx={p.x} cy={p.y} r="5" fill="#64e5ea" className="tma-observation" onPointerDown={(ev) => ev.stopPropagation()} onClick={() => onTime(m.t)}>
                    <title>
                      {timeLabel(m.t)} · {m.bearing.toFixed(1)}° · selecionar observação
                    </title>
                  </circle>
                </g>
              );
            })}
            <polyline
              points={ownHistory
                .map((p) => {
                  const q = xy(p);
                  return `${q.x},${q.y}`;
                })
                .join(' ')}
              fill="none"
              stroke="#53d9e4"
              strokeWidth="2"
            />
            {ownLabels.map((p) => {
              const q = xy(p);
              return (
                <g key={p.t}>
                  <circle cx={q.x} cy={q.y} r="3" fill="#8bf4ef" />
                  <text x={q.x + 8} y={q.y + 18} fill="#84a9bc" fontSize="11">
                    {timeLabel(p.t)}
                  </text>
                </g>
              );
            })}
            {motion && target && tp && vector && (
              <g>
                {estimate.kind !== 'manual' && !draft && (
                  <ellipse
                    cx={tp.x}
                    cy={tp.y}
                    rx={Math.max(5, estimate.uncertainty * scale)}
                    ry={Math.max(4, Math.min(estimate.uncertainty, Math.hypot(target.n - ownAt.n, target.e - ownAt.e) * (last?.sigma ?? 2) * D) * scale)}
                    transform={`rotate(${90 - (track?.bearing ?? 0)} ${tp.x} ${tp.y})`}
                    fill="#ffbc53"
                    fillOpacity=".09"
                    stroke="#d8a34f"
                    strokeDasharray="6 5"
                  />
                )}
                <polyline
                  points={[rows[0]?.t ?? at - 60, at, at + 120]
                    .map((t) => {
                      const p = xy(positionAt(motion, t));
                      return `${p.x},${p.y}`;
                    })
                    .join(' ')}
                  fill="none"
                  stroke="#ffc76b"
                  strokeWidth="2"
                  strokeDasharray="7 5"
                />
                <line x1={tp.x} y1={tp.y} x2={vector.x} y2={vector.y} stroke="#ffc76b" strokeWidth="2" markerEnd={`url(#${clip}arrow)`} />
                <circle cx={tp.x} cy={tp.y} r="14" fill="#ffbe56" fillOpacity=".15" stroke="#ffc76b" />
                <circle data-handle="target" cx={tp.x} cy={tp.y} r="20" fill="transparent" className={editing ? 'tma-handle' : ''} />
                <circle cx={tp.x} cy={tp.y} r="4" fill="#ffcf7f" pointerEvents="none" />
                <text x={tp.x + 20} y={tp.y + 28} fill="#ffd596" fontSize="14">
                  {track?.id} · {estimate.kind === 'manual' || draft ? 'hipótese' : 'estimado'}
                </text>
                {editing && (
                  <circle data-handle="vector" cx={vector.x} cy={vector.y} r="9" fill="#102b3b" stroke="#ffc76b" strokeWidth="2" className="tma-handle">
                    <title>Arraste para ajustar rumo e velocidade (vetor de 2 min)</title>
                  </circle>
                )}
              </g>
            )}
            <g transform={`translate(${op.x} ${op.y}) rotate(${ownAt.heading})`}>
              <path d="M0 -18C7 -10 7 10 3 15L7 19L-7 19L-3 15C-7 10 -7 -10 0 -18" fill="#64e7ed" />
              <line y1="-30" y2="-21" stroke="#b3ffff" />
            </g>
            {ruleA && ruleB && (
              <g stroke="#e7f4f6">
                <line x1={ruleA.x} y1={ruleA.y} x2={ruleB.x} y2={ruleB.y} strokeDasharray="4 3" />
                <circle cx={ruleA.x} cy={ruleA.y} r="4" fill="#d7eff1" />
                <circle cx={ruleB.x} cy={ruleB.y} r="4" fill="#d7eff1" />
              </g>
            )}
          </g>
          <text x="24" y="30" fill="#8ac0d3" fontSize="13">
            N ↑
          </text>
          <text x={W - 20} y="28" textAnchor="end" fill="#83acbe" fontSize="12">
            Grade {(step / 1000).toFixed(1)} km · norte para cima
          </text>
          <g transform={`translate(${W - 160} ${H - 28})`}>
            <line x2={1000 * scale} stroke="#9fbdce" />
            <path d={`M0 -4V4M${1000 * scale} -4V4`} stroke="#9fbdce" />
            <text y="-8" fill="#9fbdce" fontSize="11">
              1 km
            </text>
          </g>
        </svg>
        <div className="tma-map-tools">
          <button title="Aproximar" aria-label="Aproximar TMA" onClick={() => setSpan(clamp(span / 1.4, 500, 100000))}>
            ＋
          </button>
          <button title="Afastar" aria-label="Afastar TMA" onClick={() => setSpan(clamp(span * 1.4, 500, 100000))}>
            −
          </button>
          <button title="Enquadrar contato e submarino" aria-label="Enquadrar TMA" onClick={fit}>
            ⌖
          </button>
          <button
            className={ruler ? 'active' : ''}
            aria-pressed={ruler}
            title="Régua: clique em dois pontos"
            onClick={() => {
              setRuler(!ruler);
              setRule([]);
            }}
          >
            ↔
          </button>
        </div>
        {!track && (
          <div className="tma-empty">
            <b>Escute. Marque. Acompanhe.</b>
            <span>Selecione um contato ou marque uma direção na cascata.</span>
          </div>
        )}
        {rule.length > 0 && (
          <div className="tma-ruler-readout">
            {rule.length === 1
              ? 'Clique no segundo ponto'
              : `${(Math.hypot(rule[1].n - rule[0].n, rule[1].e - rule[0].e) / 1000).toFixed(2)} km · ${wrap(Math.atan2(rule[1].e - rule[0].e, rule[1].n - rule[0].n) / D).toFixed(0)}°`}
          </div>
        )}
      </div>
      <div className="tma-legend">
        <span className="cyan">● Próprio navio / marcações</span>
        <span className="amber">● Ecos / solução estimada</span>
        <span>{editing ? 'Arraste o alvo e a ponta do vetor de 2 min' : 'Arraste o mapa · roda para zoom'}</span>
      </div>
    </>
  );
}
export function BearingHistory({ rows, motion, selectedTime, onTime }: { rows: Measurement[]; motion?: TmaMotion; selectedTime: number | null; onTime: (t: number | null) => void }) {
  const unwrapped = unwrapBearings(rows),
    first = rows[0]?.t ?? 0,
    last = rows.at(-1)?.t ?? 60,
    span = Math.max(10, last - first);
  const low = Math.floor(((unwrapped.length ? Math.min(...unwrapped) : 0) - 5) / 10) * 10,
    high = Math.max(low + 20, Math.ceil(((unwrapped.length ? Math.max(...unwrapped) : 90) + 5) / 10) * 10);
  const x = (t: number) => 52 + ((t - first) / span) * 818,
    y = (b: number) => 155 - ((b - low) / (high - low)) * 125;
  const predictions = motion ? rows.map((m, i) => unwrapped[i] + angleDiff(predictedBearing(motion, m), m.bearing)) : [];
  return (
    <svg
      className="tma-history"
      viewBox="0 0 900 190"
      role="img"
      aria-label="Gráfico de marcação por tempo, medidas e previsão TMA"
      onClick={(ev) => {
        if (!rows.length) return;
        const r = ev.currentTarget.getBoundingClientRect(),
          t = first + ((((ev.clientX - r.left) / r.width) * 900 - 52) / 818) * span;
        onTime(rows.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a)).t);
      }}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line x1="52" x2="870" y1={y(low + ((high - low) * i) / 4)} y2={y(low + ((high - low) * i) / 4)} stroke="#183c50" />
          <text x="44" y={y(low + ((high - low) * i) / 4) + 4} textAnchor="end" fill="#779bb0" fontSize="11">
            {wrap(low + ((high - low) * i) / 4).toFixed(0)}°
          </text>
          <text x={52 + (i * 818) / 4} y="180" textAnchor={i === 4 ? 'end' : 'start'} fill="#779bb0" fontSize="11">
            {timeLabel(first + (span * i) / 4)}
          </text>
        </g>
      ))}
      {motion && <polyline points={rows.map((m, i) => `${x(m.t)},${clamp(y(predictions[i]), 8, 164)}`).join(' ')} stroke="#ffc76b" strokeWidth="2" fill="none" />}
      {rows.map((m, i) => (
        <circle key={i} cx={x(m.t)} cy={y(unwrapped[i])} r={selectedTime === m.t ? 5 : 2.5} fill={m.mode === 'active' ? '#ffc76b' : '#57dce8'}>
          <title>
            {timeLabel(m.t)} · {m.bearing.toFixed(1)}°
          </title>
        </circle>
      ))}
      {selectedTime !== null && <line x1={x(selectedTime)} x2={x(selectedTime)} y1="12" y2="158" stroke="#e4edef" strokeDasharray="3 4" />}
      {!rows.length && (
        <text x="450" y="92" textAnchor="middle" fill="#819dac" fontSize="14">
          As marcações do contato aparecerão aqui
        </text>
      )}
    </svg>
  );
}
