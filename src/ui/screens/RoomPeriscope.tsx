/**
 * VISADA DO PERISCÓPIO DE ATAQUE: cena externa com a câmera na cabeça do
 * periscópio e a OCULAR desenhada por cima: retículo graduado em milésimos
 * (a escala muda com o aumento), traves grossas, janela projetada da
 * marcação RELATIVA (anel de marcação do mastro), aumento e elevação, régua
 * de marcação verdadeira, vinheta e franja cromática na borda da óptica,
 * granulação leve e a coluna da cabeça (altura da janela sobre a onda).
 * Na cota periscópica as cristas passam pela cabeça: a vista mergulha, a
 * água escorre e ficam gotas na janela; em velocidade o mastro vibra.
 * Identificação dos contatos (auxílio de treinamento), ESTADÍMETRO (distância
 * pela altura do mastro do alvo, com o colchete na ocular), MARCAR (a
 * marcação vai para o quadro tático e a mesa), varredura de 360°, três
 * aumentos, tempo de exposição e aviso de esteira. Só lê o estado;
 * içar/arriar é o comando registrado de sempre.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cmd, runner, useSim } from '../store';
import { usePersisted } from '../persist';
import { Scene3D, defaultQuality } from '../components/Scene3D';
import type { PeriscopeSight } from '../../render3d/SubmarineScene';
import type { RoomActions } from '../../render3d/controlRoom/actions';
import { TARGET_HEIGHT, periHeadAbove, periHeadClearance, periVisible, stadimeter } from '../../render3d/controlRoom/periscope';
import { periMarks } from './periMarks';
import { toKnots } from '../../sim/units';
import { fmt } from '../format';
import { BearingTape, deg3, km, wrap180, wrap360 } from '../components/OpticsHud';

export const PERI_POWERS: { fov: number; label: string }[] = [
  { fov: 32, label: '1,5×' },
  { fov: 8, label: '6×' },
  { fov: 4, label: '12×' },
];

/** raio do campo da ocular nas unidades do retículo (viewBox −100…100) */
const FIELD = 92;

/**
 * Retículo da ocular em unidades do viewBox (−100…100, "meet"): cruz fina
 * graduada em milésimos (1 mil ≈ 1 m a 1 km), traves grossas nas bordas,
 * janela projetada da marcação relativa no alto, aumento e elevação embaixo.
 */
function Reticle({ uTan, rel, power, elev, lit }: { uTan: number; rel: number; power: string; elev: number; lit: boolean }) {
  const uMil = uTan * 0.001;
  const step = [1, 2, 5, 10, 20, 50, 100].find((x) => x * uMil >= 2.4) ?? 100;
  const lab = [5, 10, 20, 50, 100, 200, 500].find((x) => x % step === 0 && x * uMil >= 15) ?? 500;
  const els: ReactNode[] = [];
  const L = (x1: number, y1: number, x2: number, y2: number, k: string, wd = 0.7) => els.push(<line key={k} className="ret" x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={wd} />);
  // cruz fina (vão no centro) e traves grossas
  L(-62, 0, -5, 0, 'hl');
  L(5, 0, 62, 0, 'hr');
  L(0, -64, 0, -5, 'vu');
  L(0, 5, 0, 60, 'vd');
  L(-FIELD, 0, -62, 0, 'pl', 2.6);
  L(62, 0, FIELD, 0, 'pr', 2.6);
  L(0, 60, 0, FIELD, 'pb', 2.6);
  // graduação horizontal (marcação relativa ao centro, em mil)
  const nH = Math.floor(60 / (step * uMil));
  for (let i = -nH; i <= nH; i++) {
    if (!i) continue;
    const x = i * step * uMil;
    const big = (i * step) % lab === 0;
    L(x, big ? -3.2 : -1.6, x, big ? 3.2 : 1.6, `th${i}`, big ? 0.7 : 0.5);
    if (big && Math.abs(x) > 7)
      els.push(
        <text key={`tn${i}`} className="ret-num" x={x} y={-5} textAnchor="middle">
          {Math.abs(i * step)}
        </text>,
      );
  }
  // graduação vertical acima do centro (estadímetro: altura do alvo em mil)
  const nV = Math.floor(58 / (step * uMil));
  for (let i = 1; i <= nV; i++) {
    const y = -i * step * uMil;
    const big = (i * step) % lab === 0;
    L(big ? -3.2 : -1.6, y, big ? 3.2 : 1.6, y, `tv${i}`, big ? 0.7 : 0.5);
    if (big)
      els.push(
        <text key={`vn${i}`} className="ret-num" x={4.6} y={y + 1.4}>
          {i * step}
        </text>,
      );
  }
  // janela projetada da marcação RELATIVA (anel do mastro), no alto do campo
  const ppd = 1.6;
  const ring: ReactNode[] = [];
  for (let d = Math.floor(rel) - 22; d <= Math.ceil(rel) + 22; d++) {
    const x = (d - rel) * ppd;
    const b = wrap360(d);
    const big = b % 10 === 0;
    ring.push(<line key={`r${d}`} x1={x} y1={-74} x2={x} y2={-74 + (big ? 3.2 : b % 5 === 0 ? 2.2 : 1.2)} />);
    if (big)
      ring.push(
        <text key={`rn${d}`} x={x} y={-67.6} textAnchor="middle">
          {String(b).padStart(3, '0')}
        </text>,
      );
  }
  return (
    <>
      <g className="ret-ink">{els}</g>
      <text className="ret-num" x={58} y={8} textAnchor="end">
        mil
      </text>
      <g className="peri-win">
        <clipPath id="peri-relwin">
          <rect x={-32} y={-75} width={64} height={10} rx={1.5} />
        </clipPath>
        <rect x={-32} y={-75} width={64} height={10} rx={1.5} className="peri-win-bg" />
        <g clipPath="url(#peri-relwin)">{ring}</g>
        <path d="M -1.6 -77.6 L 0 -75 L 1.6 -77.6 Z" className="peri-win-idx" />
        <text x={-37} y={-68} textAnchor="end" className="peri-win-lbl">
          REL
        </text>
        <text x={-60} y={-52} className="peri-win-big">
          {power}
        </text>
        <text x={60} y={-52} textAnchor="end" className="peri-win-big">
          EL {elev >= 0 ? '+' : '−'}
          {Math.abs(Math.round(elev))}°
        </text>
      </g>
      {lit && <circle r={0.8} className="ret-dot" />}
    </>
  );
}

/** coluna da cabeça (à direita da ocular): altura da janela sobre o nível médio, com a onda no ponto */
function HeadGauge({ head, clear }: { head: number; clear: number }) {
  const H = 190;
  const lo = -3;
  const hi = 6;
  const Y = (m: number) => 8 + ((hi - Math.max(lo, Math.min(hi, m))) / (hi - lo)) * (H - 16);
  const water = head - clear; // superfície local (m, relativa ao nível médio)
  return (
    <svg className="room-peri-gauge" width={64} height={H + 20} viewBox={`0 0 64 ${H + 20}`}>
      <rect x={14} y={4} width={22} height={H - 8} rx={3} fill="rgba(0,0,0,0.55)" stroke="#5a4a2a" />
      <rect x={15} y={Y(water)} width={20} height={Math.max(0, H - 5 - Y(water))} fill="rgba(40,110,150,0.75)" />
      <line x1={12} y1={Y(0)} x2={38} y2={Y(0)} stroke="#cfe" strokeDasharray="3 2" />
      {[-2, 0, 2, 4, 6].map((m) => (
        <text key={m} x={10} y={Y(m) + 4} fill="#ffcf6b" fontSize={10} textAnchor="end" fontFamily="monospace">
          {m > 0 ? `+${m}` : m}
        </text>
      ))}
      <path d={`M 38 ${Y(head)} L 48 ${Y(head) - 5} L 48 ${Y(head) + 5} Z`} fill={clear > 0.05 ? '#ffcf6b' : '#ff5a4a'} />
      <rect x={20} y={Y(head) - 2} width={10} height={4} fill={clear > 0.05 ? '#ffcf6b' : '#ff5a4a'} />
      <text x={32} y={H + 14} fill="#ffcf6b" fontSize={11} textAnchor="middle" fontFamily="monospace">
        {clear >= 0 ? '+' : '−'}
        {fmt(Math.abs(clear), 1)} m
      </text>
    </svg>
  );
}

/**
 * Água na janela da cabeça (quadro a quadro, sem React): borrifo quando
 * rente, véu quando a crista cobre a cabeça, água escorrendo e GOTAS que
 * ficam na janela depois que ela sai da água; vibração do mastro em
 * velocidade (mais visível no alto aumento).
 */
function PeriWater({ raised, fov, img, circle }: { raised: boolean; fov: number; img: RefObject<HTMLDivElement>; circle: { x: number; y: number; r: number } }) {
  const wash = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const drops = useRef<HTMLDivElement>(null);
  const opts = useRef({ raised, fov, circle });
  opts.current = { raised, fov, circle };
  useEffect(() => {
    let raf = 0;
    let wasUnder = false;
    let lastDrop = 0;
    const spawn = (n: number) => {
      const host = drops.current;
      if (!host) return;
      const { x, y, r } = opts.current.circle;
      for (let i = 0; i < n && host.childElementCount < 42; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * r * 0.92;
        const d = document.createElement('div');
        const sz = 6 + Math.random() * Math.random() * 30;
        d.className = 'peri-drop';
        d.style.left = `${x + Math.cos(a) * rr - sz / 2}px`;
        d.style.top = `${y + Math.sin(a) * rr - sz / 2}px`;
        d.style.width = `${sz}px`;
        d.style.height = `${sz * (1 + Math.random() * 0.25)}px`;
        d.style.animationDuration = `${2.5 + Math.random() * 4}s`;
        d.addEventListener('animationend', () => d.remove());
        host.appendChild(d);
      }
    };
    const bubble = () => {
      const host = drops.current;
      if (!host || host.childElementCount >= 60) return;
      const { x, y, r } = opts.current.circle;
      const d = document.createElement('div');
      const sz = 3 + Math.random() * 9;
      d.className = 'peri-bubble';
      d.style.left = `${x + (Math.random() * 2 - 1) * r * 0.85}px`;
      d.style.top = `${y + Math.random() * r * 0.9}px`;
      d.style.width = d.style.height = `${sz}px`;
      d.style.animationDuration = `${0.7 + Math.random() * 0.9}s`;
      d.addEventListener('animationend', () => d.remove());
      host.appendChild(d);
    };
    let lastBubble = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const e = runner.engine;
      const o = opts.current;
      const c = o.raised ? periHeadClearance(e) : null;
      const under = c !== null && c < -0.03;
      // logo abaixo da crista: véu claro e bolhas subindo (mais fundo, a cena 3D já mostra a água)
      const shallow = under && c! > -1.6;
      if (shallow && now - lastBubble > 45) {
        lastBubble = now;
        bubble();
      }
      // borrifo: janela rente à água (até ~0,5 m acima da crista)
      const spray = c !== null && c > -0.03 && c < 0.5 ? Math.min(0.6, (0.5 - c) / 0.8) : 0;
      if (wash.current) wash.current.style.opacity = spray.toFixed(3);
      if (veil.current) veil.current.style.opacity = shallow ? Math.min(1, (1.6 + c!) / 1.2).toFixed(3) : '0';
      if (wasUnder && !under && c !== null) {
        // saiu da água: a água escorre e deixa gotas
        sheet.current?.classList.remove('run');
        void sheet.current?.offsetWidth;
        sheet.current?.classList.add('run');
        spawn(14 + Math.floor(Math.random() * 12));
      }
      if (spray > 0.25 && now - lastDrop > 260) {
        lastDrop = now;
        spawn(1 + Math.floor(Math.random() * 2));
      }
      wasUnder = under;
      // vibração do mastro no escoamento (acima de ~4 nós)
      const kn = toKnots(Math.abs(e.outputs.speed));
      const amp = o.raised ? Math.min(7, Math.max(0, kn - 4) * 0.45) * (o.fov <= 4 ? 2 : o.fov <= 8 ? 1.3 : 0.5) : 0;
      if (img.current) {
        if (amp > 0.05) {
          const t = now / 1000;
          img.current.style.transform = `translate(${(amp * (Math.sin(t * 37) + 0.5 * Math.sin(t * 61))).toFixed(2)}px, ${(amp * 0.6 * (Math.sin(t * 43 + 1) + 0.4 * Math.sin(t * 79))).toFixed(2)}px)`;
        } else if (img.current.style.transform) img.current.style.transform = '';
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [img]);
  return (
    <>
      <div className="room-peri-veil" ref={veil} />
      <div className="room-peri-wash" ref={wash} style={{ opacity: 0 }} />
      <div className="room-peri-sheet" ref={sheet} />
      <div className="room-peri-drops" ref={drops} />
    </>
  );
}

export function RoomPeriscope({ sight, setSight, onExit, acts }: { sight: PeriscopeSight; setSight: (s: PeriscopeSight) => void; onExit: () => void; acts: RoomActions }) {
  const e = useSim(10);
  const s = e.state;
  const pr = s.periscope ?? { cmd: false, pos: 0 };
  const raised = pr.pos > 0.97;
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [ids, setIds] = usePersisted('room.periIds', true);
  const [lit, setLit] = usePersisted('room.periLit', false);
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
  const clear = periHeadClearance(e);
  const out = raised && head !== null && head > 0.05;
  const cts = periVisible(e, acts, sight.bearing);
  const kn = toKnots(Math.abs(e.outputs.speed));
  const high = sight.fov <= 8;
  const minWH = Math.max(1, Math.min(w, h));
  const uTan = (100 / tanV) * (h / minWH);
  const rPx = (FIELD * minWH) / 200;
  const power = PERI_POWERS.find((p) => Math.abs(p.fov - sight.fov) < 0.1)?.label ?? `${fmt((32 / sight.fov) * 1.5, 1)}×`;

  // tempo de exposição (relógio da simulação)
  if (out && exposed.current === null) exposed.current = s.t;
  if (!out) exposed.current = null;
  const expo = exposed.current === null ? null : s.t - exposed.current;

  const turn = (d: number) => setSight({ ...sight, bearing: wrap180(sight.bearing + d) });
  const elev = (d: number) => setSight({ ...sight, elev: Math.max(-10, Math.min(30, sight.elev + d)) });
  const changePower = (d: number) => {
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
      changePower(ev.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const k = sight.fov / 600;
  const horizonY = h / 2 + (Math.tan((sight.elev * Math.PI) / 180) / tanV) * (h / 2);
  const marks = periMarks.list(s.t).slice(-4);
  const X = (off: number) => w / 2 + (Math.tan((off * Math.PI) / 180) / tanH) * (w / 2);
  const Ypx = (ang: number) => horizonY + (Math.tan(ang) / tanV) * (h / 2);
  // colchete do estadímetro (≈ 15 s após medir): linha d'água e topo do mastro do alvo medido
  const fc = fix && s.t - fix.t < 15 ? cts.find((c) => c.id === fix.id) : null;
  const stad =
    fc && head !== null && Math.abs(fc.off) < 80 && Math.abs(Math.tan((fc.off * Math.PI) / 180)) < tanH
      ? (() => {
          const H = TARGET_HEIGHT[fc.kind];
          const x = X(fc.off);
          const yw = Ypx(Math.atan(Math.max(0.1, head) / fix!.rng));
          const ym = Ypx(-Math.atan((H - Math.max(0.1, head)) / fix!.rng));
          return { x, yw, ym, H, mil: (1000 * H) / fix!.rng };
        })()
      : null;

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
      <div className="room-peri-img" ref={img}>
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
      </div>
      {/* identificação dos contatos e colchete do estadímetro (sob a máscara da ocular) */}
      {out && (ids || stad) && (
        <svg className="room-peri-ids" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          {ids &&
            cts
              .filter((c) => Math.abs(c.off) < 80 && Math.abs(Math.tan((c.off * Math.PI) / 180)) < tanH)
              .map((c) => {
                const x = X(c.off);
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
          {stad && (
            <g className="peri-stad">
              <line x1={stad.x - 16} y1={stad.yw} x2={stad.x + 16} y2={stad.yw} />
              <line x1={stad.x - 16} y1={stad.ym} x2={stad.x + 16} y2={stad.ym} />
              <line x1={stad.x + 22} y1={stad.yw} x2={stad.x + 22} y2={stad.ym} />
              <text x={stad.x + 28} y={(stad.yw + stad.ym) / 2 + 4}>
                {stad.H} m ↔ {fmt(stad.mil, stad.mil < 10 ? 1 : 0)} mil → {km(fix!.rng)}
              </text>
            </g>
          )}
        </svg>
      )}
      <PeriWater raised={raised} fov={sight.fov} img={img} circle={{ x: w / 2, y: h / 2, r: rPx }} />
      <div className="room-peri-grain" />
      <div className="room-peri-optic" style={{ left: w / 2 - rPx, top: h / 2 - rPx, width: rPx * 2, height: rPx * 2 }} />
      <svg className={`room-reticle${lit ? ' lit' : ''}`} viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
        <defs>
          <mask id="peri-mask">
            <rect x="-1000" y="-1000" width="2000" height="2000" fill="white" />
            <circle r={FIELD} fill="black" />
          </mask>
          <radialGradient id="peri-rim" r="0.5">
            <stop offset="0.9" stopColor="#3a3d40" />
            <stop offset="0.96" stopColor="#0d0e0f" />
            <stop offset="1" stopColor="#000" />
          </radialGradient>
        </defs>
        <rect x="-1000" y="-1000" width="2000" height="2000" fill="#000" mask="url(#peri-mask)" />
        <circle r={FIELD + 2.2} fill="none" stroke="#2b2e31" strokeWidth="2.4" />
        <circle r={FIELD + 0.4} fill="none" stroke="#000" strokeWidth="1.6" />
        <Reticle uTan={uTan} rel={wrap360(sight.bearing)} power={power} elev={sight.elev} lit={lit} />
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
          Cabeça:{' '}
          <b>
            {head === null
              ? 'arriada'
              : clear !== null && clear < -0.03 && head > 0
                ? 'crista da onda cobrindo a cabeça'
                : head > 0.6
                  ? `+${fmt(head, 1)} m acima d’água`
                  : head > 0.05
                    ? 'rente à água (ondas na ocular)'
                    : `submersa ${fmt(-head, 1)} m`}
          </b>
        </span>
        {expo !== null && <span className={expo > 30 ? 'bad' : expo > 15 ? 'warn' : ''}>Exposição {Math.round(expo)} s</span>}
        {out && kn > 5 && <span className="warn">Esteira do periscópio visível a {fmt(kn, 1)} nós — reduza para ≤ 5 nós</span>}
        {raised && kn > 6 && <span className="warn">Mastro vibrando no escoamento ({fmt(kn, 0)} nós)</span>}
        {out && <span>{cts.length ? `${cts.length} contato(s) dentro do horizonte` : 'Nenhum contato dentro do horizonte'}</span>}
      </div>
      {head !== null && clear !== null && <HeadGauge head={head} clear={clear} />}
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
          <button className={`btn sm ${lit ? 'on' : ''}`} onClick={() => setLit(!lit)} title="Retículo iluminado (vermelho), para pouca luz">
            Retículo
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
