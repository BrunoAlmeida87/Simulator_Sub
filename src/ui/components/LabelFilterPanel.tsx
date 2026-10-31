import { LABEL_CATEGORIES } from '../../render3d/labelVisibility';
import { labelPreferences, useLabelPreferences } from '../labelPreferences';

export function LabelFilterPanel() {
  const prefs = useLabelPreferences();
  const hidden = Object.entries(prefs.hidden);
  return <details className="layer-detail">
    <summary>Escolher identificações</summary>
    <div className="label-filter-grid">
      {LABEL_CATEGORIES.map(([id, title]) => <label className="chk" key={id}>
        <input type="checkbox" checked={prefs.categories[id]} onChange={(event) => labelPreferences.category(id, event.target.checked)} />{title}
      </label>)}
    </div>
    <label className="chk layer-setting"><input type="checkbox" checked={prefs.details} onChange={(event) => labelPreferences.details(event.target.checked)} />Mostrar segunda linha de detalhes</label>
    <p className="note">Com a camada “Identificações” ligada, clique em um texto no 3D para ocultá-lo individualmente. Os filtros de texto são compartilhados entre as telas e janelas deste navegador.</p>
    <details className="layer-detail">
      <summary>Identificações ocultadas ({hidden.length})</summary>
      {hidden.length ? <>
        <button className="btn sm" onClick={labelPreferences.restoreAll}>Restaurar todas as identificações ocultadas</button>
        <ul className="label-hidden-list">{hidden.map(([id, title]) => <li key={id}><span>{title}</span><button className="btn sm" onClick={() => labelPreferences.restore(id)} aria-label={`Restaurar ${title}`}>Restaurar</button></li>)}</ul>
      </> : <p className="note">Nenhuma identificação ocultada individualmente.</p>}
    </details>
  </details>;
}
