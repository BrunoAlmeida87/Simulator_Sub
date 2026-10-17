import type { ReactNode } from 'react';
import { useUi } from '../uiContext';

export function Panel(props: { title: ReactNode; children: ReactNode; right?: ReactNode; inspect?: string; className?: string; tag?: ReactNode }) {
  const ui = useUi();
  const insp = props.inspect && ui.eng;
  return (
    <section className={`panel ${insp ? 'inspectable' : ''} ${props.className ?? ''}`}>
      <header>
        <h3>{props.title}</h3>
        {props.tag}
        {props.right}
        {props.inspect && ui.eng && (
          <button className="btn sm" onClick={() => ui.setInspect(props.inspect!)} title="Inspecionar (modo engenharia)">
            ⓘ
          </button>
        )}
      </header>
      <div className="body">{props.children}</div>
    </section>
  );
}
