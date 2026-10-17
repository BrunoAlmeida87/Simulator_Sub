/** Tela 6 — Visualização 3D. */
import { useEffect, useRef, useState } from 'react';
import { runner, useSim } from '../store';
import type { SubmarineScene, ViewMode } from '../../render3d/SubmarineScene';
import { toKnots } from '../../sim/units';
import { fmt } from '../format';

export function View3DScreen() {
  const e = useSim(8);
  const box = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SubmarineScene | null>(null);
  const lblRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('perspectiva');
  const [cut, setCut] = useState(false);
  const [trail, setTrail] = useState(true);
  const [fog, setFog] = useState(true);
  const viewRef = useRef<ViewMode>('perspectiva');
  const cutRef = useRef(false);
  viewRef.current = view;
  cutRef.current = cut;

  useEffect(() => {
    let raf = 0;
    let disposed = false;
    let ro: ResizeObserver | null = null;
    let unsub: (() => void) | null = null;
    import('../../render3d/SubmarineScene')
      .then(({ SubmarineScene }) => {
        if (disposed || !box.current) return;
        const create = () => {
          try {
            const sc = new SubmarineScene(box.current!, runner);
            sc.setView(viewRef.current);
            sc.setCutaway(cutRef.current);
            return sc;
          } catch (ex) {
            setErr('Não foi possível iniciar o WebGL neste navegador: ' + String(ex));
            return null;
          }
        };
        sceneRef.current = create();
        if (!sceneRef.current) return;
        ro = new ResizeObserver(() => sceneRef.current?.resize());
        ro.observe(box.current);
        // novo motor (reinício/carregamento de estado): reconstrói a cena
        unsub = runner.onEngineReplaced(() => {
          sceneRef.current?.dispose();
          sceneRef.current = create();
        });
        const loop = () => {
          const sc = sceneRef.current;
          if (sc) {
            const labels = sc.render();
            for (const l of labels) {
              const el = lblRefs.current[l.id];
              if (el) {
                el.style.display = l.visible ? 'block' : 'none';
                el.style.left = `${l.x}px`;
                el.style.top = `${l.y}px`;
                el.textContent = l.text;
              }
            }
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      })
      .catch((ex) => setErr(String(ex)));
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      unsub?.();
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setView(view);
  }, [view]);
  useEffect(() => {
    sceneRef.current?.setCutaway(cut);
  }, [cut]);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.showTrail = trail;
  }, [trail]);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.realisticFog = fog;
  }, [fog]);

  const o = e.outputs;
  const s = e.state;
  return (
    <div>
      <div className="view3d" ref={box}>
        {err && <div style={{ padding: 20 }}>{err}</div>}
        <div className="hud tl">
          <div className="line">PROF {fmt(o.depthKeel, 1)} m · ALT {fmt(o.altitude, 0)} m</div>
          <div className="line">VEL {fmt(toKnots(s.body.vel.x), 1)} nós · RPM {fmt(o.rpm, 0)}</div>
          <div className="line">RUMO {fmt(o.euler.heading, 1)}° · θ {fmt(o.euler.pitch, 1)}° · φ {fmt(o.euler.roll, 1)}°</div>
          <div className="line">
            Lemes V {fmt(s.surfaces.bow.actual, 0)}° · R {fmt(s.surfaces.stern.actual, 0)}° · D {fmt(s.surfaces.rudder.actual, 0)}°
          </div>
          <div className="line">TLP {(Object.values(s.ballast).reduce((a, b) => a + b.water, 0) / e.vessel.ballast.tanks.reduce((a, t) => a + t.volume, 0) * 100).toFixed(0)} % cheios</div>
        </div>
        <div className="overlay-ctl">
          <div className="seg">
            {(['perspectiva', 'perfil', 'frente', 'topo'] as ViewMode[]).map((v) => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
            <button className={view === 'livre' ? 'on' : ''} onClick={() => setView('livre')}>
              Livre
            </button>
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
        {['surf', 'sub', 'bot'].map((id) => (
          <div key={id} className="lbl3d" ref={(el) => (lblRefs.current[id] = el)} style={{ display: 'none' }} />
        ))}
        <div className="hud" style={{ bottom: 8, left: 10, color: '#8399b1', fontSize: 11 }}>
          Arraste para girar · roda/pinça para aproximar · botão direito/dois dedos para deslocar. Mar calmo (ondas não modeladas).
        </div>
      </div>
    </div>
  );
}
