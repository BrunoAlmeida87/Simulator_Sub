/**
 * DESFAZER das ações que trocam a simulação inteira: Reiniciar, Carregar cenário,
 * Iniciar cenário e Preparar situação de aula. Antes da troca guarda a sessão
 * completa (captureSession: estado, automações, aceleração); a mensagem da App
 * oferece “Desfazer” por UNDO_MS e restoreSession devolve tudo, pausado. Na
 * janela de tela a restauração vai à janela de controle (restoreSession já faz).
 * Não altera a física: é o mesmo mecanismo de salvar/carregar sessão.
 */
import { runner } from './store';
import { captureSession, restoreSession } from './session';
import type { SaveFile } from '../sim/persistence';

/** tempo em que “Desfazer” fica disponível */
export const UNDO_MS = 10000;

export interface UndoOffer {
  /** o que foi feito (texto da mensagem), ex. “Cenário reiniciado” */
  label: string;
  /** performance.now() da troca */
  at: number;
}

class ReplaceUndo {
  private save: SaveFile | null = null;
  offer: UndoOffer | null = null;
  /** a App mostra a mensagem com o botão “Desfazer” */
  onOffer: ((o: UndoOffer) => void) | null = null;

  /** há algo a perder? tempo simulado ou algum comando dado */
  worthKeeping(): boolean {
    const s = runner.engine.state;
    return s.t > 0 || s.commands.length > 0;
  }

  /**
   * Executa a troca guardando antes a simulação atual. Retorna true se ofereceu
   * “Desfazer” (havia algo a perder); quem chama pode então dispensar a própria mensagem.
   */
  run(label: string, replace: () => void): boolean {
    let save: SaveFile | null = null;
    if (this.worthKeeping()) {
      try {
        save = captureSession(`Antes de: ${label}`);
      } catch (ex) {
        console.warn('Não foi possível guardar a simulação para desfazer:', ex);
      }
    }
    replace();
    if (!save) return false;
    this.save = save;
    this.offer = { label, at: performance.now() };
    this.onOffer?.(this.offer);
    return true;
  }

  /** ainda dá para desfazer? */
  available(now = performance.now()): boolean {
    return !!this.save && !!this.offer && now - this.offer.at <= UNDO_MS;
  }

  /** volta à simulação guardada (pausada); false se não há o que desfazer ou o prazo passou */
  undo(now = performance.now()): boolean {
    if (!this.available(now)) return false;
    const s = this.save!;
    this.save = null;
    this.offer = null;
    restoreSession(s);
    return true;
  }
}

export const replaceUndo = new ReplaceUndo();
