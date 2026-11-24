/**
 * Análise › Instrutor: eventos programados (falhas e ameaças) por instante ou por condição. Os eventos ficam
 * no estado da simulação (salvos com a sessão; a janela de controle os dispara pela via normal de comandos).
 */
import { useMemo, useState } from 'react';
import { cmd, useSim } from '../store';
import { Panel } from '../components/Panel';
import { ToneBadge } from '../components/StatusBits';
import { failureCatalog } from '../../sim/commands';
import type { Command } from '../../sim/commands';
import type { InstructorCond, InstructorEvent } from '../../sim/core/extState';
import { COND_LABEL } from '../../sim/systems/instructor';
import { fmt, fmtTime } from '../format';
import type { SimulationEngine } from '../../sim/core/engine';

interface Choice {
  id: string;
  label: string;
  make: (e: SimulationEngine, param: string) => Command;
  param?: { label: string; def: string; unit: string };
}

/** ações além das falhas do catálogo */
const EXTRA: Choice[] = [
  {
    id: 'x:torpedo',
    label: 'Ameaça — torpedo de exercício (pela popa)',
    param: { label: 'distância', def: '5', unit: 'km' },
    make: (e, p) => ({ type: 'threat', action: 'launch', range: Number(p) * 1000, bearing: (e.outputs.euler.heading + 180) % 360, warhead: 'exercicio' }),
  },
  {
    id: 'x:torpedoA',
    label: 'Ameaça — torpedo com avaria (pela popa)',
    param: { label: 'distância', def: '4', unit: 'km' },
    make: (e, p) => ({ type: 'threat', action: 'launch', range: Number(p) * 1000, bearing: (e.outputs.euler.heading + 180) % 360, warhead: 'avaria' }),
  },
  {
    id: 'x:aircraft',
    label: 'Discrição — aeronave de patrulha',
    param: { label: 'distância', def: '25', unit: 'km' },
    make: (e, p) => ({ type: 'aircraft', action: 'spawn', range: Number(p) * 1000, bearing: (e.outputs.euler.heading + 45) % 360 }),
  },
  { id: 'x:current', label: 'Ambiente — corrente para leste', param: { label: 'velocidade', def: '1', unit: 'nós' }, make: (_e, p) => ({ type: 'current', speed: (Number(p) * 1852) / 3600, direction: 90 }) },
  { id: 'x:sea', label: 'Ambiente — estado do mar', param: { label: 'estado', def: '5', unit: '0–6' }, make: (_e, p) => ({ type: 'seaState', value: Math.max(0, Math.min(6, Math.round(Number(p)))) }) },
];

type When = 'tempo' | 'daqui' | 'condicao';

export function InstructorScreen() {
  const e = useSim(4);
  const s = e.state;
  const ins = s.instructor;
  const catalog = useMemo(() => failureCatalog(e), [e]);
  const choices: Choice[] = useMemo(
    () => [
      ...catalog.map((f) => ({
        id: f.target,
        label: `${f.group} — ${f.name}`,
        param: f.param ? { label: f.param.label, def: String(f.param.default), unit: f.param.unit } : f.modes ? { label: 'modo', def: f.modes[0], unit: f.modes.join('/') } : undefined,
        make: (_e: SimulationEngine, p: string): Command => ({ type: 'failure', target: f.target, active: true, param: f.param ? Number(p) : f.modes ? p : undefined }),
      })),
      ...EXTRA,
    ],
    [catalog],
  );
  const [choice, setChoice] = useState(choices[0]?.id ?? '');
  const ch = choices.find((c) => c.id === choice) ?? choices[0];
  const [param, setParam] = useState('');
  const [when, setWhen] = useState<When>('daqui');
  const [tval, setTval] = useState(60);
  const [cond, setCond] = useState<InstructorCond>({ variable: 'depth', op: '>', value: 80 });
  const add = (c: Choice, w: When, label?: string) => {
    const p = param || c.param?.def || '';
    const command = c.make(e, p);
    const base: Omit<InstructorEvent, 'id' | 'fired' | 'firedAt'> = { label: label ?? `${c.label}${c.param ? ` (${p} ${c.param.unit})` : ''}`, command };
    if (w === 'tempo') base.at = tval;
    else if (w === 'daqui') base.at = s.t + tval;
    else base.cond = { ...cond };
    cmd({ type: 'instructor', action: 'add', event: base });
  };
  const pack = () => {
    const at = (dt: number, target: string, label: string, p?: number) => cmd({ type: 'instructor', action: 'add', event: { label, at: s.t + dt, command: { type: 'failure', target, active: true, param: p } } });
    at(60, 'pump:trim', 'Falha da bomba de trim (+60 s)');
    cmd({
      type: 'instructor',
      action: 'add',
      event: { label: 'Leme de ré travado ao passar de 80 m', cond: { variable: 'depth', op: '>', value: 80 }, command: { type: 'failure', target: 'surface:stern', active: true } },
    });
    at(300, 'fire:CM', 'Incêndio na praça de máquinas (+5 min)', 5);
    at(420, 'flooding:CM', 'Alagamento na praça de máquinas (+7 min)', 10);
  };
  if (!ins) return <div className="panel">Instrutor indisponível.</div>;
  return (
    <div className="grid">
      <Panel title="Programar evento" className="span-all">
        <div className="btnrow">
          <label className="p3-field p3-wide">
            evento
            <select value={ch?.id} onChange={(ev) => (setChoice(ev.target.value), setParam(''))}>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {ch?.param && (
            <label className="p3-field">
              {ch.param.label} <input value={param || ch.param.def} onChange={(ev) => setParam(ev.target.value)} style={{ width: 90 }} /> {ch.param.unit}
            </label>
          )}
        </div>
        <div className="btnrow">
          <div className="seg">
            {(
              [
                ['daqui', 'Daqui a'],
                ['tempo', 'No instante'],
                ['condicao', 'Quando'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={when === k ? 'on' : ''} onClick={() => setWhen(k)}>
                {l}
              </button>
            ))}
          </div>
          {when !== 'condicao' ? (
            <label className="p3-field">
              <input type="number" value={tval} min={0} step={10} onChange={(ev) => setTval(Number(ev.target.value))} /> s{when === 'tempo' ? ' (tempo de simulação)' : ''}
            </label>
          ) : (
            <span className="p3-field">
              <select value={cond.variable} onChange={(ev) => setCond({ ...cond, variable: ev.target.value as InstructorCond['variable'] })}>
                {(Object.keys(COND_LABEL) as InstructorCond['variable'][]).map((k) => (
                  <option key={k} value={k}>
                    {COND_LABEL[k]}
                  </option>
                ))}
              </select>
              <select value={cond.op} onChange={(ev) => setCond({ ...cond, op: ev.target.value as '>' | '<' })}>
                <option value=">">maior que</option>
                <option value="<">menor que</option>
              </select>
              <input type="number" value={cond.value} onChange={(ev) => setCond({ ...cond, value: Number(ev.target.value) })} />
            </span>
          )}
          <button className="btn instr" onClick={() => ch && add(ch, when)}>
            Programar
          </button>
          <button className="btn instr" onClick={pack} title="Falha da bomba de trim, leme de ré travado a 80 m, incêndio e alagamento na praça de máquinas">
            Pacote de treinamento
          </button>
        </div>
        <p className="subtle">
          Os eventos são avaliados a cada passo pela janela de controle e aplicados como comandos com a origem “instrutor” (histórico, gravação e todas as janelas). Um evento dispara uma vez; “Rearmar” permite repetir.
          Para retirar a falha depois, use Segurança › Injeção de falhas.
        </p>
      </Panel>
      <Panel
        title={`Eventos programados (${ins.events.length})`}
        className="span-all"
        right={
          ins.events.length ? (
            <button className="btn sm instr" onClick={() => cmd({ type: 'instructor', action: 'clear' })}>
              Remover todos
            </button>
          ) : undefined
        }
      >
        {ins.events.length === 0 ? (
          <p className="subtle">Nenhum evento programado.</p>
        ) : (
          <div className="p3-scroll">
            <table className="t p3-table">
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Gatilho</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ins.events.map((ev) => (
                  <tr key={ev.id}>
                    <td>{ev.label}</td>
                    <td>
                      {ev.at !== undefined && `t ≥ ${fmtTime(ev.at)}`}
                      {ev.at !== undefined && ev.cond && ' e '}
                      {ev.cond && `${COND_LABEL[ev.cond.variable]} ${ev.cond.op} ${fmt(ev.cond.value, 1)}`}
                    </td>
                    <td>
                      {ev.fired ? (
                        <ToneBadge tone="warn" text={`DISPARADO em ${fmtTime(ev.firedAt ?? 0)}`} />
                      ) : (
                        <span className="badge info">● AGUARDANDO{ev.at !== undefined && ev.at > s.t ? ` (${fmt(ev.at - s.t, 0)} s)` : ''}</span>
                      )}
                    </td>
                    <td>
                      <span className="btnrow">
                        {ev.fired && (
                          <button className="btn sm instr" onClick={() => cmd({ type: 'instructor', action: 'rearm', id: ev.id })}>
                            Rearmar
                          </button>
                        )}
                        <button className="btn sm instr" onClick={() => cmd({ type: 'instructor', action: 'remove', id: ev.id })}>
                          Remover
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
