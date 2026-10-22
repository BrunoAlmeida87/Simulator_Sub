/**
 * CÂMERA DRONE: voo livre pelo cenário (mar, submarino, orla, cidade), fixo
 * no mundo — não acompanha o submarino. A pose fica em coordenadas do mundo
 * (Norte/Leste e altura acima do nível do mar) e a cena a converte a cada
 * quadro para a origem flutuante (posição do submarino). A velocidade cresce
 * com a altura: rente à água anda devagar; a 1 km de altura cruza
 * quilômetros em segundos. Só visual: nada aqui altera a simulação.
 */

/** pose do drone: N/E (m), altura acima do nível do mar (m), rumo da visada (°, verdadeiro) e inclinação (°, + para cima) */
export interface DronePose {
  n: number;
  e: number;
  up: number;
  yaw: number;
  pitch: number;
}

/** comandos: avante (+1 / −1), lateral (+1 = direita), vertical (+1 = sobe), rápido (×4) e multiplicador da roda */
export interface DroneInput {
  f: number;
  s: number;
  u: number;
  fast: boolean;
  speedMul: number;
}

export const DRONE_MAX_UP = 3000;
/** folga mínima sobre o terreno ou o fundo (m) */
export const DRONE_CLEAR = 1.5;

export const droneIdle = (): DroneInput => ({ f: 0, s: 0, u: 0, fast: false, speedMul: 1 });

/** posição inicial: acima e atrás do submarino, olhando para ele */
export function droneStart(pn: number, pe: number, pd: number, headingDeg: number): DronePose {
  const psi = (headingDeg * Math.PI) / 180;
  const back = 90;
  const up = 45;
  return { n: pn - Math.cos(psi) * back, e: pe - Math.sin(psi) * back, up, yaw: headingDeg, pitch: (-Math.atan2(up + Math.max(0, pd), back) * 180) / Math.PI };
}

/** folga (m) até a superfície mais próxima: acima d'água, a altura sobre a terra ou o mar; debaixo d'água, a menor entre superfície e fundo */
export function droneClearance(up: number, ground: number): number {
  return up >= 0 ? up - Math.max(0, ground) : Math.min(-up, up - ground);
}

/** velocidade (m/s): proporcional à folga, ×4 com "rápido", vezes o multiplicador da roda */
export function droneSpeed(clear: number, fast: boolean, mul: number): number {
  return Math.min(5000, Math.max(4, 0.6 * Math.abs(clear)) * (fast ? 4 : 1) * mul);
}

/**
 * Um passo de voo (dt em segundos de relógio — o drone voa com a simulação
 * pausada). ground(n, e) = altura do terreno/fundo em relação ao nível do mar
 * (+ em terra, − no mar). Retorna a velocidade usada (m/s).
 */
export function droneStep(p: DronePose, inp: DroneInput, dt: number, ground: (n: number, e: number) => number): number {
  const g0 = ground(p.n, p.e);
  const v = droneSpeed(droneClearance(p.up, g0), inp.fast, inp.speedMul);
  const yaw = (p.yaw * Math.PI) / 180;
  let f = inp.f;
  let s = inp.s;
  const m = Math.hypot(f, s);
  if (m > 1) {
    f /= m;
    s /= m;
  }
  p.n += (Math.cos(yaw) * f - Math.sin(yaw) * s) * v * dt;
  p.e += (Math.sin(yaw) * f + Math.cos(yaw) * s) * v * dt;
  p.up += inp.u * v * 0.8 * dt;
  p.up = Math.min(DRONE_MAX_UP, Math.max(ground(p.n, p.e) + DRONE_CLEAR, p.up));
  p.pitch = Math.max(-89, Math.min(89, p.pitch));
  p.yaw = ((p.yaw % 360) + 360) % 360;
  return v;
}
