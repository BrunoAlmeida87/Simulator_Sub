/**
 * Controles sobrepostos à cena 3D (vistas, camadas, mar, gráfico, luz).
 * No PC aparecem como sempre. No celular ficam recolhidos atrás do botão
 * "⚙ Vista" para não cobrir a cena (regras em global.css, bloco CELULAR).
 */
import { useState, type ReactNode } from 'react';

export function OverlayCtl({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`overlay-ctl${open ? ' ph-open' : ''}`}>
      <button className="btn sm phone-only ovl-toggle" onClick={() => setOpen(!open)} aria-expanded={open} title="Vistas, camadas e ajustes da cena">
        {open ? '✕ Fechar' : '⚙ Vista'}
      </button>
      {children}
    </div>
  );
}
