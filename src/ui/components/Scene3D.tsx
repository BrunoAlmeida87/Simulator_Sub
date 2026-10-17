/** Componente React que hospeda a cena Three.js (lida do estado da simulação). */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { runner } from '../store';
import type { SubmarineScene, ViewMode } from '../../render3d/SubmarineScene';

export interface Scene3DProps {
  view: ViewMode;
  cutaway?: boolean;
  trail?: boolean;
  fog?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: ReactNode;
  labels?: boolean;
}

export function Scene3D(props: Scene3DProps) {
  const box = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SubmarineScene | null>(null);
  const lblRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [err, setErr] = useState<string | null>(null);
  const opts = useRef(props);
  opts.current = props;

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
            const sc = new SubmarineScene(box.current!, runner, opts.current.view);
            sc.setCutaway(!!opts.current.cutaway);
            sc.showTrail = opts.current.trail ?? true;
            sc.realisticFog = opts.current.fog ?? true;
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
                el.style.display = l.visible && opts.current.labels !== false ? 'block' : 'none';
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
    sceneRef.current?.setView(props.view);
  }, [props.view]);
  useEffect(() => {
    sceneRef.current?.setCutaway(!!props.cutaway);
  }, [props.cutaway]);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.showTrail = props.trail ?? true;
  }, [props.trail]);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.realisticFog = props.fog ?? true;
  }, [props.fog]);

  return (
    <div className={`view3d ${props.className ?? ''}`} ref={box} style={props.style}>
      {err && <div style={{ padding: 20 }}>{err}</div>}
      {['surf', 'sub', 'bot'].map((id) => (
        <div key={id} className="lbl3d" ref={(el) => (lblRefs.current[id] = el)} style={{ display: 'none' }} />
      ))}
      {props.children}
    </div>
  );
}
