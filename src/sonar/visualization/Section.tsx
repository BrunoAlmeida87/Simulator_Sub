import { angleDiff, clamp, type EchoPath, type Propagation } from '../types';
import type { SceneLayers } from '../../render3d/layers';
export function Section({ data, age, layers, echoes = [] }: { data: Propagation; age: number | null; layers: Partial<SceneLayers>; echoes?: EchoPath[] }) {
  const depth = Math.max(100, ...data.bottom.map((p) => p.z)),
    x = (r: number) => 45 + (r / data.range) * 740,
    y = (z: number) => 25 + (z / depth) * 260;
  const bottom = data.bottom.map((p, i) => `${i ? 'L' : 'M'}${x(p.r)},${y(p.z)}`).join(' ');
  return (
    <svg className="acoustic-section" viewBox="0 0 820 325" role="img" aria-label="Corte vertical acústico: raios calculados, superfície e batimetria">
      <rect x="45" y="25" width="740" height="260" fill="#071923" />
      <path d={`${bottom} L785,285 L45,285Z`} fill="#4c4b44" />
      {layers.sonarThermocline && <rect x="45" y={y(data.thermocline)} width="740" height="2" fill="#c18bdd" />}
      {data.rays.map((r, i) => {
        const pts = age === null ? r.points : r.points.filter((p) => p.t <= age);
        const last = pts[pts.length - 1];
        return (
          <g key={i} opacity={layers.sonarOpacity ?? 0.6}>
            {layers.sonarRays && <path d={pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.r)},${y(p.z)}`).join(' ')} fill="none" stroke="#60d7be" strokeWidth="0.6" />}
            {layers.sonarWave && last && age !== null && age <= r.points[r.points.length - 1].t && <circle cx={x(last.r)} cy={y(last.z)} r="2" fill="#f5db8b" />}
            {pts
              .filter((p) => (p.event === 'surface' && layers.sonarSurface) || (p.event === 'bottom' && layers.sonarBottom))
              .map((p, j) => (
                <circle key={j} cx={x(p.r)} cy={y(p.z)} r="1.6" fill={p.event === 'surface' ? '#80ceff' : '#ffb46d'} />
              ))}
          </g>
        );
      })}
      {layers.sonarEchoes &&
        age !== null &&
        echoes
          .filter((echo) => Math.abs(angleDiff(echo.bearing, data.bearing)) < 5 && age >= echo.arrival / 2 && age <= echo.arrival + 0.5)
          .map((echo, i) => {
            const points = echo.points,
              time = points[points.length - 1].t * clamp(2 - (2 * age) / echo.arrival, 0, 1);
            const k = points.findIndex((p) => p.t >= time),
              q = points[k < 0 ? points.length - 1 : k],
              p = points[Math.max(0, k - 1)];
            const f = clamp((time - p.t) / Math.max(1e-6, q.t - p.t), 0, 1);
            return <circle key={i} cx={x(p.r + (q.r - p.r) * f)} cy={y(p.z + (q.z - p.z) * f)} r="4" fill="#ffb66c" />;
          })}
      <circle cx={45} cy={y(data.origin.depth)} r="4" fill="#ffe1a1" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <text x={x((i * data.range) / 4)} y="310" fill="#a4c0cb" fontSize="11" textAnchor="middle">
            {((i * data.range) / 4000).toFixed(1)} km
          </text>
          <text x="3" y={y((i * depth) / 4)} fill="#a4c0cb" fontSize="11">
            {Math.round((i * depth) / 4)}m
          </text>
        </g>
      ))}
      <text x="55" y="17" fill="#a4c0cb" fontSize="12">
        Corte {data.bearing.toFixed(0)}° · eixo vertical ampliado na tela; cálculos em metros
      </text>
    </svg>
  );
}
export function Profile({ data }: { data: Propagation }) {
  const lo = Math.floor(Math.min(...data.profile.map((p) => p.c)) / 10) * 10 - 5,
    hi = Math.ceil(Math.max(...data.profile.map((p) => p.c)) / 10) * 10 + 5,
    depth = data.profile[data.profile.length - 1].z;
  return (
    <svg className="acoustic-profile" viewBox="0 0 300 260" role="img" aria-label="Velocidade do som em metros por segundo versus profundidade em metros">
      <rect x="40" y="25" width="240" height="200" fill="#071923" />
      <path d={data.profile.map((p, i) => `${i ? 'L' : 'M'}${40 + ((p.c - lo) / (hi - lo)) * 240},${25 + (p.z / depth) * 200}`).join(' ')} stroke="#c5a1ed" fill="none" strokeWidth="2" />
      <text x="40" y="15" fill="#a4c0cb" fontSize="12">
        c(z) · m/s
      </text>
      <text x="40" y="245" fill="#a4c0cb" fontSize="12">
        {lo}
      </text>
      <text x="245" y="245" fill="#a4c0cb" fontSize="12">
        {hi}
      </text>
      <text x="2" y="30" fill="#a4c0cb" fontSize="12">
        0m
      </text>
      <text x="0" y="225" fill="#a4c0cb" fontSize="12">
        {depth.toFixed(0)}
      </text>
    </svg>
  );
}
