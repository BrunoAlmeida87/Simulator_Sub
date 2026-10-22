import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './ui/App';
import { VisualApp } from './ui/VisualApp';
import { runner } from './ui/store';
import { demo } from './ui/demo';
import { maneuver } from './ui/maneuvers';
import { checklist } from './ui/checklist';
import { tours } from './ui/tours';
import { isPanelWindow, isVisualWindow, SyncMaster, SyncViewer } from './ui/sync';
import { link } from './ui/link';
import { route } from './ui/routeNav';

if (isVisualWindow || isPanelWindow) {
  // janela de visualização ou de tela: não roda física, espelha a janela de controle
  // (a de tela envia à janela de controle tudo o que o operador fizer nela)
  link.viewer = new SyncViewer(runner, isPanelWindow);
  const loop = () => {
    link.viewer!.frame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
} else {
  link.master = new SyncMaster(runner);
  // laço principal: a física avança em passos fixos a partir do tempo real decorrido
  let last = performance.now();
  const loop = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    runner.frame(dt);
    demo.tick(runner);
    maneuver.tick(runner);
    checklist.tick(runner);
    tours.tick(runner, dt);
    route.tick(runner);
    link.master!.tick();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

createRoot(document.getElementById('root')!).render(<StrictMode>{isVisualWindow ? <VisualApp /> : <App />}</StrictMode>);
