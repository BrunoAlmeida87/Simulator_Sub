/**
 * Diagrama largo (SVG). No PC não muda nada (o contêiner não existe para o
 * layout: display: contents). No celular ganha largura mínima e rolagem
 * lateral, para o texto continuar legível (regras em global.css, bloco CELULAR).
 */
import type { CSSProperties, ReactNode } from 'react';

export function WideDiagram({ minWidth, children }: { minWidth: number; children: ReactNode }) {
  return (
    <div className="wide-diagram" style={{ '--dmin': `${minWidth}px` } as CSSProperties}>
      {children}
    </div>
  );
}
