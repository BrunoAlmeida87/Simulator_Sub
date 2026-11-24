/**
 * PALETA DE COMANDOS (Ctrl+K / ⌘K): busca por nome e abre qualquer tela ou executa uma ação rápida.
 * As ações passam pelas vias normais (runner / cmd), então funcionam também na janela de tela (＋ Tela).
 * Ações perigosas (sopro de emergência, reiniciar, trocar de cenário) ficam de fora de propósito.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { cmd, runner } from '../store';
import { NAV_GROUPS, screenLabel, viewsOf, type ScreenId } from '../nav';

interface Item {
  id: string;
  label: string;
  group: string;
  run: () => void;
  keys?: string;
  /** palavras extras para a busca (nome do modo, dica da tela) */
  extra?: string;
}

/** normaliza para a busca (sem acentos, minúsculas) */
const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/×/g, 'x').toLowerCase();

export function paletteMatches(label: string, query: string): boolean {
  const l = norm(label);
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => l.includes(w));
}

export function CommandPalette({ open, onClose, setScreen, toggleStage }: { open: boolean; onClose: () => void; setScreen: (s: ScreenId) => void; toggleStage: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const g of NAV_GROUPS)
      for (const s of g.screens)
        for (const v of viewsOf(s)) {
          const m = s.modes?.find((x) => x.id === v);
          out.push({ id: `tela:${v}`, label: screenLabel(v), group: `Tela · ${g.label}`, run: () => setScreen(v), extra: m ? m.hint : `${s.modeLabel ?? ''} ${s.hint}` });
        }
    const act = (id: string, label: string, run: () => void, keys?: string) => out.push({ id, label, group: 'Ação', run, keys });
    act('run', 'Executar / pausar a simulação', () => ((runner.running = !runner.running), runner.notify()), 'Espaço');
    act('x1', 'Velocidade da simulação ×1', () => ((runner.timeScale = 1), runner.notify()));
    act('x5', 'Velocidade da simulação ×5', () => ((runner.timeScale = 5), runner.notify()));
    act('x20', 'Velocidade da simulação ×20', () => ((runner.timeScale = 20), runner.notify()));
    act('ack', 'Reconhecer todos os alarmes', () => cmd({ type: 'ack', id: 'ALL' }));
    act('stage', 'Modo palco (tela limpa)', toggleStage, 'F');
    act('snork', 'Içar / arriar o snorkel', () => cmd({ type: 'snorkel', raise: !runner.engine.state.snorkel.cmd }));
    act('peri', 'Içar / arriar o periscópio', () => cmd({ type: 'periscope', raise: !runner.engine.state.periscope?.cmd }));
    act('gps', 'Corrigir a posição pelo GPS', () => cmd({ type: 'navFix', now: true }));
    act('decoy', 'Lançar despistador', () => cmd({ type: 'threat', action: 'decoy' }));
    act('stop', 'Telégrafo: parar máquinas', () => cmd({ type: 'telegraph', rpm: 0 }));
    act('tugs', 'Largar todos os rebocadores', () => cmd({ type: 'tug', id: 'ALL', mode: 'livre' }));
    return out;
  }, [setScreen, toggleStage]);
  // primeiro o que casa pelo nome; depois o que só casa pela dica
  const byName = items.filter((i) => paletteMatches(`${i.label} ${i.group}`, q));
  const byHint = items.filter((i) => !byName.includes(i) && paletteMatches(`${i.label} ${i.group} ${i.extra ?? ''}`, q));
  const list = [...byName, ...byHint].slice(0, 40);
  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);
  useEffect(() => setSel(0), [q]);
  if (!open) return null;
  const pick = (i: Item | undefined) => {
    if (!i) return;
    setQ('');
    onClose();
    i.run();
  };
  return (
    <div className="palette-back" onMouseDown={onClose} role="presentation">
      <div className="palette" role="dialog" aria-modal="true" aria-label="Paleta de comandos" onMouseDown={(ev) => ev.stopPropagation()}>
        <input
          ref={input}
          autoFocus
          value={q}
          placeholder="Buscar tela ou ação… (ex.: avarias, GPS, laboratório)"
          aria-label="Buscar tela ou ação"
          onChange={(ev) => setQ(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Escape') onClose();
            else if (ev.key === 'ArrowDown') {
              ev.preventDefault();
              setSel((x) => Math.min(list.length - 1, x + 1));
            } else if (ev.key === 'ArrowUp') {
              ev.preventDefault();
              setSel((x) => Math.max(0, x - 1));
            } else if (ev.key === 'Enter') pick(list[sel]);
            ev.stopPropagation();
          }}
        />
        <ul role="listbox">
          {list.map((i, k) => (
            <li key={i.id} role="option" aria-selected={k === sel} className={k === sel ? 'sel' : ''} onMouseEnter={() => setSel(k)} onClick={() => pick(i)}>
              <span>{i.label}</span>
              <span className="subtle">
                {i.group}
                {i.keys ? ` · ${i.keys}` : ''}
              </span>
            </li>
          ))}
          {!list.length && <li className="subtle">Nada encontrado.</li>}
        </ul>
        <div className="subtle palette-foot">↑ ↓ escolher · Enter abrir · Esc fechar</div>
      </div>
    </div>
  );
}
