/**
 * Instrumentos gráficos (SVG): fita de profundidade, rosa de rumo,
 * indicador de atitude, barras de ângulo e mostradores circulares.
 */
import { fmt, fmtKnots } from '../format';

const C = {
  bg: '#0a121b',
  line: '#2c4260',
  tick: '#7f93a8',
  text: '#d8e4f0',
  accent: '#36c5f0',
  cmd: '#ffb347',
  calc: '#b48cff',
  warn: '#f5b041',
  alarm: '#ff5257',
  ok: '#3ddc84',
  water: '#123a66',
};

export function DepthTape(props: {
  depth: number;
  ordered?: number | null;
  bottom: number;
  rate: number;
  opLimit: number;
  testLimit: number;
  height?: number;
  range?: number;
}) {
  const H = props.height ?? 300;
  const W = 120;
  const range = props.range ?? 30;
  const k = H / (2 * range);
  const y = (d: number) => H / 2 + (d - props.depth) * k;
  const ticks: JSX.Element[] = [];
  const start = Math.floor(props.depth - range);
  for (let d = start; d <= props.depth + range; d++) {
    if (d < -10) continue;
    const yy = y(d);
    const major = d % 10 === 0;
    const mid = d % 5 === 0;
    ticks.push(<line key={'t' + d} x1={W - 40} x2={W - 40 + (major ? 16 : mid ? 10 : 5)} y1={yy} y2={yy} stroke={C.tick} strokeWidth={major ? 1.5 : 1} />);
    if (major) ticks.push(<text key={'l' + d} x={W - 44} y={yy + 4} textAnchor="end" fontSize="11" fill={C.text} fontFamily="var(--mono)">{d}</text>);
  }
  const surfY = y(0);
  const botY = y(props.bottom);
  const trend = Math.max(-range, Math.min(range, props.rate * 30));
  const ord = props.ordered;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="svgbox" style={{ maxWidth: 150 }}>
      <rect x="0" y="0" width={W} height={H} fill={C.bg} rx="4" />
      {surfY > 0 && <rect x="0" y="0" width={W} height={Math.min(H, surfY)} fill="#1b2a3a" />}
      {surfY > 0 && surfY < H && <line x1="0" x2={W} y1={surfY} y2={surfY} stroke={C.accent} strokeWidth="1.5" />}
      {botY < H && <rect x="0" y={Math.max(0, botY)} width={W} height={H - Math.max(0, botY)} fill="#3b2d1d" opacity="0.85" />}
      {[props.opLimit, props.testLimit].map((L, i) =>
        y(L) > 0 && y(L) < H ? <line key={'lim' + i} x1="0" x2={W} y1={y(L)} y2={y(L)} stroke={i ? C.alarm : C.warn} strokeDasharray="4 3" /> : null,
      )}
      {ticks}
      {/* tendência (30 s) */}
      <rect x={W - 18} y={Math.min(H / 2, H / 2 + trend * k)} width="6" height={Math.abs(trend * k)} fill={props.rate > 0 ? C.warn : C.ok} opacity="0.8" />
      {ord !== null && ord !== undefined && (
        y(ord) >= 0 && y(ord) <= H ? (
          <polygon points={`${W - 24},${y(ord)} ${W - 32},${y(ord) - 6} ${W - 32},${y(ord) + 6}`} fill={C.cmd} />
        ) : (
          <text x={W - 28} y={y(ord) < 0 ? 12 : H - 4} fill={C.cmd} fontSize="11" textAnchor="middle">{y(ord) < 0 ? '▲' : '▼'}</text>
        )
      )}
      <polygon points={`2,${H / 2 - 13} ${W - 44},${H / 2 - 13} ${W - 36},${H / 2} ${W - 44},${H / 2 + 13} 2,${H / 2 + 13}`} fill="#071019" stroke={C.accent} />
      <text x={(W - 44) / 2 + 2} y={H / 2 + 6} textAnchor="middle" fontSize="16" fontWeight="700" fill={C.text} fontFamily="var(--mono)">{fmt(props.depth, 1)}</text>
    </svg>
  );
}

export function Compass(props: { heading: number; ordered?: number | null; cog?: number; rudder?: number; size?: number }) {
  const S = props.size ?? 230;
  const c = S / 2;
  const R = c - 16;
  const els: JSX.Element[] = [];
  for (let a = 0; a < 360; a += 5) {
    const major = a % 30 === 0;
    const rad = (a * Math.PI) / 180;
    const r1 = R - (major ? 12 : a % 10 === 0 ? 8 : 5);
    els.push(<line key={a} x1={c + R * Math.sin(rad)} y1={c - R * Math.cos(rad)} x2={c + r1 * Math.sin(rad)} y2={c - r1 * Math.cos(rad)} stroke={C.tick} strokeWidth={major ? 1.6 : 1} />);
    if (major) {
      const lbl = a === 0 ? 'N' : a === 90 ? 'E' : a === 180 ? 'S' : a === 270 ? 'W' : String(a / 10);
      const rl = R - 24;
      els.push(
        <text key={'l' + a} x={c + rl * Math.sin(rad)} y={c - rl * Math.cos(rad) + 4} textAnchor="middle" fontSize="12" fill={a % 90 === 0 ? C.accent : C.text} fontWeight={a % 90 === 0 ? 700 : 400} transform={`rotate(${a} ${c + rl * Math.sin(rad)} ${c - rl * Math.cos(rad)})`}>
          {lbl}
        </text>,
      );
    }
  }
  const bug = props.ordered;
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="svgbox" style={{ maxWidth: S }}>
      <circle cx={c} cy={c} r={c - 2} fill={C.bg} stroke={C.line} />
      <g transform={`rotate(${-props.heading} ${c} ${c})`}>
        {els}
        {bug !== null && bug !== undefined && (
          <polygon points={`${c},${c - R + 1} ${c - 7},${c - R - 10} ${c + 7},${c - R - 10}`} fill={C.cmd} transform={`rotate(${bug} ${c} ${c})`} />
        )}
        {props.cog !== undefined && <circle cx={c} cy={c - R + 18} r="3.5" fill={C.calc} transform={`rotate(${props.cog} ${c} ${c})`} />}
      </g>
      <polygon points={`${c},${12} ${c - 6},${2} ${c + 6},${2}`} fill={C.accent} />
      <line x1={c} x2={c} y1={14} y2={c - 30} stroke={C.accent} strokeWidth="1" opacity="0.4" />
      {/* silhueta */}
      <path d={`M${c},${c - 26} C${c + 8},${c - 14} ${c + 8},${c + 18} ${c},${c + 24} C${c - 8},${c + 18} ${c - 8},${c - 14} ${c},${c - 26}Z`} fill="#20344c" stroke={C.accent} strokeWidth="1" />
      {props.rudder !== undefined && (
        <line x1={c} y1={c + 24} x2={c - 14 * Math.sin((props.rudder * Math.PI) / 180)} y2={c + 24 + 14 * Math.cos((props.rudder * Math.PI) / 180)} stroke={C.cmd} strokeWidth="3" strokeLinecap="round" />
      )}
      <text x={c} y={c + 52} textAnchor="middle" fontSize="18" fontWeight="700" fill={C.text} fontFamily="var(--mono)">{fmt(props.heading, 1)}°</text>
    </svg>
  );
}

export function Attitude(props: { pitch: number; roll: number; staticPitch?: number; size?: number }) {
  const S = props.size ?? 210;
  const c = S / 2;
  const k = 4; // px por grau
  const p = Math.max(-40, Math.min(40, props.pitch));
  const ladder: JSX.Element[] = [];
  for (let a = -40; a <= 40; a += 5) {
    if (a === 0) continue;
    const w = a % 10 === 0 ? 34 : 18;
    const ly = c - a * k + p * k;
    ladder.push(<line key={a} x1={c - w} x2={c + w} y1={ly} y2={ly} stroke="#e8f1fb" strokeWidth="1" opacity="0.7" />);
    if (a % 10 === 0) ladder.push(<text key={'t' + a} x={c + w + 4} y={ly + 4} fontSize="10" fill="#e8f1fb" fontFamily="var(--mono)">{a}</text>);
  }
  const rollTicks = [-30, -20, -10, 0, 10, 20, 30];
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="svgbox" style={{ maxWidth: S }}>
      <defs>
        <clipPath id="adiclip">
          <circle cx={c} cy={c} r={c - 6} />
        </clipPath>
      </defs>
      <circle cx={c} cy={c} r={c - 2} fill={C.bg} stroke={C.line} />
      <g clipPath="url(#adiclip)">
        <g transform={`rotate(${-props.roll} ${c} ${c})`}>
          <rect x={-S} y={-S * 2 + c + p * k} width={S * 3} height={S * 2} fill="#1d5a8a" />
          <rect x={-S} y={c + p * k} width={S * 3} height={S * 2} fill="#0f2235" />
          <line x1={-S} x2={S * 2} y1={c + p * k} y2={c + p * k} stroke="#e8f1fb" strokeWidth="1.5" />
          {ladder}
          {props.staticPitch !== undefined && Number.isFinite(props.staticPitch) && (
            <polygon
              points={`${c + 46},${c - props.staticPitch * k + p * k} ${c + 54},${c - props.staticPitch * k + p * k - 5} ${c + 54},${c - props.staticPitch * k + p * k + 5}`}
              fill={C.calc}
            >
              <title>Pitch de equilíbrio estático (pesos)</title>
            </polygon>
          )}
        </g>
      </g>
      {rollTicks.map((a) => {
        const rad = ((a - 90) * Math.PI) / 180;
        return <line key={a} x1={c + (c - 6) * Math.cos(rad)} y1={c + (c - 6) * Math.sin(rad)} x2={c + (c - 16) * Math.cos(rad)} y2={c + (c - 16) * Math.sin(rad)} stroke={C.text} strokeWidth={a === 0 ? 2 : 1} />;
      })}
      <polygon points={`${c},${18} ${c - 6},${28} ${c + 6},${28}`} fill={C.cmd} transform={`rotate(${-props.roll} ${c} ${c})`} />
      {/* símbolo fixo */}
      <path d={`M${c - 50},${c} L${c - 16},${c} L${c - 8},${c + 8} M${c + 50},${c} L${c + 16},${c} L${c + 8},${c + 8}`} stroke={C.cmd} strokeWidth="3" fill="none" />
      <circle cx={c} cy={c} r="3" fill={C.cmd} />
      <text x={8} y={S - 8} fontSize="11" fill={C.text} fontFamily="var(--mono)">θ {fmt(props.pitch, 1)}°</text>
      <text x={S - 8} y={S - 8} fontSize="11" fill={C.text} textAnchor="end" fontFamily="var(--mono)">φ {fmt(props.roll, 1)}°</text>
    </svg>
  );
}

/** Barra de ângulo com posição real (preenchida) e comandada (triângulo). */
export function AngleBar(props: { actual: number; cmd: number; max: number; neg: string; pos: string; vertical?: boolean; width?: number }) {
  const vertical = !!props.vertical;
  const L = props.width ?? (vertical ? 150 : 260);
  const T = 30;
  const W = vertical ? 70 : L;
  const H = vertical ? L : 44;
  const s = (a: number) => (a / props.max) * (L / 2 - 10);
  const mid = L / 2;
  const act = s(props.actual);
  const cm = s(props.cmd);
  const ticks: JSX.Element[] = [];
  for (let a = -props.max; a <= props.max; a += 5) {
    const p = vertical ? mid - s(a) : mid + s(a);
    ticks.push(
      vertical ? (
        <line key={a} x1={T - 4} x2={T + (a % 10 === 0 ? 10 : 6)} y1={p} y2={p} stroke={C.tick} />
      ) : (
        <line key={a} y1={T - 4} y2={T + (a % 10 === 0 ? 10 : 6)} x1={p} x2={p} stroke={C.tick} />
      ),
    );
  }
  if (vertical) {
    // + (subir) para cima
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="svgbox" style={{ maxWidth: W }}>
        <rect x="0" y="0" width={W} height={H} rx="4" fill={C.bg} />
        <rect x={T - 8} y={Math.min(mid, mid - act)} width="8" height={Math.abs(act)} fill={C.accent} />
        <line x1={T - 12} x2={T + 12} y1={mid} y2={mid} stroke={C.text} />
        {ticks}
        <polygon points={`${T + 14},${mid - cm} ${T + 22},${mid - cm - 6} ${T + 22},${mid - cm + 6}`} fill={C.cmd} />
        <text x={W - 4} y={12} fontSize="10" textAnchor="end" fill={C.ok}>{props.pos}</text>
        <text x={W - 4} y={H - 4} fontSize="10" textAnchor="end" fill={C.warn}>{props.neg}</text>
        <text x={T + 26} y={mid + 4} fontSize="12" fill={C.text} fontFamily="var(--mono)">{fmt(props.actual, 1)}°</text>
      </svg>
    );
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="svgbox" style={{ maxWidth: W }}>
      <rect x="0" y="0" width={W} height={H} rx="4" fill={C.bg} />
      <rect x={Math.min(mid, mid + act)} y={T - 8} width={Math.abs(act)} height="8" fill={C.accent} />
      <line y1={T - 12} y2={T + 12} x1={mid} x2={mid} stroke={C.text} />
      {ticks}
      <polygon points={`${mid + cm},${T - 10} ${mid + cm - 6},${T - 18} ${mid + cm + 6},${T - 18}`} fill={C.cmd} />
      <text x={4} y={H - 4} fontSize="10" fill={C.warn}>{props.neg}</text>
      <text x={W - 4} y={H - 4} fontSize="10" textAnchor="end" fill={C.ok}>{props.pos}</text>
      <text x={mid} y={H - 3} fontSize="11" textAnchor="middle" fill={C.text} fontFamily="var(--mono)">{fmt(props.actual, 1)}°</text>
    </svg>
  );
}

export function Dial(props: { value: number; min: number; max: number; label: string; unit: string; digits?: number; cmd?: number; zones?: { from: number; to: number; color: string }[]; size?: number }) {
  const S = props.size ?? 170;
  const c = S / 2;
  const R = c - 12;
  const a0 = -210;
  const span = 240;
  const ang = (v: number) => ((a0 + ((Math.max(props.min, Math.min(props.max, v)) - props.min) / (props.max - props.min)) * span) * Math.PI) / 180;
  const pt = (v: number, r: number) => [c + r * Math.cos(ang(v)), c + r * Math.sin(ang(v))];
  const arc = (from: number, to: number, r: number) => {
    const [x1, y1] = pt(from, r);
    const [x2, y2] = pt(to, r);
    const large = ((to - from) / (props.max - props.min)) * span > 180 ? 1 : 0;
    return `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2}`;
  };
  const ticks: JSX.Element[] = [];
  const step = (props.max - props.min) / 8;
  for (let i = 0; i <= 8; i++) {
    const v = props.min + i * step;
    const [x1, y1] = pt(v, R);
    const [x2, y2] = pt(v, R - 8);
    const [xt, yt] = pt(v, R - 20);
    ticks.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.tick} />);
    ticks.push(<text key={'t' + i} x={xt} y={yt + 4} fontSize="9.5" textAnchor="middle" fill={C.tick} fontFamily="var(--mono)">{Math.round(v)}</text>);
  }
  const [nx, ny] = pt(props.value, R - 6);
  return (
    <svg viewBox={`0 0 ${S} ${S * 0.86}`} className="svgbox" style={{ maxWidth: S }}>
      <circle cx={c} cy={c} r={c - 2} fill={C.bg} stroke={C.line} />
      <path d={arc(props.min, props.max, R)} stroke={C.line} strokeWidth="4" fill="none" />
      {props.zones?.map((z, i) => <path key={i} d={arc(z.from, z.to, R)} stroke={z.color} strokeWidth="4" fill="none" />)}
      {ticks}
      {props.cmd !== undefined && (() => {
        const [cx1, cy1] = pt(props.cmd!, R + 2);
        return <circle cx={cx1} cy={cy1} r="4" fill={C.cmd} />;
      })()}
      <line x1={c} y1={c} x2={nx} y2={ny} stroke={C.accent} strokeWidth="3" strokeLinecap="round" />
      <circle cx={c} cy={c} r="5" fill={C.accent} />
      <text x={c} y={c + 26} textAnchor="middle" fontSize={props.unit === 'nós' ? 10 : 16} fontWeight="700" fill={C.text} fontFamily="var(--mono)">{props.unit === 'nós' ? fmtKnots(props.value, props.digits ?? 0) : fmt(props.value, props.digits ?? 0)}</text>
      <text x={c} y={c + 40} textAnchor="middle" fontSize="10" fill={C.tick}>{props.label} ({props.unit})</text>
    </svg>
  );
}

/** Barra horizontal simples com valor. */
export function HBar(props: { value: number; max: number; color?: string; min?: number; height?: number }) {
  const min = props.min ?? 0;
  const f = Math.max(0, Math.min(1, (props.value - min) / (props.max - min)));
  return (
    <div style={{ background: '#0a121b', borderRadius: 3, height: props.height ?? 8, overflow: 'hidden', border: '1px solid #1c2c40' }}>
      <div style={{ width: `${f * 100}%`, height: '100%', background: props.color ?? 'var(--accent)' }} />
    </div>
  );
}
