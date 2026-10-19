/**
 * PILOTAGEM — CENTRAL DE OPERAÇÃO. A cena do submarino fica sempre visível;
 * o painel lateral (rolagem própria) tem os comandos essenciais fixos e os
 * sistemas em grupos expansíveis, com resumo no cabeçalho e até dois grupos
 * fixados. Clicar num objeto da cena (tanque, leme, hélice, mastro, bateria,
 * garrafas, válvulas, bombas) abre o grupo correspondente. Tudo usa os mesmos
 * comandos e o mesmo estado das outras telas.
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import { usePersisted } from '../persist';
import { TankSelector } from '../components/TankSelector';
import { cmd, runner, useSim } from '../store';
import { Scene3D, defaultQuality, saveQuality } from '../components/Scene3D';
import { SeaControls } from '../components/SeaControls';
import type { OceanQuality } from '../../render3d/Ocean';
import { DepthTape } from '../components/gauges';
import { NumSet, TELEGRAPH } from '../components/Controls';
import type { ViewMode } from '../../render3d/SubmarineScene';
import { navStatus } from '../navStatus';
import { maneuver } from '../maneuvers';
import { ManeuverStatus } from '../components/ManeuverStatus';
import { opsBus, GROUP_ORDER, GROUP_TITLE, type GroupId } from '../ops/opsBus';
import { GROUPS } from '../ops/OpsGroups';
import { OpsStrip } from '../ops/OpsStrip';
import type { SimulationEngine } from '../../sim/core/engine';
import { fmt } from '../format';

export function useOps() {
  const [, f] = useReducer((x: number) => x + 1, 0);
  useEffect(() => opsBus.subscribe(f), []);
  return opsBus;
}

function OpsGroupBox({ id, e }: { id: GroupId; e: SimulationEngine }) {
  const ops = useOps();
  const ref = useRef<HTMLElement>(null);
  const open = ops.isOpen(id);
  const pinned = ops.st.pinned.includes(id);
  const g = GROUPS[id];
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (ops.focusGroup === id && ops.focusSeq > 0) {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setFlash(true);
      const t = window.setTimeout(() => setFlash(false), 1400);
      return () => window.clearTimeout(t);
    }
  }, [ops.focusSeq]);
  const warn = g.warn?.(e);
  const Body = g.Body;
  return (
    <section ref={ref} className={`ops-group ${open ? 'open' : ''} ${pinned ? 'pinned' : ''} ${flash ? 'flash' : ''} ${warn ? 'warn' : ''}`}>
      <header onClick={() => ops.toggle(id)} title={pinned ? 'Grupo fixado' : open ? 'Recolher' : 'Expandir'}>
        <span className="chev">{open ? '▾' : '▸'}</span>
        <b>{GROUP_TITLE[id]}</b>
        <span className="sum">{g.summary(e)}</span>
        <button
          className={`pin ${pinned ? 'on' : ''}`}
          onClick={(ev) => {
            ev.stopPropagation();
            ops.togglePin(id);
          }}
          title={pinned ? 'Desafixar' : 'Fixar aberto (até dois grupos)'}
        >
          📌
        </button>
      </header>
      {open && (
        <div className="body">
          <Body e={e} />
        </div>
      )}
    </section>
  );
}

/** Lemes em formato compacto (ângulos absolutos). */
function FinMini({ e, id }: { e: SimulationEngine; id: 'bow' | 'stern' | 'rudder' }) {
  const st = e.state.surfaces[id];
  const r = id === 'rudder';
  const steps = r ? [-20, -10, -5, 0, 5, 10, 20] : [-15, -10, -5, 0, 5, 10, 15];
  const name = { bow: 'Vante', stern: 'Ré', rudder: 'Direção' }[id];
  return (
    <div className="finmini">
      <span className="fn">
        {name} <b className="mono">{fmt(st.actual, 0)}°</b>
      </span>
      <div className="seg">
        {steps.map((a) => (
          <button key={a} className={Math.round(st.cmd) === a ? 'on' : ''} onClick={() => cmd({ type: 'surface', id, angle: a })} title={r ? (a > 0 ? 'boreste' : a < 0 ? 'bombordo' : 'a meio') : a > 0 ? 'subir' : a < 0 ? 'descer' : 'zero'}>
            {a === 0 ? '0' : r ? `${Math.abs(a)}${a > 0 ? 'E' : 'B'}` : `${Math.abs(a)}${a > 0 ? '↑' : '↓'}`}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Comandos usados com mais frequência — sempre visíveis. */
function Essentials({ e }: { e: SimulationEngine }) {
  const p = e.state.propulsion;
  const ap = e.state.autopilot;
  const [target, setTarget] = usePersisted('pilot.target', 50);
  return (
    <div className="ops-ess">
      <div className="row">
        <button className={`btn ${runner.running ? 'on' : 'ok'}`} onClick={() => ((runner.running = !runner.running), runner.notify())}>
          {runner.running ? '❚❚ Pausar' : '▶ Executar'}
        </button>
        <div className="seg ess-tel" title="Telégrafo">
          {TELEGRAPH.map((t) => (
            <button key={t.label} className={`${Math.round(p.rpmCmd) === t.rpm ? 'on' : ''} ${t.rpm < 0 ? 'neg' : ''}`} onClick={() => cmd({ type: 'telegraph', rpm: t.rpm })} title={`Telégrafo: ${t.label} (${t.rpm} rpm)`}>
              {t.label.replace('AV ', '').replace('RÉ ', 'R ')}
            </button>
          ))}
        </div>
      </div>
      <div className="ess-fins">
        <FinMini e={e} id="bow" />
        <FinMini e={e} id="stern" />
        <FinMini e={e} id="rudder" />
      </div>
      <div className="row">
        <span className="subtle">Profundidade</span>
        <div className="seg">
          <button className={ap.depthMode === 'MANUAL' ? 'on' : ''} onClick={() => cmd({ type: 'autopilot', channel: 'depth', mode: 'MANUAL' })}>
            MAN
          </button>
          <button className={ap.depthMode === 'AUTO' ? 'on' : ''} onClick={() => cmd({ type: 'autopilot', channel: 'depth', mode: 'AUTO' })}>
            AUTO
          </button>
        </div>
        <NumSet value={ap.depthSet} step={5} unit="m" min={0} max={300} onSet={(v) => cmd({ type: 'setpoint', channel: 'depth', value: v })} />
      </div>
      <div className="row">
        <button className={`btn sm ${maneuver.active === 'imergir' ? 'on' : ''}`} onClick={() => maneuver.start(runner, 'imergir', target)}>
          ⬇ Imergir para
        </button>
        <NumSet value={target} step={10} unit="m" min={15} max={280} onSet={setTarget} />
        <button className={`btn sm ${maneuver.active === 'emergir' ? 'on' : ''}`} onClick={() => maneuver.start(runner, 'emergir')}>
          ⬆ Emergir
        </button>
        <button
          className="btn sm"
          onClick={() => {
            maneuver.cancel(runner);
            cmd({ type: 'surface', id: 'bow', angle: 0 });
            cmd({ type: 'surface', id: 'stern', angle: 0 });
            cmd({ type: 'autopilot', channel: 'depth', mode: 'AUTO' });
          }}
        >
          ═ Manter
        </button>
        {maneuver.active && (
          <button className="btn sm warn" onClick={() => maneuver.cancel(runner)}>
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}

export function PilotScreen() {
  const e = useSim(8);
  const ops = useOps();
  // visualização guardada ao trocar de aba (e ao recarregar a página)
  const [view, setView] = usePersisted<ViewMode>('pilot.view', 'piloto');
  const [cut, setCut] = usePersisted('pilot.cut', false);
  const [tankF, setTankF] = usePersisted<string[] | null>('pilot.tankFilter', null);
  const [selOpen, setSelOpen] = usePersisted('pilot.tankSelOpen', false);
  const [vec, setVec] = usePersisted('pilot.vec', false);
  const [trimV, setTrimV] = usePersisted('pilot.trim', false);
  const [marks, setMarks] = usePersisted('pilot.marks', true);
  const [quality, setQualityS] = useState<OceanQuality>(defaultQuality);
  const setQuality = (q: OceanQuality) => {
    saveQuality(q);
    setQualityS(q);
  };
  const o = e.outputs;
  const ap = e.state.autopilot;
  const st = navStatus(e);
  const L = e.vessel.limits;
  const pinned = ops.st.pinned;
  const rest = GROUP_ORDER.filter((g) => !pinned.includes(g));
  return (
    <div className="ops">
      <div className="ops-main">
        <div className="ops-view">
          <Scene3D
            quality={quality}
            view={view}
            cutaway={cut}
            labels={false}
            persistKey="pilot"
            layers={{ tankFilter: tankF, vectors: vec, trimVectors: trimV, markers: marks, pipes: true, flows: true, labels: true, highlight: ops.highlight }}
            onPick={(p) => {
              if (p && !cut && ['tank', 'valve', 'pump', 'battery', 'generator', 'hp', 'demoWeight'].includes(p.kind)) setCut(true);
              ops.select(p);
            }}
          >
            <div className="pilot-tape">
              <DepthTape depth={o.depthKeel} ordered={ap.depthMode === 'AUTO' ? ap.depthSet : null} bottom={o.bottomDepth} rate={o.verticalSpeed} opLimit={L.operatingDepth} testLimit={L.testDepth} height={240} />
            </div>
            <div className="pilot-hud">
              <span className={`badge ${st.cls}`} style={{ fontSize: 13, padding: '3px 10px' }}>
                {st.label}
              </span>
              <span className="subtle">Clique num tanque, leme, hélice, mastro, bateria ou válvula para abrir os controles.</span>
            </div>
            <div className="overlay-ctl">
              <SeaControls quality={quality} setQuality={setQuality} />
              <div className="seg">
                {(
                  [
                    ['piloto', 'Lateral'],
                    ['perseguicao', 'Perseguição'],
                    ['tanques', 'Tanques'],
                    ['forcas', 'Forças'],
                    ['fixa', 'Fixa'],
                    ['livre', 'Livre'],
                  ] as [ViewMode, string][]
                ).map(([v, l]) => (
                  <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="btngroup">
                <button className={`btn sm ${cut ? 'on' : ''}`} onClick={() => setCut(!cut)}>
                  Ver tanques
                </button>
                <button className={`btn sm ${vec ? 'on' : ''}`} onClick={() => setVec(!vec)}>
                  Forças
                </button>
                <button className={`btn sm ${trimV ? 'on' : ''}`} onClick={() => setTrimV(!trimV)}>
                  Trim
                </button>
                <button className={`btn sm ${marks ? 'on' : ''}`} onClick={() => setMarks(!marks)}>
                  Boias
                </button>
              </div>
              {cut && (
                <div className="tanksel-pop">
                  <button className="btn sm" onClick={() => setSelOpen(!selOpen)}>
                    {selOpen ? '▴ Tanques visíveis' : `▾ Escolher tanques${tankF ? ` (${tankF.length})` : ''}`}
                  </button>
                  {selOpen && <TankSelector e={e} value={tankF} onChange={setTankF} />}
                </div>
              )}
            </div>
            <div className="pres-bottom">
              <ManeuverStatus compact />
            </div>
            {!runner.running && e.state.t === 0 && (
              <button className="btn ok lg pilot-start" onClick={() => ((runner.running = true), runner.notify())}>
                ▶ Iniciar simulação
              </button>
            )}
          </Scene3D>
        </div>
        <OpsStrip e={e} />
      </div>
      <aside className="ops-side">
        <Essentials e={e} />
        <div className="ops-tools">
          <span className="subtle">{pinned.length ? `Fixados: ${pinned.map((g) => GROUP_TITLE[g]).join(' + ')}` : 'Fixe até dois grupos com 📌'}</span>
          <button className="btn sm" onClick={() => ops.collapseAll()}>
            Recolher todos
          </button>
        </div>
        {pinned.map((g) => (
          <OpsGroupBox key={g} id={g} e={e} />
        ))}
        {rest.map((g) => (
          <OpsGroupBox key={g} id={g} e={e} />
        ))}
      </aside>
    </div>
  );
}
