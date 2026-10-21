/**
 * NAVIOS DA MESA TÁTICA NO 3D — cada contato fictício do quadro tático vira
 * um navio no mar, na mesma posição geográfica, com o mesmo rumo e a mesma
 * velocidade (src/sim/geo.ts → contactsLocal). Modelos leves (caixas e
 * cascos extrudados), um por tipo, montados por funções separadas para
 * poderem ser trocados depois por modelos melhores (ex.: glTF).
 *
 * Apenas visual: os navios não colidem nem interagem com a física.
 */
import * as THREE from 'three';
import type { SimulationEngine } from '../sim/core/engine';
import { contactsLocal, NM, type Contact, type LatLon } from '../sim/geo';
import type { Label3D } from './SubmarineScene';

export type ShipModel = 'graneleiro' | 'conteineiro' | 'pesqueiro' | 'rebocador' | 'patrulha';

/** tipo do contato → modelo 3D (o nome distingue graneleiro × porta-contêineres) */
export function modelFor(c: Pick<Contact, 'kind' | 'name'>): ShipModel {
  if (c.kind === 'mercante') return /cont[eê]iner/i.test(c.name) ? 'conteineiro' : 'graneleiro';
  return c.kind;
}

interface ShipSpec {
  L: number; // comprimento (m)
  B: number; // boca (m)
  draft: number; // calado (m)
  free: number; // borda livre (m)
  hull: number; // cor do costado
  deck: number;
}

export const SHIP_SPECS: Record<ShipModel, ShipSpec> = {
  graneleiro: { L: 190, B: 32, draft: 11, free: 7, hull: 0x7a2a22, deck: 0x6c6f62 },
  conteineiro: { L: 260, B: 32, draft: 12, free: 8, hull: 0x1f3a5c, deck: 0x55595c },
  pesqueiro: { L: 24, B: 7, draft: 2.6, free: 2.2, hull: 0x2f6b8f, deck: 0x8a6f4a },
  rebocador: { L: 30, B: 10, draft: 4, free: 2.6, hull: 0x1e1e1e, deck: 0x7b4a2a },
  patrulha: { L: 55, B: 9, draft: 3, free: 3.5, hull: 0x7c858e, deck: 0x6b737a },
};

const mats = new Map<number, THREE.MeshStandardMaterial>();
const mat = (c: number, rough = 0.7, metal = 0.15) => {
  const k = c * 10 + Math.round(rough * 10);
  let m = mats.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
    mats.set(k, m);
  }
  return m;
};

/** Casco: planta com proa afilada e popa arredondada, extrudada na vertical (y = 0 na linha d'água). Frente = −z. */
function hullMesh(s: ShipSpec): THREE.Group {
  const g = new THREE.Group();
  const L = s.L;
  const b = s.B / 2;
  const sh = new THREE.Shape();
  // planta no plano (x = boca, y = comprimento; +y = proa)
  sh.moveTo(-b * 0.8, -L / 2);
  sh.quadraticCurveTo(-b, -L / 2, -b, -L / 2 + b * 0.6);
  sh.lineTo(-b, L * 0.22);
  sh.quadraticCurveTo(-b, L * 0.42, 0, L / 2);
  sh.quadraticCurveTo(b, L * 0.42, b, L * 0.22);
  sh.lineTo(b, -L / 2 + b * 0.6);
  sh.quadraticCurveTo(b, -L / 2, b * 0.8, -L / 2);
  sh.closePath();
  const H = s.draft + s.free;
  const geo = new THREE.ExtrudeGeometry(sh, { depth: H, bevelEnabled: false, curveSegments: 10 });
  // (x, y, z=altura) → (x, altura, −y): proa para −z
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -s.draft, 0);
  const hull = new THREE.Mesh(geo, [mat(s.deck, 0.85), mat(s.hull, 0.6)]);
  g.add(hull);
  // faixa de linha d'água (antiincrustante vermelho logo acima da água)
  const boot = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.8, bevelEnabled: false, curveSegments: 10 }), mat(0x8e1b16, 0.6));
  boot.geometry.rotateX(-Math.PI / 2);
  boot.geometry.translate(0, -0.3, 0);
  boot.scale.set(1.004, 1, 1.002);
  g.add(boot);
  return g;
}

function box(w: number, h: number, l: number, c: number, x: number, y: number, z: number, rough = 0.7): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat(c, rough));
  m.position.set(x, y + h / 2, z);
  return m;
}

/** Superestrutura com passadiço (janelas escuras), em z (+ = ré). */
function bridge(w: number, h: number, l: number, z: number, deckY: number, c = 0xe8e8e2): THREE.Group {
  const g = new THREE.Group();
  g.add(box(w, h, l, c, 0, deckY, z));
  g.add(box(w * 1.12, 2.2, l * 0.6, c, 0, deckY + h, z - l * 0.2));
  g.add(box(w * 1.13, 0.9, l * 0.61, 0x1a2430, 0, deckY + h + 0.9, z - l * 0.2, 0.2));
  return g;
}

/** Modelos por tipo. Substituíveis: basta devolver outro Object3D com a proa em −z e a linha d'água em y = 0. */
export function buildShip(model: ShipModel): THREE.Group {
  const s = SHIP_SPECS[model];
  const g = hullMesh(s);
  const L = s.L;
  const dk = s.free; // altura do convés
  switch (model) {
    case 'graneleiro': {
      for (let i = 0; i < 7; i++) g.add(box(s.B * 0.62, 1.4, 16, 0x5d4a3a, 0, dk, -L * 0.36 + i * 22));
      g.add(bridge(s.B * 0.8, 12, 18, L * 0.38, dk));
      g.add(box(4, 9, 5, 0x222222, 0, dk + 12, L * 0.44));
      for (const z of [-L * 0.28, -L * 0.06, L * 0.16]) g.add(box(1, 14, 1, 0xd9c26a, s.B * 0.36, dk, z));
      break;
    }
    case 'conteineiro': {
      const cols = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd68910, 0x7d3c98, 0xbfc9ca, 0x1f618d];
      let k = 0;
      for (let z = -L * 0.4; z < L * 0.28; z += 13) {
        const tiers = 3 + ((k * 7) % 3);
        for (let tier = 0; tier < tiers; tier++) g.add(box(s.B * 0.86, 2.55, 12.2, cols[(k + tier * 3) % cols.length], 0, dk + tier * 2.6, z, 0.8));
        k++;
      }
      g.add(bridge(s.B * 0.9, 16, 14, L * 0.36, dk));
      g.add(box(5, 8, 6, 0x2b2b2b, 0, dk + 16, L * 0.42));
      break;
    }
    case 'pesqueiro': {
      g.add(bridge(4.2, 2.6, 5, -L * 0.18, dk, 0xf2f2f2));
      g.add(box(0.25, 8, 0.25, 0xcfcfcf, 0, dk, L * 0.05));
      const boom = box(0.18, 0.18, 9, 0xcfcfcf, 0, dk + 6.5, L * 0.22);
      boom.rotation.x = -0.35;
      g.add(boom);
      g.add(box(3.5, 1.2, 4, 0x9b6b3a, 0, dk, L * 0.3));
      break;
    }
    case 'rebocador': {
      g.add(bridge(6.4, 4.5, 9, -L * 0.12, dk, 0xf0f0f0));
      g.add(box(1.4, 6, 1.4, 0xd35400, 2.2, dk + 4.5, -L * 0.02));
      g.add(box(1.4, 6, 1.4, 0xd35400, -2.2, dk + 4.5, -L * 0.02));
      g.add(box(4, 1.4, 3, 0x333333, 0, dk, L * 0.28));
      break;
    }
    case 'patrulha': {
      g.add(box(s.B * 0.7, 4, 16, 0x8c959e, 0, dk, -L * 0.02));
      g.add(bridge(s.B * 0.62, 2.6, 8, -L * 0.1, dk + 4, 0x9aa3ab));
      g.add(box(0.5, 10, 0.5, 0x5f6870, 0, dk + 4, L * 0.02));
      const gun = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 1.2, 12), mat(0x7a838c));
      gun.position.set(0, dk + 0.6, -L * 0.32);
      g.add(gun);
      g.add(box(0.3, 0.3, 3.6, 0x4d555c, 0, dk + 0.9, -L * 0.32 - 1.8));
      break;
    }
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = false));
  return g;
}

function wakeTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, 'rgba(255,255,255,0.85)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(26, 0);
  g.lineTo(38, 0);
  g.lineTo(64, 256);
  g.lineTo(0, 256);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface ShipObj {
  id: string;
  model: ShipModel;
  group: THREE.Group;
  wake: THREE.Mesh;
}

export interface NearestShip {
  id: string;
  name: string;
  /** posição Three (relativa à origem flutuante) e comprimento */
  pos: THREE.Vector3;
  length: number;
  dist: number;
}

export class ShipsLayer {
  readonly group = new THREE.Group();
  private ships = new Map<string, ShipObj>();
  private wakeMat: THREE.MeshBasicMaterial;
  /** navio visível mais próximo (para a câmera “Navio”) */
  nearest: NearestShip | null = null;

  constructor() {
    this.wakeMat = new THREE.MeshBasicMaterial({ map: wakeTexture() ?? undefined, transparent: true, depthWrite: false, opacity: 0.6, toneMapped: false });
  }

  private get(c: Contact): ShipObj {
    let s = this.ships.get(c.id);
    // o mesmo id pode passar a ser outro tipo de navio (tráfego adicional sorteado de novo ao mudar a
    // origem ou o fundo): refaz o modelo; materiais são compartilhados, só as geometrias são descartadas
    if (s && s.model !== modelFor(c)) {
      s.group.removeFromParent();
      s.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.ships.delete(c.id);
      s = undefined;
    }
    if (!s) {
      const model = modelFor(c);
      const group = buildShip(model);
      const sp = SHIP_SPECS[model];
      const wake = new THREE.Mesh(new THREE.PlaneGeometry(sp.B * 1.4, sp.L * 1.6), this.wakeMat);
      wake.rotation.x = -Math.PI / 2;
      wake.position.set(0, 0.15, sp.L / 2 + sp.L * 0.8);
      wake.renderOrder = 2;
      group.add(wake);
      group.userData.length = sp.L;
      this.group.add(group);
      s = { id: c.id, model, group, wake };
      this.ships.set(c.id, s);
    }
    return s;
  }

  update(
    e: SimulationEngine,
    pn: number,
    pe: number,
    tWave: number,
    origin: LatLon,
    rangeKm: number,
    enabled: boolean,
    labels: Label3D[] | null,
    proj: (v: THREE.Vector3) => { x: number; y: number; visible: boolean },
    extra: Contact[] = [],
  ): void {
    this.group.visible = enabled;
    this.nearest = null;
    if (!enabled) return;
    const w = e.env.waves;
    const range = rangeKm * 1000;
    let best: NearestShip | null = null;
    // navios que saíram da lista (tráfego reduzido) não ficam parados no mar
    for (const s of this.ships.values()) s.group.visible = false;
    for (const c of [...contactsLocal(e.state.t, origin), ...extra]) {
      const dn = c.n - pn;
      const de = c.e - pe;
      const dist = Math.hypot(dn, de);
      const s = this.get(c);
      s.group.visible = dist < range;
      if (!s.group.visible) continue;
      const sp = SHIP_SPECS[s.model];
      // navios grandes jogam menos com as ondas
      const heave = w.active ? w.elevation(c.n, c.e, tWave) * (sp.L > 100 ? 0.35 : 0.85) : 0;
      s.group.position.set(de, heave, -dn);
      s.group.rotation.set(0, (-c.course * Math.PI) / 180, 0);
      if (w.active && sp.L < 100) {
        // arfagem/balanço leves dos navios pequenos (só visual)
        s.group.rotation.x = 0.03 * Math.sin(tWave * 0.9 + c.e * 0.01);
        s.group.rotation.z = 0.04 * Math.sin(tWave * 0.7 + c.n * 0.01);
      }
      s.wake.visible = c.speed > 0.3;
      s.wake.scale.set(1, Math.min(1.6, 0.4 + c.speed / 6), 1);
      const p = s.group.position.clone();
      if (!best || dist < best.dist) best = { id: c.id, name: c.name, pos: p, length: sp.L, dist };
      if (labels) {
        const top = p.clone().add(new THREE.Vector3(0, sp.free + (sp.L > 100 ? 26 : 12), 0));
        labels.push({
          id: 'ship' + c.id,
          text: `${c.id} · ${c.name}`,
          sub: `${(dist / NM).toFixed(1)} mn · rumo ${c.course.toFixed(0)}° · ${(c.speed / 0.5144).toFixed(0)} nós`,
          color: c.kind === 'patrulha' ? '#49a7ff' : '#4cd964',
          small: true,
          prio: 2,
          ...proj(top),
        });
      }
    }
    this.nearest = best;
  }
}
