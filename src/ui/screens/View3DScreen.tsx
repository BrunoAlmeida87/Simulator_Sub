import { SCENE_LAYER_KEYS } from '../../render3d/layers';
/** Tela 6 — Visualização 3D. */
import { usePersisted } from '../persist';
import { useSim } from '../store';
import type { ViewMode } from '../../render3d/SubmarineScene';
import { Scene3D } from '../components/Scene3D';
import { useQuality } from '../graphics';
import { seaSections } from '../components/SeaControls';
import { fmt, fmtSpeed } from '../format';
import { OverlayCtl } from '../components/OverlayCtl';
import { viewSection, type ViewOption } from '../components/OverlayMenu';
import type { LayerKey } from '../components/LayerPanel';
import { SceneLayerPanel } from '../components/SceneLayerPanel';
import { defaultLayers, type SceneLayers } from '../../render3d/layers';

/** preferências adicionais desta tela (preserva as chaves já salvas) */
const V3D_LAYER_DEFAULTS = {
  sonarRays: false,
  sonarWave: false,
  sonarThermocline: false,
  sonarProfile: false,
  sonarCoverage: false,
  sonarHeatmap: false,
  sonarSurface: false,
  sonarBottom: false,
  sonarEchoes: false,
  sonarBearings: false,
  sonarRulers: false,
  pipes: true,
  torpedoes: true,
  flows: true,
  halfCut: false,
  labels: true,
  batteryInfo: true,
  airInfo: false,
  wake: true,
  wind: true,
  pennant: false,
  flag: false,
  depthLines: true,
  pitchAngle: false,
  presLight: false,
  hullOpacity: 0.16,
  resultantGain: 'auto' as const,
};
const V3D_LAYER_KEYS: LayerKey[] = SCENE_LAYER_KEYS;

const VIEWS: ViewOption[] = [
  { id: 'piloto', label: 'Lateral' },
  { id: 'perseguicao', label: 'Perseguição' },
  { id: 'cinematografica', label: 'Cinematográfica' },
  { id: 'perspectiva', label: 'Perspectiva', tip: 'Grande-angular de perto, 3/4 pela proa: a proa (mais perto) aparece bem maior que a popa' },
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
  { id: 'torpedo', label: 'Torpedo (acompanhar)' },
  { id: 'alvo', label: 'Alvo (inimigo, fragata ou terra)' },
  { id: 'missil', label: 'Míssil (acompanhar)', tip: 'Acompanha o último míssil SM39: arraste para girar em volta dele' },
  { id: 'missilCine', label: 'Míssil cinematográfica', tip: 'Planos automáticos: cápsula subindo, saída da água, perseguição rasante, passagem e impacto' },
  { id: 'passadico', label: 'Passadiço (vela)', tip: 'Passadiço: em pé no alto da vela, olhando em volta (arraste); roda do mouse ou B = binóculo 7×50' },
  { id: 'drone', label: 'Drone (câmera livre)', tip: 'Drone: câmera livre no cenário (mar, orla, cidade). WASD mover · Q/E subir/descer · arrastar olhar · Shift rápido · roda = velocidade' },
  { id: 'livre', label: 'Livre' },
];

export function View3DScreen() {
  const e = useSim(8);
  // visualização guardada ao trocar de aba (e ao recarregar a página)
  const [view, setView] = usePersisted<ViewMode>('v3d.view', 'perspectiva');
  const [cut, setCut] = usePersisted('v3d.cut', false);
  const [tankF, setTankF] = usePersisted<string[] | null>('v3d.tankFilter', null);
  const [quality, setQuality] = useQuality();
  const [trail, setTrail] = usePersisted('v3d.trail', true);
  const [fog, setFog] = usePersisted('v3d.fog', true);
  const [vec, setVec] = usePersisted('v3d.vec', false);
  const [trimV, setTrimV] = usePersisted('v3d.trim', false);
  const [hydro, setHydro] = usePersisted('v3d.hydro', false);
  const [hiddenV, setHiddenV] = usePersisted<string[]>('v3d.hiddenVec', []);
  const [dry, setDry] = usePersisted('v3d.dry', false);
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
  const [laySaved, setLay] = usePersisted<Partial<SceneLayers>>('v3d.layers', {});
  const lay = { ...V3D_LAYER_DEFAULTS, ...laySaved };
  const layerValue: SceneLayers = {
    ...defaultLayers(),
    ...lay,
    tankFilter: tankF,
    vectors: vec,
    hydroVectors: hydro,
    trimVectors: trimV,
    hiddenVectors: hiddenV,
    tanks: cut,
    noWater: dry,
    markers: marks,
    trimRef,
    ships,
    trail,
    fog,
  };
  const setLayers = (p: Partial<SceneLayers>) => {
    setVecLayers(p);
    if (p.fog !== undefined) setFog(p.fog);
    if (p.tankFilter !== undefined) setTankF(p.tankFilter);
    if (p.tanks !== undefined) setCut(p.tanks);
    if (p.noWater !== undefined) setDry(p.noWater);
    if (p.markers !== undefined) setMarks(p.markers);
    if (p.trimRef !== undefined) setTrimRef(p.trimRef);
    if (p.ships !== undefined) setShips(p.ships);
    if (p.trail !== undefined) setTrail(p.trail);
    setLay({ ...laySaved, ...p });
  };
  const o = e.outputs;
  const s = e.state;
  return (
    <Scene3D quality={quality} view={view} cutaway={cut} trail={trail} fog={fog} persistKey="v3d" layers={layerValue}>
      <div className="hud tl">
        <div className="line">
          PROF {fmt(o.depthKeel, 1)} m · ALT {fmt(o.altitude, 0)} m
        </div>
        <div className="line">
          VEL {fmtSpeed(s.body.vel.x, 1)} · RPM {fmt(o.rpm, 0)}
        </div>
        <div className="line">
          RUMO {fmt(o.euler.heading, 1)}° · θ {fmt(o.euler.pitch, 1)}° · φ {fmt(o.euler.roll, 1)}°
        </div>
        <div className="line">
          Lemes V {fmt(s.surfaces.bow.actual, 0)}° · R {fmt(s.surfaces.stern.actual, 0)}° · D {fmt(s.surfaces.rudder.actual, 0)}°
        </div>
        <div className="line">TLP {((Object.values(s.ballast).reduce((a, b) => a + b.water, 0) / e.vessel.ballast.tanks.reduce((a, t) => a + t.volume, 0)) * 100).toFixed(0)} % cheios</div>
      </div>
      <OverlayCtl
        persistKey="v3d"
        sections={[
          viewSection(VIEWS, view, (v) => {
            setView(v);
            if (v === 'tanques') setCut(true);
            if (v === 'forcas') setVec(true);
            if (v === 'calado') setTrimRef(true);
            if (v === 'navio') setShips(true);
          }),
          {
            id: 'camadas',
            label: <>Camadas ({V3D_LAYER_KEYS.filter((k) => !!layerValue[k]).length})</>,
            title: 'Tanques, vetores, identificações e ambiente',
            className: 'scene-layer-pop',
            content: <SceneLayerPanel e={e} keys={V3D_LAYER_KEYS} value={layerValue} onChange={setLayers} />,
          },
          ...seaSections(quality, setQuality),
        ]}
      />
      <div className="hud" style={{ bottom: 8, left: 10, color: '#8399b1', fontSize: 11 }}>
        Arraste para girar · roda/pinça para aproximar · botão direito/dois dedos para deslocar. As ondas do 3D são as mesmas da física (estado do mar no seletor).
      </div>
    </Scene3D>
  );
}
