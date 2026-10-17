/**
 * INSTRUMENTAÇÃO SIMULADA.
 *
 * Cada sensor lê a grandeza VERDADEIRA do estado físico e aplica (apenas no
 * modo avançado) atraso de 1ª ordem, ruído gaussiano determinístico e falhas
 * injetadas. Classificação apresentada na interface:
 *   MED  = medição simulada de sensor
 *   CALC = valor calculado a partir de medições
 *   CMD  = comando/ordem do operador ou do controle automático
 *
 * Profundímetros medem PRESSÃO no ponto de referência da quilha e convertem
 * com densidade de calibração fixa (ρ_cal = 1025 kg/m³):
 *   z_ind = (p − p_atm) / (ρ_cal·g)
 * — a diferença para a profundidade geométrica real evidencia a conversão.
 */
import type { VesselConfig } from '../config/types';
import type { SensorState, SimState } from '../core/state';
import { rngNormal, wrap360, RAD, qFromEuler, qToMat3, mulMat3Vec, type Vec3 } from '../core/math';

export const RHO_CAL = 1025;

export interface SensorDef {
  id: string;
  name: string;
  unit: string;
  quantity: string;
  kind: 'MED' | 'CALC';
  angular?: boolean;
  group: string;
  description: string;
}

export const SENSOR_DEFS: SensorDef[] = [
  { id: 'PRF1', name: 'Profundímetro 1', unit: 'm', quantity: 'Profundidade (quilha)', kind: 'MED', group: 'Profundidade', description: 'Transdutor de pressão; converte p em profundidade com ρ_cal = 1025 kg/m³.' },
  { id: 'PRF2', name: 'Profundímetro 2', unit: 'm', quantity: 'Profundidade (quilha)', kind: 'MED', group: 'Profundidade', description: 'Profundímetro redundante (canal independente).' },
  { id: 'PEXT', name: 'Pressão externa', unit: 'bar', quantity: 'Pressão absoluta do mar', kind: 'MED', group: 'Profundidade', description: 'Pressão absoluta na tomada da quilha.' },
  { id: 'GIRO', name: 'Girobússola', unit: '°', quantity: 'Rumo verdadeiro', kind: 'MED', angular: true, group: 'Rumo', description: 'Rumo verdadeiro (referência ao Norte geográfico).' },
  { id: 'AGM', name: 'Agulha magnética', unit: '°', quantity: 'Rumo magnético', kind: 'MED', angular: true, group: 'Rumo', description: 'Rumo magnético = verdadeiro − declinação magnética local.' },
  { id: 'INSP', name: 'Sensor inercial — pitch', unit: '°', quantity: 'Pitch', kind: 'MED', group: 'Atitude', description: 'Ângulo de caturro (+ proa para cima).' },
  { id: 'INSR', name: 'Sensor inercial — roll', unit: '°', quantity: 'Banda', kind: 'MED', group: 'Atitude', description: 'Ângulo de banda (+ adernado para boreste).' },
  { id: 'INSQ', name: 'Sensor inercial — taxa de pitch', unit: '°/s', quantity: 'q', kind: 'MED', group: 'Atitude', description: 'Velocidade angular de caturro.' },
  { id: 'INSW', name: 'Sensor inercial — taxa de guinada', unit: '°/s', quantity: 'r', kind: 'MED', group: 'Atitude', description: 'Velocidade angular de guinada.' },
  { id: 'DVLU', name: 'Odômetro Doppler — longitudinal', unit: 'm/s', quantity: 'Velocidade longitudinal', kind: 'MED', group: 'Velocidade', description: 'Velocidade em relação ao fundo/água (sem correntes: iguais).' },
  { id: 'DVLV', name: 'Odômetro Doppler — transversal', unit: 'm/s', quantity: 'Velocidade transversal', kind: 'MED', group: 'Velocidade', description: 'Abatimento lateral.' },
  { id: 'ECO', name: 'Ecobatímetro', unit: 'm', quantity: 'Altitude sobre o fundo', kind: 'MED', group: 'Fundo', description: 'Distância vertical quilha–fundo (alcance 800 m).' },
];

export const sensorDef = (id: string) => SENSOR_DEFS.find((d) => d.id === id)!;

export interface TrueValues {
  depthKeel: number; // m geométricos
  pressureKeel: number; // Pa
  heading: number; // graus
  pitch: number;
  roll: number;
  q: number; // graus/s
  r: number;
  u: number;
  v: number;
  altitude: number; // m
  gravity: number;
  atm: number;
  declination: number;
}

function trueFor(id: string, t: TrueValues): number {
  switch (id) {
    case 'PRF1':
    case 'PRF2':
      return (t.pressureKeel - t.atm) / (RHO_CAL * t.gravity);
    case 'PEXT':
      return t.pressureKeel / 1e5;
    case 'GIRO':
      return wrap360(t.heading);
    case 'AGM':
      return wrap360(t.heading - t.declination);
    case 'INSP':
      return t.pitch;
    case 'INSR':
      return t.roll;
    case 'INSQ':
      return t.q;
    case 'INSW':
      return t.r;
    case 'DVLU':
      return t.u;
    case 'DVLV':
      return t.v;
    case 'ECO':
      return t.altitude;
  }
  return 0;
}

function noiseFor(id: string, cfg: VesselConfig): { sigma: number; tau: number } {
  const n = cfg.sensors;
  if (id === 'PRF1' || id === 'PRF2') return { sigma: n.depth, tau: n.lagDepth };
  if (id === 'PEXT') return { sigma: n.depth * 0.1, tau: n.lagDepth };
  if (id === 'GIRO' || id === 'AGM') return { sigma: n.heading, tau: 0.3 };
  if (id === 'INSP' || id === 'INSR') return { sigma: n.attitude, tau: 0.1 };
  if (id === 'INSQ' || id === 'INSW') return { sigma: n.attitude * 0.2, tau: 0.1 };
  if (id === 'DVLU' || id === 'DVLV') return { sigma: n.speed, tau: n.lagSpeed };
  return { sigma: n.altitude, tau: n.lagAltitude };
}

export function updateSensors(cfg: VesselConfig, s: SimState, tv: TrueValues, dt: number, advanced: boolean): void {
  for (const d of SENSOR_DEFS) {
    const st: SensorState = s.sensors[d.id];
    const x = trueFor(d.id, tv);
    const valid = d.id === 'ECO' ? tv.altitude < 800 : true;
    st.valid = valid;
    if (!advanced) {
      st.filtered = x;
    } else {
      const { tau } = noiseFor(d.id, cfg);
      const a = Math.min(1, dt / Math.max(dt, tau));
      if (d.angular) {
        let diff = ((x - st.filtered + 540) % 360) - 180;
        st.filtered = wrap360(st.filtered + a * diff);
      } else st.filtered += a * (x - st.filtered);
    }
    let val = st.filtered;
    if (advanced) {
      const { sigma } = noiseFor(d.id, cfg);
      val += sigma * rngNormal(s.rng);
    }
    switch (st.failMode) {
      case 'congelado':
        val = st.value;
        break;
      case 'deriva':
        st.drift += (d.angular ? 0.05 : d.id.startsWith('PRF') ? 0.03 : 0.01) * dt;
        val += st.drift;
        break;
      case 'zero':
        val = 0;
        break;
      case 'ruido': {
        const { sigma } = noiseFor(d.id, cfg);
        val += 25 * Math.max(sigma, 0.01) * rngNormal(s.rng);
        break;
      }
    }
    if (d.angular) val = wrap360(val);
    st.value = val;
  }
}

export interface NavReadings {
  depth: number; // média dos profundímetros válidos
  depthRate: number;
}

/** Atualiza navegação estimada (DR) e taxa de profundidade calculada. */
export function updateNavigation(s: SimState, dt: number, trueVelNED: Vec3, prevDepth: number): number {
  // navegação estimada: velocidade do Doppler (3 feixes; o vertical não é exibido)
  // projetada no plano horizontal com a atitude medida (girobússola + inercial)
  const R = qToMat3(qFromEuler(s.sensors.INSR.value / RAD, s.sensors.INSP.value / RAD, s.sensors.GIRO.value / RAD));
  const vb = { x: s.sensors.DVLU.value, y: s.sensors.DVLV.value, z: s.body.vel.z };
  const vn = mulMat3Vec(R, vb);
  s.nav.drNorth += vn.x * dt;
  s.nav.drEast += vn.y * dt;
  s.nav.distance += Math.sqrt(trueVelNED.x * trueVelNED.x + trueVelNED.y * trueVelNED.y) * dt;
  const depth = 0.5 * (s.sensors.PRF1.value + s.sensors.PRF2.value);
  return (depth - prevDepth) / dt;
}
