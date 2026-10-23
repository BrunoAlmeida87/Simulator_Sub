/** Painel de gravação e reprodução de comandos (aba Configurações) e indicador compacto (barra superior). */
import { useEffect, useReducer, useRef, useState } from 'react';
import { Panel } from './Panel';
import { recorder } from '../recorder';
import { runner, useSim } from '../store';
import { useUi } from '../uiContext';
import { downloadText } from '../storage';
import { parseRecording, recordingToText, type RecordingFile } from '../../sim/recording';
import { SIM_VERSION } from '../../sim/version';
import { scenarioById } from '../../sim/scenarios';
import { fmtTime } from '../format';
import { isPanelWindow } from '../sync';

export function useRecorder() {
  const [, f] = useReducer((x: number) => x + 1, 0);
  useEffect(() => recorder.subscribe(f), []);
  return recorder;
}

const fileName = (r: RecordingFile) =>
  `sx1-gravacao-${
    r.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'comandos'
  }.json`;

export function RecordingPanel() {
  useSim(4);
  const rec = useRecorder();
  const ui = useUi();
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const r = rec.rec;
  const pr = rec.progress;
  const chk = rec.checkSummary;
  const saved = rec.listSaved();
  const load = (input: string | unknown, label: string) => {
    try {
      const p = parseRecording(input);
      rec.load(p.rec, p.warnings);
      ui.toast(`Gravação “${p.rec.name}” carregada (${label}). Use ▶ Reproduzir.`);
    } catch (ex) {
      ui.toast('Não foi possível carregar: ' + (ex instanceof Error ? ex.message : String(ex)));
    }
  };
  // a gravação acompanha cada passo da física, que só roda na janela de controle
  if (isPanelWindow)
    return (
      <Panel title="Gravação e reprodução de comandos" className="span-all">
        <div className="note">Esta é uma janela de tela (espelho). Para gravar ou reproduzir comandos, use a janela de controle — os comandos dados aqui entram na gravação de lá normalmente.</div>
      </Panel>
    );
  return (
    <Panel
      title="Gravação e reprodução de comandos"
      className="span-all"
      tag={<span className={`badge ${rec.mode === 'gravando' ? 'alarm blink' : rec.mode === 'reproduzindo' ? 'info' : 'off'}`}>{rec.mode.toUpperCase()}</span>}
    >
      <div className="row">
        {rec.mode !== 'gravando' ? (
          <>
            <input type="text" placeholder="Nome da gravação (opcional)" value={name} onChange={(ev) => setName(ev.target.value)} style={{ flex: '1 1 180px', minWidth: 0 }} disabled={rec.mode === 'reproduzindo'} />
            <button
              className="btn danger"
              disabled={rec.mode === 'reproduzindo'}
              onClick={() => {
                rec.start(name);
                setName('');
                ui.toast('Gravando: os comandos dados a partir de agora (seus e das automações) serão registrados.');
              }}
              title="Guarda o estado atual como início e registra os comandos seguintes"
            >
              ● Iniciar gravação
            </button>
          </>
        ) : (
          <button className="btn danger on" onClick={() => rec.stopRecording()}>
            ■ Parar gravação
          </button>
        )}
        <button className="btn" disabled={!r || rec.mode === 'gravando'} onClick={() => r && ui.toast(rec.saveToBrowser(r) ? 'Gravação salva neste navegador.' : 'Armazenamento cheio/indisponível — use “Baixar”.')}>
          💾 Salvar
        </button>
        <button className="btn" disabled={!r || rec.mode === 'gravando'} onClick={() => r && downloadText(fileName(r), recordingToText(r))}>
          ⬇ Baixar gravação
        </button>
        <button className="btn" disabled={rec.mode === 'gravando'} onClick={() => fileRef.current?.click()}>
          📂 Carregar gravação
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={async (ev) => {
            const f = ev.target.files?.[0];
            ev.target.value = '';
            if (f) load(await f.text(), 'arquivo');
          }}
        />
      </div>
      <div className="row mt8">
        <button
          className="btn ok"
          disabled={!r || rec.mode === 'gravando' || (rec.mode === 'reproduzindo' && runner.running && !rec.finished)}
          onClick={() => rec.play()}
          title="Reproduz desde a condição inicial gravada (ou continua após pausa)"
        >
          ▶ {rec.mode === 'reproduzindo' && !rec.finished ? 'Continuar' : 'Reproduzir'}
        </button>
        <button className="btn" disabled={rec.mode !== 'reproduzindo' || !runner.running} onClick={() => rec.pause()}>
          ❚❚ Pausar
        </button>
        <button className="btn warn" disabled={rec.mode !== 'reproduzindo'} onClick={() => rec.endReplay()} title="Para a reprodução; a simulação fica neste ponto e volta a aceitar seus comandos">
          ■ Encerrar reprodução
        </button>
        {r && (
          <span className="subtle">
            <b>{r.name}</b> · {scenarioById(r.initial.scenarioId).name} · t {fmtTime(r.initial.simTime)} → {fmtTime(r.end.t)} · {rec.commandCount} comandos
            {r.simVersion !== SIM_VERSION ? ` · gravada na versão ${r.simVersion}` : ''}
          </span>
        )}
      </div>
      {rec.mode === 'gravando' && r && (
        <div className="rec-status mt8">
          <span className="badge alarm blink">● REC</span> {fmtTime(runner.engine.state.t - r.initial.simTime)} gravados · {rec.commandCount} comandos ({r.events.filter((x) => x.cmd && x.src !== 'operador').length} de
          automações) · {r.checkpoints.length} pontos de controle
        </div>
      )}
      {rec.mode === 'reproduzindo' && r && (
        <div className="rec-status mt8">
          <div className="recbar">
            <span style={{ width: `${pr.frac * 100}%` }} />
          </div>
          <div className="subtle">
            {rec.finished ? 'Concluída' : runner.running ? 'Reproduzindo' : 'Pausada'} · {fmtTime(pr.t - pr.t0)} de {fmtTime(pr.t1 - pr.t0)} · {rec.applied}/{rec.commandCount} comandos aplicados · conferência:{' '}
            {chk.exact}/{chk.n} pontos idênticos
            {chk.n > chk.exact ? ` (maior desvio de posição ${chk.maxPos.toFixed(2)} m)` : ''}
            {rec.blocked ? ` · ${rec.blocked} comando(s) seu(s) bloqueado(s)` : ''}
          </div>
          {rec.upcoming().length > 0 && <div className="subtle">Próximos: {rec.upcoming().join(' · ')}</div>}
        </div>
      )}
      {rec.lastStop && <div className="note">{rec.lastStop}</div>}
      {rec.warnings.map((w) => (
        <div className="note" key={w} style={{ borderColor: '#f5b041' }}>
          {w}
        </div>
      ))}
      {saved.length > 0 && (
        <table className="t mt8">
          <tbody>
            {saved.map((s) => (
              <tr key={s.createdAt}>
                <td>
                  <b>{s.name}</b>
                  <div className="subtle">
                    {new Date(s.createdAt).toLocaleString('pt-BR')} · {s.events.filter((x) => x.cmd).length} comandos · {fmtTime(s.end.t - s.initial.simTime)}
                  </div>
                </td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn sm" disabled={rec.mode === 'gravando'} onClick={() => load(s, 'navegador')}>
                    Carregar
                  </button>{' '}
                  <button className="btn sm" onClick={() => downloadText(fileName(s), recordingToText(s))}>
                    Baixar
                  </button>{' '}
                  <button className="btn sm danger" onClick={() => rec.deleteSaved(s.createdAt)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="note">
        A gravação guarda o estado inicial completo e cada comando estruturado (tipo, valores, passo fixo e tempo de simulação, e quem o deu: você ou uma automação), além da narração das automações. Na reprodução o
        simulador volta ao estado inicial gravado e reaplica cada comando no mesmo passo: com passo fixo a evolução é a mesma, e os pontos de controle a cada {10} s confirmam. As automações ficam paradas durante a
        reprodução (os comandos delas já estão gravados) e seus comandos manuais são bloqueados até pausar e encerrar. Trocar de cenário encerra a gravação. Limitação: gravações de outra versão do simulador, ou abertas
        em outro navegador, podem divergir aos poucos se a física ou as funções matemáticas forem diferentes — a conferência mostra a diferença.
      </div>
    </Panel>
  );
}

/** Indicador compacto na barra superior (gravando / reproduzindo). */
export function RecIndicator() {
  const rec = useRecorder();
  const e = useSim(4);
  const ui = useUi();
  if (rec.mode === 'parado' || !rec.rec) return null;
  const go = () => ui.setScreen('config');
  if (rec.mode === 'gravando')
    return (
      <button className="btn sm danger on" onClick={go} title="Gravando comandos — abrir controles">
        ● REC {fmtTime(e.state.t - rec.rec.initial.simTime)}
      </button>
    );
  const p = rec.progress;
  return (
    <button className="btn sm on" onClick={go} title="Reprodução de gravação — abrir controles">
      ▶ REPRODUÇÃO {fmtTime(p.t - p.t0)}/{fmtTime(p.t1 - p.t0)}
      {rec.finished ? ' ✓' : ''}
    </button>
  );
}
