/**
 * Perfil vertical da situação: superfície, submarino (atitude real), fundo ao
 * longo do rumo, profundidade ordenada e limites fictícios.
 */
import type { SimulationEngine } from '../../sim/core/engine';
import { DEG } from '../../sim/core/math';
import { fmt } from '../format';

export function SituationView({ e, height = 220 }: { e: SimulationEngine; height?: number }) {
  const W = 640;
  const H = height;
  const o = e.outputs;
  const s = e.state;
  const span = 1200; // m horizontais
  const psi = o.euler.heading * DEG;
  const samples: [number, number][] = [];
  let maxB = 0;
  for (let i = 0; i <= 60; i++) {
    const d = -span / 2 + (i / 60) * span;
    const b = e.env.bottomDepthAt(s.body.pos.x + d * Math.cos(psi), s.body.pos.y + d * Math.sin(psi));
    samples.push([d, b]);
    maxB = Math.max(maxB, b);
  }
  const zMax = Math.max(o.depthKeel + 60, Math.min(maxB + 20, Math.max(o.depthKeel * 1.6, 120)), e.vessel.limits.operatingDepth * (o.depthKeel > 150 ? 1.25 : 0));
  const zMin = -15;
  const X = (d: number) => ((d + span / 2) / span) * W;
  const Y = (z: number) => ((z - zMin) / (zMax - zMin)) * H;
  const poly = samples.map(([d, b]) => `${X(d)},${Y(Math.min(b, zMax + 50))}`).join(' ');
  const ord = s.autopilot.depthMode === 'AUTO' ? s.autopilot.depthSet : null;
  const subY = Y(s.body.pos.z);
  const subLen = 70 * (W / span) * 3; // exagero horizontal ×3 para visibilidade
  const lim = e.vessel.limits;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="svgbox" preserveAspectRatio="none" style={{ height }}>
      <defs>
        <linearGradient id="sea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#0f3a5e" />
          <stop offset="1" stopColor="#04101c" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={W} height={Y(0)} fill="#0e1a26" />
      <rect x="0" y={Y(0)} width={W} height={H - Y(0)} fill="url(#sea)" />
      <line x1="0" x2={W} y1={Y(0)} y2={Y(0)} stroke="#57a8ff" strokeWidth="1.5" />
      {[lim.operatingDepth, lim.testDepth].map((L, i) =>
        Y(L) < H ? (
          <g key={i}>
            <line x1="0" x2={W} y1={Y(L)} y2={Y(L)} stroke={i ? '#ff5257' : '#f5b041'} strokeDasharray="6 4" strokeWidth="1" />
            <text x={W - 4} y={Y(L) - 3} fontSize="10" textAnchor="end" fill={i ? '#ff5257' : '#f5b041'}>
              {i ? 'limite de teste (fictício)' : 'limite operacional (fictício)'} {L} m
            </text>
          </g>
        ) : null,
      )}
      {ord !== null && (
        <g>
          <line x1="0" x2={W} y1={Y(ord)} y2={Y(ord)} stroke="#ffb347" strokeDasharray="3 3" />
          <text x={4} y={Y(ord) - 3} fontSize="10" fill="#ffb347">
            ordenada {fmt(ord, 0)} m
          </text>
        </g>
      )}
      <polygon points={`0,${H} ${poly} ${W},${H}`} fill="#3b2d1d" stroke="#8a6a44" />
      {o.bottomDepth > zMax && (
        <text x={W / 2} y={H - 18} fontSize="10" textAnchor="middle" fill="#8a6a44">
          ▼ fundo a {fmt(o.bottomDepth, 0)} m (fora da escala)
        </text>
      )}
      <line x1={W / 2} x2={W / 2} y1={Y(o.depthKeel)} y2={Y(o.bottomDepth)} stroke="#b48cff" strokeDasharray="2 3" />
      <text x={W / 2 + 6} y={(Y(o.depthKeel) + Y(o.bottomDepth)) / 2} fontSize="10" fill="#b48cff">
        altitude {fmt(o.altitude, 0)} m
      </text>
      <g transform={`translate(${W / 2} ${subY}) rotate(${-o.euler.pitch})`}>
        <ellipse cx="0" cy="0" rx={subLen / 2} ry="6" fill="#9fb7cf" stroke="#e1ecf7" strokeWidth="1" />
        <rect x={subLen * 0.08} y="-13" width={subLen * 0.13} height="8" rx="2" fill="#9fb7cf" />
        <line x1={-subLen / 2} x2={-subLen / 2 - 6} y1="0" y2="0" stroke="#e1ecf7" strokeWidth="2" />
      </g>
      <text x={W / 2} y={Math.max(12, subY - 18)} fontSize="11" textAnchor="middle" fill="#d8e4f0" fontFamily="var(--mono)">
        {fmt(o.depthKeel, 1)} m · θ {fmt(o.euler.pitch, 1)}°
      </text>
      <text x="4" y={H - 4} fontSize="10" fill="#7f93a8">
        ← popa · perfil ao longo do rumo ({span} m; escala horizontal do casco ×3) · proa →
      </text>
    </svg>
  );
}
