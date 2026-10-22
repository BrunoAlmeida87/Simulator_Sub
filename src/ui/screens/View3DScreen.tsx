/** Tela 6 — Visualização 3D. */
import { usePersisted } from '../persist';
import { TankSelector } from '../components/TankSelector';
import { VectorSelector } from '../components/VectorSelector';
import { useSim } from '../store';
import type { ViewMode } from '../../render3d/SubmarineScene';
import { Scene3D } from '../components/Scene3D';
import { useQuality } from '../graphics';
import { SeaControls } from '../components/SeaControls';
import { TrimGainSelect } from '../components/TrimGain';
import { toKnots } from '../../sim/units';
import { fmt } from '../format';
import { OverlayCtl } from '../components/OverlayCtl';
import { LayerPanel, type LayerKey } from '../components/LayerPanel';
import type { SceneLayers } from '../../render3d/layers';

/** camadas sem botão próprio nesta tela (valores de antes: tudo ligado, ar comprimido desligado) */
const V3D_LAYER_DEFAULTS = { pipes: true, flows: true, labels: true, batteryInfo: true, airInfo: false, wake: true, wind: true };
const V3D_LAYER_KEYS: LayerKey[] = ['vectors', 'hydroVectors', 'trimVectors', 'tanks', 'pipes', 'flows', 'labels', 'batteryInfo', 'airInfo', 'wake', 'wind', 'pennant', 'trail', 'markers', 'trimRef', 'ships', 'noWater'];

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'piloto', label: 'Lateral' },
  { id: 'perseguicao', label: 'Perseguição' },
  { id: 'perspectiva', label: 'Perspectiva' },
  { id: 'perfil', label: 'Perfil' },
  { id: 'frente', label: 'Frente' },
  { id: 'topo', label: 'Topo' },
  { id: 'fixa', label: 'Fixa' },
  { id: 'superficie', label: 'Superfície' },
  { id: 'submerso', label: 'Submerso' },
  { id: 'tanques', label: 'Vista tanques' },
  { id: 'forcas', label: 'Vista forças' },
  { id: 'calado', label: 'Calado' },
  { id: 'navio', label: 'Navio próximo' },
  { id: 'livre', label: 'Livre' },
];

export function View3DScreen() {
  const e = useSim(8);
  // visualização guardada ao trocar de aba (e ao recarregar a página)
  const [view, setView] = usePersisted<ViewMode>('v3d.view', 'perspectiva');
  const [cut, setCut] = usePersisted('v3d.cut', false);
  const [tankF, setTankF] = usePersisted<string[] | null>('v3d.tankFilter', null);
  const [selOpen, setSelOpen] = usePersisted('v3d.tankSelOpen', true);
  const [quality, setQuality] = useQuality();
  const [trail, setTrail] = usePersisted('v3d.trail', true);
  const [fog, setFog] = usePersisted('v3d.fog', true);
  const [vec, setVec] = usePersisted('v3d.vec', false);
  const [trimV, setTrimV] = usePersisted('v3d.trim', false);
  const [hydro, setHydro] = usePersisted('v3d.hydro', false);
  const [hiddenV, setHiddenV] = usePersisted<string[]>('v3d.hiddenVec', []);
  const [vecOpen, setVecOpen] = usePersisted('v3d.vecOpen', true);
  const [dry, setDry] = usePersisted('v3d.dry', false);
  const anyVec = vec || hydro || trimV;
  const setVecLayers = (v: { vectors?: boolean; hydroVectors?: boolean; trimVectors?: boolean; hiddenVectors?: string[] }) => {
    if (v.vectors !== undefined) setVec(v.vectors);
    if (v.hydroVectors !== undefined) setHydro(v.hydroVectors);
    if (v.trimVectors !== undefined) setTrimV(v.trimVectors);
    if (v.hiddenVectors !== undefined) setHiddenV(v.hiddenVectors);
  };
  const [marks, setMarks] = usePersisted('v3d.marks', false);
  const [trimRef, setTrimRef] = usePersisted('v3d.trimRef', false);
  const [ships, setShips] = usePersisted('v3d.ships', true);
  // demais camadas (antes fixas: identificações, tubulações, escoamentos e o rótulo da bateria)
  const [layOpen, setLayOpen] = usePersisted('v3d.layersOpen', false);
  const [laySaved, setLay] = usePersisted<Partial<SceneLayers>>('v3d.layers', {});
  const lay = { ...V3D_LAYER_DEFAULTS, ...laySaved };
  const layerValue: Partial<SceneLayers> = { ...lay, vectors: vec, hydroVectors: hydro, trimVectors: trimV, hiddenVectors: hiddenV, tanks: cut, noWater: dry, markers: marks, trimRef, ships, trail };
  const setLayers = (p: Partial<SceneLayers>) => {
    setVecLayers(p);
    if (p.tanks !== undefined) setCut(p.tanks);
    if (p.noWater !== undefined) setDry(p.noWater);
    if (p.markers !== undefined) setMarks(p.markers);
    if (p.trimRef !== undefined) setTrimRef(p.trimRef);
    if (p.ships !== undefined) setShips(p.ships);
    if (p.trail !== undefined) setTrail(p.trail);
    const rest: Partial<SceneLayers> = {};
    for (const k of Object.keys(V3D_LAYER_DEFAULTS) as (keyof typeof V3D_LAYER_DEFAULTS)[]) if (p[k] !== undefined) rest[k] = p[k];
    if (Object.keys(rest).length) setLay({ ...laySaved, ...rest });
  };
  const o = e.outputs;
  const s = e.state;
  return (
    <Scene3D
      quality={quality}
      view={view}
      cutaway={cut}
      trail={trail}
      fog={fog}
      persistKey="v3d"
      layers={{
        tankFilter: tankF,
        vectors: vec,
        hydroVectors: hydro,
        trimVectors: trimV,
        hiddenVectors: hiddenV,
        noWater: dry,
        markers: marks,
        trimRef,
        ships,
        ...lay,
      }}
    >
      <div className="hud tl">
        <div className="line">
          PROF {fmt(o.depthKeel, 1)} m · ALT {fmt(o.altitude, 0)} m
        </div>
        <div className="line">
          VEL {fmt(toKnots(s.body.vel.x), 1)} nós · RPM {fmt(o.rpm, 0)}
        </div>
        <div className="line">
          RUMO {fmt(o.euler.heading, 1)}° · θ {fmt(o.euler.pitch, 1)}° · φ {fmt(o.euler.roll, 1)}°
        </div>
        <div className="line">
          Lemes V {fmt(s.surfaces.bow.actual, 0)}° · R {fmt(s.surfaces.stern.actual, 0)}° · D {fmt(s.surfaces.rudder.actual, 0)}°
        </div>
        <div className="line">TLP {((Object.values(s.ballast).reduce((a, b) => a + b.water, 0) / e.vessel.ballast.tanks.reduce((a, t) => a + t.volume, 0)) * 100).toFixed(0)} % cheios</div>
      </div>
      <OverlayCtl>
        <SeaControls quality={quality} setQuality={setQuality} />
        <div className="seg">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={view === v.id ? 'on' : ''}
              onClick={() => {
                setView(v.id);
                if (v.id === 'tanques') setCut(true);
                if (v.id === 'forcas') setVec(true);
                if (v.id === 'calado') setTrimRef(true);
                if (v.id === 'navio') setShips(true);
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="btngroup">
          <button className={`btn sm ${cut ? 'on' : ''}`} onClick={() => setCut(!cut)}>
            Corte / tanques
          </button>
          <button className={`btn sm ${fog ? 'on' : ''}`} onClick={() => setFog(!fog)}>
            Turbidez
          </button>
          <button
            className={`btn sm ${anyVec ? 'on' : ''}`}
            onClick={() => {
              // liga os vetores e abre a escolha; um novo clique desliga todos
              if (anyVec)
                setVecLayers({
                  vectors: false,
                  hydroVectors: false,
                  trimVectors: false,
                });
              else {
                setVecLayers({ vectors: true, hydroVectors: true });
                setVecOpen(true);
              }
            }}
            title="Liga/desliga os vetores e abre a escolha de quais mostrar"
          >
            Vetores {anyVec ? '▾' : ''}
          </button>
          <button className={`btn sm ${dry ? 'on' : ''}`} onClick={() => setDry(!dry)} title="Tira (ou recoloca) o mar para ver melhor o submarino">
            {dry ? '💧 Pôr água' : '💧 Tirar água'}
          </button>
          <button className={`btn sm ${layOpen ? 'on' : ''}`} onClick={() => setLayOpen(!layOpen)} title="Todas as camadas, por grupo (vetores, interior, mar e efeitos, rótulos, ambiente), com marcar/desmarcar">
            Camadas ({V3D_LAYER_KEYS.filter((k) => !!layerValue[k]).length}) {layOpen ? '▴' : '▾'}
          </button>
        </div>
        {layOpen && (
          <div className="tanksel-pop">
            <LayerPanel keys={V3D_LAYER_KEYS} value={layerValue} onChange={setLayers} />
          </div>
        )}
        {trimRef && <TrimGainSelect />}
        {anyVec && (
          <div className="tanksel-pop">
            <button className="btn sm" onClick={() => setVecOpen(!vecOpen)}>
              {vecOpen ? '▴ Vetores visíveis' : '▾ Escolher vetores'}
            </button>
            {vecOpen && (
              <VectorSelector
                value={{
                  vectors: vec,
                  hydroVectors: hydro,
                  trimVectors: trimV,
                  hiddenVectors: hiddenV,
                }}
                onChange={setVecLayers}
              />
            )}
          </div>
        )}
        {cut && (
          <div className="tanksel-pop">
            <button className="btn sm" onClick={() => setSelOpen(!selOpen)}>
              {selOpen ? '▴ Tanques visíveis' : `▾ Escolher tanques${tankF ? ` (${tankF.length})` : ''}`}
            </button>
            {selOpen && <TankSelector e={e} value={tankF} onChange={setTankF} />}
          </div>
        )}
      </OverlayCtl>
      <div className="hud" style={{ bottom: 8, left: 10, color: '#8399b1', fontSize: 11 }}>
        Arraste para girar · roda/pinça para aproximar · botão direito/dois dedos para deslocar. As ondas do 3D são as mesmas da física (estado do mar no seletor).
      </div>
    </Scene3D>
  );
}
