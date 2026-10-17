/** Tela 6 — Visualização 3D. */
import { useState } from 'react';
import { useSim } from '../store';
import type { ViewMode } from '../../render3d/SubmarineScene';
import { Scene3D } from '../components/Scene3D';
import { toKnots } from '../../sim/units';
import { fmt } from '../format';

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'piloto', label: 'Lateral' },
  { id: 'perseguicao', label: 'Perseguição' },
  { id: 'perspectiva', label: 'Perspectiva' },
  { id: 'perfil', label: 'Perfil' },
  { id: 'frente', label: 'Frente' },
  { id: 'topo', label: 'Topo' },
  { id: 'livre', label: 'Livre' },
];

export function View3DScreen() {
  const e = useSim(8);
  const [view, setView] = useState<ViewMode>('perspectiva');
  const [cut, setCut] = useState(false);
  const [trail, setTrail] = useState(true);
  const [fog, setFog] = useState(true);
  const o = e.outputs;
  const s = e.state;
  return (
    <Scene3D view={view} cutaway={cut} trail={trail} fog={fog}>
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
        <div className="seg">
          {VIEWS.map((v) => (
            <button key={v.id} className={view === v.id ? 'on' : ''} onClick={() => setView(v.id)}>
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
        </div>
      </div>
      <div className="hud" style={{ bottom: 8, left: 10, color: '#8399b1', fontSize: 11 }}>
        Arraste para girar · roda/pinça para aproximar · botão direito/dois dedos para deslocar. Mar calmo (ondas não modeladas).
      </div>
    </Scene3D>
  );
}
