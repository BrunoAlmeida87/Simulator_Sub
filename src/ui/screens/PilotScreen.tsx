/**
 * Tela de PILOTAGEM: o submarino em 3D (vista lateral que acompanha o casco)
 * com os comandos ao lado. Tudo o que se vê vem do estado físico — avanço,
 * imersão, emersão, atitude, lemes, hélice, bolhas e esteira.
 */
import { useState } from 'react';
import { cmd, runner, useSim } from '../store';
import { Scene3D, defaultQuality, saveQuality } from '../components/Scene3D';
import { SeaControls } from '../components/SeaControls';
import type { OceanQuality } from '../../render3d/Ocean';
import { Panel } from '../components/Panel';
import { DepthTape } from '../components/gauges';
import { NumSet, QuickBallast, SurfaceControl, Telegraph } from '../components/Controls';
import type { ViewMode } from '../../render3d/SubmarineScene';
import { navStatus } from '../navStatus';
import { maneuver } from '../maneuvers';
import { ManeuverStatus } from '../components/ManeuverStatus';
import { toKnots } from '../../sim/units';
import { fmt } from '../format';

export function PilotScreen() {
  const e = useSim(10);
  const [view, setView] = useState<ViewMode>('piloto');
  const [cut, setCut] = useState(false);
  const [vec, setVec] = useState(false);
  const [marks, setMarks] = useState(true);
  const [quality, setQualityS] = useState<OceanQuality>(defaultQuality);
  const setQuality = (q: OceanQuality) => {
    saveQuality(q);
    setQualityS(q);
  };
  const [target, setTarget] = useState(50);
  const s = e.state;
  const o = e.outputs;
  const ap = s.autopilot;
  const st = navStatus(e);
  const tanks = e.vessel.ballast.tanks;
  const fill = tanks.reduce((a, t) => a + s.ballast[t.id].water, 0) / tanks.reduce((a, t) => a + t.volume, 0);
  const kn = toKnots(s.body.vel.x);
  const L = e.vessel.limits;
  return (
    <div className="pilot">
      <div className="pilot-view">
        <Scene3D quality={quality} view={view} cutaway={cut} labels={false} layers={{ vectors: vec, markers: marks, pipes: true, flows: true, labels: true }}>
          <div className="pilot-tape">
            <DepthTape depth={o.depthKeel} ordered={ap.depthMode === 'AUTO' ? ap.depthSet : null} bottom={o.bottomDepth} rate={o.verticalSpeed} opLimit={L.operatingDepth} testLimit={L.testDepth} height={260} />
          </div>
          <div className="pilot-hud">
            <span className={`badge ${st.cls}`} style={{ fontSize: 13, padding: '3px 10px' }}>
              {st.label}
            </span>
            <div className="pilot-nums">
              <span>
                <small>PROF</small>
                <b>{fmt(o.depthKeel, 1)} m</b>
              </span>
              <span>
                <small>VEL</small>
                <b>{fmt(kn, 1)} nós</b>
              </span>
              <span>
                <small>RUMO</small>
                <b>{fmt(o.euler.heading, 0)}°</b>
              </span>
              <span>
                <small>PITCH</small>
                <b>{fmt(o.euler.pitch, 1)}°</b>
              </span>
              <span>
                <small>{o.verticalSpeed >= 0 ? 'DESCE' : 'SOBE'}</small>
                <b>{fmt(Math.abs(o.verticalSpeed), 2)} m/s</b>
              </span>
              <span>
                <small>TLP</small>
                <b>{fmt(fill * 100, 0)} %</b>
              </span>
            </div>
          </div>
          <div className="overlay-ctl">
            <SeaControls quality={quality} setQuality={setQuality} />
            <div className="seg">
              {(
                [
                  ['piloto', 'Lateral'],
                  ['perseguicao', 'Perseguição'],
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
              <button className={`btn sm ${marks ? 'on' : ''}`} onClick={() => setMarks(!marks)}>
                Boias
              </button>
            </div>
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
      <div className="pilot-ctl">
        <Panel title="Manobras rápidas">
          <div className="row">
            <button className={`btn lg ${maneuver.active === 'imergir' ? 'on' : ''}`} onClick={() => maneuver.start(runner, 'imergir', target)}>
              ⬇ Imergir para
            </button>
            <NumSet value={target} step={10} unit="m" min={15} max={280} onSet={setTarget} />
          </div>
          <div className="row mt8">
            <button className={`btn lg ${maneuver.active === 'emergir' ? 'on' : ''}`} onClick={() => maneuver.start(runner, 'emergir')}>
              ⬆ Emergir
            </button>
            <button
              className="btn lg"
              onClick={() => {
                maneuver.cancel(runner);
                cmd({ type: 'surface', id: 'bow', angle: 0 });
                cmd({ type: 'surface', id: 'stern', angle: 0 });
                cmd({ type: 'autopilot', channel: 'depth', mode: 'AUTO' });
              }}
            >
              ═ Manter profundidade
            </button>
            {maneuver.active && (
              <button className="btn warn" onClick={() => maneuver.cancel(runner)}>
                Cancelar manobra
              </button>
            )}
          </div>
          <div className="note">As manobras só emitem os comandos que você daria à mão (velocidade, suspiros, sopro, lemes, piloto automático). A resposta é a da física: o submarino leva dezenas de segundos para alagar os tanques e mudar de cota.</div>
        </Panel>
        <Panel title="Máquinas — telégrafo">
          <Telegraph e={e} />
        </Panel>
        <Panel title="Lemes">
          <div className="col">
            <SurfaceControl e={e} id="bow" />
            <SurfaceControl e={e} id="stern" />
            <SurfaceControl e={e} id="rudder" />
          </div>
          <div className="note">Lemes só funcionam com velocidade (força ∝ U²). Teclado: Q/E vante · W/S ré · A/D direção · +/− rotação · Espaço pausa.</div>
        </Panel>
        <Panel title="Lastro principal">
          <QuickBallast e={e} />
        </Panel>
        <Panel title="Piloto automático">
          <table className="t">
            <tbody>
              {(
                [
                  ['depth', 'Profundidade', ap.depthMode, ap.depthSet, 'm', 10, 0, 300],
                  ['heading', 'Rumo', ap.headingMode, ap.headingSet, '°', 10, 0, 359],
                ] as const
              ).map(([ch, label, mode, set, unit, step, min, max]) => (
                <tr key={ch}>
                  <td>
                    <b>{label}</b>
                  </td>
                  <td>
                    <div className="seg">
                      <button className={mode === 'MANUAL' ? 'on' : ''} onClick={() => cmd({ type: 'autopilot', channel: ch, mode: 'MANUAL' })}>
                        MAN
                      </button>
                      <button className={mode === 'AUTO' ? 'on' : ''} onClick={() => cmd({ type: 'autopilot', channel: ch, mode: 'AUTO' })}>
                        AUTO
                      </button>
                    </div>
                  </td>
                  <td>
                    <NumSet value={set} step={step} unit={unit} min={min} max={max} onSet={(v) => cmd({ type: 'setpoint', channel: ch, value: v })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
