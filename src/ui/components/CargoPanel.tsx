import { useState } from 'react';
import type { SimulationEngine } from '../../sim/core/engine';
import type { CargoLoad } from '../../sim/core/state';
import { qToMat3, qFromEuler, DEG } from '../../sim/core/math';
import { cmd } from '../store';
import { fmt } from '../format';

const presets = {
  pessoas: { name: 'Pessoas', quantity: 10, unitMass: 85 },
  carga: { name: 'Carga', quantity: 1, unitMass: 1000 },
  torpedos: { name: 'Torpedos (fictícios)', quantity: 1, unitMass: 1500 },
  equipamentos: { name: 'Equipamentos', quantity: 1, unitMass: 500 },
};
const empty = (): CargoLoad => ({ id: '', category: 'carga', ...presets.carga, position: { x: 20, y: 0, z: 1 } });

export function CargoPanel({ e }: { e: SimulationEngine }) {
  const [draft, setDraft] = useState<CargoLoad>(empty);
  const [error, setError] = useState('');
  const [massUnit, setMassUnit] = useState<'kg' | 't'>('t');
  const massScale = massUnit === 't' ? 1000 : 1;
  const loads = e.state.cargoLoads ?? [];
  const total = loads.reduce((sum, l) => sum + l.quantity * l.unitMass, 0);
  const R = qToMat3(e.state.body.quat);
  const half = e.vessel.hull.length / 2;
  const depthAt = (x: number) => e.state.body.pos.z + R[6] * x + R[8] * e.vessel.hull.diameter / 2;
  const levelMoment = e.hydrostaticMoment(e.outputs.mp, qFromEuler(0, 0, e.outputs.euler.heading * DEG));
  const suggestions = (['trim', 'heel'] as const).map(system => {
    const cfg = e.vessel[system];
    const state = e.state[system];
    const arm = system === 'trim' ? cfg.tankA.center.x - cfg.tankB.center.x : cfg.tankB.center.y - cfg.tankA.center.y;
    const moment = system === 'trim' ? levelMoment.y : levelMoment.x;
    const dir = moment < 0 ? 'AtoB' as const : 'BtoA' as const;
    const source = dir === 'AtoB' ? state.tankA : state.tankB;
    const destination = dir === 'AtoB' ? state.tankB : state.tankA;
    const capacity = (dir === 'AtoB' ? cfg.tankB : cfg.tankA).capacity * 1025;
    return { system, dir, kg: Math.abs(moment / (e.env.cfg.gravity * arm)), limit: Math.max(0, Math.min(source.mass, capacity - destination.mass)) };
  });
  const apply = () => {
    const { x, y, z } = draft.position;
    if (!draft.name.trim() || ![draft.quantity, draft.unitMass, x, y, z].every(Number.isFinite)
      || !Number.isInteger(draft.quantity) || draft.quantity < 1 || draft.unitMass <= 0
      || draft.quantity * draft.unitMass > 200000 || Math.abs(x) > half || Math.hypot(y, z) > e.geom.radiusAt(x)) {
      setError('Informe nome, quantidade inteira e massa positiva (até 200 t por item), com posição dentro do casco.');
      return;
    }
    cmd({ type: 'cargoUpsert', load: { ...draft, id: draft.id || `cargo-${Date.now()}-${Math.random().toString(36).slice(2)}` } });
    setDraft(empty()); setError('');
  };
  return <div className="col">
    <div className="row">
      <span className="badge info">{e.outputs.surfaced ? 'Superfície — maior rigidez longitudinal' : 'Submerso — menor rigidez longitudinal'}</span>
      <b>Carga adicional: {fmt(total / 1000, 3)} t</b>
      <span>Massa total: {fmt(e.outputs.mp.mass / 1000, 3)} t</span>
    </div>
    <div className="row"><button className="btn sm" onClick={() => cmd({ type: 'seaState', value: 0 })}>Mar calmo para ensaio</button></div>
    <div className="row mono">
      <span>Banda real: {fmt(e.outputs.euler.roll, 3)}°</span>
      <span>Pitch real: {fmt(e.outputs.euler.pitch, 3)}°</span>
      <span>Profundidade da referência inferior de vante: {fmt(depthAt(half), 3)} m</span>
      <span>Ré: {fmt(depthAt(-half), 3)} m</span>
      <span>Diferença vante − ré: {fmt((depthAt(half) - depthAt(-half)) * 100, 1)} cm</span>
    </div>
    <div className="row">
      <label>Tipo <select value={draft.category} onChange={ev => {
        const category = ev.target.value as CargoLoad['category'];
        setDraft({ ...draft, category, ...presets[category] });
      }}>{Object.keys(presets).map(k => <option key={k} value={k}>{presets[k as keyof typeof presets].name}</option>)}</select></label>
      <label>Nome <input value={draft.name} maxLength={80} onChange={ev => setDraft({ ...draft, name: ev.target.value })} /></label>
      <label>Quantidade <input type="number" min={1} step={1} value={draft.quantity} onChange={ev => setDraft({ ...draft, quantity: Number(ev.target.value) })} /></label>
      <label>Massa por unidade <input type="number" min={0.001} step={massUnit === 't' ? 0.1 : 10} value={draft.unitMass / massScale} onChange={ev => setDraft({ ...draft, unitMass: Number(ev.target.value) * massScale })} /></label>
      <label>Unidade <select value={massUnit} onChange={ev => setMassUnit(ev.target.value as 'kg' | 't')}><option value="t">toneladas</option><option value="kg">kg</option></select></label>
    </div>
    <div className="row">
      <span>Local:</span>
      {[['Vante', 20], ['Centro', 0], ['Ré', -20]].map(([label, x]) => <button key={label} className="btn sm" onClick={() => setDraft({ ...draft, position: { ...draft.position, x: Number(x) } })}>{label}</button>)}
      {[['Bombordo', -1.5], ['Linha de centro', 0], ['Boreste', 1.5]].map(([label, y]) => <button key={label} className="btn sm" onClick={() => setDraft({ ...draft, position: { ...draft.position, y: Number(y) } })}>{label}</button>)}
      {(['x', 'y', 'z'] as const).map(axis => <label key={axis}>{axis.toUpperCase()} (m) <input type="number" step={0.5} value={draft.position[axis]} onChange={ev => setDraft({ ...draft, position: { ...draft.position, [axis]: Number(ev.target.value) } })} /></label>)}
      <button className="btn" onClick={apply}>{draft.id ? 'Salvar alteração / mover' : 'Embarcar carga'}</button>
      {draft.id && <button className="btn sm" onClick={() => { setDraft(empty()); setError(''); }}>Cancelar edição</button>}
    </div>
    {error && <div role="alert" className="badge warn">{error}</div>}
    <div style={{ overflowX: 'auto' }}><table className="t"><thead><tr><th>Carga</th><th>Quantidade × kg</th><th>Total (t)</th><th>X / Y / Z (m)</th><th>Ações</th></tr></thead><tbody>
      {loads.map(l => <tr key={l.id}><td>{l.name}</td><td>{l.quantity} × {l.unitMass}</td><td>{fmt(l.quantity * l.unitMass / 1000, 3)}</td><td>{l.position.x} / {l.position.y} / {l.position.z}</td><td>
        <button className="btn sm" onClick={() => { setDraft(structuredClone(l)); setError(''); }}>Editar / mover</button>
        <button className="btn sm" onClick={() => cmd({ type: 'cargoRemove', id: l.id })}>Desembarcar</button>
      </td></tr>)}
      {!loads.length && <tr><td colSpan={5}>Nenhuma carga adicional. As cargas de projeto e o peso móvel continuam a bordo.</td></tr>}
    </tbody></table></div>
    <div className="row">
      {suggestions.map(t => <div key={t.system}>
        <span>Correção aproximada de {t.system === 'trim' ? 'trim' : 'banda'}: {fmt(t.kg, 0)} kg {t.dir === 'AtoB' ? 'A → B' : 'B → A'}; disponível {fmt(t.limit, 0)} kg. </span>
        <button className="btn sm" disabled={t.kg < 10 || t.limit < 10 || !!e.state[t.system].dosing?.active} onClick={() => cmd({ type: 'dosing', system: t.system, mode: 'transferir', dir: t.dir, kg: Math.min(t.kg, t.limit) })}>Transferir {fmt(Math.min(t.kg, t.limit), 0)} kg</button>
        {t.kg > t.limit + 1 && <span className="badge warn">Capacidade insuficiente para correção completa</span>}
      </div>)}
    </div>
    <div className="subtle">Sugestões calculadas para nivelar o casco na posição atual, sem ondas ou lemes; reavaliar após a transferência e a mudança de calado. A = tanque de vante/bombordo; B = ré/boreste.</div>
    <div className="note">X positivo = vante; Y positivo = boreste; Z positivo = abaixo do eixo do casco. Embarcar altera massa e centro de gravidade; mover conserva massa. As cargas permanecem durante o mergulho e são salvas com o cenário. Não há compensação automática. Na superfície, observe também a diferença em centímetros; submerso, adicionar peso aumenta a tendência de afundar. Para comparar, embarque 1 t na vante, observe e depois mergulhe com a mesma carga. Os comandos dos tanques abaixo permitem corrigir trim e banda; o painel de compensação permite ajustar a flutuabilidade.</div>
  </div>;
}
