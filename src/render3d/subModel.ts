/**
 * MODELO 3D DO SX-1 EM .glb (só visual; a física não muda).
 *
 * O arquivo é feito no Blender e exportado em glTF binário. A cena procura as
 * peças móveis pelos NOMES abaixo e as move pelo estado da simulação. Se o
 * arquivo faltar, não carregar ou não tiver as peças obrigatórias, fica o
 * casco gerado pelo código (LatheGeometry a partir de radiusAt) — a reserva.
 *
 * CONVENÇÕES DO ARQUIVO (as mesmas do código):
 *  - metros; origem no eixo do casco, a meio comprimento (x = 0 da física);
 *  - Blender: +Y = proa, +X = boreste, +Z = para cima. O exportador glTF
 *    converte para o espaço da cena (X = boreste, Y = cima, Z = popa), igual ao
 *    grupo do submarino em SubmarineScene;
 *  - cada peça móvel tem a ORIGEM sobre o eixo de giro (madre do leme, eixo do
 *    hélice) e está na posição de repouso: lemes a zero, mastros arriados;
 *  - popa em cruz como no Scorpène original (decidido com o usuário; a física já é em cruz);
 *  - pistões hidráulicos (opcionais): SX1_Atuador_<leme>_Cilindro (origem no olhal fixo) e
 *    SX1_Atuador_<leme>_Haste (origem no pino da cana); <leme> = nome do leme sem "SX1_" (ex.:
 *    LemePopa_BE). A madre e a cana são filhas do leme e giram com ele; o cilindro gira no olhal
 *    apontando para o pino e a haste acompanha o pino (actuatorPose);
 *  - lemes: o eixo de giro é radial (do eixo do casco para a peça) — o código o
 *    calcula pela posição da origem; a orientação local do objeto é livre.
 */
import * as THREE from 'three';
import type { VesselConfig } from '../sim/config/types';
import type { SimState } from '../sim/core/state';
import { periscopeHeadZ } from '../sim/systems/actuation';
import { buildHullGeometry } from '../sim/physics/hullGeometry';
import { doorCenter, hullXAtRadius } from '../sim/systems/torpedoTubes';

/** Nomes fixos das peças no .glb (sem espaços nem acentos: o GLTFLoader preserva estes nomes). */
export const SUB_PARTS = {
  /** casco externo (pode ter várias malhas com este prefixo: SX1_Casco, SX1_Casco_Conves…) */
  hull: 'SX1_Casco',
  /** vela (torre) */
  sail: 'SX1_Vela',
  /** lemes horizontais de vela (pivô na madre, eixo transversal) */
  sailPlanePort: 'SX1_LemeVela_BB',
  sailPlaneStbd: 'SX1_LemeVela_BE',
  /** popa em CRUZ (Scorpène original): lemes horizontais de ré (BB/BE) e leme de direção (superior/inferior, o inferior mais curto) */
  sternPlanePort: 'SX1_LemePopa_BB',
  sternPlaneStbd: 'SX1_LemePopa_BE',
  rudderUpper: 'SX1_LemePopa_Sup',
  rudderLower: 'SX1_LemePopa_Inf',
  /** hélice de 7 pás (pivô no eixo do hélice) */
  propeller: 'SX1_Helice',
  /** mastro do snorkel (arriado; sobe pelo curso da física) */
  snorkelMast: 'SX1_Mastro_Snorkel',
  /** mastro do periscópio de ataque (arriado) e cabeça (gira com a marcação; filho do mastro) */
  periscopeMast: 'SX1_Mastro_Periscopio',
  periscopeHead: 'SX1_Periscopio_Cabeca',
} as const;

/** Prefixo das portas das bocas dos tubos lançadores (SX1_PortaTubo_1…6; pivô na dobradiça). Opcionais. */
export const TUBE_DOOR_PREFIX = 'SX1_PortaTubo_';
/** abertura máxima da porta da boca (graus) */
export const TUBE_DOOR_OPEN_DEG = 100;

/** Prefixo comum dos lemes de popa (a mistura usa a posição de cada um: serve para cruz e, se um dia mudar, para X). */
export const STERN_PREFIX = 'SX1_LemePopa_';
/** Prefixo opcional das marcas de calado do modelo (se existir, as marcas geradas pelo código somem). */
export const DRAFT_MARKS_PREFIX = 'SX1_MarcasCalado';

/** Peças sem as quais o modelo é recusado (fica a reserva). */
export const REQUIRED_PARTS: string[] = [
  SUB_PARTS.hull,
  SUB_PARTS.sail,
  SUB_PARTS.sailPlanePort,
  SUB_PARTS.sailPlaneStbd,
  SUB_PARTS.sternPlanePort,
  SUB_PARTS.sternPlaneStbd,
  SUB_PARTS.rudderUpper,
  SUB_PARTS.rudderLower,
  SUB_PARTS.propeller,
  SUB_PARTS.snorkelMast,
  SUB_PARTS.periscopeMast,
];

/** Versões do arquivo: a qualidade gráfica escolhe (baixa → leve; média/alta → alta). */
export type SubModelLevel = 'leve' | 'alta';
export function subModelLevel(quality: 'baixa' | 'media' | 'alta'): SubModelLevel {
  return quality === 'baixa' ? 'leve' : 'alta';
}
export function subModelUrl(level: SubModelLevel): string {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';
  return `${base}models/sx1-${level}.glb`;
}

/**
 * Ângulo de um leme de popa (rad, em torno do seu eixo radial para fora) a
 * partir dos ângulos equivalentes da física:
 *   gH = giro dos lemes horizontais em torno de +X da cena (profundor);
 *   gV = giro do leme de direção em torno de +Y da cena.
 * phi = ângulo da peça na seção transversal (0 = boreste, 90° = em cima).
 *
 *   θ = gH·cos φ + gV·sen φ
 *
 * Em cruz (φ = 0, 90, 180, 270°) reproduz exatamente o desenho atual. Em X
 * (φ = 45°…) cada leme recebe a combinação que dá a MESMA força de profundor e
 * de direção que a popa em cruz de mesma área total (sustentação linear):
 * Σ cos²φ = Σ sen²φ = 2 e os termos cruzados se anulam. A deflexão de cada
 * leme é limitada a ±max (com os dois comandos no máximo o leme satura).
 */
export function sternFinAngle(phi: number, gH: number, gV: number, max = Infinity): number {
  const th = gH * Math.cos(phi) + gV * Math.sin(phi);
  return Math.max(-max, Math.min(max, th));
}

/** Prefixo dos pistões hidráulicos dos lemes no .glb. */
export const ACTUATOR_PREFIX = 'SX1_Atuador_';

/**
 * Pose de um pistão hidráulico: o pino da cana gira com o leme (em torno da madre) e o cilindro, preso
 * no olhal fixo, gira para continuar apontando para o pino; a haste acompanha o pino.
 * Devolve a posição nova do pino, o giro a aplicar no cilindro e na haste (sobre o repouso) e o
 * avanço da haste (m, + = estendendo).
 */
export function actuatorPose(anchor: THREE.Vector3, pinRest: THREE.Vector3, pivot: THREE.Vector3, finDelta: THREE.Quaternion): { pin: THREE.Vector3; turn: THREE.Quaternion; stroke: number } {
  const pin = pinRest.clone().sub(pivot).applyQuaternion(finDelta).add(pivot);
  const d0 = pinRest.clone().sub(anchor);
  const d1 = pin.clone().sub(anchor);
  const turn = new THREE.Quaternion().setFromUnitVectors(d0.clone().normalize(), d1.clone().normalize());
  return { pin, turn, stroke: d1.length() - d0.length() };
}

/** Curso dos mastros (m, para cima na cena) a partir do repouso arriado, iguais aos do desenho atual. */
export function mastLift(v: VesselConfig, s: Pick<SimState, 'snorkel' | 'periscope'>): { snorkel: number; periscope: number } {
  const snorkel = s.snorkel.pos * v.hull.snorkelMast.extension;
  const pos = s.periscope?.pos ?? 0;
  const periscope = periscopeHeadZ(v, 0) - periscopeHeadZ(v, pos);
  return { snorkel, periscope };
}

type PickTag = { kind: string; id: string };

interface Moving {
  obj: THREE.Object3D;
  rest: THREE.Quaternion;
  restPos: THREE.Vector3;
  /** eixo de giro no espaço do pai */
  axis: THREE.Vector3;
  /** ângulo da peça na seção transversal (lemes de popa) */
  phi: number;
}

/**
 * Peças do .glb ligadas ao estado. Construído sobre uma CÓPIA da cena do glTF
 * (materiais clonados por janela/cena: o corte troca materiais sem afetar as
 * outras cenas que usam o mesmo arquivo).
 */
export class SubModelRig {
  readonly root: THREE.Object3D;
  /** malhas do casco externo (camada "hull" e corte) */
  readonly shellMeshes: THREE.Mesh[] = [];
  /** objetos do casco externo (para esconder com a camada "hull") */
  readonly shell: THREE.Object3D[] = [];
  readonly pickables: THREE.Object3D[] = [];
  readonly draftMarks: THREE.Object3D[] = [];
  /** material próprio dos lemes (vela e popa): recebe a "Cor dos lemes" da identidade; mantém o relevo */
  readonly finMaterial: THREE.MeshStandardMaterial | null = null;
  private sailPlanes: Moving[] = [];
  private sternFins: Moving[] = [];
  private prop: Moving;
  private snorkel: Moving;
  private periMast: Moving;
  private periHead: Moving | null;
  /** pistões hidráulicos: cilindro e haste ligados ao leme que os move */
  /** portas das bocas dos tubos: giram para fora em torno da dobradiça (lado de fora de cada coluna) */
  private tubeDoors: { tube: number; m: Moving; sign: number }[] = [];
  private actuators: { fin: Moving; cyl: THREE.Object3D; rod: THREE.Object3D; cylRest: THREE.Quaternion; rodRest: THREE.Quaternion; anchor: THREE.Vector3; pin: THREE.Vector3 }[] = [];
  /** avanço atual de cada haste (m), pelo nome do leme — para conferência */
  readonly strokes: Record<string, number> = {};
  private q = new THREE.Quaternion();

  constructor(source: THREE.Object3D, vessel?: VesselConfig) {
    this.root = source.clone(true);
    this.root.name = 'SX1_Modelo';
    const find = (n: string) => this.root.getObjectByName(n) ?? null;
    const missing = REQUIRED_PARTS.filter((n) => !find(n));
    if (missing.length) throw new Error(`modelo sem as peças: ${missing.join(', ')}`);
    // materiais próprios desta cena
    const cloned = new Map<THREE.Material, THREE.Material>();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const out = mats.map((x) => {
        let c = cloned.get(x);
        if (!c) {
          c = x.clone();
          cloned.set(x, c);
        }
        return c;
      });
      m.material = Array.isArray(m.material) ? out : out[0];
    });
    const X = new THREE.Vector3(1, 0, 0);
    const Y = new THREE.Vector3(0, 1, 0);
    const Z = new THREE.Vector3(0, 0, 1);
    const mk = (obj: THREE.Object3D, axis: THREE.Vector3, phi = 0): Moving => ({ obj, rest: obj.quaternion.clone(), restPos: obj.position.clone(), axis: axis.clone(), phi });
    // posição no espaço do modelo (o pai dos lemes pode não ser a raiz)
    this.root.updateMatrixWorld(true);
    const inRoot = (o: THREE.Object3D) => {
      const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
      return p.applyMatrix4(new THREE.Matrix4().copy(this.root.matrixWorld).invert());
    };
    // eixo dado no espaço da raiz → espaço do pai da peça
    const axisInParent = (o: THREE.Object3D, a: THREE.Vector3) => {
      const pq = new THREE.Quaternion();
      if (o.parent && o.parent !== this.root) {
        o.parent.updateWorldMatrix(true, false);
        const rq = new THREE.Quaternion();
        this.root.getWorldQuaternion(rq);
        o.parent.getWorldQuaternion(pq);
        pq.premultiply(rq.invert());
      }
      return a.clone().applyQuaternion(pq.invert()).normalize();
    };
    for (const n of [SUB_PARTS.sailPlanePort, SUB_PARTS.sailPlaneStbd]) {
      const o = find(n)!;
      this.sailPlanes.push(mk(o, axisInParent(o, X)));
      o.userData.pick = { kind: 'fin', id: 'bow' } satisfies PickTag;
      this.pickables.push(o);
    }
    this.root.traverse((o) => {
      if (!o.name.startsWith(STERN_PREFIX)) return;
      // só a peça de nível mais alto com o prefixo (filhos com o mesmo prefixo seguem o pai)
      for (let p = o.parent; p; p = p.parent) if (p.name.startsWith(STERN_PREFIX)) return;
      const p = inRoot(o);
      const phi = Math.atan2(p.y, p.x);
      const radial = new THREE.Vector3(Math.cos(phi), Math.sin(phi), 0);
      this.sternFins.push(mk(o, axisInParent(o, radial), phi));
      const c = Math.abs(Math.cos(phi));
      const sn = Math.abs(Math.sin(phi));
      o.userData.pick = { kind: 'fin', id: sn > c + 0.2 ? 'rudder' : 'stern' } satisfies PickTag;
      this.pickables.push(o);
    });
    // lemes com material próprio (tingido pela "Cor dos lemes"; sem o mapa de cor, com o relevo)
    {
      const finMeshes: THREE.Mesh[] = [];
      // só a superfície do leme (madre e cana, dentro do casco, mantêm o aço)
      for (const m of [...this.sailPlanes, ...this.sternFins]) m.obj.traverse((o) => (o as THREE.Mesh).isMesh && !/_(Madre|Cana)$/.test(o.name) && finMeshes.push(o as THREE.Mesh));
      const base = finMeshes.map((m) => m.material).find((x) => x instanceof THREE.MeshStandardMaterial) as THREE.MeshStandardMaterial | undefined;
      if (base) {
        const fm = base.clone();
        fm.map = null;
        fm.name = 'SX1_Lemes';
        for (const m of finMeshes) m.material = fm;
        (this as { finMaterial: THREE.MeshStandardMaterial | null }).finMaterial = fm;
      }
    }
    const prop = find(SUB_PARTS.propeller)!;
    this.prop = mk(prop, axisInParent(prop, Z));
    prop.userData.pick = { kind: 'prop', id: 'prop' } satisfies PickTag;
    this.pickables.push(prop);
    const sn = find(SUB_PARTS.snorkelMast)!;
    this.snorkel = mk(sn, axisInParent(sn, Y));
    sn.userData.pick = { kind: 'mast', id: 'snorkel' } satisfies PickTag;
    this.pickables.push(sn);
    const pm = find(SUB_PARTS.periscopeMast)!;
    this.periMast = mk(pm, axisInParent(pm, Y));
    const ph = find(SUB_PARTS.periscopeHead);
    this.periHead = ph ? mk(ph, axisInParent(ph, Y)) : null;
    // pistões hidráulicos: o leme dono é o do nome; cilindro, haste e leme no mesmo pai (posições comparáveis)
    const fins = [...this.sailPlanes, ...this.sternFins];
    this.root.traverse((o) => {
      const m = /^SX1_Atuador_(.+)_Cilindro$/.exec(o.name);
      if (!m) return;
      const fin = fins.find((f) => f.obj.name === 'SX1_' + m[1]);
      const rod = find(`${ACTUATOR_PREFIX}${m[1]}_Haste`);
      if (!fin || !rod || rod.parent !== o.parent || fin.obj.parent !== o.parent) return;
      this.actuators.push({ fin, cyl: o, rod, cylRest: o.quaternion.clone(), rodRest: rod.quaternion.clone(), anchor: o.position.clone(), pin: rod.position.clone() });
      // clicar no pistão abre o mesmo controle do leme
      for (const x of [o, rod]) {
        x.userData.pick = fin.obj.userData.pick;
        this.pickables.push(x);
      }
    });
    // portas das bocas dos tubos: eixo = tangente ao contorno oval na dobradiça; abre para fora do casco
    const w = vessel?.weapons;
    if (w && vessel) {
      const R = buildHullGeometry(vessel.hull).radiusAt;
      const b2l = (x: number, y: number, z: number) => new THREE.Vector3(y, -z, -x);
      const r = w.boreRadius + 0.02;
      for (const tc of w.tubes) {
        const o = find(TUBE_DOOR_PREFIX + tc.n);
        if (!o) continue;
        const side = tc.y >= 0 ? 1 : -1;
        const at = (th: number) => {
          const y = tc.y + r * Math.sin(th);
          const z = tc.z - r * Math.cos(th);
          return b2l(hullXAtRadius(R, Math.hypot(y, z), w.breechX), y, z);
        };
        const th = (side * Math.PI) / 2;
        const axis = at(th + 0.05)
          .sub(at(th - 0.05))
          .normalize();
        const hinge = at(th);
        const dc = doorCenter(w, tc, R);
        const arm = b2l(dc.x, dc.y, dc.z).sub(hinge);
        const outside = (sg: number) => {
          const p = arm.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, sg)).add(hinge);
          return Math.hypot(p.x, p.y) - R(-p.z);
        };
        this.tubeDoors.push({ tube: tc.n, m: mk(o, axisInParent(o, axis)), sign: outside(1) > outside(-1) ? 1 : -1 });
      }
    }
    // casco externo = tudo que não é peça móvel nem marca de calado
    const moving = new Set<THREE.Object3D>([...this.sailPlanes, ...this.sternFins, this.prop, this.snorkel, this.periMast, ...this.actuators.flatMap((a) => [a.cyl, a.rod])].map((m) => ('obj' in m ? m.obj : m)));
    const under = (o: THREE.Object3D, set: Set<THREE.Object3D>) => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (set.has(p)) return true;
      return false;
    };
    this.root.traverse((o) => {
      if (o.name.startsWith(DRAFT_MARKS_PREFIX)) {
        this.draftMarks.push(o);
        return;
      }
      const m = o as THREE.Mesh;
      if (!m.isMesh || under(o, moving) || this.draftMarks.some((d) => under(o, new Set([d])))) return;
      m.userData.baseMaterial = m.material;
      this.shellMeshes.push(m);
      this.shell.push(m);
    });
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
  }

  /** Todos os materiais desta cópia (para injetar cáusticas/borda como no casco gerado). */
  materials(): THREE.Material[] {
    const set = new Set<THREE.Material>();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const x of Array.isArray(m.material) ? m.material : [m.material]) set.add(x);
    });
    return [...set];
  }

  /** cor dos lemes (mesma regra do desenho atual: cor + leve emissão) */
  setFinColor(color: THREE.Color, emissive: THREE.Color): void {
    if (!this.finMaterial) return;
    this.finMaterial.color.copy(color);
    this.finMaterial.emissive.copy(emissive);
  }

  private turn(m: Moving, angle: number): void {
    this.q.setFromAxisAngle(m.axis, angle);
    m.obj.quaternion.copy(m.rest).premultiply(this.q);
  }

  /**
   * Move as peças pelo estado. gBow/gH/gV = ângulos geométricos (rad) usados
   * pelo desenho atual (lemes de vela, profundor de ré, direção);
   * maxStern = deflexão máxima de cada leme de popa (rad).
   */
  update(v: VesselConfig, s: SimState, gBow: number, gH: number, gV: number, maxStern: number, periBearingDeg: number, periVisible: boolean): void {
    // lemes de vela: mesmo giro dos dois bordos em torno do eixo transversal (+X)
    for (const m of this.sailPlanes) this.turn(m, gBow);
    for (const m of this.sternFins) {
      const cross = Math.abs(Math.sin(2 * m.phi)) < 0.3;
      this.turn(m, sternFinAngle(m.phi, gH, gV, cross ? Infinity : maxStern));
    }
    this.turn(this.prop, -s.propulsion.shaftAngle);
    const lift = mastLift(v, s);
    this.snorkel.obj.position.copy(this.snorkel.restPos).addScaledVector(this.snorkel.axis, lift.snorkel);
    this.periMast.obj.position.copy(this.periMast.restPos).addScaledVector(this.periMast.axis, lift.periscope);
    this.periMast.obj.visible = periVisible;
    if (this.periHead) this.turn(this.periHead, (-periBearingDeg * Math.PI) / 180);
    // portas das bocas dos tubos lançadores
    for (const d of this.tubeDoors) {
      const t = s.weapons?.tubes.find((x) => x.n === d.tube);
      this.turn(d.m, d.sign * (t?.door.pos ?? 0) * ((TUBE_DOOR_OPEN_DEG * Math.PI) / 180));
    }
    // pistões: seguem o leme (giro do leme sobre o repouso)
    for (const a of this.actuators) {
      const delta = a.fin.obj.quaternion.clone().multiply(a.fin.rest.clone().invert());
      const p = actuatorPose(a.anchor, a.pin, a.fin.restPos, delta);
      a.cyl.quaternion.copy(a.cylRest).premultiply(p.turn);
      a.rod.position.copy(p.pin);
      a.rod.quaternion.copy(a.rodRest).premultiply(p.turn);
      this.strokes[a.fin.obj.name] = p.stroke;
    }
  }
}

// ------------------------------------------------------------------ carregamento
const cache = new Map<string, Promise<THREE.Object3D>>();

/**
 * Carrega (uma vez por janela) o .glb. Aceita malhas comprimidas com meshopt
 * e texturas KTX2 (Basis) ou WebP. Rejeita se o arquivo faltar ou falhar.
 */
export function loadSubModel(url: string, renderer: THREE.WebGLRenderer): Promise<THREE.Object3D> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const [{ GLTFLoader }, { MeshoptDecoder }, { KTX2Loader }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/libs/meshopt_decoder.module.js'),
        import('three/examples/jsm/loaders/KTX2Loader.js'),
      ]);
      const base = url.slice(0, url.lastIndexOf('models/'));
      const ktx2 = new KTX2Loader().setTranscoderPath(`${base}basis/`).detectSupport(renderer);
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);
      const gltf = await loader.loadAsync(url);
      return gltf.scene;
    })();
    // falha não fica em cache: outra tentativa (ex.: ao trocar a qualidade) busca de novo
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}
