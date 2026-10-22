/**
 * Arranjo da compensação e banda: configurações salvas antes do conjunto de
 * três tanques (TC-1/TC-2 + banda isolada) passam ao arranjo atual — tanque
 * central sob o CG e tanques de banda ligados ao mesmo coletor —, mantendo
 * os parâmetros de bombas, válvulas de mar e limitador escolhidos.
 * Usado só nas preferências salvas (sem estado); arquivos de sessão guardam
 * o próprio estado e continuam com a configuração com que foram gravados.
 */
import type { VesselConfig } from './types';
import { defaultVessel } from './defaultVessel';

export function upgradeCompensationLayout(v: VesselConfig): VesselConfig {
  if (v.compensation.heelBranches) return v;
  const d = defaultVessel();
  return {
    ...v,
    compensation: { ...v.compensation, tanks: d.compensation.tanks, tankValves: d.compensation.tankValves, heelBranches: d.compensation.heelBranches },
    heel: { ...v.heel, name: d.heel.name, tankA: d.heel.tankA, tankB: d.heel.tankB },
  };
}
