/**
 * LABORATÓRIOS (grupo próprio): experimentos didáticos que usam as MESMAS funções da física, sem alterar a
 * simulação (exceto a prova de inclinação, que embarca um peso de prova pela via normal de comandos).
 *
 *  - Estabilidade: curva de braço de endireitamento GZ(φ) na profundidade atual, GM inicial e prova de inclinação.
 *  - Flutuabilidade: N(z) = ρ(z)·V(z) − m com a compressão do casco e a densidade da água; profundidade neutra.
 *  - Lemes: sustentação de cada superfície × ângulo e velocidade (estol), pela função finForce da física.
 *  - Ar comprimido: massa de ar para soprar um TLP em cada profundidade (gás ideal) × reserva nas garrafas.
 */
import { useMemo, useState } from 'react';
import { cmd, useSim } from '../store';
import { Panel } from '../components/Panel';
import { KV, ToneBadge } from '../components/StatusBits';
import { usePersisted } from '../persist';
import { qFromEuler } from '../../sim/core/math';
import { finForce } from '../../sim/physics/hydrodynamics';
import { R_AIR } from '../../sim/core/context';
import { fmt, fmtMass } from '../format';
import type { SimulationEngine } from '../../sim/core/engine';

type LabId = 'estabilidade' | 'flutuabilidade' | 'lemes' | 'ar';
const LABS: { id: LabId; label: string }[] = [
  { id: 'estabilidade', label: 'Estabilidade (GZ e inclinação)' },
  { id: 'flutuabilidade', label: 'Flutuabilidade × profundidade' },
  { id: 'lemes', label: 'Lemes e estol' },
  { id: 'ar', label: 'Ar comprimido e profundidade' },
];

/** gráfico de linhas simples (SVG, escala automática) */
function Chart(props: { series: { name: string; color: string; pts: [number, number][]; dash?: string }[]; xLabel: string; yLabel: string; marks?: { x: number; label: string }[]; zeroY?: boolean }) {
  const W = 520;
  const H = 240;
  const m = { l: 52, r: 10, t: 10, b: 34 };
  const all = props.series.flatMap((s) => s.pts);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs);
  let y0 = Math.min(...ys),
    y1 = Math.max(...ys);
  if (props.zeroY) {
    y0 = Math.min(0, y0);
    y1 = Math.max(0, y1);
  }
  if (y1 - y0 < 1e-9) {
    y1 += 1;
    y0 -= 1;
  }
  const X = (x: number) => m.l + ((x - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const Y = (y: number) => H - m.b - ((y - y0) / (y1 - y0)) * (H - m.t - m.b);
  const ticks = (a: number, b: number) => Array.from({ length: 5 }, (_, i) => a + ((b - a) * i) / 4);
  return (
    <svg className="p3-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${props.yLabel} × ${props.xLabel}`}>
      {ticks(y0, y1).map((t, i) => (
        <g key={`y${i}`}>
          <line x1={m.l} x2={W - m.r} y1={Y(t)} y2={Y(t)} stroke="var(--line)" strokeDasharray="2 4" />
          <text x={m.l - 4} y={Y(t) + 3} fontSize={9} textAnchor="end" fill="var(--muted)">
            {fmt(t, Math.abs(y1 - y0) < 5 ? 2 : 0)}
          </text>
        </g>
      ))}
      {ticks(x0, x1).map((t, i) => (
        <text key={`x${i}`} x={X(t)} y={H - m.b + 12} fontSize={9} textAnchor="middle" fill="var(--muted)">
          {fmt(t, 0)}
        </text>
      ))}
      {props.zeroY && <line x1={m.l} x2={W - m.r} y1={Y(0)} y2={Y(0)} stroke="var(--line2)" />}
      {props.marks?.map((mk, i) => (
        <g key={`m${i}`}>
          <line x1={X(mk.x)} x2={X(mk.x)} y1={m.t} y2={H - m.b} stroke="#a98bff" strokeDasharray="4 3" />
          <text x={X(mk.x) + 3} y={m.t + 10 + i * 11} fontSize={9} fill="#cbb8ff">
            {mk.label}
          </text>
        </g>
      ))}
      {props.series.map((s) => (
        <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} points={s.pts.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ')} />
      ))}
      <text x={(m.l + W - m.r) / 2} y={H - 4} fontSize={10} textAnchor="middle" fill="var(--muted)">
        {props.xLabel}
      </text>
      <text x={10} y={H / 2} fontSize={10} textAnchor="middle" fill="var(--muted)" transform={`rotate(-90 10 ${H / 2})`}>
        {props.yLabel}
      </text>
      {props.series.length > 1 &&
        props.series.map((s, i) => (
          <text key={`l${s.name}`} x={W - m.r - 4} y={m.t + 10 + i * 11} fontSize={9} textAnchor="end" fill={s.color}>
            {s.name}
          </text>
        ))}
    </svg>
  );
}

/** GZ(φ) em metros na profundidade e pitch atuais (sem reequilibrar o calado) */
export function gzCurve(e: SimulationEngine, maxDeg = 90, stepDeg = 5): [number, number][] {
  const mp = e.outputs.mp;
  const W = mp.mass * e.env.cfg.gravity;
  const th = (e.outputs.euler.pitch * Math.PI) / 180;
  const ps = (e.outputs.euler.heading * Math.PI) / 180;
  const out: [number, number][] = [];
  for (let d = 0; d <= maxDeg + 1e-9; d += stepDeg) {
    const M = e.hydrostaticMoment(mp, qFromEuler((d * Math.PI) / 180, th, ps));
    out.push([d, -M.x / W]);
  }
  return out;
}

function Stability({ e }: { e: SimulationEngine }) {
  const s = e.state;
  const gz = useMemo(() => gzCurve(e), [e, Math.round(s.t)]);
  const gm = gz.length > 1 ? gz[1][1] / Math.sin((5 * Math.PI) / 180) : 0;
  const best = gz.reduce((a, b) => (b[1] > a[1] ? b : a), gz[0]);
  const vanish = gz.find((p, i) => i > 0 && p[1] <= 0);
  const [w, setW] = usePersisted('lab.incl.w', 2);
  const [dy, setDy] = usePersisted('lab.incl.d', 2.4);
  const load = s.cargoLoads?.find((c) => c.id === 'lab-prova');
  const disp = e.outputs.mp.mass;
  const predicted = (Math.atan((w * 1000 * dy) / (disp * Math.max(1e-3, gm))) * 180) / Math.PI;
  const roll = e.outputs.euler.roll;
  const gmMeasured = load && Math.abs(roll) > 0.02 ? (load.unitMass * load.quantity * load.position.y) / (disp * Math.tan((roll * Math.PI) / 180)) : null;
  return (
    <>
      <Panel title="Curva de estabilidade transversal (GZ)">
        <Chart series={[{ name: 'GZ', color: 'var(--accent)', pts: gz }]} xLabel="banda φ (°)" yLabel="GZ (m)" zeroY marks={[{ x: best[0], label: `GZ máx. ${fmt(best[1], 3)} m` }]} />
        <KV
          rows={[
            ['Situação', e.outputs.surfaced ? 'na superfície (a linha d’água muda com a banda)' : 'submerso (GZ = BG·sen φ)'],
            ['GM inicial (≈ GZ/sen φ a 5°)', `${fmt(gm, 3)} m`],
            ['BG (vertical)', `${fmt(e.outputs.BG, 3)} m`],
            ['GZ máximo', `${fmt(best[1], 3)} m a ${fmt(best[0], 0)}°`],
            ['Ângulo de anulação', vanish ? `≈ ${fmt(vanish[0], 0)}°` : `acima de ${gz[gz.length - 1][0]}°`],
          ]}
        />
        <p className="subtle">Calculada com o momento de peso + empuxo da física em cada ângulo, na profundidade e no pitch atuais (o calado não é reequilibrado a cada ângulo).</p>
      </Panel>
      <Panel title="Prova de inclinação">
        <p className="subtle">
          Embarca um peso de prova a uma distância lateral do plano diametral e mede a banda: GM = w·d / (Δ·tg φ). O peso entra pela via normal (cargas a bordo) e muda de
          verdade a física — avance a simulação até a banda estabilizar.
        </p>
        <div className="btnrow">
          <label className="p3-field">
            peso <input type="number" min={0.2} max={20} step={0.2} value={w} onChange={(ev) => setW(Number(ev.target.value))} /> t
          </label>
          <label className="p3-field">
            distância <input type="number" min={-2.8} max={2.8} step={0.1} value={dy} onChange={(ev) => setDy(Number(ev.target.value))} /> m (+ boreste)
          </label>
        </div>
        <div className="btnrow">
          <button
            className="btn sm"
            onClick={() =>
              cmd({ type: 'cargoUpsert', load: { id: 'lab-prova', name: 'Peso de prova (laboratório)', category: 'carga', quantity: 1, unitMass: Math.max(0, w) * 1000, position: { x: 0, y: Math.max(-2.8, Math.min(2.8, dy)), z: 0.5 } } })
            }
          >
            {load ? 'Atualizar peso de prova' : 'Embarcar peso de prova'}
          </button>
          {load && (
            <button className="btn sm" onClick={() => cmd({ type: 'cargoRemove', id: 'lab-prova' })}>
              Retirar peso de prova
            </button>
          )}
        </div>
        <KV
          rows={[
            ['Banda prevista (GM atual)', `${fmt(predicted, 2)}°`],
            ['Banda medida', `${fmt(roll, 2)}°`],
            ['GM calculado pela prova', gmMeasured != null ? `${fmt(gmMeasured, 3)} m` : '—'],
            ['Deslocamento Δ', fmtMass(disp)],
          ]}
        />
      </Panel>
    </>
  );
}

function Buoyancy({ e }: { e: SimulationEngine }) {
  const v = e.vessel;
  const m = e.outputs.mp.mass;
  const V = e.geom.volume;
  const pts = useMemo(() => {
    const out: [number, number][] = [];
    const out2: [number, number][] = [];
    for (let z = 10; z <= v.limits.testDepth; z += 5) {
      const rho = e.env.densityAt(z);
      const vol = V - v.hull.compressibility * e.env.gaugePressureAt(z) * e.compressibleVolume;
      out.push([z, (rho * vol - m) / 1000]);
      out2.push([z, (1025 * vol - m) / 1000]);
    }
    return { real: out, uniform: out2 };
  }, [e, m, V, v]);
  const zeros = pts.real.filter((p, i) => i > 0 && Math.sign(p[1]) !== Math.sign(pts.real[i - 1][1])).map((p) => p[0]);
  const dz = pts.real.length > 1 ? (pts.real[pts.real.length - 1][1] - pts.real[0][1]) / (pts.real[pts.real.length - 1][0] - pts.real[0][0]) : 0;
  return (
    <Panel title="Flutuabilidade líquida submerso × profundidade">
      <Chart
        series={[
          { name: 'com o perfil de densidade', color: 'var(--accent)', pts: pts.real },
          { name: 'água uniforme 1025 kg/m³', color: '#a98bff', pts: pts.uniform, dash: '5 4' },
        ]}
        xLabel="profundidade (m)"
        yLabel="flutuabilidade (t)"
        zeroY
        marks={[{ x: Math.max(10, Math.min(v.limits.testDepth, e.outputs.depthAxis)), label: 'agora' }]}
      />
      <KV
        rows={[
          ['Massa atual', fmtMass(m)],
          ['Volume do envelope', `${fmt(V, 1)} m³`],
          ['Perda por compressão', `${fmt((v.hull.compressibility * e.env.gaugePressureAt(100) * e.compressibleVolume) / 1, 3)} m³ a 100 m`],
          ['Profundidade neutra', zeros.length ? zeros.map((z) => `≈ ${fmt(z, 0)} m`).join(', ') : 'nenhuma na faixa'],
          ['Tendência média', `${fmt(dz * 1000, 1)} kg por metro`],
        ]}
      />
      <p className="subtle">
        O casco comprime com a pressão (perde volume) e fica mais pesado ao descer: um equilíbrio instável. A termoclina aumenta a densidade com a profundidade e pode criar
        uma faixa onde o submarino “assenta”. Mude a compensação ou o ambiente (Configurações) e veja a curva se deslocar.
      </p>
    </Panel>
  );
}

function Fins({ e }: { e: SimulationEngine }) {
  const fins = e.vessel.fins.filter((f) => f.maxDeflection > 0);
  const [id, setId] = usePersisted('lab.fin', fins[0]?.id ?? '');
  const fin = fins.find((f) => f.id === id) ?? fins[0];
  const rho = 1025;
  const speeds = [2, 5, 10];
  const colors = ['#7fb7ff', 'var(--accent)', '#a98bff'];
  const series = useMemo(
    () =>
      fin
        ? speeds.map((kn, i) => {
            const U = (kn * 1852) / 3600;
            const pts: [number, number][] = [];
            for (let a = -35; a <= 35; a += 1) pts.push([a, finForce(fin, (a * Math.PI) / 180, { x: U, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, rho, 1).lift / 1000]);
            return { name: `${kn} nós`, color: colors[i], pts };
          })
        : [],
    [fin],
  );
  if (!fin) return null;
  const U = Math.abs(e.state.body.vel.x);
  const here = finForce(fin, (e.state.surfaces[fin.id]?.actual ?? 0) * (fin.commandSign * Math.PI) / 180, { x: U, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, rho, 1);
  return (
    <Panel title="Sustentação de uma superfície de governo">
      <div className="btnrow">
        <div className="seg">
          {fins.map((f) => (
            <button key={f.id} className={f.id === fin.id ? 'on' : ''} onClick={() => setId(f.id)}>
              {f.name}
            </button>
          ))}
        </div>
      </div>
      <Chart series={series} xLabel="ângulo (°)" yLabel="sustentação (kN)" zeroY marks={[{ x: fin.stallAngle, label: `estol ${fin.stallAngle}°` }, { x: -fin.stallAngle, label: '' }]} />
      <KV
        rows={[
          ['Área / alongamento', `${fmt(fin.area, 1)} m² / ${fmt(fin.aspectRatio, 1)}`],
          ['Deflexão máxima', `±${fin.maxDeflection}°`],
          ['Agora', `${fmt(U * 1.944, 1)} nós, ${fmt(e.state.surfaces[fin.id]?.actual ?? 0, 1)}° → ${fmt(here.lift / 1000, 1)} kN`],
        ]}
      />
      <p className="subtle">
        A força cresce com o quadrado da velocidade (de 5 para 10 nós, 4×). Passando do ângulo de estol a sustentação cai e o arrasto sobe: aumentar mais o leme piora. Em
        baixa velocidade os lemes quase não têm efeito — por isso a compensação e o trim precisam deixar o submarino equilibrado.
      </p>
    </Panel>
  );
}

function Air({ e }: { e: SimulationEngine }) {
  const v = e.vessel;
  const big = v.ballast.tanks.reduce((a, t) => Math.max(a, t.volume), 0);
  const total = v.ballast.tanks.reduce((a, t) => a + t.volume, 0);
  const T = 285;
  const stock = v.hpAir.banks.reduce((a, b) => a + e.state.hpAir.banks[b.id].mass, 0);
  const pts = useMemo(() => {
    const one: [number, number][] = [];
    const all: [number, number][] = [];
    for (let z = 0; z <= v.limits.testDepth; z += 10) {
      const p = e.env.pressureAt(z);
      one.push([z, (p * big) / (R_AIR * T)]);
      all.push([z, (p * total) / (R_AIR * T)]);
    }
    return { one, all };
  }, [e, v, big, total]);
  const z = Math.max(0, e.outputs.depthKeel);
  const pz = e.env.pressureAt(z);
  const needAll = (pz * total) / (R_AIR * T);
  return (
    <Panel title="Ar para soprar os TLP × profundidade (lei de Boyle)">
      <Chart
        series={[
          { name: `todos os TLP (${fmt(total, 0)} m³)`, color: 'var(--accent)', pts: pts.all },
          { name: `maior TLP (${fmt(big, 0)} m³)`, color: '#a98bff', pts: pts.one, dash: '5 4' },
        ]}
        xLabel="profundidade (m)"
        yLabel="massa de ar (kg)"
        marks={[{ x: Math.min(v.limits.testDepth, z), label: 'agora' }]}
      />
      <KV
        rows={[
          ['Ar nas garrafas AP', `${fmt(stock, 0)} kg`],
          ['Para esvaziar todos os TLP aqui', `${fmt(needAll, 0)} kg (${fmt(pz / 1e5, 1)} bar)`],
          ['Fração da reserva', `${fmt((needAll / Math.max(1, stock)) * 100, 0)} %`],
          ['Situação', needAll > stock ? <ToneBadge tone="warn" text="AR INSUFICIENTE para esvaziar tudo aqui" /> : <ToneBadge tone="" text="reserva suficiente" />],
        ]}
      />
      <p className="subtle">
        m = p·V/(R·T): a 100 m (≈ 11 bar) o mesmo volume de água pede 11× mais ar que na superfície. Por isso o sopro de emergência é dimensionado para a profundidade e
        um submarino pesado no fundo pode não conseguir subir só com ar.
      </p>
    </Panel>
  );
}

export function LabsScreen() {
  const e = useSim(2);
  const [lab, setLab] = usePersisted<LabId>('lab.tab', 'estabilidade');
  const [, force] = useState(0);
  return (
    <div>
      <div className="p3-tabs" role="tablist">
        {LABS.map((l) => (
          <button key={l.id} role="tab" aria-selected={lab === l.id} className={`btn ${lab === l.id ? 'on' : ''}`} onClick={() => setLab(l.id)}>
            {l.label}
          </button>
        ))}
        <button className="btn sm" onClick={() => force((x) => x + 1)} title="Recalcular com o estado atual">
          ↻ Recalcular
        </button>
      </div>
      <div className="grid">
        {lab === 'estabilidade' && <Stability e={e} />}
        {lab === 'flutuabilidade' && <Buoyancy e={e} />}
        {lab === 'lemes' && <Fins e={e} />}
        {lab === 'ar' && <Air e={e} />}
      </div>
      <p className="subtle">O Laboratório acústico (ondas, eco e zona de sombra) fica na tela Sonar.</p>
    </div>
  );
}
