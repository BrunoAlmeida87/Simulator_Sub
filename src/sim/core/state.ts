import type { SonarState } from '../../sonar/types';
/**
 * ESTADO FÍSICO CENTRAL da simulação.
 *
 * Todos os módulos leem e escrevem neste único objeto (serializável em JSON),
 * o que garante a interligação entre sistemas e permite salvar/recuperar
 * exatamente a condição da simulação. Nenhum módulo da interface altera este
 * estado diretamente: a interface envia COMANDOS ao motor.
 */
import type { Quat, Vec3 } from './math';

export interface CargoLoad {
  id: string;
  name: string;
  category: 'pessoas' | 'carga' | 'torpedos' | 'equipamentos';
  quantity: number;
  unitMass: number; // kg
  position: Vec3;
}

export interface ValveState {
  cmd: number; // posição comandada (0 = fechada, 1 = aberta)
  pos: number; // posição real
  stuck: boolean; // falha: travada na posição atual
}

export interface PumpState {
  cmd: boolean;
  speed: number; // 0..1 (fração da rotação nominal)
  failed: boolean;
  // diagnósticos do último passo
  flow: number; // m³/s
  dp: number; // Pa
  power: number; // W elétrico
  noSuction: boolean;
  deadhead: boolean;
}

export interface BallastTankState {
  water: number; // m³ de água no tanque
  air: number; // kg de ar no tanque
  vent: ValveState;
  blow: ValveState;
  emergencyBlow: ValveState;
  ventLeak: number; // m² — área de vazamento por falha de vedação do suspiro
  // diagnósticos
  qWater: number; // m³/s (+ entrando)
  mdotVent: number; // kg/s
  mdotBlow: number; // kg/s
  mdotEmergencyBlow: number; // kg/s — circuito dedicado de emergência
  mdotSpill: number; // kg/s (ar escapando pelos embornais)
  pAir: number; // Pa absolutos
  pExtPort: number; // Pa no embornal
}

export interface HpBankState {
  mass: number; // kg de ar
  valve: ValveState;
}

export interface InternalTankState {
  mass: number; // kg de água
  /** diagnóstico: vazão no último passo (m³/s, + entrando no tanque) */
  flow?: number;
  /** Parte da vazão devida à BTC, separada da troca com o mar. */
  transferFlow?: number;
}

export interface DosingState {
  active: boolean;
  mode: 'admitir' | 'esgotar' | 'transferir';
  target: number; // kg a movimentar
  moved: number; // kg já movimentados
  phase: 'alinhando' | 'escoando' | 'finalizando' | 'concluido' | 'abortado';
  dir?: 'AtoB' | 'BtoA';
  timer: number;
  message: string;
  /** s seguidos sem vazão na fase de escoamento (compensação) */
  stall?: number;
  /** quantidade pedida, quando o alvo foi reduzido à capacidade disponível */
  requested?: number;
}

/** VDC da compensação: VDC 4/2: posição 0 = direta, 1 = inversa; valores intermediários são trânsito. */
export type CompensationTransferState = Omit<TransferState, 'tankA' | 'tankB'> & { source: string; destination: string };

export interface CompensationState {
  transfer?: CompensationTransferState;
  tanks: Record<string, InternalTankState>;
  tankValves: Record<string, ValveState>;
  inlet: ValveState;
  discharge: ValveState;
  pump: PumpState;
  qIn: number; // m³/s admitidos do mar
  qOut: number; // m³/s descarregados ao mar
  dosing: DosingState | null;
}

export interface TransferState {
  tankA: InternalTankState;
  tankB: InternalTankState;
  valveA: ValveState;
  valveB: ValveState;
  direction: ValveState; // 0 = A→B, 1 = B→A
  pump: PumpState;
  flow: number; // m³/s (+ A→B)
  dosing: DosingState | null;
}

export interface GeneratorState {
  cmd: boolean;
  status: 'PARADO' | 'PARTINDO' | 'EM CARGA' | 'PARANDO' | 'FALHA' | 'SEM AR';
  timer: number;
  power: number; // W entregues ao barramento
  failed: boolean;
}

export interface ElectricalState {
  soc: number; // 0..1
  breakerClosed: boolean;
  batteryFailed: boolean;
  energized: boolean; // barramento principal energizado
  voltage: number;
  current: number; // A (+ descarga)
  ocv: number;
  generators: Record<string, GeneratorState>;
  fuel: number; // m³ de combustível
  loads: Record<string, number>; // W por consumidor (último passo)
  totalLoad: number;
  generation: number;
  batteryPower: number; // W (+ descarga)
  propulsionLimit: number; // W disponíveis para a propulsão no próximo passo
  chargeLimited: boolean;
  /** demanda não atendida no último passo (W): sobrecarga da bateria ou barramento desenergizado */
  unservedPower?: number;
}

export interface PropulsionState {
  rpmCmd: number; // ordem do telégrafo (rpm, + avante)
  rpmRef: number; // referência após rampa
  omega: number; // rad/s do eixo
  integ: number;
  thrust: number; // N (efetivo, após dedução)
  propTorque: number; // N·m
  motorTorque: number; // N·m
  shaftPower: number; // W mecânicos
  elecPower: number; // W elétricos
  advance: number; // coeficiente de avanço J
  failed: boolean;
  powerLimited: boolean;
  shaftAngle: number; // rad (para animação do hélice)
}

export interface SurfaceState {
  cmd: number; // graus (convenção do operador)
  actual: number; // graus (convenção do operador)
  jammed: boolean;
}

export interface PidTelemetry {
  setpoint: number;
  measured: number;
  error: number;
  p: number;
  i: number;
  d: number;
  output: number;
  saturated: boolean;
  lowEffectiveness: boolean;
}

export interface AutopilotState {
  headingMode: 'MANUAL' | 'AUTO';
  headingSet: number; // graus
  depthMode: 'MANUAL' | 'AUTO';
  depthSet: number; // m
  pitchMode: 'MANUAL' | 'AUTO';
  pitchSet: number; // graus
  /**
   * Ordem enviada com o canal em MANUAL (pré-seleção): ao passar para AUTO,
   * o piloto vai para ela em vez de assumir a condição atual. Opcional para
   * sessões salvas antes da pré-seleção.
   */
  preset?: { heading?: boolean; depth?: boolean; pitch?: boolean };
  iHeading: number;
  iDepth: number;
  iPitch: number;
  tHeading: PidTelemetry;
  tDepth: PidTelemetry;
  tPitch: PidTelemetry;
  tBow: PidTelemetry;
}

export type SensorFailMode = 'normal' | 'congelado' | 'deriva' | 'zero' | 'ruido';

export interface SensorState {
  value: number;
  filtered: number;
  failMode: SensorFailMode;
  drift: number;
  valid: boolean;
}

export interface AlarmRuntime {
  active: boolean;
  acked: boolean;
  since: number;
  pending: number; // tempo acumulado com condição verdadeira (retardo)
}

export interface AlarmEvent {
  t: number;
  id: string;
  priority: number;
  text: string;
  event: 'ATIVADO' | 'NORMALIZADO' | 'RECONHECIDO';
}

export interface CommandRecord {
  t: number;
  text: string;
  group: string;
}

export interface Ledger {
  // massa (kg) que cruza a fronteira do "navio" (excluindo água livre dos TLP)
  seaIn: number;
  seaOut: number;
  airVented: number;
  airSpilled: number;
  airCompressed: number;
  fuelBurned: number;
  fuelSeawaterIn: number;
  floodIn: number;
  // energia (J)
  batteryOut: number; // energia retirada dos terminais
  batteryChemical: number; // V_oc·I integrada
  batteryLoss: number; // I²R
  loadEnergy: number;
  generatorEnergy: number;
  propellerWork: number; // energia mecânica entregue ao hélice
  mass0: number; // massa interna inicial (referência)
  /** massa de carga embarcada (+) ou desembarcada (−) pelo operador (cargas e peso deslocável) */
  cargoIn?: number;
  /** massa das armas lançadas (kg) */
  weaponsOut?: number;
  /** energia pedida pelas cargas e a parte não atendida pelo barramento (J); ausentes em salvamentos antigos */
  loadRequested?: number;
  loadUnserved?: number;
}

export interface SimState {
  /** Acoustic acquisition, measurements and bounded histories (old saves migrate lazily). */
  sonar?: SonarState;
  version: number;
  scenarioId: string;
  t: number;
  step: number;
  rng: { seed: number };
  body: {
    pos: Vec3; // NED (m)
    quat: Quat; // corpo → NED
    vel: Vec3; // u, v, w (m/s, corpo)
    omega: Vec3; // p, q, r (rad/s, corpo)
  };
  ballast: Record<string, BallastTankState>;
  hpAir: {
    banks: Record<string, HpBankState>;
    compressorCmd: boolean;
    compressorRunning: boolean;
    manifoldPressure: number;
    emergencyManifoldPressure: number;
  };
  compensation: CompensationState;
  trim: TransferState;
  heel: TransferState;
  propulsion: PropulsionState;
  electrical: ElectricalState;
  hydraulics: { pressure: number; failed: boolean; pumpOn: boolean; power: number };
  surfaces: Record<string, SurfaceState>;
  snorkel: { cmd: boolean; pos: number; headValveOpen: boolean };
  /** periscópio de ataque: ordem (içar/arriar) e posição (0 = arriado, 1 = içado). Opcional em estados antigos. */
  periscope?: { cmd: boolean; pos: number };
  flooding: Record<string, { water: number; breachArea: number; rate: number }>;
  autopilot: AutopilotState;
  sensors: Record<string, SensorState>;
  nav: {
    drNorth: number;
    drEast: number;
    distance: number;
    trail: { n: number; e: number; z: number }[];
    depthRate: number; // taxa de profundidade calculada (filtrada)
    prevDepth: number; // profundidade indicada no passo anterior
    trailTimer: number;
  };
  alarms: { runtime: Record<string, AlarmRuntime>; log: AlarmEvent[] };
  commands: CommandRecord[];
  ledger: Ledger;
  contact: boolean;
  /** peso deslocável de demonstração: posição (m, corpo), posição ordenada e massa (kg) */
  cargoLoads?: CargoLoad[]; // cargas adicionais; ausente em salvamentos antigos
  demoWeight?: { x: number; xCmd: number; mass: number };
  /** cargas deslocáveis a bordo: posição longitudinal atual e ordenada (m, corpo) por id */
  shiftLoads?: Record<string, { x: number; xCmd: number }>;
  /** massas de referência dos tanques de trim (condição inicial do cenário) para os vetores de trim */
  trimRef?: { a: number; b: number };
  /** tubos lançadores, compensação das armas e torpedos lançados (ausente em salvamentos antigos) */
  weapons?: WeaponsState;
}

/** Sequência automática em curso num tubo. */
export type TubeAuto = 'preparar' | 'disparar' | 'recarregar' | 'fechar' | null;

/** Dados de tiro (ajustados antes do disparo; o alvo e o rumo podem mudar pelo fio). */
export interface TubePresets {
  /** id do contato escolhido como alvo (null = corrida no rumo ajustado) */
  target: string | null;
  speed: 'baixa' | 'alta';
  /** cota de corrida (m) */
  depth: number;
  /** rumo inicial (°; null = o rumo do submarino) — com alvo, a guiagem pelo fio corrige */
  course: number | null;
  /** cabeça da arma: exercício (passa sob o alvo e flutua) ou combate (explode no alvo). Ausente = exercício */
  warhead?: Warhead;
}

export type Warhead = 'exercicio' | 'combate';

export interface TubeState {
  n: number;
  /** arma no tubo */
  weapon: boolean;
  /** arma alimentada e com os dados de tiro */
  energized: boolean;
  /** água no tubo (kg) */
  water: number;
  /** pressão dentro do tubo (Pa, absoluta) */
  pressure: number;
  /** válvulas: alagamento (do TCA), suspiro (para dentro do casco), equalização (com o mar), drenagem (para o TCA) */
  flood: ValveState;
  vent: ValveState;
  equalize: ValveState;
  drain: ValveState;
  /** porta da boca (casco externo) e culatra (porta interna): 0 fechada … 1 aberta */
  door: ValveState;
  breech: ValveState;
  /** ar na garrafa de lançamento (kg) */
  flask: number;
  presets: TubePresets;
  auto: TubeAuto;
  /** percurso da arma no tubo durante a ejeção (m) e a sua velocidade (m/s); null fora do disparo */
  eject: number | null;
  ejectV: number;
  /** tempo decorrido da recarga (s); null sem recarga */
  reload: number | null;
  /** origem geográfica e tráfego adicional vistos pelo operador ao passar os dados (para achar o alvo) */
  origin?: { lat: number; lon: number };
  traffic?: number;
}

export type TorpedoPhase = 'afastamento' | 'guiado' | 'busca' | 'ataque' | 'flutuando' | 'recolher' | 'explodiu' | 'perdido';

export interface TorpedoRun {
  id: string;
  tube: number;
  tFire: number;
  /** posição NED (m) e cota (m, + para baixo), rumo (°), velocidade (m/s) */
  n: number;
  e: number;
  d: number;
  heading: number;
  speed: number;
  phase: TorpedoPhase;
  /** fio de guiagem ligado ao submarino */
  wire: boolean;
  target: string | null;
  /** quantidade de navios do tráfego adicional no disparo (para achar o alvo) */
  traffic: number;
  presets: TubePresets;
  /** distância percorrida (m), ponto de lançamento */
  run: number;
  launch: { n: number; e: number };
  /** rumo ordenado (°) */
  cmdHeading: number;
  /** último dado do alvo (pelo fio ou pelo autodiretor) */
  tgt: { n: number; e: number; course: number; speed: number; name: string; range: number; bearing: number; d?: number } | null;
  /** menor distância horizontal ao alvo (m) */
  closest: number;
  hit: { t: number; dist: number; depth: number; target: string; name: string } | null;
  endReason: string | null;
  track: { n: number; e: number; d: number }[];
  trackTimer: number;
  guideTimer: number;
  origin?: { lat: number; lon: number };
}

export interface WeaponsState {
  tubes: TubeState[];
  runs: TorpedoRun[];
  /** água nos tanques de compensação das armas (kg), mesma ordem de cfg.weapons.tca */
  tca: { mass: number; flow: number }[];
  /** peso de referência das armas + água dos tubos + TCA + reserva (kg): a compensação automática o mantém */
  awcRef: number;
  /** vazão da compensação automática (kg/s, + admitindo do mar) */
  awcFlow: number;
  /** momento longitudinal de referência das armas (kg·m) e o já corrigido por transferências de trim (kg·m) */
  awcMomentRef?: number;
  awcTrim?: number;
  /** armas de reserva a bordo */
  reserve: number;
  fired: number;
  /** submarinos inimigos (alvos fictícios acrescentados pelo operador) */
  enemies?: EnemySub[];
  /** explosões de torpedos de combate (as mais recentes) */
  explosions?: Explosion[];
  /** contador para os nomes dos inimigos */
  enemyCount?: number;
}

/** Submarino inimigo fictício (cinemática simples): rumo e velocidade constantes, foge quando atacado, afunda quando atingido. */
export interface EnemySub {
  id: string;
  name: string;
  /** posição NED (m), cota (m, + para baixo), rumo (°), velocidade (m/s) */
  n: number;
  e: number;
  d: number;
  course: number;
  speed: number;
  /** rumo, velocidade e cota ordenados */
  cmdCourse: number;
  cmdSpeed: number;
  cmdDepth: number;
  /** manobra evasiva em curso (torpedo em ataque contra ele) */
  evading: boolean;
  /** destruído: instante (s), afundando até o fundo */
  sunk: number | null;
  /** inclinação de proa ao afundar (°, + proa para baixo) */
  pitch: number;
  /** torpedo de exercício que passou sob ele */
  hits: number;
}

export interface Explosion {
  id: string;
  /** instante (s de simulação) e ponto NED (m) */
  t: number;
  n: number;
  e: number;
  d: number;
  /** alvo atingido (id) ou null (fim de corrida) */
  target: string | null;
}

export const newValve = (open = false): ValveState => ({ cmd: open ? 1 : 0, pos: open ? 1 : 0, stuck: false });

export const newPump = (): PumpState => ({
  cmd: false,
  speed: 0,
  failed: false,
  flow: 0,
  dp: 0,
  power: 0,
  noSuction: false,
  deadhead: false,
});

export const newPid = (): PidTelemetry => ({
  setpoint: 0,
  measured: 0,
  error: 0,
  p: 0,
  i: 0,
  d: 0,
  output: 0,
  saturated: false,
  lowEffectiveness: false,
});
