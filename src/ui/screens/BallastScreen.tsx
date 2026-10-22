/** Tela 2 — Lastro principal, ar AP e compensação de peso. */
import { useMemo, useState } from 'react';
import { cmd, useSim } from '../store';
import { Panel } from '../components/Panel';
import { Readout, KindTag } from '../components/Readout';
import { AirBottleGlyph, Pipe, PumpGlyph, TankGlyph, ValveGlyph } from '../components/Schematic';
import { valveStatus, pumpStatus } from '../../sim/systems/components';
import { ballastFillStatus } from '../../sim/systems/ballast';
import { bankPressure, emergencyBlowActive } from '../../sim/systems/hpAir';
import { compensationBranches, compensationWater, tankVolume } from '../../sim/systems/internalTanks';
import { clean, compensationFlows, compensationNodes, manifoldSegments } from '../../sim/systems/compensationNetwork';
import { solveNeutralCompensation } from '../../sim/equilibrium';
import { R_AIR } from '../../sim/core/context';
import type { SimulationEngine } from '../../sim/core/engine';
import { fmt, fmtMass } from '../format';
import { QuickBallast } from '../components/Controls';
import { WideDiagram } from '../components/WideDiagram';

const VS = (st: { cmd: number; pos: number; stuck: boolean }) => {
  const s = valveStatus(st);
  const cls = s === 'ABERTA' ? 'ok' : s === 'FECHADA' ? 'off' : s === 'TRAVADA' ? 'alarm' : 'warn';
  return <span className={`badge ${cls}`}>{s}</span>;
};

export function Diagram({ e }: { e: SimulationEngine }) {
  const v = e.vessel;
  const s = e.state;
  const X = (x: number) => 24 + (x + 35) * 15.3;
  const Y = (z: number) => 270 + z * 24;
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
  const hpY = 112;
  const emY = 54;
  const normalFlow = v.ballast.tanks.reduce((sum, t) => sum + s.ballast[t.id].mdotBlow, 0);
  const emergencyFlow = v.ballast.tanks.reduce((sum, t) => sum + s.ballast[t.id].mdotEmergencyBlow, 0);
  const comp = v.compensation;
  const wl = Y(-s.body.pos.z);
  const manY = 476;
  const seaY = 590;
  // Distâncias esquemáticas: espaço para válvulas, rótulos e áreas de clique.
  // Ordem no coletor: TB-BB, tanque(s) central(is), TB-BE (os de banda também são compensação).
  const branches = compensationBranches(comp, s.compensation, v.heel, s.heel).sort((a, b) => (a.heel === 'A' ? -1 : a.heel === 'B' ? 1 : 0) - (b.heel === 'A' ? -1 : b.heel === 'B' ? 1 : 0));
  const tcPos = branches.map((_, i) => 590 - ((branches.length - 1) * 140) / 2 + i * 140);
  const xPump = Math.min(...tcPos) - 110;
  const xInlet = Math.max(...tcPos) + 110;
  const cf = compensationFlows(comp, s.compensation, v.heel, s.heel);
  const segs = manifoldSegments(compensationNodes(cf, xInlet, xPump, Object.fromEntries(branches.map((b, i) => [b.id, tcPos[i]]))), cf.tol);
  const qIn = clean(cf.qIn, cf.tol);
  const qOut = clean(cf.qOut, cf.tol);
  const pumpSt = s.compensation.pump;
  const pumpNote = pumpSt.deadhead ? 'descarga fechada' : pumpSt.noSuction ? 'sem sucção' : '';
  const bankX = (i: number) => 420 + i * 90;
  return (
    <WideDiagram minWidth={900}>
      <svg viewBox="0 0 1120 640" className="svgbox" aria-label="Circuitos independentes de sopro normal, emergência e compensação">
        <rect width="1120" height="640" fill="#08192a" />
        {wl > 0 ? (
          <>
            <rect width="1120" height={Math.min(wl, 640)} fill="#0e1a26" />
            <line x1="0" x2="1120" y1={wl} y2={wl} stroke="#57a8ff" strokeWidth="1.2" />
            <text x="12" y={wl - 6} fontSize="10" fill="#57a8ff">
              superfície do mar
            </text>
          </>
        ) : (
          <text x="12" y="18" fontSize="10" fill="#57a8ff">
            ▲ superfície {fmt(s.body.pos.z, 0)} m acima do eixo
          </text>
        )}
        <path d={hull} fill="#1a2838" stroke="#9fb7cf" strokeWidth="1.4" />
        <rect x={X(sail.xAft)} y={Y(-R - sail.height)} width={X(sail.xFwd) - X(sail.xAft)} height={sail.height * 24} rx="6" fill="#1a2838" stroke="#9fb7cf" />
        <rect x={X(-15)} y={Y(-R + 0.25)} width={X(24) - X(-15)} height={(2 * R - 0.5) * 24} fill="none" stroke="#3d5d80" strokeDasharray="5 4" />
        <Pipe d="M100,112 H1080" flow={normalFlow} color="#c9d6e3" width={2.5} />
        <text x="350" y={hpY - 10} fontSize="11" fill="#c9d6e3">
          SOPRO NORMAL · {fmt(e.outputs.hpManifoldBar, 0)} bar
        </text>
        <Pipe d="M100,54 H1080" flow={emergencyFlow} color="#ffb080" idleColor="#795645" width={2.5} />
        <text x="350" y={emY - 10} fontSize="11" fill="#ffb080">
          SOPRO DE EMERGÊNCIA · {fmt(s.hpAir.emergencyManifoldPressure / 1e5, 0)} bar
        </text>
        {v.hpAir.banks.map((b, i) => {
          const st = s.hpAir.banks[b.id];
          const p = bankPressure(v.hpAir, b.id, st.mass);
          const emergency = b.purpose === 'emergency';
          const bx = bankX(i);
          const my = emergency ? emY : hpY;
          const color = emergency ? '#ffb080' : '#c9d6e3';
          const w = emergency ? 36 : 44;
          const h = emergency ? 64 : 80;
          const by = 314 - h;
          return (
            <g key={b.id}>
              <Pipe
                d={emergency ? `M${bx},${by} V${hpY + 5} M${bx},${hpY - 5} V${my}` : `M${bx},${by} V${my}`}
                flow={st.valve.pos > 0.05 ? -(emergency ? emergencyFlow : normalFlow) : 0}
                color={color}
                idleColor={emergency ? '#795645' : undefined}
                width={2}
              />
              <ValveGlyph x={bx} y={216} st={st.valve} vertical size={8} label={b.valve.id} onToggle={() => cmd({ type: 'hpBankValve', bank: b.id, open: st.valve.cmd < 0.5 })} inspect={'hp:' + b.id} />
              <AirBottleGlyph x={bx - w / 2} y={by} w={w} h={h} fill={p / b.maxPressure} color={emergency ? '#c47f53' : '#6e94b6'} label={b.id} sub={`${fmt(p / 1e5, 0)} bar`} inspect={'hp:' + b.id} />
              <text x={bx} y="326" textAnchor="middle" fontSize="10" fill={color}>
                {b.volume} m³
              </text>
              <Pipe d={`M${bx - w / 2 + 4},${314 - h * 0.12} V332`} flow={s.hpAir.compressorRunning && p < b.maxPressure ? -1 : 0} color="#d9cf8f" width={1.5} />
            </g>
          );
        })}
        <Pipe d={`M${bankX(0) - 22},332 H${bankX(v.hpAir.banks.length - 1)} M560,350 V332`} flow={s.hpAir.compressorRunning ? 1 : 0} color="#d9cf8f" width={2} />
        <g onClick={() => cmd({ type: 'compressor', run: !s.hpAir.compressorCmd })} style={{ cursor: 'pointer' }}>
          <title>Compressor: recarga dos dois circuitos por retenções, sem equalização entre reservas</title>
          <rect x="480" y="350" width="160" height="30" rx="4" fill="#0a121b" stroke={s.hpAir.compressorRunning ? '#3ddc84' : '#8399b1'} />
          <text x="560" y="369" textAnchor="middle" fontSize="11" fill="#d9cf8f">
            Compressor · {s.hpAir.compressorRunning ? 'EM CARGA' : 'PARADO'}
          </text>
        </g>
        {v.ballast.tanks.map((t) => {
          const st = s.ballast[t.id];
          const vx = X(t.center.x) + (t.id.endsWith('BB') ? -46 : 46);
          const y0 = 234;
          const h = 98;
          const normalX = vx - 20;
          const emergencyX = vx + 20;
          return (
            <g key={t.id}>
              <Pipe d={`M${normalX},${hpY} V${y0}`} flow={st.mdotBlow} color="#c9d6e3" width={2} />
              <ValveGlyph x={normalX} y={hpY + 25} st={st.blow} vertical size={7} onToggle={() => cmd({ type: 'mbtBlow', tank: t.id, open: st.blow.cmd < 0.5 })} inspect={'mbt:' + t.id} />
              <Pipe d={`M${emergencyX},${emY} V${hpY - 5} M${emergencyX},${hpY + 5} V${y0}`} flow={st.mdotEmergencyBlow} color="#ffb080" idleColor="#795645" width={2} />
              <ValveGlyph x={emergencyX} y={emY + 25} st={st.emergencyBlow} vertical size={7} onToggle={() => cmd({ type: 'emergencyBlow', tank: t.id, open: st.emergencyBlow.cmd < 0.5 })} inspect={'mbt:' + t.id} />
              <Pipe d={`M${vx},${y0} V180`} flow={-st.mdotVent} color="#e9f2fb" width={2} />
              <ValveGlyph x={vx} y={200} st={st.vent} vertical size={7} onToggle={() => cmd({ type: 'mbtVent', tank: t.id, open: st.vent.cmd < 0.5 })} inspect={'mbt:' + t.id} />
              <text x={vx} y="172" textAnchor="middle" fontSize="10" fill="#cfe7ff">
                suspiro
              </text>
              <TankGlyph
                x={vx - 30}
                y={y0}
                w={60}
                h={h}
                fill={st.water / t.volume}
                label={t.id.replace('TLP', 'TLP-')}
                sub={`${fmt((st.water / t.volume) * 100, 0)} %`}
                air
                inspect={'mbt:' + t.id}
                alarm={st.vent.stuck || st.blow.stuck || st.emergencyBlow.stuck || st.ventLeak > 0}
              />
              <line x1={vx - 26} x2={vx + 26} y1={y0 + h + 3} y2={y0 + h + 3} stroke="#57a8ff" strokeDasharray="3 3" strokeWidth="2" />
              {Math.abs(st.qWater) > 0.01 && (
                <text x={vx} y={y0 + h + 19} fontSize="10" textAnchor="middle" fill="#57a8ff">
                  {st.qWater > 0 ? '▲' : '▼'} {fmt(Math.abs(st.qWater) * 1000, 0)} L/s
                </text>
              )}
              {st.mdotSpill > 0.01 && (
                <text x={vx} y={y0 + h + 33} fontSize="9" textAnchor="middle" fill="#cfe7ff">
                  ar escapando
                </text>
              )}
            </g>
          );
        })}
        <text x="24" y="415" fontSize="11" fill="#9fb7cf">
          COMPENSAÇÃO DE PESO
        </text>
        {segs.map((g) => (
          <Pipe key={g.from.id + g.to.id} d={`M${g.from.x},${manY} L${g.to.x},${manY}`} flow={g.q} width={3} />
        ))}
        {branches.map((b, i) => {
          const st = b.st;
          const vid = b.valveId;
          const w = b.heel ? 64 : 92;
          const insp = b.heel ? 'heel' : 'comp:' + b.id;
          return (
            <g key={b.id}>
              <TankGlyph
                x={tcPos[i] - w / 2}
                y={400}
                w={w}
                h={38}
                fill={tankVolume(st) / b.cfg.capacity}
                label={b.heel ? (b.heel === 'A' ? 'TB-BB' : 'TB-BE') : b.id}
                sub={`${tankVolume(st).toFixed(2)} m³`}
                color={b.heel ? '#8a5cd6' : '#2a7fd4'}
                inspect={insp}
              />
              <Pipe d={`M${tcPos[i]},${manY} V438`} flow={clean(cf.tanks[b.id], cf.tol)} width={2.5} />
              <ValveGlyph
                x={tcPos[i]}
                y={457}
                st={s.compensation.tankValves[vid]}
                vertical
                size={7}
                label={vid}
                onToggle={() => cmd({ type: 'valve', system: 'compensation', valve: vid, open: s.compensation.tankValves[vid].cmd < 0.5 })}
                inspect={insp}
              />
            </g>
          );
        })}
        <Pipe d={`M${xInlet},${seaY} V${manY}`} flow={qIn} width={3} />
        <ValveGlyph
          x={xInlet}
          y={manY + 55}
          st={s.compensation.inlet}
          vertical
          label="V-AM"
          onToggle={() => cmd({ type: 'valve', system: 'compensation', valve: 'inlet', open: s.compensation.inlet.cmd < 0.5 })}
          inspect="comp:inlet"
        />
        <Pipe d={`M${xPump},${manY} V${seaY}`} flow={qOut} width={3} />
        <PumpGlyph x={xPump} y={manY + 30} st={pumpSt} label="BC" labelAt={[-24, 4]} angle={90} onToggle={() => cmd({ type: 'pump', system: 'compensation', run: !pumpSt.cmd })} inspect="comp:pump" />
        <ValveGlyph
          x={xPump}
          y={manY + 79}
          st={s.compensation.discharge}
          vertical
          label="V-DM"
          onToggle={() => cmd({ type: 'valve', system: 'compensation', valve: 'discharge', open: s.compensation.discharge.cmd < 0.5 })}
          inspect="comp:discharge"
        />
        {qIn > 0 && (
          <text x={xInlet + 16} y={seaY - 8} fontSize="10" fill="#57a8ff">
            ▲ {fmt(qIn * 1000, 1)} L/s
          </text>
        )}
        {qOut > 0 && (
          <text x={xPump - 16} y={seaY - 8} fontSize="10" textAnchor="end" fill="#57a8ff">
            ▼ {fmt(qOut * 1000, 1)} L/s
          </text>
        )}
        {pumpNote && (
          <text x={xPump - 24} y={manY + 50} fontSize="10" textAnchor="end" fill="#f5b041">
            {pumpNote}
          </text>
        )}
        <line x1="0" x2="1120" y1={seaY} y2={seaY} stroke="#2a7fd4" strokeWidth="2" opacity="0.6" />
        <text x="12" y={seaY + 20} fontSize="10" fill="#57a8ff">
          MAR · pressão na tomada {fmt(e.env.pressureAt(e.outputs.depthKeel) / 1e5, 2)} bar
        </text>
        <text x="1108" y={seaY + 34} fontSize="10" textAnchor="end" fill="#7f93a8">
          Esquemático fictício · clique nas válvulas e no compressor para operar
        </text>
      </svg>
    </WideDiagram>
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
  // água de compensação = tanque central + tanques de banda (todos no mesmo coletor)
  const curComp = compensationWater(v.compensation, s.compensation, v.heel, s.heel);
  const needComp = Object.values(need.compensation).reduce((a, x) => a + x, 0) + (v.compensation.heelBranches?.length ? need.heelA + need.heelB : 0);
  const d = s.compensation.dosing;
  const totalMbt = v.ballast.tanks.reduce((a, t) => a + t.volume, 0);
  const waterMbt = v.ballast.tanks.reduce((a, t) => a + s.ballast[t.id].water, 0);
  return (
    <div className="grid">
      <Panel title="Diagrama — lastro principal, ar AP e compensação" className="span-all">
        <Diagram e={e} />
        <QuickBallast e={e} />
      </Panel>
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
                <th>Emergência</th>
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
                    <td>
                      {VS(st.emergencyBlow)}{' '}
                      <button className="btn sm" onClick={() => cmd({ type: 'emergencyBlow', tank: t.id, open: st.emergencyBlow.cmd < 0.5 })}>
                        {st.emergencyBlow.cmd > 0.5 ? 'Fechar' : 'Soprar'}
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
          <Readout label="Vazão de sopro de emergência" value={v.ballast.tanks.reduce((a, t) => a + s.ballast[t.id].mdotEmergencyBlow, 0)} unit="kg/s" digits={2} kind="CALC" />
        </div>
        <div className="note">
          O lastro principal faz a <b>transição superfície ↔ imersão</b> (grandes volumes, ~{totalMbt.toFixed(0)} m³). Submerso, os TLP ficam cheios; o equilíbrio fino é feito pela <b>compensação</b>. Ar comprimido em um
          TLP parcialmente soprado se comprime ao descer (perde empuxo) e se expande ao subir (Boyle, isotérmico a {fmt(T - 273.15, 1)} °C).
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
                  <td>
                    {b.name}
                    <div className="subtle">
                      {b.volume} m³ · {b.purpose === 'emergency' ? 'reserva exclusiva de emergência' : 'sopro normal'}
                    </div>
                  </td>
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
        <div className="readouts mt8">
          <Readout label="Coletor normal" value={s.hpAir.manifoldPressure / 1e5} unit="bar" kind="MED" />
          <Readout label="Coletor de emergência" value={s.hpAir.emergencyManifoldPressure / 1e5} unit="bar" kind="MED" />
        </div>
        <div className="row mt8">
          <button className={`btn ${s.hpAir.compressorCmd ? 'on' : ''}`} onClick={() => cmd({ type: 'compressor', run: !s.hpAir.compressorCmd })}>
            Compressor manual: {s.hpAir.compressorCmd ? 'LIGADO' : 'DESLIGADO'}
          </button>
          <span className={`badge ${s.hpAir.compressorRunning ? 'ok' : 'off'}`}>
            {s.hpAir.compressorRunning ? 'COMPRIMINDO' : s.hpAir.compressorCmd || emergencyBlowActive(s) ? (o.airIntake && s.electrical.energized ? 'PRESSÃO MÁXIMA' : 'SEM TOMADA DE AR / ENERGIA') : 'PARADO'}
          </span>
          {emergencyBlowActive(s) && <span className="badge warn">AUTOMÁTICO · EMERGÊNCIA</span>}
        </div>
        <div className="note">
          As ampolas de emergência têm a mesma pressão e menor volume que os bancos normais, em circuito separado. O compressor recarrega ambos e é solicitado automaticamente durante o sopro de emergência, com prioridade
          às ampolas dedicadas. Exige tomada de ar (superfície ou snorkel) e barramento energizado. Ar a {v.hpAir.temperature} °C. Massa de ar a 1 atm para encher todos os TLP:{' '}
          {((101325 * totalMbt) / (R_AIR * T)).toFixed(0)} kg; na profundidade atual: {((e.env.pressureAt(o.depthKeel) * totalMbt) / (R_AIR * T)).toFixed(0)} kg.
        </div>
      </Panel>
      <Panel title="Compensação de peso" inspect="comp" className="span2">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 300px' }}>
            <table className="t">
              <tbody>
                {compensationBranches(v.compensation, s.compensation, v.heel, s.heel).map((b) => {
                  const vv = b.valve;
                  return (
                    <tr key={b.id}>
                      <td>{b.cfg.name}</td>
                      <td className="num">
                        {tankVolume(b.st).toFixed(2)} / {b.cfg.capacity} m³
                      </td>
                      <td>
                        {VS(vv)}{' '}
                        <button className="btn sm" onClick={() => cmd({ type: 'valve', system: 'compensation', valve: b.valveId, open: vv.cmd < 0.5 })}>
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
              <Readout
                label={`Compensação p/ neutralidade a ${fmt(calcDepth + v.hull.diameter / 2, 0)} m`}
                value={needComp / 1000}
                unit="t"
                digits={2}
                kind="CALC"
                title="Cálculo de compensação: TLP cheios, casco totalmente submerso"
              />
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
          Compensação altera a <b>massa</b> do submarino: admitir água ⇒ mais pesado (tende a descer); esgotar ⇒ mais leve. A admissão é impulsionada pela pressão do mar (limitada a{' '}
          {(v.compensation.inletRegulatorFlow * 1000).toFixed(0)} L/s); a descarga exige a bomba vencer a pressão externa — o consumo elétrico cresce com a profundidade (P = Q·Δp/η).
        </div>
      </Panel>
    </div>
  );
}
