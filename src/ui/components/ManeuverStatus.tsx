/** Etapa da manobra automática em execução, comandos enviados e resultado. */
import { runner, useSim } from '../store';
import { maneuver, MANEUVER_STEPS } from '../maneuvers';
import { demo } from '../demo';
import { fmtTime } from '../format';

export function ManeuverStatus({ compact }: { compact?: boolean }) {
  const e = useSim(5);
  const m = maneuver;
  if (!m.active && !m.result && !demo.active) return null;
  if (demo.active) {
    const st = demo.steps[demo.k];
    return (
      <div className="mstatus">
        <div>
          <b>Demonstração</b> · etapa {demo.k + 1}/{demo.steps.length}: {st?.name}
        </div>
        <div className="subtle">
          Critério: {st?.criterion} · {fmtTime(demo.tStep)} de {fmtTime(st?.timeout ?? 0)}
        </div>
      </div>
    );
  }
  if (!m.active && m.result) {
    const r = m.result;
    const cls = r.outcome === 'sucesso' ? 'ok' : r.outcome === 'cancelada' ? 'warn' : 'alarm';
    return (
      <div className="mstatus">
        <span className={`badge ${cls}`}>{r.outcome.toUpperCase()}</span> Manobra {r.kind === 'imergir' ? 'IMERGIR' : 'EMERGIR'}: {r.why} · duração {fmtTime(r.duration)}
        <button className="btn sm" style={{ marginLeft: 8, pointerEvents: 'auto' }} onClick={() => ((m.result = null), runner.notify())}>
          ✕
        </button>
      </div>
    );
  }
  const steps = MANEUVER_STEPS[m.active!];
  const recent = m.sent.slice(compact ? -2 : -4);
  return (
    <div className="mstatus">
      <div>
        <b>⟳ {m.active === 'imergir' ? `IMERGIR para ${m.target} m` : 'EMERGIR'}</b> · etapa {m.step + 1}/{steps.length}: {m.phase || steps[m.step]} · {fmtTime(e.state.t - m.t0)}
      </div>
      {!compact && (
        <div className="msteps">
          {steps.map((s, i) => (
            <span key={s} className={i < m.step ? 'done' : i === m.step ? 'cur' : ''}>
              {i < m.step ? '✓' : i === m.step ? '▶' : '○'} {s}
            </span>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div className="subtle">
          Comandos enviados:{' '}
          {recent.map((c, i) => (
            <span key={i}>
              {i > 0 ? ' · ' : ''}
              {fmtTime(c.t)} {c.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
