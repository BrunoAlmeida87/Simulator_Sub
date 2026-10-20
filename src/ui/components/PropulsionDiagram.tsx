/**
 * LINHA DE EIXO — da direita (proa) para a esquerda (popa), como os
 * diagramas de trim e lastro: barramento → motor elétrico principal → eixo →
 * mancal de escora → hélice, com os valores do passo de simulação: potência
 * elétrica, torque do motor e do hélice, rotação e sentido de giro, potência no eixo,
 * empuxo (transmitido ao casco pelo mancal de escora) e velocidade.
 * A animação gira na rotação real (× aceleração da simulação; parada quando
 * a simulação está pausada).
 */
import type { SimulationEngine } from '../../sim/core/engine';
import { runner } from '../store';
import { toKnots } from '../../sim/units';
import { fmt } from '../format';
import { WideDiagram } from './WideDiagram';

const kw = (w: number) => (Math.abs(w) >= 1e6 ? `${fmt(w / 1e6, 2)} MW` : `${fmt(w / 1000, 0)} kW`);

export function PropulsionDiagram({ e }: { e: SimulationEngine }) {
  const s = e.state;
  const p = s.propulsion;
  const v = e.vessel;
  const m = v.propulsion.motor;
  const rpm = e.outputs.rpm;
  const ahead = rpm >= 0;
  const moving = Math.abs(rpm) > 0.5;
  const run = runner.running && moving;
  // período de uma volta em segundos reais (com a aceleração); limitado para não “piscar”
  const revPerSec = Math.min(6, (Math.abs(rpm) / 60) * Math.max(0.1, runner.timeScale));
  const dur = revPerSec > 0.01 ? 1 / revPerSec : 1;
  const spin = (reverseVisual = false) => ({
    animation: run ? `pspin ${dur}s linear infinite` : 'none',
    animationDirection: (ahead !== reverseVisual ? 'normal' : 'reverse') as 'normal' | 'reverse',
  });
  const shaftFlow = { animation: run ? `pshaft ${Math.max(0.15, dur / 3)}s linear infinite` : 'none', animationDirection: (ahead ? 'normal' : 'reverse') as 'normal' | 'reverse' };
  const thrustKN = p.thrust / 1000;
  const tMax = 250;
  const arrowLen = Math.min(150, (Math.abs(thrustKN) / tMax) * 150);
  const eta = p.elecPower > 1 ? p.shaftPower / p.elecPower : NaN;
  const nb = v.propulsion.propeller.blades;
  const torqueFrac = Math.min(1, Math.abs(p.motorTorque) / m.maxTorque);
  const status = p.failed ? 'FALHA' : !s.electrical.energized ? 'SEM ENERGIA' : p.powerLimited ? 'LIMITE DE POTÊNCIA' : moving ? (ahead ? 'AVANTE' : 'A RÉ') : 'PARADO';
  return (
    <WideDiagram minWidth={800}>
      <svg viewBox="0 0 1000 300" className="svgbox pdiag" role="img" aria-label="Diagrama motor elétrico, eixo e hélice">
        {/* casco (corte) */}
        <path d="M990 40 H230 Q70 40 15 150 Q70 260 230 260 H990" className="pd-hull" />
        <text x={20} y={30} className="pd-t">
          ◀ popa
        </text>
        <text x={980} y={30} className="pd-t" textAnchor="end">
          proa ▶
        </text>
        {/* alimentação elétrica */}
        <g>
          <rect x={860} y={110} width={110} height={80} rx={8} className={`enode ${s.electrical.energized ? 'on' : 'bad'}`} />
          <text x={915} y={135} className="pd-t" textAnchor="middle">
            Barramento
          </text>
          <text x={915} y={157} className="pd-v" textAnchor="middle">
            {fmt(s.electrical.voltage, 0)} V
          </text>
          <text x={915} y={177} className="pd-s" textAnchor="middle">
            {fmt(s.electrical.loads.MEP ? s.electrical.loads.MEP / Math.max(1, s.electrical.voltage) : 0, 0)} A no motor
          </text>
          <path d="M860 150 H810" className={`pd-elec ${p.elecPower > 1000 ? 'on' : ''}`} />
          <text x={835} y={140} className="pd-s" textAnchor="middle">
            {kw(p.elecPower)}
          </text>
        </g>
        {/* motor elétrico principal */}
        <g>
          <rect x={620} y={85} width={190} height={130} rx={12} className={`enode ${p.failed ? 'bad' : moving ? 'on' : ''}`} />
          <text x={715} y={108} className="pd-t" textAnchor="middle">
            Motor elétrico principal
          </text>
          <g transform="translate(755 160)">
            <circle r={36} className="pd-stator" />
            <g style={spin()} className="pd-rot">
              {[0, 45, 90, 135].map((a) => (
                <rect key={a} x={-3} y={-30} width={6} height={60} rx={3} className="pd-rotor" transform={`rotate(${a})`} />
              ))}
            </g>
          </g>
          <text x={665} y={142} className="pd-v" textAnchor="middle">
            {fmt(rpm, 0)} rpm
          </text>
          <text x={665} y={164} className="pd-s" textAnchor="middle">
            ordem {fmt(p.rpmCmd, 0)}
          </text>
          <text x={665} y={186} className="pd-s" textAnchor="middle">
            {fmt(p.motorTorque / 1000, 0)} kN·m
          </text>
          {/* barra de torque */}
          <rect x={630} y={202} width={170} height={6} rx={3} fill="#142133" />
          <rect x={630} y={202} width={170 * torqueFrac} height={6} rx={3} fill={torqueFrac > 0.95 ? '#ff5257' : '#36c5f0'} />
        </g>
        {/* eixo */}
        <g>
          <rect x={200} y={140} width={420} height={20} rx={4} className="pd-shaft" />
          <line x1={620} y1={150} x2={200} y2={150} className="pd-shaftstripe" style={shaftFlow} />
          <text x={530} y={130} className="pd-s" textAnchor="middle">
            eixo · {kw(p.shaftPower)}
          </text>
          {/* sentido de giro */}
          <g transform="translate(440 150)">
            <path d={ahead ? 'M-14 -26 A28 28 0 1 1 -26 12' : 'M14 -26 A28 28 0 1 0 26 12'} className={`pd-dir ${moving ? 'on' : ''}`} markerEnd="url(#pdArrow)" />
          </g>
          <text x={440} y={205} className="pd-s" textAnchor="middle">
            {moving ? `${ahead ? 'horário' : 'anti-horário'} visto da popa` : 'eixo parado'}
          </text>
        </g>
        {/* mancal de escora: empuxo transmitido ao casco */}
        <g>
          <rect x={316} y={118} width={34} height={64} rx={5} className="enode" />
          <text x={333} y={108} className="pd-s" textAnchor="middle">
            mancal de escora
          </text>
          {Math.abs(thrustKN) > 0.5 && (
            <g>
              <path d={thrustKN > 0 ? `M350 236 H${350 + Math.max(12, arrowLen)}` : `M316 236 H${316 - Math.max(12, arrowLen)}`} className="pd-thrust" markerEnd="url(#pdArrowT)" />
              <text x={333} y={262} className="pd-v" textAnchor="middle" fill="#a8ff7a">
                empuxo {fmt(Math.abs(thrustKN), 0)} kN {thrustKN > 0 ? '(empurra para vante)' : '(empurra para ré)'}
              </text>
            </g>
          )}
        </g>
        {/* hélice (vista lateral + vista da popa) */}
        <g>
          {/* vista lateral: pás vistas de perfil (disco do hélice) */}
          <ellipse cx={168} cy={150} rx={11} ry={66} className="pd-disk" />
          <path d="M174 150 C 182 120, 178 96, 164 86 C 158 104, 160 128, 166 150 Z" className="pd-blade" />
          <path d="M174 150 C 180 178, 176 202, 162 212 C 158 192, 160 170, 166 150 Z" className="pd-blade" />
          <ellipse cx={168} cy={150} rx={12} ry={18} className="pd-hub" />
          <g transform="translate(90 150)">
            <circle r={50} className="pd-disk" />
            <g style={spin()} className="pd-rot">
              {Array.from({ length: nb }, (_, k) => (
                <path key={k} d="M0 -6 C 14 -18, 18 -38, 6 -48 C -6 -40, -8 -20, 0 -6 Z" className="pd-blade" transform={`rotate(${(k * 360) / nb})`} />
              ))}
            </g>
            <circle r={7} className="pd-hub" />
          </g>
          <text x={90} y={222} className="pd-s" textAnchor="middle">
            hélice {nb} pás · {fmt(v.propulsion.propeller.diameter, 1)} m
          </text>
          <text x={90} y={238} className="pd-s" textAnchor="middle">
            vista da popa
          </text>
          {/* esteira do hélice */}
          {Math.abs(thrustKN) > 0.5 && <path d="M32 150 h-24" className="pd-wash" style={{ ...shaftFlow, opacity: Math.min(1, Math.abs(thrustKN) / 80) }} />}
        </g>
        {/* rodapé de valores */}
        <text x={20} y={288} className="pd-s">
          {status} · velocidade {fmt(toKnots(s.body.vel.x), 1)} nós · torque do hélice {fmt(p.propTorque / 1000, 0)} kN·m · J = {fmt(p.advance, 2)} · rendimento elétrico→eixo{' '}
          {Number.isFinite(eta) ? `${fmt(eta * 100, 0)} %` : '—'}
        </text>
        <defs>
          <marker id="pdArrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="#36c5f0" />
          </marker>
          <marker id="pdArrowT" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="#a8ff7a" />
          </marker>
        </defs>
      </svg>
    </WideDiagram>
  );
}
