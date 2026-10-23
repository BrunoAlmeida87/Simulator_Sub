/**
 * PREFERÊNCIAS GRÁFICAS (apenas visuais): qualidade do oceano/cena, nível de
 * detalhe das texturas, ampliação visual do trim para demonstração, alcance
 * de desenho dos navios, detalhe da costa, iluminação da cena e sol e luzes
 * (hora do dia, luar, luzes de navegação, faróis). Guardadas no navegador e
 * enviadas à segunda janela. Nada aqui altera a física.
 */
import { useEffect, useReducer } from 'react';
import type { OceanQuality } from '../render3d/Ocean';
import type { SceneLighting } from '../render3d/lighting';
import { DEFAULT_DAYLIGHT, type DaylightSettings } from '../render3d/daylight';
import { DEFAULT_MARINE_LIFE, type MarineLifeSettings } from '../render3d/marineLifeMotion';
import { MAX_TRAFFIC } from '../sim/traffic';
import type { DeepLevel } from '../render3d/deepPerspective';
import { DEFAULT_TRAIL_STYLE, type TrailStyle } from '../render3d/trailStyle';

export interface GraphicsSettings extends MarineLifeSettings, DaylightSettings, TrailStyle {
  quality: OceanQuality;
  /** texturas do casco: 'alta' (placas anecoicas, marcas, mais resolução) ou 'normal' */
  textures: 'alta' | 'normal';
  /**
   * ampliação VISUAL do ângulo de trim (pitch) para demonstração: 1 = real.
   * Quando > 1 a cena mostra o aviso “TRIM AMPLIADO ×N”.
   */
  trimGain: number;
  /** alcance de desenho dos navios da mesa tática (km) */
  shipRange: number;
  /** detalhe do terreno da costa */
  coastDetail: 'baixa' | 'media' | 'alta';
  /** iluminação da cena: natural (escurece com a profundidade), clara (padrão) ou estúdio */
  lighting: SceneLighting;
  /** navios adicionais (tráfego fictício além dos contatos fixos), 0 … MAX_TRAFFIC */
  traffic: number;
  /** referências discretas de profundidade no ambiente submarino */
  depthRefs: boolean;
  /** perspectiva profunda em todas as vistas de 3ª pessoa (grande-angular de perto, mesmo enquadramento) */
  deepPersp: boolean;
  /** intensidade da perspectiva profunda */
  deepLevel: DeepLevel;
  /** espaçamento das linhas de profundidade (m; camada “Linhas de profundidade”) */
  depthLineSpacing: number;
}

const K_Q = 'sx1.quality.v1';
const KEY = 'sx1.graphics.v1';

function initialQuality(): OceanQuality {
  try {
    const q = localStorage.getItem(K_Q);
    if (q === 'baixa' || q === 'media' || q === 'alta') return q;
  } catch {
    /* sem armazenamento */
  }
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return coarse || (typeof window !== 'undefined' && window.innerWidth < 900) ? 'baixa' : 'alta';
}

export const TRIM_GAINS = [1, 5, 10, 20, 50];
/** espaçamentos oferecidos para as linhas de profundidade (m); padrão 25 m */
export const DEPTH_LINE_SPACINGS = [5, 10, 20, 25, 50, 100];

const num = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def);

function sanitize(p: Partial<GraphicsSettings> | null | undefined, base: GraphicsSettings): GraphicsSettings {
  const q = p?.quality;
  return {
    quality: q === 'baixa' || q === 'media' || q === 'alta' ? q : base.quality,
    trailWidth: num(p?.trailWidth, 1, 12, base.trailWidth),
    trailColor: typeof p?.trailColor === 'string' && /^#[0-9a-f]{6}$/i.test(p.trailColor) ? p.trailColor : base.trailColor,
    trailOpacity: num(p?.trailOpacity, 0.2, 1, base.trailOpacity),
    textures: p?.textures === 'alta' || p?.textures === 'normal' ? p.textures : base.textures,
    trimGain: typeof p?.trimGain === 'number' && TRIM_GAINS.includes(p.trimGain) ? p.trimGain : base.trimGain,
    shipRange: typeof p?.shipRange === 'number' && p.shipRange >= 2 && p.shipRange <= 30 ? p.shipRange : base.shipRange,
    coastDetail: p?.coastDetail === 'baixa' || p?.coastDetail === 'media' || p?.coastDetail === 'alta' ? p.coastDetail : base.coastDetail,
    lighting: p?.lighting === 'natural' || p?.lighting === 'clara' || p?.lighting === 'estudio' ? p.lighting : base.lighting,
    fishDensity: p?.fishDensity === 'desligada' || p?.fishDensity === 'discreta' || p?.fishDensity === 'moderada' || p?.fishDensity === 'abundante' ? p.fishDensity : base.fishDensity,
    fishJumps: typeof p?.fishJumps === 'boolean' ? p.fishJumps : base.fishJumps,
    fishUnderwater: typeof p?.fishUnderwater === 'boolean' ? p.fishUnderwater : base.fishUnderwater,
    traffic: typeof p?.traffic === 'number' && Number.isFinite(p.traffic) ? Math.max(0, Math.min(MAX_TRAFFIC, Math.round(p.traffic))) : base.traffic,
    depthRefs: typeof p?.depthRefs === 'boolean' ? p.depthRefs : base.depthRefs,
    deepPersp: typeof p?.deepPersp === 'boolean' ? p.deepPersp : base.deepPersp,
    deepLevel: p?.deepLevel === 'leve' || p?.deepLevel === 'media' || p?.deepLevel === 'forte' ? p.deepLevel : base.deepLevel,
    depthLineSpacing: typeof p?.depthLineSpacing === 'number' && DEPTH_LINE_SPACINGS.includes(p.depthLineSpacing) ? p.depthLineSpacing : base.depthLineSpacing,
    sunHour: num(p?.sunHour, 0, 24, base.sunHour),
    sunTurn: num(p?.sunTurn, -180, 180, base.sunTurn),
    moonlight: typeof p?.moonlight === 'boolean' ? p.moonlight : base.moonlight,
    navLights: p?.navLights === 'auto' || p?.navLights === 'ligadas' || p?.navLights === 'desligadas' ? p.navLights : base.navLights,
    subLights: typeof p?.subLights === 'boolean' ? p.subLights : base.subLights,
    darkWater: typeof p?.darkWater === 'boolean' ? p.darkWater : base.darkWater,
  };
}

class GraphicsStore {
  private v: GraphicsSettings;
  rev = 0;
  private listeners = new Set<() => void>();

  constructor() {
    const q = typeof window !== 'undefined' ? initialQuality() : 'alta';
    const def: GraphicsSettings = {
      ...DEFAULT_MARINE_LIFE,
      ...DEFAULT_TRAIL_STYLE,
      quality: q,
      textures: q === 'baixa' ? 'normal' : 'alta',
      trimGain: 1,
      shipRange: 12,
      coastDetail: q === 'baixa' ? 'baixa' : 'media',
      lighting: 'clara',
      traffic: 0,
      depthRefs: true,
      deepPersp: false,
      deepLevel: 'media',
      depthLineSpacing: 25,
      ...DEFAULT_DAYLIGHT,
    };
    let saved: Partial<GraphicsSettings> | null = null;
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
      saved = raw ? (JSON.parse(raw) as Partial<GraphicsSettings>) : null;
    } catch {
      saved = null;
    }
    // a ampliação do trim nunca volta ligada sozinha ao recarregar (evita confusão na apresentação)
    this.v = { ...sanitize(saved, def), quality: q, trimGain: 1 };
  }

  get(): GraphicsSettings {
    return this.v;
  }

  set(p: Partial<GraphicsSettings>, persist = true): void {
    const nv = sanitize({ ...this.v, ...p }, this.v);
    if (JSON.stringify(nv) === JSON.stringify(this.v)) return;
    this.v = nv;
    this.rev++;
    if (persist) {
      try {
        localStorage.setItem(KEY, JSON.stringify(nv));
        localStorage.setItem(K_Q, nv.quality);
      } catch {
        /* sem armazenamento */
      }
    }
    for (const l of this.listeners) l();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const graphics = new GraphicsStore();

/** Re-renderiza quando as preferências gráficas mudam. */
export function useGraphics(): GraphicsSettings {
  const [, f] = useReducer((x: number) => x + 1, 0);
  useEffect(() => graphics.subscribe(f), []);
  return graphics.get();
}

export const LIGHTINGS: SceneLighting[] = ['natural', 'clara', 'estudio'];
export const LIGHTING_LABELS: Record<SceneLighting, string> = { natural: 'Natural', clara: 'Clara', estudio: 'Estúdio' };

/** [qualidade, alterar] — compartilhado por todas as telas com cena 3D. */
export function useQuality(): [OceanQuality, (q: OceanQuality) => void] {
  const g = useGraphics();
  return [g.quality, (q) => graphics.set({ quality: q })];
}

