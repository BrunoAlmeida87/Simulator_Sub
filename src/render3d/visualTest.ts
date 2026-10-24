/**
 * MODO DE TESTE VISUAL (só com #teste-visual na URL; `npm run test:visual` usa): torna a cena reproduzível para comparar
 * capturas. Sem o parâmetro tudo continua como sempre foi: `rand` é o próprio Math.random e o passo de tempo é o do relógio.
 *  - aleatoriedade visual (neve marinha, bolhas, espuma, vento, referências de profundidade) vem de uma semente fixa;
 *  - cada quadro avança TEST_DT segundos de animação, qualquer que seja a velocidade do computador, e o relógio visual vem do número de quadros;
 *  - cada cena congela depois de um número fixo de quadros e `window.__sx1Test.settled()` diz quando todas congelaram.
 * Não altera a física: a simulação já fica pausada nos cenários carregados.
 */

export const visualTest = typeof location !== 'undefined' && /(^|[#&?])teste-visual\b/.test(location.hash + location.search);

/** passo de animação por quadro no modo de teste (s); igual ao teto usado pela cena (0,1 s) */
export const TEST_DT = 0.1;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** substitui Math.random nas cenas 3D: semente fixa no teste visual, aleatório de verdade no uso normal */
export const rand: () => number = visualTest ? mulberry32(20240229) : Math.random;

/**
 * Controle do teste: cada cena 3D conta os próprios quadros desde que foi criada (`testFrames`), deriva o relógio visual
 * desse contador (assim a animação não depende da velocidade da máquina nem de quanto tempo o teste esperou) e, ao chegar
 * em `freezeAt` quadros, para de redesenhar: a imagem na tela fica fixa para a captura.
 */
export interface TestHook {
  /** quadros que cada cena desenha antes de congelar (o teste define em `window.__sx1TestFreeze` antes da página carregar) */
  freezeAt: number;
  /** cenas vivas e cenas já congeladas */
  live: Set<object>;
  done: Set<object>;
}

const freezeAt = typeof window !== 'undefined' ? Number((window as unknown as { __sx1TestFreeze?: number }).__sx1TestFreeze) || 24 : 24;
export const testHook: TestHook = { freezeAt, live: new Set(), done: new Set() };

/** cena nova: entra na lista de cenas vivas */
export function testRegister(scene: object): void {
  if (visualTest) testHook.live.add(scene);
}
/** cena descartada: sai das listas */
export function testForget(scene: object): void {
  testHook.live.delete(scene);
  testHook.done.delete(scene);
}
/** chamado a cada quadro desenhado: conta o quadro e congela a cena ao chegar no limite */
export function testFrameDrawn(scene: { testFrames: number }): void {
  scene.testFrames++;
  if (scene.testFrames >= testHook.freezeAt) testHook.done.add(scene);
}

if (visualTest && typeof window !== 'undefined') {
  // true quando há cenas e todas congelaram
  (window as unknown as { __sx1Test: { settled: () => boolean } }).__sx1Test = { settled: () => testHook.live.size > 0 && [...testHook.live].every((x) => testHook.done.has(x)) };
}
