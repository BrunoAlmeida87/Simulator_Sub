import type { SimulationEngine } from '../../sim/core/engine';
import { clamp, initialSonar, wrap, ring, values, push, type SourceOverride, type SonarSettings } from '../types';
import { emitPing } from '../sensors/active';
import { associate } from '../contacts/tracker';
import { observer, worldSources } from './world';
export type SonarCommand =
  | { type: 'sonar'; action: 'source'; id: string; patch: SourceOverride | null }
  | { type: 'sonar'; action: 'settings'; patch: Partial<SonarSettings> }
  | { type: 'sonar'; action: 'ping' }
  | { type: 'sonar'; action: 'mark'; bearing: number }
  | { type: 'sonar'; action: 'classify'; id: string; label: string };
export function sonarCommand(e: SimulationEngine, c: SonarCommand): void {
  const s = (e.state.sonar ??= initialSonar());
  if (c.action === 'ping') {
    if (emitPing(e)) e.log('Sonar: emissão ativa', 'Sonar');
    return;
  }
  if (c.action === 'settings') {
    const bounds: Partial<Record<keyof SonarSettings, [number, number]>> = {
      historySeconds: [30, 900],
      coverage: [30, 360],
      integration: [1, 30],
      beam: [0, 359],
      traffic: [0, 20],
      biological: [0, 1],
      shipping: [0, 1],
      rayCount: [8, 512],
      section: [0, 359],
      range: [500, 20000],
    };
    for (const [key, val] of Object.entries(c.patch)) {
      const k = key as keyof SonarSettings,
        bound = bounds[k];
      if (bound && typeof val === 'number' && Number.isFinite(val)) Object.assign(s.settings, { [k]: clamp(val, ...bound) });
      else if (['enabled', 'homogeneous', 'intercept'].includes(k) && typeof val === 'boolean') Object.assign(s.settings, { [k]: val });
      else if (k === 'selected' && (val === null || s.tracks.some((x) => x.id === val))) s.settings.selected = val as string | null;
    }
    s.settings.historySeconds = Math.round(s.settings.historySeconds);
    if (s.history.capacity !== s.settings.historySeconds) {
      const kept = values(s.history).slice(-s.settings.historySeconds);
      s.history = ring(s.settings.historySeconds);
      for (const frame of kept) push(s.history, frame);
    }
    s.settings.rayCount = Math.round(s.settings.rayCount);
    s.settings.traffic = Math.round(s.settings.traffic);
    e.log('Sonar: ajustes ' + Object.keys(c.patch).join(', '), 'Sonar');
  } else if (c.action === 'source') {
    if (!worldSources(e).some((source) => source.id === c.id)) return;
    if (c.patch === null) delete s.settings.sourceOverrides[c.id];
    else {
      const out = (s.settings.sourceOverrides[c.id] ??= {});
      for (const [key, lo, hi] of [
        ['level', 40, 190],
        ['shaftHz', 0.1, 20],
        ['blades', 2, 8],
      ] as const) {
        const v = c.patch[key];
        if (typeof v === 'number' && Number.isFinite(v)) out[key] = key === 'blades' ? Math.round(clamp(v, lo, hi)) : clamp(v, lo, hi);
      }
      if (typeof c.patch.propulsion === 'boolean') out.propulsion = c.patch.propulsion;
      if (Array.isArray(c.patch.tones)) out.tones = c.patch.tones.filter((v) => Number.isFinite(v) && v >= 1 && v <= 1000).slice(0, 8);
    }
    e.log('Sonar: configuração científica de fonte ' + c.id, 'Sonar');
  } else if (c.action === 'mark' && Number.isFinite(c.bearing)) {
    const bearing = wrap(c.bearing),
      index = Math.round(bearing / 2) % 180;
    const t = associate(s, { t: e.state.t, bearing, sigma: 3, snr: s.frame?.broadband[index] ?? 0, observer: observer(e), mode: 'passive' });
    s.settings.selected = t.id;
    e.log(`Sonar: marcação manual ${bearing.toFixed(1)}°`, 'Sonar');
  } else if (c.action === 'classify') {
    const t = s.tracks.find((x) => x.id === c.id);
    if (t) t.manual = c.label.trim().slice(0, 60);
    e.log('Sonar: classificação manual', 'Sonar');
  }
  s.version++;
}
