import { useSyncExternalStore } from 'react';
import { defaultLabelVisibility, parseLabelVisibility, type LabelCategory, type LabelVisibility } from '../render3d/labelVisibility';

const KEY = 'sx1.labels.v1';
let value = defaultLabelVisibility();
try { value = parseLabelVisibility(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { /* armazenamento opcional */ }
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
function save(next: LabelVisibility) {
  value = next;
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* mantém em memória */ }
  emit();
}
if (typeof window !== 'undefined') window.addEventListener('storage', (event) => {
  if (event.key !== KEY && event.key !== null) return;
  try { value = parseLabelVisibility(JSON.parse(event.newValue ?? 'null')); emit(); } catch { /* ignora dados inválidos */ }
});
export const labelPreferences = {
  get: () => value,
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  category: (id: LabelCategory, shown: boolean) => save({ ...value, categories: { ...value.categories, [id]: shown } }),
  details: (details: boolean) => save({ ...value, details }),
  hide: (id: string, title: string) => save({ ...value, hidden: { ...value.hidden, [id]: title } }),
  restore: (id: string) => { const hidden = { ...value.hidden }; delete hidden[id]; save({ ...value, hidden }); },
  restoreAll: () => save({ ...value, hidden: {} }),
};
export const useLabelPreferences = () => useSyncExternalStore(labelPreferences.subscribe, labelPreferences.get);
