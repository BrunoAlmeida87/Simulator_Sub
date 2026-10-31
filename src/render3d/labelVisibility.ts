/** Filtros de texto; não alteram a visibilidade dos objetos ou a física. */
export const LABEL_CATEGORIES = [
  ['tanks', 'Tanques'], ['valves', 'Válvulas'], ['pumps', 'Bombas'],
  ['energy', 'Bateria e geradores'], ['air', 'Ar comprimido'],
  ['forces', 'Forças e momentos'], ['cargo', 'Cargas e peso deslocável'],
  ['ships', 'Navios e contatos'], ['places', 'Costa e estaleiro'],
  ['attitude', 'Calados e atitude'], ['weapons', 'Torpedos, alvos e explosões'],
  ['environment', 'Vento, superfície e fundo'],
] as const;
export type LabelCategory = (typeof LABEL_CATEGORIES)[number][0];
export interface LabelVisibility {
  categories: Record<LabelCategory, boolean>;
  details: boolean;
  hidden: Record<string, string>;
}
export function defaultLabelVisibility(): LabelVisibility {
  return { categories: Object.fromEntries(LABEL_CATEGORIES.map(([id]) => [id, id !== 'environment' && id !== 'places'])) as Record<LabelCategory, boolean>, details: false, hidden: {} };
}
export function labelCategory(id: string): LabelCategory {
  if (id.startsWith('tk')) return 'tanks';
  if (id.startsWith('vl')) return 'valves';
  if (id.startsWith('pm')) return 'pumps';
  if (id.startsWith('pw')) return 'energy';
  if (id.startsWith('air')) return 'air';
  if (id.startsWith('ship')) return 'ships';
  if (id.startsWith('rio-') || id === 'estaleiro') return 'places';
  if (id.startsWith('cg_') || id === 'dwB') return 'cargo';
  if (id.startsWith('dr') || id.startsWith('pAng')) return 'attitude';
  if (id.startsWith('torp_') || id.startsWith('ini_') || id.startsWith('exp_')) return 'weapons';
  if (/^(f[PERGB]|h(prop|drag|bow|stern|rudder)|dw[PM]|tv|tmN)/.test(id)) return 'forces';
  return 'environment';
}
export function labelIsVisible(id: string, prefs: LabelVisibility): boolean {
  return prefs.categories[labelCategory(id)] && !Object.hasOwn(prefs.hidden, id);
}
/** Dados salvos antigos ou inválidos nunca removem categorias novas. */
export function parseLabelVisibility(raw: unknown): LabelVisibility {
  const result = defaultLabelVisibility();
  if (!raw || typeof raw !== 'object') return result;
  const v = raw as Partial<LabelVisibility>;
  for (const [key] of LABEL_CATEGORIES) if (typeof v.categories?.[key] === 'boolean') result.categories[key] = v.categories[key];
  if (typeof v.details === 'boolean') result.details = v.details;
  if (v.hidden && typeof v.hidden === 'object') {
    for (const [id, title] of Object.entries(v.hidden)) if (typeof title === 'string') Object.defineProperty(result.hidden, id, { value: title, enumerable: true, configurable: true, writable: true });
  }
  return result;
}
