/** Camadas visuais da cena 3D (todas ligadas ao estado físico). */
export interface SceneLayers {
  /** peso, empuxo e resultante vertical */
  vectors: boolean;
  /** hélice, resistência e lemes */
  hydroVectors: boolean;
  /** corte do casco com os tanques */
  tanks: boolean;
  /** tubulações, válvulas e bombas */
  pipes: boolean;
  /** animação dos escoamentos de água e ar */
  flows: boolean;
  /** identificações (nomes, funções, percentuais, valores) */
  labels: boolean;
  /** boias e marcadores de distância fixos no cenário */
  markers: boolean;
  /** esteira, onda de proa, espuma e rastro do hélice */
  wake: boolean;
  /** trajetória */
  trail: boolean;
  /** luzes adicionais de apresentação */
  presLight: boolean;
  /** ampliação visual da resultante ('auto' = escolhe 1, 2, 5 × 10ⁿ) */
  resultantGain: number | 'auto';
  /** opacidade do casco quando os tanques estão visíveis (0,05 … 1) */
  hullOpacity: number;
  /** tanque destacado (id) */
  highlight: string | null;
}

export const defaultLayers = (): SceneLayers => ({
  vectors: false,
  hydroVectors: false,
  tanks: false,
  pipes: false,
  flows: true,
  labels: true,
  markers: false,
  wake: true,
  trail: true,
  presLight: false,
  resultantGain: 'auto',
  hullOpacity: 0.16,
  highlight: null,
});

/** Linguagem visual única para as categorias de tanques e circuitos. */
export const TANK_STYLE = {
  lastro: { color: 0x2f8cff, css: '#2f8cff', label: 'Lastro principal', fn: 'imersão / emersão' },
  compensacao: { color: 0x22d47a, css: '#22d47a', label: 'Compensação', fn: 'ajuste fino do peso' },
  trim: { color: 0xffa62b, css: '#ffa62b', label: 'Trim', fn: 'equilíbrio longitudinal' },
  banda: { color: 0xc77dff, css: '#c77dff', label: 'Banda', fn: 'equilíbrio transversal' },
} as const;
export type TankCategory = keyof typeof TANK_STYLE;

export const FORCE_STYLE = {
  weight: { color: 0xff4d4d, css: '#ff6b6b' },
  buoyancy: { color: 0x2ad4ff, css: '#49dcff' },
  net: { color: 0xffe14d, css: '#ffe14d' },
  hydro: { color: 0x9dff6b, css: '#a8ff7a' },
  air: { color: 0xf2f6ff, css: '#e8f0ff' },
};
