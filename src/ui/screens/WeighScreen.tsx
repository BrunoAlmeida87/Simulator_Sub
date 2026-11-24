/**
 * Lastro e compensação › Pesagem: o "cálculo de compensação" antes de mergulhar. Prevê a flutuabilidade e o
 * desequilíbrio de trim na profundidade escolhida (TLP cheios) com a física (solveNeutralCompensation, sem
 * aplicar) e propõe as transferências; depois do mergulho compara a previsão com o real.
 */
import { useMemo } from 'react';
import { cmd, useSim } from '../store';
import { Panel } from '../components/Panel';
import { KV, ToneBadge } from '../components/StatusBits';
import { usePersisted } from '../persist';
import { solveNeutralCompensation } from '../../sim/equilibrium';
import { fmt, fmtMass } from '../format';

export function WeighScreen() {
  const e = useSim(2);
  const s = e.state;
  const [depth, setDepth] = usePersisted('pesagem.depth', 40);
  const [pred, setPred] = usePersisted<{ depth: number; deltaKg: number; t: number } | null>('pesagem.pred', null);
  const sol = useMemo(() => solveNeutralCompensation(e, Math.max(10, Math.min(e.vessel.limits.operatingDepth, depth)), false), [e, depth, Math.round(s.t / 2)]);
  const curComp = Object.values(s.compensation.tanks).reduce((a, t) => a + t.mass, 0) + s.heel.tankA.mass + s.heel.tankB.mass;
  const newComp = Object.values(sol.compensation).reduce((a, x) => a + x, 0) + sol.heelA + sol.heelB;
  const dComp = newComp - curComp;
  const dTrim = sol.trimA - s.trim.tankA.mass; // + = levar água para o TT-AV
  const dHeel = sol.heelA - s.heel.tankA.mass;
  const rho = e.env.densityAt(depth);
  const tol = 150;
  const applyAll = () => {
    if (Math.abs(dComp) > tol) cmd({ type: 'dosing', system: 'compensation', mode: dComp > 0 ? 'admitir' : 'esgotar', kg: Math.abs(dComp) });
    if (Math.abs(dTrim) > tol) cmd({ type: 'dosing', system: 'trim', mode: 'transferir', kg: Math.abs(dTrim), dir: dTrim > 0 ? 'BtoA' : 'AtoB' });
    if (Math.abs(dHeel) > tol) cmd({ type: 'dosing', system: 'heel', mode: 'transferir', kg: Math.abs(dHeel), dir: dHeel > 0 ? 'BtoA' : 'AtoB' });
    setPred({ depth, deltaKg: dComp, t: s.t });
  };
  const submerged = !e.outputs.surfaced;
  return (
    <div className="grid">
      <Panel title="Cálculo de compensação (antes de mergulhar)">
        <div className="btnrow">
          <label className="p3-field">
            profundidade de compensação <input type="number" min={10} max={e.vessel.limits.operatingDepth} step={5} value={depth} onChange={(ev) => setDepth(Number(ev.target.value))} /> m
          </label>
          <span className="subtle">ρ = {fmt(rho, 2)} kg/m³ nessa cota</span>
        </div>
        <KV
          rows={[
            ['Se mergulhar agora', Math.abs(dComp) < tol ? 'neutro (dentro de ±150 kg)' : dComp > 0 ? `LEVE: faltam ${fmtMass(dComp)} de água` : `PESADO: sobram ${fmtMass(-dComp)} de água`],
            ['Compensação (TC + TB)', `${fmtMass(curComp)} → ${fmtMass(newComp)} (${dComp >= 0 ? 'admitir' : 'esgotar'} ${fmtMass(Math.abs(dComp))})`],
            ['Trim', Math.abs(dTrim) < tol ? 'equilibrado' : `transferir ${fmtMass(Math.abs(dTrim))} ${dTrim > 0 ? 'de ré para vante (TT-AR → TT-AV)' : 'de vante para ré (TT-AV → TT-AR)'}`],
            ['Banda', Math.abs(dHeel) < tol ? 'equilibrada' : `transferir ${fmtMass(Math.abs(dHeel))} ${dHeel > 0 ? 'para bombordo' : 'para boreste'}`],
            ['Solução', sol.ok ? <ToneBadge tone="" text="DENTRO DA CAPACIDADE" /> : <ToneBadge tone="warn" text={`LIMITE: ${sol.limits.join(', ')}`} />],
          ]}
        />
        <div className="btnrow">
          <button className="btn" onClick={applyAll} disabled={Math.abs(dComp) < tol && Math.abs(dTrim) < tol && Math.abs(dHeel) < tol}>
            Aplicar pelas sequências automáticas
          </button>
        </div>
        <p className="subtle">
          Mesmo cálculo da preparação dos cenários: TLP cheios, nivelado, densidade e compressão do casco na profundidade escolhida, com todas as cargas a bordo. O botão manda as sequências de admissão/esgoto e de
          transferência (telas Lastro e Trim acompanham). {sol.message}
        </p>
      </Panel>
      <Panel title="Previsto × real (depois do mergulho)">
        {pred ? (
          <KV
            rows={[
              ['Previsão feita em', `t = ${fmt(pred.t, 0)} s para ${fmt(pred.depth, 0)} m (ajuste ${fmtMass(Math.abs(pred.deltaKg))})`],
              ['Agora', submerged ? `${fmt(e.outputs.depthKeel, 0)} m, flutuabilidade ${fmt(e.outputs.netBuoyancyKg, 0)} kg` : 'ainda na superfície'],
              ['Pitch de equilíbrio', `${fmt(e.outputs.staticPitchEq, 1)}°`],
              ['Avaliação', !submerged ? '—' : Math.abs(e.outputs.netBuoyancyKg) < 500 ? <ToneBadge tone="" text="PESAGEM BOA" /> : <ToneBadge tone="warn" text="AJUSTAR COMPENSAÇÃO" />],
            ]}
          />
        ) : (
          <p className="subtle">Aplique uma pesagem e mergulhe até a profundidade escolhida para comparar.</p>
        )}
        <p className="subtle">A diferença entre previsto e real vem do que muda no caminho: combustível consumido, cargas, temperatura/salinidade diferentes do perfil e a profundidade real.</p>
      </Panel>
    </div>
  );
}
