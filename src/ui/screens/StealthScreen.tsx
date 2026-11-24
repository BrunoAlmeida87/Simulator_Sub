/**
 * Operação › Discrição e ameaças: exposição dos mastros, ruído irradiado e contra-detecção, aeronave de
 * patrulha (radar × MAGE), torpedo de exercício contra o SX-1 e despistadores. Ações do instrutor em violeta.
 */
import { useState } from 'react';
import { cmd, useSim } from '../store';
import { Panel } from '../components/Panel';
import { KV, LevelRow, OnOff, ToneBadge } from '../components/StatusBits';
import { HBar } from '../components/gauges';
import { ownNoiseSources } from '../../sonar/sources/signatures';
import { sumDb } from '../../sonar/types';
import { ambientNoise } from '../../sonar/acoustics/environment';
import { counterDetectionRange, indiscretionRatio, aircraftRange, RADIATED_OFFSET } from '../../sim/systems/stealth';
import { nearestThreat } from '../../sim/systems/threat';
import { defaultStealth, defaultThreat } from '../../sim/config/extSystems';
import { fmt } from '../format';
import type { SimulationEngine } from '../../sim/core/engine';

const brgTo = (e: SimulationEngine, n: number, ea: number) => (((Math.atan2(ea - e.state.body.pos.y, n - e.state.body.pos.x) * 180) / Math.PI + 360) % 360);

/** plotagem tática simples centrada no SX-1 (norte para cima) */
function Plot({ e, cdr }: { e: SimulationEngine; cdr: number }) {
  const s = e.state;
  const ac = s.stealth?.aircraft;
  const th = s.threat;
  const R = 150;
  const range = Math.max(4000, Math.min(60000, Math.max(cdr * 1.3, ac ? aircraftRange(s) * 1.15 : 0, ...(th?.torpedoes ?? []).map((t) => Math.hypot(t.n - s.body.pos.x, t.e - s.body.pos.y) * 1.15))));
  const p = (n: number, ea: number) => ({ x: R + ((ea - s.body.pos.y) / range) * R, y: R - ((n - s.body.pos.x) / range) * R });
  const h = (e.outputs.euler.heading * Math.PI) / 180;
  return (
    <svg className="p3-svg" viewBox={`0 0 ${2 * R} ${2 * R}`} style={{ maxWidth: 340 }} role="img" aria-label="Plotagem: SX-1 no centro, aeronave, torpedos, despistadores e alcance de contra-detecção">
      <circle cx={R} cy={R} r={R - 1} fill="rgba(5,12,20,0.6)" stroke="var(--line)" />
      <circle cx={R} cy={R} r={R / 2} fill="none" stroke="var(--line)" strokeDasharray="2 4" />
      <text x={R + 3} y={R / 2 - 3} fontSize={9} fill="var(--muted)">
        {fmt(range / 2000, 1)} km
      </text>
      <circle cx={R} cy={R} r={(cdr / range) * R} fill="rgba(169,139,255,0.08)" stroke="#a98bff" strokeDasharray="5 3" />
      <line x1={R} y1={R} x2={R + 12 * Math.sin(h)} y2={R - 12 * Math.cos(h)} stroke="var(--accent)" strokeWidth={3} />
      <circle cx={R} cy={R} r={3} fill="var(--accent)" />
      {ac && (
        <g>
          <text {...p(ac.n, ac.e)} fontSize={14} textAnchor="middle" dominantBaseline="middle" fill="#e9f8ff">
            ✈
          </text>
          {ac.datum && <circle {...(() => { const q = p(ac.datum!.n, ac.datum!.e); return { cx: q.x, cy: q.y }; })()} r={5} fill="none" stroke="var(--warn)" />}
        </g>
      )}
      {th?.decoys.map((d) => {
        const q = p(d.n, d.e);
        return <rect key={d.id} x={q.x - 3} y={q.y - 3} width={6} height={6} fill="none" stroke="#a98bff" />;
      })}
      {th?.torpedoes
        .filter((t) => t.phase !== 'fim' && t.phase !== 'impacto')
        .map((t) => {
          const q = p(t.n, t.e);
          const a = (t.heading * Math.PI) / 180;
          return (
            <g key={t.id}>
              <line x1={q.x} y1={q.y} x2={q.x + 10 * Math.sin(a)} y2={q.y - 10 * Math.cos(a)} stroke="var(--alarm)" strokeWidth={2} />
              <text x={q.x + 5} y={q.y - 5} fontSize={9} fill="var(--alarm)">
                ◆ {t.id}
              </text>
            </g>
          );
        })}
    </svg>
  );
}

export function StealthScreen() {
  const e = useSim(5);
  const s = e.state;
  const st = s.stealth;
  const th = s.threat;
  const [acRange, setAcRange] = useState(25);
  const [acBrg, setAcBrg] = useState(45);
  const [tRange, setTRange] = useState(5);
  const [tBrg, setTBrg] = useState(0);
  const [warhead, setWarhead] = useState<'exercicio' | 'avaria'>('exercicio');
  if (!st || !th) return <div className="panel">Discrição indisponível.</div>;
  const sc = e.vessel.stealth ?? defaultStealth();
  const tc = e.vessel.threat ?? defaultThreat();
  const sources = ownNoiseSources(s).filter((x) => x.level > -50);
  const own = sumDb(...sources.map((x) => x.level));
  const radiated = own + RADIATED_OFFSET;
  const nl = s.sonar?.noise.ambient || ambientNoise(e.env.cfg.waves?.seaState ?? 0, s.sonar?.settings.shipping ?? 0.3, s.sonar?.settings.biological ?? 0.2);
  const cdr = counterDetectionRange(radiated, nl, sc.enemySonar.di, sc.enemySonar.dt);
  const ratio = indiscretionRatio(s);
  const ac = st.aircraft;
  const acR = aircraftRange(s);
  const threatR = nearestThreat(s);
  return (
    <div className="grid">
      <Panel title="Exposição e indiscrição">
        <div className="btnrow">
          {st.exposed.length ? <ToneBadge tone="warn" text={`EXPOSTO: ${st.exposed.join(', ')}`} /> : <ToneBadge tone="" text="NADA EXPOSTO" />}
        </div>
        <LevelRow label="Taxa de indiscrição (última hora)" value={ratio * 100} unit="%" digits={0} max={100} warn={10} alarm={25} note="Fração do tempo com mastro ou casco fora d’água. Recarregar a bateria pelo snorkel aumenta a taxa: esse é o compromisso do submarino convencional." />
        <svg className="p3-svg" viewBox="0 0 300 40" role="img" aria-label="Exposição por minuto na última hora">
          {st.bins.map((b, i) => {
            const k = (i - st.binIndex - 1 + 120) % 60;
            const hgt = (Math.min(60, b) / 60) * 36;
            return <rect key={i} x={k * 5} y={38 - hgt} width={4} height={hgt} fill={b > 0 ? 'var(--warn)' : 'var(--line)'} />;
          })}
        </svg>
        <div className="subtle">Cada barra = 1 min (a mais recente à direita).</div>
      </Panel>

      <Panel title="Ruído irradiado e contra-detecção">
        {sources.map((x) => (
          <div key={x.id} className="lvl-row">
            <div className="lvl-head">
              <span>{x.name}</span>
              <b className="num">{fmt(x.level, 0)} dB</b>
            </div>
            <HBar value={x.level} min={20} max={80} color={x.level >= own - 3 ? 'var(--warn)' : 'var(--accent)'} />
          </div>
        ))}
        <KV
          rows={[
            ['Ruído próprio total', `${fmt(own, 1)} dB`],
            ['Nível irradiado estimado', `${fmt(radiated, 0)} dB re 1 µPa a 1 m`],
            ['Ruído ambiente', `${fmt(nl, 0)} dB`],
            ['Contra-detecção (oponente DI ' + sc.enemySonar.di + ', DT ' + sc.enemySonar.dt + ')', `${fmt(cdr / 1000, 1)} km`],
          ]}
        />
        <p className="subtle">Ilustrativo: TL = 20·log r + 0,07 dB/km. Diesel e alta rotação dominam; com o diesel parado e baixa rotação o alcance cai muito.</p>
      </Panel>

      <Panel title="Plotagem">
        <Plot e={e} cdr={cdr} />
        <div className="subtle">Centro: SX-1 · círculo violeta: contra-detecção · ✈ aeronave · ◆ torpedo · □ despistador.</div>
      </Panel>

      <Panel title="Aeronave de patrulha (exercício)">
        {ac ? (
          <KV
            rows={[
              ['Distância / marcação', `${fmt(acR / 1000, 1)} km / ${fmt(brgTo(e, ac.n, ac.e), 0)}°`],
              ['Radar contra mastro', `${fmt(sc.aircraft.radarRange / 1000, 0)} km`],
              ['MAGE', ac.esmWarned ? '▲ radar interceptado' : acR < sc.aircraft.esmRange ? 'ao alcance (mastro exposto para interceptar)' : 'fora de alcance'],
              ['Detecções', `${st.detections}${ac.detectedAt != null ? ` (última em t = ${fmt(ac.detectedAt, 0)} s)` : ''}`],
            ]}
          />
        ) : (
          <p className="subtle">Nenhuma aeronave no exercício.</p>
        )}
        <div className="btnrow">
          <label className="p3-field">
            distância <input type="number" value={acRange} min={2} max={80} onChange={(ev) => setAcRange(Number(ev.target.value))} /> km
          </label>
          <label className="p3-field">
            marcação <input type="number" value={acBrg} min={0} max={359} onChange={(ev) => setAcBrg(Number(ev.target.value))} />°
          </label>
          <button className="btn sm instr" onClick={() => cmd({ type: 'aircraft', action: 'spawn', range: acRange * 1000, bearing: acBrg })}>
            Instrutor: lançar aeronave
          </button>
          {ac && (
            <button className="btn sm instr" onClick={() => cmd({ type: 'aircraft', action: 'remove' })}>
              Retirar
            </button>
          )}
        </div>
      </Panel>

      <Panel title="Torpedo contra o SX-1 e despistadores">
        <div className="btnrow">
          {threatR < Infinity ? <ToneBadge tone="alarm" text={`TORPEDO A ${fmt(threatR / 1000, 2)} km`} /> : <ToneBadge tone="" text="SEM AMEAÇA" />}
          <button className="btn sm" onClick={() => cmd({ type: 'threat', action: 'decoy' })} disabled={th.decoyStock <= 0}>
            Lançar despistador ({th.decoyStock})
          </button>
          <OnOff on={th.decoys.length > 0} onText={`${th.decoys.length} ATIVO(S)`} offText="NENHUM ATIVO" />
        </div>
        {th.torpedoes.length > 0 && (
          <div className="p3-scroll">
            <table className="t p3-table">
              <thead>
                <tr>
                  <th>Arma</th>
                  <th>Fase</th>
                  <th>Distância</th>
                  <th>Marcação</th>
                  <th>Alvo</th>
                </tr>
              </thead>
              <tbody>
                {th.torpedoes.map((t) => (
                  <tr key={t.id}>
                    <td>{t.id}</td>
                    <td>{t.phase}</td>
                    <td className="num">{fmt(Math.hypot(t.n - s.body.pos.x, t.e - s.body.pos.y) / 1000, 2)} km</td>
                    <td className="num">{fmt(brgTo(e, t.n, t.e), 0)}°</td>
                    <td>{t.target === 'sx1' ? '◆ SX-1' : t.target ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {th.last && <p>{th.last}</p>}
        <div className="btnrow">
          <label className="p3-field">
            distância <input type="number" value={tRange} min={1} max={20} step={0.5} onChange={(ev) => setTRange(Number(ev.target.value))} /> km
          </label>
          <label className="p3-field">
            marcação <input type="number" value={tBrg} min={0} max={359} onChange={(ev) => setTBrg(Number(ev.target.value))} />°
          </label>
          <label className="p3-field">
            carga
            <select value={warhead} onChange={(ev) => setWarhead(ev.target.value as 'exercicio' | 'avaria')}>
              <option value="exercicio">exercício (só registra)</option>
              <option value="avaria">com avaria (abre rombo)</option>
            </select>
          </label>
          <button className="btn sm instr" onClick={() => cmd({ type: 'threat', action: 'launch', range: tRange * 1000, bearing: tBrg, warhead })}>
            Instrutor: lançar torpedo
          </button>
          <button className="btn sm instr" onClick={() => cmd({ type: 'threat', action: 'clear' })}>
            Limpar
          </button>
        </div>
        <p className="subtle">
          Autodiretor com cone de ±{tc.torpedo.seekerCone}° e {fmt(tc.torpedo.seekerRange / 1000, 1)} km; escolhe o alvo de maior sinal. Evasão: reduzir o ruído (baixa
          rotação, diesel parado), lançar o despistador e afastar-se dele com guinada e mudança de cota.
        </p>
      </Panel>
    </div>
  );
}
