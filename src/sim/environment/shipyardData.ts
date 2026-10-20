/**
 * ESTALEIRO E BASE NAVAL DA ILHA DA MADEIRA (Itaguaí, RJ) — geometria em
 * latitude/longitude. ARQUIVO GERADO (scripts/shipyard/gen.py) a partir de
 * imagens Sentinel-2 L2A de 01/07/2026 e 21/07/2026 (10 m por pixel; banda
 * infravermelha para separar água e estruturas), conferidas com fotografias
 * aéreas. Precisão ≈ ±10 m. Contém dados modificados do Copernicus Sentinel (2026).
 *
 * Galpões: posição e tamanho ESTIMADOS (telhados na imagem de 10 m e fotos);
 * alturas estimadas. Profundidade dragada: estimada (não publicada).
 */
import type { LatLon } from '../geo';

const P = (a: [number, number][]): LatLon[] => a.map(([lat, lon]) => ({ lat, lon }));

export type MoleKind = 'enrocamento' | 'cais';
export interface MoleDef {
  id: string;
  name: string;
  kind: MoleKind;
  /** largura na linha d'água (m) */ width: number;
  pts: LatLon[];
}
export interface BuildingDef {
  id: string;
  name: string;
  center: LatLon;
  length: number;
  width: number;
  height: number;
  /** rumo do eixo maior (graus) */ bearing: number;
}

export const SHIPYARD_DATA = {
  /** aterro (pátio a +3 m) */
  platform: P([
    [-22.926148, -43.853104],
    [-22.925912, -43.852862],
    [-22.925636, -43.852133],
    [-22.925351, -43.851526],
    [-22.925068, -43.851163],
    [-22.92506, -43.850675],
    [-22.925255, -43.849455],
    [-22.925607, -43.848233],
    [-22.926393, -43.847617],
    [-22.92659, -43.846762],
    [-22.92644, -43.846032],
    [-22.926126, -43.84506],
    [-22.92567, -43.844478],
    [-22.925178, -43.843849],
    [-22.924574, -43.84283],
    [-22.926471, -43.842814],
    [-22.92783, -43.843387],
    [-22.929637, -43.84347],
    [-22.929765, -43.845516],
    [-22.929881, -43.845905],
    [-22.930199, -43.846244],
    [-22.930566, -43.846972],
    [-22.931024, -43.847846],
    [-22.931367, -43.848428],
    [-22.931823, -43.849034],
    [-22.931938, -43.849398],
    [-22.931263, -43.849697],
    [-22.930926, -43.849953],
    [-22.93059, -43.850287],
    [-22.929913, -43.850293],
    [-22.929798, -43.850026],
    [-22.92932, -43.849542],
    [-22.929044, -43.848838],
    [-22.928824, -43.848391],
    [-22.928408, -43.848395],
    [-22.927756, -43.848702],
    [-22.927194, -43.849073],
    [-22.92697, -43.849343],
    [-22.927314, -43.850047],
    [-22.927659, -43.850897],
    [-22.927435, -43.851192],
    [-22.927395, -43.851875],
    [-22.927265, -43.852656],
    [-22.927132, -43.853047],
  ]),
  moles: [
    {
      id: 'oeste',
      name: 'Quebra-mar oeste',
      kind: 'enrocamento',
      width: 26,
      pts: P([
        [-22.925979, -43.854734],
        [-22.926786, -43.854779],
        [-22.927927, -43.854965],
        [-22.92908, -43.855141],
        [-22.930099, -43.855311],
        [-22.931158, -43.855552],
        [-22.931421, -43.855402],
        [-22.931807, -43.855046],
        [-22.932309, -43.854604],
      ]),
    },
    {
      id: 'sul',
      name: 'Quebra-mar sul',
      kind: 'enrocamento',
      width: 22,
      pts: P([
        [-22.931865, -43.849253],
        [-22.932381, -43.85031],
        [-22.932958, -43.851284],
        [-22.933424, -43.852065],
        [-22.933674, -43.852738],
        [-22.934032, -43.854109],
        [-22.9344, -43.855112],
      ]),
    },
    {
      id: 'norte',
      name: 'Molhe norte',
      kind: 'enrocamento',
      width: 20,
      pts: P([
        [-22.925998, -43.854734],
        [-22.926057, -43.853007],
      ]),
    },
    {
      id: 'interno',
      name: 'Cais interno',
      kind: 'cais',
      width: 32,
      pts: P([
        [-22.928094, -43.854931],
        [-22.928267, -43.85329],
        [-22.928433, -43.852598],
        [-22.928314, -43.852035],
        [-22.92801, -43.851552],
        [-22.927659, -43.850897],
      ]),
    },
  ] as MoleDef[],
  /** shiplift (elevador de navios, 110 × 20 m, 8 000 t, 34 guinchos): da raiz no pátio até a ponta na bacia; largura total com os dois píeres dos guinchos */
  shiplift: { root: P([[-22.931325, -43.849482]])[0], tip: P([[-22.931695, -43.850707]])[0], width: 46 },
  /** área dragada: bacia, entrada e aproximação */
  dredge: P([
    [-22.928544, -43.854595],
    [-22.928579, -43.85323],
    [-22.928521, -43.851475],
    [-22.927971, -43.850407],
    [-22.92742, -43.849144],
    [-22.927959, -43.848652],
    [-22.928862, -43.848644],
    [-22.929412, -43.849712],
    [-22.929868, -43.850391],
    [-22.930771, -43.850383],
    [-22.931579, -43.849694],
    [-22.932216, -43.850274],
    [-22.932766, -43.851439],
    [-22.933316, -43.852605],
    [-22.933781, -43.854356],
    [-22.93415, -43.855426],
    [-22.933433, -43.85631],
    [-22.932166, -43.85593],
    [-22.931619, -43.855155],
    [-22.930355, -43.855263],
    [-22.929089, -43.855078],
  ]),
  dredgeDepth: 16,
  buildings: [
    { id: 'principal', name: 'Estaleiro de Construção — prédio principal', center: { lat: -22.928686, lon: -43.845574 }, length: 150, width: 60, height: 42, bearing: 59 },
    { id: 'manutencao', name: 'Estaleiro de Manutenção', center: { lat: -22.928154, lon: -43.844457 }, length: 75, width: 45, height: 34, bearing: 59 },
    { id: 'oficinas', name: 'Oficinas', center: { lat: -22.930227, lon: -43.84756 }, length: 160, width: 30, height: 20, bearing: 59 },
    { id: 'transferencia', name: 'Prédio de transferência (shiplift)', center: { lat: -22.930085, lon: -43.849122 }, length: 100, width: 38, height: 30, bearing: 59 },
    { id: 'administracao', name: 'Administração da base', center: { lat: -22.926469, lon: -43.852419 }, length: 60, width: 35, height: 16, bearing: 56 },
    { id: 'apoio1', name: 'Apoio e alojamentos', center: { lat: -22.926122, lon: -43.850715 }, length: 90, width: 35, height: 18, bearing: 56 },
    { id: 'apoio2', name: 'Apoio', center: { lat: -22.929299, lon: -43.844106 }, length: 40, width: 25, height: 12, bearing: 59 },
    { id: 'tenda', name: 'Tenda de montagem', center: { lat: -22.930884, lon: -43.8497 }, length: 40, width: 24, height: 12, bearing: 70.7 },
    { id: 'apoio3', name: 'Oficina de apoio', center: { lat: -22.926175, lon: -43.851787 }, length: 40, width: 20, height: 10, bearing: 56 },
    { id: 'apoio4', name: 'Almoxarifado', center: { lat: -22.925674, lon: -43.851255 }, length: 35, width: 22, height: 12, bearing: 56 },
    { id: 'apoio5', name: 'Apoio', center: { lat: -22.926778, lon: -43.852709 }, length: 26, width: 16, height: 9, bearing: 56 },
    { id: 'oficina2', name: 'Oficinas', center: { lat: -22.928496, lon: -43.848062 }, length: 50, width: 25, height: 12, bearing: 59 },
    { id: 'oficina3', name: 'Oficinas', center: { lat: -22.929075, lon: -43.846887 }, length: 60, width: 25, height: 14, bearing: 59 },
    { id: 'apoio6', name: 'Apoio', center: { lat: -22.927852, lon: -43.84641 }, length: 40, width: 30, height: 10, bearing: 59 },
    { id: 'apoio7', name: 'Apoio', center: { lat: -22.928466, lon: -43.84387 }, length: 45, width: 25, height: 12, bearing: 59 },
    { id: 'portaria', name: 'Portaria e controle', center: { lat: -22.926928, lon: -43.843493 }, length: 25, width: 15, height: 8, bearing: 59 },
  ] as BuildingDef[],
  /** tanques de combustível (2 × 700 m³) */
  tanks: P([
    [-22.926077, -43.843207],
    [-22.926283, -43.843088],
  ]),
  /** Porto Sudeste (vizinho a oeste; só referência visual): ponte de acesso e píer de minério */
  sudeste: {
    trestle: P([
      [-22.924456, -43.856453],
      [-22.924352, -43.851949],
    ]),
    pier: P([
      [-22.924583, -43.856423],
      [-22.931279, -43.858132],
    ]),
  },
};
