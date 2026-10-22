/**
 * LUZES DO SUBMARINO E DOS NAVIOS (só visual).
 *
 * Luzes de navegação pelo RIPEAM (COLREG), na superfície:
 *  - mastro: branca, 225° para vante (até 22,5° por ante a ré do través);
 *  - bordos: encarnada a BB e verde a BE, 112,5° cada a partir da proa;
 *  - alcançado: branca, 135° pela popa;
 *  - submarino: também a luz amarela de lampejos rápidos (~90 por minuto),
 *    visível em todo o horizonte, que identifica submarinos na superfície.
 * Cada luz só aparece de dentro do seu setor (como a bordo), com um brilho
 * de tamanho constante na tela para ser vista de longe.
 *
 * Faróis do submarino (submerso): dois holofotes de proa, uma luz sob o casco
 * (ilumina o fundo) e uma luz suave sobre o casco; debaixo d'água os feixes
 * aparecem na água (espalhamento).
 *
 * Referencial local (o mesmo do submarino e dos navios na cena): x = boreste,
 * y = cima, z = ré (a proa aponta para −z).
 */
import * as THREE from 'three';

export type NavKind = 'mastro' | 'bb' | 'be' | 'popa' | 'amarela';

export interface NavLightDef {
  kind: NavKind;
  pos: [number, number, number];
}

const COLORS: Record<NavKind, number> = { mastro: 0xfff6e8, bb: 0xff2a1a, be: 0x22ff6a, popa: 0xfff6e8, amarela: 0xffb000 };

/** limites do setor de cada luz: marcação relativa (graus, 0 = proa, + = boreste) de onde ela é vista */
export function sectorVisible(kind: NavKind, rel: number): number {
  const a = Math.abs(rel);
  // transição suave de ~2° nos limites
  const edge = (lim: number, x: number) => Math.max(0, Math.min(1, (lim - x) / 2 + 0.5));
  switch (kind) {
    case 'mastro':
      return edge(112.5, a);
    case 'popa':
      return edge(a, 112.5);
    case 'be':
      return Math.min(edge(112.5, rel), edge(rel, -1));
    case 'bb':
      return Math.min(edge(112.5, -rel), edge(-rel, -1));
    case 'amarela':
      return 1;
  }
}

/** marcação relativa (graus) de um ponto visto a partir de outro, no referencial local */
export function relBearing(from: THREE.Vector3 | [number, number, number], to: THREE.Vector3): number {
  const fx = Array.isArray(from) ? from[0] : from.x;
  const fz = Array.isArray(from) ? from[2] : from.z;
  return (Math.atan2(to.x - fx, -(to.z - fz)) * 180) / Math.PI;
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture | null {
  if (glowTex || typeof document === 'undefined') return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

interface Item {
  def: NavLightDef;
  lamp: THREE.Mesh;
  glow: THREE.Sprite;
  mat: THREE.SpriteMaterial;
}

/** conjunto de luzes de navegação preso a um objeto (submarino ou navio) */
export class NavLights {
  readonly group = new THREE.Group();
  private items: Item[] = [];
  private v = new THREE.Vector3();

  /** size: tamanho do brilho na tela (rad); lamp: raio da lâmpada (m) */
  constructor(defs: NavLightDef[], size = 0.011, lamp = 0.22) {
    this.group.name = 'Luzes de navegação';
    const geo = new THREE.SphereGeometry(lamp, 10, 8);
    for (const def of defs) {
      const color = COLORS[def.kind];
      const lampM = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, toneMapped: false, fog: false }));
      lampM.position.set(...def.pos);
      const mat = new THREE.SpriteMaterial({ map: glowTexture() ?? undefined, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, sizeAttenuation: false });
      const glow = new THREE.Sprite(mat);
      glow.scale.setScalar(def.kind === 'amarela' ? size * 1.15 : size);
      glow.position.set(...def.pos);
      glow.renderOrder = 6;
      this.group.add(lampM, glow);
      this.items.push({ def, lamp: lampM, glow, mat });
    }
    this.group.visible = false;
  }

  /**
   * on: luzes acesas; camLocal: posição da câmera no referencial do objeto;
   * time: relógio (s) para os lampejos; lit(i): a luz i está fora d'água
   */
  update(on: boolean, camLocal: THREE.Vector3, time: number, lit: (pos: THREE.Vector3) => boolean = () => true): void {
    this.group.visible = on;
    if (!on) return;
    // lampejos rápidos: 90 por minuto (1,5 Hz), aceso 40 % do ciclo
    const flash = (time * 1.5) % 1 < 0.4 ? 1 : 0;
    for (const it of this.items) {
      this.v.set(...it.def.pos);
      const out = lit(this.v);
      const k = (it.def.kind === 'amarela' ? flash : 1) * sectorVisible(it.def.kind, relBearing(it.def.pos, camLocal));
      it.glow.visible = out && k > 0.01;
      it.mat.opacity = k;
      it.lamp.visible = out && (it.def.kind !== 'amarela' || flash > 0);
    }
  }

  dispose(): void {
    for (const it of this.items) {
      (it.lamp.material as THREE.Material).dispose();
      it.mat.dispose();
    }
    this.items[0]?.lamp.geometry.dispose();
  }
}

/** luzes de navegação de um submarino a partir das medidas do casco e da vela (corpo: x avante) */
export function submarineNavLights(L: number, R: number, sail: { xFwd: number; xAft: number; width: number; height: number }): NavLightDef[] {
  const top = R + sail.height;
  const w = sail.width / 2 + 0.06;
  return [
    { kind: 'mastro', pos: [0, top + 1.5, -(sail.xFwd - 1.2)] },
    { kind: 'bb', pos: [-w, top - 0.9, -(sail.xFwd - 1.6)] },
    { kind: 'be', pos: [w, top - 0.9, -(sail.xFwd - 1.6)] },
    { kind: 'amarela', pos: [0, top + 0.9, -(sail.xAft + 1.4)] },
    { kind: 'popa', pos: [0, R * 0.8 + 0.5, L / 2 - 7] },
  ];
}

/** luzes de navegação de um navio (L, boca, borda livre); proa em −z, linha d'água em y = 0 */
export function shipNavLights(L: number, B: number, free: number): NavLightDef[] {
  const big = L > 100;
  const mast = big ? 30 : L > 40 ? 12 : 7;
  const bridgeZ = big ? L * 0.36 : -L * 0.1;
  const sideY = free + (big ? 14 : 3.5);
  const defs: NavLightDef[] = [
    { kind: 'mastro', pos: [0, free + mast, big ? -L * 0.3 : -L * 0.05] },
    { kind: 'bb', pos: [-(B * 0.5 + 0.4), sideY, bridgeZ] },
    { kind: 'be', pos: [B * 0.5 + 0.4, sideY, bridgeZ] },
    { kind: 'popa', pos: [0, free + 1.5, L / 2 - 1] },
  ];
  // navios com 50 m ou mais: segunda luz de mastro, a ré e mais alta
  if (L >= 50) defs.push({ kind: 'mastro', pos: [0, free + mast + 6, big ? L * 0.4 : L * 0.15] });
  return defs;
}

// ------------------------------------------------------------------ faróis

const BEAM_VS = /* glsl */ `
varying float vZ;
varying vec3 vN;
varying vec3 vV;
void main() {
  vZ = position.z;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uLen;
uniform float uK;
varying float vZ;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = clamp(vZ / uLen, 0.0, 1.0);
  float along = pow(1.0 - f, 1.7) * smoothstep(0.0, 0.04, f);
  float face = pow(abs(dot(normalize(vN), normalize(vV))), 1.3);
  gl_FragColor = vec4(uColor * along * face * uK, 1.0);
}`;

interface Beam {
  light: THREE.SpotLight;
  cone: THREE.Mesh;
  lamp: THREE.Mesh;
}

/**
 * Faróis do submarino: holofotes de proa (para vante e um pouco para baixo),
 * luz sob o casco (para o fundo) e luz suave sobre o casco.
 */
export class Searchlights {
  readonly group = new THREE.Group();
  private beams: Beam[] = [];
  private hullGlow: THREE.PointLight;
  private beamMat: THREE.ShaderMaterial;

  constructor(L: number, R: number, sailTop: number) {
    this.group.name = 'Faróis';
    this.beamMat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VS,
      fragmentShader: BEAM_FS,
      uniforms: { uColor: { value: new THREE.Color(0xd8ecff) }, uLen: { value: 70 }, uK: { value: 0.16 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6dc, toneMapped: false });
    const add = (pos: [number, number, number], aim: [number, number, number], angle: number, intensity: number, dist: number, len: number, coneK: number) => {
      const light = new THREE.SpotLight(0xfff1d6, intensity, dist, angle, 0.55, 2);
      light.position.set(...pos);
      light.target.position.set(...aim);
      this.group.add(light, light.target);
      // feixe na água: cone aberto com o vértice na lâmpada
      const geo = new THREE.ConeGeometry(Math.tan(angle * 0.85) * len, len, 28, 1, true);
      geo.translate(0, -len / 2, 0);
      geo.rotateX(-Math.PI / 2); // eixo do cone ao longo de +z (0 … len)
      const mat = this.beamMat.clone();
      mat.uniforms.uLen.value = len;
      mat.uniforms.uK.value = coneK;
      const cone = new THREE.Mesh(geo, mat);
      cone.position.set(...pos);
      const dir = new THREE.Vector3(aim[0] - pos[0], aim[1] - pos[1], aim[2] - pos[2]).normalize();
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      cone.renderOrder = 4;
      cone.frustumCulled = false;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lampMat);
      lamp.position.set(...pos);
      this.group.add(cone, lamp);
      this.beams.push({ light, cone, lamp });
    };
    // holofotes de proa (bombordo e boreste), para vante e ~9° para baixo
    for (const s of [-1, 1]) add([s * 0.9, -0.2, -(L / 2 - 3.2)], [s * 4, -11, -(L / 2 + 70)], 0.34, 4200, 170, 70, 0.16);
    // luz sob o casco: ilumina o fundo
    add([0, -R - 0.15, -4], [0, -40, -10], 0.7, 1600, 90, 34, 0.09);
    // luz suave sobre o casco (o submarino "emite" luz e fica visível no escuro)
    this.hullGlow = new THREE.PointLight(0xdfeeff, 90, 40, 2);
    this.hullGlow.position.set(0, sailTop + 4, -2);
    this.group.add(this.hullGlow);
    this.group.visible = false;
  }

  /** on: faróis ligados; beams: mostrar os feixes na água (câmera submersa); bowUnder: proa debaixo d'água */
  update(on: boolean, beams: boolean, bowUnder: boolean): void {
    this.group.visible = on;
    if (!on) return;
    for (const b of this.beams) b.cone.visible = beams && bowUnder;
  }

  dispose(): void {
    for (const b of this.beams) {
      b.cone.geometry.dispose();
      (b.cone.material as THREE.Material).dispose();
      b.lamp.geometry.dispose();
    }
    this.beamMat.dispose();
  }
}
