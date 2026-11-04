import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { loadPersisted, savePersisted, usePersisted } from '../../ui/persist';
import { runner } from '../../ui/store';
import { clamp } from '../types';
import { bendingText, computeLab, directArrivals, LAB_DEFAULT, LAB_PRESETS, sanitize, SONAR_EQ, targetStatus, type Arrival, type LabSetup } from './model';
import { drawDynamic, drawStatic, fmt, gx, gy, labGeometry, probe, raySubset, rOf, thermoHandle, zOf, type LabGeo, type LabShow } from './draw';
import './lab.css';

type DragKind = 'sub' | 'target' | 'thermo';
const PATH_LABEL: Record<Arrival['kind'], string> = { direto: 'direto', superfície: 'refletido na superfície', fundo: 'refletido no fundo', várias: 'várias reflexões' };
const SHOW_DEFAULT: LabShow = { front: true, rays: true, field: true, shadow: true };
const km = (m: number, d = 2) => `${fmt(m / 1000, d)} km`;

/**
 * Laboratório acústico: corte vertical com a frente de onda curva calculada pelos raios do sonar.
 * Arrastar submarino, alvo e termoclina recalcula na hora. Não altera a simulação.
 */
export const AcousticLab = memo(function AcousticLab() {
  const [setup, setSetup] = useState<LabSetup>(() => sanitize({ ...LAB_DEFAULT, ...loadPersisted<Partial<LabSetup>>('sonar.lab.setup', {}) }));
  const [preset, setPreset] = usePersisted<string>('sonar.lab.preset', 'camada');
  const [modified, setModified] = usePersisted('sonar.lab.modified', false);
  const [show, setShow] = usePersisted<LabShow>('sonar.lab.show', SHOW_DEFAULT);
  const [speed, setSpeed] = usePersisted('sonar.lab.speed', 0.5);
  const [sound, setSound] = usePersisted('sonar.lab.sound', true);
  const [draft, setDraft] = useState(false);
  const [playing, setPlaying] = useState(true);
  const res = useMemo(() => computeLab(setup, draft ? 91 : 181), [setup, draft]);
  const subset = useMemo(() => raySubset(res.rays), [res.rays]);

  const canvasRef = useRef<HTMLCanvasElement>(null),
    wrapRef = useRef<HTMLDivElement>(null),
    readoutRef = useRef<HTMLSpanElement>(null),
    timeRef = useRef<HTMLSpanElement>(null),
    sliderRef = useRef<HTMLInputElement>(null);
  const live = useRef({ res, subset, show, speed, sound, playing: true, t: 0, staticDirty: true, dirty: true });
  live.current.res = res;
  live.current.subset = subset;
  live.current.show = show;
  live.current.speed = speed;
  live.current.sound = sound;
  const drag = useRef<DragKind | null>(null),
    hover = useRef<{ x: number; y: number } | null>(null),
    geo = useRef<LabGeo | null>(null),
    pending = useRef<Partial<LabSetup> | null>(null),
    audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    live.current.staticDirty = true;
    live.current.dirty = true;
  }, [res, show]);
  useEffect(() => {
    const id = window.setTimeout(() => savePersisted('sonar.lab.setup', setup), 300);
    return () => clearTimeout(id);
  }, [setup]);

  const beep = (gain: number, dur: number) => {
    const ac = audio.current;
    if (!ac || !live.current.sound || ac.state !== 'running') return;
    const o = ac.createOscillator(),
      g = ac.createGain();
    o.type = 'sine';
    o.frequency.value = 1500;
    const now = ac.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g).connect(ac.destination);
    o.start(now);
    o.stop(now + dur + 0.05);
  };

  const ping = () => {
    if ((!audio.current || audio.current.state === 'closed') && typeof AudioContext !== 'undefined') audio.current = new AudioContext();
    audio.current?.resume().catch(() => undefined);
    live.current.t = 0;
    live.current.playing = true;
    live.current.dirty = true;
    setPlaying(true);
    beep(0.22, 0.7);
  };

  // laço de animação e desenho
  useEffect(() => {
    const canvas = canvasRef.current!,
      wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    const still = document.createElement('canvas');
    const sctx = still.getContext('2d')!;
    let raf = 0,
      last = performance.now(),
      w = 0,
      h = 0,
      dpr = 1;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      for (const c of [canvas, still]) {
        c.width = Math.max(1, Math.round(w * dpr));
        c.height = Math.max(1, Math.round(h * dpr));
      }
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      live.current.staticDirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    const loop = (now: number) => {
      const L = live.current;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (pending.current) {
        const patch = pending.current;
        pending.current = null;
        setSetup((prev) => sanitize({ ...prev, ...patch }));
      }
      const r = L.res;
      if (L.playing) {
        const before = L.t;
        L.t += dt * L.speed;
        if (r.echoTime !== null && before < r.echoTime && L.t >= r.echoTime && (r.echoExcess ?? -99) >= SONAR_EQ.threshold) beep(clamp(0.03 + (r.echoExcess! - SONAR_EQ.threshold) / 120, 0.03, 0.2), 0.45);
        if (L.t >= r.timeEnd) {
          L.t = r.timeEnd;
          L.playing = false;
          setPlaying(false);
        }
        L.dirty = true;
      }
      if (w > 0 && h > 0) {
        const g = labGeometry(w, h, r);
        geo.current = g;
        if (L.staticDirty) {
          sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          drawStatic(sctx, g, r, L.show);
          L.staticDirty = false;
          L.dirty = true;
        }
        if (L.dirty) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(still, 0, 0);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const t = Math.min(L.t, r.timeEnd);
          drawDynamic(ctx, g, r, L.show, { t, overview: !L.playing && t >= r.timeEnd - 0.011, hover: hover.current, drag: drag.current }, L.subset);
          if (timeRef.current) timeRef.current.textContent = `t = ${fmt(t, 2)} s · o som percorreu ≈ ${km(t * r.cSub, 1)}`;
          if (sliderRef.current && document.activeElement !== sliderRef.current) {
            sliderRef.current.max = String(r.timeEnd);
            sliderRef.current.value = String(t);
          }
          L.dirty = false;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    // primeira visita: um ping automático para mostrar a onda
    live.current.t = 0;
    live.current.playing = true;
    return () => {
      const ac = audio.current;
      audio.current = null;
      if (ac && ac.state !== 'closed') ac.close().catch(() => undefined);
    };
  }, []);

  const local = (ev: ReactPointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };
  const hit = (x: number, y: number, touch: boolean): DragKind | null => {
    const g = geo.current,
      s = live.current.res.setup;
    if (!g) return null;
    const R = touch ? 26 : 18;
    if (Math.hypot(x - gx(g, 0) - 4, y - gy(g, s.subDepth)) < R) return 'sub';
    if (Math.hypot(x - gx(g, s.targetRange), y - gy(g, s.targetDepth)) < R) return 'target';
    const th = thermoHandle(g, live.current.res);
    if (th && ((x >= g.px0 && x <= g.px1 && Math.abs(y - th.y) < (touch ? 18 : 12)) || (x > g.x0 && x < g.x1 && Math.abs(y - th.y) < (touch ? 9 : 5)))) return 'thermo';
    return null;
  };
  const onDown = (ev: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = local(ev);
    const kind = hit(p.x, p.y, ev.pointerType === 'touch');
    if (!kind) return;
    ev.preventDefault();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    drag.current = kind;
    setDraft(true);
    live.current.dirty = true;
  };
  const onMove = (ev: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = local(ev);
    hover.current = p;
    live.current.dirty = true;
    const g = geo.current;
    if (!g) return;
    const kind = drag.current;
    if (kind) {
      const z = Math.round(zOf(g, p.y));
      pending.current = kind === 'sub' ? { subDepth: z } : kind === 'thermo' ? { thermoclineDepth: z } : { targetDepth: z, targetRange: Math.round(rOf(g, p.x) / 50) * 50 };
      return;
    }
    const over = hit(p.x, p.y, ev.pointerType === 'touch');
    ev.currentTarget.style.cursor = over === 'thermo' ? 'ns-resize' : over ? 'grab' : 'crosshair';
    const q = probe(g, live.current.res, p.x, p.y);
    if (readoutRef.current)
      readoutRef.current.textContent = q
        ? `${km(q.r)} · ${fmt(q.z)} m · ${q.loss === Infinity ? 'nenhum raio chega' : `perda ${fmt(q.loss)} dB`}${q.shadow ? ' · zona de sombra' : ''}`
        : 'Passe o ponteiro sobre a água para medir.';
  };
  const onUp = (ev: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return;
    ev.currentTarget.releasePointerCapture(ev.pointerId);
    drag.current = null;
    setDraft(false);
    setModified(true);
    live.current.dirty = true;
  };

  const change = (patch: Partial<LabSetup>) => {
    setSetup((prev) => sanitize({ ...prev, ...patch }));
    setModified(true);
  };
  const applyPreset = (id: string) => {
    const p = LAB_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setSetup(sanitize({ ...LAB_DEFAULT, ...p.setup }));
    setPreset(id);
    setModified(false);
    ping();
  };
  const fromSimulation = () => {
    const e = runner.engine,
      c = e.env.cfg,
      pos = e.state.body.pos;
    setSetup((prev) =>
      sanitize({
        ...prev,
        uniform: !!e.state.sonar?.settings.homogeneous,
        surfaceTemperature: c.surfaceTemperature,
        deepTemperature: c.deepTemperature,
        thermoclineDepth: c.thermoclineDepth,
        thermoclineThickness: c.thermoclineThickness,
        bottomDepth: Math.round(Math.max(30, e.env.bottomDepthAt(pos.x, pos.y))),
        subDepth: Math.round(Math.max(2, pos.z)),
      }),
    );
    setPreset('atual');
    setModified(false);
    ping();
  };

  const current = LAB_PRESETS.find((p) => p.id === preset);
  const status = targetStatus(res);
  const direct = directArrivals(res);
  const slant = Math.hypot(res.setup.targetRange, res.setup.targetDepth - res.setup.subDepth);
  const toggle = (k: keyof LabShow) => setShow({ ...show, [k]: !show[k] });
  const s = res.setup;

  return (
    <div className="alab">
      <div className="alab-presets" role="group" aria-label="Experimentos prontos">
        {LAB_PRESETS.map((p) => (
          <button key={p.id} className={preset === p.id ? 'active' : ''} aria-pressed={preset === p.id} onClick={() => applyPreset(p.id)}>
            {p.label}
          </button>
        ))}
        <button className={preset === 'atual' ? 'active' : ''} aria-pressed={preset === 'atual'} onClick={fromSimulation} title="Temperatura da água, fundo sob o navio e profundidade atuais da simulação">
          Mar do simulador agora
        </button>
      </div>
      <p className="alab-hint">
        <b>Arraste</b> o seu submarino, o alvo e a termoclina (↕ no perfil). <b>Emitir ping</b> mostra o som viajando; o eco volta em rosa.
      </p>
      <div className="alab-stage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Corte vertical do mar com a frente de onda do ping, raios sonoros, zona de sombra e perfil de velocidade do som"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => {
            hover.current = null;
            live.current.dirty = true;
          }}
        />
      </div>
      <div className="alab-transport">
        <button className="ping-button" onClick={ping}>
          ◉ EMITIR PING
        </button>
        <button
          aria-label={playing ? 'Pausar' : 'Continuar'}
          onClick={() => {
            const L = live.current;
            if (!L.playing && L.t >= L.res.timeEnd - 0.011) L.t = 0;
            L.playing = !L.playing;
            L.dirty = true;
            setPlaying(L.playing);
          }}
        >
          {playing ? 'Ⅱ' : '▶'}
        </button>
        <input
          ref={sliderRef}
          type="range"
          aria-label="Instante do ping"
          min="0"
          max={res.timeEnd}
          step="0.01"
          defaultValue="0"
          onChange={(ev) => {
            const L = live.current;
            // o controle arredonda para 0,01 s: no fim, vale o fim exato
            L.t = +ev.target.value >= L.res.timeEnd - 0.011 ? L.res.timeEnd : +ev.target.value;
            L.playing = false;
            L.dirty = true;
            setPlaying(false);
          }}
        />
        <select aria-label="Velocidade da animação" value={speed} onChange={(ev) => setSpeed(+ev.target.value)}>
          <option value={1}>tempo real</option>
          <option value={0.5}>½ velocidade</option>
          <option value={0.25}>¼ velocidade</option>
        </select>
        <button className={sound ? 'active' : ''} aria-pressed={sound} onClick={() => setSound(!sound)} title="Som do ping e do eco">
          {sound ? '🔊 Som' : '🔈 Mudo'}
        </button>
        <span className="alab-time" ref={timeRef} />
      </div>
      <div className="alab-legend" role="group" aria-label="O que mostrar">
        <button className={show.front ? 'active' : ''} aria-pressed={show.front} onClick={() => toggle('front')}>
          <i className="sw front" /> Frente de onda
        </button>
        <button className={show.rays ? 'active' : ''} aria-pressed={show.rays} onClick={() => toggle('rays')}>
          <i className="sw ray" /> Raios
        </button>
        <button className={show.field ? 'active' : ''} aria-pressed={show.field} onClick={() => toggle('field')}>
          <i className="sw field" /> Intensidade do som
        </button>
        <button className={show.shadow ? 'active' : ''} aria-pressed={show.shadow} onClick={() => toggle('shadow')}>
          <i className="sw shadow" /> Zona de sombra
        </button>
        <span className="alab-key">
          <i className="sw echo" /> eco
        </span>
        <span className="alab-key">
          <i className="sw thermo" /> termoclina
        </span>
        <span className="alab-readout" ref={readoutRef}>
          Passe o ponteiro sobre a água para medir.
        </span>
      </div>

      <div className="alab-cards">
        <section className="alab-card">
          <h3>
            O que está acontecendo
            {current && <small>{modified ? `${current.label} · modificado` : current.label}</small>}
          </h3>
          {current && <p className="alab-note">{current.note}</p>}
          {preset === 'atual' && <p className="alab-note">Perfil de temperatura, fundo sob o navio e profundidade atuais da simulação (aqui o fundo é plano).</p>}
          <p>{bendingText(res)}</p>
          <p className="alab-rule">Regra: o som se curva para o lado em que anda mais devagar.</p>
          {res.shadow && show.shadow && <p>A área hachurada é a zona de sombra: o som direto não chega lá. Um alvo nela não ouve o seu ping, e você também não o ouve.</p>}
          <p className={`alab-status ${status.tone}`} role="status">
            <b>{status.tone === 'ok' ? '● ECO DETECTÁVEL' : status.tone === 'weak' ? '▲ ECO FRACO' : '✕ SEM ECO'}</b> {status.text}
          </p>
        </section>

        <section className="alab-card">
          <h3>Eco e distância</h3>
          {res.strongest && res.echoTime !== null && res.measuredRange !== null ? (
            <>
              <dl className="alab-facts">
                <dt>Ida até o alvo</dt>
                <dd>
                  {fmt(res.strongest.time, 2)} s · {PATH_LABEL[res.strongest.kind]}
                </dd>
                <dt>Eco de volta</dt>
                <dd>{fmt(res.echoTime, 2)} s depois do ping</dd>
                <dt>Distância calculada</dt>
                <dd>
                  c × t ÷ 2 = {fmt(res.cSub)} × {fmt(res.echoTime, 2)} ÷ 2 = <b>{km(res.measuredRange)}</b>
                  <small> (real: {km(slant)})</small>
                </dd>
                <dt>Força do eco</dt>
                <dd>
                  {SONAR_EQ.source} − 2×{fmt(res.strongest.loss)} + {SONAR_EQ.target} − {SONAR_EQ.noise} − {SONAR_EQ.reverb} = <b>{fmt(res.echoExcess ?? 0)} dB</b>
                  <small>
                    {' '}
                    ({(res.echoExcess ?? -99) >= SONAR_EQ.threshold ? 'acima' : 'abaixo'} do limiar de {SONAR_EQ.threshold} dB)
                  </small>
                </dd>
              </dl>
              <p className="alab-small">
                Força do eco = fonte − 2 × perda (ida e volta) + reflexão do alvo − ruído − reverberação. Caminhos até o alvo:{' '}
                {res.arrivals
                  .slice(0, 4)
                  .map((a) => `${PATH_LABEL[a.kind]} ${fmt(a.loss)} dB`)
                  .join(' · ')}
                {!direct.length && ' — nenhum direto.'}
              </p>
            </>
          ) : (
            <p>Nenhum raio chega ao alvo: não há eco para medir a distância.</p>
          )}
        </section>

        <section className="alab-card alab-controls">
          <h3>Água e posições</h3>
          <label className="alab-check">
            <input type="checkbox" checked={s.uniform} onChange={(ev) => change({ uniform: ev.target.checked })} /> Água uniforme (1500 m/s em todo lugar)
          </label>
          <Slider label="Temperatura na superfície" unit="°C" min={0} max={32} step={0.5} value={s.surfaceTemperature} disabled={s.uniform} onChange={(v) => change({ surfaceTemperature: v })} />
          <Slider label="Temperatura funda" unit="°C" min={0} max={32} step={0.5} value={s.deepTemperature} disabled={s.uniform} onChange={(v) => change({ deepTemperature: v })} />
          <Slider label="Termoclina" unit="m" min={5} max={Math.min(800, s.bottomDepth)} step={1} value={s.thermoclineDepth} disabled={s.uniform} onChange={(v) => change({ thermoclineDepth: v })} />
          <Slider label="Espessura da termoclina" unit="m" min={3} max={150} step={1} value={s.thermoclineThickness} disabled={s.uniform} onChange={(v) => change({ thermoclineThickness: v })} />
          <Slider label="Fundo" unit="m" min={30} max={1500} step={10} value={s.bottomDepth} onChange={(v) => change({ bottomDepth: v })} />
          <Slider label="Sua profundidade" unit="m" min={2} max={s.bottomDepth - 2} step={1} value={s.subDepth} onChange={(v) => change({ subDepth: v })} />
          <Slider label="Distância do alvo" unit="km" min={s.range * 0.05} max={s.range * 0.98} step={50} value={s.targetRange} scale={1000} onChange={(v) => change({ targetRange: v })} />
          <Slider label="Profundidade do alvo" unit="m" min={2} max={s.bottomDepth - 2} step={1} value={s.targetDepth} onChange={(v) => change({ targetDepth: v })} />
          <label className="alab-row">
            Largura do corte
            <select value={s.range} onChange={(ev) => change({ range: +ev.target.value, targetRange: (s.targetRange / s.range) * +ev.target.value })}>
              {Array.from(new Set([2000, 5000, 8000, 12000, 20000, s.range]))
                .sort((a, b) => a - b)
                .map((v) => (
                  <option key={v} value={v}>
                    {v / 1000} km
                  </option>
                ))}
            </select>
          </label>
        </section>
      </div>
    </div>
  );
});

function Slider(p: { label: string; unit: string; min: number; max: number; step: number; value: number; scale?: number; disabled?: boolean; onChange: (v: number) => void }) {
  const k = p.scale ?? 1;
  return (
    <label className="alab-slider">
      <span>
        {p.label}{' '}
        <b>
          {fmt(p.value / k, k > 1 ? 1 : p.step < 1 ? 1 : 0)} {p.unit}
        </b>
      </span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} disabled={p.disabled} onChange={(ev) => p.onChange(+ev.target.value)} />
    </label>
  );
}
