/** Operação › Manobra de porto: rebocadores (empurrar/puxar, bordo, tração, ângulo), corrente e governo. */
import { cmd, useSim } from '../store';
import { Panel } from '../components/Panel';
import { KV, OnOff, ToneBadge } from '../components/StatusBits';
import { SurfaceControl, Telegraph } from '../components/Controls';
import { defaultTugs } from '../../sim/config/extSystems';
import type { TugMode } from '../../sim/core/extState';
import { fmt, fmtForce } from '../format';
import type { SimulationEngine } from '../../sim/core/engine';

const MODES: { id: TugMode; label: string }[] = [
  { id: 'livre', label: 'Largar' },
  { id: 'empurrar', label: 'Empurrar' },
  { id: 'puxar', label: 'Puxar (cabo)' },
];

/** vista de cima do casco (proa para cima) com os rebocadores e as forças */
function TopView({ e }: { e: SimulationEngine }) {
  const v = e.vessel;
  const L = v.hull.length;
  const D = v.hull.diameter;
  const W = 220;
  const H = 300;
  const k = (H - 40) / L;
  const cx = W / 2;
  const py = (x: number) => H / 2 - x * k;
  const tc = v.tugs ?? defaultTugs();
  const st = e.state.tugs;
  return (
    <svg className="p3-svg" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 240 }} role="img" aria-label="Vista de cima do submarino com os rebocadores">
      <ellipse cx={cx} cy={H / 2} rx={(D / 2) * k * 1.4} ry={(L / 2) * k} fill="rgba(54,197,240,0.08)" stroke="var(--line2)" />
      <text x={cx} y={14} textAnchor="middle" fontSize={10} fill="var(--muted)">
        proa
      </text>
      {tc.tugs.map((t) => {
        const ts = st?.tugs[t.id];
        if (!ts || ts.mode === 'livre') return null;
        const side = ts.side === 'BE' ? 1 : -1;
        const hx = cx + side * ((D / 2) * k * 1.4 + 16);
        const hy = py(t.x);
        const inward = ts.mode === 'empurrar' ? -side : side;
        const a = (ts.angle * Math.PI) / 180;
        const len = 40 * ts.level;
        const fx = Math.cos(a) * inward * len;
        const fy = -Math.sin(a) * len;
        return (
          <g key={t.id}>
            <rect x={hx - 7} y={hy - 12} width={14} height={24} rx={4} fill="#3a556f" stroke="#9fc3e0" />
            {ts.mode === 'puxar' && <line x1={cx + side * (D / 2) * k * 1.4} y1={hy} x2={hx} y2={hy} stroke="#d9c58a" strokeDasharray="3 2" />}
            {len > 1 && (
              <line x1={cx} y1={hy} x2={cx + fx} y2={hy + fy} stroke="#a98bff" strokeWidth={3} markerEnd="url(#tugArrow)" />
            )}
            <text x={hx} y={hy + 26} textAnchor="middle" fontSize={9} fill="var(--text)">
              {t.id}
            </text>
          </g>
        );
      })}
      <defs>
        <marker id="tugArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill="#a98bff" />
        </marker>
      </defs>
    </svg>
  );
}

export function HarborScreen() {
  const e = useSim(8);
  const s = e.state;
  const st = s.tugs;
  const tc = e.vessel.tugs ?? defaultTugs();
  if (!st) return <div className="panel">Rebocadores indisponíveis.</div>;
  const cur = e.env.currentAt(s.t);
  const yawRate = (s.body.omega.z * 180) / Math.PI;
  const surfaceOk = s.body.pos.z < tc.maxDepth;
  return (
    <div className="grid">
      <Panel title="Rebocadores">
        {!surfaceOk && <ToneBadge tone="warn" text={`CABOS DESLIGADOS — eixo abaixo de ${tc.maxDepth} m`} />}
        {tc.tugs.map((t) => {
          const ts = st.tugs[t.id];
          if (!ts) return null;
          return (
            <div key={t.id} style={{ borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
              <div className="btnrow">
                <b style={{ flex: '1 1 140px' }}>
                  {t.name} <span className="subtle">(x = {fmt(t.x, 0)} m, até {fmtForce(t.bollardPull)})</span>
                </b>
                <OnOff on={ts.connected && ts.level > 0.01} onText={`${ts.mode.toUpperCase()} ${fmt(ts.level * 100, 0)} %`} offText={ts.mode === 'livre' ? 'LARGADO' : 'SEM TRAÇÃO'} />
              </div>
              <div className="btnrow">
                <div className="seg">
                  {MODES.map((m) => (
                    <button key={m.id} className={ts.mode === m.id ? 'on' : ''} onClick={() => cmd({ type: 'tug', id: t.id, mode: m.id })}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="seg">
                  {(['BB', 'BE'] as const).map((sd) => (
                    <button key={sd} className={ts.side === sd ? 'on' : ''} onClick={() => cmd({ type: 'tug', id: t.id, side: sd })} title={sd === 'BB' ? 'bombordo' : 'boreste'}>
                      {sd}
                    </button>
                  ))}
                </div>
              </div>
              <div className="btnrow">
                <label className="p3-field">
                  tração
                  <input type="range" min={0} max={100} step={5} value={Math.round(ts.cmd * 100)} disabled={ts.mode === 'livre'} onChange={(ev) => cmd({ type: 'tug', id: t.id, cmd: Number(ev.target.value) / 100 })} />
                  <span className="num">{fmt(ts.cmd * 100, 0)} %</span>
                </label>
                <label className="p3-field">
                  ângulo
                  <input type="range" min={-60} max={60} step={5} value={ts.angle} disabled={ts.mode === 'livre'} onChange={(ev) => cmd({ type: 'tug', id: t.id, angle: Number(ev.target.value) })} />
                  <span className="num">{fmt(ts.angle, 0)}°</span>
                </label>
              </div>
            </div>
          );
        })}
        <div className="btnrow">
          <button className="btn sm" onClick={() => cmd({ type: 'tug', id: 'ALL', mode: 'livre' })}>
            Largar todos
          </button>
        </div>
        <p className="subtle">
          Empurrando, a força vai do bordo do rebocador para o outro; puxando pelo cabo, para fora. Os dois do mesmo lado deslocam o casco de lado; em lados opostos (ou só
          um) fazem o casco girar. O ângulo inclina a força para vante (+) ou para ré (−). Só com o submarino na superfície.
        </p>
      </Panel>
      <Panel title="Resultado no casco">
        <TopView e={e} />
        <KV
          rows={[
            ['Força lateral (corpo)', fmtForce(st.F.y)],
            ['Força longitudinal', fmtForce(st.F.x)],
            ['Momento de guinada', `${fmt(st.M.z / 1e6, 2)} MN·m`],
            ['Razão de guinada', `${fmt(yawRate, 2)} °/s`],
            ['Deriva lateral (v)', `${fmt(s.body.vel.y, 2)} m/s`],
            ['Corrente', Math.hypot(cur.x, cur.y) > 0 ? `${fmt((Math.hypot(cur.x, cur.y) * 3600) / 1852, 1)} nós para ${fmt(((Math.atan2(cur.y, cur.x) * 180) / Math.PI + 360) % 360, 0)}°` : 'sem corrente'],
          ]}
        />
      </Panel>
      <Panel title="Máquina e leme">
        <Telegraph e={e} />
        <SurfaceControl e={e} id="rudder" />
        <p className="subtle">Corrente e posição geográfica: Mapa tático. Saída da base: cenário “Saída da base (Itaguaí)”.</p>
      </Panel>
    </div>
  );
}
