/**
 * PASSADIÇO (alto da vela): posição do olho do observador, altura acima
 * d'água, vela alagada ou não, binóculo 7×50 e contatos à vista. Só lê o
 * estado: nada aqui altera a simulação. Sem Three.js (usado pela interface).
 */
import type { SimulationEngine } from '../sim/core/engine';
import { qToMat3 } from '../sim/core/math';
import { roomContacts, type RoomContact } from './controlRoom/panelsCombat';
import type { RoomActions } from './controlRoom/actions';
import { TARGET_HEIGHT, horizonRange } from './controlRoom/periscope';

/** altura do olho acima do topo da vela (m) e recuo em relação à borda de ataque da vela (m) */
export const BRIDGE_EYE = { above: 1.6, aft: 1.3 };

/** fração do caturro/balanço que o observador no passadiço sente na linha de visada (o resto ele compensa com o corpo) */
export const BRIDGE_FOLLOW = 0.35;

/**
 * Elevação (°) e inclinação do horizonte (°, + = lado direito da vista desce)
 * sentidas pelo observador olhando na marcação relativa b (°), com caturro
 * (pitch, + proa para cima) e balanço (roll, + boreste para baixo) do casco.
 */
export function bridgeFelt(b: number, pitch: number, roll: number): { pitch: number; roll: number } {
  const r = (b * Math.PI) / 180;
  return { pitch: BRIDGE_FOLLOW * (pitch * Math.cos(r) - roll * Math.sin(r)), roll: BRIDGE_FOLLOW * (roll * Math.cos(r) + pitch * Math.sin(r)) };
}

/** campo de visão vertical a olho nu (°) */
export const NAKED_FOV = 60;
/** elevação padrão a olho nu (°): um pouco abaixo do horizonte, para ver a proa e o convés */
export const BRIDGE_ELEV0 = -10;
/** binóculo marinho 7×50: aumento e campo de visão vertical resultante (°) */
export const BINO_MAG = 7;
export const BINO_FOV = (2 * Math.atan(Math.tan((NAKED_FOV * Math.PI) / 360) / BINO_MAG) * 180) / Math.PI;

/** a vela precisa ficar pelo menos isto acima da água (m) para o passadiço poder ser guarnecido */
export const BRIDGE_MIN_FREEBOARD = 0.5;

export interface BridgeState {
  /** altura do olho acima do nível médio do mar (m) */
  eye: number;
  /** altura do topo da vela acima da superfície local, com a onda (m; negativa = submersa) */
  sailTop: number;
  /** vela submersa ou alagada pelas ondas: o passadiço não pode ser guarnecido */
  flooded: boolean;
  /** alcance do horizonte visto do olho (m) */
  horizon: number;
}

/** ponto do corpo (x avante, y boreste, z para baixo) em coordenadas NED do mundo */
function bodyToWorld(e: SimulationEngine, x: number, y: number, z: number): { n: number; e: number; d: number } {
  const s = e.state;
  const R = qToMat3(s.body.quat);
  return {
    n: s.body.pos.x + R[0] * x + R[1] * y + R[2] * z,
    e: s.body.pos.y + R[3] * x + R[4] * y + R[5] * z,
    d: s.body.pos.z + R[6] * x + R[7] * y + R[8] * z,
  };
}

/** estado do passadiço: altura do olho, borda livre da vela (com as ondas) e horizonte */
export function bridgeState(e: SimulationEngine): BridgeState {
  const v = e.vessel;
  const sv = v.hull.sail;
  const top = -(v.hull.diameter / 2 + sv.height);
  const x = sv.xFwd - BRIDGE_EYE.aft;
  const eyeW = bodyToWorld(e, x, 0, top - BRIDGE_EYE.above);
  const topW = bodyToWorld(e, x, 0, top);
  const wave = e.env.waves.elevation(topW.n, topW.e, e.state.t);
  const sailTop = -topW.d - wave;
  const eye = -eyeW.d;
  return { eye, sailTop, flooded: sailTop < BRIDGE_MIN_FREEBOARD, horizon: horizonRange(Math.max(0.05, eye), 0) };
}

export interface BridgeContact extends RoomContact {
  /** marcação relativa à linha de visada (°, + = à direita) */
  off: number;
}

const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/** contatos à vista do passadiço (dentro do horizonte entre o olho e o mastro do alvo), com a marcação relativa à linha de visada */
export function bridgeVisible(e: SimulationEngine, act: Pick<RoomActions, 'geoOrigin' | 'traffic'>, sightRel: number): BridgeContact[] {
  const b = bridgeState(e);
  if (b.flooded) return [];
  const los = e.outputs.euler.heading + sightRel;
  return roomContacts(e, act)
    .filter((c) => c.rng < horizonRange(b.eye, TARGET_HEIGHT[c.kind]))
    .map((c) => ({ ...c, off: wrap180(c.brg - los) }));
}
