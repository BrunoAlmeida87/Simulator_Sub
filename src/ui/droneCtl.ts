/**
 * Estado da CÂMERA DRONE nesta janela: pose no mundo (compartilhada pelas
 * cenas que mostram o drone e guardada nas preferências) e comandos de voo
 * (teclado, botões de toque, roda). Só visual: não altera a simulação.
 */
import { loadPersisted, savePersisted } from './persist';
import { droneIdle, type DroneInput, type DronePose } from '../render3d/drone';

export const droneCtl: {
  /** pose atual (null = recomeça acima e atrás do submarino) */
  pose: DronePose | null;
  /** comandos lidos pela cena a cada quadro (o objeto é o mesmo; os campos mudam) */
  input: DroneInput;
  save(): void;
  reset(): void;
} = {
  pose: loadPersisted<DronePose | null>('drone.pose', null),
  input: { ...droneIdle(), speedMul: loadPersisted('drone.speedMul', 1) },
  save() {
    savePersisted('drone.pose', this.pose);
    savePersisted('drone.speedMul', this.input.speedMul);
  },
  reset() {
    this.pose = null;
    savePersisted('drone.pose', null);
  },
};
