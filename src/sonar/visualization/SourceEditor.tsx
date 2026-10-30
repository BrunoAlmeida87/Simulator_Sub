import { useState } from 'react';
import type { SimulationEngine } from '../../sim/core/engine';
import { cmd } from '../../ui/store';
import { Panel } from '../../ui/components/Panel';
import { worldSources } from '../integration/world';
import { signature } from '../sources/signatures';
import type { SourceOverride } from '../types';
/** Truth-authorized diagnostic editor. Never used to label an operational contact. */
export function SourceEditor({ engine }: { engine: SimulationEngine }) {
  const sources = worldSources(engine),
    [id, setId] = useState('');
  const source = sources.find((s) => s.id === id) ?? sources[0];
  const [tones, setTones] = useState('');
  if (!source) return null;
  const settings = engine.state.sonar!.settings,
    override = settings.sourceOverrides[source.id] ?? {},
    sig = signature(source, override);
  const set = (patch: SourceOverride | null) => cmd({ type: 'sonar', action: 'source', id: source.id, patch });
  return (
    <Panel title="Fontes · configuração científica" fold="sonar.sources" foldOpen={false}>
      <p className="note">
        Verdade do cenário: parâmetros acústicos sintéticos dos navios existentes. Esta configuração não fornece a identidade das trilhas Snnn. As rotas existentes continuam governando o movimento dos navios.
      </p>
      <div className="acoustic-controls">
        <label>
          Entidade do cenário
          <select
            value={source.id}
            onChange={(ev) => {
              setId(ev.target.value);
              setTones('');
            }}
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} · {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nível de fonte (dB)
          <input type="number" min="40" max="190" value={Math.round(override.level ?? signature(source).level)} onChange={(ev) => set({ level: +ev.target.value })} />
        </label>
        <label>
          Eixo sintético (Hz)
          <input type="number" min="0.1" max="20" step="0.1" value={+(override.shaftHz ?? signature(source).shaftHz).toFixed(1)} onChange={(ev) => set({ shaftHz: +ev.target.value })} />
        </label>
        <label>
          Pás simuladas
          <input type="number" min="2" max="8" value={sig.blades} onChange={(ev) => set({ blades: +ev.target.value })} />
        </label>
        <label>
          <input type="checkbox" checked={override.propulsion !== false} onChange={(ev) => set({ propulsion: ev.target.checked })} /> Emissão da propulsão
        </label>
        <button className="btn" onClick={() => set(null)}>
          Restaurar assinatura genérica
        </button>
      </div>
      <div className="acoustic-controls">
        <label>
          Tons em Hz, separados por vírgula
          <input type="text" value={tones} placeholder={sig.tones.map((f) => f.toFixed(1)).join(', ')} onChange={(ev) => setTones(ev.target.value)} />
        </label>
        <button
          className="btn"
          disabled={!tones.trim()}
          onClick={() => {
            set({ tones: tones.split(',').map((v) => Number(v.trim())) });
            setTones('');
          }}
        >
          Aplicar tons
        </button>
      </div>
    </Panel>
  );
}
