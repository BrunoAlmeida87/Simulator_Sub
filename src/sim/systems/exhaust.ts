/**
 * DESCARGA DOS DIESEL-GERADORES — derivada do estado, sem alterar a simulação.
 *
 * Lógica operacional existente (electrical.ts + actuation.ts): os geradores
 * só partem e ficam EM CARGA com tomada de ar — na superfície (vela fora
 * d'água) ou com o mastro de snorkel içado e a válvula de cabeça aberta.
 * Submerso com o mastro recolhido, um gerador comandado fica "SEM AR": não
 * queima combustível, logo não há descarga (e não há bolhas).
 *
 * Caminho da descarga, conforme o mastro:
 *  - mastro içado → pelo mastro de snorkel/descarga (fumaça no topo, já
 *    desenhada na cena);
 *  - mastro recolhido (só possível na superfície) → pelos dispersores no
 *    casco, logo atrás da vela, abaixo da linha d'água → bolhas pequenas.
 * A intensidade acompanha a carga dos geradores (Σ P/P_nominal) e a partida.
 */
import type { VesselConfig } from '../config/types';
import type { SimState } from '../core/state';
import type { Vec3 } from '../core/math';

export interface DieselExhaust {
  /** por onde sai a descarga agora (null = nenhum gerador queimando combustível) */
  route: 'mastro' | 'dispersores' | null;
  /** carga somada dos geradores em carga (0 … nº de geradores) */
  load: number;
  /** algum gerador em partida (descarga mais densa) */
  starting: boolean;
  /** geradores em carga */
  running: number;
}

/** mastro considerado içado (o mesmo critério da fumaça no topo do mastro) */
export const MAST_RAISED = 0.5;

export function dieselExhaust(v: VesselConfig, s: SimState): DieselExhaust {
  let load = 0;
  let running = 0;
  let starting = false;
  for (const g of v.electrical.generators) {
    const st = s.electrical.generators[g.id];
    if (st.status === 'EM CARGA') {
      running++;
      // gerador em carga queima combustível mesmo em vazio (marcha lenta mínima de 15 %)
      load += Math.max(0.15, st.power / g.ratedPower);
    }
    if (st.status === 'PARTINDO') starting = true;
  }
  const active = running > 0 || starting;
  return { route: !active ? null : s.snorkel.pos > MAST_RAISED ? 'mastro' : 'dispersores', load, starting, running };
}

/**
 * Saídas dos dispersores (corpo, m): logo atrás da vela, nos dois bordos, na
 * altura do eixo — abaixo da linha d'água com o submarino na superfície.
 */
export function disperserOutlets(v: VesselConfig, radiusAt: (x: number) => number): Vec3[] {
  const x = v.hull.sail.xAft - 1.2;
  const r = radiusAt(x);
  const z = 0; // z para baixo: na altura do eixo
  const y = r * 0.99;
  return [
    { x, y: -y, z },
    { x, y, z },
  ];
}
