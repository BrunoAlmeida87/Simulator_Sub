import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './ui/App';
import { runner } from './ui/store';
import { demo } from './ui/demo';
import { maneuver } from './ui/maneuvers';

// laço principal: a física avança em passos fixos a partir do tempo real decorrido
let last = performance.now();
function loop(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  runner.frame(dt);
  demo.tick(runner);
  maneuver.tick(runner);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
