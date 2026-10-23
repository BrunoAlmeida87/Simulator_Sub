/** Tela 2 — Lastro principal, ar AP e compensação de peso. */
import { useMemo, useState } from 'react';
import { cmd, useSim } from '../store';
import { Panel } from '../components/Panel';
import { Readout, KindTag } from '../components/Readout';
import { Pipe, PumpGlyph, TankGlyph, ValveGlyph } from '../components/Schematic';
import { valveStatus, pumpStatus } from '../../sim/systems/components';
import { ballastFillStatus } from '../../sim/systems/ballast';
import { bankPressure } from '../../sim/systems/hpAir';
import { tankVolume } from '../../sim/systems/internalTanks';
import { solveNeutralCompensation } from '../../sim/equilibrium';
import { R_AIR } from '../../sim/core/context';
import type { SimulationEngine } from '../../sim/core/engine';
import { fmt, fmtMass } from '../format';
import { CompensationCircuitPanel } from '../components/CompensationCircuitPanel';
import { QuickBallast } from '../components/Controls';

const VS = (st: { cmd: number; pos: number; stuck: boolean }) => {
  const s = valveStatus(st);
  const cls = s === 'ABERTA' ? 'ok' : s === 'FECHADA' ? 'off' : s === 'TRAVADA' ? 'alarm' : 'warn';
  return <span className={`badge ${cls}`}>{s}</span>;
};

export function Diagram({ e }: { e: SimulationEngine }) {
  const v = e.vessel;
  const s = e.state;
  const X = (x: number) => 20 + (x + 35) * 11.7;
  const Y = (z: number) => 140 + z * 20;
  // contorno do casco
  const top: string[] = [];
  const bot: string[] = [];
  for (let i = 0; i <= 140; i++) {
    const x = -35 + (i / 140) * 70;
    const r = e.geom.radiusAt(x);
    top.push(`${X(x)},${Y(-r)}`);
    bot.unshift(`${X(x)},${Y(r)}`);
  }
  const hull = `M${top.join(' L')} L${bot.join(' L')} Z`;
  const sail = v.hull.sail;
  const R = v.hull.diameter / 2;
  const hpY = Y(-R) - 22;
  const anyBlow = v.ballast.tanks.some((t) => s.ballast[t.id].mdotBlow > 0);
  // TLP: pares BB/BE desenhados lado a lado (esquemático)
  const groups = [
    { ids: ['TLP1BB', 'TLP1BE'], xc: 28, w: 4.4 },
    { ids: ['TLP2BB', 'TLP2BE'], xc: -23.5, w: 4.0 },
  ];
  const comp = v.compensation;
  const seaY = 268;
  const wl = Y(-s.body.pos.z);
  const manY = Y(R) + 26;
  const tcPos = comp.tanks.map((t, i) => 410 + (t.id === 'TC1' ? 2 : t.id === 'TC0' ? 1 : i === 1 ? 0 : i) * 80);
  const conX = X(comp.seaConnection.x);
  return (
    <svg viewBox="0 -30 860 330" className="svgbox">
      {wl > -30 ? (
        <>
          <rect x="0" y="-30" width="860" height={wl + 30} fill="#0e1a26" />
          <rect x="0" y={wl} width="860" height={330} fill="#08192a" />
          <line x1="0" x2="860" y1={wl} y2={wl} stroke="#57a8ff" strokeWidth="1.2" />
          <text x="8" y={wl - 4} fontSize="10" fill="#57a8ff">
            superfície do mar (posição real, sem trim)
          </text>
        </>
      ) : (
        <>
          <rect x="0" y="-30" width="860" height={360} fill="#08192a" />
          <text x="8" y="-16" fontSize="10" fill="#57a8ff">
            ▲ superfície {fmt(s.body.pos.z, 0)} m acima do eixo
          </text>
        </>
      )}
      <path d={hull} fill="#1a2838" stroke="#9fb7cf" strokeWidth="1.4" />
      <rect x={X(sail.xAft)} y={Y(-R - sail.height)} width={X(sail.xFwd) - X(sail.xAft)} height={sail.height * 20} rx="6" fill="#1a2838" stroke="#9fb7cf" />
      {/* casco resistente */}
      <rect x={X(-15)} y={Y(-R + 0.25)} width={X(24) - X(-15)} height={(2 * R - 0.5) * 20} fill="none" stroke="#3d5d80" strokeDasharray="5 4" />
      <text x={X(4.5)} y={Y(-R + 0.25) + 12} fontSize="9" textAnchor="middle" fill="#5a7a9c">
        casco resistente (pressão interna 1 atm)
      </text>
      {/* coletor AP */}
      <Pipe d={`M${X(-27)},${hpY} L${X(31)},${hpY}`} flow={anyBlow ? 1 : 0} color="#c9d6e3" width={2.5} />
      <text x={X(-6)} y={hpY - 6} fontSize="9" textAnchor="middle" fill="#c9d6e3">
        coletor de ar AP — {fmt(e.outputs.hpManifoldBar, 0)} bar
      </text>
      {v.hpAir.banks.map((b, i) => {
        const p = bankPressure(v.hpAir, b.id, s.hpAir.banks[b.id].mass) / 1e5;
        const bx = X(-11 + i * 4.5);
        return (
          <g key={b.id}>
            <TankGlyph x={bx - 24} y={Y(-1.6)} w={48} h={34} fill={p / 250} color="#8ea7c0" label={b.id} sub={`${p.toFixed(0)} bar`} air inspect={'hp:' + b.id} />
            <Pipe d={`M${bx},${Y(-1.6)} L${bx},${hpY}`} flow={s.hpAir.banks[b.id].valve.pos > 0.05 && anyBlow ? 1 : 0} color="#c9d6e3" width={2} />
            <ValveGlyph x={bx} y={Y(-2.4)} st={s.hpAir.banks[b.id].valve} vertical size={6} onToggle={() => cmd({ type: 'hpBankValve', bank: b.id, open: s.hpAir.banks[b.id].valve.cmd < 0.5 })} inspect={'hp:' + b.id} />
          </g>
        );
      })}
      {groups.map((g) =>
        g.ids.map((id, k) => {
          const t = v.ballast.tanks.find((x) => x.id === id)!;
          const st = s.ballast[id];
          const x0 = X(g.xc - g.w / 2 + (k * g.w) / 2);
          const w = (g.w / 2) * 11.7 - 2;
          const y0 = Y(t.center.z - t.height / 2);
          const h = t.height * 20;
          const vx = x0 + w / 2;
          return (
            <g key={id}>
              <TankGlyph x={x0} y={y0} w={w} h={h} fill={st.water / t.volume} label={id.replace('TLP', '')} sub={`${((st.water / t.volume) * 100).toFixed(0)}%`} air inspect={'mbt:' + id} alarm={st.vent.stuck || st.blow.stuck || st.ventLeak > 0} />
              {/* suspiro */}
              <Pipe d={`M${vx},${y0} L${vx},${y0 - 12}`} flow={st.mdotVent > 0.01 ? 1 : 0} color="#e9f2fb" width={2} />
              <ValveGlyph x={vx} y={y0 - 16} st={st.vent} vertical size={5} onToggle={() => cmd({ type: 'mbtVent', tank: id, open: st.vent.cmd < 0.5 })} inspect={'mbt:' + id} />
              {st.mdotVent > 0.01 && (
                <g>
                  {[0, 1, 2].map((j) => (
                    <circle key={j} cx={vx + (j - 1) * 4} cy={y0 - 28 - j * 6} r={2 + j} fill="none" stroke="#cfe7ff" opacity={0.7 - j * 0.2} />
                  ))}
                </g>
              )}
              {/* sopro */}
              <Pipe d={`M${vx + w / 3},${y0} L${vx + w / 3},${hpY}`} flow={st.mdotBlow > 0 ? -1 : 0} color="#c9d6e3" width={1.6} />
              <ValveGlyph x={vx + w / 3} y={hpY + 12} st={st.blow} vertical size={4.5} onToggle={() => cmd({ type: 'mbtBlow', tank: id, open: st.blow.cmd < 0.5 })} inspect={'mbt:' + id} />
              {/* embornais */}
              <line x1={x0 + 2} x2={x0 + w - 2} y1={y0 + h + 2} y2={y0 + h + 2} stroke="#57a8ff" strokeDasharray="2 2" strokeWidth="2" />
              {Math.abs(st.qWater) > 0.01 && (
                <text x={vx} y={y0 + h + 13} fontSize="9" textAnchor="middle" fill="#57a8ff">
                  {st.qWater > 0 ? '▲' : '▼'} {(Math.abs(st.qWater) * 1000).toFixed(0)} L/s
                </text>
              )}
              {st.mdotSpill > 0.01 && (
                <text x={vx} y={y0 + h + 24} fontSize="9" textAnchor="middle" fill="#cfe7ff">
                  ar escapando
                </text>
              )}
            </g>
          );
        }),
      )}
      {/* compensação */}
      {comp.tanks.map((t, i) => {
        const st = s.compensation.tanks[t.id];
        const w = 60;
        const h = 30;
        const x0 = tcPos[i] - w / 2;
        const y0 = Y(R) - h - 10;
        return (
          <g key={t.id}>
            <TankGlyph x={x0} y={y0} w={w} h={h} fill={tankVolume(st) / t.capacity} label={t.id} sub={`${tankVolume(st).toFixed(2)} m³`} color="#2a7fd4" inspect={'comp:' + t.id} />
            <Pipe d={`M${tcPos[i]},${y0 + h} L${tcPos[i]},${manY}`} flow={(st.flow ?? 0) + (s.compensation.transfer ? (t.id === s.compensation.transfer.source ? s.compensation.transfer.flow : t.id === s.compensation.transfer.destination ? -s.compensation.transfer.flow : 0) : 0)} width={2.5} />
            <ValveGlyph x={tcPos[i]} y={y0 + h + 12} st={s.compensation.tankValves[comp.tankValves[i].id]} vertical size={5} label={comp.tankValves[i].id} onToggle={() => cmd({ type: 'valve', system: 'compensation', valve: comp.tankValves[i].id, open: s.compensation.tankValves[comp.tankValves[i].id].cmd < 0.5 })} inspect={'comp:' + t.id} />
          </g>
        );
      })}
      <Pipe d={`M${Math.min(...tcPos)},${manY} L${X(12)},${manY}`} flow={s.compensation.qIn - s.compensation.qOut} width={3} />
      {/* admissão */}
      <Pipe d={`M${X(12)},${manY} L${X(12)},${seaY}`} flow={-s.compensation.qIn} width={3} />
      <ValveGlyph x={X(12)} y={manY + 22} st={s.compensation.inlet} vertical label="V-AM" onToggle={() => cmd({ type: 'valve', system: 'compensation', valve: 'inlet', open: s.compensation.inlet.cmd < 0.5 })} inspect="comp:inlet" />
      {/* descarga por bomba */}
      <Pipe d={`M${conX - 70},${manY} L${conX - 70},${manY + 40} L${conX - 10},${manY + 40} L${conX - 10},${seaY}`} flow={s.compensation.qOut} width={3} />
      <PumpGlyph x={conX - 70} y={manY + 22} st={s.compensation.pump} label="BC" onToggle={() => cmd({ type: 'pump', system: 'compensation', run: !s.compensation.pump.cmd })} inspect="comp:pump" />
      <ValveGlyph x={conX - 10} y={manY + 55} st={s.compensation.discharge} vertical label="V-DM" onToggle={() => cmd({ type: 'valve', system: 'compensation', valve: 'discharge', open: s.compensation.discharge.cmd < 0.5 })} inspect="comp:discharge" />
      <line x1="0" x2="860" y1={seaY} y2={seaY} stroke="#2a7fd4" strokeWidth="2" opacity="0.6" />
      <text x="8" y={seaY + 14} fontSize="9.5" fill="#57a8ff">
        MAR — pressão na tomada {fmt(e.env.pressureAt(e.outputs.depthKeel) / 1e5, 2)} bar
      </text>
      <text x="852" y={seaY + 14} fontSize="9" textAnchor="end" fill="#7f93a8">
        esquemático fictício — clique nas válvulas/bomba para operar
      </text>
    </svg>
  );
}

export function BallastScreen() {
  const e = useSim(10);
  const s = e.state;
  const v = e.vessel;
  const o = e.outputs;
  const [kg, setKg] = useState(500);
  const T = e.env.temperatureAt(Math.max(0, s.body.pos.z)) + 273.15;
  // cálculo de compensação: casco totalmente submerso (na superfície, para a cota periscópica)
  const calcDepth = Math.max(s.body.pos.z, 12);
  const need = useMemo(() => solveNeutralCompensation(e, calcDepth, false), [e, Math.round(calcDepth), Math.round(s.t / 5)]);
  const curComp = Object.values(s.compensation.tanks).reduce((a, t) => a + t.mass, 0);
  const needComp = Object.values(need.compensation).reduce((a, x) => a + x, 0);
  const d = s.compensation.dosing;
  const totalMbt = v.ballast.tanks.reduce((a, t) => a + t.volume, 0);
  const waterMbt = v.ballast.tanks.reduce((a, t) => a + s.ballast[t.id].water, 0);
  return (
    <div className="grid">
      <Panel title="Diagrama — lastro principal, ar AP e compensação" className="span-all">
        <Diagram e={e} />
        <QuickBallast e={e} />
      </Panel>
      <CompensationCircuitPanel e={e} />
      <Panel title="Tanques de lastro principal (TLP)" className="span2" inspect="mbt">
        <div className="scroll">
          <table className="t">
            <thead>
              <tr>
                <th>Tanque</th>
                <th>Capac.</th>
                <th>Água</th>
                <th>Ar</th>
                <th>p ar</th>
                <th>Estado</th>
                <th>Suspiro</th>
                <th>Sopro</th>
              </tr>
            </thead>
            <tbody>
              {v.ballast.tanks.map((t) => {
                const st = s.ballast[t.id];
                const va = t.volume - st.water;
                const fs = ballastFillStatus(t, st);
                return (
                  <tr key={t.id}>
                    <td>
                      <b>{t.name}</b>
                      {st.ventLeak > 0 && <span className="badge alarm"> VAZAMENTO</span>}
                    </td>
                    <td className="num">{t.volume.toFixed(0)} m³</td>
                    <td className="num">
                      {st.water.toFixed(1)} m³ ({((st.water / t.volume) * 100).toFixed(0)}%)
                    </td>
                    <td className="num" title="massa de ar / volume do colchão">
                      {st.air.toFixed(0)} kg / {va.toFixed(1)} m³
                    </td>
                    <td className="num">{st.air > 0 ? (st.pAir / 1e5).toFixed(2) : (0).toFixed(2)} bar</td>
                    <td>
                      <span className={`badge ${fs === 'CHEIO' ? 'info' : fs === 'VAZIO' ? 'ok' : 'warn'}`}>{fs}</span>
                    </td>
                    <td>
                      {VS(st.vent)}{' '}
                      <button className="btn sm" onClick={() => cmd({ type: 'mbtVent', tank: t.id, open: st.vent.cmd < 0.5 })}>
                        {st.vent.cmd > 0.5 ? 'Fechar' : 'Abrir'}
                      </button>
                    </td>
                    <td>
                      {VS(st.blow)}{' '}
                      <button className="btn sm" onClick={() => cmd({ type: 'mbtBlow', tank: t.id, open: st.blow.cmd < 0.5 })}>
                        {st.blow.cmd > 0.5 ? 'Fechar' : 'Soprar'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="readouts mt8">
          <Readout label="Água total nos TLP" value={waterMbt} unit={`/ ${totalMbt.toFixed(0)} m³`} kind="MED" />
          <Readout label="Reserva de flutuabilidade restante" value={((totalMbt - waterMbt) * o.rhoLocal) / 1000} unit="t" kind="CALC" />
          <Readout label="Vazão de ar pelos suspiros" value={v.ballast.tanks.reduce((a, t) => a + s.ballast[t.id].mdotVent, 0)} unit="kg/s" digits={2} kind="CALC" />
          <Readout label="Vazão de sopro" value={v.ballast.tanks.reduce((a, t) => a + s.ballast[t.id].mdotBlow, 0)} unit="kg/s" digits={2} kind="CALC" />
        </div>
        <div className="note">
          O lastro principal faz a <b>transição superfície ↔ imersão</b> (grandes volumes, ~{totalMbt.toFixed(0)} m³). Submerso, os TLP ficam cheios; o equilíbrio fino é feito pela <b>compensação</b>. Ar comprimido em um TLP parcialmente soprado se comprime ao descer (perde empuxo) e se expande ao subir (Boyle, isotérmico a {fmt(T - 273.15, 1)} °C).
        </div>
      </Panel>
      <Panel title="Ar comprimido AP" inspect="hp">
        <table className="t">
          <tbody>
            {v.hpAir.banks.map((b) => {
              const st = s.hpAir.banks[b.id];
              const p = bankPressure(v.hpAir, b.id, st.mass) / 1e5;
              return (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td className="num">{p.toFixed(0)} bar</td>
                  <td className="num">{st.mass.toFixed(0)} kg</td>
                  <td>
                    {VS(st.valve)}{' '}
                    <button className="btn sm" onClick={() => cmd({ type: 'hpBankValve', bank: b.id, open: st.valve.cmd < 0.5 })}>
                      {st.valve.cmd > 0.5 ? 'Isolar' : 'Abrir'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row mt8">
          <button className={`btn ${s.hpAir.compressorCmd ? 'on' : ''}`} onClick={() => cmd({ type: 'compressor', run: !s.hpAir.compressorCmd })}>
            Compressor: {s.hpAir.compressorCmd ? 'LIGADO' : 'DESLIGADO'}
          </button>
          <span className={`badge ${s.hpAir.compressorRunning ? 'ok' : 'off'}`}>{s.hpAir.compressorRunning ? 'COMPRIMINDO' : s.hpAir.compressorCmd ? 'SEM TOMADA DE AR / ENERGIA' : 'PARADO'}</span>
        </div>
        <div className="note">Compressor exige tomada de ar (superfície ou snorkel) e barramento energizado. Ar à temperatura de {v.hpAir.temperature} °C. Massa de ar a 1 atm para encher todos os TLP: {((101325 * totalMbt) / (R_AIR * T)).toFixed(0)} kg; na profundidade atual: {((e.env.pressureAt(o.depthKeel) * totalMbt) / (R_AIR * T)).toFixed(0)} kg.</div>
      </Panel>
      <Panel title="Compensação de peso" inspect="comp" className="span2">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 300px' }}>
            <table className="t">
              <tbody>
                {v.compensation.tanks.map((t, i) => {
                  const st = s.compensation.tanks[t.id];
                  const vv = s.compensation.tankValves[v.compensation.tankValves[i].id];
                  return (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td className="num">
                        {tankVolume(st).toFixed(2)} / {t.capacity} m³
                      </td>
                      <td>
                        {VS(vv)}{' '}
                        <button className="btn sm" onClick={() => cmd({ type: 'valve', system: 'compensation', valve: v.compensation.tankValves[i].id, open: vv.cmd < 0.5 })}>
                          {vv.cmd > 0.5 ? 'Fechar' : 'Abrir'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td>{v.compensation.inletValve.name}</td>
                  <td className="num">{(s.compensation.qIn * 1000).toFixed(1)} L/s</td>
                  <td>
                    {VS(s.compensation.inlet)}{' '}
                    <button className="btn sm" onClick={() => cmd({ type: 'valve', system: 'compensation', valve: 'inlet', open: s.compensation.inlet.cmd < 0.5 })}>
                      {s.compensation.inlet.cmd > 0.5 ? 'Fechar' : 'Abrir'}
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>{v.compensation.dischargeValve.name}</td>
                  <td className="num">{(s.compensation.qOut * 1000).toFixed(1)} L/s</td>
                  <td>
                    {VS(s.compensation.discharge)}{' '}
                    <button className="btn sm" onClick={() => cmd({ type: 'valve', system: 'compensation', valve: 'discharge', open: s.compensation.discharge.cmd < 0.5 })}>
                      {s.compensation.discharge.cmd > 0.5 ? 'Fechar' : 'Abrir'}
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>{v.compensation.pump.name}</td>
                  <td className="num">
                    {(s.compensation.pump.speed * 100).toFixed(0)}% · {(s.compensation.pump.power / 1e3).toFixed(1)} kW · Δp {(s.compensation.pump.dp / 1e5).toFixed(1)} bar
                  </td>
                  <td>
                    <span className={`badge ${s.compensation.pump.failed ? 'alarm' : s.compensation.pump.speed > 0.01 ? 'ok' : 'off'}`}>{pumpStatus(s.compensation.pump, s.electrical.energized)}</span>{' '}
                    <button className="btn sm" onClick={() => cmd({ type: 'pump', system: 'compensation', run: !s.compensation.pump.cmd })}>
                      {s.compensation.pump.cmd ? 'Parar' : 'Partir'}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            {(s.compensation.pump.noSuction || s.compensation.pump.deadhead) && <div className="badge warn mt8">Bomba sem sucção ou com descarga fechada</div>}
          </div>
          <div style={{ flex: '1 1 260px' }} className="col">
            <b>Sequência automática de dosagem</b>
            <div className="row">
              <input type="number" value={kg} min={10} step={50} onChange={(ev) => setKg(Number(ev.target.value))} /> kg
              <button className="btn" onClick={() => cmd({ type: 'dosing', system: 'compensation', mode: 'admitir', kg })}>
                Admitir (mais pesado)
              </button>
              <button className="btn" onClick={() => cmd({ type: 'dosing', system: 'compensation', mode: 'esgotar', kg })}>
                Esgotar (mais leve)
              </button>
              <button className="btn warn" disabled={!d?.active} onClick={() => cmd({ type: 'dosingAbort', system: 'compensation' })}>
                Interromper
              </button>
            </div>
            {d && (
              <div className="subtle">
                {d.mode.toUpperCase()} {fmtMass(d.target)} — fase <b>{d.phase}</b>: {fmtMass(d.moved)} movimentados. {d.message}
              </div>
            )}
            <div className="readouts">
              <Readout label="Flutuabilidade líquida" value={fmtMass(o.netBuoyancyKg)} kind="CALC" status={Math.abs(o.netBuoyancyKg) > 2000 ? 'warn' : ''} />
              <Readout label="Água de compensação" value={curComp / 1000} unit="t" digits={2} kind="MED" />
              <Readout label={`Compensação p/ neutralidade a ${fmt(calcDepth + v.hull.diameter / 2, 0)} m`} value={needComp / 1000} unit="t" digits={2} kind="CALC" title="Cálculo de compensação: TLP cheios, casco totalmente submerso" />
              <Readout label="Ajuste necessário" value={fmtMass(needComp - curComp)} kind="CALC" />
            </div>
            <div className="row">
              <button
                className="btn"
                onClick={() => {
                  const dm = needComp - curComp;
                  if (Math.abs(dm) > 10) cmd({ type: 'dosing', system: 'compensation', mode: dm > 0 ? 'admitir' : 'esgotar', kg: Math.abs(dm) });
                }}
              >
                Executar ajuste calculado
              </button>
              <span className="subtle">
                <KindTag kind="CALC" /> {need.message}
              </span>
            </div>
          </div>
        </div>
        <div className="note">
          Compensação altera a <b>massa</b> do submarino: admitir água ⇒ mais pesado (tende a descer); esgotar ⇒ mais leve. A admissão é impulsionada pela pressão do mar (limitada a {(v.compensation.inletRegulatorFlow * 1000).toFixed(0)} L/s); a descarga exige a bomba vencer a pressão externa — o consumo elétrico cresce com a profundidade (P = Q·Δp/η).
        </div>
      </Panel>
    </div>
  );
}
