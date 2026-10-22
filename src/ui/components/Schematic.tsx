/**
 * Primitivas de diagramas esquemáticos (SVG): tanques, válvulas, bombas e
 * tubulações com animação de escoamento acionada pela vazão real.
 */
import { useId } from 'react';
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
  const pts = props.vertical ? `${-s},${-s} ${s},${-s} ${-s},${s} ${s},${s}` : `${-s},${-s} ${-s},${s} ${s},${-s} ${s},${s}`;
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

/** `angle`: giro do triângulo (graus; 0 = recalque para a direita); `labelAt`: posição do rótulo relativa ao centro. */
export function PumpGlyph(props: { x: number; y: number; st: PumpState; label: string; onToggle?: () => void; inspect?: string; reverse?: boolean; angle?: number; labelAt?: [number, number] }) {
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
        <polygon points={props.reverse ? '6,-8 6,8 -9,0' : '-6,-8 -6,8 9,0'} fill={col} transform={props.angle ? `rotate(${props.angle})` : undefined} />
      </g>
      <text x={props.labelAt?.[0] ?? 0} y={props.labelAt?.[1] ?? 26} fontSize="9" textAnchor="middle" fill="#a9bdd2">
        {props.label}
      </text>
    </g>
  );
}

export function Pipe(props: { d: string; flow: number; color?: string; idleColor?: string; width?: number }) {
  const flowing = Math.abs(props.flow) > 1e-6;
  return (
    <path
      d={props.d}
      fill="none"
      stroke={flowing ? (props.color ?? '#57a8ff') : (props.idleColor ?? '#2c4260')}
      strokeWidth={props.width ?? 3}
      className={flowing ? `flowline ${props.flow < 0 ? 'rev' : ''}` : ''}
      strokeLinecap="round"
    />
  );
}

/** Ampola de ar: ombros arredondados, gargalo e registro; a cor indica a carga de pressão. */
export function AirBottleGlyph(props: { x: number; y: number; w: number; h: number; fill: number; label: string; sub: string; color: string; inspect: string }) {
  const ui = useUi();
  const id = useId().replace(/:/g, '');
  const { w, h } = props;
  const f = Math.max(0, Math.min(1, props.fill));
  const cx = w / 2;
  const neck = w * 0.13;
  const shape = `M${cx - neck},5 H${cx + neck} V${h * 0.13}
    C${cx + neck},${h * 0.22} ${w},${h * 0.18} ${w},${h * 0.36}
    V${h * 0.84} Q${w},${h} ${cx},${h} Q0,${h} 0,${h * 0.84}
    V${h * 0.36} C0,${h * 0.18} ${cx - neck},${h * 0.22} ${cx - neck},${h * 0.13} Z`;
  return (
    <g transform={`translate(${props.x} ${props.y})`} data-air-bottle={props.label} onClick={() => ui.eng && ui.setInspect(props.inspect)} style={{ cursor: ui.eng ? 'help' : 'default' }}>
      <title>{`${props.label}: ${props.sub} · ${(f * 100).toFixed(0)} % da pressão máxima`}</title>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#172635" />
          <stop offset="0.32" stopColor={props.color} />
          <stop offset="0.58" stopColor={props.color} />
          <stop offset="1" stopColor="#172635" />
        </linearGradient>
      </defs>
      <path d={shape} fill="#14212d" />
      <path d={shape} fill={`url(#${id})`} fillOpacity={0.3 + 0.7 * f} stroke={props.color} strokeWidth="1.2" />
      <path d={`M${w * 0.16},${h * 0.38} V${h * 0.8}`} stroke="#e9f2fb" strokeWidth="2" strokeLinecap="round" opacity="0.18" />
      <path d={`M1,${h * 0.4} Q${cx},${h * 0.44} ${w - 1},${h * 0.4} M1,${h * 0.82} Q${cx},${h * 0.86} ${w - 1},${h * 0.82}`} stroke="#b0c1cf" strokeWidth="2" opacity="0.5" fill="none" />
      <rect x={cx - neck - 1} y="3" width={neck * 2 + 2} height="6" rx="1" fill="#b5a57a" stroke="#e1cf9d" strokeWidth="0.8" />
      <line x1={cx - w * 0.25} x2={cx + w * 0.25} y1="2" y2="2" stroke={props.color} strokeWidth="3" strokeLinecap="round" />
      <text x={cx} y={h * 0.61 - 3} fontSize="10" textAnchor="middle" fill="#f0f5fa" fontWeight="600">
        {props.label}
      </text>
      <text x={cx} y={h * 0.61 + 10} fontSize={w < 40 ? 7.5 : 8.5} textAnchor="middle" fill="#e1ecf7" fontFamily="var(--mono)">
        {props.sub}
      </text>
    </g>
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
