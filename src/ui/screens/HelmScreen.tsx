/**
 * PAINEL DE GOVERNO — inspirado no posto de governo de um submarino: à
 * esquerda o GOVERNO (manche para leme de direção e lemes de ré, alavanca dos
 * lemes de vante, piloto automático de rumo e profundidade); à direita a
 * POTÊNCIA (alavanca do telégrafo). No centro, os instrumentos. Cada
 * controle mostra o comandado e a resposta real; tudo usa os mesmos comandos
 * do simulador (aparecem no histórico e entram na gravação).
 */
import { cmd, useSim } from '../store';
import { usePersisted } from '../persist';
import { Scene3D } from '../components/Scene3D';
import { useQuality } from '../graphics';
import { Compass, Attitude, DepthTape, Dial } from '../components/gauges';
import { Yoke, Lever, Knob, TELEGRAPH_DETENTS, HELM_COLORS } from '../components/helm';
import { TELEGRAPH } from '../components/Controls';
import type { ViewMode } from '../../render3d/SubmarineScene';
import { toKnots } from '../../sim/units';
import { fmt } from '../format';
import { useIdentity } from '../appearance';
import { OverlayCtl } from '../components/OverlayCtl';
import { perspSection } from '../components/SeaControls';
import { viewSection, type ViewOption } from '../components/OverlayMenu';
import { LayerPanel, type LayerKey } from '../components/LayerPanel';
import type { SceneLayers } from '../../render3d/layers';

/** camadas da cena do Governo (padrão = como era: boias, esteira e identificações; sem corte, logo sem rótulos internos) */
const HELM_LAYER_DEFAULTS: Partial<SceneLayers> = { markers: true, wake: true, wind: true, labels: true, trail: true, ships: true, noWater: false, trimRef: false, depthLines: true };
const HELM_LAYER_KEYS: LayerKey[] = ['labels', 'wake', 'wind', 'pennant', 'trail', 'markers', 'trimRef', 'depthLines', 'ships', 'noWater'];
const HELM_VIEWS: ViewOption[] = [
  { id: 'perseguicao', label: 'Perseguição' },
  { id: 'piloto', label: 'Lateral' },
  { id: 'topo', label: 'Topo' },
  { id: 'livre', label: 'Livre' },
];

export function HelmScreen() {
  const e = useSim(20);
  const id = useIdentity();
  const [quality] = useQuality();
  const [view, setView] = usePersisted<ViewMode>('helm.view', 'perseguicao');
  const [laySaved, setLay] = usePersisted<Partial<SceneLayers>>('helm.layers', {});
  const lay = { ...HELM_LAYER_DEFAULTS, ...laySaved };
  const s = e.state;
  const o = e.outputs;
  const v = e.vessel;
  const ap = s.autopilot;
  const fin = (k: string) => v.fins.find((f) => f.id === k)!;
  const rud = s.surfaces.rudder;
  const st = s.surfaces.stern;
  const bw = s.surfaces.bow;
  const p = s.propulsion;
  const order = TELEGRAPH.reduce((a, t) => (Math.abs(t.rpm - p.rpmCmd) < Math.abs(a.rpm - p.rpmCmd) ? t : a), TELEGRAPH[0]);
  const rated = v.propulsion.motor.ratedRpm;
  return (
    <div className="helm">
      <div className="helm-view">
        {/* syncVisual false: esta cena reduzida (sem vetores) não define a 2ª janela, que segue a última cena 3D completa */}
        <Scene3D quality={quality} view={view} labels={false} persistKey="helm" syncVisual={false} layers={{ ...lay, hydroVectors: false, vectors: false }}>
          <OverlayCtl
            persistKey="helm"
            sections={[
              viewSection(HELM_VIEWS, view, setView),
              {
                id: 'camadas',
                label: <>Camadas ({HELM_LAYER_KEYS.filter((k) => !!lay[k]).length})</>,
                title: 'Camadas da cena, com marcar/desmarcar todas',
                content: <LayerPanel keys={HELM_LAYER_KEYS} value={lay} onChange={(p) => setLay({ ...laySaved, ...p })} />,
              },
              perspSection(),
            ]}
          />
          <div className="helm-hud">
            <b>{id.name}</b> · {fmt(o.depthKeel, 1)} m · {fmt(toKnots(s.body.vel.x), 1)} nós · rumo {fmt(o.euler.heading, 0)}°
          </div>
        </Scene3D>
      </div>
      <div className="helm-console">
        <section className="helm-sec gov">
          <header>
            <b>GOVERNO</b> <span className="subtle">direção e profundidade</span>
          </header>
          <div className="helm-row">
            <div className="helm-col">
              <Yoke
                rudderCmd={rud.cmd}
                rudderReal={rud.actual}
                rudderMax={fin('rudder').maxDeflection}
                sternCmd={st.cmd}
                sternReal={st.actual}
                sternMax={fin('stern').maxDeflection}
                onSet={(r, sv) => {
                  if (Math.round(r) !== Math.round(rud.cmd)) cmd({ type: 'surface', id: 'rudder', angle: r });
                  if (Math.round(sv) !== Math.round(st.cmd)) cmd({ type: 'surface', id: 'stern', angle: sv });
                }}
              />
              <div className="helm-read">
                <span>
                  Leme{' '}
                  <b style={{ color: HELM_COLORS.CMD }}>
                    {fmt(Math.abs(rud.cmd), 0)}° {rud.cmd > 0.5 ? 'BE' : rud.cmd < -0.5 ? 'BB' : ''}
                  </b>{' '}
                  · real <b style={{ color: HELM_COLORS.REAL }}>{fmt(rud.actual, 1)}°</b>
                </span>
                <span>
                  Ré{' '}
                  <b style={{ color: HELM_COLORS.CMD }}>
                    {fmt(Math.abs(st.cmd), 0)}° {st.cmd > 0.5 ? 'SUBIR' : st.cmd < -0.5 ? 'DESCER' : ''}
                  </b>{' '}
                  · real <b style={{ color: HELM_COLORS.REAL }}>{fmt(st.actual, 1)}°</b>
                </span>
              </div>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button
                  className="btn sm"
                  onClick={() => {
                    cmd({ type: 'surface', id: 'rudder', angle: 0 });
                    cmd({ type: 'surface', id: 'stern', angle: 0 });
                  }}
                >
                  Centrar manche
                </button>
              </div>
            </div>
            <div className="helm-col">
              <Lever
                value={bw.cmd}
                real={bw.actual}
                min={-fin('bow').maxDeflection}
                max={fin('bow').maxDeflection}
                maxOnTop={false}
                topLabel="DESCER"
                bottomLabel="SUBIR"
                unit="°"
                ariaLabel="Lemes de vante"
                height={300}
                onSet={(a) => cmd({ type: 'surface', id: 'bow', angle: a })}
              />
              <span className="subtle">Lemes de vante</span>
            </div>
          </div>
          <div className="helm-ap">
            <div className="helm-apbox">
              <div className="row">
                <b>Rumo</b>
                <div className="seg">
                  <button className={ap.headingMode === 'MANUAL' ? 'on' : ''} onClick={() => cmd({ type: 'autopilot', channel: 'heading', mode: 'MANUAL' })}>
                    MAN
                  </button>
                  <button className={ap.headingMode === 'AUTO' ? 'on' : ''} onClick={() => cmd({ type: 'autopilot', channel: 'heading', mode: 'AUTO' })}>
                    AUTO
                  </button>
                </div>
              </div>
              <Knob value={ap.headingSet} scale={1} wrap={360} unit="°" label="rumo ordenado (gire)" active={ap.headingMode === 'AUTO'} onSet={(x) => cmd({ type: 'setpoint', channel: 'heading', value: x })} />
            </div>
            <div className="helm-apbox">
              <div className="row">
                <b>Profundidade</b>
                <div className="seg">
                  <button className={ap.depthMode === 'MANUAL' ? 'on' : ''} onClick={() => cmd({ type: 'autopilot', channel: 'depth', mode: 'MANUAL' })}>
                    MAN
                  </button>
                  <button className={ap.depthMode === 'AUTO' ? 'on' : ''} onClick={() => cmd({ type: 'autopilot', channel: 'depth', mode: 'AUTO' })}>
                    AUTO
                  </button>
                </div>
              </div>
              <Knob
                value={ap.depthSet}
                scale={0.25}
                min={0}
                max={300}
                unit=" m"
                label="profundidade ordenada (gire)"
                active={ap.depthMode === 'AUTO'}
                onSet={(x) => cmd({ type: 'setpoint', channel: 'depth', value: x })}
              />
            </div>
          </div>
          <div className="note">Mover o manche com o piloto em AUTO desengaja o canal correspondente (como nas outras telas). Os lemes horizontais só atuam com seguimento (força ∝ velocidade²).</div>
        </section>

        <section className="helm-sec inst">
          <header>
            <b>INSTRUMENTOS</b>
          </header>
          <div className="helm-inst">
            <Compass heading={o.euler.heading} ordered={ap.headingMode === 'AUTO' ? ap.headingSet : null} rudder={rud.actual} size={190} />
            <DepthTape
              depth={o.depthKeel}
              ordered={ap.depthMode === 'AUTO' ? ap.depthSet : null}
              bottom={o.bottomDepth}
              rate={o.verticalSpeed}
              opLimit={v.limits.operatingDepth}
              testLimit={v.limits.testDepth}
              height={210}
            />
            <Attitude pitch={o.euler.pitch} roll={o.euler.roll} staticPitch={o.staticPitchEq} size={170} />
            <Dial value={toKnots(s.body.vel.x)} min={-8} max={20} label="Velocidade" unit="nós" digits={1} size={150} />
          </div>
        </section>

        <section className="helm-sec pwr">
          <header>
            <b>POTÊNCIA</b> <span className="subtle">telégrafo</span>
          </header>
          <div className="helm-row">
            <Lever
              value={p.rpmCmd}
              real={o.rpm}
              min={-rated}
              max={rated}
              detents={TELEGRAPH_DETENTS}
              snap
              color={HELM_COLORS.PWR}
              unit=""
              ariaLabel="Telégrafo (ordem de máquinas)"
              height={330}
              topLabel="AVANTE"
              bottomLabel="A RÉ"
              onSet={(rpm) => cmd({ type: 'telegraph', rpm })}
            />
            <div className="helm-col">
              <Dial value={o.rpm} min={-rated} max={rated} label="Eixo" unit="rpm" cmd={p.rpmCmd} size={150} />
              <div className="helm-read">
                <span>
                  Ordem <b style={{ color: HELM_COLORS.PWR }}>{order.label}</b> ({fmt(p.rpmCmd, 0)} rpm)
                </span>
                <span>Potência {fmt(p.shaftPower / 1e6, 2)} MW</span>
                <span>Empuxo {fmt(p.thrust / 1e3, 0)} kN</span>
              </div>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn sm" onClick={() => cmd({ type: 'telegraph', rpm: p.rpmCmd - 5 })}>
                  −5 rpm
                </button>
                <button className="btn sm" onClick={() => cmd({ type: 'telegraph', rpm: p.rpmCmd + 5 })}>
                  +5 rpm
                </button>
              </div>
            </div>
          </div>
          <div className="note">Arraste a alavanca: ela encaixa nas ordens do telégrafo. O ponteiro verde e o mostrador indicam a rotação real do eixo, que segue a ordem com a rampa do motor.</div>
        </section>
      </div>
    </div>
  );
}
