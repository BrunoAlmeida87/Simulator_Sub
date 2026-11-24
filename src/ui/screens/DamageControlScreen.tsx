/** Sistemas › Controle de avarias: quadro de avarias (perfil), esgoto, portas estanques e incêndio. */
import { cmd, useSim } from '../store';
import { Panel } from '../components/Panel';
import { KV, OnOff, ToneBadge, Toggle } from '../components/StatusBits';
import { bilgeCutoffDepth, bilgeFlow, compartmentMaxWater } from '../../sim/systems/damage';
import { defaultDamage } from '../../sim/config/extSystems';
import { loadPowered } from '../../sim/systems/distribution';
import { qToMat3 } from '../../sim/core/math';
import { fmt, fmtMass } from '../format';
import type { SimulationEngine } from '../../sim/core/engine';

function Board({ e }: { e: SimulationEngine }) {
  const v = e.vessel;
  const s = e.state;
  const L = v.hull.length;
  const W = 720;
  const H = 120;
  const y0 = 30;
  const px = (x: number) => ((x + L / 2) / L) * W;
  const dmg = v.damage ?? defaultDamage();
  return (
    <svg className="p3-svg" viewBox={`0 0 ${W} ${H + 74}`} style={{ maxWidth: 860, margin: '0 auto' }} role="img" aria-label="Quadro de avarias: perfil do casco com os compartimentos">
      <text x={4} y={14} fontSize={11} fill="var(--muted)">
        ← ré
      </text>
      <text x={W - 40} y={14} fontSize={11} fill="var(--muted)">
        vante →
      </text>
      <rect x={1} y={y0} width={W - 2} height={H} rx={H / 2} fill="none" stroke="var(--line2)" strokeWidth={2} />
      {v.compartments.map((c) => {
        const f = s.flooding[c.id];
        const max = compartmentMaxWater(v, c);
        const fill = Math.min(1, f.water / max);
        const fire = s.damage?.fires[c.id];
        const x0 = px(c.xAft);
        const x1 = px(c.xFwd);
        const hw = fill * H * 0.6;
        return (
          <g key={c.id}>
            <rect x={x0} y={y0} width={x1 - x0} height={H} fill="rgba(54,197,240,0.04)" stroke="var(--line)" />
            {hw > 0.5 && <rect x={x0 + 1} y={y0 + H - hw} width={x1 - x0 - 2} height={hw} fill="rgba(54,140,240,0.55)" />}
            {fire && fire.intensity > 0 && (
              <g>
                <rect x={x0 + 4} y={y0 + 6} width={x1 - x0 - 8} height={18} fill="rgba(255,82,87,0.25)" stroke="var(--alarm)" />
                <text x={(x0 + x1) / 2} y={y0 + 19} textAnchor="middle" fontSize={11} fill="#ffd0d0">
                  ◆ INCÊNDIO {fmt(fire.intensity * 100, 0)} %
                </text>
              </g>
            )}
            <text x={(x0 + x1) / 2} y={y0 + H / 2} textAnchor="middle" fontSize={12} fill="var(--text)">
              {c.id}
            </text>
            <text x={(x0 + x1) / 2} y={y0 + H / 2 + 15} textAnchor="middle" fontSize={10} fill="var(--muted)">
              {f.water > 1 ? fmtMass(f.water) : 'seco'}
            </text>
            {f.breachArea > 0 && (
              <text x={(x0 + x1) / 2} y={y0 + H + 16} textAnchor="middle" fontSize={11} fill="var(--alarm)">
                ◆ rombo {fmt(f.breachArea * 1e4, 0)} cm²
              </text>
            )}
          </g>
        );
      })}
      {dmg.doors.map((d) => {
        const open = s.damage?.doors[d.id]?.open;
        const x = px(d.x);
        return (
          <g key={d.id}>
            <line x1={x} x2={x} y1={y0 + H * 0.35} y2={y0 + H} stroke={open ? 'var(--warn)' : 'var(--line2)'} strokeWidth={open ? 2 : 5} strokeDasharray={open ? '4 4' : undefined} />
            <text x={x} y={y0 + H + 34} textAnchor="middle" fontSize={10} fill={open ? 'var(--warn)' : 'var(--muted)'}>
              {d.id} {open ? '▲ aberta' : 'fechada'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function DamageControlScreen() {
  const e = useSim(5);
  const s = e.state;
  const v = e.vessel;
  const d = v.damage ?? defaultDamage();
  const st = s.damage;
  if (!st) return <div className="panel">Controle de avarias indisponível.</div>;
  const powered = loadPowered(s, 'ESG');
  const R = qToMat3(s.body.quat);
  const comp = new Map(v.compartments.map((c) => [c.id, c]));
  const cutoff = d.bilgePumps.length ? bilgeCutoffDepth(d.bilgePumps[0].shutoff) : 0;
  return (
    <div className="grid">
      <Panel title="Quadro de avarias" className="span-all">
        <Board e={e} />
        <p className="subtle">
          Água no porão (azul) até o máximo de 60 % do volume do compartimento, incêndios e portas estanques. As portas começam fechadas (condição de mergulho); abertas, a água acima de {fmt(d.doorSill * 100, 0)} % de
          enchimento passa para o compartimento vizinho e um incêndio forte pode se propagar.
        </p>
      </Panel>

      <Panel title="Esgoto do porão" className="span2">
        <p className="subtle">
          A bomba descarrega ao mar contra a pressão externa: Q = Qₙ·√(1 − Δp/Δp₀). Com Δp₀ = {fmt(d.bilgePumps[0]?.shutoff / 1e5, 0)} bar ela deixa de esgotar abaixo de ≈ {fmt(cutoff, 0)} m — perto da superfície esgota
          muito mais rápido. Energia: disjuntor ESG {powered ? '(fechado)' : '— ABERTO ou sem barramento'}.
        </p>
        <div className="p3-scroll">
          <table className="t p3-table">
            <thead>
              <tr>
                <th>Bomba</th>
                <th>Estado</th>
                <th>Vazão</th>
                <th>Possível aqui</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.bilgePumps.map((p) => {
                const ps = st.pumps[p.id];
                const c = comp.get(p.compartment);
                const z = c ? s.body.pos.z + R[6] * 0.5 * (c.xFwd + c.xAft) + R[8] * c.bilgeZ : 0;
                const dp = z > 0 ? e.env.pressureAt(z) - v.internalPressure : 0;
                const qmax = bilgeFlow(p.ratedFlow, p.shutoff, dp);
                return (
                  <tr key={p.id}>
                    <td title={p.name}>
                      <b>{p.id}</b> <span className="subtle">{p.compartment}</span>
                    </td>
                    <td>
                      <OnOff on={!!ps?.cmd && powered} onText="ESGOTANDO" offText={ps?.cmd ? 'SEM ENERGIA' : 'PARADA'} />
                    </td>
                    <td className="num">{fmt((ps?.flow ?? 0) * 3600, 1)} m³/h</td>
                    <td className="num">{qmax > 0 ? `${fmt(qmax * 3600, 0)} m³/h` : <ToneBadge tone="warn" text="SEM VAZÃO (fundo demais)" />}</td>
                    <td>
                      <Toggle on={!!ps?.cmd} onClick={() => cmd({ type: 'bilge', id: p.id, on: !ps?.cmd })}>
                        {ps?.cmd ? 'Parar' : 'Partir'}
                      </Toggle>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Compartimentos">
        <div className="p3-scroll">
          <table className="t p3-table">
            <thead>
              <tr>
                <th>Compartimento</th>
                <th>Água</th>
                <th>Entrada</th>
                <th>Temp.</th>
              </tr>
            </thead>
            <tbody>
              {v.compartments.map((c) => {
                const f = s.flooding[c.id];
                const fire = st.fires[c.id];
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="num">
                      {fmtMass(f.water)} <span className="subtle">({fmt((f.water / compartmentMaxWater(v, c)) * 100, 0)} %)</span>
                    </td>
                    <td className="num">{f.rate > 0 ? <ToneBadge tone="alarm" text={`${fmt(f.rate * 3600, 1)} m³/h`} /> : '—'}</td>
                    <td className="num">{fmt(fire?.temp ?? 24, 0)} °C</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Portas estanques">
        {d.doors.map((door) => {
          const ds = st.doors[door.id];
          return (
            <div className="btnrow" key={door.id}>
              <span style={{ flex: '1 1 180px' }}>{door.name}</span>
              <OnOff on={!ds?.open} onText="FECHADA" offText="ABERTA" />
              <Toggle on={!!ds?.open} onClick={() => cmd({ type: 'door', id: door.id, open: !ds?.open })}>
                {ds?.open ? 'Fechar' : 'Abrir'}
              </Toggle>
              {ds && Math.abs(ds.flow) > 0.01 && <span className="subtle">passando {fmt(Math.abs(ds.flow) * 3.6, 1)} t/h</span>}
            </div>
          );
        })}
      </Panel>

      <Panel title="Incêndio">
        <KV rows={[['Agente extintor', `${fmt(st.agent, 0)} kg de ${fmt(d.fire.agent, 0)} kg`]]} />
        {v.compartments.map((c) => {
          const f = st.fires[c.id];
          if (!f) return null;
          return (
            <div className="btnrow" key={c.id}>
              <span style={{ flex: '1 1 180px' }}>{c.name}</span>
              {f.intensity > 0 ? <ToneBadge tone="alarm" text={`${f.detected ? 'INCÊNDIO' : 'fogo não detectado'} ${fmt(f.intensity * 100, 0)} %`} /> : <ToneBadge tone="" text="SEM FOGO" />}
              <Toggle on={f.fighting} onClick={() => cmd({ type: 'fire', compartment: c.id, fight: !f.fighting })}>
                {f.fighting ? 'Interromper combate' : 'Combater'}
              </Toggle>
              <button className="btn sm instr" onClick={() => cmd({ type: 'failure', target: `fire:${c.id}`, active: true, param: 5 })} title="Ação do instrutor: iniciar um incêndio de treinamento">
                Instrutor: iniciar
              </button>
            </div>
          );
        })}
        <p className="subtle">O fogo cresce com o O₂ do ar e produz CO₂ e CO (Atmosfera). Detecção após {fmt(d.fire.detectDelay, 0)} s acima do limiar; água no porão acima de 30 % também o apaga.</p>
      </Panel>
    </div>
  );
}
