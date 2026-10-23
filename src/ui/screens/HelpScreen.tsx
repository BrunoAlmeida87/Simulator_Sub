/** Guia de operação, convenções e referências. */
import { Panel } from '../components/Panel';
import { ProcedurePanel } from '../components/Procedure';
import { KindTag } from '../components/Readout';

const REPO = 'https://github.com/BrunoAlmeida87/Simulator_Sub';

export function HelpScreen() {
  return (
    <div className="grid g2">
      <Panel title="Procedimento guiado — sequência completa">
        <ProcedurePanel />
      </Panel>
      <Panel title="Primeiros passos">
        <ol style={{ paddingLeft: 18, margin: 0 }}>
          <li>
            Na aba <b>Pilotagem</b>, pressione <b>▶ Iniciar simulação</b> e opere o telégrafo, os lemes e o lastro (ou as manobras rápidas) vendo o submarino em 3D.
          </li>
          <li>
            Para conduzir uma apresentação, use a aba <b>Apresentação</b>: escolha uma situação pronta, pressione <b>Preparar</b> e mostre ao mesmo tempo os tanques, os vetores de peso, empuxo e resultante e o movimento do submarino.
          </li>
          <li>Escolha outros cenários em <b>Cenários</b> (começam pausados) e pressione <b>▶</b> na barra superior.</li>
          <li>
            Na <b>Central de comando</b>: telégrafo (rpm), lemes de vante/ré e de direção, piloto automático e comandos rápidos de lastro.
          </li>
          <li>
            Em <b>Lastro e compensação</b>: suspiros/sopro de cada TLP, garrafas de ar AP e o circuito de compensação (clique nas válvulas e bombas do diagrama).
          </li>
          <li>
            Em <b>Trim e banda</b>: transferências de água com previsão do ângulo resultante.
          </li>
          <li>
            Ative o <b>Modo engenharia</b> (ⓘ) para clicar em qualquer componente e ver função, variáveis, equações e consequências previstas.
          </li>
          <li>Use a aceleração de tempo (×2…×20) em manobras longas — a física usa sempre o mesmo passo fixo.</li>
        </ol>
      </Panel>
      <Panel title="Convenções">
        <table className="t">
          <tbody>
            <tr><td>Referencial</td><td>NED: x Norte, y Leste, z para baixo (profundidade positiva). Corpo: x avante, y boreste, z quilha.</td></tr>
            <tr><td>Pitch θ</td><td>+ proa para cima</td></tr>
            <tr><td>Banda φ</td><td>+ adernado para boreste (BE)</td></tr>
            <tr><td>Rumo ψ</td><td>0–360°, sentido horário a partir do Norte verdadeiro</td></tr>
            <tr><td>Lemes horizontais</td><td>+ = SUBIR, − = DESCER (vante e ré)</td></tr>
            <tr><td>Leme de direção</td><td>+ = BORESTE, − = BOMBORDO</td></tr>
            <tr><td>Profundidade indicada</td><td>na quilha a meia-nau, a partir da pressão (ρ_cal = 1025 kg/m³)</td></tr>
            <tr><td>Flutuabilidade líquida</td><td>ρ·V_deslocado − m (+ tende a subir)</td></tr>
            <tr>
              <td>Classes de valores</td>
              <td>
                <KindTag kind="MED" /> medição de sensor · <KindTag kind="CALC" /> calculado · <KindTag kind="CMD" /> comando · <KindTag kind="VERD" /> valor real do modelo (modo engenharia)
              </td>
            </tr>
          </tbody>
        </table>
      </Panel>
      <Panel title="Atalhos de teclado">
        <table className="t">
          <tbody>
            <tr><td><code>Espaço</code></td><td>Executar / pausar</td></tr>
            <tr><td><code>A</code> / <code>D</code></td><td>Leme de direção −5° / +5°</td></tr>
            <tr><td><code>W</code> / <code>S</code></td><td>Lemes de ré DESCER / SUBIR 5°</td></tr>
            <tr><td><code>Q</code> / <code>E</code></td><td>Lemes de vante DESCER / SUBIR 5°</td></tr>
            <tr><td><code>+</code> / <code>−</code></td><td>Telégrafo ±10 rpm</td></tr>
            <tr><td><code>0</code>…<code>8</code></td><td>Telas numeradas: 0 Pilotagem … 8 Sala de comando (o número aparece na navegação)</td></tr>
            <tr><td><code>I</code></td><td>Modo engenharia</td></tr>
          </tbody>
        </table>
      </Panel>
      <Panel title="Documentação técnica">
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li>
            <a href={`${REPO}#readme`} target="_blank" rel="noreferrer">README</a> — instalação, estrutura e execução
          </li>
          <li>
            <a href={`${REPO}/blob/HEAD/docs/EQUACOES.md`} target="_blank" rel="noreferrer">Equações do modelo</a>
          </li>
          <li>
            <a href={`${REPO}/blob/HEAD/docs/ARQUITETURA.md`} target="_blank" rel="noreferrer">Arquitetura e módulos</a>
          </li>
          <li>
            <a href={`${REPO}/blob/HEAD/docs/PARAMETROS.md`} target="_blank" rel="noreferrer">Parâmetros fictícios</a>
          </li>
          <li>
            <a href={`${REPO}/blob/HEAD/docs/LIMITACOES.md`} target="_blank" rel="noreferrer">Simplificações e limitações</a>
          </li>
          <li>
            <a href={`${REPO}/blob/HEAD/docs/VALIDACAO.md`} target="_blank" rel="noreferrer">Relatório de validação</a>
          </li>
        </ul>
        <div className="note">
          Embarcação e todos os parâmetros são <b>fictícios</b>, de ordem de grandeza pública. Não representam navio real, documentação proprietária ou procedimentos operacionais. Limites e respostas de segurança são exclusivamente educacionais.
        </div>
      </Panel>
      <Panel title="Roteiro de desenvolvimento">
        <table className="t">
          <tbody>
            <tr>
              <td><span className="badge ok">FASE 1</span></td>
              <td>Núcleo físico 6-GL, lastro principal, compensação, trim, propulsão, lemes, instrumentos, 3D, interface — <b>entregue</b>. Também antecipados: banda, energia, alarmes, histórico, sensores, piloto automático e falhas básicas.</td>
            </tr>
            <tr>
              <td><span className="badge warn">FASE 2</span></td>
              <td>Navegação com deriva inercial, distribuição elétrica com rejeição de cargas, soprador de baixa pressão, mais sensores redundantes. <span className="future">FUTURO</span></td>
            </tr>
            <tr>
              <td><span className="badge off">FASE 3</span></td>
              <td>Ondas e correntes, superfície livre nos tanques, atmosfera interna, refrigeração, esgoto, controle de avarias, hidrodinâmica refinada. <span className="future">FUTURO</span></td>
            </tr>
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
