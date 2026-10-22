import type { ReactNode } from 'react';
import { useUi } from '../uiContext';
import { usePersisted } from '../persist';

interface PanelProps {
  title: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  inspect?: string;
  className?: string;
  tag?: ReactNode;
  /** recolhível: chave em que fica guardado se está aberto (o título vira botão abre/fecha) */
  fold?: string;
  /** recolhível: aberto na primeira vez (padrão: sim) */
  foldOpen?: boolean;
}

export function Panel(props: PanelProps) {
  if (props.fold) return <FoldPanel {...props} fold={props.fold} />;
  return <PanelBox {...props} open />;
}

function FoldPanel(props: PanelProps & { fold: string }) {
  const [open, setOpen] = usePersisted(`panel.${props.fold}`, props.foldOpen ?? true);
  return <PanelBox {...props} open={open} toggle={() => setOpen(!open)} />;
}

function PanelBox(props: PanelProps & { open: boolean; toggle?: () => void }) {
  const ui = useUi();
  const insp = props.inspect && ui.eng;
  return (
    <section className={`panel ${insp ? 'inspectable' : ''} ${props.toggle && !props.open ? 'folded' : ''} ${props.className ?? ''}`}>
      <header>
        <h3>
          {props.toggle ? (
            <button className="panel-fold" aria-expanded={props.open} onClick={props.toggle} title={props.open ? 'Recolher' : 'Expandir'}>
              <span className="car">{props.open ? '▾' : '▸'}</span> {props.title}
            </button>
          ) : (
            props.title
          )}
        </h3>
        {props.tag}
        {props.right}
        {props.inspect && ui.eng && (
          <button className="btn sm" onClick={() => ui.setInspect(props.inspect!)} title="Inspecionar (modo engenharia)">
            ⓘ
          </button>
        )}
      </header>
      {props.open && <div className="body">{props.children}</div>}
    </section>
  );
}
