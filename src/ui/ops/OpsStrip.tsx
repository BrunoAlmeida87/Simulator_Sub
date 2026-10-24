/** Faixa inferior de indicadores principais (Pilotagem e janela de visualização). */
import type { SimulationEngine } from '../../sim/core/engine';
import { fmt, fmtSpeed } from '../format';

export function OpsStrip({ e }: { e: SimulationEngine }) {
  const o = e.outputs;
  const s = e.state;
  const ap = s.autopilot;
  const tiles: [string, string, string?, boolean?][] = [
    ['PROFUNDIDADE', `${fmt(o.depthKeel, 1)} m`, ap.depthMode === 'AUTO' ? `ordem ${fmt(ap.depthSet, 0)} m` : undefined],
    [o.verticalSpeed >= 0 ? 'DESCENDO' : 'SUBINDO', `${fmt(Math.abs(o.verticalSpeed), 2)} m/s`],
    ['VELOCIDADE', fmtSpeed(s.body.vel.x, 1), `${fmt(o.rpm, 0)} rpm`],
    ['RUMO', `${fmt(o.euler.heading, 0)}°`, ap.headingMode === 'AUTO' ? `ordem ${fmt(ap.headingSet, 0)}°` : undefined],
    ['PITCH', `${fmt(o.euler.pitch, 1)}°`, `equil. ${fmt(o.staticPitchEq, 1)}°`, Math.abs(o.euler.pitch) > e.vessel.limits.maxPitch],
    ['BANDA', `${fmt(o.euler.roll, 1)}°`, undefined, Math.abs(o.euler.roll) > e.vessel.limits.maxRoll],
    ['BATERIA', `${fmt(s.electrical.soc * 100, 0)} %`, `${fmt(s.electrical.voltage, 0)} V`, s.electrical.soc < 0.25],
    o.surfaced ? ['RESERVA', `${fmt(o.reserveKg / 1000, 1)} t`, 'flutuabilidade'] : ['FLUTUAB.', `${fmt(o.netBuoyancyKg / 1000, 2)} t`, o.netBuoyancyKg > 0 ? 'leve' : o.netBuoyancyKg < 0 ? 'pesado' : 'neutro', Math.abs(o.netBuoyancyKg) > 2000],
  ];
  return (
    <div className="ops-strip">
      {tiles.map(([k, v, sub, warn]) => (
        <div key={k} className={`ops-tile ${warn ? 'warn' : ''}`}>
          <small>{k}</small>
          <b className={k === 'VELOCIDADE' ? 'speed-value' : undefined}>
            {k === 'VELOCIDADE' ? <>{v.split(' (')[0]} <span className="speed-equivalent">({v.split(' (')[1]}</span></> : v}
          </b>
          {sub && <span>{sub}</span>}
        </div>
      ))}
    </div>
  );
}
