/**
 * CÂMERA CINEMATOGRÁFICA DO MÍSSIL (vista "Míssil cinematográfica") — só visual.
 *
 * Um "diretor" escolhe o plano pela fase do voo e troca de plano com cortes secos, como num filme:
 *  - SUBMERSO: câmera ao lado da cápsula, acompanhando a subida com o rastro de bolhas;
 *  - SUPERFÍCIE: câmera parada rente à água, a ~50 m do ponto em que a cápsula rompe; mostra o nariz ejetado, o míssil
 *    saindo da cápsula, as asas abrindo e o acelerador acendendo (a câmera só gira para acompanhar);
 *  - CRUZEIRO: alterna perseguição baixa por trás (com balanço de câmera na mão), passagem (câmera parada à frente,
 *    o míssil passa rente) e travelling lateral;
 *  - IMPACTO: câmera parada perto do alvo, de lado para a linha de chegada; depois do impacto, órbita lenta mostrando
 *    o fogo e a fumaça.
 * As posições são da origem flutuante (submarino); `shift` corrige os planos parados quando a origem anda.
 */
import * as THREE from 'three';
import type { MissileRun } from '../sim/core/state';

export type CineShot = 'submerso' | 'superficie' | 'perseguicao' | 'passagem' | 'lateral' | 'impacto' | 'depois' | 'queda';

export interface CineState {
  id: string | null;
  shot: CineShot;
  since: number;
  anchor: THREE.Vector3 | null;
  offset: THREE.Vector3 | null;
  look: THREE.Vector3 | null;
  fov: number;
  cycle: number;
}

export const newCine = (): CineState => ({ id: null, shot: 'submerso', since: 0, anchor: null, offset: null, look: null, fov: 45, cycle: 0 });

export interface CineInput {
  run: MissileRun;
  /** posição da cápsula e do míssil na cena (interpoladas), direção de voo do míssil */
  capsule: THREE.Vector3;
  missile: THREE.Vector3;
  dir: THREE.Vector3;
  /** alvo na cena (ou null) e altura da superfície no míssil */
  target: THREE.Vector3 | null;
  surf: number;
  /** tempo de simulação (s), tempo real (s) e passo real do quadro (s) */
  t: number;
  wall: number;
  dtR: number;
  /** deslocamento da origem flutuante neste quadro (cena) */
  shift: THREE.Vector3;
}

const hz = (v: THREE.Vector3) => {
  const h = new THREE.Vector3(v.x, 0, v.z);
  return h.lengthSq() < 1e-6 ? new THREE.Vector3(0, 0, -1) : h.normalize();
};
const sideOf = (f: THREE.Vector3) => new THREE.Vector3(-f.z, 0, f.x);

/** Plano da câmera neste quadro: posição, ponto de mira e campo de visão. */
export function directMissileCam(c: CineState, inp: CineInput): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
  const r = inp.run;
  if (c.id !== r.id) Object.assign(c, newCine(), { id: r.id, since: inp.t });
  if (c.anchor) c.anchor.sub(inp.shift);
  if (c.look) c.look.sub(inp.shift);
  const set = (shot: CineShot) => {
    if (c.shot === shot) return;
    c.shot = shot;
    c.since = inp.t;
    c.anchor = null;
    c.offset = null;
  };
  const inAir = r.vsm.tSep !== null;
  const subj = inAir ? inp.missile : inp.capsule;
  const fwd = hz(inAir ? inp.dir : new THREE.Vector3(Math.sin((r.vsm.heading * Math.PI) / 180), 0, -Math.cos((r.vsm.heading * Math.PI) / 180)));
  const side = sideOf(fwd);
  const ended = r.phase === 'impacto' || r.phase === 'perdido';
  const tgtDist = inp.target ? Math.hypot(inp.target.x - subj.x, inp.target.z - subj.z) : Infinity;
  const land = !!r.target && r.target.startsWith('TER');
  // ---- escolha do plano
  if (ended) set(r.hit && inp.target ? (c.shot === 'impacto' || c.shot === 'depois' ? c.shot : 'impacto') : c.shot === 'impacto' || c.shot === 'depois' ? c.shot : 'queda');
  else if (r.phase === 'capsula') set('submerso');
  else if (r.phase === 'superficie' || r.phase === 'separacao' || (r.phase === 'acelerador' && inp.t - r.tPhase < 2.6)) set('superficie');
  else if (inp.target && tgtDist < (land ? 4200 : 2600) && r.phase !== 'acelerador') set('impacto');
  else if (c.shot === 'submerso' || c.shot === 'superficie' || c.shot === 'queda') set('perseguicao');
  else if (c.shot === 'perseguicao' && inp.t - c.since > 7) set(c.cycle++ % 2 === 0 ? 'passagem' : 'lateral');
  else if (c.shot === 'lateral' && inp.t - c.since > 5) set('perseguicao');
  if (c.shot === 'impacto' && ended && r.hit && inp.t - c.since > 2 && c.look && inp.t - r.tPhase > 9) set('depois');
  const hand = (k: number) =>
    new THREE.Vector3(0.35 * Math.sin(inp.wall * 1.7) + 0.15 * Math.sin(inp.wall * 4.1), 0.25 * Math.sin(inp.wall * 2.3 + 1) + 0.1 * Math.sin(inp.wall * 5.3), 0.3 * Math.sin(inp.wall * 1.3 + 2)).multiplyScalar(k);
  const k = 1 - Math.exp(-3 * inp.dtR);
  let pos: THREE.Vector3;
  let look: THREE.Vector3;
  let fov = 45;
  switch (c.shot) {
    case 'submerso': {
      // ao lado e um pouco abaixo da cápsula, que sobe na frente da câmera
      const want = side
        .clone()
        .multiplyScalar(9)
        .addScaledVector(fwd, -7)
        .add(new THREE.Vector3(0, -2.5, 0));
      c.offset = c.offset ? c.offset.lerp(want, k) : want;
      pos = subj.clone().add(c.offset);
      pos.y = Math.min(pos.y, inp.surf - 1);
      look = subj
        .clone()
        .addScaledVector(inp.dir, 2)
        .add(new THREE.Vector3(0, 1.5, 0));
      fov = 55;
      break;
    }
    case 'superficie': {
      // parada rente à água, de lado para o ponto de saída
      if (!c.anchor) c.anchor = new THREE.Vector3(subj.x, inp.surf + 2.2, subj.z).addScaledVector(side, 48).addScaledVector(fwd, -22);
      pos = c.anchor.clone().add(hand(0.6));
      const target = subj.clone().add(new THREE.Vector3(0, 2, 0));
      c.look = c.look ? c.look.lerp(target, 1 - Math.exp(-6 * inp.dtR)) : target;
      look = c.look.clone();
      fov = 38;
      break;
    }
    case 'perseguicao': {
      // atrás, um pouco acima e de lado; balanço de câmera na mão
      const want = fwd
        .clone()
        .multiplyScalar(-26)
        .addScaledVector(side, 6)
        .add(new THREE.Vector3(0, 3.2, 0));
      c.offset = c.offset ? c.offset.lerp(want, k) : want;
      pos = subj.clone().add(c.offset).add(hand(0.5));
      look = subj.clone().addScaledVector(inp.dir, 40);
      fov = 42;
      break;
    }
    case 'lateral': {
      const want = side
        .clone()
        .multiplyScalar(-32)
        .addScaledVector(fwd, 4)
        .add(new THREE.Vector3(0, 1.8, 0));
      c.offset = c.offset
        ? c.offset.lerp(want, 1 - Math.exp(-1.5 * inp.dtR))
        : fwd
            .clone()
            .multiplyScalar(-26)
            .add(new THREE.Vector3(0, 3, 0));
      pos = subj.clone().add(c.offset).add(hand(0.4));
      look = subj.clone().addScaledVector(inp.dir, 8);
      fov = 40;
      break;
    }
    case 'passagem': {
      // parada à frente, rente ao mar e afastada da linha de voo: o míssil passa zunindo
      if (!c.anchor)
        c.anchor = subj
          .clone()
          .addScaledVector(fwd, 1100)
          .addScaledVector(side, 12)
          .setY(Math.max(inp.surf + 2.5, subj.y - 1.5));
      pos = c.anchor.clone().add(hand(0.3));
      look = subj.clone();
      // teleobjetiva que abre conforme o míssil se aproxima (ele ocupa sempre uma fração parecida do quadro)
      fov = Math.max(3.5, Math.min(50, 2 * Math.atan2(16, pos.distanceTo(subj)) * (180 / Math.PI)));
      // depois que passou, volta à perseguição
      if (subj.clone().sub(c.anchor).dot(fwd) > 90) set('perseguicao');
      break;
    }
    case 'impacto': {
      const tg = inp.target ?? subj;
      if (!c.anchor) {
        const u = hz(tg.clone().sub(subj));
        const s2 = sideOf(u);
        c.anchor = tg
          .clone()
          .addScaledVector(u, -110)
          .addScaledVector(s2, land ? 260 : 175);
        c.anchor.y = land ? tg.y + 30 : inp.surf + 14;
      }
      pos = c.anchor.clone().add(hand(0.4));
      // mira entre o alvo e o míssil que chega; depois do impacto, no alvo
      const w = ended ? 0 : Math.max(0, Math.min(0.55, 0.55 * (tgtDist / 2600)));
      const target = tg
        .clone()
        .lerp(subj, w)
        .add(new THREE.Vector3(0, 6, 0));
      c.look = c.look ? c.look.lerp(target, 1 - Math.exp(-5 * inp.dtR)) : target;
      look = c.look.clone();
      fov = 34;
      break;
    }
    case 'depois': {
      // órbita lenta em volta do alvo atingido
      const tg = inp.target ?? c.look ?? subj;
      const a = (inp.t - c.since) * 0.06;
      pos = tg.clone().add(new THREE.Vector3(Math.cos(a) * 280, 70, Math.sin(a) * 280));
      look = tg.clone().add(new THREE.Vector3(0, 18, 0));
      fov = 42;
      break;
    }
    default: {
      // queda no mar: olha o ponto da queda
      if (!c.anchor)
        c.anchor = subj
          .clone()
          .addScaledVector(side, 60)
          .addScaledVector(fwd, -40)
          .setY(inp.surf + 10);
      pos = c.anchor.clone();
      look = subj.clone();
      fov = 40;
    }
  }
  // corte seco: o campo de visão do novo plano entra de uma vez; dentro do plano, suave
  if (c.since === inp.t) c.fov = fov;
  else c.fov += (fov - c.fov) * (1 - Math.exp(-4 * inp.dtR));
  return { pos, look, fov: c.fov };
}
