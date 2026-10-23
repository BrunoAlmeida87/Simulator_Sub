/**
 * SUBIR À VELA (sala de comando): vista em primeira pessoa no PASSADIÇO, no
 * alto da vela, com olho nu e binóculo 7×50 (o painel vem do Scene3D na vista
 * 'passadico'). Cena própria: não muda a câmera nem as camadas da 2ª janela.
 * Só lê o estado.
 */
import { Scene3D, defaultQuality } from '../components/Scene3D';

export function RoomBridge({ onExit }: { onExit: () => void }) {
  return (
    <div className="room-peri room-bridge">
      <Scene3D
        view="passadico"
        quality={defaultQuality()}
        labels={false}
        syncVisual={false}
        onBridgeExit={onExit}
        layers={{
          vectors: false,
          hydroVectors: false,
          trimVectors: false,
          tanks: false,
          flows: false,
          pipes: false,
          labels: false,
          batteryInfo: false,
          airInfo: false,
          trail: false,
          trimRef: false,
          depthLines: false,
          noWater: false,
          markers: true,
          wake: true,
          // as faixas de vento passariam rente ao olho
          wind: false,
          ships: true,
          hull: true,
        }}
      />
    </div>
  );
}
