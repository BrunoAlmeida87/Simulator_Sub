/**
 * ESTAÇÕES da sala de comando: nome, descrição (como é num submarino real)
 * e enquadramento da câmera ao aproximar. Coordenadas da sala (m): x para
 * boreste, y para cima (piso = 0), z para ré (vante = −z).
 */
export interface StationDef {
  id: string;
  name: string;
  /** função do posto num submarino real */
  info: string;
  view: { pos: [number, number, number]; look: [number, number, number] };
}

export const STATIONS: StationDef[] = [
  {
    id: 'governo',
    name: 'Posto de governo',
    info: 'Dois operadores sentados lado a lado, de frente para a proa: o PLANADOR (esquerda) governa os lemes horizontais de ré; o TIMONEIRO (direita) governa o leme de direção e os lemes de vante. Manches tipo aeronave: girar = leme de direção; empurrar = descer, puxar = subir. Ao centro, o telégrafo de máquinas e a tela do oficial de manobra (pilotos automáticos e manobras).',
    view: { pos: [-1.25, 1.32, -5.2], look: [-1.25, 1.1, -6.35] },
  },
  {
    id: 'instrumentos',
    name: 'Instrumentos de mergulho',
    info: 'Na antepara de vante, à vista do posto de governo: profundímetro principal e de precisão (cota periscópica), odômetro, repetidora da girobússola, relógio, inclinômetro de bolha (caturro) e clinômetro de pêndulo (banda).',
    view: { pos: [-1.1, 1.62, -4.6], look: [-1.1, 2.0, -6.95] },
  },
  {
    id: 'alarmes',
    name: 'Anunciador de alarmes',
    info: 'Uma janela por alarme: acende quando a condição está ativa e pisca até ser reconhecida (vermelho = crítico/alto, âmbar = médio, branco = informativo). Botões de reconhecimento e teste de lâmpadas.',
    view: { pos: [0.95, 1.7, -5.6], look: [0.95, 2.15, -6.95] },
  },
  {
    id: 'lastro',
    name: 'Painel de controle do lastro',
    info: 'Do encarregado de quarto: suspiros (abrir = alagar = imergir) e sopro (ar AP expulsa a água = emergir) de cada tanque de lastro, indicador de aberturas do casco ("árvore de Natal": verde = fechada, vermelho = aberta; "quadro verde" = casco estanque), ar de alta pressão, compressor e as alavancas do SOPRO DE EMERGÊNCIA (levantar a tampa e puxar).',
    view: { pos: [1.2, 1.48, -5.0], look: [2.3, 1.38, -5.0] },
  },
  {
    id: 'mergulho',
    name: 'Console de segurança do mergulho',
    info: 'Ajuste fino do peso e da atitude: COMPENSAÇÃO (admitir/esgotar água do mar nos tanques TC-1/TC-2) e transferência interna de TRIM (vante ⇄ ré) e BANDA (BB ⇄ BE), com válvulas, bombas e sequências automáticas de dosagem.',
    view: { pos: [1.55, 1.28, -2.55], look: [2.3, 1.1, -2.55] },
  },
  {
    id: 'coletor',
    name: 'Coletor de válvulas e hidráulica',
    info: 'Válvulas manuais (volantes) de isolamento do ar AP, admissão/descarga de mar e trim/banda, manômetros do ar AP e a pressão da planta hidráulica que aciona lemes, válvulas e mastros.',
    view: { pos: [1.05, 1.5, -1.0], look: [2.3, 1.3, -1.0] },
  },
  {
    id: 'plataforma',
    name: 'Console da plataforma',
    info: 'Gestão integrada da plataforma: bateria e disjuntor principal, diesel-geradores, mastro do snorkel, combustível e cargas; motor elétrico principal, planta hidráulica e compressor.',
    view: { pos: [1.55, 1.28, 0.55], look: [2.3, 1.1, 0.55] },
  },
  {
    id: 'periscopio',
    name: 'Periscópio de ataque',
    info: 'Içado pelo cilindro hidráulico (alavanca na coluna ao lado). Com o periscópio içado e a cabeça fora d’água, a visada mostra a superfície; gire com os punhos (arrastar) e alterne o aumento. Clique na ocular para olhar.',
    view: { pos: [0.0, 1.62, -1.55], look: [0.0, 1.45, -2.75] },
  },
  {
    id: 'sonar',
    name: 'Console de sonar',
    info: 'Console multifunção: cascata do sonar passivo (marcação relativa × tempo; o ruído próprio cresce com a velocidade e há uma zona cega a ré) e a lista de contatos, com a interceptação de radar (MAGE) quando há mastro fora d’água.',
    view: { pos: [-1.45, 1.5, -3.0], look: [-2.3, 1.32, -3.0] },
  },
  {
    id: 'combate',
    name: 'Console tático',
    info: 'Quadro tático do sistema de combate (fictício, sem armamento): próprio navio, derrota, contatos com vetores de 6 minutos, ponto de maior aproximação (PMA) e escalas.',
    view: { pos: [-1.45, 1.5, -1.75], look: [-2.3, 1.32, -1.75] },
  },
  {
    id: 'navegacao',
    name: 'Console de navegação',
    info: 'Navegação inercial (INS), GPS (só com antena fora d’água), odômetro Doppler, ecobatímetro, posição estimada e a rota traçada no Mapa tático.',
    view: { pos: [-1.45, 1.5, -0.5], look: [-2.3, 1.32, -0.5] },
  },
  {
    id: 'mesa',
    name: 'Mesa tática',
    info: 'Carta horizontal no centro da sala, consultada de pé pelo comandante e pelo oficial de quarto: terra e águas rasas (mesmo fundo da física), derrota, rota, contatos e área de exercícios.',
    view: { pos: [0.0, 2.0, 3.85], look: [0.0, 0.95, 2.75] },
  },
  {
    id: 'instrutor',
    name: 'Estação do instrutor',
    info: 'Específica do simulador de treinamento: injeção e remoção de falhas, estado do mar, tempo da simulação, cenários, peso deslocável e iluminação da sala.',
    view: { pos: [-1.25, 1.28, 5.6], look: [-1.25, 1.1, 6.4] },
  },
];

export const stationById = (id: string) => STATIONS.find((s) => s.id === id);

/** posição inicial (de pé, à ré da mesa tática, olhando para vante) */
export const START_POSE = { pos: [0.55, 1.65, 5.1] as [number, number, number], yaw: 0.05, pitch: -0.1 };
