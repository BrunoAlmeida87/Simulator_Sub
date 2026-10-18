/** Seletores de estado do mar (física + visual) e de qualidade gráfica. */
import { cmd, useSim } from '../store';
import { SEA_STATES } from '../../sim/environment/waves';
import type { OceanQuality } from '../../render3d/Ocean';

export function SeaControls({ quality, setQuality }: { quality: OceanQuality; setQuality: (q: OceanQuality) => void }) {
  const e = useSim(4);
  const ss = Math.round(e.env.cfg.waves?.seaState ?? 0);
  return (
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
    </div>
  );
}
