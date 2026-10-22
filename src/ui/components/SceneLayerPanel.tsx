/** Seletores detalhados permanecem dentro do grupo de camadas correspondente. */
import type { SimulationEngine } from '../../sim/core/engine';
import { defaultLayers, type SceneLayers } from '../../render3d/layers';
import { LayerPanel, type LayerKey } from './LayerPanel';
import { TankSelector } from './TankSelector';
import { VectorSelector } from './VectorSelector';
import { TrimGainSelect } from './TrimGain';

export function SceneLayerPanel({
  e,
  keys,
  value,
  onChange,
  hullControl = false,
  fog,
  onFogChange,
  marked,
}: {
  e: SimulationEngine;
  keys: readonly LayerKey[];
  value: Partial<SceneLayers>;
  onChange: (p: Partial<SceneLayers>) => void;
  hullControl?: boolean;
  fog?: boolean;
  onFogChange?: (v: boolean) => void;
  marked?: (k: LayerKey) => boolean;
}) {
  const L = { ...defaultLayers(), ...value };
  return (
    <LayerPanel
      keys={keys}
      value={L}
      onChange={onChange}
      marked={marked}
      sections={{
        interior: (
          <>
            {hullControl && (
              <label className="chk layer-setting">
                <input type="checkbox" checked={L.hull} onChange={(ev) => onChange({ hull: ev.target.checked, ...(!ev.target.checked ? { tanks: true } : {}) })} /> Casco externo
              </label>
            )}
            {L.tanks && (
              <details className="layer-detail">
                <summary>Escolher tanques</summary>
                <TankSelector e={e} value={L.tankFilter} onChange={(tankFilter) => onChange({ tankFilter })} />
                <label className="layer-setting">
                  Opacidade do casco
                  <input type="range" min={0.04} max={0.8} step={0.02} value={L.hullOpacity} disabled={!L.hull} onChange={(ev) => onChange({ hullOpacity: Number(ev.target.value) })} />
                </label>
              </details>
            )}
          </>
        ),
        vetores: (
          <details className="layer-detail">
            <summary>Escolher vetores e escala</summary>
            <VectorSelector value={L} onChange={onChange} individualOnly />
            <label className="layer-setting">
              Ampliação da resultante
              <select value={String(L.resultantGain)} onChange={(ev) => onChange({ resultantGain: ev.target.value === 'auto' ? 'auto' : Number(ev.target.value) })}>
                <option value="auto">Automática</option>
                {[1, 10, 100, 1000].map((gain) => (
                  <option key={gain} value={gain}>
                    ×{gain}
                  </option>
                ))}
              </select>
            </label>
            <div className="note">Peso e empuxo usam a mesma escala. O fator de ampliação da resultante aparece no rótulo.</div>
          </details>
        ),
        refs: L.trimRef ? (
          <div className="layer-setting">
            <TrimGainSelect />
          </div>
        ) : undefined,
        amb: onFogChange ? (
          <label className="chk layer-setting">
            <input type="checkbox" checked={fog} onChange={(ev) => onFogChange(ev.target.checked)} /> Turbidez
          </label>
        ) : undefined,
      }}
    />
  );
}
