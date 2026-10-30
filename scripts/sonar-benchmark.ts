/** Reproducible CPU benchmark; not a GPU/FPS guarantee. npm exec vite-node scripts/sonar-benchmark.ts */
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { buildScenario } from '../src/sim/scenarios';
import { updateSonar } from '../src/sonar/integration/system';
import { propagation } from '../src/sonar/acoustics/propagation';
import { observer } from '../src/sonar/integration/world';
import { sonarDelta } from '../src/sonar/integration/sync';
const e = buildScenario('pairando');
e.state.sonar!.settings.traffic = 20;
const times: number[] = [],
  stepTimes: number[] = [];
for (let i = 1; i <= 3000; i++) {
  e.state.t = i * 0.02;
  const before = e.state.sonar!.lastSample,
    start = performance.now();
  updateSonar(e);
  const elapsed = performance.now() - start;
  stepTimes.push(elapsed);
  if (e.state.sonar!.lastSample !== before) times.push(elapsed);
}
stepTimes.sort((a, b) => a - b);
times.sort((a, b) => a - b);
const rayTimes: Record<string, number> = {};
for (const count of [8, 64, 128, 512]) {
  const start = performance.now();
  propagation(e.env, observer(e), 0, 6000, count);
  rayTimes[count] = +(performance.now() - start).toFixed(2);
}
console.log(
  JSON.stringify(
    {
      cpu: cpus()[0]?.model,
      runtime: process.version,
      samples: times.length,
      stepMs: { p95: stepTimes[2850], max: stepTimes[2999] },
      additionalTraffic: 20,
      acquisitionMs: { median: times[30], p95: times[57], max: times[59] },
      traceMs: rayTimes,
      historyFrames: e.state.sonar!.history.size,
      stateJsonBytes: JSON.stringify(e.state.sonar).length,
      deltaJsonBytes: JSON.stringify(sonarDelta(e.state.sonar!, 59, null)).length,
    },
    null,
    2,
  ),
);
