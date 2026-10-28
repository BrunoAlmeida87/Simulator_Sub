/**
 * MODELOS do Estúdio de apresentações (somente leitura: editar cria uma cópia).
 *
 *  - "Submergir e descer para 50 m": o roteiro automático de mesmo nome,
 *    reescrito como dados do Estúdio (mesmas etapas, condições e textos, com
 *    valores ao vivo), para servir de ponto de partida.
 *  - "Exemplo: recursos do Estúdio": apresentação curta que usa cada recurso
 *    (título, texto colorido, mostradores, ação com atraso, gatilhos por tempo,
 *    por condição e manual, troca de câmera).
 *  - "Controle de trim": mergulho a 50 m, parada, cargas a bordo levadas para
 *    vante (pitch ~6°), cálculo e transferência de água de trim, pitch zero.
 *
 * O roteiro automático original (tours.ts) continua igual.
 */
import { defaultSimConfig } from '../../sim/config/defaultVessel';
import { defaultLayers, type SceneLayers } from '../../render3d/layers';
import { defaultAdvance, defaultFormat, defaultVisual, newAction, PRES_FORMAT, PRES_VERSION, NEXT_END, type PresStep, type StepAdvance, type StepVisual, type UserPresentation, type StepFormat } from './model';
import type { Condition } from './variables';

const vessel = defaultSimConfig().vessel;
const MBT = vessel.ballast.tanks.map((t) => t.id);
const COMP = vessel.compensation.tanks.map((t) => t.id);

/** camadas completas a partir de uma base limpa de apresentação */
const L = (p: Partial<SceneLayers>): SceneLayers => ({
  ...defaultLayers(),
  vectors: false,
  hydroVectors: false,
  trimVectors: false,
  tanks: false,
  pipes: false,
  flows: true,
  labels: true,
  markers: false,
  wake: true,
  wind: true,
  ships: true,
  trail: true,
  presLight: true,
  batteryInfo: false,
  airInfo: false,
  highlight: null,
  tankFilter: null,
  ...p,
});

const C = (v: string, op: Condition['op'], value: number, tol = 1): Condition => ({ v, op, value, tol });
const V = (p: Partial<StepVisual>): StepVisual => ({ ...defaultVisual(), ...p });
const A = (p: Partial<StepAdvance>): StepAdvance => ({ ...defaultAdvance(), ...p });
const F = (p: Partial<StepFormat> = {}): StepFormat => ({ ...defaultFormat(), ...p });

let n = 0;
const S = (p: Partial<PresStep> & { title: string }): PresStep => ({
  id: `m${++n}`,
  text: '',
  why: '',
  notes: '',
  format: F(),
  visual: V({}),
  actions: [],
  advance: A({}),
  state: null,
  loadState: false,
  ...p,
});

const T0 = '2026-10-22T00:00:00.000Z';

export function submergir50Template(): UserPresentation {
  n = 0;
  const L1 = L({ vectors: true, tanks: true, pipes: true });
  const L3 = L({ vectors: true, tanks: true, pipes: true, tankFilter: MBT });
  const L5 = L({ tanks: true, pipes: true, tankFilter: MBT });
  const L6 = L({ hydroVectors: true, markers: true });
  const L8 = L({ vectors: true, tanks: true, pipes: true, tankFilter: COMP });
  const L9 = L({ markers: true });
  return {
    format: PRES_FORMAT,
    version: PRES_VERSION,
    id: 'modelo-submergir50',
    name: 'Submergir e descer para 50 m (modelo)',
    description:
      'Da superfície até a cota de 50 m: seguimento, alagamento dos TLP, fechamento dos suspiros, descida com os lemes, nivelamento e equilíbrio pela compensação. Mesmo conteúdo do roteiro automático, agora editável etapa por etapa.',
    author: 'Simulador SX-1',
    createdAt: T0,
    updatedAt: T0,
    builtin: true,
    start: { mode: 'cenario', scenario: 'superficie', sea: 1, load: 'normal', precompensated: true, state: null },
    steps: [
      S({
        title: 'Situação inicial: flutuando na superfície',
        text: 'O submarino está parado na superfície. Os tanques de lastro principal ([azul]TLP[/azul]) estão cheios de ar e os suspiros fechados.\nO empuxo [ciano]**E = {empuxo} tf**[/ciano] equilibra o peso [vermelho]**P = {peso} tf**[/vermelho], com {imerso} % do casco imerso. A reserva de flutuabilidade é de **{reserva} t**: é a água que precisa entrar para o submarino submergir por completo.',
        why: 'Flutuar = peso igual ao empuxo. Na superfície, parte do casco fica fora d’água; o empuxo corresponde só ao volume imerso.',
        notes: 'Apresente as cores: azul = lastro principal, vermelho = peso, ciano = empuxo, amarelo = resultante.',
        visual: V({ view: 'forcas', layers: L1, hud: ['peso', 'empuxo', 'resultante'], timeScale: 1, run: 'executar' }),
        advance: A({ mode: 'tempo', seconds: 14 }),
      }),
      S({
        title: 'Ganhar seguimento (velocidade)',
        text: 'Telégrafo em **AVANTE MEIA** (75 rpm). O hélice empurra com **{helice} kN** e a água resiste com {resistencia} kN. Pela massa de ~{massa:0} t o casco acelera devagar: **{vel} nós**. Repare na esteira, na onda de proa e no rastro do hélice.',
        why: 'Os lemes de profundidade só geram força com escoamento (∝ U²). Por isso o mergulho é feito em movimento.',
        visual: V({ view: 'superficie', layers: L({ hydroVectors: true, markers: true }), hud: ['vel', 'rpm'], timeScale: 2, run: 'executar' }),
        actions: [newAction('telegrafo', { rpm: 75 })],
        advance: A({ mode: 'condicao', conditions: [C('vel', '>', 4)], minDwell: 12, timeout: 400 }),
      }),
      S({
        title: 'Abrir os suspiros dos TLP',
        text: 'Suspiros abertos: o ar escapa pelo topo dos TLP (jatos brancos sobre o casco) e a água do mar entra pelos embornais no fundo (setas azuis). Os TLP estão **{tlp} % cheios** ({tlpAgua} t de água).\nO peso subiu [vermelho]**{Δpeso} tf**[/vermelho] e o casco afunda: o empuxo acompanha ([ciano]{empuxo} tf[/ciano]) porque mais volume fica imerso ({imerso} %).',
        why: 'A água só entra se o ar puder sair: o suspiro é a “tampa” do tanque; o embornal no fundo fica sempre aberto para o mar.',
        visual: V({ view: 'tanques', layers: L3, hud: ['tlp', 'peso', 'empuxo'], timeScale: 1, run: 'executar' }),
        actions: [newAction('suspiros', { alvo: 'ALL', abrir: true })],
        advance: A({ mode: 'condicao', conditions: [C('tlp', '>', 50)], waitText: 'TLP mais da metade cheios', minDwell: 14, timeout: 300 }),
      }),
      S({
        title: 'TLP cheios: a reserva de flutuabilidade acabou',
        text: 'Os TLP estão **{tlp} % cheios**. Reserva de flutuabilidade: **{reserva} t**. Com o casco quase todo imerso ({imerso} %), o empuxo deixa de crescer e o submarino fica perto do neutro: [vermelho]P = {peso} tf[/vermelho], [ciano]E = {empuxo} tf[/ciano].',
        why: 'Depois que o casco submerge por completo, o volume deslocado não aumenta mais: o empuxo fica praticamente constante.',
        visual: V({ view: 'forcas', layers: L3, hud: ['tlp', 'reserva', 'resultante'], timeScale: 1, run: 'executar' }),
        advance: A({ mode: 'condicao', conditions: [C('tlp', '>', 97)], waitText: 'TLP acima de 97 %', minDwell: 12, timeout: 300 }),
      }),
      S({
        title: 'Fechar os suspiros',
        text: 'Fechando as válvulas dos suspiros: âmbar enquanto se movem, vermelhas quando fechadas. Suspiros ainda abertos: **{suspirosAbertos}**.\nFechados, o pouco ar que restou fica retido e os TLP ficam prontos para o sopro na hora de emergir.',
        why: 'Com os suspiros fechados, o ar comprimido do sopro expulsa a água pelos embornais sem escapar por cima.',
        visual: V({ view: 'tanques', layers: L5, timeScale: 1, run: 'executar' }),
        actions: [newAction('suspiros', { alvo: 'ALL', abrir: false })],
        advance: A({ mode: 'condicao', conditions: [C('suspirosFechados', '=', 1)], waitText: 'todas as válvulas de suspiro fechadas', minDwell: 10, timeout: 120 }),
      }),
      S({
        title: 'Descer com os lemes até 50 m',
        text: 'Piloto automático de profundidade ordenado para **50 m**. Os lemes de vante ({lemeAV}°) e de ré ({lemeAR}°) inclinam a proa (pitch **{pitch}°**) e geram forças de {forcaLemeAV} kN e {forcaLemeAR} kN.\nProfundidade **{prof} m**, descendo {vz} m/s.',
        why: 'Quase neutro, quem controla a profundidade em movimento são os lemes: a força hidrodinâmica é pequena perto do peso, mas basta para vencer o pequeno desequilíbrio.',
        visual: V({ view: 'submerso', layers: L6, hud: ['prof', 'vz', 'pitch'], timeScale: 2, run: 'executar' }),
        actions: [newAction('pilotoProf', { cota: 50 }), newAction('piloto', { canal: 'heading', auto: true })],
        advance: A({ mode: 'condicao', conditions: [C('prof', '>', 30)], waitText: 'profundidade acima de 30 m', minDwell: 12, timeout: 600 }),
      }),
      S({
        title: 'Chegando à cota e nivelando',
        text: 'Perto de 50 m o piloto reduz a razão de descida e nivela o submarino. Profundidade **{prof} m** · velocidade vertical {vz} m/s · pitch {pitch}°.',
        why: 'O controle é em cascata: o erro de profundidade vira um pitch ordenado, e o pitch é obtido com os lemes.',
        visual: V({ view: 'piloto', layers: L6, hud: ['prof', 'vz', 'pitch'], timeScale: 2, run: 'executar' }),
        advance: A({
          mode: 'condicao',
          conditions: [C('prof', '≈', 50, 1.5), C('vz', '≈', 0, 0.099), C('pitch', '≈', 0, 1.99)],
          logic: 'todas',
          waitText: 'na cota (±1,5 m), estável e nivelado',
          minDwell: 12,
          timeout: 600,
        }),
      }),
      S({
        title: 'Equilíbrio hidrostático pela compensação',
        text: 'Na cota, um pequeno desequilíbrio era compensado pelos lemes. A compensação ([verde]tanques TC[/verde]) admite ou esgota essa água: já foram **{Δcomp:2} m³**.\nAgora: [amarelo]**E − P = {resultante:2} tf**[/amarelo]. Com o casco todo submerso, só o peso muda; o empuxo fica em [ciano]{empuxo} tf[/ciano].',
        why: 'Submerso, o ajuste fino do peso é feito pelos tanques de compensação: pequenas quantidades de água tornam a resultante nula sem depender dos lemes.',
        visual: V({ view: 'forcas', layers: L8, hud: ['resultante', 'comp', 'empuxo'], timeScale: 3, run: 'executar' }),
        actions: [newAction('equilibrar', { tol: 250 })],
        advance: A({ mode: 'condicao', conditions: [C('flutuab', '≈', 0, 0.299), C('dosagem', '=', 0)], logic: 'todas', waitText: 'resultante menor que 300 kg e dosagem concluída', minDwell: 14, timeout: 900 }),
      }),
      S({
        title: 'Concluído: submerso e equilibrado a 50 m',
        text: 'Submarino a **{prof} m**, {vel} nós, pitch {pitch}°, resultante {flutuab:2} t.\nSequência:\n- seguimento\n- suspiros abertos (TLP alagados)\n- suspiros fechados\n- descida com os lemes\n- nivelamento\n- compensação',
        notes: 'Última etapa: encerre quando terminar as perguntas (→ ou ■ Encerrar).',
        visual: V({ view: 'submerso', layers: L9, hud: ['prof', 'vel', 'flutuab'], timeScale: 1, run: 'executar' }),
        advance: A({ mode: 'manual', next: NEXT_END }),
      }),
    ],
  };
}

export function recursosTemplate(): UserPresentation {
  n = 100;
  const forces = L({ vectors: true, tanks: true, pipes: true, tankFilter: MBT });
  return {
    format: PRES_FORMAT,
    version: PRES_VERSION,
    id: 'modelo-recursos',
    name: 'Exemplo: recursos do Estúdio (modelo)',
    description: 'Apresentação curta na superfície: o submarino recebe água nos tanques de lastro, fica mais baixo na água e volta a subir com o sopro. Cada etapa usa um recurso diferente do Estúdio.',
    author: 'Simulador SX-1',
    createdAt: T0,
    updatedAt: T0,
    builtin: true,
    start: { mode: 'cenario', scenario: 'superficie', sea: 2, load: 'normal', precompensated: true, state: null },
    steps: [
      S({
        title: 'Abertura',
        text: '# Como um submarino afunda e volta\nPeso, empuxo e os tanques de lastro',
        notes: 'Etapa de TÍTULO (estilo “Título”, centro, tamanho GG). Só avança quando você quiser: → , Page Down, clique em “Próxima” ou o controle remoto de slides.',
        format: F({ style: 'titulo', position: 'centro', size: 'GG', accent: 'azul', showProgress: false, showStatus: false }),
        visual: V({ view: 'superficie', layers: L({ markers: true }), timeScale: 1, run: 'executar' }),
        advance: A({ mode: 'manual' }),
      }),
      S({
        title: 'Duas forças',
        text: 'Duas forças verticais atuam no casco:\n- o [vermelho]**peso P = {peso} tf**[/vermelho], para baixo\n- o [ciano]**empuxo E = {empuxo} tf**[/ciano], para cima\nFlutuando, as duas se equilibram: [amarelo]E − P = {resultante:2} tf[/amarelo].',
        why: 'O empuxo é o peso da água deslocada pelo volume imerso do casco.',
        notes: 'Texto com cores e lista; mostradores ao vivo no canto. Avança sozinho depois de 15 s.',
        visual: V({ view: 'forcas', layers: forces, hud: ['peso', 'empuxo', 'resultante'], timeScale: 1, run: 'executar' }),
        advance: A({ mode: 'tempo', seconds: 15 }),
      }),
      S({
        title: 'Deixar a água entrar',
        text: 'Em 3 segundos os **suspiros** dos [azul]TLP[/azul] abrem: o ar sai por cima e a água entra por baixo.\nTLP: **{tlp} %** · peso: [vermelho]{Δpeso} tf[/vermelho] desde o início da etapa · casco imerso: {imerso} %.',
        why: 'A água só entra se o ar puder sair.',
        notes: 'Ação com atraso (abre os suspiros 3 s depois de entrar). Gatilho por CONDIÇÃO: TLP ≥ 35 %, com tempo mínimo de leitura de 8 s.',
        visual: V({ view: 'tanques', layers: forces, hud: ['tlp', 'peso', 'imerso'], timeScale: 1, run: 'executar' }),
        actions: [newAction('suspiros', { alvo: 'ALL', abrir: true }, 3)],
        advance: A({ mode: 'condicao', conditions: [C('tlp', '≥', 35)], minDwell: 8, timeout: 240 }),
      }),
      S({
        title: 'Mais baixo na água',
        text: 'Suspiros fechando. Com {tlpAgua} t de água nos TLP, o submarino continua flutuando, mas **mais fundo**: veja o calado na régua.',
        notes: 'Troca de câmera: a etapa começa na vista lateral do calado com as referências ligadas.',
        visual: V({ view: 'calado', layers: L({ trimRef: true, labels: true }), hud: ['tlp', 'imerso'], timeScale: 1, run: 'executar' }),
        actions: [newAction('suspiros', { alvo: 'ALL', abrir: false })],
        advance: A({ mode: 'condicao', conditions: [C('suspirosFechados', '=', 1)], minDwell: 8, timeout: 120 }),
      }),
      S({
        title: 'Soprar com ar comprimido',
        text: 'O ar das garrafas ([branco]{arAP} bar[/branco] no coletor) empurra a água para fora pelos embornais. TLP: **{tlp} %**.',
        why: 'Com os suspiros fechados, o ar do sopro não tem por onde escapar a não ser empurrando a água.',
        notes: 'Duas ações: troca para a vista dos tanques e, 2 s depois, abre o sopro.',
        visual: V({ view: 'calado', layers: L({ tanks: true, pipes: true, tankFilter: MBT, airInfo: true, trimRef: true }), hud: ['tlp', 'arAP'], timeScale: 2, run: 'executar' }),
        actions: [newAction('camera', { vista: 'tanques' }), newAction('sopro', { alvo: 'ALL', abrir: true }, 2)],
        advance: A({ mode: 'condicao', conditions: [C('tlp', '<', 4)], waitText: 'TLP praticamente vazios', minDwell: 6, timeout: 400 }),
      }),
      S({
        title: 'Fim',
        text: 'De volta à condição inicial: TLP vazios, sopro fechado. **Obrigado!**',
        notes: 'Estilo “Legenda”. Encerre com → ou ■ Encerrar.',
        format: F({ style: 'legenda', position: 'baixo', size: 'G', accent: 'verde', showProgress: false, showStatus: false }),
        visual: V({ view: 'superficie', layers: L({ markers: true }), timeScale: 1, run: 'executar' }),
        actions: [newAction('sopro', { alvo: 'ALL', abrir: false })],
        advance: A({ mode: 'manual', next: NEXT_END }),
      }),
    ],
  };
}

// ------------------------------------------------------------ controle de trim
const TRIM_TANKS = [vessel.trim.tankA.id, vessel.trim.tankB.id];
const LOADS = vessel.mass.shiftLoads ?? [];
const load = (id: string) => LOADS.find((l) => l.id === id)!;
const nf = (x: number, d = 1) => x.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d });
/** destino de cada carga na apresentação (m, corpo): torpedos nos tubos, tripulantes e mantimentos no compartimento de vante */
const TRIM_DEST: Record<string, number> = { torpedos: 22, tripulantes: 15, mantimentos: 12 };
const loadT = (id: string) => (load(id).quantity * load(id).unitMass) / 1000;
const loadD = (id: string) => TRIM_DEST[id] - load(id).home.x;
const loadM = (id: string) => loadT(id) * loadD(id);
/** pose da câmera livre em relação ao submarino (rumo 090°: x = proa, z = boreste, y = para cima) */
const CAM = (pos: [number, number, number], target: [number, number, number]) => ({ pos, target });

export function controleTrimTemplate(): UserPresentation {
  n = 200;
  const tA = vessel.trim.tankA;
  const tB = vessel.trim.tankB;
  const arm = tA.center.x - tB.center.x;
  const pumpLs = vessel.trim.pump.ratedFlow * 1000;
  const totM = ['torpedos', 'tripulantes', 'mantimentos'].reduce((a, id) => a + loadM(id), 0);
  // capa: bandeira na vela; a partir do 2º slide, boias e marcos de distância mostram o avanço
  const cover = L({ markers: false, flag: true, wake: true, labels: true, depthLines: true });
  const outside = L({ markers: true, flag: true, trail: true, wake: true, labels: true, depthLines: true });
  const cut = (p: Partial<SceneLayers> = {}) =>
    L({ tanks: true, pipes: true, flows: true, labels: true, tankFilter: TRIM_TANKS, hullOpacity: 0.22, pitchAngle: true, depthLines: false, wake: false, trail: false, ships: false, ...p });
  const side = (p: Partial<SceneLayers> = {}) => L({ labels: true, pitchAngle: true, wake: false, trail: false, ships: false, depthLines: true, ...p });
  const HUD_TRIM = ['trimAV', 'trimAR', 'trimTransf', 'pitch'];
  const T = load('torpedos');
  const P = load('tripulantes');
  const M = load('mantimentos');
  return {
    format: PRES_FORMAT,
    version: PRES_VERSION,
    id: 'modelo-controle-trim',
    name: 'Controle de trim (modelo)',
    description:
      'Mergulho até 50 m, parada na cota e casco transparente com os tanques de trim. Torpedos, tripulantes e mantimentos são levados para vante: o momento inclina a proa ~6°. O cálculo da transferência, a água passando de TT-AV para TT-AR e o submarino de volta a pitch zero.',
    author: 'Simulador SX-1',
    createdAt: T0,
    updatedAt: T0,
    builtin: true,
    start: { mode: 'cenario', scenario: 'superficie', sea: 2, load: 'normal', precompensated: true, state: null },
    steps: [
      S({
        title: 'Abertura',
        text: '# Controle de trim\nO equilíbrio longitudinal do submarino',
        notes: 'Etapa de título: avance quando quiser (→, Page Down ou “Próxima”).',
        format: F({ style: 'titulo', position: 'baixo', size: 'GG', accent: 'laranja', showProgress: false, showStatus: false }),
        visual: V({ view: 'livre', camPose: CAM([30, 3, 34], [2, 5, 0]), layers: cover, timeScale: 1, run: 'executar' }),
        advance: A({ mode: 'manual' }),
      }),
      S({
        title: 'Na superfície',
        text: 'O submarino está parado na superfície, com o trim acertado: **pitch {pitch}°**.\nVamos mergulhar até **50 m**, parar e ver o que acontece quando cargas mudam de lugar a bordo, e como os [laranja]**tanques de trim**[/laranja] devolvem o equilíbrio.',
        why: 'Trim é o equilíbrio longitudinal: o ângulo entre o eixo do casco e a horizontal (pitch).',
        format: F({ accent: 'laranja' }),
        visual: V({ view: 'superficie', layers: outside, hud: ['prof', 'pitch'], timeScale: 1, run: 'executar' }),
        advance: A({ mode: 'tempo', seconds: 12 }),
      }),
      S({
        title: 'Mergulho: ganhar seguimento',
        text: 'Telégrafo em **AVANTE MEIA**. Os lemes de profundidade só funcionam com o submarino em movimento: **{vel} nós**.',
        format: F({ accent: 'azul' }),
        visual: V({ view: 'superficie', layers: outside, hud: ['vel', 'prof'], timeScale: 3, run: 'executar' }),
        actions: [newAction('telegrafo', { rpm: 75 })],
        advance: A({ mode: 'condicao', conditions: [C('vel', '>', 4)], waitText: 'velocidade acima de 4 nós (7.4 km/h)', minDwell: 6, timeout: 400 }),
      }),
      S({
        title: 'Mergulho: alagar os tanques de lastro',
        text: 'Suspiros abertos: o ar sai por cima e a água do mar entra nos [azul]TLP[/azul] (**{tlp} %**). O submarino perde a reserva de flutuabilidade e afunda até ficar todo submerso.',
        format: F({ accent: 'azul' }),
        visual: V({ view: 'superficie', layers: outside, hud: ['tlp', 'prof'], timeScale: 3, run: 'executar' }),
        actions: [newAction('suspiros', { alvo: 'ALL', abrir: true })],
        advance: A({ mode: 'condicao', conditions: [C('tlp', '>', 97)], waitText: 'TLP acima de 97 %', minDwell: 6, timeout: 400 }),
      }),
      S({
        title: 'Mergulho: descer até 50 m',
        text: 'Suspiros fechados e piloto de profundidade em **50 m**. Os lemes inclinam a proa para baixo e o submarino desce: **{prof} m**, pitch {pitch}°.',
        why: 'Durante a descida, o ângulo vem dos lemes (força hidrodinâmica). Na cota o piloto nivela o casco.',
        format: F({ accent: 'azul' }),
        visual: V({ view: 'piloto', layers: L({ hydroVectors: true, depthLines: true, labels: true, wake: true, markers: true, trail: true, flag: true }), hud: ['prof', 'vz', 'pitch'], timeScale: 4, run: 'executar' }),
        actions: [newAction('suspiros', { alvo: 'ALL', abrir: false }), newAction('pilotoProf', { cota: 50 }), newAction('piloto', { canal: 'heading', auto: true })],
        advance: A({ mode: 'condicao', conditions: [C('prof', '≈', 50, 1.5), C('vz', '≈', 0, 0.099), C('pitch', '≈', 0, 0.99)], waitText: 'a 50 m, estável e nivelado', minDwell: 6, timeout: 900 }),
      }),
      S({
        title: 'Na cota: parar o submarino',
        text: 'A **50 m**: telégrafo em **RÉ MEIA** para tirar o seguimento ({vel} nós).\nA compensação faz o ajuste fino do peso (tema de outra apresentação): com peso igual ao empuxo, parado, o submarino **fica na mesma profundidade**.',
        why: 'Parado, os lemes não geram força. Só pesos e empuxo atuam: é assim que se vê o efeito puro das cargas no trim.',
        format: F({ accent: 'ciano' }),
        visual: V({ view: 'piloto', layers: side({ pitchAngle: false, markers: true, trail: true }), hud: ['vel', 'prof', 'pitch'], timeScale: 3, run: 'executar' }),
        actions: [newAction('equilibrar', { tol: 50 }), newAction('telegrafo', { rpm: -60 })],
        advance: A({ mode: 'condicao', conditions: [C('vel', '<', 0.15), C('dosagem', '=', 0)], waitText: 'submarino parado e compensação concluída', minDwell: 4, timeout: 500 }),
      }),
      S({
        title: 'Parado a 50 m, nivelado',
        text: 'Hélice parado, piloto desligado e lemes a 0°. Profundidade **{prof} m**, velocidade {vel} nós.\nAs linhas mostram a **horizontal** (tracejada) e o **eixo do casco**: coincidem, pitch **{pitch}°**.',
        why: 'Submerso, o empuxo atua no centro de carena B, acima do centro de gravidade G (BG = {bg:2} m). Quando o casco inclina, esse binário o traz de volta: é a rigidez de trim.',
        format: F({ accent: 'verde' }),
        visual: V({ view: 'livre', camPose: CAM([2, -6, 88], [2, -13, 0]), layers: side({ markers: true, trail: true }), hud: ['prof', 'vel', 'pitch'], timeScale: 2, run: 'executar' }),
        actions: [
          newAction('telegrafo', { rpm: 0 }),
          newAction('piloto', { canal: 'depth', auto: false }),
          newAction('leme', { id: 'bow', ang: 0 }),
          newAction('leme', { id: 'stern', ang: 0 }),
          newAction('equilibrar', { tol: 100 }),
          newAction('pesoMassa', { t: 0 }),
          newAction('trimNivelar', { tol: 0.03 }, 10),
          newAction('trimReferencia', {}, 20),
        ],
        advance: A({ mode: 'condicao', conditions: [C('pitch', '≈', 0, 0.07), C('dosagem', '=', 0)], waitText: 'casco nivelado e estável', hold: 10, minDwell: 22, timeout: 300 }),
      }),
      S({
        title: 'Casco transparente: os tanques de trim',
        text: `[laranja]**Tanques de trim**[/laranja] nas pontas do casco: **TT-AV** e **TT-AR**, a **${nf(arm)} m** um do outro, ligados pela bomba de trim.\nEm [magenta]rosa[/magenta]: torpedos, tripulantes e mantimentos.`,
        notes: `TT-AV a ${nf(tA.center.x)} m à vante e TT-AR a ${nf(-tB.center.x)} m à ré do centro (12 m³ cada, ~6 m³ de água); bomba BT de ${nf(pumpLs, 0)} L/s; tubulação em laranja. Mudar água de lugar não muda o peso total, só a posição do centro de gravidade. Etapa manual.`,
        format: F({ accent: 'laranja', position: 'baixo-esquerda', size: 'M' }),
        visual: V({ view: 'livre', camPose: CAM([4, 14, 64], [4, -1, 0]), layers: cut(), hud: ['trimAV', 'trimAR', 'pitch'], timeScale: 1, run: 'executar' }),
        advance: A({ mode: 'manual' }),
      }),
      S({
        title: 'Torpedos levados para os tubos',
        text: `**${T.quantity} torpedos** (${nf(loadT('torpedos'))} t) saem das estantes (x = ${nf(T.home.x, 0)} m) para os tubos de lançamento na proa (x = ${TRIM_DEST.torpedos} m): ${nf(loadD('torpedos'), 0)} m para vante.\nMomento das cargas: [magenta]**{momCargas} t·m**[/magenta] · pitch **{pitch}°**.`,
        why: 'O peso não mudou, mudou só o lugar: o centro de gravidade vai para vante e a proa começa a descer.',
        format: F({ accent: 'magenta' }),
        visual: V({ view: 'livre', camPose: CAM([17, 4, 30], [16, -4, 0]), layers: cut({ trimVectors: true }), hud: ['momCargas', 'pitch'], timeScale: 2, run: 'executar' }),
        actions: [newAction('cargaDeslocar', { id: 'torpedos', x: TRIM_DEST.torpedos })],
        advance: A({ mode: 'condicao', conditions: [C('cargasNoDestino', '=', 1)], waitText: 'torpedos nos tubos', minDwell: 5, timeout: 300 }),
      }),
      S({
        title: 'Tripulantes vão para vante',
        text: `**${P.quantity} tripulantes** (${P.quantity} × ${P.unitMass} kg = ${nf(loadT('tripulantes'), 2)} t) vão da praça de máquinas (x = ${nf(P.home.x, 0)} m) para o compartimento de vante (x = ${TRIM_DEST.tripulantes} m).\nMomento das cargas: [magenta]**{momCargas} t·m**[/magenta] · pitch **{pitch}°**.`,
        format: F({ accent: 'magenta' }),
        visual: V({ view: 'livre', camPose: CAM([3, 5, 42], [3, -4.5, 0]), layers: cut({ trimVectors: true }), hud: ['momCargas', 'pitch'], timeScale: 2, run: 'executar' }),
        actions: [newAction('cargaDeslocar', { id: 'tripulantes', x: TRIM_DEST.tripulantes })],
        advance: A({ mode: 'condicao', conditions: [C('cargasNoDestino', '=', 1)], waitText: 'tripulantes a vante', minDwell: 4, timeout: 300 }),
      }),
      S({
        title: 'Mantimentos levados para vante',
        text: `**Mantimentos** (${M.quantity} caixas × ${M.unitMass} kg = ${nf(loadT('mantimentos'))} t) vão do paiol (x = ${nf(M.home.x, 0)} m) para a cozinha de vante (x = ${TRIM_DEST.mantimentos} m).\nMomento total das cargas: [magenta]**{momCargas} t·m**[/magenta], proa para baixo · pitch **{pitch}°**.`,
        format: F({ accent: 'magenta' }),
        visual: V({ view: 'livre', camPose: CAM([7, 4, 32], [6, -4, 0]), layers: cut({ trimVectors: true }), hud: ['momCargas', 'pitch'], timeScale: 2, run: 'executar' }),
        actions: [newAction('cargaDeslocar', { id: 'mantimentos', x: TRIM_DEST.mantimentos })],
        advance: A({ mode: 'condicao', conditions: [C('cargasNoDestino', '=', 1), C('pitch', '<', -5.5)], waitText: 'cargas no lugar e a proa inclinada', minDwell: 10, timeout: 300 }),
      }),
      S({
        title: 'O ângulo de pitch',
        text: 'O submarino ficou **inclinado de proa**: o eixo do casco faz [laranja]**{pitch}°**[/laranja] com a horizontal.\nO casco gira até o binário do empuxo equilibrar o momento das cargas:\nθ ≈ M ÷ (W·BG) = {momCargas} t·m ÷ {rigidezTrim} t·m = **{pitchEq}°** (previsto) · medido **{pitch}°**',
        why: 'W·BG é a rigidez de trim submerso: peso × distância vertical entre o centro de carena e o centro de gravidade. Com BG de só {bg:2} m, poucas toneladas mudadas de lugar já inclinam o casco vários graus.',
        notes: 'Etapa manual: deixe o público ver o ângulo. As linhas: tracejada = horizontal; laranja = eixo do casco; arco com marcas a cada grau.',
        format: F({ accent: 'laranja', position: 'baixo', size: 'G' }),
        visual: V({ view: 'livre', camPose: CAM([2, -6, 88], [2, -13, 0]), layers: side(), hud: ['pitch', 'pitchEq', 'momCargas', 'prof'], timeScale: 1, run: 'executar' }),
        advance: A({ mode: 'manual' }),
      }),
      S({
        title: 'Cálculo da transferência',
        text: 'Momento das cargas **M = {momCargas} t·m** · distância entre os tanques **d = {bracoTrim} m**\nÁgua a transferir: **m = M ÷ d =** [laranja]**{trimCalc} t**[/laranja] (≈ {trimCalcM3} m³), de vante para ré.',
        notes: `M = ${nf(loadT('torpedos'))} t × ${nf(loadD('torpedos'), 0)} m (torpedos) + ${nf(loadT('tripulantes'), 2)} t × ${nf(loadD('tripulantes'), 0)} m (tripulantes) + ${nf(loadT('mantimentos'))} t × ${nf(loadD('mantimentos'), 0)} m (mantimentos) = ${nf(totM)} t·m. A água tem de criar um momento igual e contrário: cada tonelada levada de TT-AV para TT-AR muda o momento em ${nf(arm)} t·m. Conferência: ${nf(totM)} ÷ ${nf(arm)} = ${nf(totM / arm, 2)} t. Etapa manual.`,
        format: F({ accent: 'laranja', position: 'baixo-esquerda', size: 'M' }),
        visual: V({ view: 'livre', camPose: CAM([4, 14, 64], [4, -1, 0]), layers: cut({ trimVectors: true }), hud: ['momCargas', 'bracoTrim', 'trimCalc', 'pitch'], timeScale: 1, run: 'executar' }),
        advance: A({ mode: 'manual' }),
      }),
      S({
        title: 'Bomba ligada: a água sai do TT-AV',
        text: 'A bomba de trim aspira do [laranja]**TT-AV**[/laranja] e manda para ré. Nível do TT-AV: **{trimAV} m³** · já transferido: **{trimTransf} t** · falta: {trimCalc} t.',
        format: F({ accent: 'laranja', position: 'topo' }),
        visual: V({ view: 'livre', camPose: CAM([20, -3, -17], [21.5, -4.5, 0]), layers: cut({ highlight: tA.id, pitchAngle: false }), hud: HUD_TRIM, timeScale: 3, run: 'executar' }),
        actions: [newAction('trimCompensar', {})],
        advance: A({ mode: 'tempo', seconds: 18 }),
      }),
      S({
        title: 'Pela tubulação, passando pela bomba',
        text: 'A água corre pela tubulação no fundo do casco e passa pela **bomba de trim (BT)**. Já transferido: **{trimTransf} t** · pitch **{pitch}°**.',
        format: F({ accent: 'laranja', position: 'topo' }),
        visual: V({ view: 'livre', camPose: CAM([7, -2.5, -14], [8, -3.8, 0]), layers: cut({ pitchAngle: false }), hud: HUD_TRIM, timeScale: 3, run: 'executar' }),
        advance: A({ mode: 'tempo', seconds: 14 }),
      }),
      S({
        title: 'A água chega ao TT-AR',
        text: 'O [laranja]**TT-AR**[/laranja] enche: **{trimAR} m³**. O momento da água cresce ({momTrim} t·m) e vai anulando o das cargas ({momCargas} t·m): a proa sobe, pitch **{pitch}°**.',
        format: F({ accent: 'laranja', position: 'topo' }),
        visual: V({ view: 'livre', camPose: CAM([-11.5, -0.5, -17], [-13, -1.5, 0]), layers: cut({ highlight: tB.id, pitchAngle: false }), hud: HUD_TRIM, timeScale: 3, run: 'executar' }),
        advance: A({ mode: 'condicao', conditions: [C('dosagem', '=', 0), C('pitch', '≈', 0, 0.07)], waitText: 'transferência concluída e casco nivelado', hold: 20, minDwell: 8, timeout: 900 }),
      }),
      S({
        title: 'Equilibrado: pitch zero',
        text: 'Transferência concluída: **{trimTransf} t** de água foram de vante para ré.\nMomento das cargas [magenta]{momCargas} t·m[/magenta] = momento da água [laranja]{momTrim} t·m[/laranja], em sentidos contrários.\nO submarino está **nivelado**: pitch [verde]**{pitch}°**[/verde], a **{prof} m**.',
        why: 'As cargas continuam a vante; a água a ré equilibra o momento delas. O peso total não mudou: a profundidade se manteve.',
        notes:
          'Etapa manual. Começa com o casco transparente e os vetores de trim (cargas a vante × água a ré, anel verde: momentos se anulam); aos 8 s os vetores saem e aos 14 s o casco fica completo, de lado, com a horizontal e o eixo do casco coincidindo.',
        format: F({ accent: 'verde' }),
        visual: V({ view: 'livre', camPose: CAM([2, -6, 88], [2, -13, 0]), layers: cut({ trimVectors: true, depthLines: true }), hud: ['pitch', 'prof', 'momCargas', 'momTrim'], timeScale: 1, run: 'executar' }),
        actions: [newAction('camada', { camada: 'trimVectors', ligar: false }, 8), newAction('camada', { camada: 'tanks', ligar: false }, 14)],
        advance: A({ mode: 'manual' }),
      }),
      S({
        title: 'Resumo',
        text: 'Controle de trim:\n- cargas mudando de lugar (torpedos, pessoas, mantimentos) criam um **momento**\n- o casco inclina até o binário do empuxo (W·BG) equilibrar esse momento\n- água a transferir = **momento ÷ distância entre os tanques**\n- a bomba de trim leva a água para o lado oposto e o pitch volta a **zero**, sem mudar o peso total',
        notes: 'Última etapa: encerre quando terminar as perguntas (→ ou ■ Encerrar).',
        format: F({ accent: 'verde', size: 'G' }),
        visual: V({ view: 'livre', camPose: CAM([2, -6, 88], [2, -13, 0]), layers: side(), hud: ['pitch', 'prof'], timeScale: 1, run: 'executar' }),
        advance: A({ mode: 'manual', next: NEXT_END }),
      }),
    ],
  };
}

export const BUILTIN_PRESENTATIONS: UserPresentation[] = [submergir50Template(), recursosTemplate(), controleTrimTemplate()];
