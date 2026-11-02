/**
 * FAIXA DE ALARME — sempre no mesmo lugar (2ª linha da barra superior, em todas
 * as telas), com a mesma altura com ou sem alarme: a navegação não muda de
 * posição ao trocar de tela. Mostra o alarme mais grave (os não reconhecidos
 * primeiro): forma + prioridade + texto + sistema + há quanto tempo, “+N” outros,
 * **Ver** (abre o sistema afetado na Operação) e **Reconhecer** (só este alarme).
 * Um alarme novo não reconhecido é anunciado a leitores de tela (role="alert").
 * Só lê o estado; o reconhecimento é o Command 'ack' de sempre.
 */
import { useEffect, useRef, useState } from 'react';
import { cmd } from '../store';
import type { SimulationEngine } from '../../sim/core/engine';
import { visibleAlarms } from '../../sim/systems/alarms';
import { fmtTime } from '../format';
import { prioBadge, prioText } from '../alarmUi';
import { useUi } from '../uiContext';
import { opsBus, ALARM_GROUP } from '../ops/opsBus';

export function AlarmBand({ e }: { e: SimulationEngine }) {
  const ui = useUi();
  const s = e.state;
  const vis = visibleAlarms(s);
  const unack = vis.filter((a) => !a.acked);
  const top = unack[0] ?? vis[0];

  // leitor de tela: anuncia cada alarme novo não reconhecido (uma vez)
  const newest = unack[0];
  const newestKey = newest ? `${newest.def.id}@${newest.since}` : '';
  const lastKey = useRef('');
  const [said, setSaid] = useState('');
  useEffect(() => {
    if (newestKey && newestKey !== lastKey.current && newest) setSaid(`Alarme ${prioText(newest.def.priority)}: ${newest.def.text}. Sistema ${newest.def.system}.`);
    lastKey.current = newestKey;
  }, [newestKey]);

  const live = (
    <span className="sr-only" role="alert">
      {said}
    </span>
  );
  if (!top)
    return (
      <div className="alarmband ok">
        <span className="badge ok">● SEM ALARMES</span>
        {live}
      </div>
    );

  const lvl = prioBadge(top.def.priority);
  const others = vis.length - 1;
  const othersUnack = unack.filter((a) => a !== top).length;
  const open = () => {
    ui.setScreen('pilotagem');
    opsBus.focus(ALARM_GROUP[top.def.system] ?? 'alarmes');
  };
  return (
    <div className={`alarmband lvl-${lvl} ${top.acked ? '' : 'unack'}`}>
      <span className={`badge ${lvl} ${!top.acked && top.active ? 'blink' : ''}`}>{prioText(top.def.priority)}</span>
      <span className="ab-msg" title={top.def.text}>
        {top.def.text}
      </span>
      <span className="ab-meta">
        {top.def.system} · {top.active ? `há ${fmtTime(Math.max(0, s.t - top.since))}` : 'normalizado'}
        {top.acked ? ' · reconhecido' : ''}
      </span>
      {others > 0 && (
        <span className="ab-more" title={`Mais ${others} alarme(s) na lista${othersUnack ? ` (${othersUnack} sem reconhecer)` : ''}: Operação › Alarmes ou Sistemas › Segurança`}>
          +{others}
        </span>
      )}
      <button className="btn sm" onClick={open} title="Abre o sistema afetado na tela Operação">
        Ver
      </button>
      {!top.acked && (
        <button
          className="btn sm"
          onClick={() => cmd({ type: 'ack', id: top.def.id })}
          title={othersUnack ? `Reconhece este alarme. Os outros ${othersUnack} continuam aguardando na lista de alarmes.` : 'Reconhece este alarme'}
        >
          Reconhecer
        </button>
      )}
      {live}
    </div>
  );
}
