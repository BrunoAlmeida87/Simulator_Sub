/**
 * BIBLIOTECA das apresentações do Estúdio: as do usuário ficam no navegador
 * (localStorage) e podem ser exportadas/importadas como arquivo .json; os
 * modelos embutidos (templates.ts) são somente leitura.
 */
import { normalizePresentation, clonePresentation, PRES_FORMAT, type UserPresentation } from './model';
import { BUILTIN_PRESENTATIONS } from './templates';
import { plainText } from './richText';
import { describeAction } from './actions';
import { describeCondition } from './variables';

const K_LIB = 'sx1.presentations.v1';

function readLib(): UserPresentation[] {
  try {
    const raw = localStorage.getItem(K_LIB);
    const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
    return Array.isArray(arr) ? arr.map((x) => normalizePresentation(x)).map((p) => ({ ...p, builtin: undefined })) : [];
  } catch {
    return [];
  }
}

class PresLibrary {
  private list: UserPresentation[] = readLib();
  private listeners = new Set<() => void>();
  /** último erro de gravação (ex.: espaço do navegador esgotado) */
  lastError: string | null = null;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const l of this.listeners) l();
  }

  /** apresentações do usuário (mais recentes primeiro) */
  mine(): UserPresentation[] {
    return [...this.list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  builtins(): UserPresentation[] {
    return BUILTIN_PRESENTATIONS;
  }

  get(id: string): UserPresentation | undefined {
    return this.list.find((p) => p.id === id) ?? BUILTIN_PRESENTATIONS.find((p) => p.id === id);
  }

  private persist(): boolean {
    try {
      localStorage.setItem(K_LIB, JSON.stringify(this.list));
      this.lastError = null;
      return true;
    } catch {
      this.lastError = 'O espaço do navegador para apresentações acabou. Exporte as apresentações para arquivo e remova estados guardados que não usa (cada estado ocupa ~25 KB).';
      return false;
    }
  }

  /** grava (cria ou atualiza); false se o navegador recusou (a versão em memória continua valendo) */
  save(p: UserPresentation): boolean {
    if (p.builtin) return false;
    const q = { ...p, updatedAt: new Date().toISOString() };
    const i = this.list.findIndex((x) => x.id === p.id);
    if (i >= 0) this.list[i] = q;
    else this.list.push(q);
    const ok = this.persist();
    this.emit();
    return ok;
  }

  remove(id: string): void {
    this.list = this.list.filter((p) => p.id !== id);
    this.persist();
    this.emit();
  }

  /** importa o texto de um arquivo (uma apresentação ou uma lista); ids repetidos ganham cópia */
  importText(text: string): { added: UserPresentation[]; error?: string } {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { added: [], error: 'O arquivo não é um JSON válido.' };
    }
    const items = Array.isArray(raw) ? raw : ((raw as { presentations?: unknown[] })?.presentations ?? [raw]);
    const added: UserPresentation[] = [];
    for (const it of items) {
      const r = it as { format?: unknown; steps?: unknown };
      if (!r || typeof r !== 'object' || (r.format !== PRES_FORMAT && !Array.isArray(r.steps))) continue;
      let p = normalizePresentation(it);
      if (p.builtin || this.get(p.id)) p = clonePresentation(p, p.name);
      this.save(p);
      added.push(p);
    }
    if (!added.length) return { added, error: 'Nenhuma apresentação do simulador encontrada no arquivo.' };
    return { added };
  }
}

export const presLibrary = new PresLibrary();

/** texto do arquivo exportado */
export function exportText(p: UserPresentation): string {
  const c: Partial<UserPresentation> = { ...p };
  delete c.builtin;
  return JSON.stringify(c, null, 1);
}

export function presFileName(p: UserPresentation, ext = 'json'): string {
  const clean = p.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `sx1-apresentacao-${clean || 'sem-nome'}.${ext}`;
}

/** tamanho aproximado em KB (estados guardados pesam) */
export const presSizeKB = (p: UserPresentation): number => Math.round(JSON.stringify(p).length / 1024);

const ADV_TXT = (p: UserPresentation, i: number): string => {
  const a = p.steps[i].advance;
  const base =
    a.mode === 'manual'
      ? 'quando o apresentador avançar'
      : a.mode === 'tempo'
        ? `depois de ${a.seconds} s`
        : `quando ${a.waitText || a.conditions.map(describeCondition).join(a.logic === 'todas' ? ' e ' : ' ou ') || '—'}`;
  const nx = a.next === '__fim' ? ' → encerra' : a.next ? ` → etapa ${p.steps.findIndex((s) => s.id === a.next) + 1}` : '';
  return base + nx;
};

/** Roteiro em texto (Markdown) para imprimir ou revisar: textos, notas, ações e gatilhos. */
export function scriptMarkdown(p: UserPresentation): string {
  const out: string[] = [`# ${p.name}`, ''];
  if (p.description) out.push(p.description, '');
  p.steps.forEach((s, i) => {
    out.push(`## ${i + 1}. ${s.title}`, '');
    if (s.text.trim()) out.push(plainText(s.text), '');
    if (s.why.trim()) out.push(`*Por quê:* ${plainText(s.why)}`, '');
    if (s.notes.trim()) out.push(`> Notas do apresentador: ${s.notes.replace(/\n/g, '\n> ')}`, '');
    if (s.actions.length) out.push('Ações:', ...s.actions.map((a) => `- ${a.delay > 0 ? `após ${a.delay} s: ` : ''}${describeAction(a)}`), '');
    out.push(`Avança: ${ADV_TXT(p, i)}`, '');
  });
  out.push('', '*Valores entre chaves {…} aparecem ao vivo durante a apresentação.*');
  return out.join('\n');
}
