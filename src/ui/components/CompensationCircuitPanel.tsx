import type { SimulationEngine } from '../../sim/core/engine';
import { buildCompensationCircuit, circuitEdgeFlow, directionalPosition, selectorValve } from '../../sim/systems/compensationCircuit';
import { tankVolume } from '../../sim/systems/internalTanks';
import { pumpStatus } from '../../sim/systems/components';
import { cmd } from '../store';
import { Panel } from './Panel';
import { Pipe, PumpGlyph, TankGlyph, ValveGlyph } from './Schematic';
import { fmt } from '../format';

export function CompensationCircuitPanel({ e }: { e: SimulationEngine }) {
  const { state: s, vessel: v } = e;
  const tr = s.compensation.transfer;
  if (!tr) return null;
  const tanks = [v.heel.tankA, ...v.compensation.tanks.filter(t => t.id === 'TC0'), v.heel.tankB];
  const stateOf = (id: string) => id === v.heel.tankA.id ? s.heel.tankA : id === v.heel.tankB.id ? s.heel.tankB : s.compensation.tanks[id];
  const circuit = buildCompensationCircuit(s.compensation, tanks.map(t => t.id));
  const position = directionalPosition(tr.direction.pos);
  const locked = tr.pump.cmd || tr.pump.speed > 0.001 || tr.valveA.pos > 0.001 || tr.valveB.pos > 0.001;
  const tankX = (id: string) => 160 + tanks.findIndex(t => t.id === id) * 290;
  const q = tr.pump.flow;
  const paths: Record<string, string> = {
    'header:A': 'M100,250 L100,365 L430,365 L430,390',
    'header:B': 'M805,310 L805,365 L470,365 L470,390',
    suction: 'M470,480 L470,530 L560,530 L560,590 L475,590',
    pump: 'M475,590 L425,590',
    discharge: 'M425,590 L340,590 L340,530 L430,530 L430,480',
    'A:T': 'M430,390 L470,480', 'P:B': 'M430,480 L470,390',
    'B:T': 'M470,390 L470,480', 'P:A': 'M430,480 L430,390',
  };
  tanks.forEach(t => {
    const x = tankX(t.id);
    paths[`${t.id}:A`] = `M${x},128 L${x},150 L${x - 28},150 L${x - 28},250 L100,250`;
    paths[`${t.id}:B`] = `M${x},128 L${x},150 L${x + 28},150 L${x + 28},310 L805,310`;
  });
  const flow = (id: string) => circuitEdgeFlow(circuit, id, q);
  const routeName = (id: string) => id === 'TC0' ? 'Central' : id === v.heel.tankA.id ? 'BB' : 'BE';
  const text = circuit.route ? `${routeName(circuit.route.source)} → ${routeName(circuit.route.destination)}` : position === 'transito' ? 'VDC em trânsito — fluxo bloqueado' : !circuit.isolated ? 'Aguardando isolamento do mar' : 'Aguardando abertura dos seletores';
  return <Panel title="Compensação e banda — circuito de transferência revisado" className="span-all">
    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
      <div><b>BB ↔ Central ↔ BE</b><div className="subtle">Bomba BTC · VDC 4/2 · coletores A e B</div></div>
      <span className={`badge ${q > 0 ? 'ok' : 'info'}`}>{text} · {fmt(q * 1000, 2)} L/s</span>
    </div>
    <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
      <label>Coletor A <select aria-label="Tanque A da transferência" value={tr.source} disabled={locked} onChange={ev => cmd({ type: 'compensationRoute', source: ev.target.value, destination: tr.destination })}>
        {tanks.map(t => <option key={t.id} value={t.id} disabled={t.id === tr.destination}>{t.name}</option>)}
      </select></label>
      <label>Coletor B <select aria-label="Tanque B da transferência" value={tr.destination} disabled={locked} onChange={ev => cmd({ type: 'compensationRoute', source: tr.source, destination: ev.target.value })}>
        {tanks.map(t => <option key={t.id} value={t.id} disabled={t.id === tr.source}>{t.name}</option>)}
      </select></label>
      <button className={`btn ${tr.pump.cmd ? 'on' : ''}`} onClick={() => cmd({ type: 'compensationTransferPump', run: !tr.pump.cmd })}>{tr.pump.cmd ? 'Parar BTC' : 'Partir BTC'}</button>
    </div>
    <div className="row mt8" aria-label="Posições da válvula direcional">
      <span>VDC:</span>
      {(['direta', 'inversa'] as const).map((p, i) => <button key={p} className={`btn ${tr.direction.cmd === i ? 'on' : ''}`} onClick={() => cmd({ type: 'compensationDirection', position: p })} aria-pressed={tr.direction.cmd === i}>
        {p === 'direta' ? 'Direta · A → B' : 'Inversa · B → A'}
      </button>)}
      <span className="subtle">{pumpStatus(tr.pump, s.electrical.energized)}</span>
    </div>
    <svg viewBox="0 0 900 660" className="svgbox" role="img" aria-label="Diagrama hidráulico revisado com tanques BB, central e BE, válvula direcional de quatro vias e duas posições e bomba ligada à sucção e descarga" data-testid="compensation-circuit">
      <defs>
        <marker id="vdc-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#8ee9cc" /></marker>
      </defs>
      <rect width="900" height="660" rx="8" fill="#091622" />
      <text x="25" y="28" fill="#93abc2" fontSize="12">VISTA TRANSVERSAL · tanque central entre bombordo e boreste</text>
      {/* Primeiro desenha as linhas inativas, depois o caminho que efetivamente escoa. */}
      {circuit.edges.filter(edge => !['A:T', 'P:B', 'B:T', 'P:A', 'pump'].includes(edge.id)).sort((a, b) => Math.abs(flow(a.id)) - Math.abs(flow(b.id))).map(edge => <g key={edge.id} data-edge={edge.id} data-from={edge.from} data-to={edge.to} data-open={edge.open}>
        <Pipe d={paths[edge.id]} flow={flow(edge.id)} color={edge.id === 'discharge' ? '#ffbc74' : '#8ee9cc'} width={3} />
      </g>)}
      {tanks.map((t, i) => {
        const x = tankX(t.id);
        const st = stateOf(t.id);
        return <g key={t.id}>
          <text x={x} y="58" fill="#e1ebf5" fontSize="17" textAnchor="middle" fontWeight="600">{i === 0 ? 'BOMBORDO · BB' : i === 1 ? 'TANQUE CENTRAL' : 'BORESTE · BE'}</text>
          <TankGlyph x={x - 75} y={72} w={150} h={56} fill={tankVolume(st) / t.capacity} label={t.id === 'TC0' ? 'TC-0' : i === 0 ? 'TB-BB' : 'TB-BE'} sub={`${fmt(tankVolume(st), 2)} / ${t.capacity} m³`} color="#247ead" />
          <circle cx={x} cy={150} r="4" fill="#a0b7ca" />
          <ValveGlyph x={x - 28} y={205} vertical st={selectorValve(tr, t.id, 'A')} size={8} label="A" />
          <ValveGlyph x={x + 28} y={280} vertical st={selectorValve(tr, t.id, 'B')} size={8} label="B" />
          <circle cx={x - 28} cy={250} r="4" fill="#a0b7ca" />
          <circle cx={x + 28} cy={310} r="4" fill="#a0b7ca" />
          {/* Ponte no cruzamento B/coletor A: sem conexão hidráulica. */}
          <path d={`M${x + 28},240 Q${x + 44},250 ${x + 28},260`} fill="none" stroke="#091622" strokeWidth="10" />
          <path d={`M${x + 28},240 Q${x + 44},250 ${x + 28},260`} fill="none" stroke={Math.abs(flow(`${t.id}:B`)) > 0 ? '#8ee9cc' : '#2c4260'} strokeWidth="3" />
        </g>;
      })}
      <text x="30" y="232" fill="#8ba7be" fontSize="12">A</text><text x="850" y="300" fill="#8ba7be" fontSize="12">B</text>
      <text x="450" y="174" fill="#93abc2" fontSize="10" textAnchor="middle">TC-0 também ligado à VC0 da compensação · mesmo tanque</text>
      <rect x="380" y="390" width="140" height="90" rx="3" fill="#112738" stroke={tr.direction.stuck ? '#ff5257' : '#8ee9cc'} strokeWidth="2" />
      <text x="275" y="429" textAnchor="middle" fill="#e4eef7" fontSize="16" fontWeight="600">VDC 4/2</text>
      <text x="275" y="450" textAnchor="middle" fill="#93abc2" fontSize="11">4 vias · 2 posições</text>
      {(['A:T', 'P:B', 'B:T', 'P:A']).filter(id => circuit.edges.find(edge => edge.id === id)?.open).map(id => <path key={id} d={paths[id]} stroke="#8ee9cc" strokeWidth="2.5" fill="none" markerEnd="url(#vdc-arrow)" data-vdc-connection={id} />)}
      {position === 'transito' && <g stroke="#e8b76e" strokeWidth="2"><path d="M430,390 v18 m-9,0 h18 M470,390 v18 m-9,0 h18 M430,480 v-18 m-9,0 h18 M470,480 v-18 m-9,0 h18" /><text x="450" y="439" textAnchor="middle" stroke="none" fill="#e8b76e" fontSize="11">EM TRÂNSITO</text></g>}
      <text x="423" y="383" fill="#cfe0ed" fontSize="13">A</text><text x="469" y="383" fill="#cfe0ed" fontSize="13">B</text>
      <text x="416" y="502" fill="#ffbc74" fontSize="13">P</text><text x="473" y="502" fill="#8ee9cc" fontSize="13">T</text>
      <text x="625" y="425" fill="#cfe0ed" fontSize="13">{position === 'direta' ? 'A → T  /  P → B' : position === 'inversa' ? 'B → T  /  P → A' : 'A, B, P e T isoladas'}</text>
      <text x="625" y="449" fill="#93abc2" fontSize="11">Posição real: {position}{tr.direction.stuck ? ' · TRAVADA' : ''}</text>
      <text x="625" y="478" fill="#93abc2" fontSize="10">Posições do carretel da VDC</text>
      {(['direta', 'inversa'] as const).map((p, i) => <g key={p} transform={`translate(${625 + i * 65},488)`}>
        <rect width="65" height="48" fill={position === p ? '#173c3a' : '#0d1e2c'} stroke={position === p ? '#8ee9cc' : '#526b82'} />
        {p === 'direta' ? <path d="M18,5 L47,42 M18,42 L47,5" stroke="#8ee9cc" fill="none" markerEnd="url(#vdc-arrow)" /> : <path d="M47,5 V42 M18,42 V5" stroke="#8ee9cc" fill="none" markerEnd="url(#vdc-arrow)" />}
        <text x="32" y="63" textAnchor="middle" fill="#93abc2" fontSize="9">{p.toUpperCase()}</text>
      </g>)}
      <text x="250" y="551" fill="#ffbc74" fontSize="12">P · DESCARGA</text>
      <text x="545" y="551" fill="#8ee9cc" fontSize="12">T · SUCÇÃO</text>
      <Pipe d={paths.pump} flow={flow('pump')} color="#8ee9cc" />
      <PumpGlyph x={450} y={590} st={tr.pump} label="BTC · sentido de rotação fixo" reverse onToggle={() => cmd({ type: 'compensationTransferPump', run: !tr.pump.cmd })} />
      <text x="25" y="640" fill="#93abc2" fontSize="11">Pontos = uniões · pontes = cruzamentos sem ligação · somente o caminho ativo indica escoamento</text>
    </svg>
    <div className="row mt8" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <span className="subtle">Vazão <b>{fmt(q * 1000, 2)} L/s</b> · Δp <b>{fmt(tr.pump.dp / 1e5, 2)} bar</b> · Potência <b>{fmt(tr.pump.power / 1000, 2)} kW</b></span>
      <span className={`badge ${circuit.isolated ? 'ok' : 'warn'}`}>{circuit.isolated ? 'MAR ISOLADO' : 'AGUARDANDO ISOLAMENTO DO MAR'}</span>
    </div>
    <div className="note">Selecione um tanque para cada coletor e escolha a posição da VDC. A bomba succiona pela porta T e descarrega pela porta P; a VDC 4/2 define o sentido entre A e B. Para interromper a transferência, use Parar BTC. O terceiro tanque permanece isolado. Pare a BTC e aguarde o fechamento dos seletores para mudar o par. Vazão, níveis, pressão, energia e efeito de banda vêm da física do circuito.</div>
  </Panel>;
}
