/**
 * Peças comuns das visadas ópticas (periscópio e passadiço): ângulos,
 * formatação e a régua de marcação verdadeira. Só desenho.
 */
import { fmt } from '../format';

export const wrap180 = (b: number) => ((((b + 180) % 360) + 360) % 360) - 180;
export const wrap360 = (b: number) => ((b % 360) + 360) % 360;
/** marcação com 3 algarismos (000–359) */
export const deg3 = (b: number) => String(Math.round(wrap360(b)) % 360).padStart(3, '0');
export const CARD: Record<number, string> = { 0: 'N', 90: 'L', 180: 'S', 270: 'O' };
export const km = (m: number) => `${fmt(m / 1000, m < 10000 ? 1 : 0)} km`;
/** marcação relativa à proa: "BE 035°" / "BB 120°" / "proa" */
export const relTxt = (b: number) => {
  const r = Math.round(wrap180(b));
  return r === 0 ? 'proa' : Math.abs(r) === 180 ? 'popa' : `${r > 0 ? 'BE' : 'BB'} ${String(Math.abs(r)).padStart(3, '0')}°`;
};

/** régua de marcação verdadeira (graus e pontos cardeais), com os contatos dentro (▲) e fora (◀ ▶) do campo */
export function BearingTape({
  w,
  los,
  tanH,
  cts,
  ids,
  className = 'room-peri-tape',
  height = 54,
}: {
  w: number;
  los: number;
  tanH: number;
  cts: { id: string; off: number }[];
  ids: boolean;
  className?: string;
  height?: number;
}) {
  const half = (Math.atan(tanH) * 180) / Math.PI;
  const X = (off: number) => w / 2 + (Math.tan((off * Math.PI) / 180) / tanH) * (w / 2);
  const L = half * 2 > 30 ? 10 : half * 2 > 10 ? 5 : 2;
  const minor = L / 5 >= 1 ? L / 5 : 0.5;
  const ticks: { x: number; b: number; major: boolean }[] = [];
  const b0 = Math.ceil((los - half) / minor) * minor;
  for (let b = b0; b <= los + half + 1e-9; b += minor) ticks.push({ x: X(b - los), b: wrap360(Math.round(b * 10) / 10), major: Math.abs(b / L - Math.round(b / L)) < 1e-6 });
  const left = cts.filter((c) => c.off < -half).sort((a, b) => b.off - a.off);
  const right = cts.filter((c) => c.off > half).sort((a, b) => a.off - b.off);
  const H = height;
  return (
    <svg className={className} width={w} height={H} viewBox={`0 0 ${w} ${H}`}>
      <rect x={0} y={0} width={w} height={H} fill="rgba(0,0,0,0.55)" />
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
              <path d={`M ${X(c.off) - 6} ${H - 2} L ${X(c.off)} ${H - 12} L ${X(c.off) + 6} ${H - 2} Z`} fill="#4cd964" />
            </g>
          ))}
      <path d={`M ${w / 2 - 8} 0 L ${w / 2} 12 L ${w / 2 + 8} 0 Z`} fill="#fff" />
      <text x={w / 2} y={H - 4} fill="#fff" fontSize={15} fontWeight="bold" textAnchor="middle" fontFamily="monospace">
        {deg3(los)}°
      </text>
      {ids && left.length > 0 && (
        <text x={6} y={H - 4} fill="#4cd964" fontSize={13} fontWeight="bold">
          ◀ {left.map((c) => c.id).join(' ')}
        </text>
      )}
      {ids && right.length > 0 && (
        <text x={w - 6} y={H - 4} fill="#4cd964" fontSize={13} fontWeight="bold" textAnchor="end">
          {right.map((c) => c.id).join(' ')} ▶
        </text>
      )}
    </svg>
  );
}
