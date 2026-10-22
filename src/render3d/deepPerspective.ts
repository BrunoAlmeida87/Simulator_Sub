/**
 * PERSPECTIVA PROFUNDA (só visual): leva às outras vistas o efeito da vista
 * "Perspectiva" — lente grande-angular com a câmera mais perto. O campo de
 * visão aumenta e a câmera se aproxima do ponto de mira na mesma proporção
 * (efeito "dolly-zoom"), de modo que o submarino continua do mesmo tamanho no
 * quadro, mas o que está mais perto da câmera cresce e o que está longe
 * diminui: mais sensação de profundidade.
 */
import type { ViewMode } from './SubmarineScene';

/** campo de visão vertical normal das vistas de 3ª pessoa (°) */
export const BASE_FOV = 50;

export type DeepLevel = 'leve' | 'media' | 'forte';

/** campo de visão (°) de cada intensidade */
export const DEEP_FOVS: Record<DeepLevel, number> = { leve: 65, media: 78, forte: 92 };
export const DEEP_LABELS: Record<DeepLevel, string> = { leve: 'Leve', media: 'Média', forte: 'Forte' };

/**
 * Vistas que recebem a perspectiva profunda. Ficam de fora: a própria
 * "Perspectiva", o "Calado" (teleobjetiva para ler a linha d'água sem
 * distorção), o "Navio próximo" (enquadra um navio distante) e as vistas em
 * primeira pessoa (periscópio, passadiço e drone, com a óptica própria).
 */
export const DEEP_VIEWS: ReadonlySet<ViewMode> = new Set<ViewMode>(['superficie', 'submerso', 'tanques', 'forcas', 'piloto', 'perseguicao', 'perfil', 'frente', 'topo', 'fixa', 'livre']);

const tanHalf = (fovDeg: number) => Math.tan((Math.max(1, Math.min(170, fovDeg)) * Math.PI) / 360);

/**
 * Quanto a distância câmera–alvo muda ao passar do campo de visão `fromFov`
 * para `toFov` mantendo o mesmo tamanho do alvo no quadro (< 1 = aproxima).
 */
export function dollyRatio(fromFov: number, toFov: number): number {
  return tanHalf(fromFov) / tanHalf(toFov);
}

/** aproxima (ou afasta) a posição p do ponto de mira t pelo fator k: t + (p − t)·k */
export function dollyPoint<V extends { x: number; y: number; z: number }>(p: V, t: { x: number; y: number; z: number }, k: number): { x: number; y: number; z: number } {
  return { x: t.x + (p.x - t.x) * k, y: t.y + (p.y - t.y) * k, z: t.z + (p.z - t.z) * k };
}
