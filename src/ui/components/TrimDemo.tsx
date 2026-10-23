/**
 * Peso deslocável de demonstração + compensação pelos tanques de trim.
 * O peso anda no trilho com velocidade finita (estado do motor); a sugestão
 * de compensação vem de trimBalance (binário que anula o desequilíbrio).
 */
import { useEffect, useState } from 'react';
import { cmd } from '../store';
import type { SimulationEngine } from '../../sim/core/engine';
import { trimBalance } from '../../sim/forceVectors';
import { fmt } from '../format';

const tm = (x: number) => `${x < 0 ? '−' : ''}${fmt(Math.abs(x), 0)} t·m`;

export function TrimDemoPanel({ e, compact }: { e: SimulationEngine; compact?: boolean }) {
  const dwc = e.vessel.mass.demoWeight;
  const tb = trimBalance(e);
  const d = tb.demo;
  const [x, setX] = useState(d?.xCmd ?? 0);
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    if (!drag && d) setX(d.xCmd);
  }, [d?.xCmd, drag]);
  if (!dwc || !d) return <div className="subtle">Esta configuração não tem peso deslocável (carregue um cenário padrão).</div>;
  const go = (v: number) => cmd({ type: 'demoWeight', x: v });
  const c = tb.compensate;
  const kg = Math.min(c.kg, c.limitKg);
  const ref = e.state.trimRef;
  const dA = tb.tanks.dA;
  const undo = () => {
    if (!ref) return;
    if (dA > 50) cmd({ type: 'dosing', system: 'trim', mode: 'transferir', kg: dA, dir: 'AtoB' });
    else if (dA < -50) cmd({ type: 'dosing', system: 'trim', mode: 'transferir', kg: -dA, dir: 'BtoA' });
  };
  const dosing = e.state.trim.dosing;
  const moving = Math.abs(d.xCmd - d.x) > 0.05;
  return (
    <div className="col">
      <div className="row">
        <button className="btn sm" onClick={() => go(dwc.xMin)} title="Levar o peso todo para ré">
          ◀ Ré
        </button>
        <input
          type="range"
          min={dwc.xMin}
          max={dwc.xMax}
          step={0.5}
          value={x}
          style={{ flex: 1, minWidth: 80, accentColor: '#ff5ec4' }}
          aria-label="Posição do peso deslocável"
          onChange={(ev) => {
            setDrag(true);
            setX(Number(ev.target.value));
          }}
          onPointerUp={() => {
            setDrag(false);
            go(x);
          }}
          onKeyUp={() => {
            setDrag(false);
            go(x);
          }}
        />
        <button className="btn sm" onClick={() => go(dwc.xMax)} title="Levar o peso todo para vante">
          Vante ▶
        </button>
        <button className="btn sm" onClick={() => go(dwc.xNeutral)} title="Posição neutra (trim nulo)">
          Neutro
        </button>
      </div>
      <div className="row subtle">
        <span>
          Posição{' '}
          <b className="mono" style={{ color: '#ff7ad1' }}>
            {fmt(d.x, 1)} m
          </b>{' '}
          {moving ? `→ ${fmt(d.xCmd, 1)} m (${fmt(dwc.speed, 1)} m/s)` : ''}
        </span>
        <span title={`Carga já a bordo (${fmt(dwc.mass / 1000, 0)} t): escolhe quanto dela anda no trilho. A massa total do submarino não muda.`}>Deslocar</span>
        <div className="seg">
          {[2000, 5000, 10000, 20000, 30000]
            .filter((m) => m <= dwc.mass)
            .map((m) => (
              <button key={m} className={Math.abs(d.mass - m) < 1 ? 'on' : ''} onClick={() => cmd({ type: 'demoWeight', mass: m })} title={`Deslocar ${m / 1000} t da carga existente (sem acrescentar peso)`}>
                {m / 1000} t
              </button>
            ))}
        </div>
      </div>
      <table className="t">
        <tbody>
          <tr>
            <td style={{ color: '#ff7ad1' }}>Momento do peso deslocado</td>
            <td className="mono">{tm(d.momentTm)}</td>
          </tr>
          <tr>
            <td style={{ color: '#ffb54d' }}>Momento dos tanques de trim</td>
            <td className="mono">
              {tm(tb.tanks.momentTm)}{' '}
              <span className="subtle">
                (TT-AV {dA >= 0 ? '+' : '−'}
                {fmt(Math.abs(dA) / 1000, 2)} t)
              </span>
            </td>
          </tr>
          <tr>
            <td>
              <b>Desequilíbrio (soma)</b>
            </td>
            <td className="mono">
              <b>{tm(tb.netTm)}</b> {Math.abs(tb.netTm) < 3 ? '✓' : tb.netTm < 0 ? 'proa ↓' : 'proa ↑'}
            </td>
          </tr>
          <tr>
            <td>Pitch atual / de equilíbrio estático</td>
            <td className="mono">
              {fmt(tb.pitch, 1)}° / {fmt(tb.pitchEq, 1)}°
            </td>
          </tr>
        </tbody>
      </table>
      <div className="row">
        <button className="btn ok sm" disabled={!c.dir || kg < 20 || !!dosing?.active} onClick={() => c.dir && cmd({ type: 'dosing', system: 'trim', mode: 'transferir', kg, dir: c.dir })}>
          Compensar com o trim{c.dir ? `: ${fmt(kg / 1000, 2)} t ${c.dir === 'AtoB' ? 'TT-AV → TT-AR' : 'TT-AR → TT-AV'}` : ''}
        </button>
        <button className="btn sm" disabled={Math.abs(dA) < 50 || !!dosing?.active} onClick={undo} title="Devolve a água de trim à condição inicial">
          Desfazer trim
        </button>
      </div>
      {c.dir && !c.feasible && (
        <div className="badge warn">
          O trim não basta: precisa de {fmt(c.kg / 1000, 1)} t, o tanque permite {fmt(c.limitKg / 1000, 1)} t.
        </div>
      )}
      {dosing && (
        <div className="subtle">
          Trim: {dosing.phase} — {fmt(dosing.moved, 0)}/{fmt(dosing.target, 0)} kg
        </div>
      )}
      {!compact && (
        <div className="note">
          O peso deslocado já está a bordo: deslocar não acrescenta massa, só cria um binário (+P na nova posição, −P na original). O submarino gira até o momento restaurador equilibrar: submerso, com pouca rigidez
          (E·BG), inclina vários graus; na superfície, o plano de flutuação é muito mais rígido e o efeito é pequeno. A compensação transfere água entre TT-AV e TT-AR com o binário oposto. Experimente com o submarino
          pairando (sem velocidade, lemes sem efeito).
        </div>
      )}
    </div>
  );
}
