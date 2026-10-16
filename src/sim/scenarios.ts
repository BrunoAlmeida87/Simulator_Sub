/**
 * CENÁRIOS DE TREINAMENTO E CONDIÇÕES INICIAIS.
 */
import type { SimConfig } from './config/types';
import { defaultSimConfig } from './config/defaultVessel';
import { SimulationEngine } from './core/engine';
import { createState, type InitialPose } from './core/initialState';
import { settleAtSurface, solveNeutralCompensation } from './equilibrium';
import { KNOT } from './units';

export type LoadCondition = 'leve' | 'normal' | 'pesada';

export interface ScenarioOptions {
  load: LoadCondition;
  /** compensação pré-calculada já considerando a condição de carga */
  precompensated: boolean;
}

export const LOAD_OFFSETS: Record<LoadCondition, number> = { leve: -6000, normal: 0, pesada: 6000 };
export const LOAD_LABELS: Record<LoadCondition, string> = {
  leve: 'Leve (−6 t: consumo de provisões e carga útil)',
  normal: 'Normal (condição de projeto)',
  pesada: 'Pesada (+6 t: carga adicional embarcada)',
};

export interface ScenarioDef {
  id: string;
  name: string;
  description: string;
  objectives: string[];
  env?: (c: SimConfig) => void;
  pose: InitialPose;
  submerged: boolean;
  /** profundidade (eixo) usada no cálculo de compensação */
  compensationDepth: number;
  compensationError?: number; // kg adicionais deliberadamente não compensados
  post?: (e: SimulationEngine) => void;
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'superficie',
    name: 'Superfície — pronto para imergir',
    description:
      'Submarino flutuando com os tanques de lastro principal (TLP) soprados, suspiros fechados, compensação pré-calculada para ~40 m. Ponto de partida da sequência completa de mergulho.',
    objectives: [
      'Ordenar velocidade (ex.: 6 nós) e abrir os suspiros dos TLP',
      'Acompanhar o alagamento e a perda de flutuabilidade de reserva',
      'Usar lemes de vante/ré para estabelecer a profundidade e fechar os suspiros',
      'Ajustar compensação e trim até o equilíbrio hidrostático',
    ],
    pose: { depth: 2.2, heading: 90, speed: 0 },
    submerged: false,
    compensationDepth: 37,
  },
  {
    id: 'superficie_avante',
    name: 'Superfície — navegando a 8 nós',
    description: 'Navegação na superfície com propulsão elétrica; resistência de ondas aumentada próxima à superfície.',
    objectives: ['Observar a velocidade máxima reduzida na superfície', 'Executar o mergulho em movimento'],
    pose: { depth: 2.2, heading: 45, speed: 8 * KNOT },
    submerged: false,
    compensationDepth: 37,
  },
  {
    id: 'submerso_50',
    name: 'Submerso equilibrado a 50 m — 6 nós',
    description: 'Condição de cruzeiro submersa com flutuabilidade neutra, trim nulo e banda nula.',
    objectives: ['Alterar rumo com o leme de direção', 'Testar trim por pesos × atitude por lemes', 'Ensaiar o piloto automático'],
    pose: { depth: 46.9, heading: 0, speed: 6 * KNOT },
    submerged: true,
    compensationDepth: 46.9,
  },
  {
    id: 'pairando',
    name: 'Pairando a 80 m — sem seguimento',
    description:
      'Velocidade nula: lemes sem efetividade. A profundidade só pode ser controlada pelo equilíbrio estático (compensação) — demonstra a diferença entre controle hidrodinâmico e hidrostático.',
    objectives: ['Tentar controlar a profundidade com os lemes (sem efeito)', 'Admitir/esgotar água de compensação e observar a tendência vertical'],
    pose: { depth: 76.9, heading: 180, speed: 0 },
    submerged: true,
    compensationDepth: 76.9,
  },
  {
    id: 'cota_periscopica',
    name: 'Cota periscópica (snorkel) — bateria a 55 %',
    description: 'Submerso a ~15 m de quilha. Içar o mastro de snorkel e partir os diesel-geradores para recarregar a bateria.',
    objectives: ['Içar o snorkel e confirmar válvula de cabeça aberta', 'Partir os geradores e acompanhar a recarga', 'Observar o aumento de peso com o consumo de combustível compensado'],
    pose: { depth: 11.9, heading: 270, speed: 4 * KNOT },
    submerged: true,
    compensationDepth: 11.9,
    post: (e) => {
      e.state.electrical.soc = 0.55;
    },
  },
  {
    id: 'termoclina',
    name: 'Termoclina acentuada — 45 m',
    description:
      'Camada de transição térmica a 60 m (26 °C → 8 °C). Ao atravessá-la, a densidade aumenta e o submarino ganha empuxo: o equilíbrio ajustado acima da camada deixa de valer abaixo dela.',
    objectives: ['Descer lentamente através da termoclina', 'Observar a variação de ρ e da flutuabilidade líquida', 'Recompensar abaixo da camada'],
    env: (c) => {
      c.environment.surfaceTemperature = 26;
      c.environment.deepTemperature = 8;
      c.environment.thermoclineDepth = 60;
      c.environment.thermoclineThickness = 6;
    },
    pose: { depth: 41.9, heading: 120, speed: 3 * KNOT },
    submerged: true,
    compensationDepth: 41.9,
  },
  {
    id: 'aguas_rasas',
    name: 'Águas rasas — fundo a ~95 m',
    description: 'Operação próxima do fundo com relevo ondulado. Monitore o ecobatímetro e os alarmes de aproximação.',
    objectives: ['Manter altitude segura sobre o fundo', 'Reagir aos alarmes de proximidade'],
    env: (c) => {
      c.environment.bottom.baseDepth = 95;
      c.environment.bottom.roughness = 12;
      c.environment.bottom.slopeNorth = 25;
    },
    pose: { depth: 46.9, heading: 0, speed: 5 * KNOT },
    submerged: true,
    compensationDepth: 46.9,
  },
  {
    id: 'desajuste',
    name: 'Mergulho com compensação desajustada (+4 t)',
    description: 'Superfície; a compensação foi calculada com erro de 4 t (submarino pesado). Após o mergulho será necessário esgotar água.',
    objectives: ['Mergulhar e identificar a tendência de afundar', 'Corrigir com esgoto de compensação'],
    pose: { depth: 2.2, heading: 0, speed: 0 },
    submerged: false,
    compensationDepth: 37,
    compensationError: 4000,
  },
  {
    id: 'alagamento',
    name: 'Emergência: alagamento a 120 m',
    description:
      'Submerso a 120 m a 6 nós. Rombo fictício de 20 cm² na praça de máquinas. Avaliar a taxa de entrada de água e executar a subida de emergência (sopro dos TLP, lemes a subir, velocidade).',
    objectives: ['Identificar o alarme de alagamento', 'Executar sopro de emergência e lemes a subir', 'Atingir a superfície e observar a redução da vazão com a profundidade'],
    pose: { depth: 116.9, heading: 300, speed: 6 * KNOT },
    submerged: true,
    compensationDepth: 116.9,
    post: (e) => {
      e.state.flooding.CM.breachArea = 20e-4;
    },
  },
];

export function scenarioById(id: string): ScenarioDef {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}

/**
 * Constrói um motor pronto para o cenário. baseConfig pode conter parâmetros
 * alterados pelo usuário (são preservados).
 */
export function buildScenario(id: string, baseConfig?: SimConfig, opts: ScenarioOptions = { load: 'normal', precompensated: true }): SimulationEngine {
  const sc = scenarioById(id);
  const config: SimConfig = structuredClone(baseConfig ?? defaultSimConfig());
  sc.env?.(config);
  const offset = LOAD_OFFSETS[opts.load];
  // compensação calculada (eventualmente sem considerar a carga real)
  config.vessel.mass.loadOffset = opts.precompensated ? offset : 0;
  const state = createState(config, sc.pose, sc.id, sc.submerged);
  const engine = new SimulationEngine(config, state);
  solveNeutralCompensation(engine, sc.compensationDepth, true);
  if (sc.compensationError) {
    const ids = config.vessel.compensation.tanks.map((t) => t.id);
    for (const tid of ids) engine.state.compensation.tanks[tid].mass += sc.compensationError / ids.length;
  }
  // carga real
  config.vessel.mass.loadOffset = offset;
  // condição dos TLP
  if (!sc.submerged) {
    for (const t of config.vessel.ballast.tanks) {
      engine.state.ballast[t.id].water = 0;
    }
    settleAtSurface(engine);
  } else {
    for (const t of config.vessel.ballast.tanks) {
      engine.state.ballast[t.id].water = t.volume;
      engine.state.ballast[t.id].air = 0;
    }
  }
  sc.post?.(engine);
  engine.primeSensors();
  engine.state.ledger.mass0 = engine.outputs.mp.internalMass;
  engine.state.autopilot.depthSet = Math.max(0, Math.round(engine.outputs.depthKeel));
  engine.state.autopilot.headingSet = Math.round(engine.outputs.euler.heading);
  return engine;
}
