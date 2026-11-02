import { createContext, useContext } from 'react';
import type { ScreenId } from './nav';

/** telas: lista e grupos em ./nav.ts */
export type { ScreenId };

export interface ToastOptions {
  action?: { label: string; run: () => void };
  ms?: number;
}

export interface UiState {
  screen: ScreenId;
  setScreen: (s: ScreenId) => void;
  eng: boolean;
  setEng: (v: boolean) => void;
  inspect: string | null;
  setInspect: (id: string | null) => void;
  /** mensagem curta; action = botão na mensagem (ex.: “Desfazer”), ms = tempo na tela */
  toast: (msg: string, opts?: ToastOptions) => void;
  showProcedure: boolean;
  setShowProcedure: (v: boolean) => void;
}

export const UiContext = createContext<UiState>(null as unknown as UiState);
export const useUi = () => useContext(UiContext);

/** Propriedades para tornar um elemento inspecionável no modo engenharia. */
export function useInspectable(id: string) {
  const ui = useUi();
  return ui.eng
    ? {
        'data-inspect': id,
        onClick: (ev: { stopPropagation: () => void }) => {
          ev.stopPropagation();
          ui.setInspect(id);
        },
        title: 'Modo engenharia: clique para inspecionar',
      }
    : {};
}
