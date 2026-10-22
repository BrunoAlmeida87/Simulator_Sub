/**
 * SOL, LUA E NOITE NA CENA 3D (só visual; nada aqui altera a física).
 *
 * O sol segue o caminho do equinócio na latitude do Rio de Janeiro (−23°):
 * nasce a leste às 6 h, passa ao norte ao meio-dia (67° de altura) e se põe a
 * oeste às 18 h. A "direção do sol" gira esse caminho para escolher de que lado
 * vem a luz. Da altura do sol saem as cores do céu e da névoa, a luz direta, a
 * luz ambiente, o tom do amanhecer/entardecer e a claridade debaixo d'água. À
 * noite, com o luar ligado, a lua cheia fica oposta ao sol e ilumina de leve
 * (luz azulada), com estrelas no céu.
 *
 * Padrão (7 h, giro −38°): o mesmo sol baixo vindo de nordeste que a cena
 * sempre usou.
 */
import * as THREE from 'three';

export type NavLightsMode = 'auto' | 'ligadas' | 'desligadas';

export interface DaylightSettings {
  /** hora do dia (0 … 24) */
  sunHour: number;
  /** giro do caminho do sol (graus): muda de que lado vem a luz */
  sunTurn: number;
  /** lua cheia à noite (luar e lua no céu) */
  moonlight: boolean;
  /** luzes de navegação do submarino e dos navios: automáticas (à noite), ligadas ou desligadas */
  navLights: NavLightsMode;
  /** faróis do submarino: holofotes de proa, luz sob o casco e luz sobre o casco */
  subLights: boolean;
  /** água escura: debaixo d'água quase sem luz ambiente (os faróis mostram o caminho) */
  darkWater: boolean;
}

export const DEFAULT_DAYLIGHT: DaylightSettings = { sunHour: 7, sunTurn: -38, moonlight: true, navLights: 'auto', subLights: false, darkWater: false };

/** latitude do caminho do sol (Rio de Janeiro) */
const LAT = (-23 * Math.PI) / 180;
const D2R = Math.PI / 180;

/** altura e azimute do sol (graus; azimute a partir do norte, sentido horário, já com o giro) */
export function sunAngles(hour: number, turn = 0): { el: number; az: number } {
  const H = (hour - 12) * 15 * D2R;
  const el = Math.asin(Math.cos(LAT) * Math.cos(H));
  const A = Math.atan2(-Math.sin(H), -Math.cos(H) * Math.sin(LAT));
  const az = (((A / D2R + turn) % 360) + 360) % 360;
  return { el: el / D2R, az };
}

/** vetor unitário na cena (x = leste, y = cima, z = −norte) para altura/azimute em graus */
export function dirFromAngles(el: number, az: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = el * D2R;
  const a = az * D2R;
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface Daylight {
  /** direção do sol e da lua na cena (unitários) */
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  /** altura e azimute do sol (graus) */
  el: number;
  az: number;
  /** 0 noite … 1 dia (luz ambiente e céu) */
  day: number;
  /** luz direta do sol 0 … 1 */
  sunK: number;
  /** tom quente do amanhecer/entardecer 0 … 1 */
  warm: number;
  /** luar 0 … 1 */
  moonK: number;
  /** 0 … 1: noite (acende as luzes da cidade e as de navegação automáticas) */
  night: number;
  /** claridade debaixo d'água 0 … 1 (água escura reduz) */
  under: number;
}

/** nomes curtos do período, para a interface */
export function periodName(el: number): string {
  if (el < -6) return 'noite';
  if (el < 6) return el < 0 ? 'crepúsculo' : 'sol baixo';
  return 'dia';
}

export function computeDaylight(s: DaylightSettings): Daylight {
  const { el, az } = sunAngles(s.sunHour, s.sunTurn);
  const sunDir = dirFromAngles(el, az);
  // lua cheia oposta ao sol; para iluminar, nunca abaixo de 12° de altura
  const moonDir = dirFromAngles(Math.max(12, -el), (az + 180) % 360);
  const day = smooth(-9, 6, el);
  const sunK = smooth(-2, 7, el);
  const warm = (1 - smooth(2, 13, el)) * smooth(-7, -1, el);
  const moonK = s.moonlight ? 1 - smooth(-10, -2, el) : 0;
  const night = 1 - smooth(-4, 4, el);
  const under = (s.moonlight ? 0.1 : 0.05) + (1 - (s.moonlight ? 0.1 : 0.05)) * day;
  return { sunDir, moonDir, el, az, day, sunK, warm, moonK, night, under: under * (s.darkWater ? 0.1 : 1) };
}

/** luzes de navegação acesas? (automáticas: do crepúsculo até o amanhecer) */
export function navLightsOn(s: DaylightSettings, d: Daylight): boolean {
  return s.navLights === 'ligadas' || (s.navLights === 'auto' && d.night > 0.35);
}

const C = (h: number) => new THREE.Color(h);
const DAY_FOG = C(0x9dbad4);
const DUSK_FOG = C(0xd9a487);
const NIGHT_FOG_MOON = C(0x0e1828);
const NIGHT_FOG = C(0x05080e);
const DAY_ZENITH = C(0x1f4f86);
const NIGHT_ZENITH_MOON = C(0x07101f);
const NIGHT_ZENITH = C(0x020409);
const DAY_HEMI = C(0xbfdfff);
const DUSK_HEMI = C(0xffcaa2);
const NIGHT_HEMI = C(0x3a4c7a);
const DAY_GROUND = C(0x0b1a26);
const NIGHT_GROUND = C(0x05080c);
const SUN_DAY = C(0xfff2dd);
const SUN_LOW = C(0xff8c4a);

/** cores e intensidades derivadas (preenche os objetos dados) */
export function skyPalette(
  d: Daylight,
  moonlight: boolean,
  out: { fog: THREE.Color; zenith: THREE.Color; hemiSky: THREE.Color; hemiGround: THREE.Color; sun: THREE.Color },
): { hemiK: number; sunI: number; moonI: number } {
  out.fog
    .copy(moonlight ? NIGHT_FOG_MOON : NIGHT_FOG)
    .lerp(DAY_FOG, d.day)
    .lerp(DUSK_FOG, d.warm * d.day * 0.55);
  out.zenith.copy(moonlight ? NIGHT_ZENITH_MOON : NIGHT_ZENITH).lerp(DAY_ZENITH, d.day);
  out.hemiSky
    .copy(NIGHT_HEMI)
    .lerp(DAY_HEMI, d.day)
    .lerp(DUSK_HEMI, d.warm * d.day * 0.5);
  out.hemiGround.copy(NIGHT_GROUND).lerp(DAY_GROUND, d.day);
  out.sun.copy(SUN_DAY).lerp(SUN_LOW, d.warm);
  const amb = moonlight ? 0.12 : 0.05;
  return { hemiK: 1.3 * (amb + (1 - amb) * d.day), sunI: 2.2 * d.sunK, moonI: 0.55 * d.moonK };
}

function moonTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  // halo
  const halo = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  halo.addColorStop(0, 'rgba(220,230,255,0.55)');
  halo.addColorStop(0.35, 'rgba(200,215,255,0.18)');
  halo.addColorStop(1, 'rgba(200,215,255,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, 128, 128);
  // disco com mares (manchas) discretos
  const disc = g.createRadialGradient(58, 58, 2, 64, 64, 22);
  disc.addColorStop(0, '#fbfbf4');
  disc.addColorStop(1, '#d9dccf');
  g.fillStyle = disc;
  g.beginPath();
  g.arc(64, 64, 21, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(150,155,150,0.35)';
  for (const [x, y, r] of [
    [58, 56, 6],
    [70, 62, 5],
    [62, 72, 4],
    [72, 52, 3],
  ])
    (g.beginPath(), g.arc(x, y, r, 0, Math.PI * 2), g.fill());
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Céu noturno: estrelas, a lua (disco com halo) e a luz do luar. Fica centrado
 * na câmera; só aparece acima d'água.
 */
const DOME_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const DOME_FS = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform float uGlow;
uniform float uAlpha;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(h, 0.5));
  // brilho do crepúsculo do lado do sol
  vec3 s = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
  float g = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), s), 0.0), 3.0) * (1.0 - smoothstep(0.0, 0.45, h));
  c += vec3(0.95, 0.45, 0.18) * g * uGlow;
  gl_FragColor = vec4(c, uAlpha);
  #include <colorspace_fragment>
}`;

/** raio das estrelas e da lua (atrás da terra mais distante, antes do plano de fundo da câmera) */
const FAR = 27000;

export class NightSky {
  readonly group = new THREE.Group();
  readonly moonLight = new THREE.DirectionalLight(0xa9bfff, 0);
  private stars: THREE.Points;
  private moon: THREE.Sprite;
  /** céu do crepúsculo e da noite (cobre o céu diurno quando o sol está abaixo do horizonte) */
  private dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;

  constructor() {
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VS,
      fragmentShader: DOME_FS,
      uniforms: { uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uGlow: { value: 0 }, uAlpha: { value: 0 } },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), this.domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -2;
    const N = 1600;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < N; i++) {
      // hemisfério superior, um pouco mais denso perto do horizonte
      const u = rnd();
      const y = Math.pow(u, 1.4) * 0.98 + 0.02;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r * FAR, y * FAR, Math.sin(a) * r * FAR], i * 3);
      const b = 0.45 + rnd() * 0.55;
      const warmth = rnd();
      col.set([b * (0.85 + 0.15 * warmth), b * 0.92, b * (1 - 0.12 * warmth)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -1.5;
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture() ?? undefined, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    this.moon.scale.setScalar(1750);
    this.moon.renderOrder = -1.4;
    this.group.add(this.dome, this.stars, this.moon);
    this.group.visible = false;
    this.moonLight.visible = false;
  }

  /** above: câmera acima d'água e água visível; zenith/horizon: cores do céu do momento (skyPalette) */
  update(d: Daylight, cam: THREE.Vector3, above: boolean, moonI: number, zenith: THREE.Color, horizon: THREE.Color): void {
    const starA = Math.pow(d.night, 1.6) * (d.moonK > 0 ? 0.75 : 1);
    const showMoon = d.moonK > 0.02 && d.moonDir.y > 0;
    // o céu diurno (Preetham) apaga logo abaixo do horizonte: a cúpula assume do pôr do sol em diante
    const domeA = 1 - smooth(-4, 1, d.el);
    this.group.visible = above && (starA > 0.02 || showMoon || domeA > 0.01);
    this.group.position.copy(cam);
    this.dome.visible = domeA > 0.01;
    const u = this.domeMat.uniforms;
    u.uAlpha.value = domeA;
    u.uZenith.value.copy(zenith);
    u.uHorizon.value.copy(horizon);
    u.uSunDir.value.copy(d.sunDir);
    u.uGlow.value = d.warm * 0.6;
    (this.stars.material as THREE.PointsMaterial).opacity = starA;
    this.stars.visible = starA > 0.02;
    this.moon.visible = showMoon;
    this.moon.position.copy(d.moonDir).multiplyScalar(FAR * 0.95);
    (this.moon.material as THREE.SpriteMaterial).opacity = Math.min(1, d.moonK * 1.2);
    // luz do luar (desligada de dia: evita custo e mudanças de sombreamento)
    this.moonLight.visible = moonI > 0.01;
    this.moonLight.intensity = moonI;
    this.moonLight.position.copy(d.moonDir).multiplyScalar(1000);
  }

  dispose(): void {
    this.dome.geometry.dispose();
    this.domeMat.dispose();
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
    (this.moon.material as THREE.SpriteMaterial).map?.dispose();
    (this.moon.material as THREE.Material).dispose();
  }
}
