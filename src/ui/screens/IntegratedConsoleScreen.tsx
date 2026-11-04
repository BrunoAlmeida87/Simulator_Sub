/** Console alternativo: estações navais e instrumentos de voo, com o mesmo estado e comandos. */
import { useId } from 'react';
import { cmd, useSim } from '../store';
import { usePersisted } from '../persist';
import { useQuality } from '../graphics';
import { useIdentity } from '../appearance';
import { indicatedDepth } from '../instruments';
import { fmt } from '../format';
import { toKnots } from '../../sim/units';
import { navStatus } from '../navStatus';
import { useUi } from '../uiContext';
import { Scene3D } from '../components/Scene3D';
import { ResizableScene } from '../components/ResizableScene';
import { Attitude, Compass, DepthTape, Dial } from '../components/gauges';
import { SurfaceControl, Telegraph, NumSet } from '../components/Controls';
import { OverlayCtl } from '../components/OverlayCtl';
import { viewSection, type ViewOption } from '../components/OverlayMenu';
import { SceneLayerPanel } from '../components/SceneLayerPanel';
import { SCENE_LAYER_KEYS, defaultLayers, type SceneLayers } from '../../render3d/layers';
import { HeadingTape } from '../ops/CockpitHud';
import { ManeuverStatus } from '../components/ManeuverStatus';
import type { ViewMode } from '../../render3d/SubmarineScene';
import './IntegratedConsoleScreen.css';

const VIEWS: ViewOption[] = [
  { id: 'perseguicao', label: 'Perseguição' },
  { id: 'piloto', label: 'Lateral' },
  { id: 'cinematografica', label: 'Cinematográfica' },
  { id: 'perspectiva', label: 'Perspectiva' },
  { id: 'livre', label: 'Livre' },
];
const STATIONS = [
  { id: 'governo', number: '01', label: 'Governo', hint: 'Lemes e potência' },
  { id: 'piloto', number: '02', label: 'Piloto automático', hint: 'Rumo e profundidade' },
  { id: 'sistemas', number: '03', label: 'Sistemas', hint: 'Energia e lastro' },
] as const;
type Station = (typeof STATIONS)[number]['id'];

export function IntegratedConsoleScreen() {
  const e = useSim(10);
  const s = e.state;
  const o = e.outputs;
  const ap = s.autopilot;
  const sn = s.sensors;
  const limits = e.vessel.limits;
  const identity = useIdentity();
  const ui = useUi();
  const [quality] = useQuality();
  const [station, setStation] = usePersisted<Station>('integrated.station', 'governo');
  const [view, setView] = usePersisted<ViewMode>('integrated.view', 'perseguicao');
  const [laySaved, setLay] = usePersisted<Partial<SceneLayers>>('integrated.layers', {});
  const layers: SceneLayers = { ...defaultLayers(), labels: false, batteryInfo: false, airInfo: false, wind: false, depthLines: false, ...laySaved };
  const status = navStatus(e);
  const depth = indicatedDepth(e);
  const speed = toKnots(sn.DVLU.value);
  const tabId = useId();
  const currentStation = STATIONS.find((x) => x.id === station) ?? STATIONS[0];

  return (
    <div className="integrated-console">
      <header className="ic-heading">
        <div>
          <span className="ic-eyebrow">{identity.name} / CENTRAL DE OPERAÇÃO</span>
          <h1>Console integrado</h1>
        </div>
        <span className={`badge ${status.cls}`}>{status.label}</span>
      </header>
      <div className="ic-readouts" aria-label="Situação indicada do submarino">
        <div>
          <small>PROFUNDIDADE</small>
          <b>
            {fmt(depth, 1)} <span>m</span>
          </b>
          <em>{ap.depthMode === 'AUTO' ? `AUTO · ordem ${fmt(ap.depthSet, 0)} m` : 'CONTROLE MANUAL'}</em>
        </div>
        <div>
          <small>VELOCIDADE</small>
          <b>
            {fmt(speed, 1)} <span>nós</span>
          </b>
          <em>{fmt(sn.DVLU.value * 3.6, 1)} km/h</em>
        </div>
        <div>
          <small>RUMO</small>
          <b>
            {fmt(sn.GIRO.value, 0)}
            <span>°</span>
          </b>
          <em>{ap.headingMode === 'AUTO' ? `AUTO · ordem ${fmt(ap.headingSet, 0)}°` : 'CONTROLE MANUAL'}</em>
        </div>
        <div>
          <small>EIXO</small>
          <b>
            {fmt(o.rpm, 0)} <span>rpm</span>
          </b>
          <em>ORDEM {fmt(s.propulsion.rpmCmd, 0)} rpm</em>
        </div>
      </div>
      <div className="ic-workspace">
        <div className="ic-main">
          <ResizableScene id="integrated-scene" persistKey="integrated" defaultHeight={500}>
            <Scene3D quality={quality} view={view} persistKey="integrated" layers={layers}>
              <OverlayCtl
                persistKey="integrated"
                sections={[
                  viewSection(VIEWS, view, setView),
                  { id: 'camadas', label: 'Camadas', title: 'Camadas da cena 3D', content: <SceneLayerPanel e={e} keys={SCENE_LAYER_KEYS} value={layers} onChange={(p) => setLay({ ...laySaved, ...p })} /> },
                ]}
              />
              <div className="ic-scene-heading">
                <HeadingTape heading={sn.GIRO.value} ordered={ap.headingMode === 'AUTO' ? ap.headingSet : null} />
              </div>
              <div className="ic-scene-status">
                <ManeuverStatus compact cancel />
              </div>
            </Scene3D>
          </ResizableScene>
          <section className="ic-instruments" aria-label="Instrumentos de navegação">
            <div>
              <h2>Atitude</h2>
              <Attitude pitch={sn.INSP.value} roll={sn.INSR.value} staticPitch={o.staticPitchEq} size={150} />
              <span>
                Pitch {fmt(sn.INSP.value, 1)}° · banda {fmt(sn.INSR.value, 1)}°
              </span>
            </div>
            <div>
              <h2>Rumo</h2>
              <Compass heading={sn.GIRO.value} ordered={ap.headingMode === 'AUTO' ? ap.headingSet : null} rudder={s.surfaces.rudder.actual} size={150} />
              <span>Leme {fmt(s.surfaces.rudder.actual, 1)}°</span>
            </div>
            <div className="ic-depth-instrument">
              <h2>Profundidade</h2>
              <DepthTape depth={depth} ordered={ap.depthMode === 'AUTO' ? ap.depthSet : null} bottom={o.bottomDepth} rate={o.verticalSpeed} opLimit={limits.operatingDepth} testLimit={limits.testDepth} height={160} />
              <span>
                {o.verticalSpeed >= 0 ? 'Descendo' : 'Subindo'} {fmt(Math.abs(o.verticalSpeed), 2)} m/s
              </span>
            </div>
            <div>
              <h2>Velocidade</h2>
              <Dial value={speed} min={-8} max={20} label="Velocidade" unit="nós" digits={1} size={150} />
              <span>
                {fmt(o.rpm, 0)} rpm · {fmt(s.propulsion.shaftPower / 1000, 0)} kW
              </span>
            </div>
          </section>
        </div>
        <aside className="ic-station" aria-label="Estações de operação">
          <div className="ic-station-heading">
            <span className="ic-eyebrow">ESTAÇÕES</span>
            <b>Comandos do submarino</b>
          </div>
          <div className="ic-station-tabs" role="tablist" aria-label="Posto de operação">
            {STATIONS.map((x) => (
              <button
                key={x.id}
                id={`${tabId}-${x.id}`}
                role="tab"
                aria-selected={station === x.id}
                aria-controls={`${tabId}-panel`}
                tabIndex={station === x.id ? 0 : -1}
                onClick={() => setStation(x.id)}
                onKeyDown={(ev) => {
                  const at = STATIONS.findIndex((t) => t.id === station);
                  const next =
                    ev.key === 'ArrowRight' || ev.key === 'ArrowDown'
                      ? (at + 1) % STATIONS.length
                      : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp'
                        ? (at + STATIONS.length - 1) % STATIONS.length
                        : ev.key === 'Home'
                          ? 0
                          : ev.key === 'End'
                            ? STATIONS.length - 1
                            : -1;
                  if (next < 0) return;
                  ev.preventDefault();
                  ev.stopPropagation();
                  setStation(STATIONS[next].id);
                  document.getElementById(`${tabId}-${STATIONS[next].id}`)?.focus();
                }}
              >
                <span>{x.number}</span>
                <b>
                  {x.label}
                  <small>{x.hint}</small>
                </b>
              </button>
            ))}
          </div>
          <div className="ic-station-body" id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${currentStation.id}`}>
            {station === 'governo' && (
              <>
                <section>
                  <h2>Potência / telégrafo</h2>
                  <Telegraph e={e} />
                </section>
                <section>
                  <h2>Direção</h2>
                  <SurfaceControl e={e} id="rudder" />
                </section>
                <section>
                  <h2>Profundidade / vante</h2>
                  <SurfaceControl e={e} id="bow" />
                </section>
                <section>
                  <h2>Profundidade / ré</h2>
                  <SurfaceControl e={e} id="stern" />
                </section>
                <p className="ic-note">Ao mover um leme, o canal correspondente passa para controle manual.</p>
              </>
            )}
            {station === 'piloto' && (
              <>
                {(['heading', 'depth'] as const).map((channel) => {
                  const heading = channel === 'heading';
                  const mode = heading ? ap.headingMode : ap.depthMode;
                  return (
                    <section key={channel}>
                      <h2>{heading ? 'Rumo' : 'Profundidade'}</h2>
                      <div className="seg" role="group" aria-label={`Modo de ${heading ? 'rumo' : 'profundidade'}`}>
                        <button className={mode === 'MANUAL' ? 'on' : ''} aria-pressed={mode === 'MANUAL'} onClick={() => cmd({ type: 'autopilot', channel, mode: 'MANUAL' })}>
                          MANUAL
                        </button>
                        <button className={mode === 'AUTO' ? 'on' : ''} aria-pressed={mode === 'AUTO'} onClick={() => cmd({ type: 'autopilot', channel, mode: 'AUTO' })}>
                          AUTO
                        </button>
                      </div>
                      <div className="ic-reference">
                        <span>Referência ordenada</span>
                        <NumSet
                          value={heading ? ap.headingSet : ap.depthSet}
                          step={5}
                          min={0}
                          max={heading ? 359 : 300}
                          unit={heading ? '°' : 'm'}
                          label={`Referência de ${heading ? 'rumo' : 'profundidade'}`}
                          onSet={(value) => cmd({ type: 'setpoint', channel, value })}
                        />
                      </div>
                      <p className="ic-note">
                        Indicado: {heading ? `${fmt(sn.GIRO.value, 0)}°` : `${fmt(depth, 1)} m`}. {mode === 'AUTO' ? 'Piloto automático no comando.' : 'Referência pré-selecionada; ative AUTO para aplicar.'}
                      </p>
                    </section>
                  );
                })}
                <button className="btn" onClick={() => ui.setScreen('governo')}>
                  Abrir Posto de governo →
                </button>
              </>
            )}
            {station === 'sistemas' && (
              <>
                <section>
                  <h2>Energia</h2>
                  <div className="ic-system-value">
                    <b>
                      {fmt(s.electrical.soc * 100, 0)}
                      <small>% bateria</small>
                    </b>
                    <span>{fmt(s.electrical.voltage, 0)} V</span>
                  </div>
                  <progress max={1} value={s.electrical.soc} aria-label="Carga da bateria" />
                  <button className="btn sm" onClick={() => ui.setScreen('energia')}>
                    Fluxo de energia →
                  </button>
                </section>
                <section>
                  <h2>Tanques de lastro</h2>
                  {e.vessel.ballast.tanks.map((tank) => {
                    const fill = s.ballast[tank.id].water / tank.volume;
                    return (
                      <div key={tank.id} className="ic-tank">
                        <span>
                          {tank.name}
                          <b>{fmt(fill * 100, 0)}%</b>
                        </span>
                        <progress max={1} value={fill} aria-label={`Enchimento de ${tank.name}`} />
                      </div>
                    );
                  })}
                  <button className="btn sm" onClick={() => ui.setScreen('lastro')}>
                    Lastro e compensação →
                  </button>
                </section>
                <button className="btn" onClick={() => ui.setScreen('sistemas')}>
                  Visão geral dos sistemas →
                </button>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
