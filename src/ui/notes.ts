/**
 * NOTAS EXPLICATIVAS RECOLHÍVEIS — as notas (.note) dentro de painéis mostram só
 * as duas primeiras linhas (global.css); as que passam disso ganham
 * data-clamped e viram um "botão": clique, Enter ou Espaço abrem/fecham a nota
 * inteira. Notas com controles dentro (botões, campos) ficam sempre abertas.
 * Só mexe em atributos e classes do DOM: nada da simulação.
 */
const SEL = '.panel .note';
const INTERACTIVE = 'a, button, input, select, textarea, label';

function setClamped(n: HTMLElement, on: boolean): void {
  if (on) {
    n.dataset.clamped = '1';
    n.tabIndex = 0;
    n.setAttribute('role', 'button');
    n.setAttribute('aria-expanded', String(n.classList.contains('open')));
    n.title = 'Clique para ler a nota inteira (ou fechar)';
  } else {
    delete n.dataset.clamped;
    n.removeAttribute('tabindex');
    n.removeAttribute('role');
    n.removeAttribute('aria-expanded');
    n.removeAttribute('title');
  }
}

/** marca as notas cortadas (chamado periodicamente: as telas mudam o texto) */
export function markNotes(root: ParentNode = document): void {
  for (const n of root.querySelectorAll<HTMLElement>(SEL)) {
    if (n.querySelector(INTERACTIVE)) {
      n.classList.add('no-clamp');
      continue;
    }
    if (n.classList.contains('open')) continue;
    const over = n.scrollHeight > n.clientHeight + 2;
    if (over !== !!n.dataset.clamped) setClamped(n, over);
  }
}

function toggle(n: HTMLElement): void {
  const open = !n.classList.contains('open');
  n.classList.toggle('open', open);
  n.setAttribute('aria-expanded', String(open));
}

/** liga o comportamento uma vez (App); devolve a função que desliga */
export function installCollapsibleNotes(doc: Document = document): () => void {
  const click = (ev: MouseEvent) => {
    const t = ev.target as HTMLElement | null;
    if (!t || t.closest(INTERACTIVE)) return;
    const n = t.closest<HTMLElement>(`${SEL}[data-clamped]`);
    if (n) toggle(n);
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const n = ev.target as HTMLElement | null;
    if (!n?.matches?.(`${SEL}[data-clamped]`)) return;
    ev.preventDefault();
    ev.stopPropagation();
    toggle(n);
  };
  doc.addEventListener('click', click);
  doc.addEventListener('keydown', key, true);
  markNotes(doc);
  const id = window.setInterval(() => markNotes(doc), 1200);
  return () => {
    doc.removeEventListener('click', click);
    doc.removeEventListener('keydown', key, true);
    window.clearInterval(id);
  };
}
