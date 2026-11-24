/**
 * CONTROLE DE AVARIAS — esgoto, portas estanques e incêndio por compartimento.
 *
 *  - Bomba de esgoto: descarrega a água do porão ao mar contra a pressão externa. Curva simplificada
 *    Q = Q_n·√(1 − Δp/Δp_0), Δp = p_mar(porão) − p_interna: perde vazão com a profundidade e para de
 *    esgotar abaixo de ≈ Δp_0/(ρg) (com os padrões, ~120 m). A água esgotada sai do navio (ledger.floodOut).
 *  - Porta estanque aberta: acima da soleira (fração do enchimento máximo) a água passa do compartimento
 *    mais cheio para o menos cheio até igualar o enchimento (a massa total não muda; G se desloca).
 *  - Incêndio: intensidade I (0..1) com crescimento logístico limitado pelo O₂ do ar, detecção por limiar e
 *    retardo, combate com agente extintor (estoque em kg) e extinção por alagamento. O consumo de O₂ e a
 *    produção de CO₂/CO entram na atmosfera (atmosphere.ts). Com a porta aberta, um incêndio forte alcança
 *    o compartimento vizinho.
 * Valores fictícios — ver docs/PARAMETROS.md.
 */
import type { VesselConfig, FloodingCompartment } from '../config/types';
import { defaultDamage } from '../config/extSystems';
import type { SimState } from '../core/state';
import type { StepContext } from '../core/context';
import { atmosphereFractions, initDamage } from '../core/extState';

/** massa máxima de água num compartimento (mesma regra de updateFlooding: 60 % do cilindro) */
export function compartmentMaxWater(cfg: VesselConfig, c: FloodingCompartment, rho = 1025): number {
  const R = cfg.hull.diameter / 2;
  return Math.PI * R * R * (c.xFwd - c.xAft) * 0.6 * rho;
}

/** vazão de uma bomba de esgoto (m³/s) contra a diferença de pressão dada (Pa) */
export function bilgeFlow(ratedFlow: number, shutoff: number, dp: number): number {
  return ratedFlow * Math.sqrt(Math.max(0, 1 - Math.max(0, dp) / shutoff));
}

/** profundidade (m) em que a bomba deixa de esgotar com a pressão interna nominal */
export function bilgeCutoffDepth(shutoff: number): number {
  return shutoff / (1025 * 9.80665);
}

export interface DamageStepResult {
  /** água esgotada ao mar neste passo (kg) */
  out: number;
  /** potência elétrica das bombas de esgoto (W) */
  power: number;
}

export function updateDamage(cfg: VesselConfig, s: SimState, ctx: StepContext, pumpsPowered: boolean): DamageStepResult {
  const d = cfg.damage ?? defaultDamage();
  const st = (s.damage ??= initDamage(cfg));
  const dt = ctx.dt;
  let out = 0;
  let power = 0;
  const comp = new Map(cfg.compartments.map((c) => [c.id, c]));

  // --- bombas de esgoto
  for (const p of d.bilgePumps) {
    const ps = (st.pumps[p.id] ??= { cmd: false, flow: 0, power: 0 });
    ps.flow = 0;
    ps.power = 0;
    const c = comp.get(p.compartment);
    if (!ps.cmd || !pumpsPowered || !c) continue;
    ps.power = p.power;
    power += p.power;
    const f = s.flooding[c.id];
    if (!f || f.water <= 0) continue;
    const z = ctx.depthOf({ x: 0.5 * (c.xFwd + c.xAft), y: 0, z: c.bilgeZ });
    const dp = z > 0 ? ctx.env.pressureAt(z) - cfg.internalPressure : 0;
    const rho = 1025;
    const m = Math.min(f.water, bilgeFlow(p.ratedFlow, p.shutoff, dp) * rho * dt);
    f.water -= m;
    ps.flow = m / rho / dt;
    out += m;
  }

  // --- portas estanques
  for (const door of d.doors) {
    const ds = (st.doors[door.id] ??= { open: false, flow: 0 });
    ds.flow = 0;
    const ca = comp.get(door.a);
    const cb = comp.get(door.b);
    if (!ds.open || !ca || !cb) continue;
    const fa = s.flooding[ca.id];
    const fb = s.flooding[cb.id];
    const Ma = compartmentMaxWater(cfg, ca);
    const Mb = compartmentMaxWater(cfg, cb);
    const xa = fa.water / Ma;
    const xb = fb.water / Mb;
    const hi = xa >= xb ? { f: fa, M: Ma, x: xa } : { f: fb, M: Mb, x: xb };
    const lo = xa >= xb ? { f: fb, M: Mb, x: xb } : { f: fa, M: Ma, x: xa };
    if (hi.x <= d.doorSill || hi.x - lo.x < 1e-4) continue;
    // massa que iguala o enchimento, limitada à água acima da soleira e ao espaço do outro compartimento
    const equalize = (hi.f.water * lo.M - lo.f.water * hi.M) / (hi.M + lo.M);
    const m = Math.max(0, Math.min(d.doorFlow * (hi.x - lo.x) * dt, equalize, hi.f.water - d.doorSill * hi.M, lo.M - lo.f.water));
    hi.f.water -= m;
    lo.f.water += m;
    ds.flow = ((xa >= xb ? 1 : -1) * m) / dt; // + = de a para b
  }

  // --- incêndios
  const fc = d.fire;
  const x = s.atmosphere ? atmosphereFractions(s.atmosphere) : { o2: 0.2095 };
  const oxy = Math.max(0, Math.min(1.3, (x.o2 - 0.12) / (0.2095 - 0.12)));
  for (const c of cfg.compartments) {
    const fire = (st.fires[c.id] ??= { intensity: 0, detected: false, timer: 0, fighting: false, temp: 24 });
    let I = fire.intensity;
    if (I > 0) {
      I += fc.growth * I * (1 - I) * oxy * dt;
      if (fire.fighting && st.agent > 0) {
        I -= fc.fight * dt;
        st.agent = Math.max(0, st.agent - fc.agentUse * dt);
      }
      // água no porão acima de 30 % do enchimento máximo apaga o incêndio do compartimento
      if (s.flooding[c.id] && s.flooding[c.id].water / compartmentMaxWater(cfg, c) > 0.3) I -= 0.05 * dt;
      if (I <= 1e-3) {
        I = 0;
        if (fire.intensity > 0) ctx.log(`Incêndio extinto — ${c.name}`, 'Avarias');
        fire.fighting = false;
        fire.timer = 0;
      }
      if (I > fc.detectAt && !fire.detected) {
        fire.timer += dt;
        if (fire.timer >= fc.detectDelay) {
          fire.detected = true;
          ctx.log(`INCÊNDIO DETECTADO — ${c.name}`, 'Avarias');
        }
      }
    } else if (fire.detected && fire.temp < 40) fire.detected = false;
    fire.intensity = Math.max(0, Math.min(1, I));
    // temperatura do compartimento: 1ª ordem (60 s) para 24 °C + 600 °C·I
    fire.temp += Math.min(1, dt / 60) * (24 + 600 * fire.intensity - fire.temp);
  }
  // propagação pelas portas abertas
  for (const door of d.doors) {
    if (!st.doors[door.id]?.open) continue;
    for (const [from, to] of [
      [door.a, door.b],
      [door.b, door.a],
    ]) {
      const a = st.fires[from];
      const b = st.fires[to];
      if (a && b && a.intensity > 0.7 && b.intensity === 0) {
        b.intensity = 0.02;
        ctx.log(`Incêndio se propaga pela porta ${door.name}`, 'Avarias');
      }
    }
  }
  return { out, power };
}

/** algum compartimento com incêndio ativo? */
export const anyFire = (s: SimState): boolean => Object.values(s.damage?.fires ?? {}).some((f) => f.intensity > 0);
