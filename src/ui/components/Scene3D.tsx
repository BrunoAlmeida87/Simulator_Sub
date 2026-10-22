/** Componente React que hospeda a cena Three.js (lida do estado da simulação). */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { runner } from '../store';
import type { BridgeSight, Label3D, PeriscopeSight, SubmarineScene, ViewMode } from '../../render3d/SubmarineScene';
import type { OceanQuality } from '../../render3d/Ocean';
import { defaultLayers, type SceneLayers } from '../../render3d/layers';
import { loadPersisted, savePersisted } from '../persist';
import { visualOut, isVisualWindow } from '../sync';
import type { PickTarget } from '../ops/opsBus';
import { graphics } from '../graphics';
import { appearanceRev, currentAppearance } from '../appearance';
import { TrimGainBanner } from './TrimGain';
import { geoOriginOf } from '../routeNav';
import { BridgeHud } from './BridgeHud';
import { bridgeSight, useBridgeSight } from '../bridgeSight';
import { DroneHud } from './DroneHud';
import { droneCtl } from '../droneCtl';
import type { DronePose } from '../../render3d/drone';
import { layoutLabels, type LabelRect } from '../../render3d/labelLayout';

/** qualidade gráfica preferida (guardada nas preferências gráficas) */
export function defaultQuality(): OceanQuality {
  return graphics.get().quality;
}
export function saveQuality(q: OceanQuality): void {
  graphics.set({ quality: q });
}

export interface Scene3DProps {
  view: ViewMode;
  cutaway?: boolean;
  trail?: boolean;
  fog?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: ReactNode;
  /** rótulos básicos (superfície, cota/velocidade, fundo) */
  labels?: boolean;
  quality?: OceanQuality;
  /** camadas visuais (vetores, tanques, tubulações, escoamentos, identificações…) */
  layers?: Partial<SceneLayers>;
  /** clique sobre um tanque no corte (id) ou fora de um tanque (null) */
  onPickTank?: (id: string | null) => void;
  /** chave para guardar a posição da câmera livre ao trocar de aba */
  persistKey?: string;
  /** clique sobre qualquer objeto selecionável da cena (ou null) */
  onPick?: (p: PickTarget | null) => void;
  /** visada do periscópio (vista 'periscopio') */
  periscope?: PeriscopeSight;
  /** false: esta cena não define a vista/camadas da segunda janela (periscópio, miniatura) */
  syncVisual?: boolean;
  /** visada do passadiço (vista 'passadico'); omitida: a visada desta janela (arrastar, setas, binóculo) */
  bridge?: BridgeSight;
  /** pose do drone recebida de outra janela (vista 'drone', só leitura); omitida: o drone desta janela */
  drone?: DronePose;
  /** painel das vistas em 1ª pessoa (passadiço e drone): completo (padrão), compacto (miniatura) ou nenhum */
  hud?: 'full' | 'compact' | 'none';
  /** teclado do passadiço (setas, B) e do drone (WASD, Q/E, setas) — padrão: sim */
  hudKeys?: boolean;
  /** botão "Descer" no painel do passadiço */
  onBridgeExit?: () => void;
}

/** painel do passadiço com a visada compartilhada desta janela (ou a recebida pela prop, só leitura) */
function BridgeLayer({ p }: { p: Scene3DProps }) {
  const [s, set] = useBridgeSight();
  return <BridgeHud sight={p.bridge ?? s} setSight={p.bridge ? undefined : set} compact={p.hud === 'compact'} keyboard={p.hudKeys !== false} onExit={p.onBridgeExit} />;
}

type CamPose = { pos: [number, number, number]; target: [number, number, number] };

const BASIC = new Set(['surf', 'sub', 'bot']);

function mergedLayers(p: Scene3DProps): SceneLayers {
  const l = { ...defaultLayers(), ...p.layers };
  if (p.cutaway !== undefined) l.tanks = p.cutaway;
  if (p.trail !== undefined) l.trail = p.trail;
  return l;
}

export function Scene3D(props: Scene3DProps) {
  const box = useRef<HTMLDivElement>(null);
  const lblBox = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SubmarineScene | null>(null);
  const pool = useRef(new Map<string, { el: HTMLDivElement; line: HTMLDivElement; key: string; w: number; h: number }>());
  const labelWidth = useRef(0);
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
            const sc = new SubmarineScene(box.current!, runner, opts.current.view, opts.current.quality ?? defaultQuality());
            sc.layers = mergedLayers(opts.current);
            sc.realisticFog = opts.current.fog ?? true;
            const k = opts.current.persistKey;
            if (k && opts.current.view === 'livre') {
              const pose = loadPersisted<CamPose | null>(`cam.${k}`, null);
              if (pose) sc.setCameraPose(pose);
            }
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
        let lastSave = 0;
        let lastDroneSave = 0;
        const loop = () => {
          const sc = sceneRef.current;
          if (sc && opts.current.persistKey && sc.viewMode === 'livre' && performance.now() - lastSave > 1000) {
            lastSave = performance.now();
            savePersisted(`cam.${opts.current.persistKey}`, sc.getCameraPose());
          }
          if (sc) {
            sc.setAppearance(currentAppearance(), appearanceRev());
            sc.trimGain = graphics.get().trimGain;
            sc.geoOrigin = geoOriginOf(runner.engine);
            sc.shipRange = graphics.get().shipRange;
            sc.trafficCount = graphics.get().traffic;
            sc.depthRefsOn = graphics.get().depthRefs;
            sc.terrainDetail = graphics.get().coastDetail;
            sc.lighting = graphics.get().lighting;
            sc.marineLife.settings = graphics.get();
            sc.layers = mergedLayers(opts.current);
            if (opts.current.periscope) sc.periscope = opts.current.periscope;
            sc.bridge = opts.current.bridge ?? bridgeSight.get();
            // drone: pose compartilhada desta janela (a cena voa com os comandos) ou a recebida de outra janela
            const droneOn = opts.current.view === 'drone';
            if (droneOn) {
              sc.drone = droneCtl.pose;
              sc.droneInput = droneCtl.input;
              sc.droneTarget = opts.current.drone ?? null;
            }
            if (!isVisualWindow && opts.current.syncVisual !== false) {
              visualOut.layers = sc.layers;
              visualOut.view = opts.current.view;
              visualOut.bridge = opts.current.view === 'passadico' ? sc.bridge : null;
              visualOut.drone = droneOn ? sc.drone : null;
            }
            sc.realisticFog = opts.current.fog ?? true;
            drawLabels(sc.render(), sc.labelBounds);
            if (droneOn) {
              droneCtl.pose = sc.drone;
              if (performance.now() - lastDroneSave > 1000) {
                lastDroneSave = performance.now();
                droneCtl.save();
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
      const sc = sceneRef.current;
      if (sc && opts.current.persistKey && sc.viewMode === 'livre') savePersisted(`cam.${opts.current.persistKey}`, sc.getCameraPose());
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [props.quality]);

  /**
   * Rótulos HTML sobre a cena. Posicionados por prioridade (forças primeiro),
   * com o tamanho real medido. Identificações ficam fora do casco, ligadas
   * ao componente por uma linha; os controles também são áreas reservadas.
   */
  const drawLabels = (labels: Label3D[], hull: LabelRect | null) => {
    const host = lblBox.current;
    if (!host) return;
    const basic = opts.current.labels !== false;
    const W = host.clientWidth;
    const H = host.clientHeight;
    if (labelWidth.current !== W) {
      for (const slot of pool.current.values()) slot.w = -1;
      labelWidth.current = W;
    }
    const origin = host.getBoundingClientRect();
    const obstacles: LabelRect[] = [];
    box.current?.querySelectorAll<HTMLElement>('.overlay-ctl, .visual-ctl, .visual-status, .hud, .pilot-hud, .pilot-tape, .pres-hud, .pres-bottom, .pilot-start, .trimgain-banner').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) obstacles.push({ x0: r.left - origin.left - 4, x1: r.right - origin.left + 4, y0: r.top - origin.top - 4, y1: r.bottom - origin.top + 4 });
    });
    const list = labels
      .filter((l) => l.visible && !(BASIC.has(l.id) && !basic) && l.x > -50 && l.y > -30 && l.x < W + 50 && l.y < H + 30)
      .sort((a, b) => (a.prio ?? 1) - (b.prio ?? 1));
    // 1) conteúdo
    const slots = list.map((l) => {
      let slot = pool.current.get(l.id);
      if (!slot) {
        const el = document.createElement('div');
        el.className = 'lbl3d';
        const line = document.createElement('div');
        line.className = 'lbl3d-leader';
        host.append(line, el);
        slot = { el, line, key: '', w: 0, h: 0 };
        pool.current.set(l.id, slot);
      }
      const key = `${l.text}|${l.sub ?? ''}|${l.color ?? ''}|${l.small ? 1 : 0}|${l.callout ? 1 : 0}`;
      if (slot.key !== key) {
        slot.el.className = `lbl3d${l.small ? ' small' : ''}${l.color ? ' col' : ''}${l.callout ? ' callout' : ''}`;
        slot.el.style.borderColor = l.color ?? '';
        slot.el.style.color = l.color ?? '';
        slot.el.innerHTML = '';
        const a = document.createElement('div');
        a.textContent = l.text;
        slot.el.appendChild(a);
        if (l.sub) {
          const b = document.createElement('div');
          b.className = 's';
          b.textContent = l.sub;
          slot.el.appendChild(b);
        }
        slot.key = key;
        slot.w = -1;
      }
      slot.el.style.display = 'block';
      return slot;
    });
    // 2) medidas (uma única leitura de layout)
    for (const s of slots) {
      if (s.w < 0) {
        s.w = s.el.offsetWidth;
        s.h = s.el.offsetHeight;
      }
    }
    // 3) posição e linhas de identificação (sem forçar sobreposições)
    const positions = layoutLabels(list.map((l, i) => ({ ...l, width: slots[i].w, height: slots[i].h })), W, H, obstacles, hull);
    const used = new Set<string>();
    const byId = new Map(list.map((l) => [l.id, l]));
    for (const p of positions) {
      const s = pool.current.get(p.id)!;
      const l = byId.get(p.id)!;
      s.el.style.left = `${p.x}px`;
      s.el.style.top = `${p.y}px`;
      s.line.style.display = 'none';
      if (l.callout || Math.hypot(p.x - l.x, p.y - l.y) > 20) {
        const endX = Math.max(p.x - s.w / 2, Math.min(p.x + s.w / 2, l.x));
        const endY = Math.max(p.y - s.h / 2, Math.min(p.y + s.h / 2, l.y));
        s.line.style.display = 'block';
        s.line.style.left = `${l.x}px`;
        s.line.style.top = `${l.y}px`;
        s.line.style.width = `${Math.hypot(endX - l.x, endY - l.y)}px`;
        s.line.style.transform = `rotate(${Math.atan2(endY - l.y, endX - l.x)}rad)`;
        s.line.style.backgroundColor = l.color ?? '#9fb7cf';
      }
      used.add(p.id);
    }
    for (const [id, s] of pool.current) if (!used.has(id)) {
      s.el.style.display = 'none';
      s.line.style.display = 'none';
    }
  };

  useEffect(() => {
    sceneRef.current?.setView(props.view);
  }, [props.view]);

  // clique (sem arrastar) sobre um tanque
  const down = useRef<{ x: number; y: number } | null>(null);
  const onDown = (ev: React.PointerEvent) => {
    down.current = { x: ev.clientX, y: ev.clientY };
  };
  const onUp = (ev: React.PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d || (!opts.current.onPickTank && !opts.current.onPick) || !sceneRef.current || !box.current) return;
    if ((ev.target as HTMLElement).tagName !== 'CANVAS') return;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 6) return;
    const r = box.current.getBoundingClientRect();
    const p = sceneRef.current.pick(ev.clientX - r.left, ev.clientY - r.top);
    opts.current.onPick?.(p);
    opts.current.onPickTank?.(p && p.kind === 'tank' ? p.id : null);
  };

  return (
    <div className={`view3d ${props.className ?? ''}`} ref={box} style={props.style} onPointerDown={onDown} onPointerUp={onUp}>
      {err && <div style={{ padding: 20 }}>{err}</div>}
      <div className="lbl3d-host" ref={lblBox} />
      <TrimGainBanner />
      {props.view === 'passadico' && props.hud !== 'none' && <BridgeLayer p={props} />}
      {props.view === 'drone' && props.hud !== 'none' && <DroneHud compact={props.hud === 'compact'} keyboard={props.hudKeys !== false} follow={!!props.drone} />}
      {props.children}
    </div>
  );
}
