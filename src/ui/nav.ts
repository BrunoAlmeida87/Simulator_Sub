/**
 * NAVEGAÇÃO em dois níveis: grupos (linha de cima) e telas do grupo (linha de baixo).
 * Módulo puro (sem React): App.tsx, NavBar.tsx e a visão geral dos sistemas usam;
 * tests/nav.test.ts confere que toda tela aparece uma vez e que a Sala de comando é a última.
 *
 * Organização (por tarefa, como nos simuladores de treinamento): operar o navio,
 * acompanhar os sistemas (visão geral → telas de detalhe), apresentar, analisar e ajustar.
 * As teclas 0–8 continuam abrindo as mesmas telas de antes.
 */

/** todas as telas (a ordem não importa: a ordem exibida é a de NAV_GROUPS) */
export const SCREEN_IDS = [
  'pilotagem',
  'comando',
  'governo',
  'mapa',
  'sonar',
  'sistemas',
  'lastro',
  'trim',
  'propulsao',
  'energia',
  'seguranca',
  'auxiliares',
  'apresentacao',
  'estudio',
  'v3d',
  'cenarios',
  'historico',
  'validacao',
  'config',
  'ajuda',
  'sala',
] as const;
export type ScreenId = (typeof SCREEN_IDS)[number];

export type NavGroupId = 'operacao' | 'sistemas' | 'apresentacao' | 'analise' | 'ajustes' | 'sala';

export interface NavScreen {
  id: ScreenId;
  label: string;
  /** tecla de atalho (0–8) */
  key?: string;
  /** dica (title) */
  hint: string;
}

export interface NavGroup {
  id: NavGroupId;
  label: string;
  /** rótulo curto (celular) */
  short: string;
  hint: string;
  screens: NavScreen[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'operacao',
    label: 'Operação',
    short: 'Operação',
    hint: 'Pilotar o submarino: central de operação, instrumentos, governo e mapa',
    screens: [
      { id: 'pilotagem', key: '0', label: 'Operação', hint: 'Central de operação: cena 3D, console de governo e todos os sistemas em grupos' },
      { id: 'comando', key: '1', label: 'Central de comando', hint: 'Instrumentos: profundidade, rumo, atitude, velocidade, lemes, telégrafo e piloto automático' },
      { id: 'governo', label: 'Governo', hint: 'Painel de governo: manche, alavancas, telégrafo e piloto' },
      { id: 'mapa', label: 'Mapa tático', hint: 'Posição geográfica, rota, contatos e fundo' },
      { id: 'sonar', label: 'Sonar', hint: 'Demonstração visual de pulso ativo, ecos e escuta passiva' },
    ],
  },
  {
    id: 'sistemas',
    label: 'Sistemas',
    short: 'Sistemas',
    hint: 'Visão geral dos sistemas e telas de detalhe: lastro, trim, propulsão, energia, segurança',
    screens: [
      { id: 'sistemas', label: 'Visão geral', hint: 'Cartões com o estado de cada sistema e atalhos para as telas de detalhe' },
      { id: 'lastro', key: '2', label: 'Lastro e compensação', hint: 'TLP, garrafas de ar AP, coletor e circuito de compensação' },
      { id: 'trim', key: '3', label: 'Trim e banda', hint: 'Distribuição de massas, G e B, transferências de trim e banda' },
      { id: 'propulsao', key: '4', label: 'Propulsão e energia', hint: 'Linha de eixo, hélice, bateria, cargas, diesel-geradores e snorkel' },
      { id: 'energia', label: 'Fluxo de energia', hint: 'Balanço elétrico como diagrama de fluxo' },
      { id: 'seguranca', key: '5', label: 'Segurança', hint: 'Alarmes, registro, sensores redundantes e injeção de falhas' },
      { id: 'auxiliares', label: 'Sistemas auxiliares', hint: 'Ar comprimido, hidráulica, elétrica e compartimentos: arquitetura e estado' },
    ],
  },
  {
    id: 'apresentacao',
    label: 'Apresentação',
    short: 'Apresentar',
    hint: 'Conduzir demonstrações: modo apresentação, estúdio de apresentações, cena 3D e biblioteca de cenários',
    screens: [
      { id: 'apresentacao', label: 'Apresentação', hint: 'Cena, tanques, forças e indicadores juntos, com situações de aula e câmera lenta' },
      { id: 'estudio', label: 'Estúdio', hint: 'Criar e apresentar as suas apresentações, etapa por etapa: texto, visualização, ações e gatilhos para avançar' },
      { id: 'v3d', key: '6', label: 'Visualização 3D', hint: 'Câmeras, corte com os tanques, vetores de força e camadas' },
      { id: 'cenarios', label: 'Cenários', hint: 'Biblioteca: condições iniciais, situações de aula e roteiros automáticos' },
    ],
  },
  {
    id: 'analise',
    label: 'Análise',
    short: 'Análise',
    hint: 'Gráficos do histórico e testes de validação da física',
    screens: [
      { id: 'historico', key: '7', label: 'Histórico', hint: 'Gráficos sincronizados, marcas dos comandos, antes × depois e CSV' },
      { id: 'validacao', label: 'Validação', hint: 'Testes de validação física executados no navegador' },
    ],
  },
  {
    id: 'ajustes',
    label: 'Ajustes e guia',
    short: 'Ajustes',
    hint: 'Configurações, sessões, gravações e o guia de operação',
    screens: [
      { id: 'config', label: '⚙ Configurações', hint: 'Sessões, gravações, identificação, gráficos, ambiente, fundo e parâmetros' },
      { id: 'ajuda', label: 'Guia', hint: 'Procedimento guiado, demonstração automática, convenções e atalhos' },
    ],
  },
  {
    id: 'sala',
    label: 'Sala de comando',
    short: 'Sala',
    hint: 'Primeira pessoa dentro da sala de controle: postos, painéis e periscópio',
    screens: [{ id: 'sala', key: '8', label: 'Sala de comando', hint: 'Andar pela sala de controle e operar o submarino pelos postos' }],
  },
];

const GROUP_OF = new Map<ScreenId, NavGroup>();
const SCREEN_OF = new Map<ScreenId, NavScreen>();
for (const g of NAV_GROUPS)
  for (const s of g.screens) {
    GROUP_OF.set(s.id, g);
    SCREEN_OF.set(s.id, s);
  }

export const isScreenId = (x: unknown): x is ScreenId => typeof x === 'string' && SCREEN_OF.has(x as ScreenId);

/** grupo a que pertence uma tela */
export const groupOf = (s: ScreenId): NavGroup => GROUP_OF.get(s) ?? NAV_GROUPS[0];

/** rótulo de uma tela (sem o ⚙ decorativo) */
export const screenLabel = (s: ScreenId): string => (SCREEN_OF.get(s)?.label ?? s).replace(/^⚙\s*/, '');

/** tela aberta por uma tecla 0–8 (as mesmas de antes da reorganização) */
export function screenForKey(k: string): ScreenId | null {
  for (const g of NAV_GROUPS) for (const s of g.screens) if (s.key === k) return s.id;
  return null;
}

/** tela a abrir ao clicar num grupo: a última usada nele, senão a primeira */
export function groupTarget(g: NavGroup, last: Partial<Record<NavGroupId, string>>): ScreenId {
  const l = last[g.id];
  return l && g.screens.some((s) => s.id === l) ? (l as ScreenId) : g.screens[0].id;
}

/** sistema do alarme → tela onde ele é tratado (marca discreta na navegação) */
export const ALARM_SCREEN: Record<string, ScreenId> = {
  'Ar comprimido': 'lastro',
  Atitude: 'trim',
  Compartimentos: 'seguranca',
  Elétrico: 'propulsao',
  Fluidos: 'lastro',
  Governo: 'comando',
  Hidráulica: 'auxiliares',
  Instrumentação: 'seguranca',
  Lastro: 'lastro',
  Navegação: 'comando',
  Propulsão: 'propulsao',
  Segurança: 'seguranca',
};

export type NavMark = 'alarm' | 'warn';

/**
 * Marcas de alarme por tela: 'alarm' (ativo de prioridade 1–2) ou 'warn' (demais
 * ativos ou não reconhecidos). A tela Segurança recebe a pior marca de todas.
 */
export function alarmMarks(alarms: { def: { system: string; priority: number }; active: boolean; acked: boolean }[]): Map<ScreenId, NavMark> {
  const out = new Map<ScreenId, NavMark>();
  const put = (s: ScreenId, m: NavMark) => {
    if (out.get(s) !== 'alarm') out.set(s, m);
  };
  for (const a of alarms) {
    const m: NavMark = a.active && a.def.priority <= 2 ? 'alarm' : 'warn';
    put(ALARM_SCREEN[a.def.system] ?? 'seguranca', m);
    put('seguranca', m);
  }
  return out;
}

/** pior marca entre as telas de um grupo */
export function groupMark(g: NavGroup, marks: Map<ScreenId, NavMark>): NavMark | undefined {
  let m: NavMark | undefined;
  for (const s of g.screens) {
    const x = marks.get(s.id);
    if (x === 'alarm') return 'alarm';
    if (x) m = x;
  }
  return m;
}
