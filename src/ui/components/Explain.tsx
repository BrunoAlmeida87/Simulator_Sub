/**
 * "Por que o submarino está subindo/descendo/adernando/guinando?"
 * Decomposição das forças e momentos por origem, calculada do mesmo estado
 * usado na integração.
 */
import type { SimulationEngine } from '../../sim/core/engine';
import { qToMat3, vCross, type Vec3 } from '../../sim/core/math';
import { fmtForce, fmtMoment, fmt } from '../format';

interface Item {
  name: string;
  value: number;
}

function Bars({ items, unitFmt }: { items: Item[]; unitFmt: (x: number) => string }) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <div>
      {items.map((it) => {
        const f = Math.min(1, Math.abs(it.value) / max) * 50;
        const pos = it.value >= 0;
        return (
          <div className="forcebar" key={it.name}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
            <div className="bar">
              <i style={{ left: pos ? '50%' : `${50 - f}%`, width: `${f}%`, background: pos ? '#f5b041' : '#36c5f0' }} />
            </div>
            <span className="v">{unitFmt(it.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

const wz = (R: number[], F: Vec3) => R[6] * F.x + R[7] * F.y + R[8] * F.z;

export function verticalBreakdown(e: SimulationEngine): { items: Item[]; total: number } {
  const f = e.outputs.forces;
  const R = qToMat3(e.state.body.quat) as unknown as number[];
  const s = e.state;
  const m = e.outputs.mp.mass;
  const rigid = vCross(s.body.omega, s.body.vel);
  const added: Vec3 = { x: f.coriolis.F.x + m * rigid.x, y: f.coriolis.F.y + m * rigid.y, z: f.coriolis.F.z + m * rigid.z };
  const fins = f.fins;
  const other = Object.entries(fins)
    .filter(([k]) => k !== 'bow' && k !== 'stern')
    .reduce((a, [, v]) => a + wz(R, v.F), 0);
  const items: Item[] = [
    { name: 'Peso (m·g)', value: f.weightForce },
    { name: 'Empuxo (ρ·g·V)', value: -f.buoyancyForce },
    { name: 'Casco (sustentação/arrasto)', value: wz(R, f.crossflow.F) + wz(R, f.bodyLift.F) + wz(R, f.damping.F) + wz(R, f.resistance.F) },
    { name: 'Lemes de vante', value: wz(R, fins.bow.F) },
    { name: 'Lemes de ré', value: wz(R, fins.stern.F) },
    { name: 'Estabilizadores e vela', value: other },
    { name: 'Hélice (componente vertical)', value: wz(R, f.propeller.F) },
    { name: 'Massa adicional (inercial)', value: wz(R, added) },
    { name: 'Contato com o fundo', value: wz(R, f.contact.F) },
  ];
  const total = items.reduce((a, i) => a + i.value, 0);
  return { items, total };
}

export function pitchBreakdown(e: SimulationEngine): { items: Item[]; total: number } {
  const f = e.outputs.forces;
  const fins = f.fins;
  const items: Item[] = [
    { name: 'Hidrostático (peso + empuxo)', value: f.weight.M.y + f.buoyancy.M.y },
    { name: 'Casco (sustentação/amortec.)', value: f.crossflow.M.y + f.bodyLift.M.y + f.damping.M.y },
    { name: 'Momento de Munk', value: f.munk.y },
    { name: 'Lemes de vante', value: fins.bow.M.y },
    { name: 'Lemes de ré', value: fins.stern.M.y },
    { name: 'Estabilizadores horizontais', value: fins.stabH.M.y },
    { name: 'Contato com o fundo', value: f.contact.M.y },
  ];
  return { items, total: items.reduce((a, i) => a + i.value, 0) };
}

export function yawBreakdown(e: SimulationEngine): { items: Item[]; total: number } {
  const f = e.outputs.forces;
  const fins = f.fins;
  const items: Item[] = [
    { name: 'Leme de direção', value: fins.rudder.M.z },
    { name: 'Estabilizadores verticais', value: fins.stabV.M.z },
    { name: 'Vela (torre)', value: fins.sail.M.z },
    { name: 'Casco (sustentação/amortec.)', value: f.crossflow.M.z + f.bodyLift.M.z + f.damping.M.z },
    { name: 'Momento de Munk', value: f.munk.z },
  ];
  return { items, total: items.reduce((a, i) => a + i.value, 0) };
}

export function rollBreakdown(e: SimulationEngine): { items: Item[]; total: number } {
  const f = e.outputs.forces;
  const fins = f.fins;
  const items: Item[] = [
    { name: 'Hidrostático (peso + empuxo)', value: f.weight.M.x + f.buoyancy.M.x },
    { name: 'Reação do torque do hélice', value: f.propeller.M.x },
    { name: 'Vela (torre)', value: fins.sail.M.x },
    { name: 'Amortecimento', value: f.damping.M.x },
    { name: 'Outros lemes', value: fins.rudder.M.x + fins.stabV.M.x + fins.bow.M.x + fins.stern.M.x },
  ];
  return { items, total: items.reduce((a, i) => a + i.value, 0) };
}

export function VerticalExplain({ e }: { e: SimulationEngine }) {
  const { items, total } = verticalBreakdown(e);
  const vz = e.outputs.verticalSpeed;
  const net = e.outputs.netBuoyancyKg;
  const main = [...items].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).filter((i) => !i.name.startsWith('Peso') && !i.name.startsWith('Empuxo'))[0];
  const moving = Math.abs(vz) < 0.02 ? 'praticamente estável na vertical' : vz > 0 ? `DESCENDO a ${fmt(vz, 2)} m/s` : `SUBINDO a ${fmt(-vz, 2)} m/s`;
  const o = e.outputs;
  const statik = o.surfaced
    ? `flutuação na superfície com ${fmt(o.forces.hs.immersedFraction * 100, 1)} % do casco imerso; o empuxo da parte imersa equilibra o peso e a reserva de flutuabilidade é ${fmt(o.reserveKg / 1000, 1)} t (peso adicional necessário para submergir)`
    : Math.abs(net) < 100
      ? 'equilíbrio hidrostático (neutro)'
      : net > 0
        ? `flutuabilidade POSITIVA de ${fmt(net / 1000, 2)} t`
        : `flutuabilidade NEGATIVA de ${fmt(-net / 1000, 2)} t`;
  return (
    <div>
      <p style={{ margin: '0 0 6px' }}>
        O submarino está <b>{moving}</b>. Estaticamente há <b>{statik}</b>
        {main && Math.abs(main.value) > 500 ? (
          <>
            ; a maior contribuição dinâmica vem de <b>{main.name.toLowerCase()}</b> ({fmtForce(main.value)} {main.value > 0 ? 'para baixo' : 'para cima'})
          </>
        ) : null}
        .
      </p>
      <Bars items={items} unitFmt={fmtForce} />
      <div className="forcebar" style={{ fontWeight: 700 }}>
        <span>Resultante vertical</span>
        <span className="subtle">{total > 0 ? '↓ acelera para baixo' : '↑ acelera para cima'}</span>
        <span className="v">{fmtForce(total)}</span>
      </div>
      <div className="subtle">Sinal: + para baixo (z NED). Barras âmbar = para baixo, azuis = para cima.</div>
    </div>
  );
}

export function MomentExplain({ e, axis }: { e: SimulationEngine; axis: 'pitch' | 'yaw' | 'roll' }) {
  const b = axis === 'pitch' ? pitchBreakdown(e) : axis === 'yaw' ? yawBreakdown(e) : rollBreakdown(e);
  const lbl = axis === 'pitch' ? '+ = proa para cima' : axis === 'yaw' ? '+ = guinada para BE' : '+ = adernar para BE';
  return (
    <div>
      <Bars items={b.items} unitFmt={fmtMoment} />
      <div className="forcebar" style={{ fontWeight: 700 }}>
        <span>Momento resultante</span>
        <span className="subtle">{lbl}</span>
        <span className="v">{fmtMoment(b.total)}</span>
      </div>
    </div>
  );
}
