/** Tela 6 — Visualização 3D. */
import { useState } from 'react';
import { usePersisted } from '../persist';
import { TankSelector } from '../components/TankSelector';
import { useSim } from '../store';
import type { ViewMode } from '../../render3d/SubmarineScene';
import { Scene3D, defaultQuality, saveQuality } from '../components/Scene3D';
import { SeaControls } from '../components/SeaControls';
import type { OceanQuality } from '../../render3d/Ocean';
import { toKnots } from '../../sim/units';
import { fmt } from '../format';

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
  { id: 'livre', label: 'Livre' },
];

export function View3DScreen() {
  const e = useSim(8);
  // visualização guardada ao trocar de aba (e ao recarregar a página)
  const [view, setView] = usePersisted<ViewMode>('v3d.view', 'perspectiva');
  const [cut, setCut] = usePersisted('v3d.cut', false);
  const [tankF, setTankF] = usePersisted<string[] | null>('v3d.tankFilter', null);
  const [selOpen, setSelOpen] = usePersisted('v3d.tankSelOpen', true);
  const [quality, setQualityS] = useState<OceanQuality>(defaultQuality);
  const setQuality = (q: OceanQuality) => {
    saveQuality(q);
    setQualityS(q);
  };
  const [trail, setTrail] = usePersisted('v3d.trail', true);
  const [fog, setFog] = usePersisted('v3d.fog', true);
  const [vec, setVec] = usePersisted('v3d.vec', false);
  const [trimV, setTrimV] = usePersisted('v3d.trim', false);
  const [marks, setMarks] = usePersisted('v3d.marks', false);
  const o = e.outputs;
  const s = e.state;
  return (
    <Scene3D quality={quality} view={view} cutaway={cut} trail={trail} fog={fog} persistKey="v3d" layers={{ tankFilter: tankF, vectors: vec, hydroVectors: vec, trimVectors: trimV, markers: marks, pipes: true, flows: true, labels: true }}>
      <div className="hud tl">
        <div className="line">PROF {fmt(o.depthKeel, 1)} m · ALT {fmt(o.altitude, 0)} m</div>
        <div className="line">VEL {fmt(toKnots(s.body.vel.x), 1)} nós · RPM {fmt(o.rpm, 0)}</div>
        <div className="line">RUMO {fmt(o.euler.heading, 1)}° · θ {fmt(o.euler.pitch, 1)}° · φ {fmt(o.euler.roll, 1)}°</div>
        <div className="line">
          Lemes V {fmt(s.surfaces.bow.actual, 0)}° · R {fmt(s.surfaces.stern.actual, 0)}° · D {fmt(s.surfaces.rudder.actual, 0)}°
        </div>
        <div className="line">TLP {((Object.values(s.ballast).reduce((a, b) => a + b.water, 0) / e.vessel.ballast.tanks.reduce((a, t) => a + t.volume, 0)) * 100).toFixed(0)} % cheios</div>
      </div>
      <div className="overlay-ctl">
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
          <button className={`btn sm ${trail ? 'on' : ''}`} onClick={() => setTrail(!trail)}>
            Trajetória
          </button>
          <button className={`btn sm ${fog ? 'on' : ''}`} onClick={() => setFog(!fog)}>
            Turbidez
          </button>
          <button className={`btn sm ${vec ? 'on' : ''}`} onClick={() => setVec(!vec)} title="Vetores de peso, empuxo, resultante, hélice e lemes">
            Vetores
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
      <div className="hud" style={{ bottom: 8, left: 10, color: '#8399b1', fontSize: 11 }}>
        Arraste para girar · roda/pinça para aproximar · botão direito/dois dedos para deslocar. As ondas do 3D são as mesmas da física (estado do mar no seletor).
      </div>
    </Scene3D>
  );
}
