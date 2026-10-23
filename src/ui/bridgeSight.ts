/**
 * Visada do PASSADIÇO (para onde o observador no alto da vela olha e se está
 * com o binóculo). Uma só para todas as cenas desta janela (aba 3D,
 * Pilotagem, Apresentação, sala de comando), guardada nas preferências.
 * Só visual: não altera a simulação.
 */
import { useEffect, useState } from 'react';
import { loadPersisted, savePersisted } from './persist';
import type { BridgeSight } from '../render3d/SubmarineScene';
import { BINO_FOV, BRIDGE_ELEV0, NAKED_FOV } from '../render3d/bridge';

const KEY = 'bridge.sight';
let cur: BridgeSight = { bearing: 0, elev: BRIDGE_ELEV0, fov: NAKED_FOV, ...loadPersisted<Partial<BridgeSight>>(KEY, {}) };
const listeners = new Set<() => void>();
let saveT = 0;

export const bridgeSight = {
  get: (): BridgeSight => cur,
  set(s: BridgeSight): void {
    cur = s;
    for (const l of listeners) l();
    // grava no máximo ~4×/s (arrastar gera muitos eventos)
    if (!saveT)
      saveT = window.setTimeout(() => {
        saveT = 0;
        savePersisted(KEY, cur);
      }, 250);
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  binoculars: (s: BridgeSight): boolean => s.fov < (NAKED_FOV + BINO_FOV) / 2,
};

export function useBridgeSight(): [BridgeSight, (s: BridgeSight) => void] {
  const [s, setS] = useState(cur);
  useEffect(() => bridgeSight.subscribe(() => setS(cur)), []);
  return [s, bridgeSight.set];
}
