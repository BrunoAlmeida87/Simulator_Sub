/**
 * Camadas da cena 3D AGRUPADAS (vetores, interior, mar e efeitos, rótulos,
 * ambiente). Cada grupo tem um botão que marca/desmarca o grupo inteiro; cada
 * camada tem o seu; "Marcar todas" e "Desmarcar todas" valem para a lista.
 * Qualquer combinação é permitida, inclusive nenhuma camada: nada é religado
 * sem um clique do operador.
 */
import { LAYER_GROUPS, LAYER_INFO, allLayersOff, allLayersOn, toggleLayerGroup, type BoolLayer, type SceneLayers } from '../../render3d/layers';

export type LayerKey = Exclude<BoolLayer, 'hull'>;

export function LayerPanel({
  keys,
  value,
  onChange,
  note,
  marked,
}: {
  keys: readonly LayerKey[];
  value: Partial<SceneLayers>;
  onChange: (p: Partial<SceneLayers>) => void;
  note?: string;
  /** destaca camadas (ex.: alteradas nesta janela) */
  marked?: (k: LayerKey) => boolean;
}) {
  const anyOn = keys.some((k) => !!value[k]);
  const allOn = keys.every((k) => LAYER_INFO[k].mode || !!value[k]);
  const groups = LAYER_GROUPS.map((g) => ({ ...g, keys: g.keys.filter((k) => keys.includes(k)) })).filter((g) => g.keys.length);
  // camadas da lista que não estão em nenhum grupo (segurança)
  const loose = keys.filter((k) => !LAYER_GROUPS.some((g) => g.keys.includes(k)));
  if (loose.length) groups.push({ id: 'outras', label: 'Outras', title: '', keys: loose });
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
      <div className="layergroups mt4">
        {groups.map((g) => {
          const on = g.keys.filter((k) => !!value[k]).length;
          const full = on === g.keys.length;
          return (
            <div key={g.id} className="layergroup">
              <button className={`layergroup-h ${on ? (full ? 'all' : 'some') : ''}`} title={`${g.title} — clique para ${on ? 'desmarcar' : 'marcar'} o grupo`} onClick={() => onChange(toggleLayerGroup(g.keys, value))}>
                <span className="lg-box">{full ? '☑' : on ? '◩' : '☐'}</span> {g.label}{' '}
                <small>
                  {on}/{g.keys.length}
                </small>
              </button>
              <div className="layergroup-items">
                {g.keys.map((k) => (
                  <button key={k} className={`btn sm ${value[k] ? 'on' : ''}`} onClick={() => onChange({ [k]: !value[k] })} title={LAYER_INFO[k].title + (marked?.(k) ? ' (alterada nesta janela)' : '')}>
                    {value[k] ? '☑' : '☐'} {LAYER_INFO[k].label}
                    {marked?.(k) ? ' •' : ''}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {(keys.includes('batteryInfo') || keys.includes('airInfo')) && !value.tanks && (value.batteryInfo || value.airInfo) && (
        <div className="note mt4">Bateria e ar comprimido aparecem junto aos componentes internos: ligue “Tanques (corte)”.</div>
      )}
      {note && <div className="note mt4">{note}</div>}
    </div>
  );
}
