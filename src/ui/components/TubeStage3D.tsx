/** Tubo lançador em 3D etapa a etapa (src/render3d/TubeStage.ts) dentro de um componente React. */
import { useEffect, useRef } from 'react';
import { runner } from '../store';
import { TubeStage, type TubeLabelGroup, type TubeStagePreset } from '../../render3d/TubeStage';
import type { TubeAction } from '../../sim/systems/weapons';

export interface TubeStage3DProps {
  tube: number;
  cut: boolean;
  flows: boolean;
  labels: Record<TubeLabelGroup, boolean>;
  focus: TubeAction | null;
  /** enquadramento pedido (aplicado quando a chave muda) */
  preset?: { key: number; p: TubeStagePreset };
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export function TubeStage3D(p: TubeStage3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<TubeStage | null>(null);
  useEffect(() => {
    if (!host.current) return;
    let st: TubeStage | null = null;
    try {
      st = new TubeStage(host.current, () => runner.engine);
    } catch {
      return; // sem WebGL (testes, navegador antigo): fica só o esquema 2D
    }
    stage.current = st;
    return () => {
      st?.dispose();
      stage.current = null;
    };
  }, []);
  useEffect(() => stage.current?.setTube(p.tube), [p.tube]);
  useEffect(() => stage.current?.setOptions({ cut: p.cut, flows: p.flows, labels: p.labels }), [p.cut, p.flows, p.labels.pecas, p.labels.valvulas, p.labels.valores]);
  useEffect(() => stage.current?.setFocus(p.focus), [p.focus]);
  useEffect(() => {
    if (p.preset) stage.current?.preset(p.preset.p);
  }, [p.preset?.key]);
  return (
    <div className="tube-stage" style={p.style}>
      <div ref={host} className="tube-stage-host" />
      {p.children}
    </div>
  );
}
