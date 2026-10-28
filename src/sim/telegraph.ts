/**
 * Ordens do telégrafo de máquinas (rótulo → rpm ordenado) usadas pela sala de
 * comando. Mesma tabela de `TELEGRAPH` em ui/components/Controls.tsx (o teste
 * tests/controlRoom.test.ts confere que as duas continuam iguais).
 */
export const TELEGRAPH: { label: string; rpm: number }[] = [
  { label: 'RÉ TODA', rpm: -110 },
  { label: 'RÉ MEIA', rpm: -60 },
  { label: 'RÉ DEV.', rpm: -30 },
  { label: 'PARAR', rpm: 0 },
  { label: 'AV DEV.', rpm: 40 },
  { label: 'AV MEIA', rpm: 75 },
  { label: 'AV 3/4', rpm: 115 },
  { label: 'AV TODA', rpm: 160 },
];

/** ordem do telégrafo mais próxima de um rpm */
export const nearestOrder = (rpm: number) => TELEGRAPH.reduce((a, t) => (Math.abs(t.rpm - rpm) < Math.abs(a.rpm - rpm) ? t : a), TELEGRAPH[0]);
