/**
 * DRONE (câmera livre) — painel: arrastar = olhar, W A S D / setas = mover na
 * horizontal (relativo à visada), Q / E (ou PgUp / PgDn) = subir / descer,
 * Shift = rápido, roda = velocidade; no toque, botões de movimento. Enquanto
 * o drone está na tela, essas teclas NÃO comandam os lemes (são capturadas
 * antes do atalho global). Só visual: não altera a simulação.
 */
import { useEffect, useRef, useState } from 'react';
import { runner, useSim } from '../store';
import { droneCtl } from '../droneCtl';
import { droneClearance, droneSpeed } from '../../render3d/drone';
import { deg3, km } from './OpticsHud';
import { fmt } from '../format';
import { presPlayer } from '../presBuilder/player';

/** durante uma apresentação do Estúdio, ← → Page Up e Page Down passam as etapas (controle remoto de slides) */
const PRES_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']);

const MOVE: Record<string, [number, number, number]> = {
  KeyW: [1, 0, 0],
  ArrowUp: [1, 0, 0],
  KeyS: [-1, 0, 0],
  ArrowDown: [-1, 0, 0],
  KeyA: [0, -1, 0],
  ArrowLeft: [0, -1, 0],
  KeyD: [0, 1, 0],
  ArrowRight: [0, 1, 0],
  KeyQ: [0, 0, 1],
  PageUp: [0, 0, 1],
  KeyE: [0, 0, -1],
  PageDown: [0, 0, -1],
};

export function DroneHud({ compact, keyboard = true, follow }: { compact?: boolean; keyboard?: boolean; follow?: boolean }) {
  const e = useSim(8);
  const layer = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const keys = useRef(new Set<string>());
  const touch = useRef<[number, number, number]>([0, 0, 0]);
  const [mul, setMul] = useState(droneCtl.input.speedMul);
  const [fastT, setFastT] = useState(false);
  const fastRef = useRef(false);
  fastRef.current = fastT;
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  const apply = () => {
    let f = touch.current[0];
    let s = touch.current[1];
    let u = touch.current[2];
    for (const k of keys.current) {
      const m = MOVE[k];
      if (!m) continue;
      f += m[0];
      s += m[1];
      u += m[2];
    }
    const inp = droneCtl.input;
    inp.f = Math.max(-1, Math.min(1, f));
    inp.s = Math.max(-1, Math.min(1, s));
    inp.u = Math.max(-1, Math.min(1, u));
    inp.fast = keys.current.has('ShiftLeft') || keys.current.has('ShiftRight') || fastRef.current;
  };

  // teclado em fase de captura: as teclas do drone não chegam ao atalho global dos lemes
  useEffect(() => {
    if (!keyboard || follow) return;
    const isField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
    };
    const down = (ev: KeyboardEvent) => {
      if (isField(ev.target) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (presPlayer.active && PRES_KEYS.has(ev.code)) return;
      if (MOVE[ev.code] || ev.code.startsWith('Shift')) {
        keys.current.add(ev.code);
        apply();
        if (MOVE[ev.code]) {
          ev.preventDefault();
          ev.stopPropagation();
        }
      }
    };
    const up = (ev: KeyboardEvent) => {
      if (keys.current.delete(ev.code)) apply();
      if (MOVE[ev.code]) ev.stopPropagation();
    };
    const blur = () => {
      keys.current.clear();
      apply();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', blur);
      keys.current.clear();
      touch.current = [0, 0, 0];
      apply();
    };
  }, [keyboard, follow]);

  // roda: velocidade
  useEffect(() => {
    const el = layer.current;
    if (!el || follow) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const m = Math.max(0.1, Math.min(10, droneCtl.input.speedMul * (ev.deltaY < 0 ? 1.25 : 0.8)));
      droneCtl.input.speedMul = m;
      setMul(m);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [follow]);

  const hold = (label: string, axis: 0 | 1 | 2, sign: number, title: string) => (
    <button
      className="btn"
      title={title}
      onPointerDown={(ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
        touch.current[axis] = sign;
        apply();
      }}
      onPointerUp={() => {
        touch.current[axis] = 0;
        apply();
      }}
      onPointerCancel={() => {
        touch.current[axis] = 0;
        apply();
      }}
      onContextMenu={(ev) => ev.preventDefault()}
    >
      {label}
    </button>
  );

  const p = droneCtl.pose;
  const s = e.state;
  const ground = p ? -e.env.bottomDepthAt(p.n, p.e) : 0;
  const dn = p ? s.body.pos.x - p.n : 0;
  const de = p ? s.body.pos.y - p.e : 0;
  const dist = Math.hypot(dn, de);
  const lookAtSub = () => {
    const q = droneCtl.pose;
    if (!q) return;
    const n = runner.engine.state.body.pos.x - q.n;
    const ea = runner.engine.state.body.pos.y - q.e;
    const dv = -runner.engine.state.body.pos.z - q.up;
    q.yaw = (Math.atan2(ea, n) * 180) / Math.PI;
    q.pitch = (Math.atan2(dv, Math.hypot(n, ea)) * 180) / Math.PI;
  };

  return (
    <div className={`drone-hud${compact ? ' compact' : ''}`}>
      <div
        className={`drone-drag${follow ? ' ro' : ''}`}
        ref={layer}
        onPointerDown={(ev) => {
          const q = droneCtl.pose;
          if (follow || !q) return;
          (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
          drag.current = { x: ev.clientX, y: ev.clientY, yaw: q.yaw, pitch: q.pitch };
        }}
        onPointerMove={(ev) => {
          const d = drag.current;
          const q = droneCtl.pose;
          if (!d || !q) return;
          const k = 60 / Math.max(200, (ev.currentTarget as HTMLElement).clientHeight);
          q.yaw = d.yaw - (ev.clientX - d.x) * k;
          q.pitch = Math.max(-89, Math.min(89, d.pitch + (ev.clientY - d.y) * k));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      <div className="drone-box" onPointerDown={(ev) => ev.stopPropagation()}>
        {!compact && <b className="drone-title">Drone (câmera livre)</b>}
        {p && (
          <div className="mono drone-read">
            {compact ? '' : 'altura '}
            {fmt(p.up, 0)} m{ground > 0 && p.up > ground ? ` (${fmt(p.up - ground, 0)} m sobre a terra)` : ''} · {fmt(droneSpeed(droneClearance(p.up, ground), false, mul), 0)} m/s
            {!compact && (
              <>
                {' '}
                (×{fmt(mul, 1)}) · rumo {deg3(p.yaw)}° · submarino a {dist < 1000 ? `${fmt(dist, 0)} m` : km(dist)} {deg3((Math.atan2(de, dn) * 180) / Math.PI)}°
              </>
            )}
          </div>
        )}
        {!compact && !follow && <div className="subtle drone-keys">WASD mover · Q/E subir/descer · arrastar olhar · Shift rápido · roda = velocidade</div>}
        {follow && <div className="subtle">seguindo o drone da janela de controle</div>}
        {!follow && (
          <div className="row drone-btns">
            <button className="btn sm" onClick={lookAtSub} title="Vira a câmera para o submarino">
              ⌖ Olhar o submarino
            </button>
            <button className="btn sm" onClick={() => droneCtl.reset()} title="Volta para cima e atrás do submarino">
              ↺ Voltar
            </button>
          </div>
        )}
      </div>
      {!follow && (coarse || compact) && (
        <div className="drone-pad" onPointerDown={(ev) => ev.stopPropagation()}>
          <span />
          {hold('▲', 0, 1, 'Avançar (W)')}
          {hold('⤒', 2, 1, 'Subir (Q)')}
          {hold('◀', 1, -1, 'Para a esquerda (A)')}
          {hold('▼', 0, -1, 'Recuar (S)')}
          {hold('▶', 1, 1, 'Para a direita (D)')}
          <span />
          <button
            className={`btn ${fastT ? 'on' : ''}`}
            title="Rápido (×4, como o Shift)"
            onClick={() => {
              fastRef.current = !fastT;
              setFastT(!fastT);
              apply();
            }}
          >
            ⇧
          </button>
          {hold('⤓', 2, -1, 'Descer (E)')}
        </div>
      )}
    </div>
  );
}
