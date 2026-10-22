/** Completa configurações antigas preservando os parâmetros já escolhidos. */
import type { VesselConfig } from './types';
import { defaultVessel } from './defaultVessel';

export function upgradeEmergencyAir(v: VesselConfig): VesselConfig {
  const banks = v.hpAir.banks;
  const reserve = banks.some((b) => b.purpose === 'emergency') ? [] : defaultVessel().hpAir.banks.filter((b) => b.purpose === 'emergency');
  return {
    ...v,
    hpAir: { ...v.hpAir, banks: [...banks, ...reserve] },
    ballast: {
      ...v.ballast,
      tanks: v.ballast.tanks.map((t) => ({
        ...t,
        emergencyBlowValve: t.emergencyBlowValve ?? { ...t.blowValve, id: 'VE' + t.id, name: 'Sopro de emergência ' + t.name, hydraulic: false },
      })),
    },
  };
}
