/** Camadas visuais da cena 3D (todas ligadas ao estado físico). */
export interface SceneLayers {
  /** peso, empuxo e resultante vertical */
  vectors: boolean;
  /** hélice, resistência e lemes */
  hydroVectors: boolean;
  /** vetores de trim: peso deslocável, tanques de trim e momento líquido */
  trimVectors: boolean;
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
  /** esteira, onda de proa, espuma, rastro do hélice, bolhas da descarga dos diesel e aspiração do snorkel */
  wake: boolean;
  /** vento aparente: linhas de vento acima da água e flâmula na vela */
  wind: boolean;
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
  /** tanques visíveis no corte (null = todos) */
  tankFilter: string[] | null;
  /** vetores ocultos individualmente: 'P', 'E', 'R', 'prop', 'drag', 'bow', 'stern', 'rudder' */
  hiddenVectors: string[];
  /** sem água: oculta o mar, a névoa e os efeitos de água para ver melhor o submarino */
  noWater: boolean;
  /** referências de trim/calado: linha do nível do mar × linha do casco e leituras de calado AV/AR */
  trimRef: boolean;
  /** navios (contatos da mesa tática) no mar */
  ships: boolean;
  /** rótulos de energia sobre o modelo: carga da bateria (%) e geradores em carga */
  batteryInfo: boolean;
  /** rótulos das garrafas de ar comprimido: pressão, massa de ar e ar livre equivalente */
  airInfo: boolean;
  /** casco externo (casco, vela e convés); desligado mostra só os componentes internos */
  hull: boolean;
}

export const defaultLayers = (): SceneLayers => ({
  vectors: false,
  hydroVectors: false,
  trimVectors: false,
  tanks: false,
  pipes: false,
  flows: true,
  labels: true,
  markers: false,
  wake: true,
  wind: true,
  trail: true,
  presLight: false,
  resultantGain: 'auto',
  hullOpacity: 0.16,
  highlight: null,
  tankFilter: null,
  hiddenVectors: [],
  noWater: false,
  trimRef: false,
  ships: true,
  batteryInfo: true,
  airInfo: false,
  hull: true,
});

/** camadas liga/desliga (as demais chaves de SceneLayers são ajustes, não camadas) */
export type BoolLayer = { [K in keyof SceneLayers]: SceneLayers[K] extends boolean ? K : never }[keyof SceneLayers];

/**
 * Catálogo único das camadas, com o nome mostrado nas telas.
 * `mode`: camadas que mudam o ambiente (tirar a água, iluminação extra) não
 * entram em “Marcar todas”; “Desmarcar todas” desliga tudo, inclusive elas.
 */
export const LAYER_INFO: Record<Exclude<BoolLayer, 'hull'>, { label: string; title: string; mode?: boolean }> = {
  vectors: { label: 'Peso/empuxo', title: 'Peso, empuxo e resultante vertical' },
  hydroVectors: { label: 'Hélice/lemes/resist.', title: 'Empuxo do hélice, resistência e forças dos lemes' },
  trimVectors: { label: 'Vetores de trim', title: 'Peso deslocável, tanques de trim e momento líquido' },
  tanks: { label: 'Tanques (corte)', title: 'Casco transparente com os tanques' },
  pipes: { label: 'Tubulações', title: 'Tubulações, válvulas e bombas (no corte)' },
  flows: { label: 'Escoamentos', title: 'Partículas das vazões calculadas (no corte)' },
  labels: { label: 'Identificações', title: 'Nomes e valores sobre a cena (tanques, válvulas, navios, superfície…)' },
  batteryInfo: { label: 'Bateria (%)', title: 'Carga da bateria e geradores em carga, junto aos componentes (com o corte/tanques)' },
  airInfo: { label: 'Ar comprimido', title: 'Pressão e quantidade de ar de cada grupo de garrafas, junto às garrafas (com o corte/tanques)' },
  wake: { label: 'Esteira', title: 'Esteira, onda de proa, espuma, rastro do hélice, bolhas da descarga dos diesel e aspiração do snorkel' },
  wind: { label: 'Vento', title: 'Vento aparente: linhas de vento acima da água e flâmula na vela (na superfície)' },
  markers: { label: 'Boias/marcos', title: 'Boias e marcos de distância fixos no cenário' },
  trail: { label: 'Trajetória', title: 'Rastro do caminho percorrido' },
  trimRef: { label: 'Calado/trim', title: 'Calados AV/AR e linha d’água do casco × nível do mar' },
  ships: { label: 'Navios', title: 'Contatos da mesa tática como navios no mar' },
  presLight: { label: 'Iluminação', title: 'Luzes adicionais de apresentação', mode: true },
  noWater: { label: 'Sem água', title: 'Esconde o mar para ver o submarino isolado', mode: true },
};

/**
 * "3D completo" da segunda janela: tudo o que a cena externa mostra (vetores,
 * esteira e bolhas, vento, navios, boias, trajetória e rótulos), sem o corte do
 * casco — o mesmo conjunto em qualquer aba da janela de controle.
 */
export const fullExternalLayers = (): SceneLayers => ({
  ...defaultLayers(),
  vectors: true,
  hydroVectors: true,
  trimVectors: false,
  wake: true,
  wind: true,
  ships: true,
  markers: true,
  trail: true,
  labels: true,
  trimRef: false,
  tanks: false,
  hiddenVectors: [],
});

/** Grupos das camadas nos painéis (ordem de exibição). */
export const LAYER_GROUPS: { id: string; label: string; title: string; keys: Exclude<BoolLayer, 'hull'>[] }[] = [
  { id: 'vetores', label: 'Vetores', title: 'Forças sobre o submarino', keys: ['vectors', 'hydroVectors', 'trimVectors'] },
  { id: 'interior', label: 'Interior (corte)', title: 'Casco em corte: tanques, circuitos e componentes', keys: ['tanks', 'pipes', 'flows', 'batteryInfo', 'airInfo'] },
  { id: 'mar', label: 'Mar e efeitos', title: 'Esteira, vento, navios, boias e trajetória', keys: ['wake', 'wind', 'ships', 'markers', 'trail'] },
  { id: 'refs', label: 'Rótulos e referências', title: 'Identificações e referências de calado/trim', keys: ['labels', 'trimRef'] },
  { id: 'amb', label: 'Ambiente', title: 'Água e iluminação', keys: ['noWater', 'presLight'] },
];

/** “Marcar todas”: liga as camadas de informação da lista (não tira a água nem muda a luz). */
export function allLayersOn(keys: readonly Exclude<BoolLayer, 'hull'>[]): Partial<SceneLayers> {
  const p: Partial<SceneLayers> = {};
  for (const k of keys) if (!LAYER_INFO[k].mode) p[k] = true;
  if (keys.includes('vectors') || keys.includes('hydroVectors')) p.hiddenVectors = [];
  return p;
}

/**
 * Clique no nome de um grupo: com alguma camada ligada, desliga o grupo; senão
 * liga as camadas de informação do grupo — num grupo só de modos (Ambiente),
 * liga os modos (o "Marcar todas" geral continua sem tirar a água).
 */
export function toggleLayerGroup(keys: readonly Exclude<BoolLayer, 'hull'>[], value: Partial<SceneLayers>): Partial<SceneLayers> {
  if (keys.some((k) => !!value[k])) return allLayersOff(keys);
  const info = keys.filter((k) => !LAYER_INFO[k].mode);
  if (info.length) return allLayersOn(info);
  const p: Partial<SceneLayers> = {};
  for (const k of keys) p[k] = true;
  return p;
}

/** “Desmarcar todas”: desliga todas as camadas da lista, sem exceção. */
export function allLayersOff(keys: readonly Exclude<BoolLayer, 'hull'>[]): Partial<SceneLayers> {
  const p: Partial<SceneLayers> = {};
  for (const k of keys) p[k] = false;
  return p;
}

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
