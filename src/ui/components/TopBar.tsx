/**
 * BARRA SUPERIOR — uma linha só, igual em todas as telas:
 * nome · ▶/❚❚ · relógio · velocidade · FAIXA DE ALARME · indicadores (fora da
 * Operação) · gravação · “Cenário ▾” · “☰”.
 * O que se usa pouco foi para os menus: “Cenário ▾” (trocar, reiniciar,
 * biblioteca) e “☰” (passo a passo, janelas, engenharia, procedimento, modo palco).
 * Tudo continua passando pelos mesmos caminhos (runner, cmd, replaceUndo…), o que
 * mantém a janela “＋ Tela” funcionando (ver mirror.ts).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { baseConfig, runner, useSim } from '../store';
import { buildScenario, SCENARIOS } from '../../sim/scenarios';
import { fmt, fmtSpeed, fmtTime } from '../format';
import { useUi } from '../uiContext';
import { useIdentity } from '../appearance';
import { RecIndicator } from './RecordingPanel';
import { AlarmBand } from './AlarmBand';
import { SimSpeedButtons, SIM_SPEEDS } from './Controls';
import { link } from '../link';
import { isPanelWindow, openPanelWindow, openVisualWindow, panelIndex } from '../sync';
import { replaceUndo } from '../undo';
import { demo } from '../demo';
import { maneuver } from '../maneuvers';
import { loadScenario } from '../ops/OpsGroups';
import { indicatedDepth } from '../instruments';

/** menu suspenso simples: abre no clique, fecha no Esc, no clique fora ou ao escolher */
function Menu({ label, title, children, className }: { label: ReactNode; title: string; children: (close: () => void) => ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (ev: PointerEvent) => !ref.current?.contains(ev.target as Node) && setOpen(false);
    const key = (ev: KeyboardEvent) => ev.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className={`tb-menu ${className ?? ''}`} ref={ref}>
      <button className={`btn ${open ? 'on' : ''}`} aria-expanded={open} aria-haspopup="true" title={title} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <div className="tb-pop" role="menu" aria-label={title}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** velocidade do tempo em seletor compacto (os botões completos ficam no ☰ e na Apresentação) */
function SpeedSelect() {
  return (
    <select
      className="tb-speed"
      aria-label="Velocidade do tempo"
      title="Velocidade do tempo (abaixo de ×1 = câmera lenta)"
      value={SIM_SPEEDS.includes(runner.timeScale) ? runner.timeScale : 1}
      onChange={(ev) => ((runner.timeScale = Number(ev.target.value)), runner.notify())}
    >
      {SIM_SPEEDS.map((s) => (
        <option key={s} value={s}>
          ×{String(s).replace('.', ',')}
        </option>
      ))}
    </select>
  );
}

function ScenarioMenu({ current }: { current: string }) {
  const ui = useUi();
  const [sel, setSel] = useState(current);
  useEffect(() => setSel(current), [current]);
  const name = SCENARIOS.find((x) => x.id === current)?.name ?? current;
  return (
    <Menu label={<span className="tb-scn">{name.split(' — ')[0]} ▾</span>} title={`Cenário: ${name}`} className="tb-scenario">
      {(close) => (
        <div className="col" style={{ gap: 8, minWidth: 280 }}>
          <b className="subtle">Cenário atual: {name}</b>
          <select value={sel} onChange={(ev) => setSel(ev.target.value)} aria-label="Cenário" title={SCENARIOS.find((x) => x.id === sel)?.name}>
            {SCENARIOS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn" onClick={() => (loadScenario(sel), close())} title="Carrega o cenário (pausado). Por 10 s é possível desfazer.">
              Carregar
            </button>
            <button
              className="btn warn"
              onClick={() => {
                replaceUndo.run('Cenário reiniciado', () => {
                  demo.stop(runner);
                  maneuver.cancel(runner);
                  runner.running = false;
                  runner.replaceEngine(buildScenario(current, baseConfig()));
                });
                close();
              }}
              title="Reiniciar o cenário atual (pausado). Por 10 s é possível desfazer."
            >
              ↺ Reiniciar
            </button>
            <button className="btn" onClick={() => (ui.setScreen('cenarios'), close())}>
              Biblioteca →
            </button>
          </div>
        </div>
      )}
    </Menu>
  );
}

export function TopBar({ topRef, stage, setStage }: { topRef: React.RefObject<HTMLDivElement>; stage: boolean; setStage: (v: boolean) => void }) {
  const e = useSim(8);
  const s = e.state;
  const o = e.outputs;
  const ui = useUi();
  const id = useIdentity();
  const run = () => ((runner.running = !runner.running), runner.notify());
  return (
    <div className="topbar" ref={topRef}>
      <div className="brand">
        <b>{id.name}</b>
      </div>
      <div className="tb-run">
        <button className={`btn ${runner.running ? 'on' : 'ok'}`} onClick={run} title="Executar/pausar (Espaço)">
          {runner.running ? '❚❚ Pausar' : '▶ Executar'}
        </button>
        <span className="clock" title="Tempo de simulação">
          {fmtTime(s.t)}
        </span>
        <SpeedSelect />
        {runner.running && runner.lagging && <span className="badge warn">CPU: tempo reduzido</span>}
      </div>
      <AlarmBand e={e} />
      {/* indicadores (a Operação já mostra os seus sobre a cena) */}
      <div className="strip tb-strip" aria-label="Indicadores">
        <span className="kv">
          <small>PROF</small>
          <b>{fmt(indicatedDepth(e), 1)} m</b>
        </span>
        <span className="kv">
          <small>VEL</small>
          <b>{fmtSpeed(s.sensors.DVLU.value)}</b>
        </span>
        <span className="kv opt">
          <small>RUMO</small>
          <b>{fmt(s.sensors.GIRO.value, 0)}°</b>
        </span>
        {o.surfaced ? (
          <span className="kv opt" title="Reserva de flutuabilidade: peso adicional necessário para submergir por completo">
            <small>RESERVA</small>
            <b>{fmt(o.reserveKg / 1000, 1)} t</b>
          </span>
        ) : (
          <span className="kv opt" title="Flutuabilidade líquida calculada (+ positiva). ▲ acima de 2 t em módulo">
            <small>FLUTUAB.</small>
            <b className={Math.abs(o.netBuoyancyKg) > 2000 ? 'warnc' : undefined}>
              {Math.abs(o.netBuoyancyKg) > 2000 ? '▲ ' : ''}
              {fmt(o.netBuoyancyKg / 1000, 2)} t
            </b>
          </span>
        )}
      </div>
      <RecIndicator />
      {isPanelWindow && (
        <span className={`badge ${link.viewer?.connected ? 'ok' : 'warn'}`} title="Esta janela espelha a janela de controle: os comandos dados aqui são executados lá">
          Tela {panelIndex} · {link.viewer?.connected ? 'espelhando' : 'sem conexão'}
        </span>
      )}
      <ScenarioMenu current={s.scenarioId} />
      <Menu label="☰" title="Mais: passo a passo, velocidade, janelas, engenharia, procedimento e modo palco" className="tb-more">
        {(close) => (
          <div className="tb-more-pop">
            <section>
              <h4>Tempo</h4>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn" disabled={runner.running} onClick={() => runner.stepOnce(1)} title="Avançar um passo fixo">
                  +1 passo
                </button>
                <button className="btn" disabled={runner.running} onClick={() => runner.stepOnce(50)} title="Avançar 1 s">
                  +1 s
                </button>
              </div>
              <SimSpeedButtons />
            </section>
            <section>
              <h4>Janelas</h4>
              <div className="row" style={{ gap: 6 }}>
                {isPanelWindow ? (
                  <button
                    className="btn"
                    onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)}
                    title="Tela cheia neste monitor (F11 também funciona)"
                  >
                    ⛶ Tela cheia
                  </button>
                ) : (
                  <>
                    <button className={`btn ${link.master?.connected ? 'on' : ''}`} onClick={() => (openVisualWindow(), close())} title="Abre a cena numa segunda janela (ex.: outro monitor), espelhando esta simulação">
                      ⧉ 2ª janela{link.master?.connected ? ' ✓' : ''}
                    </button>
                    <button
                      className={`btn ${link.master?.panelConnected ? 'on' : ''}`}
                      onClick={() => {
                        const n = openPanelWindow();
                        ui.toast(`Tela ${n} aberta: arraste-a para o outro monitor e escolha a aba. Comandos dados nela valem aqui.`);
                        close();
                      }}
                      title="Abre outra janela com o simulador completo (todas as abas), espelhando esta simulação — ex.: o mapa tático num 3º monitor"
                    >
                      ＋ Tela{link.master?.panelConnected ? ' ✓' : ''}
                    </button>
                  </>
                )}
              </div>
            </section>
            <section>
              <h4>Modos</h4>
              <div className="row" style={{ gap: 6 }}>
                <button className={`btn ${stage ? 'on' : ''}`} onClick={() => (setStage(!stage), close())} title="Modo palco (F): esconde a barra e a navegação; ficam a tela e os alarmes">
                  ⛶ Modo palco <kbd>F</kbd>
                </button>
                <button className={`btn ${ui.eng ? 'on' : ''}`} onClick={() => ui.setEng(!ui.eng)} title="Modo engenharia (I)">
                  ⓘ Engenharia <kbd>I</kbd>
                </button>
                <button className={`btn ${ui.showProcedure ? 'on' : ''}`} onClick={() => (ui.setShowProcedure(!ui.showProcedure), close())}>
                  Procedimento
                </button>
              </div>
            </section>
          </div>
        )}
      </Menu>
    </div>
  );
}
