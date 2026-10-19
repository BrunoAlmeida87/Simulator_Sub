/** Componente React que hospeda a cena Three.js (lida do estado da simulação). */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { runner } from '../store';
import type { Label3D, SubmarineScene, ViewMode } from '../../render3d/SubmarineScene';
import type { OceanQuality } from '../../render3d/Ocean';
import { defaultLayers, type SceneLayers } from '../../render3d/layers';
import { loadPersisted, savePersisted } from '../persist';

const K_Q = 'sx1.quality.v1';
export function defaultQuality(): OceanQuality {
  try {
    const q = localStorage.getItem(K_Q);
    if (q === 'baixa' || q === 'media' || q === 'alta') return q;
  } catch {
    /* sem armazenamento */
  }
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return coarse || window.innerWidth < 900 ? 'baixa' : 'alta';
}
export function saveQuality(q: OceanQuality): void {
  try {
    localStorage.setItem(K_Q, q);
  } catch {
    /* sem armazenamento */
  }
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
  const pool = useRef(new Map<string, { el: HTMLDivElement; key: string; w: number; h: number }>());
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
        const loop = () => {
          const sc = sceneRef.current;
          if (sc && opts.current.persistKey && sc.viewMode === 'livre' && performance.now() - lastSave > 1000) {
            lastSave = performance.now();
            savePersisted(`cam.${opts.current.persistKey}`, sc.getCameraPose());
          }
          if (sc) {
            sc.layers = mergedLayers(opts.current);
            sc.realisticFog = opts.current.fog ?? true;
            drawLabels(sc.render());
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
   * com o tamanho real medido e desempilhamento para não se sobreporem;
   * rótulos secundários que não cabem são omitidos.
   */
  const drawLabels = (labels: Label3D[]) => {
    const host = lblBox.current;
    if (!host) return;
    const basic = opts.current.labels !== false;
    const W = host.clientWidth;
    const H = host.clientHeight;
    const list = labels
      .filter((l) => l.visible && !(BASIC.has(l.id) && !basic) && l.x > -50 && l.y > -30 && l.x < W + 50 && l.y < H + 30)
      .sort((a, b) => (a.prio ?? 1) - (b.prio ?? 1));
    // 1) conteúdo
    const slots = list.map((l) => {
      let slot = pool.current.get(l.id);
      if (!slot) {
        const el = document.createElement('div');
        el.className = 'lbl3d';
        host.appendChild(el);
        slot = { el, key: '', w: 0, h: 0 };
        pool.current.set(l.id, slot);
      }
      const key = `${l.text}|${l.sub ?? ''}|${l.color ?? ''}|${l.small ? 1 : 0}`;
      if (slot.key !== key) {
        slot.el.className = `lbl3d${l.small ? ' small' : ''}${l.color ? ' col' : ''}`;
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
    // 3) posição
    const used = new Set<string>();
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    list.forEach((l, i) => {
      const s = slots[i];
      const w = s.w + 4;
      const h = s.h + 2;
      // candidatos: posição original e deslocamentos alternados para cima/baixo
      let y = l.y;
      let ok = false;
      for (let k = 0; k < 13; k++) {
        const dy = k === 0 ? 0 : Math.ceil(k / 2) * (h * 0.55) * (k % 2 ? 1 : -1);
        const yy = l.y + dy;
        const r = { x0: l.x - w / 2, x1: l.x + w / 2, y0: yy - h / 2, y1: yy + h / 2 };
        if (!placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0)) {
          y = yy;
          ok = true;
          break;
        }
      }
      if (!ok && (l.prio ?? 1) >= 3) {
        s.el.style.display = 'none';
        used.add(l.id);
        return;
      }
      placed.push({ x0: l.x - w / 2, x1: l.x + w / 2, y0: y - h / 2, y1: y + h / 2 });
      s.el.style.left = `${l.x}px`;
      s.el.style.top = `${y}px`;
      used.add(l.id);
    });
    for (const [id, s] of pool.current) if (!used.has(id)) s.el.style.display = 'none';
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
    if (!d || !opts.current.onPickTank || !sceneRef.current || !box.current) return;
    if ((ev.target as HTMLElement).tagName !== 'CANVAS') return;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 6) return;
    const r = box.current.getBoundingClientRect();
    opts.current.onPickTank(sceneRef.current.pickTank(ev.clientX - r.left, ev.clientY - r.top));
  };

  return (
    <div className={`view3d ${props.className ?? ''}`} ref={box} style={props.style} onPointerDown={onDown} onPointerUp={onUp}>
      {err && <div style={{ padding: 20 }}>{err}</div>}
      <div className="lbl3d-host" ref={lblBox} />
      {props.children}
    </div>
  );
}
