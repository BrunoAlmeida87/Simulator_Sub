/**
 * COCKPIT da Operação: instrumentos SOBRE a cena 3D (no lugar da faixa de oito
 * quadros), como num painel de vidro. Fita de rumo no alto (com a marca do rumo
 * ordenado) e uma coluna de valores à direita; a régua de profundidade continua
 * à esquerda (gauges.DepthTape). Só lê o estado — valores INDICADOS pelos
 * sensores (instruments.ts), os mesmos da barra e das outras telas.
 */
import type { SimulationEngine } from '../../sim/core/engine';
import { fmt } from '../format';

/** fita de rumo: ±45° em volta do rumo atual, rótulos a cada 10°, pontos cardeais e marca do rumo ordenado */
export function HeadingTape({ heading, ordered }: { heading: number; ordered: number | null }) {
  const W = 340;
  const H = 40;
  const span = 45;
  const px = W / (2 * span);
  const norm = (a: number) => ((a % 360) + 360) % 360;
  const rel = (a: number) => ((((a - heading) % 360) + 540) % 360) - 180;
  const ticks: JSX.Element[] = [];
  for (let a = Math.ceil((heading - span) / 5) * 5; a <= heading + span; a += 5) {
    const x = W / 2 + (a - heading) * px;
    const n = norm(a);
    const major = n % 10 === 0;
    ticks.push(<line key={`t${a}`} x1={x} x2={x} y1={H - 4} y2={H - (major ? 13 : 8)} className="ck-tick" />);
    if (major) {
      const lbl = n === 0 ? 'N' : n === 90 ? 'E' : n === 180 ? 'S' : n === 270 ? 'W' : String(n).padStart(3, '0');
      ticks.push(
        <text key={`l${a}`} x={x} y={H - 16} textAnchor="middle" className={`ck-lbl ${n % 90 === 0 ? 'card' : ''}`}>
          {lbl}
        </text>,
      );
    }
  }
  const ord = ordered === null ? null : rel(ordered);
  return (
    <svg className="ck-heading" viewBox={`0 0 ${W} ${H + 18}`} width={W} height={H + 18} role="img" aria-label={`Rumo ${fmt(heading, 0)} graus${ordered !== null ? `, ordenado ${fmt(ordered, 0)}` : ''}`}>
      <rect x={0} y={0} width={W} height={H} rx={5} className="ck-bg" />
      {ticks}
      {ord !== null &&
        (Math.abs(ord) <= span ? (
          <path d={`M${W / 2 + ord * px} ${H - 2} l-6 -8 h12 z`} className="ck-bug" />
        ) : (
          <text x={ord > 0 ? W - 6 : 6} y={H - 4} textAnchor={ord > 0 ? 'end' : 'start'} className="ck-bug-txt">
            {ord > 0 ? `${fmt(norm(ordered!), 0)}° ▶` : `◀ ${fmt(norm(ordered!), 0)}°`}
          </text>
        ))}
      <line x1={W / 2} x2={W / 2} y1={2} y2={H - 2} className="ck-center" />
      <rect x={W / 2 - 30} y={H - 1} width={60} height={18} rx={4} className="ck-val-bg" />
      <text x={W / 2} y={H + 13} textAnchor="middle" className="ck-val">
        {String(Math.round(norm(heading)) % 360).padStart(3, '0')}°
      </text>
    </svg>
  );
}

export function CockpitHud({ e }: { e: SimulationEngine }) {
  const s = e.state;
  const o = e.outputs;
  const ap = s.autopilot;
  const L = e.vessel.limits;
  const sn = s.sensors;
  const vs = o.verticalSpeed;
  const tiles: { k: string; v: string; sub?: string; warn?: boolean }[] = [
    { k: 'VELOCIDADE', v: `${fmt(sn.DVLU.value / 0.5144, 1)} nós`, sub: `${fmt(sn.DVLU.value * 3.6, 1)} km/h · ${fmt(o.rpm, 0)} rpm` },
    { k: vs >= 0 ? 'DESCENDO' : 'SUBINDO', v: `${fmt(Math.abs(vs), 2)} m/s`, warn: Math.abs(vs) > L.maxVerticalSpeed },
    { k: 'PITCH', v: `${fmt(sn.INSP.value, 1)}°`, sub: `equil. ${fmt(o.staticPitchEq, 1)}°`, warn: Math.abs(sn.INSP.value) > L.maxPitch },
    { k: 'BANDA', v: `${fmt(sn.INSR.value, 1)}°`, warn: Math.abs(sn.INSR.value) > L.maxRoll },
    { k: 'BATERIA', v: `${fmt(s.electrical.soc * 100, 0)} %`, sub: `${fmt(s.electrical.voltage, 0)} V`, warn: s.electrical.soc < 0.25 },
    o.surfaced
      ? { k: 'RESERVA', v: `${fmt(o.reserveKg / 1000, 1)} t`, sub: 'flutuabilidade' }
      : { k: 'FLUTUAB.', v: `${fmt(o.netBuoyancyKg / 1000, 2)} t`, sub: o.netBuoyancyKg > 0 ? 'leve' : o.netBuoyancyKg < 0 ? 'pesado' : 'neutro', warn: Math.abs(o.netBuoyancyKg) > 2000 },
  ];
  return (
    <>
      <div className="ck-top">
        <HeadingTape heading={sn.GIRO.value} ordered={ap.headingMode === 'AUTO' ? ap.headingSet : null} />
      </div>
      <div className="ck-right" aria-label="Instrumentos">
        {tiles.map((t) => (
          <div key={t.k} className={`ck-tile ${t.warn ? 'warn' : ''}`}>
            <small>
              {t.warn ? '▲ ' : ''}
              {t.k}
            </small>
            <b>{t.v}</b>
            {t.sub && <span>{t.sub}</span>}
          </div>
        ))}
      </div>
    </>
  );
}
