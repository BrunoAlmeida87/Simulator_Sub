/**
 * AMEAÇA: TORPEDO DE EXERCÍCIO CONTRA O SX-1 E DESPISTADORES ACÚSTICOS.
 *
 *  - O torpedo nasce a uma distância/marcação dadas, aponta para a posição do SX-1 no lançamento (datum) e
 *    busca em zigue-zague. O autodiretor (cone e alcance fixos) escolhe o alvo de maior sinal recebido
 *    (nível − 20·log r): o SX-1 (nível irradiado estimado, stealth.ts) ou um despistador ativo.
 *  - Despistador: lançado pela popa, afunda devagar e emite um nível alto por `life` s. Um SX-1 silencioso
 *    (baixa rotação, sem diesel) perde para o despistador; um SX-1 ruidoso continua sendo o alvo.
 *  - Impacto (distância ao eixo do casco < raio + hitRadius): carga de exercício só registra; carga "avaria"
 *    abre um rombo no compartimento atingido (controle de avarias).
 * Cinemática simples (sem hidrodinâmica, sem acústica de raios). Valores fictícios — ver docs/PARAMETROS.md.
 */
import type { VesselConfig } from '../config/types';
import { defaultThreat } from '../config/extSystems';
import type { SimState } from '../core/state';
import { initThreat, type HostileTorpedo } from '../core/extState';
import { qToMat3, mulMat3TVec } from '../core/math';

const wrap360 = (a: number) => ((a % 360) + 360) % 360;
const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const brg = (dn: number, de: number) => wrap360((Math.atan2(de, dn) * 180) / Math.PI);

export function launchHostileTorpedo(cfg: VesselConfig, s: SimState, range: number, bearing: number, warhead: 'exercicio' | 'avaria'): HostileTorpedo {
  const st = (s.threat ??= initThreat(cfg));
  const a = (bearing * Math.PI) / 180;
  const n = s.body.pos.x + range * Math.cos(a);
  const e = s.body.pos.y + range * Math.sin(a);
  const tc = (cfg.threat ?? defaultThreat()).torpedo;
  const tp: HostileTorpedo = {
    id: `T${++st.seq}`,
    n,
    e,
    d: Math.max(10, s.body.pos.z),
    heading: brg(s.body.pos.x - n, s.body.pos.y - e),
    speed: tc.searchSpeed,
    phase: 'busca',
    target: null,
    run: 0,
    warhead,
    t0: s.t,
    datum: { n: s.body.pos.x, e: s.body.pos.y },
  };
  st.torpedoes.push(tp);
  st.last = '';
  return tp;
}

export function launchDecoy(cfg: VesselConfig, s: SimState): boolean {
  const st = (s.threat ??= initThreat(cfg));
  if (st.decoyStock <= 0) return false;
  st.decoyStock--;
  const R = qToMat3(s.body.quat);
  const x = -cfg.hull.length / 2 - 2;
  st.decoys.push({ id: `D${++st.seq}`, n: s.body.pos.x + R[0] * x, e: s.body.pos.y + R[3] * x, d: Math.max(2, s.body.pos.z + R[6] * x), t0: s.t });
  return true;
}

/** distância (m) de um ponto ao eixo do casco (segmento proa–popa) e a coordenada x do ponto mais próximo */
function hullDistance(cfg: VesselConfig, s: SimState, n: number, e: number, d: number): { dist: number; x: number } {
  const R = qToMat3(s.body.quat);
  const b = mulMat3TVec(R, { x: n - s.body.pos.x, y: e - s.body.pos.y, z: d - s.body.pos.z });
  const L = cfg.hull.length / 2;
  const x = Math.max(-L, Math.min(L, b.x));
  return { dist: Math.hypot(b.x - x, b.y, b.z), x };
}

export interface ThreatStepResult {
  /** rombo aberto por impacto neste passo: compartimento e área (m²) */
  breach: { compartment: string; area: number } | null;
}

export function updateThreat(cfg: VesselConfig, s: SimState, dt: number, ownLevel: number, log: (t: string, g: string) => void, current: { x: number; y: number } = { x: 0, y: 0 }): ThreatStepResult {
  const st = s.threat;
  const out: ThreatStepResult = { breach: null };
  if (!st || (!st.torpedoes.length && !st.decoys.length)) return out;
  const tc = cfg.threat ?? defaultThreat();
  // despistadores: afundam e se esgotam
  for (const dc of st.decoys) {
    dc.d += tc.decoy.sinkRate * dt;
    // a corrente arrasta o despistador
    dc.n += current.x * dt;
    dc.e += current.y * dt;
  }
  st.decoys = st.decoys.filter((dc) => s.t - dc.t0 < tc.decoy.life);
  const own = s.body.pos;
  for (const tp of st.torpedoes) {
    if (tp.phase === 'fim' || tp.phase === 'impacto') continue;
    const T = tc.torpedo;
    // autodiretor: alvos no cone e no alcance
    const cands: { id: string; n: number; e: number; d: number; rx: number }[] = [];
    const consider = (id: string, n: number, e: number, d: number, level: number) => {
      const r = Math.hypot(n - tp.n, e - tp.e, d - tp.d);
      if (r > T.seekerRange) return;
      const off = Math.abs(wrap180(brg(n - tp.n, e - tp.e) - tp.heading));
      if (off > T.seekerCone) return;
      cands.push({ id, n, e, d, rx: level - 20 * Math.log10(Math.max(1, r)) });
    };
    consider('sx1', own.x, own.y, own.z, ownLevel);
    for (const dc of st.decoys) consider(dc.id, dc.n, dc.e, dc.d, tc.decoy.level);
    cands.sort((a, b) => b.rx - a.rx);
    const best = cands[0];
    const prevTarget = tp.target;
    if (best) {
      tp.target = best.id;
      tp.phase = best.id === 'sx1' ? 'ataque' : 'enganado';
      if (prevTarget !== best.id) log(best.id === 'sx1' ? `Torpedo ${tp.id} ADQUIRIU o SX-1` : `Torpedo ${tp.id} seduzido pelo despistador ${best.id}`, 'Ameaça');
    } else {
      if (prevTarget) log(`Torpedo ${tp.id} perdeu o contato — voltou à busca`, 'Ameaça');
      tp.target = null;
      tp.phase = 'busca';
    }
    // guiagem
    let want = tp.heading;
    let wantD = tp.d;
    if (best) {
      want = brg(best.n - tp.n, best.e - tp.e);
      wantD = best.d;
    } else {
      // busca: zigue-zague de ±30° (período 20 s) na direção do datum; perto dele, círculos
      const dd = Math.hypot(tp.datum.n - tp.n, tp.datum.e - tp.e);
      want = dd > 300 ? wrap360(brg(tp.datum.n - tp.n, tp.datum.e - tp.e) + 30 * Math.sin((2 * Math.PI * (s.t - tp.t0)) / 20)) : wrap360(tp.heading + 20);
    }
    const turn = Math.max(-T.turnRate * dt, Math.min(T.turnRate * dt, wrap180(want - tp.heading)));
    tp.heading = wrap360(tp.heading + turn);
    tp.d += Math.max(-T.depthRate * dt, Math.min(T.depthRate * dt, wantD - tp.d));
    tp.d = Math.max(3, tp.d);
    tp.speed = tp.phase === 'busca' ? T.searchSpeed : T.attackSpeed;
    const h = (tp.heading * Math.PI) / 180;
    tp.n += (tp.speed * Math.cos(h) + current.x) * dt;
    tp.e += (tp.speed * Math.sin(h) + current.y) * dt;
    tp.run += tp.speed * dt;
    // impacto no despistador: destrói o despistador, torpedo volta à busca
    if (best && best.id !== 'sx1' && Math.hypot(best.n - tp.n, best.e - tp.e, best.d - tp.d) < 5) {
      st.decoys = st.decoys.filter((dc) => dc.id !== best.id);
      tp.target = null;
      tp.phase = 'busca';
      log(`Torpedo ${tp.id} atingiu o despistador ${best.id}`, 'Ameaça');
    }
    // impacto no SX-1 (qualquer fase: a arma pode passar pelo casco)
    const hd = hullDistance(cfg, s, tp.n, tp.e, tp.d);
    if (hd.dist < cfg.hull.diameter / 2 + T.hitRadius) {
      tp.phase = 'impacto';
      tp.tEnd = s.t;
      const comp = cfg.compartments.find((c) => hd.x <= c.xFwd && hd.x >= c.xAft) ?? (hd.x > 0 ? cfg.compartments[0] : cfg.compartments[cfg.compartments.length - 1]);
      if (tp.warhead === 'avaria' && comp) {
        out.breach = { compartment: comp.id, area: T.breachArea * 1e-4 };
        st.last = `Impacto do torpedo ${tp.id} — rombo de ${T.breachArea} cm² em ${comp.name}`;
      } else st.last = `Impacto simulado do torpedo ${tp.id} (carga de exercício) — ${comp?.name ?? 'casco'}`;
      log(st.last, 'Ameaça');
      continue;
    }
    if (tp.run >= T.runLength) {
      tp.phase = 'fim';
      tp.tEnd = s.t;
      st.last = `Torpedo ${tp.id} esgotou a autonomia — o SX-1 evadiu`;
      log(st.last, 'Ameaça');
    }
  }
  // limpa armas terminadas há mais de 2 min
  st.torpedoes = st.torpedoes.filter((tp) => tp.tEnd === undefined || s.t - tp.tEnd < 120);
  return out;
}

/** torpedo ativo mais próximo (m) ou Infinity */
export function nearestThreat(s: SimState): number {
  let r = Infinity;
  for (const tp of s.threat?.torpedoes ?? []) if (tp.phase !== 'fim' && tp.phase !== 'impacto') r = Math.min(r, Math.hypot(tp.n - s.body.pos.x, tp.e - s.body.pos.y, tp.d - s.body.pos.z));
  return r;
}
