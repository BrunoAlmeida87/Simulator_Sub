/** Ajuste apenas visual: mantém a mesma cena montada ao redimensionar ou ampliar. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePersisted } from '../persist';
import './ResizableScene.css';

const MIN = 240;
const MAX = 1200;
const limit = (n: number) => Math.round(Math.max(MIN, Math.min(MAX, Number.isFinite(n) ? n : 460)));

export function ResizableScene({ id, persistKey, children, defaultHeight = 460 }: { id: string; persistKey: string; children: ReactNode; defaultHeight?: number }) {
  const [savedHeight, saveHeight] = usePersisted(`${persistKey}.sceneHeight`, defaultHeight);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const drag = useRef<{ y: number; height: number; next: number } | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const height = limit(dragHeight ?? savedHeight);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      setExpanded(false);
      toggle.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  return (
    <section id={id} className={`scene-viewport${expanded ? ' is-expanded' : ''}`} style={expanded ? undefined : { height }} aria-label="Visualização 3D ajustável">
      <header className="scene-viewport-tools">
        <b>Visualização 3D</b>
        <label>
          Altura
          <input type="range" aria-label="Altura da cena 3D" min={MIN} max={MAX} step={20} value={height} disabled={expanded} onChange={(ev) => saveHeight(limit(Number(ev.target.value)))} />
          <output>{height} px</output>
        </label>
        <button className="btn sm" disabled={expanded} onClick={() => saveHeight(defaultHeight)}>
          Restaurar altura
        </button>
        <button ref={toggle} className={`btn sm${expanded ? ' on' : ''}`} aria-expanded={expanded} aria-controls={`${id}-canvas`} onClick={() => setExpanded(!expanded)}>
          {expanded ? '↙ Restaurar 3D · Esc' : '⛶ Ampliar 3D'}
        </button>
      </header>
      <div id={`${id}-canvas`} className="scene-viewport-canvas">
        {children}
      </div>
      {!expanded && (
        <div
          className="scene-viewport-grip"
          role="separator"
          aria-label="Redimensionar altura da cena 3D"
          aria-orientation="horizontal"
          aria-valuemin={MIN}
          aria-valuemax={MAX}
          aria-valuenow={height}
          tabIndex={0}
          title="Arraste para ajustar a altura · setas ↑ ↓ · duplo clique: altura padrão"
          onPointerDown={(ev) => {
            ev.preventDefault();
            drag.current = { y: ev.clientY, height, next: height };
            ev.currentTarget.setPointerCapture(ev.pointerId);
          }}
          onPointerMove={(ev) => {
            if (!drag.current) return;
            drag.current.next = limit(drag.current.height + ev.clientY - drag.current.y);
            setDragHeight(drag.current.next);
          }}
          onPointerUp={() => {
            if (drag.current) saveHeight(drag.current.next);
            drag.current = null;
            setDragHeight(null);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragHeight(null);
          }}
          onDoubleClick={() => saveHeight(defaultHeight)}
          onKeyDown={(ev) => {
            if (ev.key === 'ArrowUp') saveHeight(limit(height - 20));
            else if (ev.key === 'ArrowDown') saveHeight(limit(height + 20));
            else if (ev.key === 'Home') saveHeight(defaultHeight);
            else return;
            ev.preventDefault();
            ev.stopPropagation();
          }}
        />
      )}
    </section>
  );
}
