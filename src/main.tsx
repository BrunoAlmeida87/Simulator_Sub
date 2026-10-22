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
import { isVisualWindow, SyncMaster, SyncViewer } from './ui/sync';
import { link } from './ui/link';
import { route } from './ui/routeNav';
import { presPlayer } from './ui/presBuilder/player';

if (isVisualWindow) {
  // janela de visualização: não roda física, espelha a janela de controle
  link.viewer = new SyncViewer(runner);
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
    // durante o avanço acelerado de uma apresentação, quem avança a física é o próprio avanço
    if (!presPlayer.ff) runner.frame(dt);
    demo.tick(runner);
    maneuver.tick(runner);
    checklist.tick(runner);
    tours.tick(runner, dt);
    presPlayer.tick(runner, dt);
    route.tick(runner);
    link.master!.tick();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

createRoot(document.getElementById('root')!).render(<StrictMode>{isVisualWindow ? <VisualApp /> : <App />}</StrictMode>);
