/** Cartão de narração do roteiro automático e lista de roteiros. */
import { runner, useSim } from '../store';
import { tours, TOURS, type Tour, type TourOutcome } from '../tours';
import { useUi } from '../uiContext';
import { fmtTime } from '../format';
import { usePersisted } from '../persist';

const ICON: Record<TourOutcome, string> = { pendente: '○', 'em curso': '▶', concluída: '✓', 'tempo esgotado': '⌛', pulada: '↷' };

export function TourCard({ compact }: { compact?: boolean }) {
  const e = useSim(4);
  const t = tours;
  const [small, setSmall] = usePersisted('tour.collapsed', false);
  if (!t.tour || (!t.active && !t.finished)) return null;
  const steps = t.tour.steps;
  if (!t.active && t.finished) {
    const f = t.finished;
    return (
      <div className="tourcard">
        <div className="tc-head">
          <span className={`badge ${f.timeout ? 'warn' : f.skipped ? 'warn' : 'ok'}`}>{f.timeout ? 'CONCLUÍDO COM TEMPO ESGOTADO' : f.skipped ? 'ENCERRADO' : 'CONCLUÍDO'}</span>
          <b>{t.tour.name}</b>
        </div>
        <div className="subtle">
          {f.ok}/{steps.length} etapas concluídas · duração {fmtTime(f.duration)} de simulação
        </div>
        <div className="row mt4" style={{ pointerEvents: 'auto' }}>
          <button className="btn sm ok" onClick={() => tours.start(runner, t.tour!)}>
            ↺ Repetir
          </button>
          <button className="btn sm" onClick={() => ((t.finished = null), runner.notify())}>
            Fechar
          </button>
        </div>
      </div>
    );
  }
  const st = t.step!;
  return (
    <div className="tourcard">
      <div className="tc-head">
        <span className="tc-n">
          {t.k + 1}/{steps.length}
        </span>
        <b>{st.title}</b>
        <button className="btn sm tc-col" onClick={() => setSmall(!small)} title={small ? 'Mostrar o texto' : 'Recolher o texto'}>
          {small ? '▴' : '▾'}
        </button>
      </div>
      {!small && <div className="tc-text">{t.text(e)}</div>}
      {st.why && !compact && !small && <div className="tc-why">Por quê: {st.why}</div>}
      <div className="tc-status">
        {t.conditionMet ? (
          <span className="ok">✓ {st.waitFor === 'leitura' ? 'leitura' : st.waitFor} — próxima etapa em {Math.ceil(t.remaining)} s</span>
        ) : (
          <span className="wait">
            ⟳ aguardando: {st.waitFor} · {fmtTime(t.tStep)}
          </span>
        )}
        {!runner.running && <span className="warn"> · PAUSADO</span>}
      </div>
      {!compact && (
        <div className="tc-steps">
          {steps.map((s, i) => (
            <span key={s.title} className={t.outcome[i] === 'concluída' ? 'done' : i === t.k ? 'cur' : t.outcome[i] === 'tempo esgotado' ? 'to' : ''} title={s.title}>
              {ICON[t.outcome[i]]} {i + 1}
            </span>
          ))}
        </div>
      )}
      {t.sent.filter((c) => c.step === t.k).length > 0 && (
        <div className="subtle">
          Comandos desta etapa:{' '}
          {t.sent
            .filter((c) => c.step === t.k)
            .slice(-3)
            .map((c) => c.text)
            .join(' · ')}
        </div>
      )}
      <div className="row mt4" style={{ pointerEvents: 'auto' }}>
        <button className="btn sm" onClick={() => tours.pause(runner)}>
          {runner.running ? '❚❚ Pausar' : '▶ Continuar'}
        </button>
        <button className="btn sm" onClick={() => tours.next(runner)} title="Avança sem esperar a condição ou o tempo de leitura">
          ⏭ Próxima etapa
        </button>
        <button className="btn sm warn" onClick={() => tours.stop(runner)}>
          ■ Encerrar
        </button>
      </div>
    </div>
  );
}

/** Lista dos roteiros automáticos com botão de início. */
export function TourList({ goTo }: { goTo?: boolean }) {
  useSim(2);
  const ui = useUi();
  const go = (tr: Tour) => {
    if (goTo) ui.setScreen('apresentacao');
    tours.start(runner, tr);
  };
  return (
    <div className="col">
      {TOURS.map((tr) => (
        <div key={tr.id} className="tour-item">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>{tr.name}</b>
            {tours.active && tours.tour?.id === tr.id ? (
              <span className="badge ok">em andamento</span>
            ) : (
              <button className="btn ok sm" onClick={() => go(tr)}>
                ▶ Iniciar
              </button>
            )}
          </div>
          <div className="subtle">
            {tr.description} {tr.steps.length} etapas, narradas.
          </div>
        </div>
      ))}
      <div className="note">O simulador executa tudo sozinho, com calma: cada etapa mostra o que está acontecendo, com os valores ao vivo, e só avança quando a condição física é atingida e houve tempo de leitura. Você pode pausar, pular etapas ou encerrar a qualquer momento. As condições iniciais não são alteradas.</div>
    </div>
  );
}
