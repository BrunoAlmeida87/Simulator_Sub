/** Seletores de estado do mar (física + visual), de qualidade gráfica, de iluminação e de sol e luzes (visuais). */
import { useState } from 'react';
import { cmd, useSim } from '../store';
import { LightPanel, hhmm } from './LightPanel';
import { SEA_STATES } from '../../sim/environment/waves';
import type { OceanQuality } from '../../render3d/Ocean';
import type { SceneLighting } from '../../render3d/lighting';
import { graphics, useGraphics, LIGHTING_LABELS, LIGHTINGS } from '../graphics';

export function SeaControls({ quality, setQuality }: { quality: OceanQuality; setQuality: (q: OceanQuality) => void }) {
  const e = useSim(4);
  const g = useGraphics();
  const ss = Math.round(e.env.cfg.waves?.seaState ?? 0);
  const [sunOpen, setSunOpen] = useState(false);
  const night = g.sunHour < 6 || g.sunHour > 18;
  return (
    <>
      <div className="seg" style={{ alignItems: 'center' }}>
        <span style={{ padding: '0 6px', fontSize: 11, color: '#9fb7cf' }} title={SEA_STATES[ss]?.label}>
          Mar {ss} · Hs {e.env.waves.hs.toFixed(1)} m
        </span>
        <select value={ss} onChange={(ev) => cmd({ type: 'seaState', value: Number(ev.target.value) })} style={{ border: 'none', fontSize: 11 }} aria-label="Estado do mar">
          {SEA_STATES.map((s, i) => (
            <option key={i} value={i}>
              {s.label}
            </option>
          ))}
        </select>
        <select value={quality} onChange={(ev) => setQuality(ev.target.value as OceanQuality)} style={{ border: 'none', fontSize: 11 }} aria-label="Qualidade gráfica">
          <option value="baixa">Gráfico: baixo</option>
          <option value="media">Gráfico: médio</option>
          <option value="alta">Gráfico: alto</option>
        </select>
        <select
          value={g.lighting}
          onChange={(ev) => graphics.set({ lighting: ev.target.value as SceneLighting })}
          style={{ border: 'none', fontSize: 11 }}
          aria-label="Iluminação da cena"
          title="Iluminação da cena (só visual): Natural escurece com a profundidade; Clara destaca o submarino; Estúdio para projetor"
        >
          {LIGHTINGS.map((k) => (
            <option key={k} value={k}>
              Luz: {LIGHTING_LABELS[k].toLowerCase()}
            </option>
          ))}
        </select>
        <button className={sunOpen ? 'on' : ''} onClick={() => setSunOpen(!sunOpen)} title="Sol e luzes: hora do dia, direção do sol, luar, luzes de navegação, faróis e água escura (só visual)" aria-expanded={sunOpen}>
          {night ? '☾' : '☀'} {hhmm(g.sunHour)}
          {g.subLights ? ' · faróis' : ''} {sunOpen ? '▴' : '▾'}
        </button>
      </div>
      {sunOpen && (
        <div className="tanksel-pop">
          <LightPanel />
        </div>
      )}
    </>
  );
}
