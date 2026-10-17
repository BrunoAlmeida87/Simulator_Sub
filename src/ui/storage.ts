/**
 * Armazenamento local (navegador). Todas as operações são protegidas:
 * em janelas privadas ou com armazenamento bloqueado, a aplicação continua
 * funcionando (apenas sem persistência).
 */
import type { SaveFile } from '../sim/persistence';
import type { SimConfig } from '../sim/config/types';

const K_SAVES = 'sx1.saves.v1';
const K_AUTOSAVE = 'sx1.autosave.v1';
const K_CONFIG = 'sx1.config.v1';
const K_PREFS = 'sx1.prefs.v1';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const storage = {
  listSaves: (): SaveFile[] => read<SaveFile[]>(K_SAVES, []),
  addSave: (f: SaveFile): boolean => {
    const list = read<SaveFile[]>(K_SAVES, []);
    list.unshift(f);
    while (list.length > 12) list.pop();
    return write(K_SAVES, list);
  },
  deleteSave: (savedAt: string): void => {
    write(
      K_SAVES,
      read<SaveFile[]>(K_SAVES, []).filter((s) => s.savedAt !== savedAt),
    );
  },
  getAutosave: (): SaveFile | null => read<SaveFile | null>(K_AUTOSAVE, null),
  setAutosave: (f: SaveFile): boolean => write(K_AUTOSAVE, f),
  clearAutosave: (): void => {
    try {
      localStorage.removeItem(K_AUTOSAVE);
    } catch {
      /* indisponível */
    }
  },
  getConfig: (): SimConfig | null => read<SimConfig | null>(K_CONFIG, null),
  setConfig: (c: SimConfig): boolean => write(K_CONFIG, c),
  clearConfig: (): void => {
    try {
      localStorage.removeItem(K_CONFIG);
    } catch {
      /* indisponível */
    }
  },
  getPrefs: <T extends object>(fallback: T): T => ({ ...fallback, ...read<Partial<T>>(K_PREFS, {}) }),
  setPrefs: (p: object): boolean => write(K_PREFS, p),
};

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
