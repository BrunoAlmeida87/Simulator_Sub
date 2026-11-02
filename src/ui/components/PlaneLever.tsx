/**
 * LEME HORIZONTAL (vante ou ré) como ALAVANCA VERTICAL: o controle se move na
 * mesma direção que o submarino — para CIMA = SUBIR, para BAIXO = DESCER.
 * Antes eram botões "−5 −1 [0°] +1 +5" e barras deitadas, e não dava para saber
 * de relance se o leme mandava subir ou descer.
 *
 * - arrastar o punho (ou clicar na trilha) dá a ordem; ▲/▼ somam 1° ou 5°; 0 zera;
 * - teclado: ↑/↓ 1°, Page Up/Page Down 5°, Home ou Enter zera;
 * - punho ciano = ordem (CMD); seta verde = posição real do leme;
 * - o texto ao lado repete a ordem com a direção por extenso ("5° SUBIR").
 * Convenção da física: ângulo positivo = SUBIR (como em todas as telas).
 * Só envia o Command 'surface' (o mesmo das outras telas e da Sala).
 */
import { useRef, useState, type ReactNode } from 'react';
import { cmd } from '../store';
import type { SimulationEngine } from '../../sim/core/engine';
import { fmt } from '../format';

type PlaneId = 'bow' | 'stern';
const NAME: Record<PlaneId, string> = { bow: 'Vante', stern: 'Ré' };

/** direção por extenso de um ângulo de leme horizontal */
export function planeDir(a: number): string {
  return a > 0.5 ? 'SUBIR' : a < -0.5 ? 'DESCER' : 'A ZERO';
}

export function PlaneLever({ e, id, height = 88, owner, name }: { e: SimulationEngine; id: PlaneId; height?: number; owner?: ReactNode; name?: string }) {
  const st = e.state.surfaces[id];
  const max = e.vessel.fins.find((f) => f.id === id)?.maxDeflection ?? 25;
  const [drag, setDrag] = useState<number | null>(null);
  const last = useRef<number | null>(null);
  const clamp = (a: number) => Math.max(-max, Math.min(max, Math.round(a)));
  const send = (a: number) => cmd({ type: 'surface', id, angle: clamp(a) });

  // trilha: topo = +max (SUBIR), base = −max (DESCER)
  const W = 30;
  const H = height;
  const pad = 9;
  const y = (a: number) => pad + ((max - a) / (2 * max)) * (H - 2 * pad);
  const angleAt = (el: Element, clientY: number) => {
    const r = el.getBoundingClientRect();
    const yy = ((clientY - r.top) / r.height) * H;
    return clamp(max - ((yy - pad) / (H - 2 * pad)) * 2 * max);
  };
  const v = drag ?? st.cmd;
  const dir = planeDir(v);
  const label = name ?? NAME[id];
  const ticks = [-20, -10, 10, 20].filter((t) => Math.abs(t) < max);

  return (
    <div className={`plane-lever dir-${dir === 'SUBIR' ? 'up' : dir === 'DESCER' ? 'down' : 'zero'}`}>
      <div className="pl-btns" role="group" aria-label={`Lemes de ${label.toLowerCase()}`}>
        <button onClick={() => send(st.cmd + 5)} title="5° a subir" aria-label={`${label}: 5° a subir`}>
          ▲5
        </button>
        <button onClick={() => send(st.cmd + 1)} title="1° a subir" aria-label={`${label}: 1° a subir`}>
          ▲1
        </button>
        <button className="zero" onClick={() => send(0)} title="Leme a zero" aria-label={`${label}: leme a zero`}>
          0
        </button>
        <button onClick={() => send(st.cmd - 1)} title="1° a descer" aria-label={`${label}: 1° a descer`}>
          ▼1
        </button>
        <button onClick={() => send(st.cmd - 5)} title="5° a descer" aria-label={`${label}: 5° a descer`}>
          ▼5
        </button>
      </div>
      <svg
        className="pl-track"
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="slider"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={`Lemes de ${label.toLowerCase()} (para cima = subir)`}
        aria-valuemin={-max}
        aria-valuemax={max}
        aria-valuenow={Math.round(v)}
        aria-valuetext={`${fmt(Math.abs(v), 0)} graus, ${planeDir(v).toLowerCase()}`}
        onPointerDown={(ev) => {
          ev.currentTarget.setPointerCapture(ev.pointerId);
          const a = angleAt(ev.currentTarget, ev.clientY);
          last.current = a;
          setDrag(a);
        }}
        onPointerMove={(ev) => {
          if (drag === null) return;
          const a = angleAt(ev.currentTarget, ev.clientY);
          last.current = a;
          setDrag(a);
        }}
        onPointerUp={() => {
          if (last.current !== null) send(last.current);
          last.current = null;
          setDrag(null);
        }}
        onPointerCancel={() => {
          last.current = null;
          setDrag(null);
        }}
        onKeyDown={(ev) => {
          const step = ev.key === 'ArrowUp' ? 1 : ev.key === 'ArrowDown' ? -1 : ev.key === 'PageUp' ? 5 : ev.key === 'PageDown' ? -5 : 0;
          if (step) send(st.cmd + step);
          else if (ev.key === 'Home' || ev.key === 'Enter') send(0);
          else return;
          ev.preventDefault();
          ev.stopPropagation();
        }}
      >
        <title>{`Lemes de ${label.toLowerCase()}: arraste para cima para SUBIR e para baixo para DESCER`}</title>
        {/* metade de cima (subir) e de baixo (descer) com tons diferentes */}
        <rect x={W / 2 - 5} y={y(max)} width={10} height={y(0) - y(max)} rx={4} className="pl-rail up" />
        <rect x={W / 2 - 5} y={y(0)} width={10} height={y(-max) - y(0)} rx={4} className="pl-rail down" />
        {ticks.map((t) => (
          <line key={t} x1={W / 2 - 8} x2={W / 2 + 8} y1={y(t)} y2={y(t)} className="pl-tick" />
        ))}
        <line x1={2} x2={W - 2} y1={y(0)} y2={y(0)} className="pl-zero" />
        {/* ordem: faixa do zero até a ordem e punho */}
        {Math.abs(v) >= 0.5 && <rect x={W / 2 - 3} y={Math.min(y(0), y(v))} width={6} height={Math.abs(y(v) - y(0))} className="pl-fill" />}
        <rect x={3} y={y(v) - 5} width={W - 6} height={10} rx={4} className="pl-knob" />
        {/* posição real do leme */}
        <path d={`M${W - 1} ${y(st.actual)} l-6 -5 v10 z`} className="pl-real" />
      </svg>
      <div className="pl-read">
        <span className="pl-end up">▲ SUBIR</span>
        <span className="pl-mid">
          <b className="pl-name">
            {label} {owner}
          </b>
          <span className="pl-val">
            {fmt(Math.abs(v), 0)}° <em>{dir === 'A ZERO' ? '' : dir}</em>
          </span>
          <span className="pl-act">
            real {fmt(Math.abs(st.actual), 0)}°{st.jammed ? ' · TRAVADO' : ''}
          </span>
        </span>
        <span className="pl-end down">▼ DESCER</span>
      </div>
    </div>
  );
}
