/**
 * SUBMARINO 3D EM PICTURE-IN-PICTURE na sala de comando: janela móvel
 * (arrastar pelo título), em três tamanhos, com as vistas da aba 3D e
 * camadas rápidas. É uma cena própria (não muda a segunda janela).
 */
import { useRef, useState } from 'react';
import { usePersisted } from '../persist';
import { Scene3D } from '../components/Scene3D';
import type { ViewMode } from '../../render3d/SubmarineScene';

const VIEWS: [ViewMode, string][] = [
  ['perseguicao', 'Perseguição'],
  ['piloto', 'Lateral'],
  ['perspectiva', 'Perspectiva'],
  ['perfil', 'Perfil'],
  ['frente', 'Frente'],
  ['topo', 'Topo'],
  ['superficie', 'Superfície'],
  ['submerso', 'Submerso'],
  ['tanques', 'Tanques (corte)'],
  ['forcas', 'Forças'],
  ['calado', 'Calado'],
  ['livre', 'Livre (arrastar)'],
];

type PipSize = 'P' | 'M' | 'G';
const SIZES: [PipSize, string][] = [
  ['P', 'Pequena'],
  ['M', 'Média'],
  ['G', 'Grande'],
];

interface PipLayers {
  vectors: boolean;
  tanks: boolean;
  noWater: boolean;
  trail: boolean;
}

const LAYER_BTNS: [keyof PipLayers, string, string][] = [
  ['vectors', 'Vetores', 'Peso, empuxo e resultante'],
  ['tanks', 'Tanques', 'Casco em corte com tanques e escoamentos'],
  ['noWater', 'Sem água', 'Esconde o mar (vê o casco inteiro)'],
  ['trail', 'Rastro', 'Trajetória percorrida'],
];

export function RoomPip({ onClose }: { onClose: () => void }) {
  const [view, setView] = usePersisted<ViewMode>('room.pipView', 'perseguicao');
  const [size, setSize] = usePersisted<PipSize>('room.pipSize', 'M');
  const [pos, setPos] = usePersisted<{ r: number; b: number }>('room.pipPos', { r: 8, b: 52 });
  const [lay, setLay] = usePersisted<PipLayers>('room.pipLayers', { vectors: false, tanks: false, noWater: false, trail: false });
  const [opts, setOpts] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; r: number; b: number } | null>(null);

  // mantém a janela dentro da vista
  const clampPos = (r: number, b: number) => {
    const el = box.current;
    const host = el?.parentElement;
    if (!el || !host) return { r, b };
    const maxR = Math.max(0, host.clientWidth - el.offsetWidth);
    const maxB = Math.max(0, host.clientHeight - el.offsetHeight);
    return { r: Math.round(Math.min(maxR, Math.max(0, r))), b: Math.round(Math.min(maxB, Math.max(0, b))) };
  };
  const tanks = lay.tanks || view === 'tanques';
  const vectors = lay.vectors || view === 'forcas';

  return (
    <div ref={box} className={`room-pip size-${size}`} style={{ right: pos.r, bottom: pos.b }} onPointerDown={(ev) => ev.stopPropagation()} onWheel={(ev) => ev.stopPropagation()}>
      <div
        className="room-pip-head"
        title="Arraste para mover a janela"
        onPointerDown={(ev) => {
          if ((ev.target as HTMLElement).closest('button, select')) return;
          (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
          drag.current = { x: ev.clientX, y: ev.clientY, r: pos.r, b: pos.b };
        }}
        onPointerMove={(ev) => {
          const d = drag.current;
          if (d) setPos(clampPos(d.r - (ev.clientX - d.x), d.b - (ev.clientY - d.y)));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <b className="room-pip-title">⠿ Submarino 3D</b>
        <select value={view} onChange={(ev) => setView(ev.target.value as ViewMode)} aria-label="Vista do submarino">
          {VIEWS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <span className="seg">
          {SIZES.map(([k, l]) => (
            <button
              key={k}
              className={size === k ? 'on' : ''}
              title={`Janela ${l.toLowerCase()}`}
              onClick={() => {
                setSize(k);
                // depois do novo tamanho, volta para dentro da vista
                requestAnimationFrame(() => setPos(clampPos(pos.r, pos.b)));
              }}
            >
              {k}
            </button>
          ))}
        </span>
        <button className={`btn sm ${opts ? 'on' : ''}`} onClick={() => setOpts(!opts)} title="Camadas da vista">
          Camadas
        </button>
        <button className="btn sm" onClick={onClose} title="Fechar o submarino 3D (P)">
          ✕
        </button>
      </div>
      {opts && (
        <div className="room-pip-opts">
          {LAYER_BTNS.map(([k, l, tip]) => (
            <button key={k} className={`btn sm ${lay[k] ? 'on' : ''}`} title={tip} onClick={() => setLay({ ...lay, [k]: !lay[k] })}>
              {l}
            </button>
          ))}
        </div>
      )}
      <Scene3D
        view={view}
        quality="baixa"
        labels={false}
        syncVisual={false}
        persistKey="roompip"
        layers={{
          markers: true,
          wake: true,
          ships: true,
          labels: false,
          vectors,
          hydroVectors: false,
          trimVectors: false,
          tanks,
          pipes: tanks,
          flows: tanks,
          batteryInfo: false,
          airInfo: false,
          trimRef: false,
          trail: lay.trail,
          noWater: lay.noWater,
        }}
      />
    </div>
  );
}
