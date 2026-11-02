/**
 * Valores INDICADOS (instrumentos) mostrados ao operador — os mesmos em todas as
 * telas de operação (barra superior, Operação, Central de comando, Governo, Sala,
 * periscópio). O valor verdadeiro do modelo (outputs.depthKeel) fica para o modo
 * engenharia, o Histórico e as telas didáticas (Apresentação, Estúdio), que
 * explicam a física. Só lê o estado.
 */
import type { SimulationEngine } from '../sim/core/engine';

/** profundidade indicada na quilha: média dos profundímetros PRF-1 e PRF-2 */
export function indicatedDepth(e: SimulationEngine): number {
  const s = e.state.sensors;
  return 0.5 * (s.PRF1.value + s.PRF2.value);
}
