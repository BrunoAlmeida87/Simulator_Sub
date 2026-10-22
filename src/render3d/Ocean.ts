/**
 * OCEANO RENDERIZADO — superfície deslocada em GPU pelas MESMAS componentes
 * de onda usadas na física (WaveField): η(x,t) = Σ aᵢ·cos(kᵢ·dᵢ·x − ωᵢt + φᵢ).
 * Visual apenas acrescenta: leve deslocamento horizontal de Gerstner
 * (picos mais agudos), micro-ondulação de normais (capilares, sem efeito
 * físico), reflexo Fresnel do céu, brilho do sol, espuma nas cristas,
 * janela de Snell vista de baixo e cáusticas.
 */
import * as THREE from 'three';
import { LIGHTING, waterColor, type WaterPalette } from './lighting';
import type { WaveField } from '../sim/environment/waves';
import { MAX_WAVE_COMPONENTS } from '../sim/environment/waves';

export type OceanQuality = 'baixa' | 'media' | 'alta';

const N = MAX_WAVE_COMPONENTS;

const COMMON = /* glsl */ `
#define MAXW ${N}
uniform vec4 uWave[MAXW];   // a, k, fase0, -
uniform vec2 uDir[MAXW];    // direção (Norte, Leste)
uniform int uCount;
uniform vec3 uCamPos;
`;

const VERT = /* glsl */ `
${COMMON}
uniform float uChop;
varying vec3 vWorld;
varying vec3 vNrm;
varying float vEta;
varying float vFade;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float nl = -wp.z;
  float el = wp.x;
  float eta = 0.0;
  vec2 hd = vec2(0.0);
  float dn = 0.0;
  float de = 0.0;
  for (int i = 0; i < MAXW; i++) {
    if (i >= uCount) break;
    vec4 w = uWave[i];
    vec2 d = uDir[i];
    float th = w.y * (d.x * nl + d.y * el) + w.z;
    float c = cos(th);
    float s = sin(th);
    eta += w.x * c;
    hd -= uChop * w.x * d * s;
    dn -= w.x * w.y * d.x * s;
    de -= w.x * w.y * d.y * s;
  }
  float dist = length(wp.xz - uCamPos.xz);
  float fade = 1.0 - smoothstep(1800.0, 6000.0, dist);
  wp.y += eta * fade;
  wp.x += hd.y * fade;
  wp.z -= hd.x * fade;
  vEta = eta * fade;
  vFade = fade;
  vWorld = wp.xyz;
  vNrm = normalize(vec3(-de * fade, 1.0, dn * fade));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${COMMON}
uniform vec3 uSunDir;
uniform float uSunK;
uniform vec3 uMoonDir;
uniform float uMoonK;
uniform float uLightK;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uUnderFog;
uniform float uHs;
uniform float uFoam;
uniform float uTime;
uniform int uFragWaves;
varying vec3 vWorld;
varying vec3 vNrm;
varying float vEta;
varying float vFade;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 sky(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyZenith, pow(h, 0.55));
  float sd = max(dot(d, uSunDir), 0.0);
  c += (vec3(1.0, 0.92, 0.75) * pow(sd, 900.0) * 14.0 + vec3(1.0, 0.85, 0.65) * pow(sd, 12.0) * 0.35) * uSunK;
  float md = max(dot(d, uMoonDir), 0.0);
  c += (vec3(0.85, 0.9, 1.0) * pow(md, 1400.0) * 6.0 + vec3(0.5, 0.6, 0.8) * pow(md, 30.0) * 0.12) * uMoonK;
  return c;
}
void main() {
  vec3 N = vNrm;
  if (uFragWaves == 1) {
    // normais por pixel com as mesmas componentes (detalhe nítido)
    float nl = -vWorld.z;
    float el = vWorld.x;
    float dn = 0.0;
    float de = 0.0;
    for (int i = 0; i < MAXW; i++) {
      if (i >= uCount) break;
      vec4 w = uWave[i];
      vec2 d = uDir[i];
      float th = w.y * (d.x * nl + d.y * el) + w.z;
      float s = sin(th);
      dn -= w.x * w.y * d.x * s;
      de -= w.x * w.y * d.y * s;
    }
    N = normalize(vec3(-de * vFade, 1.0, dn * vFade));
  }
  float dist = length(vWorld - uCamPos);
  // micro-ondulação capilar (somente visual): gradiente de ruído em duas escalas, atenuado com a distância
  vec2 q = vWorld.xz;
  float rf = (1.0 - smoothstep(20.0, 350.0, dist)) * 0.5;
  if (rf > 0.0) {
    vec2 p1 = mat2(0.8, -0.6, 0.6, 0.8) * q * 0.55 + vec2(uTime * 0.35, uTime * 0.21);
    vec2 p2 = mat2(0.36, 0.93, -0.93, 0.36) * q * 1.7 - vec2(uTime * 0.5, uTime * 0.12);
    float e = 0.08;
    float n0 = vnoise(p1) + 0.5 * vnoise(p2);
    float nx = vnoise(p1 + vec2(e, 0.0)) + 0.5 * vnoise(p2 + vec2(e, 0.0));
    float nz = vnoise(p1 + vec2(0.0, e)) + 0.5 * vnoise(p2 + vec2(0.0, e));
    N = normalize(N + rf * 0.18 * vec3(-(nx - n0) / e, 0.0, -(nz - n0) / e) * 0.12);
  }
  bool under = uCamPos.y < vWorld.y;
  vec3 col;
  float alpha;
  if (!under) {
    vec3 V = normalize(uCamPos - vWorld);
    float NdV = max(dot(N, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 refl = sky(R);
    float crest = clamp(vEta / (0.5 * uHs + 0.05), 0.0, 1.0);
    vec3 body = mix(uDeep, uShallow, crest * 0.55 + 0.1);
    col = mix(body, refl, F);
    vec3 H = normalize(uSunDir + V);
    col += vec3(1.0, 0.95, 0.85) * pow(max(dot(N, H), 0.0), 700.0) * 4.0 * uSunK;
    // caminho do luar na água
    vec3 Hm = normalize(uMoonDir + V);
    col += vec3(0.75, 0.82, 1.0) * pow(max(dot(N, Hm), 0.0), 260.0) * 1.6 * uMoonK;
    // espuma nas cristas (mar ≥ 3)
    float br = vnoise(q * 0.9 + uTime * 0.08) * 0.55 + vnoise(q * 3.1 - uTime * 0.1) * 0.45;
    float f = uFoam * smoothstep(0.62, 1.05, crest) * smoothstep(0.55, 0.85, br);
    col = mix(col, vec3(0.9, 0.95, 1.0), f * 0.85);
    col = mix(col, uSkyHorizon, smoothstep(2500.0, 9500.0, dist));
    alpha = mix(0.78, 1.0, max(F, smoothstep(60.0, 600.0, dist)));
  } else {
    // vista de baixo: janela de Snell (≈ 48,6°) e reflexão interna total fora dela
    vec3 L = normalize(vWorld - uCamPos);
    float cosI = dot(L, N);
    float win = smoothstep(0.60, 0.70, cosI);
    vec3 skyRef = sky(normalize(vec3(L.x * 0.6, 1.0, L.z * 0.6)));
    col = mix(uUnderFog * 1.6 + vec3(0.01, 0.03, 0.04) * uLightK, skyRef * 0.9 + vec3(0.05, 0.12, 0.16) * uLightK, win);
    col += vec3(0.9, 0.95, 1.0) * pow(max(dot(L, uSunDir), 0.0), 60.0) * 1.5 * win * uSunK;
    col = mix(col, uUnderFog, 1.0 - exp(-dist * 0.0045));
    alpha = 0.96;
  }
  gl_FragColor = vec4(col, alpha);
  // vista de baixo sem ajuste de tom: ao longe a superfície tem a mesma cor da névoa e do fundo subaquático
  #if defined( TONE_MAPPING )
  if (!under) gl_FragColor.rgb = toneMapping(gl_FragColor.rgb);
  #endif
  #include <colorspace_fragment>
}
`;

/** Malha radial: anéis com raio crescente (detalhe perto da câmera, horizonte distante). */
function radialGrid(rings: number, segs: number, rMax: number): THREE.BufferGeometry {
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  const r0 = 1.0;
  const growth = Math.pow(rMax / r0, 1 / rings);
  for (let j = 1; j <= rings; j++) {
    const r = r0 * Math.pow(growth, j);
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  for (let i = 0; i < segs; i++) idx.push(0, 1 + ((i + 1) % segs), 1 + i);
  for (let j = 0; j < rings - 1; j++) {
    const a0 = 1 + j * segs;
    const a1 = 1 + (j + 1) * segs;
    for (let i = 0; i < segs; i++) {
      const i1 = (i + 1) % segs;
      idx.push(a0 + i, a0 + i1, a1 + i, a0 + i1, a1 + i1, a1 + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class Ocean {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  private wave = Array.from({ length: N }, () => new THREE.Vector4());
  private dir = Array.from({ length: N }, () => new THREE.Vector2());

  constructor(quality: OceanQuality, sunDir: THREE.Vector3) {
    const q = quality === 'alta' ? { rings: 150, segs: 200 } : quality === 'media' ? { rings: 110, segs: 140 } : { rings: 70, segs: 80 };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uWave: { value: this.wave },
        uDir: { value: this.dir },
        uCount: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uChop: { value: 0.35 },
        uSunDir: { value: sunDir.clone().normalize() },
        uSunK: { value: 1 },
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonK: { value: 0 },
        uLightK: { value: 1 },
        uSkyZenith: { value: new THREE.Color(0x1f4f86) },
        uSkyHorizon: { value: new THREE.Color(0x9dbad4) },
        uDeep: { value: new THREE.Color(0x011a2c) },
        uShallow: { value: new THREE.Color(0x0b5d70) },
        uUnderFog: { value: new THREE.Color(0x0a3550) },
        uHs: { value: 0 },
        uFoam: { value: 0 },
        uTime: { value: 0 },
        uFragWaves: { value: quality === 'baixa' ? 0 : 1 },
      },
    });
    this.mesh = new THREE.Mesh(radialGrid(q.rings, q.segs, 12000), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /**
   * Sol, lua e céu do momento (daylight.ts). bodyK escurece a cor da água
   * (1 = dia). Valores padrão = cena de dia como sempre foi.
   */
  setLight(sunDir: THREE.Vector3, sunK: number, moonDir: THREE.Vector3, moonK: number, zenith: THREE.Color, horizon: THREE.Color, bodyK: number, underK = 1): void {
    const u = this.material.uniforms;
    u.uLightK.value = underK;
    u.uSunDir.value.copy(sunDir);
    u.uSunK.value = sunK;
    u.uMoonDir.value.copy(moonDir);
    u.uMoonK.value = moonK;
    u.uSkyZenith.value.copy(zenith);
    u.uSkyHorizon.value.copy(horizon);
    u.uDeep.value.setHex(0x011a2c).multiplyScalar(bodyK);
    u.uShallow.value.setHex(0x0b5d70).multiplyScalar(bodyK);
  }

  /**
   * Atualiza as componentes (fase absoluta calculada em dupla precisão na CPU:
   * fase0 = k·(d·x_origem) − ω·t + φ) e acompanha a câmera.
   */
  update(w: WaveField, t: number, originN: number, originE: number, cam: THREE.Vector3, underColor: THREE.Color, wallTime: number): void {
    const u = this.material.uniforms;
    const comps = w.components;
    for (let i = 0; i < N; i++) {
      const c = comps[i];
      if (c) {
        const ph = c.k * (c.dn * originN + c.de * originE) - c.w * t + c.phi;
        this.wave[i].set(c.a, c.k, ph % (Math.PI * 2), 0);
        this.dir[i].set(c.dn, c.de);
      } else this.wave[i].set(0, 0, 0, 0);
    }
    u.uCount.value = comps.length;
    u.uHs.value = w.hs;
    u.uFoam.value = Math.max(0, Math.min(1, (w.hs - 0.6) / 2.5));
    u.uCamPos.value.copy(cam);
    u.uUnderFog.value.copy(underColor);
    u.uTime.value = wallTime;
    // a malha segue a câmera (passo fixo para não "nadar")
    const step = 4;
    this.mesh.position.set(Math.round(cam.x / step) * step, 0, Math.round(cam.z / step) * step);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Injeta cáusticas (luz focalizada pelas ondas) em um material padrão:
 * intensidade decai com a profundidade, nula com mar calmo.
 */
export function addCaustics(mat: THREE.MeshStandardMaterial, uniforms: { uTime: { value: number }; uCaustic: { value: number } }, decay: number): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uCaustic = uniforms.uCaustic;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldC;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldC = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldC;
uniform float uTime;
uniform float uCaustic;
float causticF(vec2 p, float t) {
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 2.0);
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float dC = -vWorldC.y;
if (dC > 0.0 && uCaustic > 0.0) {
  float ci = causticF(vWorldC.xz * 0.12, uTime * 0.6) * exp(-dC / ${decay.toFixed(1)}) * uCaustic;
  totalEmissiveRadiance += vec3(0.35, 0.6, 0.75) * ci * ${(decay < 20 ? 0.1 : 0.3).toFixed(2)};
}`,
      );
  };
}

/**
 * Ambiente subaquático: esfera com gradiente vertical (luz vinda de cima,
 * escurecendo com a profundidade da câmera) e feixes de luz (god rays)
 * próximos ao zênite, atenuados com a profundidade.
 */
export class UnderwaterSky {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  constructor(sunDir: THREE.Vector3) {
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      // sem ajuste de tom: a cor sai igual à da névoa (senão o fundo fica mais escuro que a água em volta
      // e o limite do terreno aparece como uma faixa)
      toneMapped: false,
      uniforms: {
        uUp: { value: new THREE.Color(0x3d8ab3) },
        uHorizon: { value: new THREE.Color(0x0a3550) },
        uDown: { value: new THREE.Color(0x020b14) },
        uSunDir: { value: sunDir.clone().normalize() },
        uRays: { value: 1 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uUp; uniform vec3 uHorizon; uniform vec3 uDown; uniform vec3 uSunDir; uniform float uRays; uniform float uTime;
        varying vec3 vDir;
        float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
        float n1(float x) { float i = floor(x); float f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
        void main() {
          vec3 d = normalize(vDir);
          vec3 c = d.y > 0.0 ? mix(uHorizon, uUp, pow(d.y, 0.6)) : mix(uHorizon, uDown, smoothstep(0.0, 0.85, -d.y));
          // feixes de luz convergindo para o sol refratado
          vec3 s = normalize(vec3(uSunDir.x * 0.5, 1.0, uSunDir.z * 0.5));
          float a = atan(d.x - s.x, d.z - s.z);
          float rays = n1(a * 18.0 + uTime * 0.15) * n1(a * 7.0 - uTime * 0.1);
          float up = smoothstep(0.15, 0.95, d.y);
          c += uUp * rays * up * 0.55 * uRays;
          c += vec3(0.8, 0.9, 1.0) * pow(max(dot(d, s), 0.0), 40.0) * 0.5 * uRays;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }
  /** Cores conforme a profundidade da câmera (m) e o perfil de iluminação. */
  update(camPos: THREE.Vector3, camDepth: number, time: number, water: WaterPalette = LIGHTING.natural.water, light = 1, sunK = 1): { horizon: THREE.Color; up: THREE.Color } {
    const u = this.material.uniforms;
    waterColor(water.up, camDepth, u.uUp.value);
    waterColor(water.horizon, camDepth, u.uHorizon.value);
    waterColor(water.down, camDepth, u.uDown.value);
    // claridade do momento (noite, água escura): escurece as três cores juntas
    if (light !== 1) for (const c of [u.uUp.value, u.uHorizon.value, u.uDown.value] as THREE.Color[]) c.multiplyScalar(light);
    u.uRays.value = Math.exp(-camDepth / 45) * sunK;
    u.uTime.value = time;
    this.mesh.position.copy(camPos);
    return { horizon: u.uHorizon.value, up: u.uUp.value };
  }
}
