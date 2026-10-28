/**
 * REFLEXO DO CÉU NO SUBMARINO (só visual; a física não muda).
 *
 * A cena não tem mapa de ambiente: num casco quase preto e acetinado só a luz
 * direta aparece e a curvatura some. Aqui um céu simples com as MESMAS cores da
 * cena (zênite, horizonte/névoa, mar embaixo e o sol) vira um mapa de ambiente
 * (PMREM), aplicado só aos materiais do modelo .glb do SX-1. O casco ganha a
 * faixa de brilho em cima e o degradê para o escuro embaixo — volume.
 *
 * Acompanha a hora do dia, a noite, o modo submerso (luz vinda de cima, pela
 * água) e o modo sem água (estúdio neutro). O mapa só é refeito quando as cores
 * mudam de verdade (chave quantizada) e no máximo algumas vezes por segundo.
 */
import * as THREE from 'three';

export interface EnvColors {
  /** cor no zênite (ou da luz que desce pela água) */
  up: THREE.Color;
  /** cor no horizonte (névoa/água) */
  horizon: THREE.Color;
  /** cor embaixo (mar visto de cima, fundo escuro debaixo d'água) */
  down: THREE.Color;
  /** cor × intensidade do sol (zero = sem sol) */
  sun: THREE.Color;
  /** direção do sol (espaço da cena, unitária) */
  sunDir: THREE.Vector3;
}

/** Cores do reflexo para cada situação (funções puras, testadas). */
export function envColors(
  mode: 'acima' | 'submerso' | 'seco',
  p: { zenith: THREE.Color; fog: THREE.Color; sun: THREE.Color; sunDir: THREE.Vector3; sunK: number; day: number; uwUp?: THREE.Color; uwHorizon?: THREE.Color },
  out?: EnvColors,
): EnvColors {
  const o = out ?? { up: new THREE.Color(), horizon: new THREE.Color(), down: new THREE.Color(), sun: new THREE.Color(), sunDir: new THREE.Vector3() };
  if (mode === 'seco') {
    // estúdio neutro (fundo cinza-azulado da vista sem água), luz de cima
    o.up.setRGB(0.55, 0.6, 0.68);
    o.horizon.setRGB(0.12, 0.15, 0.19);
    o.down.setRGB(0.02, 0.025, 0.03);
    o.sun.setRGB(1, 0.97, 0.92).multiplyScalar(5);
    o.sunDir.set(0.35, 0.8, 0.45).normalize();
  } else if (mode === 'submerso') {
    // luz difusa que desce pela água; embaixo, escuro
    o.up.copy(p.uwUp ?? p.zenith).multiplyScalar(1.6);
    o.horizon.copy(p.uwHorizon ?? p.fog);
    o.down.copy(o.horizon).multiplyScalar(0.12);
    o.sun.setRGB(0, 0, 0);
    o.sunDir.set(0, 1, 0);
  } else {
    o.up.copy(p.zenith);
    o.horizon.copy(p.fog);
    // o mar refletido: bem mais escuro que o horizonte, com um pouco do céu
    o.down.copy(p.fog).multiplyScalar(0.16);
    o.sun.copy(p.sun).multiplyScalar(6 * p.sunK);
    o.sunDir.copy(p.sunDir).normalize();
  }
  return o;
}

/** Chave quantizada: só refaz o mapa quando a mudança é visível. */
export function envKey(c: EnvColors): string {
  const q = (v: number) => Math.round(v * 40);
  const col = (x: THREE.Color) => `${q(x.r)},${q(x.g)},${q(x.b)}`;
  const d = c.sunDir;
  return [col(c.up), col(c.horizon), col(c.down), col(c.sun), Math.round(d.x * 20), Math.round(d.y * 20), Math.round(d.z * 20)].join('|');
}

/** Intensidade do reflexo: forte de dia, fraca à noite e debaixo d'água. */
export function envIntensity(mode: 'acima' | 'submerso' | 'seco', day: number, under: number): number {
  if (mode === 'seco') return 1.6;
  if (mode === 'submerso') return 0.45 + 0.75 * Math.max(0, Math.min(1, under));
  return 0.3 + 1.4 * Math.max(0, Math.min(1, day));
}

const VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FS = /* glsl */ `
uniform vec3 uUp;
uniform vec3 uHorizon;
uniform vec3 uDown;
uniform vec3 uSun;
uniform vec3 uSunDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 c = d.y >= 0.0 ? mix(uHorizon, uUp, pow(d.y, 0.55)) : mix(uHorizon, uDown, pow(-d.y, 0.35));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  c += uSun * (pow(s, 400.0) * 6.0 + pow(s, 24.0) * 0.25);
  gl_FragColor = vec4(c, 1.0);
}`;

/** Gera e mantém o mapa de ambiente do submarino. Sem WebGL (testes), não faz nada. */
export class SubEnvironment {
  texture: THREE.Texture | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private scene = new THREE.Scene();
  private mat = new THREE.ShaderMaterial({
    vertexShader: VS,
    fragmentShader: FS,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uUp: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uDown: { value: new THREE.Color() },
      uSun: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    },
  });
  private rt: THREE.WebGLRenderTarget | null = null;
  private key = '';
  private last = -Infinity;

  constructor(renderer: THREE.WebGLRenderer | null) {
    if (renderer) this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), this.mat));
  }

  /** Refaz o mapa se as cores mudaram (no máximo a cada 0,4 s). Devolve true quando a textura mudou. */
  update(c: EnvColors, now: number): boolean {
    if (!this.pmrem) return false;
    const k = envKey(c);
    if (k === this.key || (this.texture && now - this.last < 0.4)) return false;
    const u = this.mat.uniforms;
    (u.uUp.value as THREE.Color).copy(c.up);
    (u.uHorizon.value as THREE.Color).copy(c.horizon);
    (u.uDown.value as THREE.Color).copy(c.down);
    (u.uSun.value as THREE.Color).copy(c.sun);
    (u.uSunDir.value as THREE.Vector3).copy(c.sunDir);
    const rt = this.pmrem.fromScene(this.scene, 0, 0.1, 100);
    this.rt?.dispose();
    this.rt = rt;
    this.texture = rt.texture;
    this.key = k;
    this.last = now;
    return true;
  }

  dispose(): void {
    this.rt?.dispose();
    this.pmrem?.dispose();
    this.mat.dispose();
  }
}
