/**
 * FILTROS DA CENA 3D RECOLHÍVEIS: uma fileira de botões compactos (vista,
 * camadas, mar e gráfico, sol e luzes…). Cada botão mostra o valor atual e
 * abre/fecha o seu painel logo abaixo; abrir um fecha o outro, para a cena
 * nunca ficar coberta. O painel aberto é guardado por tela (usePersisted).
 */
import type { ReactNode } from 'react';
import { usePersisted } from '../persist';
import type { ViewMode } from '../../render3d/SubmarineScene';

export interface OverlaySection {
  id: string;
  /** texto do botão: o filtro e o valor atual (ex.: "Vista: Perspectiva") */
  label: ReactNode;
  title?: string;
  /** painel aberto pelo botão (omitido quando a seção é um botão de liga/desliga: ver `button`) */
  content?: ReactNode;
  /** botão próprio (ex.: liga/desliga), mostrado na fileira no lugar do botão que abre painel */
  button?: ReactNode;
  /** classe extra do painel aberto */
  className?: string;
}

export function OverlayMenu({ persistKey, sections }: { persistKey: string; sections: (OverlaySection | false | null | undefined)[] }) {
  const [openId, setOpenId] = usePersisted<string | null>(`${persistKey}.ovlOpen`, null);
  const list = sections.filter((s): s is OverlaySection => !!s);
  const open = list.find((s) => s.id === openId && !s.button);
  return (
    <>
      <div className="ovl-bar" role="toolbar" aria-label="Filtros da cena 3D">
        {list.map((s) => {
          if (s.button) return <span key={s.id}>{s.button}</span>;
          const on = s.id === open?.id;
          return (
            <button
              key={s.id}
              className={`btn sm ovl-chip${on ? ' on' : ''}`}
              aria-expanded={on}
              title={(s.title ? s.title + ' — ' : '') + (on ? 'clique para fechar' : 'clique para abrir')}
              onClick={() => setOpenId(on ? null : s.id)}
            >
              {s.label} <span className="car">{on ? '▴' : '▾'}</span>
            </button>
          );
        })}
      </div>
      {open && (
        <div className={`tanksel-pop ovl-panel ${open.className ?? ''}`} role="group" aria-label={open.title ?? open.id}>
          {open.content}
        </div>
      )}
    </>
  );
}

export interface ViewOption<V extends string = ViewMode> {
  id: V;
  label: string;
  tip?: string;
}

/** grade de vistas (enquadramentos) dentro do painel "Vista" */
export function ViewGrid<V extends string>({ views, value, onPick }: { views: readonly ViewOption<V>[]; value: V; onPick: (v: V) => void }) {
  return (
    <div className="ovl-views">
      {views.map((v) => (
        <button key={v.id} className={`btn sm ${value === v.id ? 'on' : ''}`} aria-pressed={value === v.id} title={v.tip} onClick={() => onPick(v.id)}>
          {v.label}
        </button>
      ))}
    </div>
  );
}

/** seção "Vista" pronta: botão com a vista atual e a grade de vistas */
export function viewSection<V extends string>(views: readonly ViewOption<V>[], value: V, onPick: (v: V) => void): OverlaySection {
  return {
    id: 'vista',
    label: <>Vista: {views.find((v) => v.id === value)?.label ?? value}</>,
    title: 'Vistas (enquadramentos da câmera)',
    content: <ViewGrid views={views} value={value} onPick={onPick} />,
  };
}
