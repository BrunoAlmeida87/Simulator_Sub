/**
 * IDENTIFICAÇÃO DO SUBMARINO — nome, inscrição vermelha da vela, emblema e
 * cores de destaque. É apenas visual: não altera nenhum parâmetro físico.
 * Guardada no navegador, enviada à segunda janela e incluída nos arquivos
 * de sessão (para que o arquivo compartilhado mostre a mesma identificação).
 */
import type { EmblemKind } from '../render3d/sailArt';
export type { EmblemKind };

export interface Identity {
  /** nome exibido nos painéis, no mapa e na barra superior */
  name: string;
  /** inscrição pintada na vela (vermelha) */
  sailText: string;
  /** cor da inscrição da vela */
  sailTextColor: string;
  /** emblema na vela */
  emblem: EmblemKind;
  /** imagem do emblema personalizado (data URL PNG/JPG/SVG), se houver */
  emblemImage: string | null;
  /** cor dos lemes (destaque) */
  finColor: string;
}

export const DEFAULT_IDENTITY: Identity = {
  name: 'S50 Vasco da Gama',
  sailText: 'S50',
  sailTextColor: '#d4161c',
  emblem: 'vasco',
  emblemImage: null,
  finColor: '#e8892b',
};

export const FIN_COLORS: [string, string][] = [
  ['#e8892b', 'Laranja'],
  ['#ffd23f', 'Amarelo'],
  ['#e8262c', 'Vermelho'],
  ['#3ddc84', 'Verde'],
  ['#36c5f0', 'Ciano'],
  ['#f2f2f2', 'Branco'],
  ['#3a4652', 'Cor do casco (discreto)'],
];

const KEY = 'sx1.identity.v1';
const MAX_IMAGE = 600_000; // caracteres do data URL (~450 kB)

function sanitize(p: Partial<Identity> | null | undefined, base: Identity): Identity {
  const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
  const img = typeof p?.emblemImage === 'string' && p.emblemImage.startsWith('data:image/') && p.emblemImage.length <= MAX_IMAGE ? p.emblemImage : p?.emblemImage === null ? null : base.emblemImage;
  const emblem = p?.emblem === 'vasco' || p?.emblem === 'nenhum' || p?.emblem === 'personalizado' ? p.emblem : base.emblem;
  return {
    name: typeof p?.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 40) : base.name,
    sailText: typeof p?.sailText === 'string' ? p.sailText.slice(0, 16) : base.sailText,
    sailTextColor: hex(p?.sailTextColor, base.sailTextColor),
    emblem: emblem === 'personalizado' && !img ? 'vasco' : emblem,
    emblemImage: img,
    finColor: hex(p?.finColor, base.finColor),
  };
}

class IdentityStore {
  private v: Identity;
  /** muda a cada alteração (a cena 3D refaz as texturas quando muda) */
  rev = 0;
  private listeners = new Set<() => void>();

  constructor() {
    let saved: Partial<Identity> | null = null;
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
      saved = raw ? (JSON.parse(raw) as Partial<Identity>) : null;
    } catch {
      saved = null;
    }
    this.v = sanitize(saved, DEFAULT_IDENTITY);
    if (typeof window !== 'undefined')
      window.addEventListener('storage', (ev) => {
        // outra janela do simulador alterou a identificação
        if (ev.key === KEY && ev.newValue) {
          try {
            this.v = sanitize(JSON.parse(ev.newValue) as Partial<Identity>, this.v);
            this.rev++;
            this.emit();
          } catch {
            /* ignora */
          }
        }
      });
  }

  get(): Identity {
    return this.v;
  }

  /** altera (parcialmente); persist = guardar no navegador */
  set(p: Partial<Identity>, persist = true): void {
    const nv = sanitize({ ...this.v, ...p }, this.v);
    if (JSON.stringify(nv) === JSON.stringify(this.v)) return;
    this.v = nv;
    this.rev++;
    if (persist) {
      try {
        localStorage.setItem(KEY, JSON.stringify(nv));
      } catch {
        /* armazenamento cheio/indisponível: vale só nesta sessão */
      }
    }
    this.emit();
  }

  reset(): void {
    this.set({ ...DEFAULT_IDENTITY });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

export const identity = new IdentityStore();
