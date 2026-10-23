/**
 * Medidor de FPS sobre as cenas 3D (preferência gráfica "Medidor de FPS"): quadros por segundo, tempo de quadro,
 * resolução desenhada, chamadas de desenho, triângulos e memória de GPU. É escrito direto no DOM a cada ~0,5 s
 * (sem renderizar o React a cada quadro).
 */
import { useCallback, useRef } from 'react';
import { RenderPerf, formatPerf, type RenderScaleSetting, type RenderStats } from '../../render3d/renderPerf';
import { graphics, useGraphics } from '../graphics';

/** Controle do desempenho de uma cena: chame `frame()` a cada quadro, antes de desenhar; ele devolve a escala de resolução. */
export function useRenderPerf(): { frame: (stats: () => RenderStats) => number; meterRef: React.RefObject<HTMLDivElement>; show: boolean } {
  const g = useGraphics();
  const perf = useRef(new RenderPerf());
  const meterRef = useRef<HTMLDivElement>(null);
  const setting = useRef<RenderScaleSetting>(g.renderScale);
  setting.current = g.renderScale;
  const frame = useCallback((stats: () => RenderStats) => {
    const r = perf.current.frame(performance.now(), graphics.get().renderScale);
    const el = meterRef.current;
    if (r.updated && el) {
      const m = perf.current.meter;
      el.textContent = formatPerf(m.fps, m.ms, stats(), setting.current === 'auto');
    }
    return r.scale;
  }, []);
  return { frame, meterRef, show: g.fpsMeter };
}

export function FpsMeter({ meterRef }: { meterRef: React.RefObject<HTMLDivElement> }) {
  return <div className="fps-meter" ref={meterRef} aria-live="off" title="Medidor de FPS (Ajustes › Gráficos ou “Mar e gráfico”)" />;
}
