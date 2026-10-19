/** Procedimento guiado da sequência completa, com verificação contínua das condições físicas. */
import { runner, useSim } from '../store';
import { demo, type StepOutcome } from '../demo';
import { checklist, PROCEDURE } from '../checklist';
import { fmtTime } from '../format';

export { PROCEDURE };

const OUT_CLS: Record<StepOutcome, string> = {
  pendente: '',
  'em curso': 'cur',
  sucesso: 'done',
  'tempo esgotado': 'timeout',
  falha: 'fail',
  interrompida: 'timeout',
};
const OUT_ICON: Record<StepOutcome, string> = { pendente: '', 'em curso': '⟳ ', sucesso: '✓ ', 'tempo esgotado': '⌛ ', falha: '✗ ', interrompida: '■ ' };

/** Resultado da demonstração automática, etapa por etapa. */
export function DemoStatus() {
  useSim(4);
  if (!demo.active && !demo.final) return null;
  return (
    <div className="mb8">
      {demo.final && (
        <div className={`badge ${demo.final.fail ? 'alarm' : demo.final.timeout || demo.final.stopped ? 'warn' : 'ok'}`} style={{ marginBottom: 6 }}>
          {demo.final.stopped ? 'Demonstração interrompida' : demo.final.fail ? 'Demonstração encerrada por FALHA' : demo.final.timeout ? 'Concluída com etapas em TEMPO ESGOTADO' : 'Demonstração concluída com SUCESSO'} · {demo.final.ok}/{demo.steps.length} etapas com sucesso
        </div>
      )}
      <ol className="procedure" style={{ paddingLeft: 20, margin: 0 }}>
        {demo.steps.map((s, i) => {
          const o = demo.outcome[i] ?? 'pendente';
          return (
            <li key={s.name} className={OUT_CLS[o]}>
              {OUT_ICON[o]}
              {s.name}
              {o !== 'pendente' && o !== 'em curso' && <span className="subtle"> — {o}{demo.duration[i] ? ` (${fmtTime(demo.duration[i])})` : ''}</span>}
              {o === 'em curso' && <div className="subtle">Critério: {s.criterion} · limite {fmtTime(s.timeout)}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function ProcedurePanel() {
  const e = useSim(4);
  const cur = checklist.current;
  const nDone = checklist.status.filter((s) => s === 'realizada').length;
  const nPre = checklist.status.filter((s) => s === 'preexistente').length;
  return (
    <div>
      <div className="row mb8">
        {!demo.active ? (
          <button className="btn ok" onClick={() => demo.start(runner)}>
            ▶ Demonstração automática
          </button>
        ) : (
          <button className="btn warn" onClick={() => demo.stop(runner)}>
            ■ Parar demonstração (etapa {demo.k + 1}/{demo.steps.length})
          </button>
        )}
        <button className="btn sm" onClick={() => checklist.reset(e)} title="As condições já verdadeiras agora ficam marcadas como preexistentes">
          Reiniciar checklist
        </button>
      </div>
      <DemoStatus />
      <div className="subtle mb8">
        {nDone} realizadas · {nPre} já existentes no início · {PROCEDURE.length - nDone - nPre} pendentes
      </div>
      <ol className="procedure" style={{ paddingLeft: 20, margin: 0 }}>
        {PROCEDURE.map((s, i) => {
          const st = checklist.status[i];
          return (
            <li key={s.title} className={st === 'realizada' ? 'done' : st === 'preexistente' ? 'pre' : i === cur ? 'cur' : ''}>
              {st === 'realizada' ? '✓ ' : st === 'preexistente' ? '◦ ' : ''}
              {s.title}
              {st === 'realizada' && checklist.tDone[i] !== null && <span className="subtle"> — realizada em {fmtTime(checklist.tDone[i]!)}</span>}
              {st === 'preexistente' && <span className="subtle"> — condição já existente no início</span>}
              {i === cur && <div className="subtle">{s.hint}</div>}
            </li>
          );
        })}
      </ol>
      <div className="note">As etapas são marcadas automaticamente quando a condição física é atingida (não basta clicar), mesmo com este painel fechado. Condições que já eram verdadeiras no início aparecem como “já existentes” e não contam como realizadas. A demonstração automática executa o mesmo roteiro do teste V12 — inicie-a a partir do cenário "Superfície — pronto para imergir".</div>
    </div>
  );
}
