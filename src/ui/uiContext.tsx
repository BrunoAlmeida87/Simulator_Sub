import { createContext, useContext } from 'react';

export type ScreenId = 'comando' | 'lastro' | 'trim' | 'propulsao' | 'seguranca' | 'v3d' | 'historico' | 'cenarios' | 'auxiliares' | 'validacao' | 'ajuda';

export interface UiState {
  screen: ScreenId;
  setScreen: (s: ScreenId) => void;
  eng: boolean;
  setEng: (v: boolean) => void;
  inspect: string | null;
  setInspect: (id: string | null) => void;
  toast: (msg: string) => void;
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
