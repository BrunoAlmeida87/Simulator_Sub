/**
 * CENAS DO TESTE VISUAL. Cada cena abre o app em um estado fixo (cenário carregado e pausado, hora do dia e qualidade fixas,
 * semente de aleatoriedade fixa por #teste-visual), espera os quadros assentarem e captura a tela.
 *
 *  id         nome do arquivo de referência (tests/visual/imagens-esperadas/<id>.png)
 *  scenario   id do cenário (SCENARIOS) carregado antes da captura; null = o cenário inicial do app
 *  screen     tecla da aba (0 Pilotagem, 2 Lastro, 6 Visualização 3D, 8 Sala de comando)
 *  ui         preferências de interface (localStorage 'sx1.ui.<chave>')
 *  graphics   preferências gráficas (localStorage 'sx1.graphics.v1'), por cima de BASE_GRAPHICS
 *  frames     quadros que cada cena 3D desenha desde que é criada, antes de congelar (cada quadro avança 0,1 s de animação no modo de teste)
 *  canvas     true: a cena tem <canvas> 3D (confere que não está em branco e conta quadros)
 *  mask       retângulos (pixels da janela) ignorados na comparação (relógios, números que mudam)
 *  mobile     tela estreita de celular
 *  downscale  1 ou 2: divide a imagem por esse fator antes de comparar/guardar (reduz ruído e peso)
 *  steps      ações extras no navegador antes de esperar os quadros
 */

/** preferências gráficas comuns: nada automático (a resolução automática dependeria da velocidade da máquina) */
export const BASE_GRAPHICS = { quality: 'alta', renderScale: 1, fpsMeter: false, sunHour: 10, sunTurn: 0, moonlight: true, navLights: 'auto', subLights: false, darkWater: false, traffic: 0, trimGain: 1 };

/** câmera livre no afastamento máximo (3 km do submarino), de 8° acima do horizonte: o ângulo em que apareciam os artefatos de água e costa */
const POSE_ZOOM_OUT = { pos: [0, 417, 2971], target: [0, 0, 0] };

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

export const SCENES = [
  { id: '01-superficie-externa', desc: 'Vista externa na superfície (Perspectiva)', scenario: 'superficie', screen: '6', canvas: true, frames: 24 },
  { id: '02-submerso', desc: 'Submerso a 50 m (vista de perfil)', scenario: 'submerso_50', screen: '6', ui: { 'v3d.view': 'perfil' }, canvas: true, frames: 24 },
  { id: '03-zoomout-sepetiba', desc: 'Zoom out máximo com costa ligada em Sepetiba (Itaguaí)', scenario: 'base_itaguai', screen: '6', ui: { 'v3d.view': 'livre', 'cam.v3d': POSE_ZOOM_OUT }, canvas: true, frames: 24 },
  { id: '04-zoomout-rio', desc: 'Zoom out máximo com costa ligada no Rio (Baía de Guanabara)', scenario: 'baia_guanabara', screen: '6', ui: { 'v3d.view': 'livre', 'cam.v3d': POSE_ZOOM_OUT }, canvas: true, frames: 24 },
  { id: '05-noite', desc: 'Noite na superfície (luzes de navegação e luar)', scenario: 'superficie', screen: '6', graphics: { sunHour: 23 }, canvas: true, frames: 24 },
  {
    id: '06-sala-posto',
    desc: 'Sala de comando, em foco no Posto de governo',
    scenario: 'superficie',
    screen: '8',
    ui: { 'room.help': false },
    canvas: true,
    frames: 40,
    steps: async (page) => {
      await page.getByRole('button', { name: /^Postos/ }).click();
      await page.getByRole('button', { name: /Posto de governo/ }).click();
    },
  },
  { id: '07-pilotagem', desc: 'Tela Pilotagem', scenario: 'superficie', screen: '0', canvas: true, frames: 24 },
  { id: '08-lastro', desc: 'Tela Lastro e compensação', scenario: 'superficie', screen: '2', canvas: false },
  {
    id: '09-celular-pilotagem',
    desc: 'Pilotagem em tela estreita (celular, 390 px; cenário inicial)',
    scenario: null,
    screen: '0',
    viewport: PHONE,
    mobile: true,
    downscale: 1,
    graphics: { quality: 'baixa' },
    canvas: true,
    frames: 24,
  },
];

export { DESKTOP, PHONE };
