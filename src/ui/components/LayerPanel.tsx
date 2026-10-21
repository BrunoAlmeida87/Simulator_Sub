/**
 * Lista de camadas com “Marcar todas” e “Desmarcar todas”. Qualquer
 * combinação é permitida, inclusive nenhuma camada: nada é religado sem um
 * clique do operador.
 */
import { LAYER_INFO, allLayersOff, allLayersOn, type BoolLayer, type SceneLayers } from '../../render3d/layers';

export type LayerKey = Exclude<BoolLayer, 'hull'>;

export function LayerPanel({ keys, value, onChange, note }: { keys: readonly LayerKey[]; value: Partial<SceneLayers>; onChange: (p: Partial<SceneLayers>) => void; note?: string }) {
  const anyOn = keys.some((k) => !!value[k]);
  const allOn = keys.every((k) => LAYER_INFO[k].mode || !!value[k]);
  return (
    <div className="layerpanel">
      <div className="row" style={{ gap: 4 }}>
        <button className={`btn sm ${allOn ? 'on' : ''}`} onClick={() => onChange(allLayersOn(keys))} title="Liga todas as camadas de informação (não tira a água nem muda a iluminação)">
          ☑ Marcar todas
        </button>
        <button className={`btn sm ${!anyOn ? 'on' : ''}`} onClick={() => onChange(allLayersOff(keys))} title="Desliga todas as camadas: só o submarino e o mar">
          ☐ Desmarcar todas
        </button>
      </div>
      <div className="btngroup mt4">
        {keys.map((k) => (
          <button key={k} className={`btn sm ${value[k] ? 'on' : ''}`} onClick={() => onChange({ [k]: !value[k] })} title={LAYER_INFO[k].title}>
            {value[k] ? '☑' : '☐'} {LAYER_INFO[k].label}
          </button>
        ))}
      </div>
      {(keys.includes('batteryInfo') || keys.includes('airInfo')) && !value.tanks && (value.batteryInfo || value.airInfo) && (
        <div className="note mt4">Bateria e ar comprimido aparecem junto aos componentes internos: ligue “Tanques (corte)”.</div>
      )}
      {note && <div className="note mt4">{note}</div>}
    </div>
  );
}
