/**
 * Trava das automações durante a reprodução de uma gravação: manobras,
 * demonstração, cenários guiados e rota não começam nem avançam enquanto a
 * reprodução estiver ativa (os comandos que elas emitiram já estão na
 * gravação; executá-los de novo duplicaria as ações).
 */
export const replayLock = { active: false };
