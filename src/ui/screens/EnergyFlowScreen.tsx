/**
 * FLUXO DE ENERGIA — diagrama de fluxo (estilo Sankey): a largura de cada
 * faixa é proporcional à potência simulada e o tracejado anda no sentido do
 * fluxo. Com os diesel-geradores em carga (snorkel), a energia vai do
 * combustível ao barramento, à bateria (carga) e aos consumidores; com os
 * geradores parados, a bateria alimenta o barramento (descarga).
 */
import { cmd, useSim } from '../store';
import { Panel } from '../components/Panel';
import { Telegraph } from '../components/Controls';
import { loadScenario } from '../ops/OpsGroups';
import type { SimulationEngine } from '../../sim/core/engine';
import { fmt } from '../format';
import { usePersisted } from '../persist';
import type { ReactNode } from 'react';
import { WideDiagram } from '../components/WideDiagram';

const LOAD_INFO: Record<string, { name: string; color: string }> = {
  MEP: { name: 'Motor elétrico principal', color: '#36c5f0' },
  HOTEL: { name: 'Habitabilidade / ventilação', color: '#b48cff' },
  NAV: { name: 'Navegação e sensores', color: '#9fe3b0' },
  HID: { name: 'Planta hidráulica', color: '#ffb347' },
  COMP: { name: 'Compressor de ar AP', color: '#e6dba0' },
  BTC: { name: 'Bomba de transferência de compensação', color: '#7fffc0' },
  BC: { name: 'Bomba de compensação', color: '#22d47a' },
  BT: { name: 'Bomba de trim', color: '#ffa62b' },
  BB: { name: 'Bomba de banda', color: '#c77dff' },
};
const ORDER = ['MEP', 'HOTEL', 'NAV', 'HID', 'COMP', 'BC', 'BT', 'BB'];

type StatusCls = 'on' | 'trans' | 'off' | 'bad';
const STATUS_COLOR: Record<StatusCls, string> = { on: '#3ddc84', trans: '#ffc040', off: '#5b6f86', bad: '#ff5257' };
const BADGE: Record<StatusCls, string> = { on: 'ok', trans: 'warn', off: 'off', bad: 'alarm' };

/** Estado operacional de um consumidor do barramento (lido do estado da simulação). */
function loadStatus(e: SimulationEngine, k: string): { label: string; cls: StatusCls; cmd: boolean } {
  const s = e.state;
  const pump = (sys: 'compensation' | 'trim' | 'heel') => {
    const p = s[sys].pump;
    if (p.failed) return { label: 'FALHA', cls: 'bad' as StatusCls, cmd: true };
    if (p.cmd) {
      if (!s.electrical.energized) return { label: 'SEM ENERGIA', cls: 'bad' as StatusCls, cmd: true };
      if (p.speed < 0.95) return { label: 'PARTINDO', cls: 'trans' as StatusCls, cmd: true };
      return { label: p.noSuction ? 'FUNCIONANDO — sem sucção' : p.deadhead ? 'FUNCIONANDO — sem vazão' : 'FUNCIONANDO', cls: 'on' as StatusCls, cmd: true };
    }
    return p.speed > 0.05 ? { label: 'PARANDO', cls: 'trans' as StatusCls, cmd: true } : { label: 'DESLIGADA', cls: 'off' as StatusCls, cmd: true };
  };
  switch (k) {
    case 'MEP': {
      const p = s.propulsion;
      if (p.failed) return { label: 'FALHA', cls: 'bad', cmd: true };
      if (Math.abs(p.rpmCmd) < 0.5 && Math.abs(e.outputs.rpm) < 1) return { label: 'PARADO', cls: 'off', cmd: true };
      if (Math.abs(p.rpmRef - p.rpmCmd) > 1) return { label: 'ACELERANDO/DESACELERANDO', cls: 'trans', cmd: true };
      return { label: p.powerLimited ? 'FUNCIONANDO — limitado' : 'FUNCIONANDO', cls: p.powerLimited ? 'trans' : 'on', cmd: true };
    }
    case 'BC':
      return pump('compensation');
    case 'BT':
      return pump('trim');
    case 'BB':
      return pump('heel');
    case 'COMP':
      if (!s.hpAir.compressorCmd) return { label: 'DESLIGADO', cls: 'off', cmd: true };
      return s.hpAir.compressorRunning ? { label: 'FUNCIONANDO', cls: 'on', cmd: true } : { label: s.electrical.energized ? 'SEM AR (aguardando tomada de ar)' : 'SEM ENERGIA', cls: 'bad', cmd: true };
    case 'HID':
      if (s.hydraulics.failed) return { label: 'FALHA', cls: 'bad', cmd: false };
      return s.hydraulics.pumpOn ? { label: 'BOMBA LIGADA (automática)', cls: 'on', cmd: false } : { label: 'EM ESPERA (automática)', cls: 'on', cmd: false };
    default:
      return { label: s.electrical.energized ? 'LIGADO (carga fixa)' : 'SEM ENERGIA', cls: s.electrical.energized ? 'on' : 'bad', cmd: false };
  }
}

/** largura da faixa: proporcional à potência, com mínimo visível */
const W = (p: number, pmax: number) => (p <= 1 ? 0 : Math.max(2.5, 46 * Math.pow(p / pmax, 0.75)));
/** velocidade da animação: mais rápida com mais potência */
const dur = (p: number, pmax: number) => `${Math.max(0.35, 2.4 - 2 * Math.min(1, p / pmax))}s`;
const kw = (p: number) => (Math.abs(p) >= 1e6 ? `${fmt(p / 1e6, 2)} MW` : `${fmt(p / 1000, 0)} kW`);

function Flow({ d, p, pmax, color, rev, label, lx, ly }: { d: string; p: number; pmax: number; color: string; rev?: boolean; label?: string; lx?: number; ly?: number }) {
  const w = W(p, pmax);
  if (w <= 0)
    return (
      <g>
        <path d={d} stroke="#22344a" strokeWidth={2} fill="none" strokeDasharray="3 5" />
      </g>
    );
  return (
    <g>
      <path d={d} stroke={color} strokeOpacity={0.28} strokeWidth={w} fill="none" strokeLinecap="round" />
      <path d={d} stroke={color} strokeWidth={Math.max(1.5, w * 0.35)} fill="none" strokeLinecap="round" className={`eflow ${rev ? 'rev' : ''}`} style={{ animationDuration: dur(p, pmax) }} />
      {label && lx !== undefined && (
        <text x={lx} y={ly} className="eflow-lbl" textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  );
}

function Diagram({ e, sel, onPick }: { e: SimulationEngine; sel: string | null; onPick: (id: string) => void }) {
  const v = e.vessel;
  const el = e.state.electrical;
  const gens = v.electrical.generators;
  const pmax = Math.max(1.5e6, ...gens.map((g) => g.ratedPower));
  const gp = gens.map((g) => el.generators[g.id].power);
  const pb = el.batteryPower; // + descarga
  const charging = pb < -1;
  const loads = ORDER.map((k) => ({ k, p: el.loads[k] ?? 0 }));
  const busY0 = 70;
  const busY1 = 470;
  const busX = 470;
  const soc = el.soc;
  const fuelFrac = el.fuel / v.electrical.fuel.tankVolume;
  const sn = e.state.snorkel;
  // posições dos consumidores (direita)
  const ly = (i: number) => 70 + i * 54;
  /** propriedades de um elemento clicável do diagrama */
  const pick = (id: string) => ({
    className: `eclick ${sel === id ? 'sel' : ''}`,
    onClick: () => onPick(id),
    role: 'button',
    tabIndex: 0,
    onKeyDown: (ev: React.KeyboardEvent) => (ev.key === 'Enter' || ev.key === ' ') && onPick(id),
  });
  return (
    <WideDiagram minWidth={800}>
      <svg viewBox="0 0 980 560" className="svgbox eflow-svg" role="img" aria-label="Diagrama do fluxo de energia">
        {/* combustível e ar */}
        <g {...pick('fuel')}>
          <title>Combustível — clique para detalhes</title>
          <rect x={20} y={40} width={90} height={150} rx={8} className="enode" />
          <rect x={26} y={46 + 138 * (1 - fuelFrac)} width={78} height={138 * fuelFrac} rx={4} fill="#8a6a3a" opacity={0.75} />
          <text x={65} y={30} className="enode-t" textAnchor="middle">
            Combustível
          </text>
          <text x={65} y={210} className="enode-v" textAnchor="middle">
            {fmt(el.fuel, 1)} m³
          </text>
        </g>
        <g {...pick('air')}>
          <title>Snorkel (ar para os diesel) — clique para comandar</title>
          <rect x={20} y={250} width={90} height={60} rx={8} className={`enode ${sn.headValveOpen ? 'on' : ''}`} />
          <text x={65} y={274} className="enode-t" textAnchor="middle">
            Ar (snorkel)
          </text>
          <text x={65} y={294} className="enode-v" textAnchor="middle">
            {sn.headValveOpen ? 'aberto' : e.outputs.surfaced ? 'pela vela' : sn.pos > 0.5 ? 'fechado' : 'arriado'}
          </text>
        </g>
        {/* geradores */}
        {gens.map((g, i) => {
          const st = el.generators[g.id];
          const on = st.status === 'EM CARGA';
          const y = 60 + i * 150;
          const fuelKgH = g.sfc * gp[i] * 3600;
          return (
            <g key={g.id}>
              <Flow d={`M110 ${115} C 150 ${115}, 160 ${y + 45}, 200 ${y + 45}`} p={on ? gp[i] * 2.4 : 0} pmax={pmax * 2.4} color="#c9a46a" />
              <Flow d={`M110 280 C 150 280, 160 ${y + 70}, 200 ${y + 70}`} p={on ? gp[i] : 0} pmax={pmax} color="#bfe3ff" />
              <g {...pick('gen:' + g.id)}>
              <title>{g.name} — clique para partir/parar</title>
              <rect x={200} y={y} width={150} height={110} rx={10} className={`enode ${on ? 'on' : st.status === 'PARTINDO' ? 'warn' : st.failed || st.status === 'SEM AR' ? 'bad' : ''}`} />
              <g transform={`translate(${235} ${y + 55})`}>
                <circle r={22} className="egen" />
                <g className={on ? 'espin' : st.status === 'PARTINDO' ? 'espin slow' : ''}>
                  {[0, 60, 120].map((a) => (
                    <rect key={a} x={-2} y={-18} width={4} height={36} rx={2} fill="#d8e4f0" transform={`rotate(${a})`} />
                  ))}
                </g>
              </g>
              <text x={300} y={y + 30} className="enode-t" textAnchor="middle">
                {g.name.replace('Grupo diesel-gerador', 'Diesel-gerador')}
              </text>
              <text x={300} y={y + 56} className="enode-v" textAnchor="middle">
                {st.status}
              </text>
              <text x={300} y={y + 80} className="enode-v" textAnchor="middle">
                {kw(gp[i])}
              </text>
              {on && (
                <text x={300} y={y + 100} className="enode-s" textAnchor="middle">
                  {fmt(fuelKgH, 0)} kg/h de óleo
                </text>
              )}
              </g>
              <Flow d={`M350 ${y + 55} C 400 ${y + 55}, 420 ${y + 55}, ${busX} ${y + 55}`} p={gp[i]} pmax={pmax} color="#ffd18a" label={gp[i] > 1 ? kw(gp[i]) : undefined} lx={410} ly={y + 45} />
            </g>
          );
        })}
        {/* barramento */}
        <g {...pick('bus')}>
          <title>Barramento principal — clique para detalhes</title>
          <rect x={busX} y={busY0} width={22} height={busY1 - busY0} rx={6} className={`ebus ${el.energized ? 'on' : 'bad'}`} />
        </g>
        <text x={busX + 11} y={busY0 - 48} className="enode-t" textAnchor="middle">
          Barramento
        </text>
        <text x={busX + 11} y={busY0 - 0} dy={-30} className="enode-v" textAnchor="middle">
          {fmt(el.voltage, 0)} V
        </text>
        {/* bateria */}
        <g>
          <Flow d={`M${busX} 420 C 420 420, 400 470, 350 470`} p={Math.abs(pb)} pmax={pmax} color={charging ? '#3ddc84' : '#ff9a5c'} rev={!charging} label={Math.abs(pb) > 1 ? `${charging ? 'carga' : 'descarga'} ${kw(Math.abs(pb))}` : undefined} lx={405} ly={410} />
          <g {...pick('battery')}>
          <title>Bateria e disjuntor — clique para comandar</title>
          <rect x={200} y={410} width={150} height={120} rx={10} className={`enode ${charging ? 'on' : el.batteryFailed || !el.breakerClosed ? 'bad' : ''}`} />
          <rect x={214} y={430} width={110} height={56} rx={5} fill="none" stroke="#9fb7cf" strokeWidth={2} />
          <rect x={324} y={448} width={7} height={20} rx={2} fill="#9fb7cf" />
          <rect x={218} y={434} width={102 * soc} height={48} rx={3} fill={soc > 0.5 ? '#3ddc84' : soc > 0.25 ? '#ffc040' : '#ff4d4d'} className={charging ? 'echarge' : ''} />
          <text x={269} y={466} className="enode-big eflow-lbl" textAnchor="middle">
            {fmt(soc * 100, 1)} %
          </text>
          <text x={275} y={404} className="enode-t" textAnchor="middle">
            Bateria
          </text>
          <text x={275} y={506} className="enode-v" textAnchor="middle">
            {fmt(el.current, 0)} A · {charging ? 'CARREGANDO' : pb > 1 ? 'DESCARREGANDO' : 'em repouso'}
          </text>
          <text x={275} y={523} className="enode-s" textAnchor="middle">
            {el.breakerClosed ? 'disjuntor fechado' : 'DISJUNTOR ABERTO'}
          </text>
          </g>
        </g>
        {/* consumidores */}
        {loads.map(({ k, p }, i) => {
          const y = ly(i);
          const info = LOAD_INFO[k];
          return (
            <g key={k}>
              <Flow d={`M${busX + 22} ${Math.min(busY1 - 10, Math.max(busY0 + 10, y + 18))} C ${busX + 90} ${y + 18}, 600 ${y + 18}, 650 ${y + 18}`} p={p} pmax={pmax} color={info.color} />
              <g {...pick('load:' + k)}>
              <title>{`${info.name}: ${loadStatus(e, k).label} — clique para ${loadStatus(e, k).cmd ? 'comandar' : 'detalhes'}`}</title>
              <rect x={650} y={y} width={300} height={38} rx={7} className={`enode ${p > 1 ? 'on' : ''} ${loadStatus(e, k).cls === 'bad' ? 'bad' : ''}`} />
              <circle cx={666} cy={y + 19} r={5} fill={info.color} />
              <circle cx={666} cy={y + 19} r={8} fill="none" stroke={STATUS_COLOR[loadStatus(e, k).cls]} strokeWidth={2} />
              <text x={678} y={y + 23} className="enode-l">
                {info.name}
              </text>
              <text x={940} y={y + 23} className="enode-v" textAnchor="end">
                {kw(p)}
              </text>
              </g>
            </g>
          );
        })}
      </svg>
    </WideDiagram>
  );
}

const GEN_CLS = (st: string, failed: boolean): StatusCls => (failed || st === 'FALHA' || st === 'SEM AR' ? 'bad' : st === 'EM CARGA' ? 'on' : st === 'PARTINDO' || st === 'PARANDO' ? 'trans' : 'off');

/** Painel do equipamento clicado no diagrama: estado, comandos e efeitos. */
function NodePanel({ e, sel, onClose }: { e: SimulationEngine; sel: string; onClose: () => void }) {
  const v = e.vessel;
  const s = e.state;
  const el = s.electrical;
  const sn = s.snorkel;
  const air = sn.headValveOpen || e.outputs.surfaced;
  let title = '';
  let status: { label: string; cls: StatusCls } = { label: '', cls: 'off' };
  let body: ReactNode = null;
  if (sel.startsWith('gen:')) {
    const id = sel.slice(4);
    const g = v.electrical.generators.find((x) => x.id === id)!;
    const st = el.generators[id];
    title = g.name;
    status = { label: st.status, cls: GEN_CLS(st.status, st.failed) };
    body = (
      <>
        <div className="row">
          <button className={`btn ${st.cmd ? 'on' : 'ok'}`} onClick={() => cmd({ type: 'generator', id, run: !st.cmd })}>
            {st.cmd ? '■ Parar' : '▶ Partir'}
          </button>
          <span className="mono">
            {kw(st.power)} de {kw(g.ratedPower)} · partida em {g.startTime} s
          </span>
        </div>
        <div className="note">
          Só parte com tomada de ar ({air ? 'disponível' : <b>indisponível agora</b>}: superfície ou snorkel içado com a válvula de cabeça aberta) e combustível. Consome {fmt(g.sfc * g.ratedPower * 3600, 0)} kg/h em carga; o
          combustível queimado é substituído por água do mar (o submarino fica mais pesado).
          {st.status === 'SEM AR' && ' Agora está comandado mas SEM AR: suba à cota periscópica e içe o snorkel.'}
          {st.failed && ' Gerador em falha (injetada na aba Segurança).'}
        </div>
      </>
    );
  } else if (sel === 'air') {
    title = 'Snorkel (ar para os diesel e o compressor)';
    status = { label: sn.headValveOpen ? 'VÁLVULA ABERTA' : sn.pos > 0.95 ? 'IÇADO — válvula fechada' : sn.pos < 0.05 ? 'ARRIADO' : 'EM CURSO', cls: sn.headValveOpen ? 'on' : sn.pos > 0.05 && sn.pos < 0.95 ? 'trans' : 'off' };
    body = (
      <>
        <button className={`btn ${sn.cmd ? 'on' : 'ok'}`} onClick={() => cmd({ type: 'snorkel', raise: !sn.cmd })}>
          {sn.cmd ? '▼ Arriar mastro' : '▲ Içar mastro'}
        </button>
        <div className="note">A válvula de cabeça abre só com a cabeça do mastro fora d’água (cota periscópica ~14 m) e fecha nas cristas das ondas. Na superfície o ar vem pela escotilha/vela.</div>
      </>
    );
  } else if (sel === 'fuel') {
    title = 'Combustível';
    status = { label: `${fmt((el.fuel / v.electrical.fuel.tankVolume) * 100, 0)} %`, cls: el.fuel > 1 ? 'on' : 'bad' };
    body = (
      <div className="note">
        {fmt(el.fuel, 2)} m³ de {v.electrical.fuel.tankVolume} m³. Queimado nesta sessão: {fmt(s.ledger.fuelBurned, 1)} kg. Não tem comando próprio: é consumido pelos diesel-geradores. O tanque é compensado com água do mar.
      </div>
    );
  } else if (sel === 'bus') {
    title = 'Barramento principal';
    status = { label: el.energized ? 'ENERGIZADO' : 'SEM ENERGIA', cls: el.energized ? 'on' : 'bad' };
    body = (
      <div className="note">
        {fmt(el.voltage, 0)} V · demanda {kw(el.totalLoad)} · geração {kw(el.generation)} · bateria {el.batteryPower >= 0 ? 'fornece' : 'recebe'} {kw(Math.abs(el.batteryPower))}. Não tem liga/desliga: fica energizado enquanto a bateria
        (disjuntor fechado) ou um gerador em carga o alimentam.
      </div>
    );
  } else if (sel === 'battery') {
    title = 'Bateria principal e disjuntor';
    status = { label: el.batteryFailed ? 'FALHA (isolada)' : !el.breakerClosed ? 'DISJUNTOR ABERTO' : el.batteryPower < -1 ? 'CARREGANDO' : el.batteryPower > 1 ? 'DESCARREGANDO' : 'EM REPOUSO', cls: el.batteryFailed || !el.breakerClosed ? 'bad' : 'on' };
    body = (
      <>
        <button className={`btn ${el.breakerClosed ? 'warn' : 'ok'}`} onClick={() => cmd({ type: 'breaker', closed: !el.breakerClosed })}>
          {el.breakerClosed ? 'Abrir disjuntor' : 'Fechar disjuntor'}
        </button>
        <div className="note">
          Carga {fmt(el.soc * 100, 1)} % · {fmt(el.current, 0)} A · {fmt(el.voltage, 0)} V. Com o disjuntor aberto o barramento depende só dos geradores; sem eles, motor, bombas e hidráulica param.
        </div>
      </>
    );
  } else if (sel.startsWith('load:')) {
    const k = sel.slice(5);
    const info = LOAD_INFO[k];
    title = info.name;
    status = loadStatus(e, k);
    const p = el.loads[k] ?? 0;
    const pumpCtl = (sys: 'compensation' | 'trim' | 'heel') => {
      const pu = s[sys].pump;
      return (
        <>
          <button className={`btn ${pu.cmd ? 'on' : 'ok'}`} onClick={() => cmd({ type: 'pump', system: sys, run: !pu.cmd })}>
            {pu.cmd ? '■ Parar bomba' : '▶ Partir bomba'}
          </button>
          <div className="note">
            Vazão {fmt(pu.flow * 1000, 1)} L/s · Δp {fmt(pu.dp / 1e5, 1)} bar · {kw(p)}. Potência P = Q·Δp/η: esgotar em grande profundidade custa mais. Para mover água, alinhe também as válvulas (ou use as sequências
            automáticas na aba {sys === 'compensation' ? 'Lastro e compensação' : 'Trim e banda'}); bomba sem caminho fica sem vazão.
            {s[sys].dosing?.active ? ' Há uma sequência automática em andamento: comandar a bomba manualmente a cancela.' : ''}
          </div>
        </>
      );
    };
    body =
      k === 'MEP' ? (
        <>
          <Telegraph e={e} />
          <div className="note">
            {fmt(e.outputs.rpm, 0)} rpm · {kw(p)} elétricos · eixo {kw(s.propulsion.shaftPower)}. O motor é comandado pelo telégrafo (não há liga/desliga separado).
          </div>
        </>
      ) : k === 'BC' ? (
        pumpCtl('compensation')
      ) : k === 'BT' ? (
        pumpCtl('trim')
      ) : k === 'BB' ? (
        pumpCtl('heel')
      ) : k === 'COMP' ? (
        <>
          <button className={`btn ${s.hpAir.compressorCmd ? 'on' : 'ok'}`} onClick={() => cmd({ type: 'compressor', run: !s.hpAir.compressorCmd })}>
            {s.hpAir.compressorCmd ? '■ Parar compressor' : '▶ Partir compressor'}
          </button>
          <div className="note">Recarrega as garrafas de ar AP ({fmt(e.outputs.hpManifoldBar, 0)} bar no coletor). Precisa de tomada de ar (superfície ou snorkel aberto) e de barramento energizado.</div>
        </>
      ) : k === 'HID' ? (
        <div className="note">
          Pressão {fmt(s.hydraulics.pressure / 1e5, 0)} bar. A bomba hidráulica liga e desliga sozinha para manter a pressão dos acumuladores que movem lemes e válvulas; não há comando manual (falhas: aba Segurança).
        </div>
      ) : (
        <div className="note">Carga fixa de {kw(p)} enquanto o barramento estiver energizado (habitabilidade, ventilação, iluminação, navegação, sensores e controle). Não tem liga/desliga no modelo.</div>
      );
  }
  return (
    <div className="enode-panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{title}</b>
        <span className={`badge ${BADGE[status.cls]}`}>{status.label}</span>
        <button className="btn sm" onClick={onClose} aria-label="Fechar">
          ✕
        </button>
      </div>
      <div className="col mt8">{body}</div>
    </div>
  );
}

export function EnergyFlowScreen() {
  const e = useSim(8);
  const [sel, setSel] = usePersisted<string | null>('energy.sel', null);
  const v = e.vessel;
  const el = e.state.electrical;
  const sn = e.state.snorkel;
  const b = v.electrical.battery;
  const pb = el.batteryPower;
  const capWh = b.capacityAh * el.ocv;
  const charging = pb < -1;
  const hours = charging ? ((1 - el.soc) * capWh) / (-pb * b.chargeEfficiency) : pb > 1 ? (el.soc * capWh) / pb : Infinity;
  const genOn = v.electrical.generators.filter((g) => el.generators[g.id].status === 'EM CARGA');
  const lossI2R = el.current * el.current * b.internalResistance;
  const story = genOn.length
    ? `${genOn.length} diesel-gerador(es) em carga entregam ${kw(el.generation)} ao barramento: ${kw(el.totalLoad)} vão para os sistemas${charging ? ` e ${kw(-pb)} carregam a bateria (${fmt(-el.current, 0)} A). Carga completa em ≈ ${fmt(hours, 1)} h.` : '.'}`
    : el.energized
      ? `Geradores parados: a bateria alimenta sozinha o barramento com ${kw(pb)} (${fmt(el.current, 0)} A). No consumo atual, a autonomia até 0 % é de ≈ ${Number.isFinite(hours) ? fmt(hours, 1) : '—'} h.`
      : 'Barramento sem energia: verifique o disjuntor da bateria e os geradores.';
  return (
    <div className="grid g2">
      <Panel title="Fluxo de energia" className="span-all">
        <div className="estory">{story}</div>
        <div className="eflow-wrap">
          <Diagram e={e} sel={sel} onPick={(id) => setSel(sel === id ? null : id)} />
          {sel ? (
            <NodePanel e={e} sel={sel} onClose={() => setSel(null)} />
          ) : (
            <div className="enode-panel hint">Clique num equipamento do diagrama (gerador, snorkel, bateria, barramento, motor, bombas, compressor…) para ver o estado e os comandos.</div>
          )}
        </div>
        <div className="note">
          Largura das faixas ∝ potência (escala comprimida para os consumidores pequenos aparecerem); o tracejado anda no sentido do fluxo. Perdas internas da bateria (I²R): {kw(lossI2R)}. Valores do balanço elétrico de cada passo da simulação.
        </div>
      </Panel>
      <Panel title="Comandos de energia">
        <div className="col">
          <div className="row">
            <b>Snorkel</b>
            <span className={`badge ${sn.headValveOpen ? 'ok' : 'off'}`}>{sn.pos > 0.95 ? 'içado' : sn.pos < 0.05 ? 'arriado' : 'em curso'} · válvula {sn.headValveOpen ? 'aberta' : 'fechada'}</span>
            <button className={`btn sm ${sn.cmd ? 'on' : ''}`} onClick={() => cmd({ type: 'snorkel', raise: !sn.cmd })}>
              {sn.cmd ? 'Arriar' : 'Içar'}
            </button>
          </div>
          {v.electrical.generators.map((g) => {
            const st = el.generators[g.id];
            return (
              <div key={g.id} className="row">
                <b>{g.name}</b>
                <span className={`badge ${st.status === 'EM CARGA' ? 'ok' : st.status === 'PARTINDO' ? 'warn' : st.failed ? 'alarm' : 'off'}`}>{st.status}</span>
                <button className={`btn sm ${st.cmd ? 'on' : ''}`} onClick={() => cmd({ type: 'generator', id: g.id, run: !st.cmd })}>
                  {st.cmd ? 'Parar' : 'Partir'}
                </button>
              </div>
            );
          })}
          <div className="row">
            <b>Disjuntor da bateria</b>
            <button className={`btn sm ${el.breakerClosed ? 'on' : 'warn'}`} onClick={() => cmd({ type: 'breaker', closed: !el.breakerClosed })}>
              {el.breakerClosed ? 'Fechado (abrir)' : 'Aberto (fechar)'}
            </button>
          </div>
          <div className="subtle">Os geradores só partem com ar: snorkel içado com a válvula de cabeça aberta (cota periscópica) ou na superfície.</div>
          <button
            className="btn sm ok"
            onClick={() => {
              // cota periscópica com mar calmo e piloto de profundidade em 14 m: a cabeça do snorkel fica seca
              loadScenario('cota_periscopica');
              cmd({ type: 'seaState', value: 1 });
              cmd({ type: 'autopilot', channel: 'depth', mode: 'AUTO' });
              cmd({ type: 'setpoint', channel: 'depth', value: 14 });
              cmd({ type: 'snorkel', raise: true });
            }}
          >
            Preparar demonstração: cota periscópica, bateria a 55 %, snorkel içando
          </button>
        </div>
      </Panel>
      <Panel title="Carga do motor (telégrafo)">
        <Telegraph e={e} />
        <div className="note">Mais rotação ⇒ mais potência no motor elétrico principal ⇒ menos sobra para carregar a bateria (ou descarga mais rápida).</div>
      </Panel>
    </div>
  );
}
