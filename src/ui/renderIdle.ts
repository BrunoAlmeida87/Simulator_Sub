/**
 * ECONOMIA DE DESENHO COM A SIMULAÇÃO PAUSADA: com a simulação parada e ninguém mexendo
 * (mouse, toque, roda, teclado, comandos ou preferências gráficas) por IDLE_MS, as cenas 3D
 * passam a desenhar IDLE_HZ quadros por segundo em vez de um por quadro da tela. Qualquer
 * interação volta à taxa normal na hora. Não altera a física (a simulação parada não avança).
 */
import { runner } from './store';
import { graphics } from './graphics';

export const IDLE_MS = 2000;
export const IDLE_HZ = 4;

let lastActivity = typeof performance !== 'undefined' ? performance.now() : 0;
const wake = () => {
  lastActivity = performance.now();
};

if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart', 'resize']) window.addEventListener(ev, wake, { passive: true, capture: true });
  runner.subscribe(wake);
  graphics.subscribe(wake);
}

/** marca atividade (ex.: animação de câmera em andamento) */
export const renderWake = wake;

/** true = simulação pausada e sem atividade recente: desenhar só a IDLE_HZ */
export function renderIdle(now: number, running = runner.running): boolean {
  return !running && now - lastActivity > IDLE_MS;
}
