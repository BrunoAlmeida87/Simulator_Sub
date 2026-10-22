/**
 * Controles sobrepostos à cena 3D (vistas, camadas, mar, gráfico, luz).
 * No PC: uma fileira de filtros recolhíveis (OverlayMenu), cada um abre o
 * seu painel. No celular ficam ainda atrás do botão "⚙ Vista" para não
 * cobrir a cena (regras em global.css, bloco CELULAR).
 */
import { useState, type ReactNode } from 'react';
import { OverlayMenu, type OverlaySection } from './OverlayMenu';

export function OverlayCtl({ children, sections, persistKey }: { children?: ReactNode; sections?: (OverlaySection | false | null | undefined)[]; persistKey?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`overlay-ctl${open ? ' ph-open' : ''}`}>
      <button className="btn sm phone-only ovl-toggle" onClick={() => setOpen(!open)} aria-expanded={open} title="Vistas, camadas e ajustes da cena">
        {open ? '✕ Fechar' : '⚙ Vista'}
      </button>
      {sections && <OverlayMenu persistKey={persistKey ?? 'ovl'} sections={sections} />}
      {children}
    </div>
  );
}
