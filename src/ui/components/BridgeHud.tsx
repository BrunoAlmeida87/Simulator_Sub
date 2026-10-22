/**
 * PASSADIÇO — painel da vista em primeira pessoa no alto da vela: olhar em
 * volta (arrastar, setas), BINÓCULO 7×50 (roda do mouse, tecla B ou botão)
 * com a máscara das duas oculares, retículo em milésimos e agulha (bússola)
 * no pé do campo; marcação verdadeira da linha de visada, altura do olho e
 * horizonte, identificação opcional dos contatos à vista e o aviso de vela
 * submersa. Só visual: lê o estado e a visada; não altera a simulação.
 */
import { memo, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { runner, useSim } from '../store';
import { usePersisted } from '../persist';
import { graphics } from '../graphics';
import { geoOriginOf } from '../routeNav';
import type { BridgeSight } from '../../render3d/SubmarineScene';
import { BINO_FOV, BINO_MAG, BRIDGE_ELEV0, NAKED_FOV, bridgeFelt, bridgeState, bridgeVisible, type BridgeContact } from '../../render3d/bridge';
import { bridgeSight } from '../bridgeSight';
import { BearingTape, CARD, deg3, km, relTxt, wrap180, wrap360 } from './OpticsHud';
import { fmt } from '../format';

const ACTS = { geoOrigin: () => geoOriginOf(runner.engine), traffic: () => graphics.get().traffic };

/** geometria das duas oculares do binóculo (px) */
export function binoGeom(w: number, h: number): { r: number; x1: number; x2: number; cy: number } {
  const r = Math.max(40, Math.min(h * 0.47, w * 0.3));
  const sep = r * 1.16;
  return { r, x1: w / 2 - sep / 2, x2: w / 2 + sep / 2, cy: h / 2 };
}

/** máscara das duas oculares, com bordas suaves e escurecimento perto da borda (só muda com o tamanho) */
const BinoMask = memo(function BinoMask({ w, h }: { w: number; h: number }) {
  const id = useId().replace(/:/g, '');
  const g = binoGeom(w, h);
  return (
    <svg className="bridge-mask" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <filter id={`bs${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={g.r * 0.03} />
        </filter>
        <filter id={`bv${id}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={g.r * 0.14} />
        </filter>
        <mask id={`bm${id}`}>
          <rect width={w} height={h} fill="#fff" />
          <g filter={`url(#bs${id})`}>
            <circle cx={g.x1} cy={g.cy} r={g.r} fill="#000" />
            <circle cx={g.x2} cy={g.cy} r={g.r} fill="#000" />
          </g>
        </mask>
        <mask id={`bw${id}`}>
          <rect width={w} height={h} fill="#fff" />
          <g filter={`url(#bv${id})`}>
            <circle cx={g.x1} cy={g.cy} r={g.r * 0.82} fill="#000" />
            <circle cx={g.x2} cy={g.cy} r={g.r * 0.82} fill="#000" />
          </g>
        </mask>
      </defs>
      <rect width={w} height={h} fill="rgba(0,0,0,0.55)" mask={`url(#bw${id})`} />
      <rect width={w} height={h} fill="#000" mask={`url(#bm${id})`} />
    </svg>
  );
});

/** retículo do binóculo (milésimos: 1 mil ≈ 1 m a 1 km) e a agulha no pé do campo */
function BinoReticle({ w, h, tanV, los }: { w: number; h: number; tanV: number; los: number }) {
  const id = useId().replace(/:/g, '');
  const g = binoGeom(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const pxMil = (h / 2 / tanV) * 0.001;
  let step = 5;
  while (step * pxMil < 9) step *= 2;
  const lab = step * 2;
  const span = Math.min(g.r * 1.2, w * 0.42);
  const nH = Math.floor(span / (step * pxMil));
  const nV = Math.floor((g.r * 0.45) / (step * pxMil));
  const ink = (x1: number, y1: number, x2: number, y2: number, k: string, wd = 1.3) => (
    <g key={k}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.35)" strokeWidth={wd + 2} strokeLinecap="round" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0a0a0a" strokeWidth={wd} strokeLinecap="round" />
    </g>
  );
  const els: ReactNode[] = [ink(cx - nH * step * pxMil, cy, cx + nH * step * pxMil, cy, 'h'), ink(cx, cy - nV * step * pxMil, cx, cy + nV * step * pxMil, 'v')];
  for (let i = -nH; i <= nH; i++) {
    if (!i) continue;
    const x = cx + i * step * pxMil;
    const big = (i * step) % lab === 0;
    els.push(ink(x, cy - (big ? 9 : 5), x, cy, `th${i}`, big ? 1.4 : 1.1));
    if (big)
      els.push(
        <text key={`tl${i}`} x={x} y={cy - 13} className="bridge-ret-num" textAnchor="middle">
          {Math.abs(i * step)}
        </text>,
      );
  }
  for (let i = -nV; i <= nV; i++) {
    if (!i) continue;
    const y = cy + i * step * pxMil;
    const big = (i * step) % lab === 0;
    els.push(ink(cx - (big ? 8 : 4), y, cx + (big ? 8 : 4), y, `tv${i}`, 1.1));
    if (big && i < 0)
      els.push(
        <text key={`vl${i}`} x={cx + 12} y={y + 4} className="bridge-ret-num">
          {Math.abs(i * step)}
        </text>,
      );
  }
  // agulha: escala de cartão (1° a cada ppd px), lida no índice central
  const ppd = Math.max(8, g.r * 0.042);
  const y0 = g.cy + g.r * 0.62;
  const y1 = g.cy + g.r * 0.84;
  const half = Math.ceil((g.r * 1.9) / ppd);
  const ticks: ReactNode[] = [];
  for (let d = Math.floor(los) - half; d <= Math.ceil(los) + half; d++) {
    const x = cx + (d - los) * ppd;
    const b = wrap360(d);
    const big = b % 10 === 0;
    const mid = b % 5 === 0;
    ticks.push(<line key={`c${d}`} x1={x} y1={y0} x2={x} y2={y0 + (big ? 12 : mid ? 8 : 4)} stroke="#c9ffd9" strokeWidth={big ? 1.6 : 1} />);
    if (big && ppd * 10 >= 34)
      ticks.push(
        <text key={`cl${d}`} x={x} y={y0 + 27} className={`bridge-card-num${CARD[b] ? ' card' : ''}`} textAnchor="middle">
          {CARD[b] ?? deg3(b)}
        </text>,
      );
  }
  return (
    <svg className="bridge-ret" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <clipPath id={`bc${id}`}>
          <circle cx={g.x1} cy={g.cy} r={g.r} />
          <circle cx={g.x2} cy={g.cy} r={g.r} />
        </clipPath>
      </defs>
      {els}
      <text x={cx + nH * step * pxMil} y={cy + 16} className="bridge-ret-unit" textAnchor="end">
        mil
      </text>
      <g clipPath={`url(#bc${id})`}>
        <rect x={0} y={y0 - 2} width={w} height={y1 - y0 + 6} fill="rgba(0,10,6,0.45)" />
        {ticks}
      </g>
      <path d={`M ${cx - 7} ${y0 - 10} L ${cx} ${y0 - 1} L ${cx + 7} ${y0 - 10} Z`} fill="#ffcf6b" />
      <text x={cx} y={y0 - 14} className="bridge-card-read" textAnchor="middle">
        {deg3(los)}°
      </text>
      <text x={g.x1 - g.r * 0.62} y={g.cy - g.r * 0.62} className="bridge-ret-unit">
        {BINO_MAG}×50
      </text>
    </svg>
  );
}

export interface BridgeHudProps {
  sight: BridgeSight;
  /** ausente: a visada vem de outra janela (só leitura) */
  setSight?: (s: BridgeSight) => void;
  /** miniatura (picture-in-picture): só a marcação e o binóculo */
  compact?: boolean;
  /** setas e B mudam a visada (padrão: sim) */
  keyboard?: boolean;
  /** botão "Descer" (sala de comando) */
  onExit?: () => void;
}

export function BridgeHud({ sight, setSight, compact, keyboard = true, onExit }: BridgeHudProps) {
  const e = useSim(10);
  const box = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [ids, setIds] = usePersisted('bridge.ids', true);
  const drag = useRef<{ x: number; y: number; b: number; el: number } | null>(null);
  const sightRef = useRef(sight);
  sightRef.current = sight;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const bino = bridgeSight.binoculars(sight);
  const set = setSight;
  // ao levar o binóculo aos olhos a visada vai ao horizonte; ao baixar, volta a mostrar a proa
  const setBino = (on: boolean) => set?.({ ...sightRef.current, fov: on ? BINO_FOV : NAKED_FOV, elev: on ? 0 : BRIDGE_ELEV0 });
  const turn = (d: number) => set?.({ ...sightRef.current, bearing: wrap180(sightRef.current.bearing + d) });
  const elev = (d: number) => set?.({ ...sightRef.current, elev: Math.max(-45, Math.min(45, sightRef.current.elev + d)) });

  useEffect(() => {
    if (!keyboard || !set) return;
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      const b = bridgeSight.binoculars(sightRef.current);
      const big = ev.shiftKey;
      const k = ev.key;
      if (k === 'ArrowLeft') turn(big ? -10 : b ? -0.5 : -2);
      else if (k === 'ArrowRight') turn(big ? 10 : b ? 0.5 : 2);
      else if (k === 'ArrowUp') elev(big ? 5 : b ? 0.25 : 1);
      else if (k === 'ArrowDown') elev(big ? -5 : b ? -0.25 : -1);
      else if ((k === 'b' || k === 'B') && !ev.ctrlKey && !ev.metaKey && !ev.altKey) setBino(!b);
      else if (k === 'Escape' && onExit) onExit();
      else return;
      ev.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboard, set, onExit]);

  useEffect(() => {
    const el = layer.current;
    if (!el || !set) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      setBino(ev.deltaY < 0);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [set]);

  const { w, h } = size;
  const tanV = Math.tan((sight.fov * Math.PI) / 360);
  const tanH = tanV * (w / Math.max(1, h));
  const hdg = e.outputs.euler.heading;
  const los = wrap360(hdg + sight.bearing);
  const bs = bridgeState(e);
  const cts: BridgeContact[] = bridgeVisible(e, ACTS, sight.bearing);
  const felt = bridgeFelt(sight.bearing, e.outputs.euler.pitch, e.outputs.euler.roll);
  const horizonY = h / 2 + (Math.tan(((sight.elev + felt.pitch) * Math.PI) / 180) / tanV) * (h / 2);
  const g = binoGeom(w, h);
  const inField = (x: number) => (bino ? Math.abs(x - w / 2) < g.r * 1.5 : x > 0 && x < w);

  return (
    <div className={`bridge-hud${compact ? ' compact' : ''}${bino ? ' bino' : ''}`} ref={box}>
      <div
        className={`bridge-drag${set ? '' : ' ro'}`}
        ref={layer}
        onPointerDown={(ev) => {
          if (!set) return;
          (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
          drag.current = { x: ev.clientX, y: ev.clientY, b: sight.bearing, el: sight.elev };
        }}
        onPointerMove={(ev) => {
          const d = drag.current;
          if (!d || !set) return;
          const k = sight.fov / Math.max(200, h);
          set({ ...sightRef.current, bearing: wrap180(d.b - (ev.clientX - d.x) * k), elev: Math.max(-45, Math.min(45, d.el + (ev.clientY - d.y) * k)) });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      {ids && bino && !bs.flooded && (
        <svg className="bridge-ids" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          {cts
            .filter((c) => Math.abs(c.off) < 80)
            .map((c) => {
              const x = w / 2 + (Math.tan((c.off * Math.PI) / 180) / tanH) * (w / 2);
              if (!inField(x)) return null;
              const y = horizonY - (bino ? 22 : 12);
              const s = bino ? 13 : 7;
              return (
                <g key={c.id}>
                  <path d={`M ${x - s} ${y - s} L ${x - s} ${y} M ${x + s} ${y - s} L ${x + s} ${y} M ${x - s} ${y - s} L ${x + s} ${y - s}`} stroke="#4cd964" strokeWidth={bino ? 2 : 1.5} fill="none" />
                  <text x={x} y={y - s - 5} fill="#4cd964" fontSize={bino ? 14 : 12} fontWeight="bold" textAnchor="middle">
                    {c.id}
                    {bino ? ` · ${deg3(c.brg)}°` : ''}
                  </text>
                </g>
              );
            })}
        </svg>
      )}
      {bino && <BinoMask w={w} h={h} />}
      {bino && !bs.flooded && <BinoReticle w={w} h={h} tanV={tanV} los={los} />}
      {bs.flooded && (
        <div className="bridge-flooded">
          <b>{bs.sailTop < 0 ? 'Vela submersa — suba à superfície' : 'Ondas alagando o passadiço — suba à superfície'}</b>
          {!compact && (
            <span>
              {bs.sailTop < 0 ? `O topo da vela está ${fmt(-bs.sailTop, 1)} m abaixo da superfície.` : `O topo da vela está só ${fmt(bs.sailTop, 1)} m acima da água.`} O passadiço só pode ser guarnecido com o submarino
              na superfície.
            </span>
          )}
        </div>
      )}
      <div className="bridge-bar" onPointerDown={(ev) => ev.stopPropagation()}>
        {!bino && !compact && <BearingTape w={Math.min(640, w - 48)} los={los} tanH={tanH} cts={cts} ids={ids && !bs.flooded} className="bridge-tape" height={44} />}
        <div className="bridge-read mono">
          <span>
            {compact ? '' : 'MARCAÇÃO '}
            <b>{deg3(los)}°</b>
          </span>
          {!compact && <span>{relTxt(sight.bearing)}</span>}
          {!compact && !bs.flooded && (
            <span>
              olho a {fmt(bs.eye, 1)} m · horizonte {km(bs.horizon)}
            </span>
          )}
          {!compact && !set && <span className="subtle">seguindo a janela de controle</span>}
        </div>
        {set && (
          <div className="row bridge-btns">
            <span className="seg">
              <button className={bino ? '' : 'on'} onClick={() => setBino(false)} title="Olho nu (roda do mouse para trás)">
                Olho nu
              </button>
              <button className={bino ? 'on' : ''} onClick={() => setBino(true)} title={`Binóculo ${BINO_MAG}×50 (roda do mouse para a frente ou tecla B)`}>
                {compact ? `${BINO_MAG}×` : `Binóculo ${BINO_MAG}×50`}
              </button>
            </span>
            {!compact && (
              <>
                <button className="btn sm" onClick={() => turn(bino ? -2 : -10)} title="Girar para bombordo (←)">
                  ◀
                </button>
                <button className="btn sm" onClick={() => set({ ...sight, bearing: 0, elev: bino ? 0 : BRIDGE_ELEV0 })} title="Olhar para a proa">
                  Proa
                </button>
                <button className="btn sm" onClick={() => set({ ...sight, bearing: 180, elev: bino ? 0 : BRIDGE_ELEV0 })} title="Olhar para a popa">
                  Popa
                </button>
                <button className="btn sm" onClick={() => turn(bino ? 2 : 10)} title="Girar para boreste (→)">
                  ▶
                </button>
                <button className={`btn sm ${ids ? 'on' : ''}`} onClick={() => setIds(!ids)} title="Identificação dos contatos à vista (auxílio de treinamento)">
                  IDs
                </button>
              </>
            )}
            {onExit && (
              <button className="btn sm warn" onClick={onExit}>
                Descer (Esc)
              </button>
            )}
          </div>
        )}
        {!compact && set && <div className="subtle bridge-keys">Arraste ou ← → para olhar (Shift = 10°) · ↑ ↓ elevação · roda do mouse ou B = binóculo</div>}
      </div>
    </div>
  );
}
