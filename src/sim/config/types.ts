/**
 * Tipos de configuração da embarcação fictícia e da simulação.
 * Todos os valores são FICTÍCIOS e de ordem de grandeza pública
 * (não representam nenhum submarino real).
 */
import type { Vec3 } from '../core/math';
import type { EnvironmentConfig } from '../environment/environment';

export interface HullConfig {
  length: number; // m
  diameter: number; // m
  bowLength: number; // m (proa elíptica)
  sternLength: number; // m (popa parabólica)
  tailRadius: number; // m (raio residual no cubo do hélice)
  slices: number; // nº de fatias para hidrostática/strip theory
  /** Compressibilidade do casco resistente (1/Pa): ΔV/V = −c·Δp. */
  compressibility: number;
  /** Ponto de referência da profundidade indicada (quilha a meia-nau), corpo. */
  keelRef: Vec3;
  sail: { xFwd: number; xAft: number; height: number; width: number };
  snorkelMast: { x: number; extension: number; raiseTime: number };
  /** periscópio de ataque (na vela): posição longitudinal, curso de içamento (m) e tempo de içamento (s). Opcional (configurações antigas). */
  periscopeMast?: { x: number; extension: number; raiseTime: number };
}

export interface PointMass {
  id: string;
  name: string;
  mass: number; // kg
  position: Vec3; // corpo (m)
}

export interface MassConfig {
  /** 'auto' = calculada para flutuabilidade neutra na condição de projeto. */
  lightshipMass: number | 'auto';
  lightshipCG: Vec3 | 'auto';
  /** BG de projeto (m) usado quando lightshipCG = 'auto'. */
  designBG: number;
  /** Condição de projeto para o cálculo automático. */
  designCondition: { salinity: number; temperature: number; depth: number };
  gyration: { kxx: number; kyy: number; kzz: number }; // raios de giração do peso leve (m)
  variableLoads: PointMass[];
  /** Ajuste de carga (kg) aplicado sobre a condição de projeto (cenários de carga). */
  loadOffset: number;
  loadOffsetPosition: Vec3;
  /**
   * Peso deslocável de demonstração (carga sobre trilho longitudinal). Na
   * posição neutra faz parte da condição de projeto (trim nulo); deslocá-lo
   * cria um momento de trim que pode ser compensado pelos tanques de trim.
   */
  demoWeight?: DemoWeightConfig;
  /**
   * Cargas a bordo que podem ser deslocadas ao longo do casco (torpedos,
   * tripulantes, mantimentos). Na posição de estiva fazem parte da condição
   * de projeto (o peso leve automático as desconta); deslocá-las não muda a
   * massa total, só cria um momento de trim.
   */
  shiftLoads?: ShiftLoadConfig[];
}

export interface ShiftLoadConfig {
  id: string;
  name: string;
  category: 'pessoas' | 'carga' | 'torpedos' | 'equipamentos';
  quantity: number;
  /** massa unitária (kg) */
  unitMass: number;
  /** posição de estiva (corpo, m): onde a carga fica na condição de projeto */
  home: Vec3;
  /** limites do deslocamento longitudinal (m, corpo) */
  xMin: number;
  xMax: number;
  /** velocidade do deslocamento (m/s) */
  speed: number;
}

export interface DemoWeightConfig {
  /** carga já a bordo (kg), parte da condição de projeto na posição neutra; é o máximo que se pode deslocar */
  mass: number;
  /** parcela deslocada no início (kg); padrão = mass */
  initialMass?: number;
  xNeutral: number; // m (corpo) — posição da condição de projeto
  xMin: number;
  xMax: number;
  y: number;
  z: number;
  speed: number; // m/s do carro no trilho
}

export interface HydroConfig {
  totalResistanceCoeff: number; // C_t (base: área molhada)
  appendageFactor: number; // multiplicador da área molhada
  surfaceResistanceFactor: number; // acréscimo de resistência na superfície (formação de ondas)
  crossflowDrag: number; // C_dc (escoamento cruzado no casco)
  bodyLiftCoeff: number; // C_L do casco (base D²)
  bodyLiftXcp: number; // posição longitudinal do centro de pressão (m)
  munkFactor: number; // fração do momento de Munk ideal efetivamente aplicada
  addedMass: { surge: number; sway: number; heave: number; rollInertia: number; pitchYaw: number };
  linearDamping: { surge: number; sway: number; heave: number; roll: number; pitch: number; yaw: number };
  rollQuadDamping: number;
  /** amortecimento por radiação de ondas na superfície (linear, × fator de proximidade) */
  surfaceDamping: { heave: number; pitch: number; roll: number };
  propTorqueRollFactor: number; // fração do torque do eixo transmitida como momento de banda
}

export type FinKind = 'bowPlanes' | 'sternPlanes' | 'rudder' | 'fixed';

export interface FinConfig {
  id: string;
  name: string;
  kind: FinKind;
  /** 'horizontal': normal ao longo de z do corpo; 'vertical': normal ao longo de y. */
  orientation: 'horizontal' | 'vertical';
  position: Vec3; // centro de pressão (corpo)
  area: number; // m² (soma dos dois lados)
  aspectRatio: number; // alongamento efetivo (incluindo reflexão no casco)
  stallAngle: number; // graus
  maxDeflection: number; // graus (0 para fixos)
  rate: number; // graus/s (velocidade do atuador)
  /**
   * Conversão entre o ângulo de comando do operador e o ângulo geométrico.
   * Lemes horizontais: comando + = "SUBIR"; leme de direção: + = "BORESTE".
   */
  commandSign: number;
}

export interface PropulsionConfig {
  motor: {
    ratedPower: number; // W
    ratedRpm: number;
    maxTorque: number; // N·m
    efficiency: number;
    noLoadLoss: number; // W em rotação nominal
    inertia: number; // kg·m² (rotor+eixo+hélice+água arrastada)
    friction: number; // N·m·s
    speedKp: number;
    speedKi: number;
    rpmRampRate: number; // rpm/s
  };
  propeller: {
    diameter: number;
    blades: number;
    KT0: number;
    J0T: number;
    KQ0: number;
    J0Q: number;
    wakeFraction: number;
    thrustDeduction: number;
    reverseFactor: number; // eficiência relativa em marcha a ré
  };
}

export interface ValveConfig {
  id: string;
  name: string;
  strokeTime: number; // s (curso completo)
  hydraulic: boolean; // depende da planta hidráulica
}

export interface PumpConfig {
  id: string;
  name: string;
  ratedFlow: number; // m³/s (Δp = 0, rotação nominal)
  shutoffPressure: number; // Pa (vazão nula)
  efficiency: number;
  noLoadPower: number; // W
  spinUpTime: number; // s
}

export interface BallastTankConfig {
  id: string;
  name: string;
  volume: number; // m³
  height: number; // m
  center: Vec3; // centroide (corpo)
  ventArea: number; // m² (válvula de suspiro)
  floodArea: number; // m² (embornais de fundo — sempre abertos)
  blowArea: number; // m² (orifício da válvula de sopro)
  ventValve: ValveConfig;
  blowValve: ValveConfig;
  emergencyBlowValve: ValveConfig;
}

export type AirCircuit = 'normal' | 'emergency';

export interface HpAirConfig {
  banks: { id: string; name: string; purpose?: AirCircuit; volume: number; initialPressure: number; maxPressure: number; valve: ValveConfig }[];
  temperature: number; // °C (ar armazenado)
  compressor: { massFlow: number; power: number; maxPressure: number };
}

export interface InternalTankConfig {
  id: string;
  name: string;
  capacity: number; // m³
  height: number; // m
  center: Vec3;
  initialVolume: number; // m³
  /** largura transversal da seção (m); com hullRadius, a seção é este retângulo recortado pelo casco */
  width?: number;
  /**
   * Raio interno do casco resistente (m) na posição do tanque: a seção do
   * tanque segue o casco (fundo/costado abaulados). Ausente = tanque prismático.
   */
  hullRadius?: number;
}

export interface CompensationConfig {
  tanks: InternalTankConfig[];
  transfer?: { pump: PumpConfig; directionValve: ValveConfig; isolationValve: ValveConfig; lineLoss: number };
  tankValves: ValveConfig[]; // uma por tanque (mesma ordem)
  inletValve: ValveConfig;
  dischargeValve: ValveConfig;
  inletArea: number; // m²
  inletRegulatorFlow: number; // m³/s (limitador de vazão)
  seaConnection: Vec3; // posição da tomada de mar (corpo)
  pump: PumpConfig;
  /**
   * Ramais do coletor de compensação para os tanques de banda (TB-BB = 'A',
   * TB-BE = 'B'): os tanques laterais também trocam água com o mar. A água
   * deles continua no estado da banda. Ausente nas configurações antigas.
   */
  heelBranches?: { tank: 'A' | 'B'; valve: ValveConfig }[];
}

export interface TransferSystemConfig {
  id: string;
  name: string;
  tankA: InternalTankConfig; // vante / bombordo
  tankB: InternalTankConfig; // ré / boreste
  valveA: ValveConfig;
  valveB: ValveConfig;
  directionValve: ValveConfig; // seletor 4 vias (A→B / B→A)
  pump: PumpConfig;
  lineLoss: number; // Pa a vazão nominal (perda de carga na linha)
}

export interface ElectricalConfig {
  battery: {
    capacityAh: number;
    vMin: number; // tensão em circuito aberto, SoC = 0
    vMax: number; // tensão em circuito aberto, SoC = 1
    internalResistance: number; // Ω
    maxCurrent: number; // A (descarga)
    maxChargeCurrent: number; // A
    chargeEfficiency: number;
  };
  hotelLoad: number; // W (habitabilidade, ventilação, iluminação)
  navLoad: number; // W (navegação, sensores, controle)
  generators: { id: string; name: string; ratedPower: number; startTime: number; sfc: number }[]; // sfc em kg/J
  fuel: { tankVolume: number; initialFuel: number; density: number; position: Vec3 };
}

export interface HydraulicConfig {
  nominalPressure: number; // Pa
  minPressure: number; // Pa (abaixo: atuadores parados)
  pumpFlowEquivalent: number; // "Pa/s" de recarga do acumulador
  pumpPower: number; // W (em carga)
  idlePower: number; // W
  consumptionPerDegree: number; // Pa por grau de movimento de leme
  consumptionPerStroke: number; // Pa por curso completo de válvula
  leakRate: number; // Pa/s
}

export interface FloodingCompartment {
  id: string;
  name: string;
  xFwd: number;
  xAft: number;
  bilgeZ: number;
}

export interface LimitsConfig {
  operatingDepth: number;
  testDepth: number;
  maxPitch: number;
  maxRoll: number;
  maxVerticalSpeed: number;
  minAltitudeWarn: number;
  minAltitudeCrit: number;
}

export interface SensorNoiseConfig {
  depth: number; // m
  heading: number; // graus
  attitude: number; // graus
  speed: number; // m/s
  altitude: number; // m
  lagDepth: number; // s
  lagSpeed: number;
  lagAltitude: number;
}

export interface VesselConfig {
  name: string;
  hull: HullConfig;
  mass: MassConfig;
  hydro: HydroConfig;
  fins: FinConfig[];
  propulsion: PropulsionConfig;
  ballast: { tanks: BallastTankConfig[] };
  hpAir: HpAirConfig;
  compensation: CompensationConfig;
  trim: TransferSystemConfig;
  heel: TransferSystemConfig;
  electrical: ElectricalConfig;
  hydraulics: HydraulicConfig;
  compartments: FloodingCompartment[];
  limits: LimitsConfig;
  sensors: SensorNoiseConfig;
  contact: { stiffness: number; damping: number; friction: number };
  internalPressure: number; // Pa (atmosfera interna)
  /** tubos lançadores e armas (opcional: configurações antigas não têm) */
  weapons?: WeaponsConfig;
}

/** Um tubo lançador: reto, paralelo ao eixo do casco, com o centro em (y, z) do corpo. */
export interface TorpedoTubeConfig {
  /** número do tubo: ímpares a boreste, pares a bombordo; 1–2 em cima, 5–6 embaixo */
  n: number;
  side: 'BE' | 'BB';
  /** fileira: 0 = de cima, 1 = do meio, 2 = de baixo */
  row: number;
  y: number;
  z: number;
}

/** Arma (torpedo pesado de exercício, valores de ordem de grandeza pública). */
export interface WeaponSpec {
  name: string;
  mass: number; // kg
  length: number; // m
  diameter: number; // m
  /** volume deslocado (m³): a água que entra no tubo no lugar da arma */
  volume: number;
  /** velocidades de corrida (m/s) e alcance em cada uma (m) */
  speeds: { baixa: number; alta: number };
  range: { baixa: number; alta: number };
  /** constante de tempo da partida do motor (s) */
  spinUp: number;
  /** razão de guinada (°/s) e de variação de cota (m/s) */
  turnRate: number;
  depthRate: number;
  /** distância de segurança antes de guinar para o rumo de lançamento (m) */
  safeDistance: number;
  /** alcance de aquisição do autodiretor (m) e meia-abertura do cone (°) */
  acquisitionRange: number;
  seekerHalfAngle: number;
  /** comprimento do fio de guiagem (m) */
  wireLength: number;
  /** distância horizontal ao alvo que conta como acerto no tiro de exercício (m) */
  hitRadius: number;
  /** velocidade de subida ao fim da corrida (arma de exercício flutua para ser recolhida, m/s) */
  floatRate: number;
  /** arma de combate: distância 3D ao alvo que aciona a espoleta de proximidade (m) */
  fuzeRadius?: number;
}

/**
 * Míssil antinavio SM39 (Exocet) na cápsula VSM, lançado pelo tubo de torpedos. Valores de ordem de grandeza
 * pública (MBDA, CSIS, EDR Magazine); a cinemática é simplificada (sem aerodinâmica do míssil).
 */
export interface MissileSpec {
  name: string;
  /** cápsula com o míssil: massa (kg), comprimento (m), diâmetro (m) e volume deslocado (m³) */
  mass: number;
  length: number;
  diameter: number;
  volume: number;
  /** míssil: massa (kg), comprimento (m), ogiva (kg) */
  missileMass: number;
  missileLength: number;
  warhead: number;
  vsm: {
    /** atraso da ignição do motor da cápsula depois de sair do tubo (s), velocidade (m/s) e constante de tempo (s) */
    ignition: number;
    speed: number;
    tau: number;
    /** ângulo de subida (°) oblíquo e quase vertical, razão de arfagem (°/s) e de guinada (°/s), desvio lateral máximo (°) */
    climb: { obliqua: number; vertical: number };
    pitchRate: number;
    turnRate: number;
    maxDogleg: number;
    /** ejeção do nariz depois de romper a superfície (s) e altura de separação do míssil (m) */
    noseDelay: number;
    separationAlt: number;
  };
  /** ignição do acelerador depois da separação (s) e duração da queima (s) */
  boosterDelay: number;
  boosterTime: number;
  /** velocidade de cruzeiro (m/s, Mach ≈ 0,93) */
  cruiseSpeed: number;
  /** altitude (m) depois do acelerador, de cruzeiro (inercial) e terminal mínima (rasante; sobe com o mar) */
  climbAlt: number;
  cruiseAlt: number;
  terminalAlt: number;
  /** autodiretor: ligado a esta distância do ponto de busca (m), alcance de detecção (m), meia-abertura (°) */
  seekerOn: number;
  seekerRange: number;
  seekerHalfAngle: number;
  /** razão de guinada (°/s) e de variação do ângulo de trajetória (°/s) */
  turnRate: number;
  pitchRate: number;
  /** alcance (m de voo depois da separação) */
  range: number;
  /** alvo em terra (navegação por pontos/GPS): começa a subir a esta distância (m), altura de subida (m) e mergulho (m) */
  popUpRange: number;
  popUpAlt: number;
  diveRange: number;
  /** dano por impacto de ogiva (fração; ≥ 1 perde o navio) */
  damage: number;
}

/** Submarino inimigo fictício (alvo): manobra evasiva e afundamento. */
export interface EnemyConfig {
  /** velocidade de fuga (m/s), razão de guinada (°/s), variação de cota (m/s), aceleração (m/s²) */
  evadeSpeed: number;
  turnRate: number;
  depthRate: number;
  accel: number;
  /** velocidade de afundamento depois de atingido (m/s) */
  sinkRate: number;
  /** distância em que percebe o torpedo em ataque e começa a fugir (m) */
  alertRange: number;
}

export interface WeaponsConfig {
  /** face da culatra (x, m), raio do furo e raio externo do tubo (m), folga mínima da parede ao casco externo (m) */
  breechX: number;
  boreRadius: number;
  outerRadius: number;
  muzzleClearance: number;
  tubes: TorpedoTubeConfig[];
  weapon: WeaponSpec;
  /** armas carregadas nos tubos no início (os primeiros n tubos) */
  initialLoaded: number;
  /** carga deslocável (mass.shiftLoads) que guarda as armas de reserva */
  reserveLoad: string;
  /** tanques de compensação das armas (água em volta das armas e compensação automática), bombordo e boreste */
  tca: InternalTankConfig[];
  /** vazões de alagamento e drenagem do tubo (m³/s) e da compensação automática (kg/s) */
  floodRate: number;
  drainRate: number;
  awcRate: number;
  /** constante de tempo da equalização (s), curso da porta externa e da culatra (s) */
  equalizeTau: number;
  doorTime: number;
  breechTime: number;
  /** recarga de um tubo a partir da reserva (s) */
  reloadTime: number;
  /** garrafa de lançamento (ar AP): volume (m³), pressão de carga e mínima para disparar (Pa), vazão de recarga (kg/s) */
  flask: { volume: number; pressure: number; minPressure: number; rechargeFlow: number };
  /** velocidade da arma na boca do tubo (m/s, ejeção por ar comprimido) */
  ejectSpeed: number;
  /** submarinos inimigos fictícios (alvos do tiro de combate) */
  enemy?: EnemyConfig;
  /** míssil antinavio SM39 (cápsula VSM), mísseis de reserva e o tipo inicial de cada tubo (ausente = todos F21) */
  missile?: MissileSpec;
  missileReserve?: number;
  initialKinds?: ('f21' | 'sm39')[];
}

export interface SimSettings {
  dt: number; // passo fixo (s)
  advancedInstrumentation: boolean; // ruído/atraso nos sensores
  seed: number;
}

export interface SimConfig {
  vessel: VesselConfig;
  environment: EnvironmentConfig;
  settings: SimSettings;
}
