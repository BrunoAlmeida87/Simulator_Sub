/**
 * Estado da CENTRAL DE OPERAÇÃO (tela Operação): grupos abertos, grupos
 * fixados (até dois) e o "foco" — o grupo/objeto selecionado na cena, num
 * alarme ou na janela de visualização. Guardado no navegador.
 *
 * Regra de expansão: até dois grupos fixados e UM grupo livre aberto (abrir
 * outro fecha o anterior). "nav" (navegação) não aparece no painel lateral:
 * fica no console inferior, que pisca quando focado.
 */
import { loadPersisted, savePersisted } from '../persist';
import { runner } from '../store';

export type GroupId = 'nav' | 'lastro' | 'comp' | 'trim' | 'ar' | 'energia' | 'alarmes' | 'falhas' | 'ambiente' | 'guiados';

export const GROUP_ORDER: GroupId[] = ['nav', 'lastro', 'comp', 'trim', 'ar', 'energia', 'alarmes', 'falhas', 'ambiente', 'guiados'];

export const GROUP_TITLE: Record<GroupId, string> = {
  nav: 'Navegação',
  lastro: 'Lastro principal',
  comp: 'Compensação',
  trim: 'Trim e banda',
  ar: 'Ar comprimido',
  energia: 'Energia e mastros',
  alarmes: 'Alarmes',
  falhas: 'Falhas',
  ambiente: 'Ambiente e configuração',
  guiados: 'Roteiros automáticos',
};

/** ícone e cor de cada grupo (identificação rápida na lista lateral) */
export const GROUP_ICON: Record<GroupId, string> = {
  nav: '🧭',
  lastro: '🌊',
  comp: '💧',
  trim: '⚖️',
  ar: '💨',
  energia: '⚡',
  alarmes: '🔔',
  falhas: '🚨',
  ambiente: '🌦️',
  guiados: '🎬',
};

export const GROUP_COLOR: Record<GroupId, string> = {
  nav: '#4ade80',
  lastro: '#3b82f6',
  comp: '#2dd4bf',
  trim: '#b794ff',
  ar: '#7dd3fc',
  energia: '#fbbf24',
  alarmes: '#fb7185',
  falhas: '#f87171',
  ambiente: '#fb923c',
  guiados: '#f472b6',
};

/** nome curto (barra de atalhos do painel) */
export const GROUP_SHORT: Record<GroupId, string> = {
  nav: 'Governo',
  lastro: 'Lastro',
  comp: 'Compens.',
  trim: 'Trim/banda',
  ar: 'Ar AP',
  energia: 'Energia',
  alarmes: 'Alarmes',
  falhas: 'Falhas',
  ambiente: 'Ambiente',
  guiados: 'Roteiros',
};

/** seções da lista lateral (mesma ordem de GROUP_ORDER); "nav" fica no console inferior */
export const GROUP_SECTIONS: { title: string; groups: GroupId[] }[] = [
  { title: 'Flutuabilidade e equilíbrio', groups: ['lastro', 'comp', 'trim'] },
  { title: 'Sistemas auxiliares', groups: ['ar', 'energia'] },
  { title: 'Alarmes', groups: ['alarmes'] },
  { title: 'Instrutor', groups: ['falhas', 'ambiente', 'guiados'] },
];

/** grupos que aparecem no painel lateral */
export const SIDE_GROUPS: GroupId[] = GROUP_SECTIONS.flatMap((s) => s.groups);

/** objeto selecionado na cena 3D */
export interface PickTarget {
  kind: 'tank' | 'fin' | 'prop' | 'mast' | 'battery' | 'generator' | 'hp' | 'valve' | 'pump' | 'demoWeight';
  id: string;
  /** sistema (para válvulas e bombas) */
  sys?: string;
}

/** sistema de cada alarme → grupo da central */
export const ALARM_GROUP: Record<string, GroupId> = {
  'Ar comprimido': 'ar',
  Atitude: 'trim',
  Compartimentos: 'alarmes',
  Elétrico: 'energia',
  Fluidos: 'comp',
  Governo: 'alarmes',
  Hidráulica: 'alarmes',
  Instrumentação: 'alarmes',
  Lastro: 'lastro',
  Navegação: 'alarmes',
  Propulsão: 'energia',
  Segurança: 'alarmes',
};

/** estado salvo de versões anteriores: só grupos do painel, no máximo 1 livre e 2 fixados */
export function sanitizeOps(st: Partial<OpsState> | null | undefined): OpsState {
  const ok = (g: unknown): g is GroupId => SIDE_GROUPS.includes(g as GroupId);
  const pinned = [...new Set((st?.pinned ?? []).filter(ok))].slice(-2);
  const open = (st?.open ?? []).filter((g) => ok(g) && !pinned.includes(g)).slice(-1);
  return { open, pinned };
}

export interface OpsState {
  open: GroupId[];
  pinned: GroupId[];
}

class OpsBus {
  st: OpsState = sanitizeOps(loadPersisted<OpsState>('ops.groups', { open: ['lastro'], pinned: [] }));
  /** foco atual (realça o controle correspondente dentro do grupo) */
  focusGroup: GroupId | null = null;
  focusTarget: PickTarget | null = null;
  focusSeq = 0;
  /** tanque destacado na cena (conexões realçadas) */
  highlight: string | null = null;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    savePersisted('ops.groups', this.st);
    for (const l of this.listeners) l();
  }

  isOpen(g: GroupId): boolean {
    return this.st.open.includes(g) || this.st.pinned.includes(g);
  }
  /** abre/fecha um grupo livre; abrir fecha o outro grupo livre aberto (os fixados ficam) */
  toggle(g: GroupId): void {
    if (this.st.pinned.includes(g) || g === 'nav') return;
    this.st = { ...this.st, open: this.st.open.includes(g) ? [] : [g] };
    this.emit();
  }
  /** fixa até dois grupos (o mais antigo sai quando um terceiro é fixado); desafixado, continua aberto como livre */
  togglePin(g: GroupId): void {
    if (g === 'nav') return;
    if (this.st.pinned.includes(g)) this.st = { open: [g], pinned: this.st.pinned.filter((x) => x !== g) };
    else this.st = { open: this.st.open.filter((x) => x !== g), pinned: [...this.st.pinned, g].slice(-2) };
    this.emit();
  }
  collapseAll(): void {
    this.st = { ...this.st, open: [] };
    this.emit();
  }

  focus(g: GroupId, target: PickTarget | null = null): void {
    if (g !== 'nav' && !this.isOpen(g)) this.st = { ...this.st, open: [g] };
    this.focusGroup = g;
    this.focusTarget = target;
    this.focusSeq++;
    this.emit();
  }

  /** seleção de um objeto (cena, lista ou outra janela): abre o grupo e destaca o tanque */
  select(p: PickTarget | null): void {
    if (!p) {
      this.highlight = null;
      this.focusTarget = null;
      this.emit();
      return;
    }
    const v = runner.engine.vessel;
    let cat: string | undefined;
    if (p.kind === 'tank') {
      cat = v.ballast.tanks.some((t) => t.id === p.id) ? 'lastro' : v.compensation.tanks.some((t) => t.id === p.id) ? 'compensacao' : [v.trim.tankA.id, v.trim.tankB.id].includes(p.id) ? 'trim' : 'banda';
      this.highlight = this.highlight === p.id && this.focusTarget?.id === p.id ? null : p.id;
    } else if (p.kind === 'valve' && v.ballast.tanks.some((t) => t.id === p.id)) this.highlight = p.id;
    this.focus(this.groupFor(p, cat), p);
  }

  /** grupo correspondente a um objeto da cena */
  groupFor(p: PickTarget, tankCat?: string): GroupId {
    switch (p.kind) {
      case 'tank':
        return tankCat === 'compensacao' ? 'comp' : tankCat === 'trim' || tankCat === 'banda' ? 'trim' : 'lastro';
      case 'fin':
      case 'prop':
        return 'nav';
      case 'mast':
      case 'battery':
      case 'generator':
        return 'energia';
      case 'hp':
        return 'ar';
      case 'demoWeight':
        return 'trim';
      case 'valve':
      case 'pump':
        return p.sys === 'compensacao' ? 'comp' : p.sys === 'trim' || p.sys === 'heel' ? 'trim' : p.sys === 'HP' ? 'ar' : 'lastro';
    }
  }
}

export const opsBus = new OpsBus();
