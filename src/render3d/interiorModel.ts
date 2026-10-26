/**
 * INTERIOR DO SX-1 NO CORTE (public/models/sx1-interior.glb) — só visual; a física não muda.
 *
 * Com a camada "Tanques (corte)" e o interior carregado, o corte vira MEIO CASCO ABERTO: um
 * plano vertical pelo eixo remove a metade do lado da câmera (casco, vela e peças internas) e
 * aparece o interior feito no Blender (scripts/blender/build_sx1_interior.py): casco
 * resistente, tanques, tubulações, válvulas, bombas, garrafas de ar AP, bateria, geradores e a
 * linha de eixo. Tudo segue a simulação:
 *  - a água e o ar dos tanques, as partículas de escoamento, as setas e os rótulos continuam
 *    vindo do corte (Systems.ts), recortados pelo mesmo plano;
 *  - válvulas: o volante muda de cor (verde aberta, vermelha fechada, âmbar em curso, magenta
 *    emperrada) e gira com a posição real;
 *  - bombas: o rotor gira com a rotação; eixo e rotor do motor giram com o ângulo do eixo;
 *  - filtro e destaque de tanques valem como no corte; cada peça abre o mesmo controle.
 * Os nós e os dados de cada peça (extras do glTF → userData) vêm do arranjo do corte: os nomes
 * das válvulas e bombas são os mesmos do Systems.ts (teste tests/interiorModel.test.ts).
 */
import * as THREE from 'three';
import type { SimulationEngine } from '../sim/core/engine';
import type { ValveState } from '../sim/core/state';

/**
 * Interior do Blender no corte: com qualidade média/alta sempre; com a baixa (celular) só quando o meio casco aberto
 * é pedido (ele depende do interior); senão fica o corte antigo, mais leve.
 */
export function interiorEnabled(quality: 'baixa' | 'media' | 'alta', halfCut = false): boolean {
  return quality !== 'baixa' || halfCut;
}

export function interiorUrl(): string {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';
  return `${base}models/sx1-interior.glb`;
}

/** Eixo dado nas coordenadas do Blender (+Y proa, +Z cima) → cena (X boreste, Y cima, Z popa). */
export function blenderAxis(a: number[] | undefined, fallback = new THREE.Vector3(0, 1, 0)): THREE.Vector3 {
  if (!a || a.length !== 3) return fallback.clone();
  return new THREE.Vector3(a[0], a[2], -a[1]).normalize();
}

/**
 * Lado do corte: some a metade do lado da câmera (x local do submarino). Histerese de 0,5 m
 * para não trocar de lado quando a câmera passa pelo plano (vistas de frente e de topo).
 */
export function cutSide(camLocalX: number, prev: 1 | -1): 1 | -1 {
  if (camLocalX > 0.5) return 1;
  if (camLocalX < -0.5) return -1;
  return prev;
}

/** Plano de corte (mundo) que mantém a metade oposta à câmera: normal local (−lado, 0, 0) pelo eixo. */
export function setCutPlane(plane: THREE.Plane, sub: THREE.Object3D, side: 1 | -1): THREE.Plane {
  sub.updateMatrixWorld();
  const n = new THREE.Vector3(-side, 0, 0).transformDirection(sub.matrixWorld);
  const p = new THREE.Vector3().setFromMatrixPosition(sub.matrixWorld);
  return plane.setFromNormalAndCoplanarPoint(n, p);
}

/** Cor do volante pelo estado da válvula (a mesma regra do corte). */
export function valveColor(st: ValveState): number {
  const moving = Math.abs(st.cmd - st.pos) > 0.02;
  return st.stuck ? 0xff00ff : moving ? 0xffc040 : st.pos > 0.5 ? 0x3ddc84 : 0xff4d4d;
}

/** Giro do volante (rad) pela posição da válvula: 1,5 volta de fechada a aberta. */
export function wheelAngle(pos: number): number {
  return -Math.max(0, Math.min(1, pos)) * 3 * Math.PI;
}

export interface InteriorLinks {
  valves: { name: string; owners: string[]; get: (e: SimulationEngine) => ValveState; pick: unknown; directional: boolean }[];
  pumps: { name: string; owners: string[]; get: (e: SimulationEngine) => { speed: number; cmd: boolean; failed: boolean }; pick: unknown }[];
  tanks: { id: string; cat: string }[];
}

export interface InteriorVisibility {
  shown: (owners: string[]) => boolean;
  dim: (owners: string[]) => boolean;
  tankShown: (id: string) => boolean;
}

interface Part {
  node: THREE.Object3D;
  owners: string[] | null;
  mats: THREE.Material[];
  /** opacidade normal (tanques são translúcidos) */
  base: number;
  /** some com a camada "Tubulações" desligada */
  piping: boolean;
  /** tipo da peça (extras do glTF) */
  tipo: string;
  tank?: string;
}

const TANK_OPACITY = 0.16;
/** luz própria das peças (fração da cor no emissivo): o interior não fica no escuro dentro do casco */
export const SELF_LIGHT = 0.4;

/** Modos do corte: raio-X (casco translúcido, padrão) ou meio casco aberto (camada "Meio casco aberto"). */
export type CutMode = 'raiox' | 'meio';

/** Opacidade da estrutura (casco resistente/anteparas e cavernas) em cada modo; 0 = escondida. */
export function structureOpacity(tipo: string, mode: CutMode): number | null {
  if (tipo === 'casco_resistente' || tipo === 'antepara') return mode === 'raiox' ? 0.1 : 0.85;
  if (tipo === 'cavernas') return mode === 'raiox' ? 0 : 0.3;
  return null;
}

/** Peças do interior ligadas ao estado. Construído sobre uma CÓPIA da cena do glTF (materiais por cena). */
export class InteriorRig {
  readonly root: THREE.Object3D;
  readonly pickables: THREE.Object3D[] = [];
  readonly parts: Part[] = [];
  /** válvulas do arquivo sem par no corte (deve ficar vazio; conferido no teste) */
  readonly unmatched: string[] = [];
  private valves: {
    node: THREE.Object3D;
    wheel: THREE.Object3D | null;
    rest: THREE.Quaternion;
    axis: THREE.Vector3;
    mat: THREE.MeshStandardMaterial | null;
    get: (e: SimulationEngine) => ValveState;
    directional: boolean;
  }[] = [];
  private pumps: { rotor: THREE.Object3D; rest: THREE.Quaternion; axis: THREE.Vector3; angle: number; get: (e: SimulationEngine) => { speed: number; failed: boolean } }[] = [];
  private spinners: { obj: THREE.Object3D; rest: THREE.Quaternion; axis: THREE.Vector3 }[] = [];
  private clip: THREE.Plane[] | null = null;
  private q = new THREE.Quaternion();

  constructor(source: THREE.Object3D, links: InteriorLinks) {
    this.root = source.clone(true);
    this.root.name = 'SX1I_Corte';
    const valveByName = new Map<string, InteriorLinks['valves']>();
    for (const v of links.valves) valveByName.set(v.name, [...(valveByName.get(v.name) ?? []), v]);
    const pumpByName = new Map(links.pumps.map((p) => [p.name, p]));
    // peças de primeiro nível com dados (extras): cada uma com materiais próprios (filtro/destaque por peça)
    const tops: THREE.Object3D[] = [];
    this.root.traverse((o) => {
      const tipo = o.userData?.tipo as string | undefined;
      if (!tipo) return;
      // as cavernas são filhas do casco resistente no arquivo, mas têm opacidade própria em cada modo
      if (tipo !== 'cavernas') for (let p = o.parent; p; p = p.parent) if (p.userData?.tipo && tops.includes(p)) return;
      tops.push(o);
    });
    for (const node of tops) {
      const tipo = node.userData.tipo as string;
      const mats: THREE.Material[] = [];
      const own = new Map<THREE.Material, THREE.Material>();
      node.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const list = Array.isArray(m.material) ? m.material : [m.material];
        const out = list.map((x) => {
          let c = own.get(x);
          if (!c) {
            c = x.clone();
            c.side = THREE.DoubleSide; // por dentro das peças cortadas
            own.set(x, c);
            mats.push(c);
          }
          return c;
        });
        m.material = Array.isArray(m.material) ? out : out[0];
        m.castShadow = m.receiveShadow = false;
        m.renderOrder = 6; // depois do oceano (como o corte)
      });
      const sistemas = typeof node.userData.sistemas === 'string' ? (node.userData.sistemas as string).split(',').filter(Boolean) : null;
      const part: Part = { node, owners: sistemas, mats, base: 1, piping: false, tipo };
      const pick = (t: unknown) => {
        if (!t) return;
        node.userData.pick = t;
        this.pickables.push(node);
      };
      if (tipo === 'tanque') {
        part.tank = node.userData.id as string;
        part.owners = [part.tank];
        part.base = TANK_OPACITY;
        for (const m of mats) {
          m.transparent = true;
          m.opacity = TANK_OPACITY;
          m.depthWrite = false;
        }
        pick({ kind: 'tank', id: part.tank });
      } else if (tipo === 'valvula') {
        part.piping = true;
        const list = valveByName.get(node.userData.nome as string);
        const link = list?.shift();
        if (!link) this.unmatched.push(String(node.userData.nome));
        else {
          part.owners = link.owners;
          pick(link.pick);
          const wheel = node.getObjectByName(`${node.name}_Volante`) ?? null;
          let mat: THREE.MeshStandardMaterial | null = null;
          if (wheel) {
            // material próprio do volante (a cor é o estado desta válvula)
            const wm = wheel.getObjectByProperty('isMesh', true) as THREE.Mesh | undefined;
            if (wm && wm.material instanceof THREE.MeshStandardMaterial) {
              mat = wm.material.clone();
              mats.push(mat);
              wheel.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).material = mat!) : undefined));
            }
          }
          this.valves.push({
            node,
            wheel,
            rest: wheel?.quaternion.clone() ?? new THREE.Quaternion(),
            axis: blenderAxis(wheel?.userData.eixo_giro as number[] | undefined),
            mat,
            get: link.get,
            directional: link.directional,
          });
        }
      } else if (tipo === 'bomba') {
        part.piping = true;
        const link = pumpByName.get(node.userData.nome as string);
        if (link) {
          part.owners = link.owners;
          pick(link.pick);
          const rotor = node.getObjectByName(`${node.name}_Rotor`);
          if (rotor) this.pumps.push({ rotor, rest: rotor.quaternion.clone(), axis: blenderAxis(rotor.userData.eixo_giro as number[] | undefined), angle: 0, get: link.get });
        }
      } else if (tipo === 'tubo' || tipo === 'abertura') {
        part.piping = true;
      } else if (tipo === 'garrafa') {
        part.piping = true;
        part.owners = ['HP'];
        pick({ kind: 'hp', id: node.userData.grupo });
      } else if (tipo === 'bateria') {
        part.owners = ['__energia'];
        pick({ kind: 'battery', id: 'battery' });
      } else if (tipo === 'gerador') {
        part.owners = ['__energia'];
        pick({ kind: 'generator', id: node.userData.id });
      } else if (['motor', 'eixo', 'mancal_escora', 'mancal_apoio', 'bucim', 'tubo_telescopico'].includes(tipo)) {
        pick({ kind: 'prop', id: 'prop' });
        for (const o of [node, ...node.children]) if (Array.isArray(o.userData?.eixo_giro)) this.spinners.push({ obj: o, rest: o.quaternion.clone(), axis: blenderAxis(o.userData.eixo_giro as number[]) });
      }
      // luz própria (menos nos tanques, que são vidro tingido)
      if (tipo !== 'tanque') for (const m of mats) if (m instanceof THREE.MeshStandardMaterial) m.emissive.copy(m.color).multiplyScalar(SELF_LIGHT);
      this.parts.push(part);
    }
    this.setMode('raiox');
  }

  private mode: CutMode = 'raiox';

  /** Raio-X: casco resistente quase invisível e sem cavernas; meio casco aberto: estrutura à vista, cavernas fracas. */
  setMode(mode: CutMode): void {
    this.mode = mode;
    for (const p of this.parts) {
      const o = structureOpacity(p.tipo, mode);
      if (o !== null) p.base = o;
    }
  }

  get cutMode(): CutMode {
    return this.mode;
  }

  /** Plano do meio casco aberto (o mesmo objeto é lido a cada quadro; null = sem recorte). */
  setClip(plane: THREE.Plane | null): void {
    const c = plane ? [plane] : null;
    if (c === this.clip || (c && this.clip && this.clip[0] === c[0])) return;
    this.clip = c;
    for (const p of this.parts)
      for (const m of p.mats) {
        m.clippingPlanes = c;
        m.needsUpdate = true;
      }
  }

  /** Estado, filtro e destaque (vis do corte), camada de tubulações e passo de tempo (s) para as bombas. */
  update(e: SimulationEngine, vis: InteriorVisibility, pipes: boolean, step: number, filterActive: boolean): void {
    for (const p of this.parts) {
      let visible = true;
      if (p.tank) visible = vis.tankShown(p.tank);
      else if (p.owners?.includes('__energia')) visible = !filterActive;
      else if (p.owners) visible = vis.shown(p.owners);
      if (p.piping && !pipes) visible = false;
      if (p.base <= 0) visible = false; // estrutura escondida no modo
      p.node.visible = visible;
      const dim = !!p.owners && !p.owners.includes('__energia') && vis.dim(p.owners);
      const op = p.base * (dim ? 0.18 : 1);
      for (const m of p.mats) {
        const tr = op < 0.999;
        if (m.transparent !== tr) m.needsUpdate = true;
        m.transparent = tr;
        m.opacity = op;
        m.depthWrite = !tr;
      }
    }
    for (const v of this.valves) {
      const st = v.get(e);
      if (v.mat) {
        const c = v.directional ? 0x3ddc84 : valveColor(st);
        v.mat.color.set(c);
        v.mat.emissive.set(c).multiplyScalar(0.35);
      }
      if (v.wheel) {
        this.q.setFromAxisAngle(v.axis, wheelAngle(st.pos));
        v.wheel.quaternion.copy(v.rest).premultiply(this.q);
      }
    }
    for (const p of this.pumps) {
      const st = p.get(e);
      p.angle += step * st.speed * 25;
      this.q.setFromAxisAngle(p.axis, p.angle);
      p.rotor.quaternion.copy(p.rest).premultiply(this.q);
    }
    // eixo e rotor do motor: mesmo ângulo do hélice (giro em torno do eixo do casco)
    const a = e.state.propulsion.shaftAngle;
    for (const s of this.spinners) {
      this.q.setFromAxisAngle(s.axis, a);
      s.obj.quaternion.copy(s.rest).premultiply(this.q);
    }
  }
}
