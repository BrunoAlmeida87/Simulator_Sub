/**
 * DISTRIBUIÇÃO ELÉTRICA — disjuntores por carga, rejeição automática por prioridade e temperatura da bateria.
 *
 *  - Disjuntor aberto: a carga não recebe energia (o motor do passo trata cada consumidor como sem barramento)
 *    e a demanda dela sai do balanço.
 *  - Rejeição automática (opcional): com demanda não atendida por `shedDelay` s, abre o disjuntor da carga
 *    ligada de maior número de prioridade (1 = nunca). As rejeitadas ficam listadas para religar.
 *  - Bateria: C·dT/dt = I²·R − h·(T − T_mar). Só indicação e alarme (não muda tensão, resistência nem capacidade).
 * Valores fictícios — ver docs/PARAMETROS.md.
 */
import type { VesselConfig } from '../config/types';
import { defaultDistribution, type BreakerId } from '../config/extSystems';
import type { SimState } from '../core/state';
import { BREAKER_IDS, initDistribution } from '../core/extState';

export const BREAKER_LABEL: Record<BreakerId, string> = {
  MEP: 'Motor elétrico principal',
  BC: 'Bomba de compensação',
  BTC: 'Bomba de transferência de compensação',
  BT: 'Bomba de trim',
  BB: 'Bomba de banda',
  HID: 'Planta hidráulica',
  COMP: 'Compressor de ar AP',
  ESG: 'Bombas de esgoto',
  HOTEL: 'Habitabilidade (ventilação, absorvedores, iluminação)',
  NAV: 'Navegação, sonar e controle',
};

/** a carga está alimentada? (barramento energizado e disjuntor fechado) */
export function loadPowered(s: SimState, id: BreakerId): boolean {
  return s.electrical.energized && (s.distribution?.breakers[id] ?? true);
}

/** zera no mapa de demandas as cargas com disjuntor aberto */
export function applyBreakers(s: SimState, demands: Record<string, number>): void {
  const b = s.distribution?.breakers;
  if (!b) return;
  for (const id of BREAKER_IDS) if (b[id] === false && id in demands) demands[id] = 0;
}

export function updateDistribution(cfg: VesselConfig, s: SimState, dt: number, seaTempC: number, log: (t: string, g: string) => void): void {
  const d = cfg.distribution ?? defaultDistribution();
  const st = (s.distribution ??= initDistribution(cfg));
  // temperatura da bateria
  const I = s.electrical.current;
  const heat = I * I * cfg.electrical.battery.internalResistance;
  st.batteryHeat = heat;
  st.batteryTemp += (dt * (heat - d.battery.cooling * (st.batteryTemp - seaTempC))) / d.battery.heatCapacity;
  // rejeição automática de cargas
  // só com o barramento energizado e sobrecarregado (sem energia nenhuma, rejeitar não adianta)
  if (st.autoShed && s.electrical.energized && (s.electrical.unservedPower ?? 0) > 1) {
    st.shedTimer += dt;
    if (st.shedTimer >= d.shedDelay) {
      st.shedTimer = 0;
      const cand = BREAKER_IDS.filter((id) => st.breakers[id] && d.priority[id] > 1 && (s.electrical.loads[id] ?? 0) > 0).sort((a, b) => d.priority[b] - d.priority[a]);
      const id = cand[0];
      if (id) {
        st.breakers[id] = false;
        if (!st.shed.includes(id)) st.shed.push(id);
        log(`REJEIÇÃO DE CARGA: disjuntor ${id} aberto (${BREAKER_LABEL[id]}) — demanda acima da disponível`, 'Elétrico');
      }
    }
  } else st.shedTimer = 0;
}
