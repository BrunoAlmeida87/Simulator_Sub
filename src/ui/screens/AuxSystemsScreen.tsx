/** Sistemas auxiliares: arquitetura prevista, estado de implementação e relações. */
import { useSim } from '../store';
import { Panel } from '../components/Panel';
import { bankPressure } from '../../sim/systems/hpAir';
import { fmt, fmtPower, fmtMass } from '../format';
import type { SimulationEngine } from '../../sim/core/engine';
import { WideDiagram } from '../components/WideDiagram';

type Status = 'IMPLEMENTADO' | 'PARCIAL' | 'FUTURO';

interface Module {
  id: string;
  name: string;
  status: Status;
  phase: string;
  implemented: string[];
  future: string[];
  relations: string[];
  live?: (e: SimulationEngine) => string[];
}

const MODULES: Module[] = [
  {
    id: 'ar',
    name: 'Ar comprimido (produção, armazenamento, distribuição)',
    status: 'PARCIAL',
    phase: 'Fase 1 (núcleo) / Fase 3 (expansão)',
    implemented: ['Garrafas AP com pressão p = mRT/V', 'Válvulas de isolamento e coletor', 'Sopro dos TLP por orifício compressível', 'Compressor com tomada de ar e consumo elétrico'],
    future: ['Soprador de baixa pressão para a superfície', 'Válvulas redutoras e consumidores de serviço', 'Resfriamento adiabático na expansão'],
    relations: ['Energia elétrica → compressor', 'Snorkel/superfície → tomada de ar', 'Ar AP → lastro principal'],
    live: (e) => e.vessel.hpAir.banks.map((b) => `${b.id}: ${fmt(bankPressure(e.vessel.hpAir, b.id, e.state.hpAir.banks[b.id].mass) / 1e5, 0)} bar`).concat([`Compressor: ${e.state.hpAir.compressorRunning ? 'comprimindo' : 'parado'}`]),
  },
  {
    id: 'hid',
    name: 'Sistemas hidráulicos',
    status: 'PARCIAL',
    phase: 'Fase 1 (conceitual)',
    implemented: ['Acumulador com recarga por bombas elétricas', 'Consumo por movimento de lemes, válvulas e mastro', 'Degradação da velocidade dos atuadores com a pressão'],
    future: ['Circuitos redundantes e seccionamento', 'Temperatura e viscosidade do fluido', 'Atuação manual de emergência'],
    relations: ['Energia elétrica → bombas hidráulicas', 'Hidráulica → lemes, válvulas, mastros'],
    live: (e) => [`Pressão: ${fmt(e.state.hydraulics.pressure / 1e5, 0)} bar`, `Bomba: ${e.state.hydraulics.pumpOn ? 'em carga' : 'em espera'}`, `Potência: ${fmtPower(e.state.hydraulics.power)}`],
  },
  {
    id: 'ele',
    name: 'Sistema elétrico e distribuição de cargas',
    status: 'PARCIAL',
    phase: 'Fase 1 (balanço) / Fase 2 (distribuição)',
    implemented: ['Bateria com V_oc(SoC), resistência interna e limite de corrente', 'Diesel-geradores com tomada de ar e consumo de combustível', 'Barramento único com todas as cargas modeladas', 'Perda de energia afeta bombas, hidráulica e propulsão'],
    future: ['Barramentos múltiplos e disjuntores por carga', 'Rejeição de cargas por prioridade', 'Modelo térmico e de envelhecimento da bateria'],
    relations: ['Bateria/geradores → todas as cargas', 'Combustível compensado → massa do submarino'],
    live: (e) => [`SoC: ${fmt(e.state.electrical.soc * 100, 1)} %`, `Demanda: ${fmtPower(e.state.electrical.totalLoad)}`, `Barramento: ${e.state.electrical.energized ? 'energizado' : 'DESENERGIZADO'}`],
  },
  {
    id: 'comp',
    name: 'Monitoramento de compartimentos e porões',
    status: 'PARCIAL',
    phase: 'Fase 1 (alagamento) / Fase 3',
    implemented: ['Alagamento por rombo: Q = C_d·A·√(2Δp/ρ)', 'Massa de água no porão altera peso e CG', 'Alarme crítico de alagamento'],
    future: ['Sensores de nível de porão', 'Portas e válvulas estanques entre compartimentos', 'Controle de avarias'],
    relations: ['Pressão externa → taxa de alagamento', 'Alagamento → massa/CG → dinâmica'],
    live: (e) => e.vessel.compartments.map((c) => `${c.name}: ${fmtMass(e.state.flooding[c.id].water)}`),
  },
  {
    id: 'est',
    name: 'Integridade estrutural (conceitual)',
    status: 'PARCIAL',
    phase: 'Fase 1 (indicadores) / Fase 3',
    implemented: ['Compressibilidade do casco resistente (perda de volume com a pressão)', 'Limites fictícios de profundidade com alarmes'],
    future: ['Índice de carregamento estrutural e ciclos de fadiga', 'Efeito da temperatura'],
    relations: ['Profundidade → pressão → volume do casco → empuxo'],
    live: (e) => [`Profundidade / limite de teste: ${fmt((e.outputs.depthKeel / e.vessel.limits.testDepth) * 100, 0)} %`, `Perda de volume: ${fmt(e.vessel.hull.compressibility * e.env.gaugePressureAt(Math.max(0, e.state.body.pos.z)) * e.compressibleVolume, 3)} m³`],
  },
  { id: 'ref', name: 'Refrigeração e resfriamento', status: 'FUTURO', phase: 'Fase 3', implemented: [], future: ['Circuitos de água doce/salgada', 'Resfriamento do motor, bateria e eletrônica', 'Rejeição térmica ao mar'], relations: ['Energia → bombas de resfriamento', 'Temperatura do mar → capacidade'] },
  { id: 'atm', name: 'Atmosfera interna (O₂ e CO₂)', status: 'FUTURO', phase: 'Fase 3', implemented: [], future: ['Consumo de O₂ e produção de CO₂ pela tripulação', 'Absorvedores de CO₂ e geração/estoque de O₂', 'Pressão interna e renovação no snorkel'], relations: ['Snorkel → renovação de ar', 'Energia → equipamentos de purificação'] },
  { id: 'ven', name: 'Ventilação e climatização', status: 'FUTURO', phase: 'Fase 3', implemented: ['(Carga elétrica de habitabilidade representada como consumo fixo)'], future: ['Ventiladores e dutos por compartimento', 'Umidade e temperatura interna'], relations: ['Energia → ventilação', 'Atmosfera ↔ ventilação'] },
  { id: 'fogo', name: 'Detecção de incêndio', status: 'FUTURO', phase: 'Fase 3', implemented: [], future: ['Sensores de fumaça/temperatura por compartimento', 'Alarmes e isolamento elétrico'], relations: ['Sistema elétrico → fonte de ignição', 'Atmosfera → propagação'] },
  { id: 'esg', name: 'Esgoto e drenagem', status: 'FUTURO', phase: 'Fase 3', implemented: [], future: ['Bombas de esgoto de porão (contra a pressão do mar)', 'Tanques de dreno e descarga'], relations: ['Energia → bombas', 'Alagamento → esgoto'] },
];

const NODES: { id: string; label: string; x: number; y: number; st: Status }[] = [
  { id: 'ele', label: 'Elétrico', x: 90, y: 60, st: 'PARCIAL' },
  { id: 'hid', label: 'Hidráulica', x: 260, y: 40, st: 'PARCIAL' },
  { id: 'ar', label: 'Ar comprimido', x: 260, y: 130, st: 'PARCIAL' },
  { id: 'lastro', label: 'Lastro principal', x: 440, y: 130, st: 'IMPLEMENTADO' },
  { id: 'lemes', label: 'Lemes/válvulas', x: 440, y: 40, st: 'IMPLEMENTADO' },
  { id: 'prop', label: 'Propulsão', x: 90, y: 160, st: 'IMPLEMENTADO' },
  { id: 'comp', label: 'Compartimentos', x: 620, y: 200, st: 'PARCIAL' },
  { id: 'din', label: 'Dinâmica 6-GL', x: 620, y: 90, st: 'IMPLEMENTADO' },
  { id: 'ref', label: 'Refrigeração', x: 90, y: 250, st: 'FUTURO' },
  { id: 'atm', label: 'Atmosfera/vent.', x: 260, y: 250, st: 'FUTURO' },
  { id: 'esg', label: 'Esgoto/drenagem', x: 440, y: 250, st: 'FUTURO' },
  { id: 'fogo', label: 'Incêndio', x: 620, y: 290, st: 'FUTURO' },
];
const EDGES: [string, string][] = [
  ['ele', 'hid'],
  ['ele', 'ar'],
  ['ele', 'prop'],
  ['hid', 'lemes'],
  ['ar', 'lastro'],
  ['lastro', 'din'],
  ['lemes', 'din'],
  ['prop', 'din'],
  ['comp', 'din'],
  ['ele', 'ref'],
  ['ele', 'atm'],
  ['esg', 'comp'],
  ['ele', 'esg'],
  ['fogo', 'comp'],
];

const COLOR: Record<Status, string> = { IMPLEMENTADO: '#3ddc84', PARCIAL: '#f5b041', FUTURO: '#5a6f86' };

export function AuxSystemsScreen() {
  const e = useSim(2);
  const pos = Object.fromEntries(NODES.map((n) => [n.id, n]));
  return (
    <div className="grid g2">
      <Panel title="Arquitetura de sistemas e interligações" className="span-all">
        <WideDiagram minWidth={600}>
          <svg viewBox="0 0 720 320" className="svgbox">
            {EDGES.map(([a, b], i) => (
              <line key={i} x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} stroke="#2c4260" strokeWidth="2" strokeDasharray={pos[a].st === 'FUTURO' || pos[b].st === 'FUTURO' ? '5 4' : undefined} />
            ))}
            {NODES.map((n) => (
              <g key={n.id}>
                <rect x={n.x - 62} y={n.y - 17} width="124" height="34" rx="6" fill="#111b26" stroke={COLOR[n.st]} strokeWidth="1.6" strokeDasharray={n.st === 'FUTURO' ? '5 4' : undefined} />
                <text x={n.x} y={n.y - 1} textAnchor="middle" fontSize="11.5" fill="#d8e4f0">
                  {n.label}
                </text>
                <text x={n.x} y={n.y + 11} textAnchor="middle" fontSize="8.5" fill={COLOR[n.st]}>
                  {n.st}
                </text>
              </g>
            ))}
          </svg>
        </WideDiagram>
        <div className="note">Todos os módulos compartilham o mesmo estado físico central. Novos sistemas são adicionados como módulos que leem/escrevem nesse estado e registram suas cargas elétricas, consumos e massas.</div>
      </Panel>
      {MODULES.map((m) => (
        <Panel key={m.id} title={m.name} tag={<span className={`badge ${m.status === 'FUTURO' ? 'off' : m.status === 'PARCIAL' ? 'warn' : 'ok'}`}>{m.status}</span>}>
          <div className="subtle mb8">{m.phase}</div>
          {m.implemented.length > 0 && (
            <>
              <b>Implementado</b>
              <ul style={{ margin: '2px 0 6px', paddingLeft: 18 }}>
                {m.implemented.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          )}
          <b>
            Previsto <span className="future">FUTURO</span>
          </b>
          <ul style={{ margin: '2px 0 6px', paddingLeft: 18 }}>
            {m.future.map((x) => (
              <li key={x} className="mutedc">
                {x}
              </li>
            ))}
          </ul>
          <b>Relações</b>
          <ul style={{ margin: '2px 0 6px', paddingLeft: 18 }}>
            {m.relations.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          {m.live && (
            <div className="row mono">
              {m.live(e).map((x) => (
                <span key={x} className="badge info">
                  {x}
                </span>
              ))}
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}
