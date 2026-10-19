/**
 * Estado de interface que sobrevive à troca de abas e ao recarregamento da
 * página (memória + navegador). Usado para guardar a visualização de cada tela.
 */
import { useState } from 'react';

const mem = new Map<string, unknown>();
const PREFIX = 'sx1.ui.';

export function loadPersisted<T>(key: string, def: T): T {
  if (mem.has(key)) return mem.get(key) as T;
  try {
    const r = localStorage.getItem(PREFIX + key);
    if (r !== null) {
      const v = JSON.parse(r) as T;
      mem.set(key, v);
      return v;
    }
  } catch {
    /* sem armazenamento */
  }
  return def;
}

export function savePersisted<T>(key: string, v: T): void {
  mem.set(key, v);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(v));
  } catch {
    /* sem armazenamento */
  }
}

export function usePersisted<T>(key: string, def: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => loadPersisted(key, def));
  return [
    v,
    (nv: T) => {
      savePersisted(key, nv);
      setV(nv);
    },
  ];
}
