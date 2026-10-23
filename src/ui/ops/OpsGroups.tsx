/**
 * Grupos da CENTRAL DE OPERAÇÃO: cada sistema com um resumo (visível mesmo
 * recolhido) e os controles completos. Todos enviam os mesmos comandos das
 * outras telas — o estado é único e compartilhado.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { cmd, runner } from '../store';
import type { SimulationEngine } from '../../sim/core/engine';
import { Telegraph, SurfaceControl, NumSet } from '../components/Controls';
import { TransferControls } from '../screens/TrimHeelScreen';
import { TrimDemoPanel } from '../components/TrimDemo';
import { TourList } from '../components/TourCard';
import { valveStatus, pumpStatus } from '../../sim/systems/components';
import { compensationBranches, compensationWater, tankVolume } from '../../sim/systems/internalTanks';
import { RHO_NOMINAL } from '../../sim/core/context';
import { bankPressure, emergencyBlowActive } from '../../sim/systems/hpAir';
import { solveNeutralCompensation } from '../../sim/equilibrium';
import { failureCatalog, isFailureActive } from '../../sim/commands';
import type { SensorFailMode, ValveState } from '../../sim/core/state';
import { visibleAlarms, PRIORITY_LABEL } from '../../sim/systems/alarms';
import { SEA_STATES } from '../../sim/environment/waves';
import { SCENARIOS, buildScenario } from '../../sim/scenarios';
import { fmt, fmtSpeed } from '../format';
import { baseConfig } from '../store';
import { useUi } from '../uiContext';
import { opsBus, ALARM_GROUP, type GroupId } from './opsBus';
import { demo } from '../demo';
import { maneuver } from '../maneuvers';
import { tours } from '../tours';

const fill = (e: SimulationEngine) => e.vessel.ballast.tanks.reduce((a, t) => a + e.state.ballast[t.id].water, 0) / e.vessel.ballast.tanks.reduce((a, t) => a + t.volume, 0);

function VBadge({ v }: { v: ValveState }) {
  const s = valveStatus(v);
  return <span className={`badge ${s === 'ABERTA' ? 'ok' : s === 'FECHADA' ? 'off' : s === 'TRAVADA' ? 'alarm' : 'warn'}`}>{s}</span>;
}

const isFocus = (id: string) => opsBus.focusTarget?.id === id;

// ------------------------------------------------------------ navegação
function NavBody({ e }: { e: SimulationEngine }) {
  const f = opsBus.focusTarget;
  return (
    <div className="col">
      <Telegraph e={e} />
      {(['bow', 'stern', 'rudder'] as const).map((id) => (
        <div key={id} className={f?.kind === 'fin' && f.id === id ? 'focus' : ''}>
          <SurfaceControl e={e} id={id} />
        </div>
      ))}
      <ApCompact e={e} />
    </div>
  );
}

/** Pilotos automáticos (rumo, profundidade, inclinação) em formato compacto. */
function ApCompact({ e }: { e: SimulationEngine }) {
  const ap = e.state.autopilot;
  const rows: [string, 'heading' | 'depth' | 'pitch', 'MANUAL' | 'AUTO', number, string, number, number, number, typeof ap.tHeading][] = [
    ['Rumo', 'heading', ap.headingMode, ap.headingSet, '°', 5, 0, 359, ap.tHeading],
    ['Profundidade', 'depth', ap.depthMode, ap.depthSet, 'm', 5, 0, 400, ap.tDepth],
    ['Inclinação', 'pitch', ap.pitchMode, ap.pitchSet, '°', 1, -15, 15, ap.tPitch],
  ];
  return (
    <div className="col">
      <b className="subtle">Pilotos automáticos</b>
      {rows.map(([label, ch, mode, set, unit, step, min, max, tel]) => (
        <div key={ch} className="row" style={{ gap: 6 }}>
          <span style={{ width: 86, fontSize: 12 }}>{label}</span>
          <div className="seg">
            <button className={mode === 'MANUAL' ? 'on' : ''} onClick={() => cmd({ type: 'autopilot', channel: ch, mode: 'MANUAL' })}>
              MAN
            </button>
            <button className={mode === 'AUTO' ? 'on' : ''} onClick={() => cmd({ type: 'autopilot', channel: ch, mode: 'AUTO' })}>
              AUTO
            </button>
          </div>
          <NumSet value={set} step={step} unit={unit} min={min} max={max} onSet={(val) => cmd({ type: 'setpoint', channel: ch, value: val })} />
          {mode === 'AUTO' && (
            <span className="subtle mono">
              erro {fmt(tel.error, 1)}
              {tel.saturated ? ' · SAT' : ''}
              {tel.lowEffectiveness ? ' · baixa efetiv.' : ''}
            </span>
          )}
        </div>
      ))}
      {ap.depthMode === 'AUTO' && (
        <div className="subtle">
          Cascata: θ ordenado {fmt(ap.tDepth.output, 1)}° → lemes de ré {fmt(ap.tPitch.output, 1)}°, vante {fmt(ap.tBow.output, 1)}°. Detalhes PID na Central de comando.
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ lastro
function LastroBody({ e }: { e: SimulationEngine }) {
  const v = e.vessel;
  const s = e.state;
  return (
    <div className="col">
      <div className="col ballast-actions">
        <div className="btngroup" role="group" aria-label="Suspiros">
          <button className="btn sm" onClick={() => cmd({ type: 'mbtVent', tank: 'ALL', open: true })}>
            Abrir suspiros
          </button>
          <button className="btn sm" onClick={() => cmd({ type: 'mbtVent', tank: 'ALL', open: false })}>
            Fechar suspiros
          </button>
        </div>
        <div className="btngroup" role="group" aria-label="Sopro normal">
          <button className="btn sm ok" onClick={() => cmd({ type: 'mbtBlow', tank: 'ALL', open: true })}>
            Soprar TLP
          </button>
          <button className="btn sm" onClick={() => cmd({ type: 'mbtBlow', tank: 'ALL', open: false })}>
            Fechar sopro
          </button>
        </div>
        <div className="btngroup" role="group" aria-label="Sopro de emergência">
          <button className="btn sm danger" onClick={() => cmd({ type: 'emergencyBlow' })}>
            SOPRO DE EMERGÊNCIA
          </button>
          <button className="btn sm" onClick={() => cmd({ type: 'emergencyBlow', open: false })}>
            Fechar emergência
          </button>
          {v.ballast.tanks.some((t) => s.ballast[t.id].emergencyBlow.cmd > 0.5) && <span className="badge warn">EMERGÊNCIA ATIVA</span>}
        </div>
      </div>
      <table className="t ops-t">
        <thead>
          <tr>
            <th>Tanque</th>
            <th>Água</th>
            <th>Suspiro</th>
            <th>Sopro</th>
          </tr>
        </thead>
        <tbody>
          {v.ballast.tanks.map((t) => {
            const st = s.ballast[t.id];
            const f = st.water / t.volume;
            return (
              <tr key={t.id} className={isFocus(t.id) ? 'focus' : ''} onClick={() => opsBus.select({ kind: 'tank', id: t.id })} style={{ cursor: 'pointer' }}>
                <td>
                  <b>{t.id.replace('TLP', 'TLP-')}</b>
                  <div className="subtle">{st.pAir > 0.5e5 ? `${(st.pAir / 1e5).toFixed(2)} bar ar` : st.water >= t.volume - 0.05 ? 'sem ar' : '—'}</div>
                </td>
                <td>
                  <span className="minibar">
                    <span style={{ width: `${f * 100}%` }} />
                  </span>{' '}
                  <span className="mono">{fmt(f * 100, 0)} %</span>
                  {Math.abs(st.qWater) > 0.01 && (
                    <div className="subtle">
                      {st.qWater > 0 ? '▲ entrando' : '▼ saindo'} {fmt(Math.abs(st.qWater), 2)} m³/s
                    </div>
                  )}
                </td>
                <td onClick={(ev) => ev.stopPropagation()}>
                  <VBadge v={st.vent} />
                  <button className="btn sm" onClick={() => cmd({ type: 'mbtVent', tank: t.id, open: st.vent.cmd < 0.5 })}>
                    {st.vent.cmd > 0.5 ? 'Fechar' : 'Abrir'}
                  </button>
                </td>
                <td onClick={(ev) => ev.stopPropagation()}>
                  <VBadge v={st.blow} />
                  <button className="btn sm" onClick={() => cmd({ type: 'mbtBlow', tank: t.id, open: st.blow.cmd < 0.5 })}>
                    {st.blow.cmd > 0.5 ? 'Fechar' : 'Abrir'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="subtle">
        Reserva de flutuabilidade: <b className="mono">{fmt(e.outputs.reserveKg / 1000, 1)} t</b> · coletor AP <b className="mono">{fmt(e.outputs.hpManifoldBar, 0)} bar</b>. Clique numa linha para destacar o tanque na
        cena.
      </div>
    </div>
  );
}

// ------------------------------------------------------------ compensação
function CompBody({ e }: { e: SimulationEngine }) {
  const v = e.vessel;
  const s = e.state;
  const c = s.compensation;
  const [kg, setKg] = useState(500);
  // na superfície o equilíbrio submerso é calculado para a cota de 40 m (eixo)
  const calcDepth = e.outputs.surfaced ? 40 : Math.max(0, e.state.body.pos.z);
  const need = useMemo(() => solveNeutralCompensation(e, calcDepth, false), [e, Math.round(calcDepth), Math.round(s.t / 5)]);
  // água de compensação = tanque central + tanques de banda ligados ao coletor
  const needComp = Object.values(need.compensation).reduce((a, b) => a + b, 0) + (v.compensation.heelBranches?.length ? need.heelA + need.heelB : 0);
  const curComp = compensationWater(v.compensation, c, v.heel, s.heel);
  const d = c.dosing;
  return (
    <div className="col">
      <table className="t ops-t">
        <tbody>
          {compensationBranches(v.compensation, c, v.heel, s.heel).map((b) => {
            const vv = b.valve;
            const vol = tankVolume(b.st);
            const short = b.heel ? (b.heel === 'A' ? 'TB-BB' : 'TB-BE') : b.id;
            return (
              <tr key={b.id} className={isFocus(b.id) ? 'focus' : ''} onClick={() => opsBus.select({ kind: 'tank', id: b.id })} style={{ cursor: 'pointer' }}>
                <td>
                  <b>{short}</b> <span className="subtle">{b.heel ? 'banda · ramal ' + b.valveId : b.cfg.name.replace(/^TC(-\d)?\s*/, '')}</span>
                </td>
                <td className="mono">
                  {fmt(vol, 2)}/{fmt(b.cfg.capacity, 0)} m³
                </td>
                <td onClick={(ev) => ev.stopPropagation()}>
                  <VBadge v={vv} />
                  <button className="btn sm" onClick={() => cmd({ type: 'valve', system: 'compensation', valve: b.valveId, open: vv.cmd < 0.5 })}>
                    {vv.cmd > 0.5 ? 'Fechar' : 'Abrir'}
                  </button>
                </td>
              </tr>
            );
          })}
          <tr>
            <td>{v.compensation.inletValve.name}</td>
            <td className="mono">{fmt(c.qIn * 1000, 1)} L/s</td>
            <td>
              <VBadge v={c.inlet} />
              <button className="btn sm" onClick={() => cmd({ type: 'valve', system: 'compensation', valve: 'inlet', open: c.inlet.cmd < 0.5 })}>
                {c.inlet.cmd > 0.5 ? 'Fechar' : 'Abrir'}
              </button>
            </td>
          </tr>
          <tr>
            <td>{v.compensation.dischargeValve.name}</td>
            <td className="mono">{fmt(c.qOut * 1000, 1)} L/s</td>
            <td>
              <VBadge v={c.discharge} />
              <button className="btn sm" onClick={() => cmd({ type: 'valve', system: 'compensation', valve: 'discharge', open: c.discharge.cmd < 0.5 })}>
                {c.discharge.cmd > 0.5 ? 'Fechar' : 'Abrir'}
              </button>
            </td>
          </tr>
          <tr>
            <td>{v.compensation.pump.name}</td>
            <td className="mono">{fmt(c.pump.power / 1000, 1)} kW</td>
            <td>
              <span className={`badge ${c.pump.failed ? 'alarm' : c.pump.speed > 0.01 ? 'ok' : 'off'}`}>{pumpStatus(c.pump, s.electrical.energized)}</span>
              <button className="btn sm" onClick={() => cmd({ type: 'pump', system: 'compensation', run: !c.pump.cmd })}>
                {c.pump.cmd ? 'Parar' : 'Partir'}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="row">
        <span className="subtle">Dosagem</span>
        <NumSet value={kg} step={100} unit="kg" min={50} max={10000} onSet={setKg} />
        <button className="btn sm" onClick={() => cmd({ type: 'dosing', system: 'compensation', mode: 'admitir', kg })}>
          Admitir
        </button>
        <button className="btn sm" onClick={() => cmd({ type: 'dosing', system: 'compensation', mode: 'esgotar', kg })}>
          Esgotar
        </button>
        <button className="btn sm warn" disabled={!d?.active} onClick={() => cmd({ type: 'dosingAbort', system: 'compensation' })}>
          Interromper
        </button>
      </div>
      {d && (
        <div className="subtle">
          Sequência: {d.phase} — {fmt(d.moved, 0)}/{fmt(d.target, 0)} kg {d.message ? `· ${d.message}` : ''}
        </div>
      )}
      <div className="row">
        <button
          className="btn sm ok"
          onClick={() => {
            const dm = needComp - curComp;
            if (Math.abs(dm) > 10) cmd({ type: 'dosing', system: 'compensation', mode: dm > 0 ? 'admitir' : 'esgotar', kg: Math.abs(dm) });
          }}
        >
          Ajuste calculado ({fmt((needComp - curComp) / 1000, 2)} t para {fmt(calcDepth, 0)} m)
        </button>
        <span className="subtle">{e.outputs.surfaced ? `Na superfície: reserva ${fmt(e.outputs.reserveKg / 1000, 1)} t` : `Flutuabilidade líquida ${fmt(e.outputs.netBuoyancyKg / 1000, 2)} t`}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ trim e banda
function TrimBody({ e }: { e: SimulationEngine }) {
  const f = opsBus.focusTarget;
  return (
    <div className="col">
      <div className={f && (f.id === 'demoWeight' || f.kind === 'demoWeight') ? 'focus' : ''}>
        <div className="subtle mb4">Peso deslocável</div>
        <TrimDemoPanel e={e} compact />
      </div>
      <div className={f && (f.id === e.vessel.trim.tankA.id || f.id === e.vessel.trim.tankB.id || f.sys === 'trim') ? 'focus' : ''}>
        <div className="subtle mb4">Trim (TT-AV ↔ TT-AR)</div>
        <TransferControls e={e} sys="trim" />
      </div>
      <div className={f && (f.id === e.vessel.heel.tankA.id || f.id === e.vessel.heel.tankB.id || f.sys === 'heel') ? 'focus' : ''}>
        <div className="subtle mb4">Banda (TB-BB ↔ TB-BE)</div>
        <TransferControls e={e} sys="heel" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------ ar comprimido
function ArBody({ e }: { e: SimulationEngine }) {
  const v = e.vessel;
  const s = e.state;
  return (
    <div className="col">
      <table className="t ops-t">
        <tbody>
          {v.hpAir.banks.map((b) => {
            const st = s.hpAir.banks[b.id];
            const p = bankPressure(v.hpAir, b.id, st.mass) / 1e5;
            return (
              <tr key={b.id} className={isFocus(b.id) ? 'focus' : ''}>
                <td>
                  <b>{b.name}</b>
                  <div className="subtle">
                    {b.volume} m³ · {b.purpose === 'emergency' ? 'emergência' : 'normal'}
                  </div>
                </td>
                <td>
                  <span className="minibar">
                    <span style={{ width: `${(p / (b.maxPressure / 1e5)) * 100}%`, background: '#d9cf8f' }} />
                  </span>{' '}
                  <span className="mono">{fmt(p, 0)} bar</span>
                </td>
                <td>
                  <VBadge v={st.valve} />
                  <button className="btn sm" onClick={() => cmd({ type: 'hpBankValve', bank: b.id, open: st.valve.cmd < 0.5 })}>
                    {st.valve.cmd > 0.5 ? 'Isolar' : 'Abrir'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row">
        <span>
          Coletor: <b className="mono">{fmt(e.outputs.hpManifoldBar, 0)} bar</b>
        </span>
        <span>
          Emergência: <b className="mono">{fmt(s.hpAir.emergencyManifoldPressure / 1e5, 0)} bar</b>
        </span>
        <span>Compressor:</span>
        <span className={`badge ${s.hpAir.compressorRunning ? 'ok' : 'off'}`}>
          {s.hpAir.compressorRunning ? 'EM CARGA' : s.hpAir.compressorCmd || emergencyBlowActive(s) ? (e.outputs.airIntake && s.electrical.energized ? 'PRESSÃO MÁXIMA' : 'SEM AR/ENERGIA') : 'PARADO'}
        </span>
        {emergencyBlowActive(s) && <span className="badge warn">AUTOMÁTICO</span>}
        <button className={`btn sm ${s.hpAir.compressorCmd ? 'on' : ''}`} onClick={() => cmd({ type: 'compressor', run: !s.hpAir.compressorCmd })}>
          {s.hpAir.compressorCmd ? 'Parar manual' : 'Partir manual'}
        </button>
      </div>
      <div className="note">O compressor recarrega os dois circuitos e atua automaticamente durante a emergência, priorizando as ampolas dedicadas. Precisa de ar externo (snorkel ou superfície) e de energia.</div>
    </div>
  );
}

// ------------------------------------------------------------ energia
function EnergiaBody({ e }: { e: SimulationEngine }) {
  const v = e.vessel;
  const el = e.state.electrical;
  const sn = e.state.snorkel;
  const loads = Object.entries(el.loads)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  const f = opsBus.focusTarget;
  return (
    <div className="col">
      <div className={f?.kind === 'battery' ? 'focus' : ''}>
        <div className="row">
          <b>Bateria</b>
          <span className="minibar wide">
            <span style={{ width: `${el.soc * 100}%`, background: el.soc > 0.5 ? '#3ddc84' : el.soc > 0.25 ? '#ffc040' : '#ff4d4d' }} />
          </span>
          <span className="mono">{fmt(el.soc * 100, 1)} %</span>
        </div>
        <div className="row subtle">
          <span>
            {fmt(el.voltage, 0)} V · {fmt(el.current, 0)} A {el.current < -1 ? '(carregando)' : ''}
          </span>
          <span>Barramento {el.energized ? 'energizado' : 'SEM ENERGIA'}</span>
          <button className={`btn sm ${el.breakerClosed ? 'on' : 'warn'}`} onClick={() => cmd({ type: 'breaker', closed: !el.breakerClosed })}>
            Disjuntor {el.breakerClosed ? 'fechado' : 'aberto'}
          </button>
        </div>
      </div>
      <div className="subtle">
        Demanda {fmt(el.totalLoad / 1000, 0)} kW · geração {fmt(el.generation / 1000, 0)} kW · {loads.map(([k, w]) => `${k} ${fmt(w / 1000, 0)} kW`).join(' · ')}
      </div>
      <table className="t ops-t">
        <tbody>
          {v.electrical.generators.map((g) => {
            const st = el.generators[g.id];
            return (
              <tr key={g.id} className={isFocus(g.id) ? 'focus' : ''}>
                <td>
                  <b>{g.name}</b>
                </td>
                <td>
                  <span className={`badge ${st.status === 'EM CARGA' ? 'ok' : st.status === 'PARTINDO' ? 'warn' : st.status === 'FALHA' ? 'alarm' : 'off'}`}>{st.status}</span>{' '}
                  <span className="mono subtle">{fmt(st.power / 1000, 0)} kW</span>
                </td>
                <td>
                  <button className={`btn sm ${st.cmd ? 'on' : ''}`} onClick={() => cmd({ type: 'generator', id: g.id, run: !st.cmd })}>
                    {st.cmd ? 'Parar' : 'Partir'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={`row ${f?.kind === 'mast' ? 'focus' : ''}`}>
        <b>Snorkel</b>
        <span className="mono">{fmt(sn.pos * 100, 0)} % içado</span>
        <span className={`badge ${sn.headValveOpen ? 'ok' : 'off'}`}>válvula de cabeça {sn.headValveOpen ? 'aberta' : 'fechada'}</span>
        <button className={`btn sm ${sn.cmd ? 'on' : ''}`} onClick={() => cmd({ type: 'snorkel', raise: !sn.cmd })}>
          {sn.cmd ? 'Arriar' : 'Içar'}
        </button>
      </div>
      <div className="subtle">Combustível {fmt(el.fuel, 1)} m³ · os geradores só partem com ar (snorkel/superfície).</div>
    </div>
  );
}

// ------------------------------------------------------------ falhas
function FalhasBody({ e }: { e: SimulationEngine }) {
  const s = e.state;
  const cat = useMemo(() => failureCatalog(e), [e]);
  const [sel, setSel] = useState(cat[0]?.target ?? '');
  const [param, setParam] = useState('');
  const vis = visibleAlarms(s);
  const def = cat.find((c) => c.target === sel);
  const active = cat.filter((c) => isFailureActive(e, c.target));
  return (
    <div className="col">
      {vis.length === 0 ? (
        <span className="badge ok">SEM ALARMES</span>
      ) : (
        <table className="t ops-t">
          <tbody>
            {vis.map((a) => (
              <tr key={a.def.id}>
                <td>
                  <span className={`badge ${a.def.priority <= 2 ? 'alarm' : 'warn'} ${a.active && !a.acked ? 'blink' : ''}`}>{PRIORITY_LABEL[a.def.priority]}</span>
                </td>
                <td>
                  {a.def.text}
                  <div className="subtle">
                    {a.def.system} · {a.active ? 'ativo' : 'normalizado'}
                    {a.acked ? ' · reconhecido' : ''}
                  </div>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={() => opsBus.focus(ALARM_GROUP[a.def.system] ?? 'falhas')} title="Abrir o sistema afetado">
                    Sistema →
                  </button>
                  {!a.acked && (
                    <button className="btn sm" onClick={() => cmd({ type: 'ack', id: a.def.id })}>
                      Reconhecer
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        <select value={sel} onChange={(ev) => setSel(ev.target.value)} style={{ flex: 1, minWidth: 0 }} aria-label="Falha a injetar">
          {[...new Set(cat.map((c) => c.group))].map((g) => (
            <optgroup key={g} label={g}>
              {cat
                .filter((c) => c.group === g)
                .map((c) => (
                  <option key={c.target} value={c.target}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        {def?.param && <input type="number" style={{ width: 60 }} placeholder={String(def.param.default)} value={param} onChange={(ev) => setParam(ev.target.value)} title={`${def.param.label} (${def.param.unit})`} />}
        <button
          className="btn sm danger"
          onClick={() => def && cmd({ type: 'failure', target: def.target, active: true, param: def.modes ? (def.modes[0] as SensorFailMode) : def.param ? Number(param || def.param.default) : undefined })}
        >
          Injetar
        </button>
      </div>
      {def && <div className="subtle">{def.effect}</div>}
      {active.length > 0 && (
        <div className="col">
          <b className="subtle">Falhas ativas</b>
          {active.map((c) => (
            <div key={c.target} className="row">
              <span className="badge alarm">FALHA</span> {c.name}
              <button className="btn sm" onClick={() => cmd({ type: 'failure', target: c.target, active: false })}>
                Remover
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ ambiente
function AmbienteBody({ e }: { e: SimulationEngine }) {
  const ui = useUi();
  const o = e.outputs;
  const ss = Math.round(e.env.cfg.waves?.seaState ?? 0);
  const [sc, setSc] = useState(e.state.scenarioId);
  return (
    <div className="col">
      <div className="row">
        <span>Estado do mar</span>
        <select value={ss} onChange={(ev) => cmd({ type: 'seaState', value: Number(ev.target.value) })} aria-label="Estado do mar">
          {SEA_STATES.map((s, i) => (
            <option key={i} value={i}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="subtle">Hs {fmt(e.env.waves.hs, 1)} m</span>
      </div>
      <table className="t ops-t">
        <tbody>
          <tr>
            <td>Água no nível do eixo</td>
            <td className="mono">
              {fmt(o.seaTemp, 1)} °C · S {fmt(o.salinity, 1)} · ρ {fmt(o.rhoLocal, 2)} kg/m³
            </td>
          </tr>
          <tr>
            <td>Fundo / altitude</td>
            <td className="mono">
              {fmt(o.bottomDepth, 0)} m / {fmt(o.altitude, 0)} m
            </td>
          </tr>
        </tbody>
      </table>
      <div className="row">
        <span>Cenário</span>
        <select value={sc} onChange={(ev) => setSc(ev.target.value)} style={{ flex: 1, minWidth: 0 }} aria-label="Cenário">
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="btn sm ok" onClick={() => loadScenario(sc)}>
          Carregar
        </button>
      </div>
      <button className="btn sm" onClick={() => ui.setScreen('config')}>
        Configurações, sessões e gravações →
      </button>
    </div>
  );
}

export function loadScenario(id: string): void {
  demo.stop(runner);
  maneuver.cancel(runner);
  if (tours.active) tours.stop(runner);
  runner.running = false;
  runner.replaceEngine(buildScenario(id, baseConfig()));
}

// ------------------------------------------------------------ catálogo
export interface GroupDef {
  summary: (e: SimulationEngine) => string;
  warn?: (e: SimulationEngine) => boolean;
  Body: (p: { e: SimulationEngine }) => ReactNode;
}

export const GROUPS: Record<GroupId, GroupDef> = {
  nav: {
    summary: (e) => {
      const ap = e.state.autopilot;
      return `${fmtSpeed(e.state.body.vel.x, 1)} · ${fmt(e.outputs.rpm, 0)} rpm · prof. ${ap.depthMode === 'AUTO' ? `AUTO ${fmt(ap.depthSet, 0)} m` : 'MAN'} · rumo ${ap.headingMode === 'AUTO' ? `AUTO ${fmt(ap.headingSet, 0)}°` : 'MAN'}`;
    },
    Body: NavBody,
  },
  lastro: {
    summary: (e) => {
      const t = e.vessel.ballast.tanks;
      const vent = t.some((x) => e.state.ballast[x.id].vent.cmd > 0.5);
      const blow = t.some((x) => e.state.ballast[x.id].blow.cmd > 0.5);
      const emergency = t.some((x) => e.state.ballast[x.id].emergencyBlow.cmd > 0.5);
      return `${fmt(fill(e) * 100, 0)} % cheio · suspiros ${vent ? 'ABERTOS' : 'fechados'}${emergency ? ' · EMERGÊNCIA' : blow ? ' · SOPRANDO' : ''}`;
    },
    Body: LastroBody,
  },
  comp: {
    summary: (e) => {
      const c = e.state.compensation;
      const vol = compensationWater(e.vessel.compensation, c, e.vessel.heel, e.state.heel) / RHO_NOMINAL;
      return `${fmt(vol, 2)} m³ · ${e.outputs.surfaced ? 'superfície' : `flutuab. ${fmt(e.outputs.netBuoyancyKg / 1000, 2)} t`} · bomba ${c.pump.speed > 0.05 ? 'ligada' : 'parada'}${c.dosing?.active ? ' · DOSANDO' : ''}`;
    },
    Body: CompBody,
  },
  trim: {
    summary: (e) => `θ ${fmt(e.outputs.euler.pitch, 1)}° (eq. ${fmt(e.outputs.staticPitchEq, 1)}°) · φ ${fmt(e.outputs.euler.roll, 1)}°${e.state.demoWeight ? ` · peso em ${fmt(e.state.demoWeight.x, 0)} m` : ''}`,
    Body: TrimBody,
  },
  ar: {
    summary: (e) => {
      const v = e.vessel.hpAir;
      const pmin = Math.min(...v.banks.map((b) => bankPressure(v, b.id, e.state.hpAir.banks[b.id].mass) / 1e5));
      return `AP ${fmt(pmin, 0)} bar · compressor ${e.state.hpAir.compressorRunning ? 'em carga' : 'parado'}`;
    },
    warn: (e) => e.outputs.hpManifoldBar < 60,
    Body: ArBody,
  },
  energia: {
    summary: (e) => {
      const el = e.state.electrical;
      const run = e.vessel.electrical.generators.filter((g) => el.generators[g.id].status === 'EM CARGA').length;
      const sn = e.state.snorkel.pos;
      return `bateria ${fmt(el.soc * 100, 0)} % · geradores ${run ? `${run} em carga` : 'parados'} · snorkel ${sn > 0.95 ? 'içado' : sn < 0.05 ? 'arriado' : 'em curso'}`;
    },
    warn: (e) => e.state.electrical.soc < 0.25 || !e.state.electrical.energized,
    Body: EnergiaBody,
  },
  falhas: {
    summary: (e) => {
      const vis = visibleAlarms(e.state);
      const act = vis.filter((a) => a.active).length;
      const un = vis.filter((a) => !a.acked).length;
      return vis.length ? `${act} alarme(s) ativo(s)${un ? ` · ${un} sem reconhecer` : ''}` : 'sem alarmes';
    },
    warn: (e) => visibleAlarms(e.state).some((a) => a.active && a.def.priority <= 2),
    Body: FalhasBody,
  },
  ambiente: {
    summary: (e) => `mar ${Math.round(e.env.cfg.waves?.seaState ?? 0)} · ${fmt(e.outputs.seaTemp, 1)} °C · ρ ${fmt(e.outputs.rhoLocal, 1)} · fundo ${fmt(e.outputs.bottomDepth, 0)} m`,
    Body: AmbienteBody,
  },
  guiados: {
    summary: () => (tours.active && tours.tour ? `em andamento: ${tours.tour.name} (${tours.k + 1}/${tours.tour.steps.length})` : 'roteiros automáticos narrados'),
    Body: () => <TourList goTo />,
  },
};
