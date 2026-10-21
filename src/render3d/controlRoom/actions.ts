/**
 * AÇÕES DA SALA DE COMANDO. A cena 3D não altera a simulação: os painéis e
 * controles só montam COMANDOS (o mesmo tipo `Command` do resto do
 * simulador) e os entregam a estas funções, fornecidas pela interface
 * (React), que os aplicam pelo executor — aparecem no histórico e entram na
 * gravação, como os de qualquer outra tela.
 */
import type { Command } from '../../sim/commands';
import type { LatLon } from '../../sim/geo';

export interface RoomActions {
  cmd: (c: Command) => void;
  /** manobras rápidas (automação da interface que emite comandos) */
  maneuver: (kind: 'imergir' | 'emergir' | 'cancelar', target?: number) => void;
  maneuverStatus: () => string | null;
  /** abre a visada do periscópio */
  periscopeView: () => void;
  /** foco numa estação (aproximar a câmera e abrir o painel) */
  focus: (station: string) => void;
  sim: {
    running: () => boolean;
    toggleRun: () => void;
    timeScale: () => number;
    setTimeScale: (x: number) => void;
    scenarios: () => { id: string; name: string }[];
    loadScenario: (id: string) => void;
  };
  /** navios adicionais (Configurações → Gráficos) e origem geográfica, para sonar e quadro tático */
  traffic: () => number;
  geoOrigin: () => LatLon;
  /** rota por pontos (mapa tático): pontos restantes e destino atual */
  route: () => { points: { lat: number; lon: number }[]; idx: number; active: boolean };
}
