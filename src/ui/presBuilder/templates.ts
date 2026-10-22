/**
 * MODELOS do Estúdio de apresentações (somente leitura: editar cria uma cópia).
 *
 *  - "Submergir e descer para 50 m": o roteiro automático de mesmo nome,
 *    reescrito como dados do Estúdio (mesmas etapas, condições e textos, com
 *    valores ao vivo), para servir de ponto de partida.
 *  - "Exemplo: recursos do Estúdio": apresentação curta que usa cada recurso
 *    (título, texto colorido, mostradores, ação com atraso, gatilhos por tempo,
 *    por condição e manual, troca de câmera).
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

export const BUILTIN_PRESENTATIONS: UserPresentation[] = [submergir50Template(), recursosTemplate()];
