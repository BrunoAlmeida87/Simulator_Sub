/**
 * REBOCADORES — manobra de porto com o submarino na superfície.
 *
 * Cada rebocador fica num ponto do casco (proa/popa) e num bordo. Empurrando, a força é para dentro
 * (do bordo do rebocador para o outro); puxando (cabo), para fora. O ângulo inclina a força para vante (+)
 * ou para ré (−). A tração varia com taxa limitada até a ordenada; o cabo desliga se o eixo passar de
 * `maxDepth` (o submarino mergulhando). Força horizontal no plano do casco, aplicada à meia altura:
 *   F = P·nível·(sen a·x̂ + cos a·(±ŷ)),   M = r × F
 * Valores fictícios — ver docs/PARAMETROS.md.
 */
import type { VesselConfig } from '../config/types';
import { defaultTugs } from '../config/extSystems';
import type { SimState } from '../core/state';
import { initTugs } from '../core/extState';
import { vCross, type Vec3 } from '../core/math';

export function updateTugs(cfg: VesselConfig, s: SimState, dt: number): { F: Vec3; M: Vec3 } | null {
  const st = s.tugs;
  if (!st) return null;
  const tc = cfg.tugs ?? defaultTugs();
  const F: Vec3 = { x: 0, y: 0, z: 0 };
  const M: Vec3 = { x: 0, y: 0, z: 0 };
  let any = false;
  for (const t of tc.tugs) {
    const ts = (st.tugs[t.id] ??= initTugs(cfg).tugs[t.id]);
    const connected = ts.mode !== 'livre' && s.body.pos.z < tc.maxDepth;
    ts.connected = connected;
    const target = connected ? Math.max(0, Math.min(1, ts.cmd)) : 0;
    const step = t.rate * dt;
    ts.level += Math.max(-step, Math.min(step, target - ts.level));
    if (ts.level <= 1e-6) {
      ts.level = 0;
      continue;
    }
    any = true;
    const sideSign = ts.side === 'BE' ? 1 : -1; // BE = boreste (+y)
    const inward = ts.mode === 'empurrar' ? -sideSign : sideSign;
    const a = (ts.angle * Math.PI) / 180;
    const P = t.bollardPull * ts.level;
    const f: Vec3 = { x: P * Math.sin(a), y: P * Math.cos(a) * inward, z: 0 };
    const r: Vec3 = { x: t.x, y: (sideSign * cfg.hull.diameter) / 2, z: 0 };
    const m = vCross(r, f);
    F.x += f.x;
    F.y += f.y;
    M.x += m.x;
    M.y += m.y;
    M.z += m.z;
  }
  st.F = F;
  st.M = M;
  return any ? { F, M } : null;
}
