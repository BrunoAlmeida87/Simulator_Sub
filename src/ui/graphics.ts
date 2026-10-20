/**
 * PREFERÊNCIAS GRÁFICAS (apenas visuais): qualidade do oceano/cena, nível de
 * detalhe das texturas, ampliação visual do trim para demonstração, alcance
 * de desenho dos navios e detalhe da costa. Guardadas no navegador e
 * enviadas à segunda janela. Nada aqui altera a física.
 */
import { useEffect, useReducer } from 'react';
import type { OceanQuality } from '../render3d/Ocean';

export interface GraphicsSettings {
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

function sanitize(p: Partial<GraphicsSettings> | null | undefined, base: GraphicsSettings): GraphicsSettings {
  const q = p?.quality;
  return {
    quality: q === 'baixa' || q === 'media' || q === 'alta' ? q : base.quality,
    textures: p?.textures === 'alta' || p?.textures === 'normal' ? p.textures : base.textures,
    trimGain: typeof p?.trimGain === 'number' && TRIM_GAINS.includes(p.trimGain) ? p.trimGain : base.trimGain,
    shipRange: typeof p?.shipRange === 'number' && p.shipRange >= 2 && p.shipRange <= 30 ? p.shipRange : base.shipRange,
    coastDetail: p?.coastDetail === 'baixa' || p?.coastDetail === 'media' || p?.coastDetail === 'alta' ? p.coastDetail : base.coastDetail,
  };
}

class GraphicsStore {
  private v: GraphicsSettings;
  rev = 0;
  private listeners = new Set<() => void>();

  constructor() {
    const q = typeof window !== 'undefined' ? initialQuality() : 'alta';
    const def: GraphicsSettings = { quality: q, textures: q === 'baixa' ? 'normal' : 'alta', trimGain: 1, shipRange: 12, coastDetail: q === 'baixa' ? 'baixa' : 'media' };
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

/** [qualidade, alterar] — compartilhado por todas as telas com cena 3D. */
export function useQuality(): [OceanQuality, (q: OceanQuality) => void] {
  const g = useGraphics();
  return [g.quality, (q) => graphics.set({ quality: q })];
}
