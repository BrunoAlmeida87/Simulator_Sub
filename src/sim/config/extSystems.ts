/**
 * PARÂMETROS DOS SISTEMAS ACRESCENTADOS NA FASE 3 (valores FICTÍCIOS de simulação, ordem de grandeza
 * plausível; nenhum dado de navio real). Cada bloco é opcional na configuração: salvamentos antigos
 * recebem os padrões destas funções. Ver docs/PARAMETROS.md.
 *
 *  - atmosphere: atmosfera interna (O₂, CO₂, H₂, CO), tripulação, absorvedores, O₂ de reserva, ventilação
 *  - damage: controle de avarias — bombas de esgoto, portas estanques, incêndio
 *  - distribution: disjuntores por carga, rejeição automática por prioridade, temperatura da bateria
 *  - stealth: aeronave de patrulha (radar), sonar passivo do oponente (contra-detecção), exposição
 *  - threat: torpedo de exercício contra o SX-1 e despistadores acústicos
 *  - tugs: rebocadores (força no casco, manobra de porto)
 */

export interface AtmosphereConfig {
  /** volume de ar livre no casco resistente (m³) */
  freeVolume: number;
  /** temperatura do ar interno (°C) para a conversão massa ↔ fração */
  temperature: number;
  /** tripulantes a bordo (somam-se às cargas da categoria "pessoas") */
  crew: number;
  /** consumo de O₂ e produção de CO₂ por pessoa (kg/s) */
  o2Use: number;
  co2Make: number;
  /** absorvedores de CO₂: remoção = taxa × fração de CO₂ (kg/s por unidade de fração) */
  scrubberRate: number;
  /** O₂ de reserva (kg) e vazão ao liberar (kg/s) */
  o2Stock: number;
  o2Rate: number;
  /** recarga da bateria acima de gassingSoc libera H₂: kg por A·h × fração de gaseificação */
  h2PerAh: number;
  gassingSoc: number;
  /** queimadores (recombinadores) de H₂: remoção = taxa × fração de H₂ (kg/s) */
  recombinerRate: number;
  /** renovações de ar por hora com a válvula de cabeça do snorkel aberta: ventilador e cada diesel em carga */
  ventAch: number;
  dieselAch: number;
}

export interface BilgePumpConfig {
  id: string;
  name: string;
  /** compartimento que a bomba esgota */
  compartment: string;
  /** vazão nominal contra o casco sem diferença de pressão (m³/s) */
  ratedFlow: number;
  /** diferença de pressão (mar − interior) em que a vazão zera (Pa) */
  shutoff: number;
  /** potência elétrica nominal (W) */
  power: number;
}

export interface WatertightDoorConfig {
  id: string;
  name: string;
  /** compartimentos ligados (vante, ré) */
  a: string;
  b: string;
  /** posição longitudinal da antepara (m, corpo) */
  x: number;
}

export interface DamageConfig {
  bilgePumps: BilgePumpConfig[];
  doors: WatertightDoorConfig[];
  /** água passa pela porta aberta acima deste enchimento (fração da massa máxima do compartimento) */
  doorSill: number;
  /** vazão pela porta aberta por unidade de diferença de enchimento (kg/s) */
  doorFlow: number;
  /** incêndio: crescimento (1/s), detecção (intensidade e retardo), combate (1/s), consumo/produção por intensidade 1 (kg/s) */
  fire: { growth: number; detectAt: number; detectDelay: number; fight: number; o2Use: number; co2Make: number; coMake: number; agent: number; agentUse: number };
}

/** cargas com disjuntor (as mesmas chaves das demandas do balanço elétrico) */
export type BreakerId = 'MEP' | 'BC' | 'BTC' | 'BT' | 'BB' | 'HID' | 'COMP' | 'HOTEL' | 'NAV' | 'ESG';

export interface DistributionConfig {
  /** prioridade de cada carga na rejeição automática (1 = nunca rejeitar; maior = rejeitada antes) */
  priority: Record<BreakerId, number>;
  /** demanda não atendida por este tempo (s) antes de rejeitar a próxima carga */
  shedDelay: number;
  /** bateria: capacidade térmica (J/K), troca com o mar (W/K), temperatura inicial (°C) e alarmes (°C) */
  battery: { heatCapacity: number; cooling: number; initialTemp: number; warnTemp: number; critTemp: number };
}

export interface StealthConfig {
  /** aeronave de patrulha: velocidade (m/s), altitude (m), alcance do radar contra o mastro (m) */
  aircraft: { speed: number; altitude: number; radarRange: number; esmRange: number; orbitRadius: number; detectRate: number };
  /** sonar passivo do oponente: índice de diretividade e limiar de detecção (dB) */
  enemySonar: { di: number; dt: number };
}

export interface ThreatConfig {
  /** torpedo de exercício: velocidade de busca/ataque (m/s), guinada (°/s), cone e alcance do autodiretor, autonomia (m) */
  torpedo: { searchSpeed: number; attackSpeed: number; turnRate: number; depthRate: number; seekerCone: number; seekerRange: number; runLength: number; hitRadius: number; breachArea: number };
  /** despistadores: estoque, ruído (dB re 1 µPa a 1 m), duração (s), velocidade de afundamento (m/s) */
  decoy: { stock: number; level: number; life: number; sinkRate: number };
  /** alarme de torpedo em aproximação (m) */
  warnRange: number;
}

export interface TugConfig {
  id: string;
  name: string;
  /** ponto de amarração no casco (m, corpo) */
  x: number;
  /** tração estática máxima (N) */
  bollardPull: number;
  /** taxa de variação da tração (fração por segundo) */
  rate: number;
}

export interface TugsConfig {
  tugs: TugConfig[];
  /** profundidade do eixo acima da qual o cabo desliga (o submarino está mergulhando) (m) */
  maxDepth: number;
}

export function defaultAtmosphere(): AtmosphereConfig {
  return {
    freeVolume: 900,
    temperature: 22,
    crew: 32,
    o2Use: 9.7e-6, // ≈ 0,84 kg/dia
    co2Make: 1.16e-5, // ≈ 1,0 kg/dia
    scrubberRate: 0.05,
    o2Stock: 400,
    o2Rate: 0.004,
    h2PerAh: 1.3e-3,
    gassingSoc: 0.8,
    recombinerRate: 0.02,
    ventAch: 6,
    dieselAch: 10,
  };
}

const BAR = 1e5;

export function defaultDamage(): DamageConfig {
  return {
    bilgePumps: [
      { id: 'BE1', name: 'Bomba de esgoto de vante', compartment: 'CV', ratedFlow: 0.03, shutoff: 12 * BAR, power: 18e3 },
      { id: 'BE2', name: 'Bomba de esgoto central', compartment: 'CC', ratedFlow: 0.03, shutoff: 12 * BAR, power: 18e3 },
      { id: 'BE3', name: 'Bomba de esgoto da praça de máquinas', compartment: 'CM', ratedFlow: 0.03, shutoff: 12 * BAR, power: 18e3 },
    ],
    doors: [
      { id: 'PE1', name: 'Porta estanque vante/central', a: 'CV', b: 'CC', x: 10 },
      { id: 'PE2', name: 'Porta estanque central/máquinas', a: 'CC', b: 'CM', x: -4 },
    ],
    doorSill: 0.25,
    doorFlow: 400,
    fire: { growth: 0.02, detectAt: 0.05, detectDelay: 8, fight: 0.06, o2Use: 0.02, co2Make: 0.025, coMake: 0.002, agent: 600, agentUse: 1 },
  };
}

export function defaultDistribution(): DistributionConfig {
  return {
    priority: { NAV: 1, HID: 2, MEP: 3, BC: 4, ESG: 4, BTC: 5, BT: 5, BB: 5, COMP: 6, HOTEL: 7 },
    shedDelay: 1.0,
    battery: { heatCapacity: 2.4e8, cooling: 6e3, initialTemp: 25, warnTemp: 45, critTemp: 55 },
  };
}

export function defaultStealth(): StealthConfig {
  return {
    aircraft: { speed: 90, altitude: 300, radarRange: 22000, esmRange: 60000, orbitRadius: 6000, detectRate: 0.08 },
    enemySonar: { di: 15, dt: 8 },
  };
}

export function defaultThreat(): ThreatConfig {
  return {
    torpedo: { searchSpeed: 15, attackSpeed: 22, turnRate: 10, depthRate: 4, seekerCone: 40, seekerRange: 1800, runLength: 20000, hitRadius: 9, breachArea: 60 },
    decoy: { stock: 6, level: 152, life: 240, sinkRate: 0.4 },
    warnRange: 6000,
  };
}

export function defaultTugs(): TugsConfig {
  return {
    tugs: [
      { id: 'R1', name: 'Rebocador de proa', x: 27, bollardPull: 1.2e5, rate: 0.1 },
      { id: 'R2', name: 'Rebocador de popa', x: -26, bollardPull: 1.2e5, rate: 0.1 },
    ],
    maxDepth: 6,
  };
}
