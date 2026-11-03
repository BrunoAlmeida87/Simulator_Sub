/**
 * Escolhas de câmera da tela Armas (só exibição; nada da simulação):
 *  - id: arma acompanhada pelas vistas Torpedo e Míssil (cartão em "Em corrida"); null = a última lançada;
 *  - target: alvo acompanhado pela vista Alvo (botão Câmera da lista de alvos); null = o da última arma.
 */
export const weaponFollow: { id: string | null; target: string | null } = { id: null, target: null };

/** rótulos que ficam nas vistas de arma: armas, alvos hostis e explosões */
export const WEAPON_LABEL = /^(torp_|msl_|ini_|hst_|exp_|mexp_)/;
