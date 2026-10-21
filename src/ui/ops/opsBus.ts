/**
 * Estado da CENTRAL DE OPERAÇÃO (aba Pilotagem): grupos abertos, grupos
 * fixados (até dois) e o "foco" — o grupo/objeto selecionado na cena, num
 * alarme ou na janela de visualização. Guardado no navegador.
 */
import { loadPersisted, savePersisted } from '../persist';
import { runner } from '../store';

export type GroupId = 'nav' | 'lastro' | 'comp' | 'trim' | 'ar' | 'energia' | 'falhas' | 'ambiente' | 'guiados';

export const GROUP_ORDER: GroupId[] = ['nav', 'lastro', 'comp', 'trim', 'ar', 'energia', 'falhas', 'ambiente', 'guiados'];

export const GROUP_TITLE: Record<GroupId, string> = {
  nav: 'Navegação',
  lastro: 'Lastro principal',
  comp: 'Compensação',
  trim: 'Trim e banda',
  ar: 'Ar comprimido',
  energia: 'Energia e snorkel',
  falhas: 'Falhas e segurança',
  ambiente: 'Ambiente e configuração',
  guiados: 'Roteiros automáticos',
};

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
  Compartimentos: 'falhas',
  Elétrico: 'energia',
  Fluidos: 'comp',
  Governo: 'nav',
  Hidráulica: 'falhas',
  Instrumentação: 'falhas',
  Lastro: 'lastro',
  Navegação: 'nav',
  Propulsão: 'energia',
  Segurança: 'nav',
};

interface OpsState {
  open: GroupId[];
  pinned: GroupId[];
}

class OpsBus {
  st: OpsState = loadPersisted<OpsState>('ops.groups', { open: ['nav', 'lastro'], pinned: [] });
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
  toggle(g: GroupId): void {
    if (this.st.pinned.includes(g)) return;
    this.st = { ...this.st, open: this.st.open.includes(g) ? this.st.open.filter((x) => x !== g) : [...this.st.open, g] };
    this.emit();
  }
  /** fixa até dois grupos (o mais antigo sai quando um terceiro é fixado) */
  togglePin(g: GroupId): void {
    const p = this.st.pinned.includes(g) ? this.st.pinned.filter((x) => x !== g) : [...this.st.pinned, g].slice(-2);
    this.st = { ...this.st, pinned: p };
    this.emit();
  }
  collapseAll(): void {
    this.st = { ...this.st, open: [] };
    this.emit();
  }

  focus(g: GroupId, target: PickTarget | null = null): void {
    if (!this.isOpen(g)) this.st = { ...this.st, open: [...this.st.open, g] };
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
