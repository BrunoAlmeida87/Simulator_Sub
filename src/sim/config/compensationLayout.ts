/**
 * Arranjo da compensação e banda: configurações salvas antes do conjunto de
 * três tanques (TC-1/TC-2 + banda isolada) passam ao arranjo atual — tanque
 * central sob o CG e tanques de banda ligados ao mesmo coletor —, mantendo
 * os parâmetros de bombas, válvulas de mar e limitador escolhidos.
 * Usado só nas preferências salvas (sem estado); arquivos de sessão guardam
 * o próprio estado e continuam com a configuração com que foram gravados.
 */
import type { InternalTankConfig, VesselConfig } from './types';
import { defaultVessel } from './defaultVessel';

export function upgradeCompensationLayout(v: VesselConfig): VesselConfig {
  const d = defaultVessel();
  // tanques salvos sem a forma do casco recebem a seção do padrão (mesmo id)
  const shape = (t: InternalTankConfig, def: InternalTankConfig): InternalTankConfig => (t.hullRadius === undefined && t.id === def.id ? { ...t, width: def.width, hullRadius: def.hullRadius } : t);
  const trim = { ...v.trim, tankA: shape(v.trim.tankA, d.trim.tankA), tankB: shape(v.trim.tankB, d.trim.tankB) };
  if (!v.compensation.heelBranches) {
    return {
      ...v,
      trim,
      compensation: { ...v.compensation, tanks: d.compensation.tanks, tankValves: d.compensation.tankValves, heelBranches: d.compensation.heelBranches },
      heel: { ...v.heel, name: d.heel.name, tankA: d.heel.tankA, tankB: d.heel.tankB },
    };
  }
  const isDefaultLayout = v.compensation.tanks.length === 1 && v.compensation.tanks[0].id === d.compensation.tanks[0].id;
  return {
    ...v,
    trim,
    compensation: isDefaultLayout ? { ...v.compensation, tanks: [{ ...d.compensation.tanks[0], ...pickUser(v.compensation.tanks[0]) }] } : v.compensation,
    heel: v.heel.tankA.hullRadius === undefined ? { ...v.heel, tankA: d.heel.tankA, tankB: d.heel.tankB } : v.heel,
  };
}

/** do tanque salvo, só o que o usuário pode ter ajustado (volume inicial); a forma vem do padrão se faltava */
function pickUser(t: InternalTankConfig): Partial<InternalTankConfig> {
  return t.hullRadius === undefined ? { initialVolume: t.initialVolume } : t;
}
