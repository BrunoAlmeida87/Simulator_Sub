import { Panel } from './Panel';
import { useSim } from '../store';
import {
  cavitationLevel,
  cavitationReferenceDepth,
  CAVITATION_SIGMA_CRITICAL,
  CAVITATION_RADIUS_FRACTION,
  CAVITATION_INTENSITY_SPAN,
  CAVITATION_ALARM_DELAY,
  CAVITATION_ALARM_ON,
  CAVITATION_ALARM_OFF,
} from '../../sim/systems/cavitation';

export function CavitationPanel() {
  const e = useSim(2);
  const p = e.vessel.propulsion.propeller;
  const level = cavitationLevel(e.vessel, e.state, e.env);
  const active = e.state.alarms.runtime.CAVITATION?.active;
  return (
    <Panel title="Cavitação da hélice" tag={<span className="subtle">PARÂMETROS DO MODELO</span>}>
      <div className="col">
        <p>Condições usadas pelas bolhas e pelo alerta. A cavitação aumenta com a rotação e diminui com a pressão da água; não existe uma profundidade fixa para todas as velocidades.</p>
        <div className="note">
          <b>{active ? 'Alerta de cavitação ativo' : level > 0 ? 'Cavitação estimada presente' : 'Sem cavitação estimada'}</b> · intensidade máxima nas pás: {(level * 100).toFixed(0)}% · rotação real:{' '}
          {((e.state.propulsion.omega * 30) / Math.PI).toFixed(0)} rpm · velocidade: {(e.state.body.vel.x / 0.514444).toFixed(1)} nós.
        </div>
        <dl>
          <dt>Início da cavitação</dt>
          <dd>Número de cavitação σ abaixo de {CAVITATION_SIGMA_CRITICAL.toFixed(2)}.</dd>
          <dt>Pressão e escoamento</dt>
          <dd>σ = (pressão local − pressão de vapor) / (½ × densidade × velocidade relativa²). Considera rotação, avanço, temperatura, ondas e inclinação do submarino.</dd>
          <dt>Hélice em uso</dt>
          <dd>
            Diâmetro {p.diameter.toFixed(2)} m · {p.blades} pás · amostragem a {CAVITATION_RADIUS_FRACTION * 100}% do raio · fração de esteira {p.wakeFraction.toFixed(2)}.
          </dd>
          <dt>Intensidade</dt>
          <dd>
            Cresce de 0 a 100% quando σ cai de {CAVITATION_SIGMA_CRITICAL.toFixed(2)} a {(CAVITATION_SIGMA_CRITICAL - CAVITATION_INTENSITY_SPAN).toFixed(2)}.
          </dd>
          <dt>Alerta de prioridade média</dt>
          <dd>
            Confirma após {CAVITATION_ALARM_DELAY} s com intensidade ≥ {CAVITATION_ALARM_ON * 100}%. Normaliza abaixo de {CAVITATION_ALARM_OFF * 100}%. Permanece no histórico e pode ser reconhecido no anunciador ou em
            Segurança.
          </dd>
        </dl>
        <b>Exemplos de início — profundidade do eixo</b>
        <div className="note">Hélice e perfil da água atuais, mar calmo e casco nivelado. Pares ilustrativos; rpm não determina sozinho a velocidade do navio.</div>
        <table>
          <thead>
            <tr>
              <th>Rotação</th>
              <th>Velocidade</th>
              <th>Início até cerca de</th>
            </tr>
          </thead>
          <tbody>
            {[
              [80, 6],
              [120, 10],
              [160, 14],
            ].map(([rpm, knots]) => {
              const h = cavitationReferenceDepth(e.vessel, e.env, rpm, knots);
              return (
                <tr key={rpm}>
                  <td>{rpm} rpm</td>
                  <td>{knots} nós</td>
                  <td>{h === null ? 'Sem início previsto' : `${h.toFixed(1)} m`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="note">
          Calibração educacional, sem ensaios de hélice. Estes critérios são de consulta e não alteram empuxo ou rendimento. Ocultar a camada Esteira esconde as bolhas, mas mantém o alerta. Para reduzir a cavitação,
          reduza a rotação; qualquer aumento de profundidade deve respeitar o fundo e os limites do submarino.
        </div>
      </div>
    </Panel>
  );
}
