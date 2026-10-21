/**
 * DESCARGA DOS DIESEL-GERADORES — derivada do estado, sem alterar a simulação.
 *
 * Lógica operacional existente (electrical.ts + actuation.ts): os geradores
 * só partem e ficam EM CARGA com tomada de ar — na superfície (vela fora
 * d'água) ou com o mastro de snorkel içado e a válvula de cabeça aberta.
 * Submerso com o mastro recolhido, um gerador comandado fica "SEM AR": não
 * queima combustível, logo não há descarga (e não há bolhas).
 *
 * Caminho da descarga (padrão de discrição dos submarinos convencionais): o
 * gás sai na parte de RÉ DA VELA, ABAIXO DA LINHA D'ÁGUA, nos dois bordos ao
 * longo da estrutura — não há fumaça no alto do mastro. O gás sobe em bolhas
 * que ficam para trás com o avanço e chegam à superfície formando um rastro
 * de espuma atrás da vela (é a assinatura visual que os projetos modernos
 * tentam reduzir misturando o gás com água). O mastro de snorkel só ASPIRA ar.
 * A intensidade acompanha a carga dos geradores (Σ P/P_nominal) e a partida.
 */
import type { VesselConfig } from '../config/types';
import type { SimState } from '../core/state';
import type { Vec3 } from '../core/math';

export interface DieselExhaust {
  /** por onde sai a descarga agora: saídas atrás da vela, abaixo d'água (null = nenhum gerador queimando combustível) */
  route: 'dispersores' | null;
  /** carga somada dos geradores em carga (0 … nº de geradores) */
  load: number;
  /** algum gerador em partida (descarga mais densa) */
  starting: boolean;
  /** geradores em carga */
  running: number;
}

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
  return { route: active ? 'dispersores' : null, load, starting, running };
}

/**
 * Aspiração de ar pelo snorkel (0 = nenhuma): mastro içado, válvula de cabeça
 * aberta e diesel queimando — cresce com a carga e é forte na partida.
 */
export function snorkelIntake(v: VesselConfig, s: SimState): number {
  if (s.snorkel.pos < 0.95 || !s.snorkel.headValveOpen) return 0;
  const ex = dieselExhaust(v, s);
  if (!ex.route) return 0;
  return ex.load + (ex.starting ? 0.8 : 0);
}

/**
 * Saídas da descarga (corpo, m): logo atrás da vela, nos dois bordos, na
 * altura do eixo — abaixo da linha d'água também com o submarino na superfície.
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
