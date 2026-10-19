/** Instâncias de sincronismo entre janelas (definidas em main.tsx). */
import type { SyncMaster, SyncViewer } from './sync';

export const link: { master: SyncMaster | null; viewer: SyncViewer | null } = { master: null, viewer: null };
