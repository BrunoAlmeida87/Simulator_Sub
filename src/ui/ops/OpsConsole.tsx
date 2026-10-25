/**
 * CONSOLE INFERIOR da tela Operação: propulsão (telégrafo), governo (lemes),
 * pilotos automáticos e manobras rápidas — o que se mexe a cada minuto. Cada
 * canal mostra quem o comanda (OPERADOR, PILOTO ou MANOBRA). Também aqui: o
 * aviso de troca de comando (toque manual que desliga o piloto) e a caixa do
 * sopro de emergência (tampa → soprar → ativo), fixa no rodapé do painel.
 * Tudo só lê o estado e envia Commands (cmd) ou chama as automações.
 */
import { useEffect, useRef, useState } from 'react';
import { cmd, runner } from '../store';
import { usePersisted } from '../persist';
import type { SimulationEngine } from '../../sim/core/engine';
import type { CommandRecord } from '../../sim/core/state';
import { TELEGRAPH } from '../components/Controls';
import { maneuver } from '../maneuvers';
import { route } from '../routeNav';
import { bankPressure, emergencyBlowActive } from '../../sim/systems/hpAir';
import { fmt, fmtTime } from '../format';
import { opsBus } from './opsBus';
import { useOpsBus } from './useOpsBus';

type Owner = 'OPERADOR' | 'PILOTO' | 'MANOBRA';
type FinId = 'bow' | 'stern' | 'rudder';
type Channel = 'heading' | 'depth' | 'pitch';

/** quem comanda cada leme agora */
export function finOwner(e: SimulationEngine, id: FinId): Owner {
  const ap = e.state.autopilot;
  // na emergida, depois de fechar os suspiros a manobra comanda os lemes diretamente
  if (maneuver.active === 'emergir' && maneuver.step >= 2 && id !== 'rudder') return 'MANOBRA';
  if (id === 'rudder') return ap.headingMode === 'AUTO' ? 'PILOTO' : 'OPERADOR';
  if (id === 'bow') return ap.depthMode === 'AUTO' ? 'PILOTO' : 'OPERADOR';
  return ap.depthMode === 'AUTO' || ap.pitchMode === 'AUTO' ? 'PILOTO' : 'OPERADOR';
}

/** automação que engajou o canal do piloto (para o selo "pela manobra"/"pela rota") */
function channelBy(e: SimulationEngine, ch: Channel): string | null {
  const ap = e.state.autopilot;
  const auto = ch === 'heading' ? ap.headingMode === 'AUTO' : ch === 'depth' ? ap.depthMode === 'AUTO' : ap.pitchMode === 'AUTO';
  if (!auto) return null;
  if (maneuver.active && (ch === 'depth' || (ch === 'heading' && maneuver.active === 'imergir'))) return 'manobra';
  if (ch === 'heading' && route.active) return 'rota';
  return null;
}

/** dono do canal; short = só o símbolo (console compacto): ⚙ piloto, ⟳ manobra — com a mesma borda e o texto na dica */
function OwnerTag({ o, short }: { o: Owner; short?: boolean }) {
  const cls = o === 'PILOTO' ? 'pi' : o === 'MANOBRA' ? 'mn' : 'op';
  const tip = o === 'PILOTO' ? 'Comandado pelo piloto automático: um toque manual passa o canal a MAN' : o === 'MANOBRA' ? 'Comandado pela manobra automática' : 'Comandado pelo operador';
  return (
    <span className={`own ${cls} ${short ? 'short' : ''}`} title={`${o}: ${tip}`} aria-label={o}>
      {short ? (o === 'PILOTO' ? '⚙' : o === 'MANOBRA' ? '⟳' : 'OP') : o}
    </span>
  );
}

/**
 * campo numérico compacto: envia no Enter ou ao sair do campo, sempre que o
 * operador digitou algo — mesmo o valor já mostrado (em MAN isso é a
 * pré-seleção da ordem); sem digitação, sair do campo não envia nada
 */
function MiniNum({ value, onSet, min, max, unit, dec = 0, label, dim }: { value: number; onSet: (v: number) => void; min: number; max: number; unit: string; dec?: number; label: string; dim?: boolean }) {
  const shown = dec ? (Math.round(value * 10) / 10).toFixed(dec) : String(Math.round(value));
  const [v, setV] = useState(shown);
  const edited = useRef(false);
  useEffect(() => setV(shown), [shown]);
  const commit = () => {
    const typed = edited.current;
    edited.current = false;
    const x = Number(v.replace(',', '.'));
    if (!typed || !Number.isFinite(x)) return setV(shown);
    onSet(Math.max(min, Math.min(max, x)));
    setV(shown);
  };
  return (
    <span className={`mini-num ${dim ? 'dim' : ''}`}>
      <input
        aria-label={label}
        inputMode="decimal"
        value={v}
        onChange={(ev) => {
          edited.current = true;
          setV(ev.target.value);
        }}
        onBlur={commit}
        onKeyDown={(ev) => ev.key === 'Enter' && (ev.currentTarget as HTMLInputElement).blur()}
      />
      <u>{unit}</u>
    </span>
  );
}

// ------------------------------------------------------------ propulsão
function PropCard({ e }: { e: SimulationEngine }) {
  const p = e.state.propulsion;
  const rated = e.vessel.propulsion.motor.ratedRpm;
  const set = (rpm: number) => cmd({ type: 'telegraph', rpm: Math.max(-rated, Math.min(rated, rpm)) });
  return (
    <section className="con-card" aria-label="Propulsão">
      <h3>
        PROPULSÃO <span className="sp" />
        <OwnerTag o="OPERADOR" />
      </h3>
      <div className="con-tel" role="group" aria-label="Telégrafo">
        {TELEGRAPH.map((t) => (
          <button key={t.label} className={`${Math.round(p.rpmCmd) === t.rpm ? 'on' : ''} ${t.rpm < 0 ? 'rev' : ''}`} onClick={() => set(t.rpm)} title={`${t.label}: ${t.rpm} rpm`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="con-rd">
        <span className="o">
          Ordem <b>{fmt(p.rpmCmd, 0)}</b>
        </span>
        <span>
          Real <b>{fmt(e.outputs.rpm, 0)}</b> rpm
        </span>
        <span className="sp" />
        <button onClick={() => set(p.rpmCmd - 10)} title="−10 rpm (tecla −)">
          −10
        </button>
        <button onClick={() => set(p.rpmCmd + 10)} title="+10 rpm (tecla +)">
          +10
        </button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------ governo
const FIN_NAME: Record<FinId, string> = { rudder: 'Direção', bow: 'Vante', stern: 'Ré' };
const FIN_KEYS: Record<FinId, string> = { rudder: 'A/D', bow: 'Q/E', stern: 'W/S' };

function finDir(id: FinId, a: number): string {
  if (Math.abs(a) < 0.5) return '';
  if (id === 'rudder') return a > 0 ? ' BE' : ' BB';
  return a > 0 ? ' ↑' : ' ↓';
}

function FinRow({ e, id }: { e: SimulationEngine; id: FinId }) {
  const st = e.state.surfaces[id];
  const max = e.vessel.fins.find((f) => f.id === id)?.maxDeflection ?? 25;
  const go = (a: number) => cmd({ type: 'surface', id, angle: Math.max(-max, Math.min(max, Math.round(a))) });
  const tipUp = id === 'rudder' ? 'boreste' : 'subir';
  const tipDn = id === 'rudder' ? 'bombordo' : 'descer';
  return (
    <div className={`con-fin ${opsBus.focusTarget?.kind === 'fin' && opsBus.focusTarget.id === id ? 'focus' : ''}`}>
      <span className="nm" title={`Teclas ${FIN_KEYS[id]}`}>
        {FIN_NAME[id]}
      </span>
      <OwnerTag o={finOwner(e, id)} />
      <button onClick={() => go(st.cmd - 5)} title={`5° ${tipDn}`}>
        −5
      </button>
      <button onClick={() => go(st.cmd - 1)} title={`1° ${tipDn}`}>
        −1
      </button>
      <button className="val" onClick={() => go(0)} title={`Ordem ${fmt(Math.abs(st.cmd), 1)}°${finDir(id, st.cmd)} · real ${fmt(Math.abs(st.actual), 1)}° · clique para zerar (±${max}°)`}>
        <b>
          {fmt(Math.abs(st.cmd), 0)}°{finDir(id, st.cmd)}
        </b>
        <span>real {fmt(Math.abs(st.actual), 0)}°</span>
      </button>
      <button onClick={() => go(st.cmd + 1)} title={`1° ${tipUp}`}>
        +1
      </button>
      <button onClick={() => go(st.cmd + 5)} title={`5° ${tipUp}`}>
        +5
      </button>
    </div>
  );
}

function GovCard({ e }: { e: SimulationEngine }) {
  return (
    <section className="con-card" aria-label="Governo">
      <h3>
        GOVERNO <span className="sp" />
        <span className="con-note">ordem · real</span>
      </h3>
      <FinRow e={e} id="rudder" />
      <FinRow e={e} id="bow" />
      <FinRow e={e} id="stern" />
      <div className="con-note">Toque num leme passa o canal do piloto a MAN · clique no valor zera</div>
    </section>
  );
}

// ------------------------------------------------------------ piloto automático
function ApRow({ e, ch }: { e: SimulationEngine; ch: Channel }) {
  const ap = e.state.autopilot;
  const mode = ch === 'heading' ? ap.headingMode : ch === 'depth' ? ap.depthMode : ap.pitchMode;
  const set = ch === 'heading' ? ap.headingSet : ch === 'depth' ? ap.depthSet : ap.pitchSet;
  const tel = ch === 'heading' ? ap.tHeading : ch === 'depth' ? ap.tDepth : ap.tPitch;
  // medido = leitura dos sensores que o piloto usa (com as falhas de sensor), coerente com o erro ao lado
  const r = e.apReadings;
  const meas = ch === 'heading' ? `${fmt(r.heading, 0)}°` : ch === 'depth' ? `${fmt(r.depth, 1)} m` : `${fmt(r.pitch, 1)}°`;
  const preset = mode === 'MANUAL' && !!ap.preset?.[ch];
  const by = channelBy(e, ch);
  const label = { heading: 'Rumo', depth: 'Profund.', pitch: 'Inclinação' }[ch];
  const lim = ch === 'heading' ? [0, 359] : ch === 'depth' ? [0, e.vessel.limits.testDepth] : [-15, 15];
  const extra =
    mode === 'AUTO'
      ? `e ${fmt(tel.error, 1)}${tel.saturated ? ' · SAT' : ''}${tel.lowEffectiveness ? ' · baixa efetiv.' : ''}`
      : ch === 'pitch' && ap.depthMode === 'AUTO'
        ? 'exclui profund.'
        : preset
          ? 'pré-seleção'
          : '';
  return (
    <div className="con-ap">
      <span>{label}</span>
      <span className="seg">
        <button className={mode === 'MANUAL' ? 'on' : ''} onClick={() => cmd({ type: 'autopilot', channel: ch, mode: 'MANUAL' })}>
          MAN
        </button>
        <button
          className={mode === 'AUTO' ? 'on' : ''}
          onClick={() => cmd({ type: 'autopilot', channel: ch, mode: 'AUTO' })}
          title={preset ? `AUTO vai para a ordem pré-selecionada (${fmt(set, ch === 'pitch' ? 1 : 0)})` : 'AUTO parte da condição atual (sem salto)'}
        >
          AUTO
        </button>
      </span>
      <MiniNum
        value={set}
        min={lim[0]}
        max={lim[1]}
        unit={ch === 'depth' ? 'm' : '°'}
        dec={ch === 'pitch' ? 1 : 0}
        label={`${label}: ordem`}
        dim={mode === 'MANUAL' && !preset}
        onSet={(v) => cmd({ type: 'setpoint', channel: ch, value: v })}
      />
      <span className="me">
        {meas}
        <span className={tel.saturated && mode === 'AUTO' ? 'w' : ''}>
          {extra}
          {by ? <i className="own mn">{by}</i> : null}
        </span>
      </span>
    </div>
  );
}

function ApCard({ e }: { e: SimulationEngine }) {
  return (
    <section className="con-card" aria-label="Piloto automático">
      <h3>
        PILOTO AUTOMÁTICO <span className="sp" />
        <span className="con-note">ordem → medido</span>
      </h3>
      <ApRow e={e} ch="heading" />
      <ApRow e={e} ch="depth" />
      <ApRow e={e} ch="pitch" />
      <div className="con-note">Ordem dada em MAN vale ao passar para AUTO; sem ela, AUTO parte da condição atual</div>
    </section>
  );
}

// ------------------------------------------------------------ manobras
/** Manter cota: cancela a manobra, zera vante e ré e liga o piloto de profundidade na cota atual */
function manterCota(): void {
  maneuver.cancel(runner);
  cmd({ type: 'surface', id: 'bow', angle: 0 });
  cmd({ type: 'surface', id: 'stern', angle: 0 });
  cmd({ type: 'autopilot', channel: 'depth', mode: 'AUTO', hold: true });
}
const MANTER_TIP = 'Cancela a manobra, zera os lemes de vante e de ré e liga o piloto de profundidade na cota atual';

function ManCard() {
  const [target, setTarget] = usePersisted('pilot.target', 50);
  const imm = maneuver.active === 'imergir';
  return (
    <section className="con-card" aria-label="Manobras">
      <h3>MANOBRAS</h3>
      <div className="con-mv">
        <div className="con-imm">
          <button className={imm ? 'run' : ''} onClick={() => !imm && maneuver.start(runner, 'imergir', target)} title={imm ? 'Imersão em andamento (Cancelar na faixa sobre a cena)' : `Imergir para ${target} m`}>
            {imm ? '⟳' : '⬇'} Imergir
          </button>
          <MiniNum
            value={imm ? maneuver.target : target}
            min={15}
            max={280}
            unit="m"
            label="Cota de imersão"
            onSet={(v) => {
              setTarget(v);
              // durante a imersão, mudar a cota muda a ordem do piloto (e o alvo da manobra)
              if (imm) cmd({ type: 'setpoint', channel: 'depth', value: v });
            }}
          />
        </div>
        <button className={maneuver.active === 'emergir' ? 'run' : ''} onClick={() => maneuver.active !== 'emergir' && maneuver.start(runner, 'emergir')}>
          {maneuver.active === 'emergir' ? '⟳' : '⬆'} Emergir
        </button>
        <button onClick={manterCota} title={MANTER_TIP}>
          ═ Manter cota
        </button>
      </div>
    </section>
  );
}

export function OpsConsole({ e }: { e: SimulationEngine }) {
  const ops = useOpsBus();
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (ops.focusGroup === 'nav' && ops.focusSeq > 0) {
      setFlash(true);
      const t = window.setTimeout(() => setFlash(false), 1400);
      return () => window.clearTimeout(t);
    }
  }, [ops.focusSeq]);
  return (
    <div className={`ops-console ${flash ? 'flash' : ''}`}>
      <PropCard e={e} />
      <GovCard e={e} />
      <ApCard e={e} />
      <ManCard />
    </div>
  );
}

// ------------------------------------------------------------ console compacto (telas baixas)
/** ordem vizinha do telégrafo (dir = +1 mais avante, −1 mais a ré), a partir da ordem atual */
export function telegraphStep(rpmCmd: number, dir: 1 | -1): number {
  const rpms = TELEGRAPH.map((t) => t.rpm);
  const at = rpms.indexOf(Math.round(rpmCmd));
  if (at >= 0) return rpms[Math.max(0, Math.min(rpms.length - 1, at + dir))];
  // fora das ordens (ajuste fino): vai para a ordem seguinte no sentido pedido
  return dir > 0 ? (rpms.find((r) => r > rpmCmd) ?? rpms[rpms.length - 1]) : ([...rpms].reverse().find((r) => r < rpmCmd) ?? rpms[0]);
}

const FIN_SHORT: Record<FinId, string> = { rudder: 'Dir.', bow: 'Vte', stern: 'Ré' };

/**
 * Uma linha (~48 px) com o essencial do console: telégrafo (◀ ▶ entre as
 * ordens), lemes com o dono quando não é o operador, pilotos e manobras.
 * "▴ Console" abre o console completo por cima do rodapé da cena.
 */
export function OpsConsoleCompact({ e, onOpen }: { e: SimulationEngine; onOpen: () => void }) {
  const p = e.state.propulsion;
  const ap = e.state.autopilot;
  const [target] = usePersisted('pilot.target', 50);
  const tel = TELEGRAPH.find((t) => t.rpm === Math.round(p.rpmCmd))?.label ?? `${fmt(p.rpmCmd, 0)} rpm`;
  const imm = maneuver.active === 'imergir';
  const em = maneuver.active === 'emergir';
  const apTxt = (mode: string, set: string) => (mode === 'AUTO' ? `AUTO ${set}` : 'MAN');
  return (
    <div className="ops-console compact" role="group" aria-label="Console de governo (compacto)">
      <span className="cc-grp" aria-label="Propulsão">
        <button onClick={() => cmd({ type: 'telegraph', rpm: telegraphStep(p.rpmCmd, -1) })} title="Ordem anterior do telégrafo (mais a ré)" aria-label="Telégrafo: ordem anterior">
          ◀
        </button>
        <b className={`cc-tel ${p.rpmCmd < 0 ? 'rev' : ''}`}>{tel}</b>
        <button onClick={() => cmd({ type: 'telegraph', rpm: telegraphStep(p.rpmCmd, 1) })} title="Próxima ordem do telégrafo (mais avante)" aria-label="Telégrafo: próxima ordem">
          ▶
        </button>
        <small>{fmt(e.outputs.rpm, 0)} rpm</small>
      </span>
      <span className="cc-grp" aria-label="Lemes">
        {(['rudder', 'bow', 'stern'] as FinId[]).map((id) => {
          const st = e.state.surfaces[id];
          const o = finOwner(e, id);
          return (
            <span key={id} className="cc-fin" title={`${FIN_NAME[id]}: ordem ${fmt(Math.abs(st.cmd), 1)}°${finDir(id, st.cmd)}, real ${fmt(Math.abs(st.actual), 1)}° · ${o} · teclas ${FIN_KEYS[id]}`}>
              {FIN_SHORT[id]}{' '}
              <b>
                {fmt(Math.abs(st.cmd), 0)}°{finDir(id, st.cmd)}
              </b>
              {o !== 'OPERADOR' && <OwnerTag o={o} short />}
            </span>
          );
        })}
      </span>
      <span className="cc-grp" aria-label="Piloto automático">
        <span>
          Rumo <b className={ap.headingMode === 'AUTO' ? 'auto' : ''}>{apTxt(ap.headingMode, `${fmt(ap.headingSet, 0)}°`)}</b>
        </span>
        <span>
          Prof. <b className={ap.depthMode === 'AUTO' ? 'auto' : ''}>{apTxt(ap.depthMode, `${fmt(ap.depthSet, 0)} m`)}</b>
        </span>
        {ap.pitchMode === 'AUTO' && (
          <span>
            Incl. <b className="auto">AUTO {fmt(ap.pitchSet, 1)}°</b>
          </span>
        )}
      </span>
      <span className="cc-grp cc-mv" aria-label="Manobras">
        <button className={imm ? 'run' : ''} onClick={() => !imm && maneuver.start(runner, 'imergir', target)} title={imm ? 'Imersão em andamento' : `Imergir para ${target} m (cota no console completo)`}>
          {imm ? '⟳' : '⬇'} Imergir {fmt(imm ? maneuver.target : target, 0)} m
        </button>
        <button className={em ? 'run' : ''} onClick={() => !em && maneuver.start(runner, 'emergir')}>
          {em ? '⟳' : '⬆'} Emergir
        </button>
        <button onClick={manterCota} title={MANTER_TIP}>
          ═ Manter
        </button>
      </span>
      <button className="cc-open" onClick={onOpen} title="Abrir o console completo sobre a cena (Esc fecha)">
        ▴ Console
      </button>
    </div>
  );
}

// ------------------------------------------------------------ aviso de troca de comando
interface Takeover {
  text: string;
  restore: { heading?: number; depth?: number };
  until: number;
}

/**
 * Lê o histórico de comandos: quando um toque manual desliga um piloto (ou o
 * sopro de emergência, ou a manobra é cancelada por isso), mostra por 6 s o
 * que caiu, com "Voltar a AUTO" (religa o canal com a ordem que ele tinha).
 */
export function TakeoverToast({ e }: { e: SimulationEngine }) {
  const last = useRef<Pick<CommandRecord, 't' | 'text'> | null>(null);
  const [toast, setToast] = useState<Takeover | null>(null);
  useEffect(() => {
    const log = e.state.commands;
    const prev = last.current;
    const end = log[log.length - 1];
    last.current = end ? { t: end.t, text: end.text } : null;
    if (!prev) return;
    // os registros podem ser cópias (janela de tela): compara por instante e texto
    let i = log.length - 1;
    while (i >= 0 && !(log[i].t === prev.t && log[i].text === prev.text)) i--;
    if (i < 0) return; // outro motor (cenário recarregado): não há o que avisar
    const fresh = log.slice(i + 1);
    if (!fresh.length) return;
    const parts: string[] = [];
    const restore: Takeover['restore'] = {};
    let emergency = false;
    for (const r of fresh) {
      if (/DESENGAJADO por ação manual/.test(r.text)) {
        if (r.text.startsWith('Rumo')) {
          parts.push('Piloto de rumo em MAN');
          restore.heading = e.state.autopilot.headingSet;
        } else {
          parts.push('Piloto de profundidade em MAN');
          restore.depth = e.state.autopilot.depthSet;
        }
      } else if (/DESENGAJADO pelo sopro de emergência/.test(r.text)) {
        parts.push('Sopro de emergência: piloto de profundidade em MAN e lemes a 0°');
        emergency = true;
      } else {
        const m = /^Manobra rápida — CANCELADA: (.*)$/.exec(r.text);
        if (m && m[1] !== 'cancelada pelo operador') parts.push(`Manobra cancelada (${m[1]})`);
      }
    }
    if (!parts.length) return;
    // eventos do mesmo toque chegam em quadros diferentes (desengate, depois o cancelamento da manobra): junta
    setToast((cur) => {
      const now = performance.now();
      const keep = cur && cur.until > now ? cur : null;
      const text = keep ? [keep.text, ...parts.filter((x) => !keep.text.includes(x))].join(' · ') : parts.join(' · ');
      return { text, restore: emergency ? {} : { ...(keep?.restore ?? {}), ...restore }, until: now + 6000 };
    });
  });
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), Math.max(0, toast.until - performance.now()));
    return () => window.clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  const can = toast.restore.heading !== undefined || toast.restore.depth !== undefined;
  return (
    <div className="ops-toast" role="status">
      <span>{toast.text}</span>
      {can && (
        <button
          onClick={() => {
            const r = toast.restore;
            if (r.heading !== undefined) {
              cmd({ type: 'autopilot', channel: 'heading', mode: 'AUTO' });
              cmd({ type: 'setpoint', channel: 'heading', value: r.heading });
            }
            if (r.depth !== undefined) {
              cmd({ type: 'autopilot', channel: 'depth', mode: 'AUTO' });
              cmd({ type: 'setpoint', channel: 'depth', value: r.depth });
            }
            setToast(null);
          }}
        >
          Voltar a AUTO
        </button>
      )}
      <button className="x" onClick={() => setToast(null)} aria-label="Fechar aviso">
        ✕
      </button>
    </div>
  );
}

// ------------------------------------------------------------ sopro de emergência
const ARM_MS = 5000;

export function EmergencyBox({ e }: { e: SimulationEngine }) {
  const s = e.state;
  const v = e.vessel;
  const active = emergencyBlowActive(s);
  const [armedAt, setArmedAt] = useState(0);
  const armed = !active && armedAt > 0 && performance.now() - armedAt < ARM_MS;
  useEffect(() => {
    if (!armedAt) return;
    const t = window.setTimeout(() => setArmedAt(0), ARM_MS);
    return () => window.clearTimeout(t);
  }, [armedAt]);
  const banks = v.hpAir.banks.filter((b) => b.purpose === 'emergency');
  const pEm = banks.length ? Math.min(...banks.map((b) => bankPressure(v.hpAir, b.id, s.hpAir.banks[b.id].mass) / 1e5)) : 0;
  const fill = v.ballast.tanks.reduce((a, t) => a + s.ballast[t.id].water, 0) / v.ballast.tanks.reduce((a, t) => a + t.volume, 0);
  const rec = active ? [...s.commands].reverse().find((r) => r.text.startsWith('SOPRO DE EMERGÊNCIA')) : undefined;
  if (active)
    return (
      <div className="ops-emer on" role="region" aria-label="Sopro de emergência">
        <b>SOPRO DE EMERGÊNCIA ATIVO{rec ? ` · há ${fmtTime(s.t - rec.t)}` : ''}</b>
        <button onClick={() => cmd({ type: 'emergencyBlow', open: false })}>Fechar sopro de emergência</button>
        <small>
          Ampolas de emergência {fmt(pEm, 0)} bar · TLP {fmt(fill * 100, 0)} % · compressor automático
        </small>
      </div>
    );
  if (armed)
    return (
      <div className="ops-emer armed" role="region" aria-label="Sopro de emergência">
        <b>TAMPA LEVANTADA</b>
        <button
          className="fire"
          onClick={() => {
            cmd({ type: 'emergencyBlow' });
            setArmedAt(0);
          }}
        >
          SOPRAR TODOS OS TLP
        </button>
        <small>
          Fecha suspiros e sopro normal, abre as ampolas ·{' '}
          <button className="link" onClick={() => setArmedAt(0)}>
            baixar tampa
          </button>
        </small>
      </div>
    );
  return (
    <div className="ops-emer" role="region" aria-label="Sopro de emergência">
      <b>SOPRO DE EMERGÊNCIA</b>
      <button onClick={() => setArmedAt(performance.now())} title="Primeiro levante a tampa; depois, em até 5 s, sopre">
        ⛉ Levantar tampa
      </button>
      <small>Fechado · ampolas de emergência {fmt(pEm, 0)} bar</small>
    </div>
  );
}
