/** Procedimento guiado da sequência completa, com verificação ao vivo das condições físicas. */
import { useRef } from 'react';
import { runner, useSim } from '../store';
import { demo } from '../demo';
import type { SimulationEngine } from '../../sim/core/engine';
import { KNOT } from '../../sim/units';

interface Step {
  title: string;
  hint: string;
  ok: (e: SimulationEngine, ctx: { h0: number }) => boolean;
}

const tanksFill = (e: SimulationEngine) => e.vessel.ballast.tanks.reduce((a, t) => a + e.state.ballast[t.id].water, 0) / e.vessel.ballast.tanks.reduce((a, t) => a + t.volume, 0);

export const PROCEDURE: Step[] = [
  { title: 'Preparar: ordenar seguimento (≥ 4 nós)', hint: 'Telégrafo AV MEIA (75 rpm). Os lemes precisam de escoamento para atuar.', ok: (e) => e.state.body.vel.x > 4 * KNOT },
  { title: 'Abrir os suspiros dos TLP', hint: 'Lastro → "Abrir suspiros". O ar escapa e a água entra pelos embornais.', ok: (e) => e.vessel.ballast.tanks.some((t) => e.state.ballast[t.id].vent.pos > 0.9) || tanksFill(e) > 0.95 },
  { title: 'TLP alagados (> 95 %)', hint: 'A reserva de flutuabilidade desaparece; o submarino fica próximo do neutro.', ok: (e) => tanksFill(e) > 0.95 },
  { title: 'Descer com os lemes abaixo de 20 m', hint: 'Lemes de vante a DESCER e de ré levemente a DESCER (ou piloto de profundidade).', ok: (e) => e.outputs.depthKeel > 20 },
  { title: 'Fechar os suspiros', hint: 'Evita perda de ar e prepara o sopro de emersão.', ok: (e) => e.vessel.ballast.tanks.every((t) => e.state.ballast[t.id].vent.cmd < 0.5) && e.outputs.depthKeel > 15 },
  { title: 'Estabilizar na cota (|ż| < 0,1 m/s)', hint: 'Nivelar com os lemes ou usar o piloto automático de profundidade.', ok: (e) => e.outputs.depthKeel > 20 && Math.abs(e.outputs.verticalSpeed) < 0.1 && Math.abs(e.outputs.euler.pitch) < 3 },
  { title: 'Equilíbrio hidrostático (|flutuab.| < 300 kg)', hint: 'Compensação: "Executar ajuste calculado" ou dosagens manuais.', ok: (e) => e.outputs.depthKeel > 15 && Math.abs(e.outputs.netBuoyancyKg) < 300 },
  { title: 'Trim estático corrigido (|θ_eq| < 0,5°)', hint: 'Trim: transferir água entre TT-AV e TT-AR conforme a previsão.', ok: (e) => e.outputs.depthKeel > 15 && Math.abs(e.outputs.staticPitchEq) < 0.5 },
  { title: 'Banda corrigida (|φ_eq| < 0,3°)', hint: 'Banda: transferir água entre TB-BB e TB-BE.', ok: (e) => e.outputs.depthKeel > 15 && Math.abs(e.outputs.staticRollEq) < 0.3 },
  { title: 'Alterar o rumo em pelo menos 30°', hint: 'Leme de direção a BE/BB ou piloto de rumo com nova referência.', ok: (e, c) => e.outputs.depthKeel > 15 && Math.abs(((e.outputs.euler.heading - c.h0 + 540) % 360) - 180) > 30 },
  { title: 'Subir à cota periscópica (< 18 m)', hint: 'Lemes a SUBIR ou piloto de profundidade com 14 m.', ok: (e) => e.outputs.depthKeel < 18 && e.state.t > 60 && tanksFill(e) > 0.5 },
  { title: 'Soprar os TLP e emergir (quilha < 8 m)', hint: 'Lastro → "Soprar TLP"; fechar o sopro quando vazios.', ok: (e) => e.outputs.depthKeel < 8 && tanksFill(e) < 0.3 && e.state.t > 120 },
];

export function ProcedurePanel() {
  const e = useSim(4);
  const h0 = useRef(0);
  const engRef = useRef<SimulationEngine | null>(null);
  const doneFlags = useRef<boolean[]>(PROCEDURE.map(() => false));
  if (engRef.current !== e) {
    // novo cenário/estado carregado: reinicia o checklist
    engRef.current = e;
    h0.current = e.outputs.euler.heading;
    doneFlags.current = PROCEDURE.map(() => false);
  }
  PROCEDURE.forEach((s, i) => {
    if (s.ok(e, { h0: h0.current })) doneFlags.current[i] = true;
  });
  const cur = doneFlags.current.findIndex((x) => !x);
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
        <button
          className="btn sm"
          onClick={() => {
            doneFlags.current = PROCEDURE.map(() => false);
            h0.current = e.outputs.euler.heading;
          }}
        >
          Reiniciar checklist
        </button>
      </div>
      <ol className="procedure" style={{ paddingLeft: 20, margin: 0 }}>
        {PROCEDURE.map((s, i) => (
          <li key={s.title} className={doneFlags.current[i] ? 'done' : i === cur ? 'cur' : ''}>
            {doneFlags.current[i] ? '✓ ' : ''}
            {s.title}
            {i === cur && <div className="subtle">{s.hint}</div>}
          </li>
        ))}
      </ol>
      <div className="note">As etapas são marcadas automaticamente quando a condição física é atingida (não basta clicar). A demonstração automática executa o mesmo roteiro do teste V12 — inicie-a a partir do cenário "Superfície — pronto para imergir".</div>
    </div>
  );
}
