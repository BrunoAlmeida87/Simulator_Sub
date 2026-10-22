/** Seleção dos tanques visíveis no corte (todos, nenhum, por grupo ou um a um). Lista vazia = nenhum tanque. */
import type { SimulationEngine } from '../../sim/core/engine';
import { TANK_STYLE, type TankCategory } from '../../render3d/layers';

export function tankGroups(e: SimulationEngine): { cat: TankCategory; tanks: { id: string; short: string }[] }[] {
  const v = e.vessel;
  return [
    { cat: 'lastro', tanks: v.ballast.tanks.map((t) => ({ id: t.id, short: t.id.replace('TLP', 'TLP-').replace(/(BB|BE)$/, ' $1') })) },
    { cat: 'compensacao', tanks: v.compensation.tanks.map((t) => ({ id: t.id, short: t.id.replace('TC', 'TC-') })) },
    { cat: 'trim', tanks: [{ id: v.trim.tankA.id, short: 'TT-AV' }, { id: v.trim.tankB.id, short: 'TT-AR' }] },
    { cat: 'banda', tanks: [{ id: v.heel.tankA.id, short: 'TB-BB' }, { id: v.heel.tankB.id, short: 'TB-BE' }] },
  ];
}

export function TankSelector({ e, value, onChange }: { e: SimulationEngine; value: string[] | null; onChange: (v: string[] | null) => void }) {
  const groups = tankGroups(e);
  const all = groups.flatMap((g) => g.tanks.map((t) => t.id));
  const sel = new Set(value ?? all);
  const set = (ids: Set<string>) => onChange(ids.size === all.length ? null : [...ids]);
  const toggle = (id: string) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    set(n);
  };
  const toggleGroup = (ids: string[]) => {
    const allOn = ids.every((i) => sel.has(i));
    const n = new Set(sel);
    for (const i of ids) {
      if (allOn) n.delete(i);
      else n.add(i);
    }
    set(n);
  };
  return (
    <div className="tanksel">
      <div className="row" style={{ gap: 4 }}>
        <button className={`btn sm ${!value ? 'on' : ''}`} onClick={() => onChange(null)}>
          Todos
        </button>
        <button className={`btn sm ${value && value.length === 0 ? 'on' : ''}`} onClick={() => onChange([])} title="Nenhum tanque no corte (casco e circuitos continuam)">
          Nenhum
        </button>
        {groups.map((g) => (
          <button key={g.cat} className="btn sm" style={{ borderColor: TANK_STYLE[g.cat].css, color: TANK_STYLE[g.cat].css }} onClick={() => onChange(g.tanks.map((t) => t.id))} title={`Mostrar só: ${TANK_STYLE[g.cat].label}`}>
            Só {TANK_STYLE[g.cat].label.toLowerCase()}
          </button>
        ))}
      </div>
      {groups.map((g) => {
        const ids = g.tanks.map((t) => t.id);
        const on = ids.every((i) => sel.has(i));
        return (
          <div key={g.cat} className="tsel-row">
            <button className="tsel-g" style={{ color: TANK_STYLE[g.cat].css }} onClick={() => toggleGroup(ids)} title="Liga/desliga o grupo">
              {on ? '☑' : ids.some((i) => sel.has(i)) ? '◩' : '☐'} {TANK_STYLE[g.cat].label}
            </button>
            {g.tanks.map((t) => (
              <button key={t.id} className={`tsel-t ${sel.has(t.id) ? 'on' : ''}`} style={sel.has(t.id) ? { borderColor: TANK_STYLE[g.cat].css, background: `${TANK_STYLE[g.cat].css}33` } : undefined} onClick={() => toggle(t.id)}>
                {t.short}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
