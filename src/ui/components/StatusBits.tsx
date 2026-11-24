/**
 * Peças pequenas comuns às telas dos sistemas da Fase 3 (atmosfera, avarias, distribuição, discrição,
 * porto, laboratórios): estado ligado/desligado com forma + texto, nível com faixa de atenção/alarme e
 * botão de alternância. Cores de estado (verde/âmbar/vermelho) sempre acompanhadas de forma e texto.
 */
import type { ReactNode } from 'react';
import { HBar } from './gauges';
import { fmt } from '../format';

export function OnOff({ on, onText = 'LIGADO', offText = 'DESLIGADO' }: { on: boolean; onText?: string; offText?: string }) {
  return <span className={`badge ${on ? 'ok' : 'off'}`}>{on ? `● ${onText}` : `○ ${offText}`}</span>;
}

export type Tone = '' | 'warn' | 'alarm';

/** selo de estado com forma: ● normal, ▲ atenção, ◆ alarme */
export function ToneBadge({ tone, text }: { tone: Tone; text?: string }) {
  if (tone === 'alarm') return <span className="badge alarm">◆ {text ?? 'ALARME'}</span>;
  if (tone === 'warn') return <span className="badge warn">▲ {text ?? 'ATENÇÃO'}</span>;
  return <span className="badge ok">● {text ?? 'NORMAL'}</span>;
}

/**
 * Linha de nível: rótulo, valor, faixa e selo. `warn`/`alarm` são limites; `low` indica que o perigo é
 * ficar ABAIXO deles (ex.: O₂).
 */
export function LevelRow(props: { label: ReactNode; value: number; unit: string; digits?: number; max: number; min?: number; warn?: number; alarm?: number; low?: boolean; note?: ReactNode }) {
  const { value, warn, alarm, low } = props;
  const past = (lim?: number) => lim !== undefined && (low ? value < lim : value > lim);
  const tone: Tone = past(alarm) ? 'alarm' : past(warn) ? 'warn' : '';
  return (
    <div className="lvl-row">
      <div className="lvl-head">
        <span>{props.label}</span>
        <b className="num">
          {fmt(value, props.digits ?? 1)} <span className="subtle">{props.unit}</span>
        </b>
        <ToneBadge tone={tone} />
      </div>
      <HBar value={value} min={props.min} max={props.max} color={tone === 'alarm' ? 'var(--alarm)' : tone === 'warn' ? 'var(--warn)' : 'var(--accent)'} />
      {props.note && <div className="subtle lvl-note">{props.note}</div>}
    </div>
  );
}

/** botão de alternância (aria-pressed) */
export function Toggle({ on, onClick, children, title, instr }: { on: boolean; onClick: () => void; children: ReactNode; title?: string; instr?: boolean }) {
  return (
    <button className={`btn sm ${on ? 'on' : ''} ${instr ? 'instr' : ''}`} aria-pressed={on} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

/** par rótulo : valor em grade */
export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv3">
      {rows.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
