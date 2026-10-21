/**
 * MODELOS 3D da sala de comando (geometria procedural): consoles sentados e
 * de pé, bastidores, cadeiras, periscópio, escada da torre, porta estanque,
 * tubulações e dutos, calhas de cabos, luminárias, volantes de válvula,
 * manches, alavanca do telégrafo e alavancas do sopro de emergência.
 * Cores de referência: consoles creme/marfim e cinza, telas com moldura
 * preta, cadeiras azuis, piso de tábuas marrom, teto escuro com dutos
 * aluminizados e tubulações pintadas pelo código de cores dos fluidos.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ceilingTexture, deckTexture, fabricTexture, foilTexture, hullLiningTexture, paintTexture, rackGlowTexture, rackTexture, treadTexture } from './textures';

export class RoomMaterials {
  cream = new THREE.MeshStandardMaterial({ color: 0xffffff, map: paintTexture('#d9d3c0', 3), roughness: 0.55, metalness: 0.08 });
  grey = new THREE.MeshStandardMaterial({ color: 0xffffff, map: paintTexture('#8e959c', 4), roughness: 0.5, metalness: 0.2 });
  darkGrey = new THREE.MeshStandardMaterial({ color: 0xffffff, map: paintTexture('#3b4046', 5), roughness: 0.6, metalness: 0.2 });
  bezel = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.35, metalness: 0.3 });
  desk = new THREE.MeshStandardMaterial({ color: 0x2c3136, roughness: 0.7, metalness: 0.1 });
  panelFace = new THREE.MeshStandardMaterial({ color: 0xffffff, map: paintTexture('#c7c4b6', 6), roughness: 0.6, metalness: 0.05 });
  rack: THREE.MeshStandardMaterial[] = [5, 8, 13].map((sd) => new THREE.MeshStandardMaterial({ color: 0xffffff, map: rackTexture(sd), emissiveMap: rackGlowTexture(sd), emissive: 0xffffff, emissiveIntensity: 1.3, roughness: 0.55, metalness: 0.3 }));
  rackSide = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.6, metalness: 0.3 });
  lining = new THREE.MeshStandardMaterial({ color: 0xffffff, map: hullLiningTexture(), roughness: 0.75, metalness: 0.02, side: THREE.BackSide });
  frame = new THREE.MeshStandardMaterial({ color: 0xb4b8b2, roughness: 0.6, metalness: 0.15 });
  bulkhead = new THREE.MeshStandardMaterial({ color: 0xffffff, map: paintTexture('#bfc2bc', 8, [2, 1]), roughness: 0.65, metalness: 0.1, side: THREE.DoubleSide });
  deck = new THREE.MeshStandardMaterial({ color: 0xffffff, map: deckTexture(), roughness: 0.72, metalness: 0.0 });
  ceiling = new THREE.MeshStandardMaterial({ color: 0xffffff, map: ceilingTexture(), roughness: 0.85, metalness: 0.2, side: THREE.DoubleSide });
  foil = new THREE.MeshStandardMaterial({ color: 0xffffff, map: foilTexture(), roughness: 0.38, metalness: 0.55 });
  tread = new THREE.MeshStandardMaterial({ color: 0xffffff, map: treadTexture(), roughness: 0.6, metalness: 0.5 });
  fabric = new THREE.MeshStandardMaterial({ color: 0xffffff, map: fabricTexture('#2456a6'), roughness: 0.9, metalness: 0 });
  chrome = new THREE.MeshStandardMaterial({ color: 0xc9cdd1, roughness: 0.22, metalness: 0.92 });
  steel = new THREE.MeshStandardMaterial({ color: 0x6d747b, roughness: 0.4, metalness: 0.75 });
  rubber = new THREE.MeshStandardMaterial({ color: 0x121314, roughness: 0.9, metalness: 0 });
  red = new THREE.MeshStandardMaterial({ color: 0xc0221a, roughness: 0.45, metalness: 0.1 });
  yellow = new THREE.MeshStandardMaterial({ color: 0xe2b81c, roughness: 0.5, metalness: 0.1 });
  black = new THREE.MeshStandardMaterial({ color: 0x0d0e0f, roughness: 0.5, metalness: 0.2 });
  well = new THREE.MeshBasicMaterial({ color: 0x050505 });
  diffuser = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 0.4 });
  /** tubulações pelo código de cores dos fluidos */
  pipes: Record<string, THREE.MeshStandardMaterial> = {
    sea: new THREE.MeshStandardMaterial({ color: 0x2f7d50, roughness: 0.45, metalness: 0.25 }),
    air: new THREE.MeshStandardMaterial({ color: 0xdedbd0, roughness: 0.4, metalness: 0.25 }),
    hyd: new THREE.MeshStandardMaterial({ color: 0xc8661a, roughness: 0.45, metalness: 0.25 }),
    fresh: new THREE.MeshStandardMaterial({ color: 0x2c64b8, roughness: 0.45, metalness: 0.25 }),
    fire: new THREE.MeshStandardMaterial({ color: 0xb3261c, roughness: 0.45, metalness: 0.25 }),
    oil: new THREE.MeshStandardMaterial({ color: 0x8a5a24, roughness: 0.45, metalness: 0.25 }),
  };
  cables = [0x1d1f22, 0x3a3d40, 0x7a2f2a, 0x2f4f7a, 0x5b6b3a, 0x8a8a84].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0.05 }));
  /** volante de válvula (cor por sistema) */
  wheel: Record<string, THREE.MeshStandardMaterial> = {
    hp: new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.4, metalness: 0.3 }),
    compensation: new THREE.MeshStandardMaterial({ color: 0x2f9d58, roughness: 0.4, metalness: 0.3 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x2f74c8, roughness: 0.4, metalness: 0.3 }),
    heel: new THREE.MeshStandardMaterial({ color: 0x7b4fc0, roughness: 0.4, metalness: 0.3 }),
  };

  all(): THREE.Material[] {
    return [
      this.cream,
      this.grey,
      this.darkGrey,
      this.bezel,
      this.desk,
      this.panelFace,
      ...this.rack,
      this.rackSide,
      this.lining,
      this.frame,
      this.bulkhead,
      this.deck,
      this.ceiling,
      this.foil,
      this.tread,
      this.fabric,
      this.chrome,
      this.steel,
      this.rubber,
      this.red,
      this.yellow,
      this.black,
      this.well,
      this.diffuser,
      ...Object.values(this.pipes),
      ...this.cables,
      ...Object.values(this.wheel),
    ];
  }
}

export interface Slot {
  /** posição e orientação (local da peça) do centro da tela/face; normal = +z da orientação */
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  w: number;
  h: number;
}

const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  return o;
};
const rbox = (w: number, h: number, d: number, r = 0.02) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));

/** moldura preta atrás de uma tela */
function bezelFor(m: RoomMaterials, s: Slot): THREE.Mesh {
  const b = mesh(rbox(s.w + 0.05, s.h + 0.05, 0.035, 0.012), m.bezel);
  b.position.copy(s.pos).add(new THREE.Vector3(0, 0, -0.018).applyQuaternion(s.quat));
  b.quaternion.copy(s.quat);
  return b;
}

/**
 * Console SENTADO com painel inclinado e N telas lado a lado. Local: frente
 * (lado do operador) para +z; base no piso. Retorna as posições das telas.
 */
export function sitConsole(m: RoomMaterials, w: number, n: number, opts: { body?: THREE.Material; tall?: boolean } = {}): { group: THREE.Group; slots: Slot[]; deskY: number } {
  const g = new THREE.Group();
  const body = opts.body ?? m.cream;
  g.add(mesh(rbox(w, 0.7, 0.62, 0.03), body, 0, 0.35, -0.33));
  g.add(mesh(new THREE.BoxGeometry(w - 0.06, 0.08, 0.04), m.black, 0, 0.04, -0.02));
  const deskY = 0.74;
  g.add(mesh(rbox(w + 0.04, 0.045, 0.42, 0.015), m.desk, 0, deskY, -0.03));
  // painel inclinado
  const tilt = (16 * Math.PI) / 180;
  const ph = opts.tall ? 0.78 : 0.62;
  const pan = new THREE.Group();
  pan.position.set(0, deskY + 0.03, -0.22);
  pan.rotation.x = -tilt;
  pan.add(mesh(rbox(w, ph, 0.1, 0.025), body, 0, ph / 2, -0.05));
  pan.add(mesh(rbox(w + 0.02, 0.07, 0.34, 0.02), body, 0, ph + 0.02, -0.13));
  g.add(pan);
  const slots: Slot[] = [];
  const gap = 0.05;
  const sw = Math.min(0.62, (w - 0.12 - (n - 1) * gap) / n);
  const sh = Math.min(ph - 0.1, sw / 1.5);
  const total = n * sw + (n - 1) * gap;
  pan.updateMatrix();
  for (let i = 0; i < n; i++) {
    const lx = -total / 2 + sw / 2 + i * (sw + gap);
    const p = new THREE.Vector3(lx, ph / 2 + 0.02, 0.006).applyMatrix4(pan.matrix);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, 0, 0));
    const s = { pos: p, quat: q, w: sw, h: sh };
    slots.push(s);
    g.add(bezelFor(m, s));
  }
  return { group: g, slots, deskY };
}

/**
 * Console VERTICAL com duas telas empilhadas (consoles multifunção do sistema
 * de combate, como na foto de referência), mesa com teclado e trackball.
 */
export function stackConsole(m: RoomMaterials, w: number): { group: THREE.Group; slots: Slot[] } {
  const g = new THREE.Group();
  g.add(mesh(rbox(w, 0.72, 0.56, 0.03), m.cream, 0, 0.36, -0.36));
  g.add(mesh(new THREE.BoxGeometry(w - 0.06, 0.08, 0.04), m.black, 0, 0.04, -0.06));
  g.add(mesh(rbox(w + 0.02, 0.045, 0.44, 0.015), m.cream, 0, 0.745, -0.08));
  g.add(mesh(rbox(w * 0.55, 0.025, 0.17, 0.008), m.black, -0.04, 0.78, 0.0));
  g.add(mesh(new THREE.SphereGeometry(0.03, 16, 10), m.steel, w * 0.33, 0.785, 0.02));
  const tilt = (7 * Math.PI) / 180;
  const pan = new THREE.Group();
  pan.position.set(0, 0.77, -0.3);
  pan.rotation.x = -tilt;
  const ph = 1.18;
  pan.add(mesh(rbox(w, ph, 0.12, 0.025), m.cream, 0, ph / 2, -0.06));
  pan.add(mesh(rbox(w + 0.02, 0.06, 0.3, 0.02), m.cream, 0, ph + 0.02, -0.1));
  g.add(pan);
  pan.updateMatrix();
  const sw = Math.min(0.6, w - 0.12);
  const sh = sw / 1.5;
  const slots: Slot[] = [];
  for (const ly of [ph - 0.06 - sh / 2, ph - 0.06 - sh - 0.06 - sh / 2]) {
    const p = new THREE.Vector3(0, ly, 0.006).applyMatrix4(pan.matrix);
    const s = { pos: p, quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, 0, 0)), w: sw, h: sh };
    slots.push(s);
    g.add(bezelFor(m, s));
  }
  return { group: g, slots };
}

/** painel DE PÉ (face vertical com leve inclinação), base no piso, face para +z */
export function standPanel(m: RoomMaterials, w: number, h: number, y0: number, opts: { depth?: number; shelf?: boolean } = {}): { group: THREE.Group; slot: Slot } {
  const g = new THREE.Group();
  const d = opts.depth ?? 0.45;
  g.add(mesh(rbox(w + 0.06, y0 + h + 0.12, d, 0.03), m.grey, 0, (y0 + h + 0.12) / 2, -d / 2 - 0.02));
  g.add(mesh(new THREE.BoxGeometry(w, 0.1, 0.04), m.black, 0, 0.05, 0.0));
  if (opts.shelf) g.add(mesh(rbox(w + 0.04, 0.04, 0.2, 0.012), m.desk, 0, y0 - 0.06, 0.08));
  const slot: Slot = { pos: new THREE.Vector3(0, y0 + h / 2, 0.004), quat: new THREE.Quaternion(), w, h };
  return { group: g, slot };
}

/** bastidor eletrônico (frente com LEDs) */
export function rack(m: RoomMaterials, w: number, h: number, d: number, variant = 0): THREE.Mesh {
  const front = m.rack[variant % m.rack.length];
  const mats = [m.rackSide, m.rackSide, m.rackSide, m.rackSide, front, m.rackSide];
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
  o.position.set(0, h / 2, -d / 2);
  return o;
}

/** cadeira giratória com estofado azul (frente para −z local) */
export function seat(m: RoomMaterials): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.04, 20), m.darkGrey, 0, 0.02, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 10), m.chrome, 0, 0.25, 0));
  g.add(mesh(rbox(0.5, 0.11, 0.48, 0.05), m.fabric, 0, 0.5, 0));
  const back = new THREE.Group();
  back.position.set(0, 0.55, 0.24);
  back.rotation.x = 0.12;
  back.add(mesh(rbox(0.47, 0.58, 0.08, 0.04), m.fabric, 0, 0.32, 0));
  back.add(mesh(rbox(0.3, 0.16, 0.08, 0.04), m.fabric, 0, 0.74, 0.0));
  g.add(back);
  for (const sx of [-0.27, 0.27]) {
    g.add(mesh(new THREE.BoxGeometry(0.04, 0.18, 0.04), m.darkGrey, sx, 0.62, 0.05));
    g.add(mesh(rbox(0.06, 0.04, 0.34, 0.015), m.rubber, sx, 0.72, 0.0));
  }
  return g;
}

/** periscópio: tubo, caixa da ocular com punhos e poço no piso. As peças móveis são animadas pela cena. */
export function periscope(m: RoomMaterials, top: number): { group: THREE.Group; head: THREE.Group; handles: THREE.Object3D[]; tube: THREE.Mesh } {
  const g = new THREE.Group();
  // poço e anel no piso
  g.add(mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 28), m.well, 0, 0.005, 0));
  g.add(mesh(new THREE.TorusGeometry(0.25, 0.025, 8, 28), m.steel, 0, 0.012, 0).rotateX(Math.PI / 2));
  // anel de vedação no teto
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.14, 24), m.steel, 0, top - 0.07, 0));
  const head = new THREE.Group();
  const tube = mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 24), m.chrome);
  head.add(mesh(rbox(0.34, 0.36, 0.3, 0.05), m.darkGrey, 0, 0, 0));
  // ocular (lado do operador: +z local) e lentes
  head.add(mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 18), m.rubber, 0, 0.04, 0.2).rotateX(Math.PI / 2));
  head.add(mesh(rbox(0.12, 0.1, 0.06, 0.02), m.black, 0.12, -0.08, 0.16));
  head.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 12), m.red, -0.13, -0.1, 0.15).rotateX(Math.PI / 2));
  // punhos de treino (abrem quando içado)
  const handles: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const pv = new THREE.Group();
    pv.position.set(sx * 0.17, 0, 0.05);
    const arm = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.32, 10), m.rubber, sx * 0.16, 0, 0);
    arm.rotation.z = Math.PI / 2;
    pv.add(arm);
    pv.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 12), m.rubber, sx * 0.3, 0, 0).rotateZ(Math.PI / 2));
    head.add(pv);
    handles.push(pv);
  }
  g.add(head, tube);
  return { group: g, head, handles, tube };
}

/** escada vertical para a torre (passadiço) com o tronco de acesso no teto */
export function ladder(m: RoomMaterials, top: number): THREE.Group {
  const g = new THREE.Group();
  for (const sx of [-0.2, 0.2]) g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, top, 10), m.steel, sx, top / 2, 0));
  for (let y = 0.3; y < top - 0.1; y += 0.3) g.add(mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.4, 8), m.steel, 0, y, 0).rotateZ(Math.PI / 2));
  g.add(mesh(new THREE.TorusGeometry(0.36, 0.05, 10, 32), m.steel, 0, top - 0.02, -0.15).rotateX(Math.PI / 2));
  g.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.02, 32), m.well, 0, top + 0.01, -0.15));
  return g;
}

/** volante de válvula manual */
export function handwheel(m: RoomMaterials, r: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.13, 10, 28), mat));
  for (let k = 0; k < 3; k++) {
    const sp = mesh(new THREE.BoxGeometry(r * 2, r * 0.12, r * 0.1), mat);
    sp.rotation.z = (k * Math.PI) / 3;
    g.add(sp);
  }
  g.add(mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.22, r * 0.4, 14), m.steel).rotateX(Math.PI / 2));
  // haste até o painel
  g.add(mesh(new THREE.CylinderGeometry(r * 0.1, r * 0.1, 0.12, 10), m.steel, 0, 0, -0.07).rotateX(Math.PI / 2));
  return g;
}

/**
 * Manche estilo aeronave: coluna que avança/recua (lemes horizontais) e
 * volante que gira (leme de direção). `column` desliza em z; `wheel` gira em z.
 */
export function yoke(m: RoomMaterials): { group: THREE.Group; column: THREE.Group; wheel: THREE.Group } {
  const g = new THREE.Group();
  g.add(mesh(rbox(0.22, 0.12, 0.26, 0.03), m.darkGrey, 0, 0.0, -0.12));
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.04, 16), m.rubber, 0, 0.06, 0.0).rotateX(Math.PI / 2));
  const column = new THREE.Group();
  column.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.36, 12), m.chrome, 0, 0.06, 0.12).rotateX(Math.PI / 2));
  const wheel = new THREE.Group();
  wheel.position.set(0, 0.06, 0.3);
  wheel.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 16), m.darkGrey).rotateX(Math.PI / 2));
  wheel.add(mesh(rbox(0.36, 0.045, 0.045, 0.015), m.darkGrey, 0, 0, 0));
  for (const sx of [-1, 1]) {
    wheel.add(mesh(rbox(0.045, 0.16, 0.05, 0.02), m.rubber, sx * 0.19, 0.05, 0));
    wheel.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 8), m.red, sx * 0.19, 0.14, 0.0));
  }
  column.add(wheel);
  g.add(column);
  return { group: g, column, wheel };
}

/** alavanca do telégrafo de máquinas sobre um quadrante (gira em x) */
export function telegraphLever(m: RoomMaterials): { group: THREE.Group; lever: THREE.Group } {
  const g = new THREE.Group();
  const quad = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 28, 1, false, -Math.PI / 2, Math.PI), m.darkGrey);
  quad.rotation.z = Math.PI / 2;
  quad.position.y = 0.0;
  g.add(quad);
  g.add(mesh(new THREE.BoxGeometry(0.1, 0.05, 0.34), m.black, 0, -0.02, 0));
  const lever = new THREE.Group();
  lever.add(mesh(new THREE.BoxGeometry(0.03, 0.22, 0.03), m.chrome, 0, 0.11, 0));
  lever.add(mesh(new THREE.SphereGeometry(0.035, 14, 10), m.red, 0, 0.23, 0));
  g.add(lever);
  return { group: g, lever };
}

/** alavanca do sopro de emergência (punho em T) com tampa de proteção articulada */
export function emergencyHandle(m: RoomMaterials): { group: THREE.Group; handle: THREE.Group; guard: THREE.Group } {
  const g = new THREE.Group();
  g.add(mesh(rbox(0.1, 0.15, 0.04, 0.012), m.black, 0, 0, 0.0));
  const handle = new THREE.Group();
  handle.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 10), m.chrome, 0, 0, 0.045).rotateX(Math.PI / 2));
  handle.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.075, 12), m.red, 0, 0, 0.095).rotateZ(Math.PI / 2));
  g.add(handle);
  const guard = new THREE.Group();
  guard.position.set(0, 0.075, 0.02);
  const cover = mesh(rbox(0.1, 0.15, 0.12, 0.015), new THREE.MeshStandardMaterial({ color: 0xf0c419, transparent: true, opacity: 0.45, roughness: 0.3, metalness: 0.1 }), 0, -0.075, 0.05);
  guard.add(cover);
  g.add(guard);
  return { group: g, handle, guard };
}

/** porta estanque oval (fechada) com volante central e trincos */
export function wtDoor(m: RoomMaterials): THREE.Group {
  const g = new THREE.Group();
  const outer = new THREE.Shape();
  outer.absellipse(0, 0, 0.5, 0.85, 0, Math.PI * 2, false, 0);
  const hole = new THREE.Path();
  hole.absellipse(0, 0, 0.36, 0.7, 0, Math.PI * 2, true, 0);
  outer.holes.push(hole);
  const ring = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.08, bevelEnabled: false, curveSegments: 32 }), m.grey);
  g.add(ring);
  const leafShape = new THREE.Shape();
  leafShape.absellipse(0, 0, 0.4, 0.74, 0, Math.PI * 2, false, 0);
  const leaf = new THREE.Mesh(new THREE.ExtrudeGeometry(leafShape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, curveSegments: 32 }), m.grey);
  leaf.position.z = 0.08;
  g.add(leaf);
  const hw = handwheel(m, 0.13, m.steel);
  hw.position.set(0, 0, 0.2);
  g.add(hw);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.04, 0.05), m.steel, Math.cos(a) * 0.42, Math.sin(a) * 0.76, 0.12));
  }
  return g;
}

/** trecho reto de tubulação ao longo de z, com anéis de identificação */
export function pipeRun(m: THREE.Material, band: THREE.Material, r: number, z0: number, z1: number): THREE.Group {
  const g = new THREE.Group();
  const L = z1 - z0;
  g.add(mesh(new THREE.CylinderGeometry(r, r, L, 14), m, 0, 0, (z0 + z1) / 2).rotateX(Math.PI / 2));
  for (let z = z0 + 0.8; z < z1 - 0.3; z += 2.2) g.add(mesh(new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.1, 14), band, 0, 0, z).rotateX(Math.PI / 2));
  for (let z = z0 + 0.5; z < z1; z += 1.6) g.add(mesh(new THREE.TorusGeometry(r * 1.15, r * 0.18, 6, 14), band, 0, 0, z));
  return g;
}

/** calha de cabos com feixe de cabos coloridos */
export function cableTray(m: RoomMaterials, w: number, z0: number, z1: number): THREE.Group {
  const g = new THREE.Group();
  const L = z1 - z0;
  g.add(mesh(new THREE.BoxGeometry(w, 0.012, L), m.steel, 0, 0, (z0 + z1) / 2));
  for (const sx of [-w / 2, w / 2]) g.add(mesh(new THREE.BoxGeometry(0.012, 0.06, L), m.steel, sx, 0.03, (z0 + z1) / 2));
  const n = Math.floor(w / 0.035);
  for (let i = 0; i < n; i++) {
    const c = mesh(new THREE.CylinderGeometry(0.014, 0.014, L, 6), m.cables[i % m.cables.length], -w / 2 + 0.03 + i * 0.033, 0.022 + (i % 2) * 0.016, (z0 + z1) / 2);
    c.rotation.x = Math.PI / 2;
    g.add(c);
  }
  return g;
}

/** luminária fluorescente (difusor emissivo) */
export function lightFixture(m: RoomMaterials, len: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.2, 0.06, len), m.grey, 0, 0.03, 0));
  g.add(mesh(new THREE.BoxGeometry(0.16, 0.012, len - 0.04), m.diffuser, 0, -0.002, 0));
  return g;
}

/** extintor de incêndio */
export function extinguisher(m: RoomMaterials): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 16), m.red, 0, 0.25, 0));
  g.add(mesh(new THREE.SphereGeometry(0.08, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.red, 0, 0.5, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 8), m.black, 0, 0.6, 0));
  g.add(mesh(new THREE.BoxGeometry(0.12, 0.02, 0.03), m.black, 0.03, 0.64, 0));
  return g;
}

/** telefone de bordo (fone no gancho) */
export function phone(m: RoomMaterials): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(rbox(0.12, 0.05, 0.16, 0.015), m.black, 0, 0.025, 0));
  g.add(mesh(rbox(0.05, 0.04, 0.2, 0.015), m.black, 0, 0.07, 0));
  return g;
}

export const geomUtil = { mesh, rbox };
