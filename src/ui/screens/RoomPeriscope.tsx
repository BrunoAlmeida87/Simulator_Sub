/**
 * VISADA DO PERISCÓPIO DE ATAQUE: cena externa com a câmera na cabeça do
 * periscópio, retículo, régua de marcação verdadeira, identificação dos
 * contatos à vista (auxílio de treinamento), ESTADÍMETRO (distância pela
 * altura do mastro do alvo), MARCAR (a marcação vai para o quadro tático e a
 * mesa), varredura de 360°, três aumentos, tempo de exposição e aviso de
 * esteira. Só lê o estado; içar/arriar é o comando registrado de sempre.
 */
import { useEffect, useRef, useState } from 'react';
import { cmd, runner, useSim } from '../store';
import { usePersisted } from '../persist';
import { Scene3D, defaultQuality } from '../components/Scene3D';
import type { PeriscopeSight } from '../../render3d/SubmarineScene';
import type { RoomActions } from '../../render3d/controlRoom/actions';
import { periHeadAbove, periVisible, stadimeter, type PeriContact } from '../../render3d/controlRoom/periscope';
import { periMarks } from './periMarks';
import { toKnots } from '../../sim/units';
import { fmt } from '../format';

export const PERI_POWERS: { fov: number; label: string }[] = [
  { fov: 32, label: '1,5×' },
  { fov: 8, label: '6×' },
  { fov: 4, label: '12×' },
];

const wrap180 = (b: number) => ((((b + 180) % 360) + 360) % 360) - 180;
const wrap360 = (b: number) => ((b % 360) + 360) % 360;
const deg3 = (b: number) => String(Math.round(wrap360(b)) % 360).padStart(3, '0');
const CARD: Record<number, string> = { 0: 'N', 90: 'L', 180: 'S', 270: 'O' };
const km = (m: number) => `${fmt(m / 1000, m < 10000 ? 1 : 0)} km`;

/** régua de marcação verdadeira no alto da ocular */
function BearingTape({ w, los, tanH, cts, ids }: { w: number; los: number; tanH: number; cts: PeriContact[]; ids: boolean }) {
  const half = (Math.atan(tanH) * 180) / Math.PI;
  const X = (off: number) => w / 2 + (Math.tan((off * Math.PI) / 180) / tanH) * (w / 2);
  const L = half * 2 > 30 ? 10 : half * 2 > 10 ? 5 : 2;
  const minor = L / 5 >= 1 ? L / 5 : 0.5;
  const ticks: { x: number; b: number; major: boolean }[] = [];
  const b0 = Math.ceil((los - half) / minor) * minor;
  for (let b = b0; b <= los + half + 1e-9; b += minor) ticks.push({ x: X(b - los), b: wrap360(Math.round(b * 10) / 10), major: Math.abs(b / L - Math.round(b / L)) < 1e-6 });
  const left = cts.filter((c) => c.off < -half).sort((a, b) => b.off - a.off);
  const right = cts.filter((c) => c.off > half).sort((a, b) => a.off - b.off);
  return (
    <svg className="room-peri-tape" width={w} height={54} viewBox={`0 0 ${w} 54`}>
      <rect x={0} y={0} width={w} height={54} fill="rgba(0,0,0,0.55)" />
      {ticks.map((t) => (
        <g key={t.x.toFixed(1)}>
          <line x1={t.x} y1={0} x2={t.x} y2={t.major ? 16 : 8} stroke="#ffcf6b" strokeWidth={t.major ? 2 : 1} />
          {t.major && (
            <text x={t.x} y={32} fill={CARD[t.b] ? '#ff9f43' : '#ffcf6b'} fontSize={CARD[t.b] ? 17 : 14} fontWeight="bold" textAnchor="middle" fontFamily="monospace">
              {CARD[t.b] ?? String(Math.round(t.b) % 360).padStart(3, '0')}
            </text>
          )}
        </g>
      ))}
      {ids &&
        cts
          .filter((c) => Math.abs(c.off) <= half)
          .map((c) => (
            <g key={c.id}>
              <path d={`M ${X(c.off) - 6} 52 L ${X(c.off)} 42 L ${X(c.off) + 6} 52 Z`} fill="#4cd964" />
            </g>
          ))}
      <path d={`M ${w / 2 - 8} 0 L ${w / 2} 12 L ${w / 2 + 8} 0 Z`} fill="#fff" />
      <text x={w / 2} y={50} fill="#fff" fontSize={15} fontWeight="bold" textAnchor="middle" fontFamily="monospace">
        {deg3(los)}°
      </text>
      {ids && left.length > 0 && (
        <text x={6} y={50} fill="#4cd964" fontSize={13} fontWeight="bold">
          ◀ {left.map((c) => c.id).join(' ')}
        </text>
      )}
      {ids && right.length > 0 && (
        <text x={w - 6} y={50} fill="#4cd964" fontSize={13} fontWeight="bold" textAnchor="end">
          {right.map((c) => c.id).join(' ')} ▶
        </text>
      )}
    </svg>
  );
}

export function RoomPeriscope({ sight, setSight, onExit, acts }: { sight: PeriscopeSight; setSight: (s: PeriscopeSight) => void; onExit: () => void; acts: RoomActions }) {
  const e = useSim(10);
  const s = e.state;
  const pr = s.periscope ?? { cmd: false, pos: 0 };
  const raised = pr.pos > 0.97;
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [ids, setIds] = usePersisted('room.periIds', true);
  const [msg, setMsg] = useState<string | null>(null);
  const [fix, setFix] = useState<{ id: string; brg: number; rng: number; t: number } | null>(null);
  const [sweep, setSweep] = useState<{ start: number; t0: number } | null>(null);
  const drag = useRef<{ x: number; y: number; b: number; el: number } | null>(null);
  const exposed = useRef<number | null>(null);
  const sightRef = useRef(sight);
  sightRef.current = sight;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // geometria da ocular
  const { w, h } = size;
  const aspect = w / Math.max(1, h);
  const tanV = Math.tan((sight.fov * Math.PI) / 360);
  const tanH = tanV * aspect;
  const hdg = e.outputs.euler.heading;
  const los = wrap360(hdg + sight.bearing);
  const head = periHeadAbove(e);
  const out = raised && head !== null && head > 0.05;
  const cts = periVisible(e, acts, sight.bearing);
  const kn = toKnots(Math.abs(e.outputs.speed));
  const high = sight.fov <= 8;

  // tempo de exposição (relógio da simulação)
  if (out && exposed.current === null) exposed.current = s.t;
  if (!out) exposed.current = null;
  const expo = exposed.current === null ? null : s.t - exposed.current;

  const turn = (d: number) => setSight({ ...sight, bearing: wrap180(sight.bearing + d) });
  const elev = (d: number) => setSight({ ...sight, elev: Math.max(-10, Math.min(30, sight.elev + d)) });
  const power = (d: number) => {
    const i = PERI_POWERS.findIndex((p) => Math.abs(p.fov - sight.fov) < 0.1);
    const j = Math.max(0, Math.min(PERI_POWERS.length - 1, (i < 0 ? 0 : i) + d));
    setSight({ ...sight, fov: PERI_POWERS[j].fov });
  };
  const centered = () => {
    const tol = Math.max(1.2, ((Math.atan(tanH) * 180) / Math.PI) * 0.12);
    return cts.filter((c) => Math.abs(c.off) < tol).sort((a, b) => Math.abs(a.off) - Math.abs(b.off))[0] ?? null;
  };
  const measure = () => {
    if (!out) return setMsg('Sem visada: ice o periscópio com a cabeça fora d’água.');
    const c = centered();
    if (!c) return setMsg('Estadímetro: ponha o contato no centro do retículo.');
    const r = stadimeter(c, s.t, high);
    setFix({ id: c.id, brg: c.brg, rng: r, t: s.t });
    setMsg(`Estadímetro: ${c.id} (${c.name}) · marcação ${deg3(c.brg)}° · distância ≈ ${km(r)} (mastro ≈ altura da classe; erro ${high ? '±4' : '±9'} %)`);
  };
  const mark = () => {
    if (!raised) return setMsg('Periscópio arriado: nada a marcar.');
    const c = out ? centered() : null;
    const useFix = fix && c && fix.id === c.id && s.t - fix.t < 90 ? fix : null;
    const m = periMarks.add({ t: s.t, n: s.body.pos.x, e: s.body.pos.y, brg: c ? c.brg : los, rng: useFix ? useFix.rng : null, id: c?.id ?? null });
    setMsg(`MARCA ${m.label}: ${deg3(m.brg)}°${m.rng ? ` · ${km(m.rng)}` : ''}${m.id ? ` · ${m.id}` : ''} — no quadro tático e na mesa`);
  };

  // varredura de 360° (≈ 10 s), interrompida ao arrastar
  useEffect(() => {
    if (!sweep) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const k = (now - sweep.t0) / 10000;
      if (k >= 1) {
        setSight({ ...sightRef.current, bearing: sweep.start });
        setSweep(null);
        return;
      }
      if (now - last > 33) {
        last = now;
        setSight({ ...sightRef.current, bearing: wrap180(sweep.start + 360 * k) });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sweep]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const k = ev.key;
      const big = ev.shiftKey;
      if (k === 'Escape') onExit();
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') turn(big ? -10 : -2);
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') turn(big ? 10 : 2);
      else if (k === 'ArrowUp' || k === 'w' || k === 'W') elev(big ? 5 : 1);
      else if (k === 'ArrowDown' || k === 's' || k === 'S') elev(big ? -5 : -1);
      else if (k === 'r' || k === 'R') measure();
      else if (k === 'm' || k === 'M') mark();
      else if (k === 'v' || k === 'V') setSweep(sweep ? null : { start: sight.bearing, t0: performance.now() });
      else return;
      ev.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      power(ev.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const k = sight.fov / 600;
  const horizonY = h / 2 + (Math.tan((sight.elev * Math.PI) / 180) / tanV) * (h / 2);
  const wash = raised && head !== null && head > -0.25 && head < 0.6 ? Math.min(0.8, (0.6 - head) / 0.85) : 0;
  const marks = periMarks.list(s.t).slice(-4);

  return (
    <div
      className="room-peri"
      ref={box}
      onPointerDown={(ev) => {
        (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
        drag.current = { x: ev.clientX, y: ev.clientY, b: sight.bearing, el: sight.elev };
        if (sweep) setSweep(null);
      }}
      onPointerMove={(ev) => {
        const d = drag.current;
        if (!d) return;
        setSight({ ...sight, bearing: wrap180(d.b - (ev.clientX - d.x) * k), elev: Math.max(-10, Math.min(30, d.el + (ev.clientY - d.y) * k)) });
      }}
      onPointerUp={() => (drag.current = null)}
    >
      <Scene3D
        view="periscopio"
        periscope={sight}
        quality={defaultQuality()}
        labels={false}
        syncVisual={false}
        layers={{
          vectors: false,
          hydroVectors: false,
          trimVectors: false,
          tanks: false,
          flows: false,
          pipes: false,
          labels: false,
          batteryInfo: false,
          airInfo: false,
          trail: false,
          trimRef: false,
          noWater: false,
          markers: false,
          wake: true,
          ships: true,
          hull: true,
        }}
      />
      {/* identificação dos contatos (sob a máscara da ocular) */}
      {ids && out && (
        <svg className="room-peri-ids" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          {cts
            .filter((c) => Math.abs(c.off) < 80 && Math.abs(Math.tan((c.off * Math.PI) / 180)) < tanH)
            .map((c) => {
              const x = w / 2 + (Math.tan((c.off * Math.PI) / 180) / tanH) * (w / 2);
              const y = horizonY - 16;
              return (
                <g key={c.id}>
                  <path d={`M ${x - 12} ${y - 12} L ${x - 12} ${y} M ${x + 12} ${y - 12} L ${x + 12} ${y} M ${x - 12} ${y - 12} L ${x + 12} ${y - 12}`} stroke="#4cd964" strokeWidth={2} fill="none" />
                  <text x={x} y={y - 18} fill="#4cd964" fontSize={14} fontWeight="bold" textAnchor="middle">
                    {c.id} · {deg3(c.brg)}°
                  </text>
                </g>
              );
            })}
        </svg>
      )}
      {wash > 0 && <div className="room-peri-wash" style={{ opacity: wash }} />}
      <svg className="room-reticle" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
        <defs>
          <mask id="peri-mask">
            <rect x="-1000" y="-1000" width="2000" height="2000" fill="white" />
            <circle r="92" fill="black" />
          </mask>
        </defs>
        <rect x="-1000" y="-1000" width="2000" height="2000" fill="#000" mask="url(#peri-mask)" />
        <circle r="92" fill="none" stroke="#000" strokeWidth="3" />
        <line x1="-92" y1="0" x2="-8" y2="0" stroke="#111" strokeWidth="0.8" />
        <line x1="8" y1="0" x2="92" y2="0" stroke="#111" strokeWidth="0.8" />
        <line x1="0" y1="-92" x2="0" y2="-8" stroke="#111" strokeWidth="0.8" />
        <line x1="0" y1="8" x2="0" y2="40" stroke="#111" strokeWidth="0.8" />
        {Array.from({ length: 9 }, (_, i) => i - 4)
          .filter((i) => i)
          .map((i) => (
            <line key={i} x1={i * 10} y1="-3" x2={i * 10} y2="3" stroke="#111" strokeWidth="0.7" />
          ))}
        {Array.from({ length: 4 }, (_, i) => i + 1).map((i) => (
          <line key={i} x1="-3" y1={i * 8} x2="3" y2={i * 8} stroke="#111" strokeWidth="0.7" />
        ))}
      </svg>
      {!raised && <div className="room-peri-dark" style={{ opacity: Math.min(1, 1.15 - pr.pos) }} />}
      {!raised && (
        <div className="room-peri-off">
          <b>PERISCÓPIO {pr.cmd ? `IÇANDO… ${Math.round(pr.pos * 100)} %` : 'ARRIADO'}</b>
          <span>{pr.cmd ? 'Aguarde o fim do curso.' : 'Ice o periscópio para olhar.'}</span>
        </div>
      )}
      <BearingTape w={w} los={los} tanH={tanH} cts={cts} ids={ids && out} />
      <div className="room-peri-status" style={{ top: 60 }}>
        <span>
          Cabeça: <b>{head === null ? 'arriada' : head > 0.6 ? `+${fmt(head, 1)} m acima d’água` : head > 0.05 ? 'rente à água (ondas na ocular)' : `submersa ${fmt(-head, 1)} m`}</b>
        </span>
        {expo !== null && <span className={expo > 30 ? 'bad' : expo > 15 ? 'warn' : ''}>Exposição {Math.round(expo)} s</span>}
        {out && kn > 5 && <span className="warn">Esteira do periscópio visível a {fmt(kn, 1)} nós — reduza para ≤ 5 nós</span>}
        {out && <span>{cts.length ? `${cts.length} contato(s) dentro do horizonte` : 'Nenhum contato dentro do horizonte'}</span>}
      </div>
      <div className="room-peri-bar" onPointerDown={(ev) => ev.stopPropagation()}>
        <div className="room-peri-brg mono">
          <span>
            MARCAÇÃO <b>{deg3(los)}°</b>
          </span>
          <span>
            relativa {sight.bearing >= 0 ? 'BE' : 'BB'} {Math.abs(Math.round(sight.bearing))}°
          </span>
          <span>elevação {fmt(sight.elev, 0)}°</span>
          <span>cota {fmt(e.outputs.depthKeel, 1)} m</span>
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn sm" onClick={() => turn(-10)}>
            ◀ 10°
          </button>
          <button className="btn sm" onClick={() => setSight({ ...sight, bearing: 0, elev: 0 })}>
            Proa
          </button>
          <button className="btn sm" onClick={() => turn(10)}>
            10° ▶
          </button>
          <span className="seg">
            {PERI_POWERS.map((p) => (
              <button key={p.label} className={Math.abs(sight.fov - p.fov) < 0.1 ? 'on' : ''} onClick={() => setSight({ ...sight, fov: p.fov })}>
                {p.label}
              </button>
            ))}
          </span>
          <button className={`btn sm ${sweep ? 'on' : ''}`} onClick={() => setSweep(sweep ? null : { start: sight.bearing, t0: performance.now() })} title="Giro completo de vigilância (V)">
            Varredura 360°
          </button>
          <button className="btn sm" onClick={measure} title="Distância pela altura do mastro do contato no centro do retículo (R)">
            Estadímetro
          </button>
          <button className="btn sm ok" onClick={mark} title="Registra a marcação (e a distância medida) no quadro tático e na mesa (M)">
            Marcar
          </button>
          <button className={`btn sm ${ids ? 'on' : ''}`} onClick={() => setIds(!ids)} title="Identificação dos contatos à vista (auxílio de treinamento)">
            IDs
          </button>
          <button className={`btn sm ${pr.cmd ? 'on' : ''}`} onClick={() => cmd({ type: 'periscope', raise: !pr.cmd })}>
            {pr.cmd ? 'Arriar' : 'Içar'}
          </button>
          <button className="btn sm warn" onClick={onExit}>
            Sair (Esc)
          </button>
        </div>
        {msg && <div className="room-peri-msg">{msg}</div>}
        {marks.length > 0 && (
          <div className="room-peri-marks mono">
            {marks.map((m) => (
              <span key={m.label}>
                <b>{m.label}</b> {deg3(m.brg)}°{m.rng ? ` ${km(m.rng)}` : ''}
                {m.id ? ` ${m.id}` : ''}
              </span>
            ))}
          </div>
        )}
        <div className="subtle room-peri-keys">Arraste ou ← → para girar (Shift = 10°) · ↑ ↓ elevação · roda = aumento · R estadímetro · M marcar · V varredura</div>
      </div>
    </div>
  );
}

/** para testes e para a tela do posto: lista das marcações recentes */
export function recentMarks(): string[] {
  return periMarks.list(runner.engine.state.t).map((m) => `${m.label} ${deg3(m.brg)}°${m.rng ? ` ${km(m.rng)}` : ''}`);
}
