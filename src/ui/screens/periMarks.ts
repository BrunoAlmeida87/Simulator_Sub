/**
 * MARCAÇÕES DO PERISCÓPIO (anotações da interface, não alteram a simulação):
 * cada "Marcar" guarda de onde o submarino observou, a marcação verdadeira e
 * a distância do estadímetro. Aparecem no quadro tático e na mesa da sala.
 */
import type { PeriMark } from '../../render3d/controlRoom/actions';

const marks: PeriMark[] = [];
let seq = 0;
const MAX = 12;

export const periMarks = {
  /** marcações válidas no tempo atual (depois de reiniciar, as do "futuro" somem) */
  list(t: number): PeriMark[] {
    return marks.filter((m) => m.t <= t + 1e-6);
  },
  all(): PeriMark[] {
    return marks;
  },
  add(m: Omit<PeriMark, 'label'>): PeriMark {
    seq += 1;
    const mk = { ...m, label: `P${seq}` };
    marks.push(mk);
    if (marks.length > MAX) marks.shift();
    return mk;
  },
  clear(): void {
    marks.length = 0;
    seq = 0;
  },
};
