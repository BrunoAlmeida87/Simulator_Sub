/**
 * Primitivas de diagramas esquemáticos (SVG): tanques, válvulas, bombas e
 * tubulações com animação de escoamento acionada pela vazão real.
 */
import type { ValveState, PumpState } from '../../sim/core/state';
import { valveStatus } from '../../sim/systems/components';
import { useUi } from '../uiContext';

export const valveColor = (st: ValveState): string => {
  const s = valveStatus(st);
  if (s === 'TRAVADA') return '#ff5257';
  if (s === 'ABERTA') return '#3ddc84';
  if (s === 'FECHADA') return '#8399b1';
  return '#f5b041';
};

export function ValveGlyph(props: { x: number; y: number; st: ValveState; label?: string; onToggle?: () => void; inspect?: string; vertical?: boolean; size?: number }) {
  const ui = useUi();
  const s = props.size ?? 9;
  const col = valveColor(props.st);
  const filled = props.st.pos > 0.5;
  const click = () => {
    if (ui.eng && props.inspect) ui.setInspect(props.inspect);
    else props.onToggle?.();
  };
  const pts = props.vertical
    ? `${-s},${-s} ${s},${-s} ${-s},${s} ${s},${s}`
    : `${-s},${-s} ${-s},${s} ${s},${-s} ${s},${s}`;
  return (
    <g transform={`translate(${props.x} ${props.y})`} onClick={click} style={{ cursor: 'pointer' }}>
      <title>{`${props.label ?? 'Válvula'}: ${valveStatus(props.st)} (${(props.st.pos * 100).toFixed(0)} %) — clique para ${props.st.cmd > 0.5 ? 'fechar' : 'abrir'}`}</title>
      <rect x={-s - 4} y={-s - 4} width={2 * s + 8} height={2 * s + 8} fill="transparent" />
      <polygon points={pts} fill={filled ? col : '#0a121b'} stroke={col} strokeWidth="1.6" />
      {props.label && (
        <text x={props.vertical ? s + 5 : 0} y={props.vertical ? 3 : s + 12} fontSize="9" textAnchor={props.vertical ? 'start' : 'middle'} fill="#a9bdd2">
          {props.label}
        </text>
      )}
    </g>
  );
}

export function PumpGlyph(props: { x: number; y: number; st: PumpState; label: string; onToggle?: () => void; inspect?: string; reverse?: boolean }) {
  const ui = useUi();
  const run = props.st.speed > 0.01;
  const col = props.st.failed ? '#ff5257' : run ? '#3ddc84' : '#8399b1';
  const click = () => {
    if (ui.eng && props.inspect) ui.setInspect(props.inspect);
    else props.onToggle?.();
  };
  return (
    <g transform={`translate(${props.x} ${props.y})`} onClick={click} style={{ cursor: 'pointer' }}>
      <title>{`${props.label}: ${props.st.failed ? 'FALHA' : run ? 'OPERANDO' : 'PARADA'} — rotação ${(props.st.speed * 100).toFixed(0)} %`}</title>
      <circle r="13" fill="#0a121b" stroke={col} strokeWidth="2" />
      <g className={run ? 'spin' : ''} style={run ? { animationDuration: `${0.4 / Math.max(0.2, props.st.speed)}s` } : undefined}>
        <polygon points={props.reverse ? '6,-8 6,8 -9,0' : '-6,-8 -6,8 9,0'} fill={col} />
      </g>
      <text y="26" fontSize="9" textAnchor="middle" fill="#a9bdd2">
        {props.label}
      </text>
    </g>
  );
}

export function Pipe(props: { d: string; flow: number; color?: string; width?: number }) {
  const flowing = Math.abs(props.flow) > 1e-6;
  return (
    <path
      d={props.d}
      fill="none"
      stroke={flowing ? props.color ?? '#57a8ff' : '#2c4260'}
      strokeWidth={props.width ?? 3}
      className={flowing ? `flowline ${props.flow < 0 ? 'rev' : ''}` : ''}
      strokeLinecap="round"
    />
  );
}

export function TankGlyph(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: number; // 0..1
  label: string;
  sub?: string;
  color?: string;
  air?: boolean;
  inspect?: string;
  alarm?: boolean;
}) {
  const ui = useUi();
  const f = Math.max(0, Math.min(1, props.fill));
  const wh = props.h * f;
  return (
    <g onClick={() => ui.eng && props.inspect && ui.setInspect(props.inspect)} style={{ cursor: ui.eng && props.inspect ? 'help' : 'default' }}>
      <title>{`${props.label}: ${(f * 100).toFixed(1)} %`}</title>
      <rect x={props.x} y={props.y} width={props.w} height={props.h} fill={props.air ? '#1c2a38' : '#0a121b'} stroke={props.alarm ? '#ff5257' : '#5a7a9c'} strokeWidth="1.2" rx="2" />
      <rect x={props.x + 1} y={props.y + props.h - wh} width={props.w - 2} height={Math.max(0, wh - 1)} fill={props.color ?? '#2a7fd4'} opacity="0.9" />
      <text x={props.x + props.w / 2} y={props.y + props.h / 2 - (props.sub ? 2 : -4)} fontSize="10" textAnchor="middle" fill="#e9f2fb" fontWeight="600">
        {props.label}
      </text>
      {props.sub && (
        <text x={props.x + props.w / 2} y={props.y + props.h / 2 + 11} fontSize="9" textAnchor="middle" fill="#cfe0f2" fontFamily="var(--mono)">
          {props.sub}
        </text>
      )}
    </g>
  );
}
