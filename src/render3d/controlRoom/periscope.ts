/**
 * ÓPTICA DO PERISCÓPIO (ilustrativa): altura da cabeça acima d'água, alcance
 * visual até o horizonte, contatos à vista e o ESTADÍMETRO — a distância é
 * estimada pela altura conhecida do mastro do alvo e o ângulo que ele ocupa
 * na ocular (distância ≈ altura / tan(ângulo)); o erro cresce com o menor
 * aumento. Só lê o estado: nada aqui altera a simulação.
 */
import type { SimulationEngine } from '../../sim/core/engine';
import type { Contact } from '../../sim/geo';
import { periscopeCfg, periscopeHeadZ } from '../../sim/systems/actuation';
import { pointHeightAboveWater } from './mastHeight';
import { roomContacts, type RoomContact } from './panelsCombat';
import type { RoomActions } from './actions';

/** altura típica do mastro/superestrutura de cada classe de contato (m) */
export const TARGET_HEIGHT: Record<Contact['kind'], number> = { mercante: 32, patrulha: 20, rebocador: 13, pesqueiro: 9 };

/**
 * altura do topo da cabeça do periscópio acima do nível médio da água (m;
 * negativa = submersa), com o caturro e o balanço do casco. null = periscópio arriado.
 */
export function periHeadAbove(e: SimulationEngine): number | null {
  const pos = e.state.periscope?.pos ?? 0;
  if (pos < 0.02) return null;
  return pointHeightAboveWater(e, periscopeCfg(e.vessel).x, periscopeHeadZ(e.vessel, pos), false);
}

/**
 * Folga da JANELA da cabeça do periscópio sobre a superfície LOCAL (com a
 * onda), no instante t (m; negativa = a crista cobre a cabeça). Considera o
 * caturro e o balanço do casco. null = periscópio arriado.
 */
export function periHeadClearance(e: SimulationEngine, t = e.state.t): number | null {
  const pos = e.state.periscope?.pos ?? 0;
  if (pos < 0.02) return null;
  return pointHeightAboveWater(e, periscopeCfg(e.vessel).x, periscopeHeadZ(e.vessel, pos) + 0.3, true, t);
}

/** alcance geométrico até o horizonte entre um olho a hEye m e um alvo de hTarget m (m) */
export function horizonRange(hEye: number, hTarget: number): number {
  return 3570 * (Math.sqrt(Math.max(0.05, hEye)) + Math.sqrt(Math.max(0, hTarget)));
}

export interface PeriContact extends RoomContact {
  /** marcação relativa à linha de visada do periscópio (°, + = à direita) */
  off: number;
}

const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/** contatos visíveis pelo periscópio (cabeça fora d'água e dentro do horizonte), com a marcação relativa à linha de visada */
export function periVisible(e: SimulationEngine, act: RoomActions, sightRel: number): PeriContact[] {
  const h = periHeadAbove(e);
  if (h === null || h <= 0.05 || (e.state.periscope?.pos ?? 0) < 0.97) return [];
  const los = e.outputs.euler.heading + sightRel;
  return roomContacts(e, act)
    .filter((c) => c.rng < horizonRange(h, TARGET_HEIGHT[c.kind]))
    .map((c) => ({ ...c, off: wrap180(c.brg - los) }));
}

/** ruído determinístico em [−1, 1] (mesmo contato e minuto ⇒ mesma leitura) */
function noise(id: string, t: number): number {
  let x = Math.floor(t / 60) * 7919;
  for (let i = 0; i < id.length; i++) x = (x * 31 + id.charCodeAt(i)) | 0;
  x = (x ^ (x >>> 13)) * 1274126177;
  return (((x ^ (x >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}

/** estadímetro: distância estimada (m) do contato; erro de até ±4 % em alto aumento e ±9 % no baixo */
export function stadimeter(c: { id: string; rng: number }, t: number, highPower: boolean): number {
  const err = highPower ? 0.04 : 0.09;
  return c.rng * (1 + err * noise(c.id, t));
}
