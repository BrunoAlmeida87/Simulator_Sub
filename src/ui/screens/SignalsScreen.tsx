/**
 * Tela SINALIZAÇÃO & EMERGÊNCIA — sinais pirotécnicos de cor, fumaça, luz + fumaça, estrela com paraquedas e a boia
 * de emergência (valores fictícios; as denominações são classificações do simulador, não códigos navais).
 *
 * Seções: A estado do sistema · B seleção do dispositivo (com prévia 3D do modelo real e do painel) · C controle de
 * lançamento (selecionar → preparar → liberar com confirmação; cancelar; reset) · D inventário (manutenção) ·
 * E sinais ativos (acompanhar pela câmera) · F boia de emergência · G falhas de treinamento (F01–F07, as mesmas do
 * catálogo da tela Segurança) · H registro de eventos (relógio da simulação) · vista 3D com as câmeras da sinalização.
 * Tudo passa por comandos ('signal', 'failure'); a física fica em src/sim/systems/signals.ts e o desenho em
 * src/render3d/SignalVis.ts (a cena só lê o estado).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import './SignalsScreen.css';
import { cmd, useSim } from '../store';
import { Panel } from '../components/Panel';
import { Scene3D } from '../components/Scene3D';
import { usePersisted } from '../persist';
import { fmtTime } from '../format';
import type { SignalColor, SignalKind } from '../../sim/config/types';
import type { LauncherState, SignalRun } from '../../sim/core/state';
import { SIGNAL_FAULTS, SIGNAL_INFO, SIGNAL_KINDS, inUse, signalLabel, signalLight, signalLive, signalSmoke, signalsCfg, signalsStatus, type SystemStatus } from '../../sim/systems/signals';
import type { ViewMode } from '../../render3d/SubmarineScene';
import { defaultLayers, type SceneLayers } from '../../render3d/layers';
import { SIGNAL_RGB, preloadSignal, signalLoadFailures } from '../../render3d/SignalVis';
import { SignalPreview } from '../../render3d/SignalPreview';

const COLOR_TXT: Record<SignalColor, string> = { vermelho: 'vermelho', amarelo: 'amarelo', verde: 'verde', branco: 'branco', laranja: 'laranja' };
const hex = (c: SignalColor) => '#' + SIGNAL_RGB[c].toString(16).padStart(6, '0');

/** estado → badge (forma + texto + cor, como nos alarmes) */
const STATUS_BADGE: Record<SystemStatus, [string, string]> = {
  PRONTO: ['ok', '●'],
  ATIVO: ['info', '◆'],
  DEGRADADO: ['warn', '▲'],
  FALHA: ['alarm', '⬢'],
  INDISPONÍVEL: ['off', '■'],
};
const LAUNCHER_TXT: Record<LauncherState, string> = {
  ocioso: 'OCIOSO',
  selecionado: 'SELECIONADO',
  preparando: 'PREPARANDO',
  pronto: 'PRONTO',
  liberado: 'LIBERADO',
  falha: 'FALHA',
  cancelado: 'CANCELADO',
};
const FLOW: LauncherState[] = ['ocioso', 'selecionado', 'preparando', 'pronto', 'liberado'];

/** fase de um dispositivo (a boia tem nomes próprios) → texto e badge */
function phaseOf(r: SignalRun): [string, string] {
  if (r.kind === 'boia') {
    if (r.phase === 'liberado') return ['LIBERADA', 'info'];
    if (r.phase === 'subindo') return ['SUBINDO', 'info'];
    if (r.phase === 'superficie') return ['FLUTUANDO', 'info'];
    if (r.phase === 'ativo') return r.tx === 'ok' ? ['TRANSMITINDO', 'ok'] : ['FLUTUANDO · TX FALHA', 'warn'];
    return ['FALHA', 'alarm'];
  }
  switch (r.phase) {
    case 'liberado':
      return ['LIBERADO', 'info'];
    case 'subindo':
      return ['SUBINDO', 'info'];
    case 'superficie':
      return ['NA SUPERFÍCIE', 'info'];
    case 'ativo':
      return ['ATIVO', 'ok'];
    case 'extinto':
      return ['EXTINTO', 'off'];
    case 'falha':
      return [`FALHA (${r.fault ?? '—'})`, 'alarm'];
  }
}

const SHAPE: Record<string, string> = { ok: '●', info: '◆', warn: '▲', alarm: '⬢', off: '■' };
const Badge = ({ txt, tone }: { txt: string; tone: string }) => (
  <span className={`badge ${tone}`}>
    {SHAPE[tone] ?? ''} {txt}
  </span>
);
const Swatch = ({ c, title }: { c: SignalColor; title?: string }) => <span className="sg-sw" style={{ background: hex(c) }} title={title ?? COLOR_TXT[c]} aria-hidden />;

/** posição de um dispositivo em relação ao submarino: profundidade/altura, distância e marcação */
function where(r: SignalRun, own: { x: number; y: number }): string {
  const dn = r.n - own.x;
  const de = r.e - own.y;
  const dist = Math.hypot(dn, de);
  const brg = ((Math.atan2(de, dn) * 180) / Math.PI + 360) % 360;
  const v = r.flare && r.flare.alt > 1 ? `${r.flare.alt.toFixed(0)} m de altura` : r.d > 0.6 ? `${r.d.toFixed(0)} m de prof.` : 'superfície';
  return `${v} · ${dist.toFixed(0)} m · ${brg.toFixed(0).padStart(3, '0')}°`;
}

export function SignalsScreen() {
  const e = useSim(8);
  const s = e.state;
  const ss = s.signals;
  const cfg = signalsCfg(e.vessel);
  const [sel, setSel] = usePersisted<SignalKind>('sinal.sel', 'vermelho');
  const [colorPick, setColorPick] = usePersisted<Partial<Record<SignalKind, SignalColor>>>('sinal.cores', {});
  const [view, setView] = usePersisted<ViewMode>('sinal.vista', 'sinal');
  const [camKey, setCamKey] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  const [scale, setScale] = usePersisted('sinal.escala', 1);
  const [lay, setLay] = usePersisted<Partial<SceneLayers>>('sinal.camadas', { signalTracks: true });
  const [confirm, setConfirm] = useState(false);
  const [logFrom, setLogFrom] = usePersisted('sinal.logDesde', -1);
  const [sceneH, setSceneH] = usePersisted('sinal.alturaVista3d', 460);
  const L = ss?.launcher;
  const info = SIGNAL_INFO[sel];
  const color: SignalColor = colorPick[sel] && info.colors.includes(colorPick[sel]!) ? colorPick[sel]! : info.colors[0];
  // o lançador mostra o que ele tem; senão o que está escolhido na lista
  const lk = L?.kind ?? null;
  useEffect(() => preloadSignal(sel, color), [sel, color]);
  // confirmação da liberação expira sozinha
  useEffect(() => {
    if (!confirm) return;
    const id = window.setTimeout(() => setConfirm(false), 6000);
    return () => window.clearTimeout(id);
  }, [confirm]);
  useEffect(() => {
    if (L?.state !== 'pronto') setConfirm(false);
  }, [L?.state]);
  const layers = useMemo<Partial<SceneLayers>>(() => ({ ...defaultLayers(), torpedoes: true, wake: true, ...lay, signals: true, signalScale: scale, signalFocus: focus }), [lay, scale, focus]);
  if (!ss || !L) return <div className="note">Sistema de sinalização indisponível neste estado.</div>;

  const depth = s.body.pos.z;
  const st = signalsStatus(ss, depth, cfg);
  const total = SIGNAL_KINDS.reduce((a, k) => a + (ss.inventory[k] ?? 0), 0);
  const live = ss.runs.filter(signalLive);
  const events = s.commands.filter((c) => c.group === 'Sinalização' && c.t >= logFrom);
  const lastEv = events[events.length - 1];
  const faultsOn = SIGNAL_FAULTS.filter((f) => ss.faults[f.id]);
  const buoy = ss.runs.find((r) => r.kind === 'boia') ?? null;
  const busy = L.state === 'preparando' || L.state === 'pronto';
  const deep = depth > cfg.maxDepth;
  const prep = L.state === 'preparando' ? Math.min(1, (s.t - L.t) / cfg.prepareTime) : L.state === 'pronto' ? 1 : 0;
  const shownKind = busy || L.state === 'liberado' || L.state === 'falha' ? (lk ?? sel) : sel;
  const failures = signalLoadFailures();

  const signal = (action: 'select' | 'prepare' | 'release' | 'cancel' | 'reset' | 'restock' | 'stock' | 'clear', extra?: { kind?: SignalKind; color?: SignalColor; count?: number }) =>
    cmd({ type: 'signal', action, ...extra });
  const follow = (id: string | null, v: ViewMode) => {
    setFocus(id);
    setView(v);
    setCamKey((k) => k + 1);
  };

  // ------------------------------------------------------------------ A — estado do sistema
  const [tone, shape] = STATUS_BADGE[st.status];
  const hero = (
    <section className="sg-hero">
      <div className="sg-title">
        <h2>Sinalização &amp; Emergência</h2>
        <span className="subtle">sinais pirotécnicos fictícios de simulação · lançador atrás da vela · boia no convés de ré</span>
      </div>
      <div className="sg-status">
        <div className="sg-st-main">
          <span className={`badge ${tone} sg-big`}>
            {shape} {st.status}
          </span>
          <span className="subtle">{st.why}</span>
        </div>
        <dl className="sg-kv">
          <div>
            <dt>Sinalização</dt>
            <dd>{deep ? `indisponível abaixo de ${cfg.maxDepth} m` : L.state === 'falha' ? 'bloqueada (reset)' : 'disponível'}</dd>
          </div>
          <div>
            <dt>A bordo</dt>
            <dd>{total}</dd>
          </div>
          <div>
            <dt>Ativos</dt>
            <dd>{live.length}</dd>
          </div>
          <div>
            <dt>Falhas</dt>
            <dd>{faultsOn.length ? faultsOn.map((f) => f.code).join(' ') : 'nenhuma'}</dd>
          </div>
          <div className="sg-kv-wide">
            <dt>Último evento</dt>
            <dd>{lastEv ? `[${fmtTime(lastEv.t)}] ${lastEv.text}` : '—'}</dd>
          </div>
        </dl>
      </div>
    </section>
  );

  // ------------------------------------------------------------------ B — seleção
  const selection = (
    <Panel title="Seleção do dispositivo" tag={<span className="subtle panel-val">{signalLabel(sel, color)}</span>}>
      <div className="sg-cards" role="listbox" aria-label="Dispositivos">
        {SIGNAL_KINDS.map((k) => {
          const i = SIGNAL_INFO[k];
          const c = colorPick[k] && i.colors.includes(colorPick[k]!) ? colorPick[k]! : i.colors[0];
          const n = ss.inventory[k] ?? 0;
          return (
            <button
              key={k}
              role="option"
              aria-selected={sel === k}
              className={`sg-card ${sel === k ? 'on' : ''} ${n === 0 ? 'empty' : ''} ${lk === k && L.state !== 'ocioso' ? 'loaded' : ''}`}
              onClick={() => setSel(k)}
              title={i.desc}
            >
              <Swatch c={k === 'combinado' ? 'laranja' : c} />
              <span className="sg-card-name">{i.short}</span>
              <span className="sg-card-sub">{i.meaning}</span>
              <span className="sg-card-n">{n === 0 ? 'esgotado' : `${n} a bordo`}</span>
            </button>
          );
        })}
      </div>
      <div className="sg-sel">
        <div className="sg-sel-info">
          <h4>{info.name}</h4>
          <p>{info.desc}</p>
          {info.colors.length > 1 && (
            <div className="sg-colors">
              <span className="subtle">Cor:</span>
              {info.colors.map((c) => (
                <button key={c} className={`sg-color ${c === color ? 'on' : ''}`} onClick={() => setColorPick({ ...colorPick, [sel]: c })} aria-pressed={c === color}>
                  <Swatch c={c} /> {COLOR_TXT[c]}
                </button>
              ))}
            </div>
          )}
          <p className="subtle">
            A bordo: <b>{ss.inventory[sel] ?? 0}</b> · em uso: <b>{inUse(ss, sel)}</b> · estado:{' '}
            {(ss.inventory[sel] ?? 0) === 0 ? (
              <Badge txt="ESGOTADO" tone="warn" />
            ) : lk === sel && L.state !== 'ocioso' ? (
              <Badge txt={LAUNCHER_TXT[L.state]} tone={L.state === 'falha' ? 'alarm' : L.state === 'pronto' ? 'ok' : 'info'} />
            ) : (
              <Badge txt="DISPONÍVEL" tone="ok" />
            )}
          </p>
          <p className="sg-legal subtle">Classificação do simulador; não representa códigos de sinalização naval reais.</p>
        </div>
        <Preview kind={shownKind} color={shownKind === sel ? color : (L.color ?? color)} launcher={L.state} active={live.length > 0} buoy={!!buoy} fault={!!faultsOn.length || ss.runs.some((r) => r.phase === 'falha')} />
      </div>
      {failures.length > 0 && <p className="sg-warnline">Modelos 3D não encontrados: {failures.join(', ')} (rodar npm run sinalizacao:assets).</p>}
    </Panel>
  );

  // ------------------------------------------------------------------ C — controle de lançamento
  const canSelect = !busy && L.state !== 'falha' && (ss.inventory[sel] ?? 0) > 0 && !(L.kind === sel && L.color === color && L.state === 'selecionado');
  const control = (
    <Panel title="Controle de lançamento" tag={<span className="subtle panel-val">{fmtTime(s.t)}</span>}>
      <ol className="sg-flow" aria-label="Sequência do lançador">
        {FLOW.map((f, i) => {
          const cur = FLOW.indexOf(L.state);
          const cls = L.state === f ? 'cur' : cur > i ? 'done' : '';
          return (
            <li key={f} className={cls}>
              {LAUNCHER_TXT[f]}
            </li>
          );
        })}
        {(L.state === 'falha' || L.state === 'cancelado') && <li className={`cur ${L.state === 'falha' ? 'bad' : ''}`}>{LAUNCHER_TXT[L.state]}</li>}
      </ol>
      <div className="sg-loaded">
        No lançador: <b>{L.kind ? signalLabel(L.kind, L.color) : '—'}</b>
        {L.kind && L.color && <Swatch c={L.kind === 'combinado' ? 'laranja' : L.color} />}
        <span className="subtle">
          {' '}
          · profundidade {depth.toFixed(0)} m (máx. de liberação {cfg.maxDepth} m)
        </span>
      </div>
      <div className="sg-prog" aria-hidden>
        <span style={{ width: `${prep * 100}%` }} />
      </div>
      <div className="sg-btns">
        <button className="wx-big" disabled={!canSelect} onClick={() => signal('select', { kind: sel, color })} title={`Selecionar ${signalLabel(sel, color)} no lançador`}>
          SELECIONAR
        </button>
        <button
          className="wx-big go"
          disabled={L.state !== 'selecionado' || deep || !L.kind || (ss.inventory[L.kind] ?? 0) === 0}
          onClick={() => signal('prepare')}
          title={`Preparar o dispositivo selecionado (${cfg.prepareTime} s)`}
        >
          PREPARAR
        </button>
        {!confirm ? (
          <button className="wx-big fire" disabled={L.state !== 'pronto'} onClick={() => setConfirm(true)} title="Liberar o dispositivo (pede confirmação)">
            LIBERAR
          </button>
        ) : (
          <button
            className="wx-big fire sg-confirm"
            onClick={() => {
              setConfirm(false);
              signal('release');
            }}
            title="Confirma a liberação"
          >
            CONFIRMAR LIBERAÇÃO
          </button>
        )}
        <button className="wx-big" disabled={!busy && !confirm} onClick={() => (confirm ? setConfirm(false) : signal('cancel'))} title="Cancelar a preparação (ou a confirmação)">
          CANCELAR
        </button>
        <button className="wx-big" disabled={L.state === 'ocioso' || busy} onClick={() => signal('reset')} title="Reset do lançador: volta a ocioso (necessário após uma falha de liberação)">
          RESET
        </button>
      </div>
      {confirm && (
        <p className="sg-confirm-note">
          Confirme em até 6 s: {L.kind ? signalLabel(L.kind, L.color) : ''} será liberado a {depth.toFixed(0)} m.
        </p>
      )}
      {deep && <p className="sg-warnline">▲ Abaixo da profundidade máxima de liberação: subir para menos de {cfg.maxDepth} m.</p>}
    </Panel>
  );

  // ------------------------------------------------------------------ D — inventário
  const inventory = (
    <Panel title="Inventário">
      <div className="scroll">
        <table className="t sg-inv">
          <thead>
            <tr>
              <th>Dispositivo</th>
              <th className="num">A bordo</th>
              <th className="num">Em uso</th>
              <th>Estado</th>
              <th className="sg-maint-col">Manutenção</th>
            </tr>
          </thead>
          <tbody>
            {SIGNAL_KINDS.map((k) => {
              const n = ss.inventory[k] ?? 0;
              const u = inUse(ss, k);
              const tn = n === 0 ? ['ESGOTADO', 'warn'] : u > 0 ? ['EM USO', 'info'] : ['PRONTO', 'ok'];
              return (
                <tr key={k} className={sel === k ? 'sel' : ''} onClick={() => setSel(k)}>
                  <td>
                    <Swatch c={k === 'combinado' || k === 'boia' ? 'laranja' : SIGNAL_INFO[k].colors[0]} /> {SIGNAL_INFO[k].name}
                  </td>
                  <td className="num">{n}</td>
                  <td className="num">{u}</td>
                  <td>
                    <Badge txt={tn[0]} tone={tn[1]} />
                  </td>
                  <td className="sg-maint-col">
                    <button className="btn sm instr" onClick={(ev) => (ev.stopPropagation(), signal('stock', { kind: k, count: n - 1 }))} disabled={n === 0} title="Retirar um (manutenção)">
                      −
                    </button>{' '}
                    <button className="btn sm instr" onClick={(ev) => (ev.stopPropagation(), signal('stock', { kind: k, count: n + 1 }))} title="Acrescentar um (manutenção)">
                      +
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="sg-row">
        <button className="btn instr" onClick={() => signal('restock')} title={`Repor o inventário da configuração (${SIGNAL_KINDS.map((k) => `${SIGNAL_INFO[k].short} ${cfg.stock[k]}`).join(', ')}) e recolher a boia`}>
          Reabastecer (manutenção)
        </button>
        <span className="subtle">Ações do instrutor. Reiniciar o cenário também repõe o inventário.</span>
      </div>
    </Panel>
  );

  // ------------------------------------------------------------------ E — sinais ativos
  const active = (
    <Panel title="Sinais liberados" tag={<span className="subtle panel-val">{live.length} em curso</span>}>
      {ss.runs.length === 0 ? (
        <p className="subtle empty-state">Nenhum dispositivo liberado. Selecione, prepare e libere um sinal: ele aparece aqui e na vista 3D.</p>
      ) : (
        <div className="scroll">
          <table className="t sg-runs">
            <thead>
              <tr>
                <th>ID</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th className="num">Tempo</th>
                <th>Posição</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...ss.runs].reverse().map((r) => {
                const [txt, tn] = phaseOf(r);
                const lit = signalLight(r, s.t);
                const sm = signalSmoke(r, s.t, cfg);
                return (
                  <tr key={r.id} className={focus === r.id ? 'sel' : ''}>
                    <td className="mono">{r.id}</td>
                    <td>
                      <Swatch c={r.kind === 'combinado' || r.kind === 'boia' ? 'laranja' : r.color} /> {signalLabel(r.kind, r.color)}
                    </td>
                    <td>
                      <Badge txt={txt} tone={tn} />
                      {r.phase === 'ativo' && r.kind !== 'boia' && (
                        <span className="subtle sg-fx">
                          {lit > 0.01 ? ` luz ${(lit * 100).toFixed(0)}%` : ''}
                          {sm > 0.01 ? ` fumaça ${(sm * 100).toFixed(0)}%` : ''}
                        </span>
                      )}
                    </td>
                    <td className="num">{fmtTime(s.t - r.tRel).slice(3)}</td>
                    <td className="sg-pos">{where(r, s.body.pos)}</td>
                    <td>
                      <button className="btn sm" onClick={() => follow(r.id, r.kind === 'boia' ? 'boia' : 'sinal')} title="Acompanhar este dispositivo na vista 3D">
                        Acompanhar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {ss.runs.some((r) => !signalLive(r)) && (
        <button className="btn sm" onClick={() => signal('clear')} title="Tirar da lista os dispositivos extintos ou em falha">
          Retirar encerrados
        </button>
      )}
    </Panel>
  );

  // ------------------------------------------------------------------ F — boia
  const buoyState = buoy ? phaseOf(buoy) : (ss.inventory.boia ?? 0) > 0 ? (L.kind === 'boia' && L.state === 'falha' ? ['NÃO LIBEROU', 'alarm'] : ['ESTIVADA', 'ok']) : ['SEM BOIA', 'off'];
  const buoyPanel = (
    <Panel title="Boia de emergência">
      <dl className="sg-kv sg-kv-cols">
        <div>
          <dt>Estado</dt>
          <dd>
            <Badge txt={buoyState[0]} tone={buoyState[1]} />
          </dd>
        </div>
        <div>
          <dt>Disponível</dt>
          <dd>{(ss.inventory.boia ?? 0) > 0 ? `sim (${ss.inventory.boia})` : 'não'}</dd>
        </div>
        <div>
          <dt>Liberação</dt>
          <dd>{buoy ? `há ${fmtTime(s.t - buoy.tRel).slice(3)}` : L.kind === 'boia' ? LAUNCHER_TXT[L.state].toLowerCase() : 'não liberada'}</dd>
        </div>
        <div>
          <dt>Posição</dt>
          <dd>{buoy ? where(buoy, s.body.pos) : 'no alojamento (convés de ré)'}</dd>
        </div>
        <div>
          <dt>Luz</dt>
          <dd>{buoy?.phase === 'ativo' ? 'PISCANDO' : 'apagada'}</dd>
        </div>
        <div>
          <dt>Transmissão (fictícia)</dt>
          <dd>{buoy?.tx === 'ok' ? <Badge txt="ATIVA" tone="ok" /> : buoy?.tx === 'falha' ? <Badge txt="FALHA" tone="alarm" /> : '—'}</dd>
        </div>
      </dl>
      <div className="sg-row">
        <button className="btn" onClick={() => setSel('boia')} disabled={sel === 'boia'} title="Escolher a boia na seleção (depois: selecionar, preparar e liberar)">
          Escolher a boia
        </button>
        <button className="btn" onClick={() => follow(buoy?.id ?? null, 'boia')} disabled={!buoy} title="Acompanhar a boia na vista 3D">
          Acompanhar a boia
        </button>
      </div>
    </Panel>
  );

  // ------------------------------------------------------------------ G — falhas
  const faults = (
    <Panel title="Falhas de treinamento" tag={<span className="subtle panel-val">{faultsOn.length} ativas</span>}>
      <ul className="sg-faults">
        {SIGNAL_FAULTS.map((f) => {
          const on = !!ss.faults[f.id];
          return (
            <li key={f.id}>
              <button className={`btn sm instr ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => cmd({ type: 'failure', target: `signal:${f.id}`, active: !on })}>
                {on ? 'Remover' : 'Injetar'}
              </button>
              <b>{f.code}</b> {f.name}
              {on && <Badge txt="ATIVA" tone="warn" />}
              <span className="subtle sg-fault-eff">{f.effect}</span>
            </li>
          );
        })}
      </ul>
      <p className="subtle">Ações do instrutor. As mesmas falhas aparecem em Segurança › Injeção de falhas.</p>
    </Panel>
  );

  // ------------------------------------------------------------------ H — eventos
  const log = (
    <Panel
      title="Registro de eventos"
      right={
        <button className="btn sm" onClick={() => setLogFrom(s.t)} title="Esconder os eventos anteriores (o histórico completo continua em Análise › Histórico)">
          Limpar
        </button>
      }
    >
      <EventLog lines={events.slice(-200).map((c) => ({ t: c.t, text: c.text }))} />
      {logFrom > 0 && (
        <button className="btn sm" onClick={() => setLogFrom(-1)}>
          Mostrar todos
        </button>
      )}
    </Panel>
  );

  // ------------------------------------------------------------------ vista 3D
  const flare = [...ss.runs].reverse().find((r) => r.flare);
  const tog = (k: keyof SceneLayers, label: string, title: string) => (
    <button className={`wx-tog ${layers[k] ? 'on' : ''}`} aria-pressed={!!layers[k]} onClick={() => setLay({ ...lay, [k]: !layers[k] })} title={title}>
      {label}
    </button>
  );
  const view3d = (
    <Panel title="Vista 3D" className="sg-3d">
      <div className="wx-cams">
        {(
          [
            ['sinal', 'Acompanhar sinal', null],
            ['sinalSuperficie', 'Superfície', null],
            ['estrela', 'Estrela', flare?.id ?? null],
            ['boia', 'Boia', buoy?.id ?? null],
            ['perseguicao', 'Voltar ao submarino', null],
          ] as [ViewMode | 'estrela', string, string | null][]
        ).map(([id, label, fid]) => {
          const starOn = view === 'sinal' && !!flare && focus === flare.id;
          const on = id === 'estrela' ? starOn : view === id && !(id === 'sinal' && starOn);
          return (
            <button key={id} className={on ? 'on' : ''} disabled={(id === 'estrela' && !flare) || (id === 'boia' && !buoy)} onClick={() => follow(fid, id === 'estrela' ? 'sinal' : id)}>
              {label}
            </button>
          );
        })}
      </div>
      <div className="wx-toggles">
        {tog('signalSmoke', 'Fumaça', 'Fumaça colorida')}
        {tog('signalLights', 'Luzes', 'Luzes, halos e clarões')}
        {tog('signalBubbles', 'Bolhas', 'Bolhas, respingos, anel e espuma')}
        {tog('signalTracks', 'Trajetória', 'Linha da subida')}
        {tog('labels', 'Identificações', 'Rótulos dos dispositivos')}
        <span className="sg-scale">
          Ampliar desenho:
          {[1, 5, 15].map((k) => (
            <button key={k} className={`wx-tog ${scale === k ? 'on' : ''}`} onClick={() => setScale(k)} aria-pressed={scale === k} title={k === 1 ? 'Tamanho real' : `Desenho ${k}× maior (a física não muda)`}>
              {k}×
            </button>
          ))}
        </span>
      </div>
      <Scene3D view={view} viewKey={camKey} layers={layers} persistKey="sinalizacao" className="sg-view" style={{ height: sceneH, position: 'relative' }} />
      <div className="sg-row">
        <span className="subtle">Arraste para girar em volta do sinal (a câmera continua acompanhando), roda para aproximar. Tamanho real: 0,4 a 1 m — use “Ampliar desenho” em apresentações.</span>
        <span className="sg-hsel">
          Altura{' '}
          {[320, 460, 640].map((h) => (
            <button key={h} className={`wx-tog ${sceneH === h ? 'on' : ''}`} onClick={() => setSceneH(h)}>
              {h === 320 ? 'P' : h === 460 ? 'M' : 'G'}
            </button>
          ))}
        </span>
      </div>
    </Panel>
  );

  return (
    <div className="signals-screen">
      {hero}
      <div className="sg-grid">
        <div className="sg-col">
          {selection}
          {control}
          {inventory}
        </div>
        <div className="sg-col">
          {view3d}
          {active}
          {buoyPanel}
        </div>
      </div>
      <div className="sg-grid sg-grid-b">
        {faults}
        {log}
      </div>
    </div>
  );
}

/** registro com rolagem automática para o fim (a menos que o operador tenha rolado para cima) */
function EventLog({ lines }: { lines: { t: number; text: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  if (!lines.length) return <p className="subtle empty-state">Sem eventos. Os eventos da sinalização aparecem aqui com o horário da simulação.</p>;
  return (
    <div
      ref={ref}
      className="sg-log"
      onScroll={(ev) => {
        const el = ev.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {lines.map((l, i) => (
        <div key={i}>
          <span className="mono">[{fmtTime(l.t)}]</span> {l.text}
        </div>
      ))}
    </div>
  );
}

/** prévia 3D do dispositivo e do painel (GLBs reais); sem WebGL fica só o texto */
function Preview(p: { kind: SignalKind; color: SignalColor; launcher: LauncherState; active: boolean; buoy: boolean; fault: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const pv = useRef<SignalPreview | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  useEffect(() => {
    if (!host.current) return;
    let x: SignalPreview | null = null;
    try {
      x = new SignalPreview(host.current);
    } catch {
      return;
    }
    x.onMissing = (f) => setMissing([...f]);
    pv.current = x;
    return () => {
      x?.dispose();
      pv.current = null;
    };
  }, []);
  useEffect(() => pv.current?.set({ kind: p.kind, color: p.color, launcher: p.launcher, active: p.active, buoy: p.buoy, fault: p.fault }), [p.kind, p.color, p.launcher, p.active, p.buoy, p.fault]);
  return (
    <div className="sg-preview" title="Prévia 3D: painel de sinalização e o dispositivo (arraste para girar)">
      <div ref={host} className="sg-preview-host" />
      <span className="sg-preview-cap">{missing.length ? `modelo ausente: ${missing.join(', ')}` : 'prévia 3D · arraste para girar'}</span>
    </div>
  );
}
