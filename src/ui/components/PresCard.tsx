/**
 * Cartão de narração e mostradores das apresentações do Estúdio. Componentes
 * puros (recebem os dados prontos): usados no palco do Estúdio, sobre as outras
 * telas e na 2ª janela.
 */
import type { ReactNode } from 'react';
import { parseRich, TEXT_COLORS, type Inline } from '../presBuilder/richText';
import type { CardData, HudItem, StepOutcome } from '../presBuilder/player';

function Span({ x }: { x: Inline }) {
  const style: React.CSSProperties = {};
  if (x.color) style.color = x.color;
  let node: ReactNode = x.text;
  if (x.mark) node = <mark className="rt-mark">{node}</mark>;
  if (x.u) node = <u>{node}</u>;
  if (x.i) node = <i>{node}</i>;
  if (x.b) node = <b>{node}</b>;
  return x.color ? <span style={style}>{node}</span> : <>{node}</>;
}

/** Texto com a marcação do Estúdio (**negrito**, [azul]cor[/azul], # título, - lista…). */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = parseRich(text);
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = (key: number) => {
    if (list.length) out.push(<ul key={`ul${key}`}>{list}</ul>);
    list = [];
  };
  blocks.forEach((b, i) => {
    const lines = b.lines.map((l, j) => (
      <span key={j}>
        {j > 0 && <br />}
        {l.map((x, k) => (
          <Span key={k} x={x} />
        ))}
      </span>
    ));
    if (b.kind === 'li') {
      list.push(<li key={i}>{lines}</li>);
      return;
    }
    flush(i);
    if (b.kind === 'h1')
      out.push(
        <div key={i} className="rt-h1">
          {lines}
        </div>,
      );
    else if (b.kind === 'h2')
      out.push(
        <div key={i} className="rt-h2">
          {lines}
        </div>,
      );
    else out.push(<p key={i}>{lines}</p>);
  });
  flush(blocks.length);
  return <div className={`rt ${className ?? ''}`}>{out}</div>;
}

const ICON: Record<StepOutcome, string> = { pendente: '○', 'em curso': '●', concluída: '✓', 'tempo esgotado': '⌛', pulada: '↷' };

/** Cartão da etapa no formato escolhido (cartão, título, legenda ou oculto). */
export function PresCardView({ c, compact, children }: { c: CardData; compact?: boolean; children?: ReactNode }) {
  const f = c.format;
  if (f.style === 'oculto') return children ? <div className="pc-wrap pos-baixo">{children}</div> : null;
  const accent = TEXT_COLORS[f.accent]?.css ?? '#49dcff';
  const st = c.status;
  const status = f.showStatus && st.text && <div className={`pc-status ${st.kind}`}>{st.text}</div>;
  const progress = f.showProgress && c.n > 1 && (
    <div className="pc-progress" aria-hidden>
      {c.outcome.map((o, i) => (
        <span key={i} className={i === c.k ? 'cur' : o === 'concluída' ? 'done' : o === 'tempo esgotado' ? 'to' : ''}>
          {ICON[o]}
        </span>
      ))}
    </div>
  );
  const pos = compact ? 'baixo' : f.position;
  if (f.style === 'titulo')
    return (
      <div className={`pc-wrap pc-titlewrap pos-${pos} sz-${f.size}`}>
        <div className="pc-title-card" style={{ ['--accent' as string]: accent }}>
          <RichText text={c.text || `# ${c.title}`} />
          {c.why && <div className="pc-why">{c.why}</div>}
          {status}
          {children}
        </div>
      </div>
    );
  if (f.style === 'legenda')
    return (
      <div className={`pc-wrap pos-${pos === 'topo' ? 'topo' : 'baixo'} sz-${f.size} pc-subwrap`}>
        <div className="pc-sub" style={{ ['--accent' as string]: accent }}>
          <RichText text={c.text || c.title} />
          {status}
          {children}
        </div>
      </div>
    );
  return (
    <div className={`pc-wrap pos-${pos} sz-${f.size}`}>
      <div className="pc-card" style={{ ['--accent' as string]: accent }}>
        <div className="pc-head">
          {f.showProgress && (
            <span className="pc-n">
              {c.k + 1}/{c.n}
            </span>
          )}
          <b>{c.title}</b>
        </div>
        {c.text && <RichText text={c.text} />}
        {c.why && <div className="pc-why">Por quê: {c.why}</div>}
        {status}
        {progress}
        {children}
      </div>
    </div>
  );
}

/** Mostradores ao vivo (valores grandes no canto da cena). */
export function PresHudView({ items, side }: { items: HudItem[]; side?: 'esq' | 'dir' }) {
  if (!items.length) return null;
  return (
    <div className={`pc-hud ${side === 'dir' ? 'dir' : ''}`}>
      {items.map((h) => (
        <div key={h.id} className="pc-hud-item">
          <small>{h.label}</small>
          <b>{h.value}</b>
        </div>
      ))}
    </div>
  );
}

/** lado dos mostradores: oposto ao cartão quando o cartão fica em cima ou à esquerda */
export const hudSide = (c: CardData | null): 'esq' | 'dir' => (c && c.format.style === 'cartao' && (c.format.position === 'esquerda' || c.format.position === 'topo') ? 'dir' : 'esq');
