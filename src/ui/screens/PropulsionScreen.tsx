/** Tela 4 — Propulsão e energia. */
import { cmd, useSim } from '../store';
import { Panel } from '../components/Panel';
import { Readout } from '../components/Readout';
import { Dial, HBar } from '../components/gauges';
import { Telegraph } from '../components/Controls';
import { toKnots } from '../../sim/units';
import { fmt, fmtPower } from '../format';
import { snorkelHeadDepth } from '../../sim/systems/actuation';
import { makeDepthOf } from '../../sim/core/context';
import { qToMat3 } from '../../sim/core/math';

const LOAD_NAMES: Record<string, string> = {
  MEP: 'Motor elétrico principal',
  BTC: 'Bomba de transferência de compensação',
  BC: 'Bomba de compensação',
  BT: 'Bomba de trim',
  BB: 'Bomba de banda',
  HID: 'Planta hidráulica',
  COMP: 'Compressor de ar AP',
  HOTEL: 'Habitabilidade / ventilação',
  NAV: 'Navegação, sensores e controle',
};

export function PropulsionScreen() {
  const e = useSim(8);
  const s = e.state;
  const v = e.vessel;
  const p = s.propulsion;
  const el = s.electrical;
  const o = e.outputs;
  const m = v.propulsion.motor;
  const prop = v.propulsion.propeller;
  const kn = toKnots(s.body.vel.x);
  const n = p.omega / (2 * Math.PI);
  const eta0 = Math.abs(p.propTorque) > 1 && n > 0.05 ? (p.thrust / (1 - prop.thrustDeduction)) * s.body.vel.x * (1 - prop.wakeFraction) / (2 * Math.PI * n * p.propTorque) : NaN;
  const effPower = p.thrust * s.body.vel.x;
  const cap = v.electrical.battery.capacityAh;
  const ahLeft = el.soc * cap;
  const hoursLeft = el.current > 1 ? ahLeft / el.current : Infinity;
  const head = snorkelHeadDepth(v, s, { depthOf: makeDepthOf(s.body.pos, qToMat3(s.body.quat)) } as never);
  const loads = Object.entries(el.loads).sort((a, b) => b[1] - a[1]);
  const maxLoad = Math.max(1, ...loads.map(([, w]) => w));
  return (
    <div className="grid">
      <Panel title="Motor elétrico principal e eixo" inspect="propulsion">
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <Dial value={o.rpm} min={-m.ratedRpm} max={m.ratedRpm} label="Eixo" unit="rpm" cmd={p.rpmCmd} />
          <Dial value={p.shaftPower / 1e6} min={0} max={m.ratedPower / 1e6} label="Potência" unit="MW" digits={2} zones={[{ from: (m.ratedPower * 0.9) / 1e6, to: m.ratedPower / 1e6, color: '#f5b041' }]} />
        </div>
        <Telegraph e={e} />
        <div className="readouts mt8">
          <Readout label="Ordem (telégrafo)" value={p.rpmCmd} unit="rpm" digits={0} kind="CMD" />
          <Readout label="Referência em rampa" value={p.rpmRef} unit="rpm" digits={0} kind="CALC" title={`Rampa de ${m.rpmRampRate} rpm/s`} />
          <Readout label="RPM do eixo" value={o.rpm} unit="rpm" digits={1} kind="MED" />
          <Readout label="Torque do motor" value={p.motorTorque / 1e3} unit="kN·m" kind="MED" />
          <Readout label="Torque absorvido pelo hélice" value={p.propTorque / 1e3} unit="kN·m" kind="CALC" />
          <Readout label="Potência no eixo" value={fmtPower(p.shaftPower)} kind="MED" />
          <Readout label="Potência elétrica do MEP" value={fmtPower(p.elecPower)} kind="MED" />
          <Readout label="Estado" value={p.failed ? 'FALHA' : p.powerLimited ? 'LIMITE DE POTÊNCIA' : 'NORMAL'} kind="MED" status={p.failed ? 'alarm' : p.powerLimited ? 'warn' : ''} />
        </div>
      </Panel>
      <Panel title="Hélice e velocidade" inspect="propeller">
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <Dial value={kn} min={-8} max={20} label="Velocidade" unit="nós" digits={1} />
          <Dial value={p.thrust / 1e3} min={-150} max={250} label="Empuxo" unit="kN" />
        </div>
        <div className="readouts mt8">
          <Readout label="Velocidade (Doppler)" value={toKnots(s.sensors.DVLU.value)} unit="nós" kind="MED" truth={kn} />
          <Readout label="Empuxo efetivo T(1−t)" value={p.thrust / 1e3} unit="kN" kind="CALC" />
          <Readout label="Resistência ao avanço" value={-o.forces.resistance.F.x / 1e3} unit="kN" kind="CALC" />
          <Readout label="Coef. de avanço J" value={p.advance} digits={3} kind="CALC" />
          <Readout label="Rendimento em água livre η₀" value={eta0} digits={3} kind="CALC" />
          <Readout label="Potência efetiva T·u" value={fmtPower(effPower)} kind="CALC" />
          <Readout label="Aceleração longitudinal" value={(o.forces.total.F.x / (o.mp.mass + e.added.X)) * 100} unit="cm/s²" digits={2} kind="CALC" />
        </div>
        <div className="note">A inércia (massa + massa adicional ≈ {fmt((o.mp.mass + e.added.X) / 1e6, 2)} Mkg) faz a velocidade responder lentamente; ao parar o motor, o submarino desacelera apenas pela resistência hidrodinâmica.</div>
      </Panel>
      <Panel title="Bateria" inspect="battery">
        <div className="col">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>Estado de carga</b>
            <b className="mono">{fmt(el.soc * 100, 1)} %</b>
          </div>
          <HBar value={el.soc} max={1} color={el.soc < 0.2 ? '#ff5257' : el.soc < 0.4 ? '#f5b041' : '#3ddc84'} height={14} />
        </div>
        <div className="readouts mt8">
          <Readout label="Tensão em vazio V_oc" value={el.ocv} unit="V" digits={0} kind="CALC" />
          <Readout label="Tensão nos terminais" value={el.voltage} unit="V" digits={0} kind="MED" />
          <Readout label="Corrente" value={el.current} unit="A" digits={0} kind="MED" status={el.chargeLimited ? 'warn' : ''} />
          <Readout label="Potência da bateria" value={fmtPower(el.batteryPower)} kind="MED" />
          <Readout label="Carga restante" value={ahLeft} unit="Ah" digits={0} kind="CALC" />
          <Readout label="Autonomia no consumo atual" value={Number.isFinite(hoursLeft) ? fmt(hoursLeft, 1) : '∞'} unit="h" kind="CALC" />
        </div>
        <div className="row mt8">
          <button className={`btn ${el.breakerClosed ? 'on' : 'danger'}`} onClick={() => cmd({ type: 'breaker', closed: !el.breakerClosed })}>
            Disjuntor da bateria: {el.breakerClosed ? 'FECHADO' : 'ABERTO'}
          </button>
          <span className={`badge ${el.energized ? 'ok' : 'alarm'}`}>Barramento {el.energized ? 'ENERGIZADO' : 'DESENERGIZADO'}</span>
        </div>
      </Panel>
      <Panel title="Demanda elétrica por consumidor" inspect="electrical">
        <table className="t">
          <tbody>
            {loads.map(([k, w]) => (
              <tr key={k}>
                <td style={{ width: '45%' }}>{LOAD_NAMES[k] ?? k}</td>
                <td>
                  <HBar value={w} max={maxLoad} />
                </td>
                <td className="num">{fmtPower(w)}</td>
              </tr>
            ))}
            <tr>
              <td>
                <b>Total</b>
              </td>
              <td />
              <td className="num">
                <b>{fmtPower(el.totalLoad)}</b>
              </td>
            </tr>
            <tr>
              <td>Geração diesel</td>
              <td />
              <td className="num">{fmtPower(el.generation)}</td>
            </tr>
          </tbody>
        </table>
        <div className="note">As bombas consomem P = Q·Δp/η: esgotar compensação em grande profundidade custa mais energia. Limite de potência para a propulsão no próximo passo: {fmtPower(el.propulsionLimit)}.</div>
      </Panel>
      <Panel title="Diesel-geradores e snorkel" inspect="diesel">
        <div className="row">
          <button className={`btn ${s.snorkel.cmd ? 'on' : ''}`} onClick={() => cmd({ type: 'snorkel', raise: !s.snorkel.cmd })}>
            Mastro snorkel: {s.snorkel.cmd ? 'IÇADO' : 'ARRIADO'}
          </button>
          <span className="mono subtle">posição {(s.snorkel.pos * 100).toFixed(0)} %</span>
          <span className={`badge ${o.airIntake ? 'ok' : 'off'}`}>Válvula de cabeça {s.snorkel.headValveOpen ? 'ABERTA' : 'FECHADA'}</span>
        </div>
        <div className="subtle mt8">
          Cabeça do snorkel a <b className="mono">{fmt(-head, 1)} m</b> {head < 0 ? 'acima' : 'abaixo'} da superfície.
        </div>
        <table className="t mt8">
          <tbody>
            {v.electrical.generators.map((g) => {
              const st = el.generators[g.id];
              return (
                <tr key={g.id}>
                  <td>{g.name}</td>
                  <td>
                    <span className={`badge ${st.status === 'EM CARGA' ? 'ok' : st.status === 'PARTINDO' ? 'warn' : st.status === 'FALHA' || st.status === 'SEM AR' ? 'alarm' : 'off'}`}>{st.status}</span>
                  </td>
                  <td className="num">{fmtPower(st.power)}</td>
                  <td>
                    <button className="btn sm" onClick={() => cmd({ type: 'generator', id: g.id, run: !st.cmd })}>
                      {st.cmd ? 'Parar' : 'Partir'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="readouts mt8">
          <Readout label="Combustível" value={el.fuel} unit={`/ ${v.electrical.fuel.tankVolume} m³`} digits={2} kind="MED" />
          <Readout label="Combustível queimado" value={s.ledger.fuelBurned} unit="kg" digits={1} kind="CALC" />
          <Readout label="Ganho de peso (comb. compensado)" value={s.ledger.fuelSeawaterIn - s.ledger.fuelBurned} unit="kg" digits={1} kind="CALC" />
        </div>
        <div className="note">Diesel e compressor exigem tomada de ar: superfície ou snorkel içado com a cabeça fora d'água. O combustível consumido é substituído por água do mar (tanque compensado) — o submarino fica mais pesado.</div>
      </Panel>
    </div>
  );
}
