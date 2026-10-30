import type { SimulationEngine } from '../../sim/core/engine';
import { bearingRange } from '../../sim/geo';
import { observer, worldSources } from '../integration/world';
import { propagation, pathEstimate } from '../acoustics/propagation';
import { ambientNoise, speedAt } from '../acoustics/environment';
import { ownNoise, signature } from '../sources/signatures';
import { clamp, gaussian, wrap, sumDb } from '../types';
import type { EchoPath } from '../types';
/** Ping reception is scheduled in simulation time. Pending truth-derived measurements
 * stay private to the sensor state; operational displays consume arrived tracks only. */
export function emitPing(e: SimulationEngine): boolean {
  const s = e.state.sonar!;
  const t = e.state.t;
  if (!s.settings.enabled || !e.state.electrical.energized || (s.ping && t - s.ping.start < s.ping.duration)) return false;
  const own = observer(e),
    c = speedAt(e.env, own.depth, s.settings.homogeneous);
  s.noise.ambient = ambientNoise(e.env.cfg.waves?.seaState ?? 0, s.settings.shipping, s.settings.biological);
  s.noise.own = ownNoise(e.state);
  s.noise.total = sumDb(s.noise.ambient, s.noise.own);
  s.pending = [];
  const diagnostic = propagation(e.env, own, s.settings.section, s.settings.range, s.settings.rayCount, s.settings.homogeneous);
  const events = [{ t: 0, label: 'Emissão' }];
  const echoPaths: EchoPath[] = [];
  for (const target of worldSources(e)) {
    const br = bearingRange(own, target);
    if (br.rng > s.settings.range) continue;
    const estimate = pathEstimate(e.env, own, br.brg, br.rng, 3, s.settings.homogeneous, true),
      sig = signature(target, s.settings.sourceOverrides[target.id]);
    for (const path of estimate.paths) {
      const snr = 210 - 2 * path.loss + sig.targetStrength - s.noise.total - 10; // reverberation allowance
      if (snr < 6) continue;
      // Moving-target intercept approximation; radial motion is small relative to c.
      const a = (br.brg * Math.PI) / 180,
        h = (target.course * Math.PI) / 180;
      const radial = target.speed * Math.cos(h - a);
      const roundTrip = (2 * path.time) / (1 - clamp(radial / c, -0.05, 0.05));
      const sigmaTime = 0.012 + 0.1 / Math.max(1, snr);
      const measuredTime = Math.max(0.01, roundTrip + gaussian(s) * sigmaTime);
      const due = t + measuredTime,
        sigma = clamp(6 / Math.sqrt(10 ** (snr / 10)), 0.3, 3);
      s.pending.push({
        due,
        measurement: {
          t: due,
          bearing: wrap(br.brg + gaussian(s) * sigma),
          sigma,
          snr,
          observer: { ...own },
          mode: 'active',
          range: (measuredTime * c) / 2,
          rangeSigma: Math.hypot((sigmaTime * c) / 2, measuredTime * c * 0.025),
        },
      });
      echoPaths.push({ bearing: br.brg, points: path.ray.points, arrival: measuredTime });
      events.push({ t: measuredTime / 2, label: 'Reflexão de alvo (modelo)' }, { t: measuredTime, label: 'Chegada de eco simulado' });
    }
  }
  s.ping = { echoPaths, start: t, speed: c, duration: Math.max((2 * s.settings.range) / c + 2, ...s.pending.map((p) => p.due - t + 1)), propagation: diagnostic, events };
  s.version++;
  return true;
}
