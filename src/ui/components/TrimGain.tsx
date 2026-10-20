/** Ampliação visual do trim (demonstração) — seletor e aviso sobre a cena. */
import { graphics, TRIM_GAINS, useGraphics } from '../graphics';
import { useSim } from '../store';
import { fmt } from '../format';

export function TrimGainSelect({ compact }: { compact?: boolean }) {
  const g = useGraphics();
  return (
    <div className="seg" title="Multiplica só o ângulo de trim DESENHADO (a física não muda). Útil na superfície, onde o trim real é de poucos centímetros.">
      {!compact && <span style={{ padding: '0 6px', fontSize: 11, color: '#9fb7cf', alignSelf: 'center' }}>Ampliar trim</span>}
      {TRIM_GAINS.map((k) => (
        <button key={k} className={g.trimGain === k ? 'on' : ''} onClick={() => graphics.set({ trimGain: k })}>
          {k === 1 ? 'real' : `×${k}`}
        </button>
      ))}
    </div>
  );
}

/** Aviso permanente enquanto a ampliação estiver ligada (em todas as cenas e na 2ª janela). */
export function TrimGainBanner() {
  const g = useGraphics();
  const e = useSim(4);
  if (g.trimGain === 1) return null;
  return (
    <div className="trimgain-banner" role="status">
      <b>TRIM AMPLIADO ×{g.trimGain}</b> — demonstração: o desenho mostra {g.trimGain}× o ângulo calculado (real θ = {fmt(e.outputs.euler.pitch, 2)}°)
      <button className="btn sm" onClick={() => graphics.set({ trimGain: 1 })}>
        Voltar ao real
      </button>
    </div>
  );
}
