/** Escolha dos vetores visíveis (individualmente ou por grupo). */
import type { SceneLayers } from '../../render3d/layers';

type VecLayers = Pick<SceneLayers, 'vectors' | 'hydroVectors' | 'trimVectors' | 'hiddenVectors'>;

const GROUPS: { key: 'vectors' | 'hydroVectors' | 'trimVectors'; label: string; color: string; items: [string, string][] }[] = [
  { key: 'vectors', label: 'Equilíbrio vertical', color: '#49dcff', items: [['E', 'Empuxo'], ['P', 'Peso'], ['R', 'Resultante E − P']] },
  { key: 'hydroVectors', label: 'Hidrodinâmicas', color: '#a8ff7a', items: [['prop', 'Hélice'], ['drag', 'Resistência'], ['bow', 'Lemes de vante'], ['stern', 'Lemes de ré'], ['rudder', 'Leme de direção']] },
  { key: 'trimVectors', label: 'Trim (peso deslocável e tanques)', color: '#ff7ad1', items: [] },
];

export function VectorSelector({ value, onChange }: { value: VecLayers; onChange: (v: Partial<VecLayers>) => void }) {
  const hid = new Set(value.hiddenVectors ?? []);
  const toggleItem = (g: (typeof GROUPS)[number], id: string) => {
    const n = new Set(hid);
    if (!value[g.key]) {
      // ligar o grupo mostrando só este vetor
      for (const [i] of g.items) n.add(i);
      n.delete(id);
      onChange({ [g.key]: true, hiddenVectors: [...n] } as Partial<VecLayers>);
      return;
    }
    if (n.has(id)) n.delete(id);
    else n.add(id);
    onChange({ hiddenVectors: [...n] });
  };
  const allOn = GROUPS.every((g) => value[g.key]) && hid.size === 0;
  return (
    <div className="vecsel">
      <div className="row" style={{ gap: 4 }}>
        <button className={`btn sm ${allOn ? 'on' : ''}`} onClick={() => onChange({ vectors: true, hydroVectors: true, trimVectors: true, hiddenVectors: [] })}>
          Todos
        </button>
        <button className="btn sm" onClick={() => onChange({ vectors: false, hydroVectors: false, trimVectors: false })}>
          Nenhum
        </button>
      </div>
      {GROUPS.map((g) => (
        <div key={g.key} className="tsel-row">
          <button className="tsel-g" style={{ color: g.color }} onClick={() => onChange({ [g.key]: !value[g.key] } as Partial<VecLayers>)}>
            {value[g.key] ? (g.items.some(([i]) => hid.has(i)) ? '◩' : '☑') : '☐'} {g.label}
          </button>
          {g.items.map(([id, l]) => {
            const on = value[g.key] && !hid.has(id);
            return (
              <button key={id} className={`tsel-t ${on ? 'on' : ''}`} style={on ? { borderColor: g.color, background: `${g.color}33` } : undefined} onClick={() => toggleItem(g, id)}>
                {l}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
