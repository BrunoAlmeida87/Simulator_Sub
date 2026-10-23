/**
 * ESTÚDIO DE APRESENTAÇÕES — criar, ensaiar e apresentar, etapa por etapa.
 *
 * Editor: lista de etapas à esquerda, palco (cena 3D com o cartão como vai
 * aparecer, valores ao vivo) no centro e o formulário da etapa à direita:
 * texto e formatação, visualização, ações, gatilho para avançar, notas do
 * apresentador e estado guardado.
 *
 * Apresentando: palco grande com o cartão, os mostradores e a barra do
 * apresentador (anterior, pausar, próxima, repetir, tela cheia) e, ao lado,
 * o painel do apresentador (notas, próxima etapa, lista de etapas).
 * O que cada etapa faz é executado por presBuilder/player.ts.
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import { runner, useSim } from '../store';
import { Scene3D } from '../components/Scene3D';
import { graphics, useQuality } from '../graphics';
import { SceneLayerPanel } from '../components/SceneLayerPanel';
import { OverlayCtl } from '../components/OverlayCtl';
import { viewSection } from '../components/OverlayMenu';
import { seaSections } from '../components/SeaControls';
import { LAYER_LIST } from './PresentationScreen';
import { pres } from '../presentation';
import { useUi } from '../uiContext';
import { usePersisted, loadPersisted } from '../persist';
import { fmt, fmtTime, fmtSpeed } from '../format';
import { downloadText } from '../storage';
import { SCENARIOS, LOAD_LABELS, buildScenario, type LoadCondition } from '../../sim/scenarios';
import { serializeEngine, deserializeEngine } from '../../sim/persistence';
import { applyCommand, withCommandSource } from '../../sim/commands';
import type { SimulationEngine } from '../../sim/core/engine';
import type { SceneLayers } from '../../render3d/layers';
import { NAV_GROUPS } from '../nav';
import { baseConfig } from '../store';
import { RichText, PresCardView, PresHudView, hudSide } from '../components/PresCard';
import { isPanelWindow } from '../sync';
import { droneCtl } from '../droneCtl';
import { bridgeSight } from '../bridgeSight';
import { presPlayer, applyViewPose, subRef, type CardData, type HudItem, type StepOutcome } from '../presBuilder/player';
import { presLibrary, exportText, presFileName, presSizeKB, scriptMarkdown } from '../presBuilder/library';
import {
  newPresentation,
  newStep,
  newAction,
  cloneStep,
  clonePresentation,
  presentationProblems,
  droneToStep,
  droneFromStep,
  type DroneFrame,
  defaultAdvance,
  NEXT_END,
  type UserPresentation,
  type PresStep,
  type StepScreen,
  type RunMode,
  type CardStyle,
  type CardPosition,
  type CardSize,
  type AdvanceMode,
  type CamPose,
} from '../presBuilder/model';
import { ACTION_TYPES, ACTION_GROUPS, actionType, describeAction, runAction, actionProblem, VIEW_OPTIONS, type FieldDef, type StepAction, type ActionCtx, type ParamValue } from '../presBuilder/actions';
import { PRES_VARS, VAR_GROUPS, presVar, fillTemplate, fmtVarUnit, readVar, COND_OPS, testCondition, unknownPlaceholders, describeCondition, type Condition, type CondOp } from '../presBuilder/variables';
import { TEXT_COLORS } from '../presBuilder/richText';

const SETTINGS = '__config';

const SCREEN_OPTIONS: [StepScreen, string][] = [
  ['palco', 'Palco do Estúdio (cena 3D com o cartão)'],
  ...NAV_GROUPS.flatMap((g) => g.screens.filter((s) => s.id !== 'estudio').map((s) => [s.id, `${g.label} › ${s.label.replace(/^⚙\s*/, '')}`] as [StepScreen, string])),
];

const RUN_OPTIONS: [RunMode, string, string][] = [
  ['executar', '▶ Executar', 'A simulação roda nesta etapa'],
  ['pausar', '❚❚ Pausar', 'Congela a cena (para explicar com calma); o relógio da etapa continua'],
  ['manter', 'Manter', 'Não muda o que estiver'],
];
const SCALES = [0.25, 0.5, 1, 2, 3, 5, 10, 20];
const HUD_PRESETS: [string, string[]][] = [
  ['Forças', ['peso', 'empuxo', 'resultante']],
  ['Navegação', ['prof', 'vel', 'pitch']],
  ['Lastro', ['tlp', 'reserva', 'imerso']],
];
const STYLE_OPTIONS: [CardStyle, string, string][] = [
  ['cartao', 'Cartão', 'Título, texto, “por quê” e status num cartão'],
  ['titulo', 'Título', 'Texto grande sobre a cena (abertura, capítulos)'],
  ['legenda', 'Legenda', 'Faixa de texto embaixo, como legenda de vídeo'],
  ['oculto', 'Sem texto', 'Só a cena (o texto fica no painel do apresentador)'],
];
const POS_OPTIONS: [CardPosition, string][] = [
  ['baixo', 'Embaixo'],
  ['topo', 'Em cima'],
  ['esquerda', 'Esquerda'],
  ['direita', 'Direita'],
  ['centro', 'Centro'],
  ['baixo-esquerda', 'Embaixo à esquerda'],
  ['baixo-direita', 'Embaixo à direita'],
];
const SIZE_OPTIONS: CardSize[] = ['P', 'M', 'G', 'GG'];
const OUT_ICON: Record<StepOutcome, string> = { pendente: '○', 'em curso': '●', concluída: '✓', 'tempo esgotado': '⌛', pulada: '↷' };

function useLibrary(): void {
  const [, f] = useReducer((x: number) => x + 1, 0);
  useEffect(() => presLibrary.subscribe(f), []);
}
function usePresStore(): void {
  const [, f] = useReducer((x: number) => x + 1, 0);
  useEffect(() => pres.subscribe(f), []);
}

const varCtx = () => ({ tStep: 0, maneuver: false });

/** cartão da etapa como vai aparecer (valores ao vivo da simulação atual) */
function previewCard(p: UserPresentation, st: PresStep, k: number, e: SimulationEngine): CardData {
  const c = varCtx();
  return {
    name: p.name,
    title: fillTemplate(st.title, e, c),
    text: fillTemplate(st.text, e, c),
    why: fillTemplate(st.why, e, c),
    k,
    n: p.steps.length,
    format: st.format,
    status: { kind: 'manual', text: `Avança: ${advanceText(p, st)}` },
    outcome: p.steps.map((_, i) => (i < k ? 'concluída' : i === k ? 'em curso' : 'pendente')),
  };
}

function previewHud(st: PresStep, e: SimulationEngine): HudItem[] {
  return st.visual.hud.flatMap((id) => {
    const v = presVar(id);
    return v ? [{ id, label: v.label, value: fmtVarUnit(v, readVar(id, e, varCtx())) }] : [];
  });
}

function advanceText(p: UserPresentation, st: PresStep): string {
  const a = st.advance;
  const base =
    a.mode === 'manual'
      ? 'quando o apresentador quiser (→)'
      : a.mode === 'tempo'
        ? `depois de ${a.seconds} s`
        : `quando ${a.waitText || a.conditions.map(describeCondition).join(a.logic === 'todas' ? ' e ' : ' ou ') || '—'}`;
  if (a.next === NEXT_END) return `${base} → encerra`;
  if (a.next) {
    const j = p.steps.findIndex((s) => s.id === a.next);
    if (j >= 0) return `${base} → etapa ${j + 1}`;
  }
  return base;
}

const trigIcon = (s: PresStep) => (s.advance.mode === 'manual' ? '👆' : s.advance.mode === 'tempo' ? `⏱${s.advance.seconds}s` : '⚑');

/** ações testadas no editor: mesmas regras da apresentação, sobre a simulação atual */
function editorCtx(): ActionCtx {
  return {
    r: runner,
    send: (c) => withCommandSource('apresentação', () => runner.command(c)),
    setView: (v) => pres.setView(v),
    setLayers: (l) => pres.setLayers(l),
    markBefore: () => pres.markBefore(runner),
    restoreBefore: () => pres.restoreBefore(runner),
    restoreStart: () => pres.restoreInitial(runner),
    loadScenario: (id, sea) => {
      const e = buildScenario(id, baseConfig());
      if (sea !== null) applyCommand(e, { type: 'seaState', value: sea });
      e.computeOutputs();
      runner.replaceEngine(e);
    },
  };
}

// ====================================================================== tela
export function StudioScreen() {
  useLibrary();
  usePresStore();
  useSim(2);
  const [view, setView] = useState<'palco' | 'editor'>('palco');
  const playing = presPlayer.active || !!presPlayer.ff || (!!presPlayer.finished && !!presPlayer.pres);
  // apresentação iniciada (aqui ou por outra tela): mostra o palco
  useEffect(() => {
    if (presPlayer.active) setView('palco');
  }, [presPlayer.active, presPlayer.pres?.id]);
  if (playing && view === 'palco') return <PlayerStage onEditor={() => setView('editor')} />;
  return <Editor onStage={playing ? () => setView('palco') : null} onPlay={() => setView('palco')} />;
}

// ====================================================================== editor
function Editor({ onStage, onPlay }: { onStage: (() => void) | null; onPlay: () => void }) {
  const e = useSim(4);
  const ui = useUi();
  const mine = presLibrary.mine();
  const builtins = presLibrary.builtins();
  const [selId, setSelId] = usePersisted<string>('studio.sel', builtins[0].id);
  const cur = presLibrary.get(selId) ?? mine[0] ?? builtins[0];
  const [stepSel, setStepSel] = usePersisted<string>('studio.stepSel', '');
  const [tab, setTab] = usePersisted<string>('studio.tab', 'texto');
  const [autoApply, setAutoApply] = usePersisted('studio.autoApply', true);
  const idx = cur.steps.findIndex((s) => s.id === stepSel);
  const k = stepSel === SETTINGS ? -1 : Math.max(0, idx);
  const step = k >= 0 ? cur.steps[k] : null;
  const undo = useRef<{ id: string; list: UserPresentation[]; at: number }>({ id: '', list: [], at: 0 });
  const fileRef = useRef<HTMLInputElement>(null);
  const [pose, setPose] = useState<{ key: number; pose: CamPose } | null>(null);
  const poseKey = useRef(0);

  /** altera a apresentação (modelos viram uma cópia editável); selectAfter = etapa a selecionar depois */
  const update = (fn: (p: UserPresentation) => void, selectAfter?: number) => {
    let base = cur;
    if (cur.builtin) {
      base = clonePresentation(cur, cur.name.replace(/\s*\(modelo\)\s*$/, ''));
      ui.toast('Modelo copiado para “Minhas apresentações”: as alterações ficam na cópia.');
    } else {
      const u = undo.current;
      if (u.id !== cur.id) {
        u.id = cur.id;
        u.list = [];
      }
      const now = performance.now();
      if (now - u.at > 1200) {
        u.list.push(cur);
        if (u.list.length > 80) u.list.shift();
      }
      u.at = now;
    }
    const next = structuredClone(base);
    fn(next);
    if (!presLibrary.save(next) && presLibrary.lastError) ui.toast(presLibrary.lastError);
    if (cur.builtin) setSelId(next.id);
    if (selectAfter !== undefined) setStepSel(next.steps[Math.max(0, Math.min(next.steps.length - 1, selectAfter))]?.id ?? '');
    else if (cur.builtin && k >= 0) setStepSel(next.steps[k]?.id ?? '');
    presPlayer.syncDefinition(next);
  };
  const updStep = (fn: (s: PresStep, p: UserPresentation) => void) => {
    if (k < 0) return;
    update((p) => fn(p.steps[k], p));
  };
  const doUndo = () => {
    const u = undo.current;
    if (u.id !== cur.id || !u.list.length) return;
    const prev = u.list.pop()!;
    presLibrary.save(prev);
    presPlayer.syncDefinition(prev);
    u.at = 0;
  };

  // aplica a visualização da etapa ao palco
  const applyVisual = (st: PresStep) => {
    const v = st.visual;
    if (v.layers) pres.setLayers({ ...v.layers });
    if (v.view) pres.setView(v.view);
    if (v.camPose && (v.view ?? pres.view) === 'livre') setPose({ key: ++poseKey.current, pose: v.camPose });
    applyViewPose(v, v.view ?? pres.view, runner.engine);
    if (v.persp !== null) graphics.set({ deepPersp: v.persp });
  };
  useEffect(() => {
    if (autoApply && step && !presPlayer.active) applyVisual(step);
  }, [step?.id, cur.id]);

  const captureVisual = () =>
    updStep((s) => {
      s.visual.view = pres.view;
      s.visual.layers = { ...pres.layers };
      s.visual.camPose = pres.view === 'livre' ? loadPersisted<CamPose | null>('cam.studio', null) : null;
      s.visual.drone = pres.view === 'drone' && droneCtl.pose ? droneToStep(droneCtl.pose, subRef(runner.engine), s.visual.droneFrame) : null;
      s.visual.bridge = pres.view === 'passadico' ? { ...bridgeSight.get() } : null;
      s.visual.persp = graphics.get().deepPersp;
      ui.toast(`Etapa ${k + 1}: câmera “${VIEW_OPTIONS.find((x) => x[0] === pres.view)?.[1] ?? pres.view}” e camadas atuais guardadas.`);
    });

  const play = (from: number, direct = false) => {
    if (!presPlayer.start(runner, cur, from, direct)) {
      ui.toast('Não foi possível iniciar (há uma reprodução de gravação em andamento?).');
      return;
    }
    onPlay();
  };

  // ---------------------------------------------------------- etapas
  const addStep = () => {
    const base = step ?? cur.steps[cur.steps.length - 1];
    const ns = newStep({ title: 'Nova etapa', visual: base ? structuredClone(base.visual) : undefined, advance: defaultAdvance() });
    const at = k >= 0 ? k + 1 : cur.steps.length;
    update((p) => void p.steps.splice(at, 0, ns), at);
    setTab('texto');
  };
  const dupStep = () => {
    if (!step) return;
    const c = cloneStep(step);
    c.title = `${step.title} (cópia)`;
    update((p) => void p.steps.splice(k + 1, 0, c), k + 1);
  };
  const moveStep = (d: number) => {
    const j = k + d;
    if (k < 0 || j < 0 || j >= cur.steps.length) return;
    update((p) => {
      const [x] = p.steps.splice(k, 1);
      p.steps.splice(j, 0, x);
    }, j);
  };
  const delStep = () => {
    if (!step) return;
    if (cur.steps.length <= 1) return ui.toast('A apresentação precisa ter pelo menos uma etapa.');
    if (!window.confirm(`Excluir a etapa ${k + 1} “${step.title}”?`)) return;
    const id = step.id;
    update(
      (p) => {
        p.steps.splice(k, 1);
        for (const x of p.steps) if (x.advance.next === id) x.advance.next = '';
      },
      Math.max(0, k - 1),
    );
  };

  // ---------------------------------------------------------- arquivo
  const select = (id: string) => {
    setSelId(id);
    setStepSel('');
  };
  const create = () => {
    const p = newPresentation();
    presLibrary.save(p);
    select(p.id);
    setStepSel(p.steps[0].id);
    setTab('texto');
  };
  const duplicate = () => {
    const p = clonePresentation(cur, cur.builtin ? cur.name.replace(/\s*\(modelo\)\s*$/, '') : undefined);
    presLibrary.save(p);
    select(p.id);
    ui.toast(`Cópia criada: “${p.name}”.`);
  };
  const remove = () => {
    if (cur.builtin) return;
    if (!window.confirm(`Excluir a apresentação “${cur.name}”? (Exporte antes se quiser guardar um arquivo.)`)) return;
    presLibrary.remove(cur.id);
    select(presLibrary.mine()[0]?.id ?? builtins[0].id);
  };
  const importFile = async (f: File) => {
    const r = presLibrary.importText(await f.text());
    if (r.error) ui.toast(r.error);
    else {
      ui.toast(`${r.added.length === 1 ? 'Apresentação importada' : `${r.added.length} apresentações importadas`}: ${r.added.map((p) => p.name).join(', ')}`);
      select(r.added[0].id);
    }
  };

  const problems = presentationProblems(cur);
  const probSteps = new Set(problems.map((p) => p.step));
  const tabs: [string, string][] = [
    ['texto', 'Texto'],
    ['visual', 'Visualização'],
    ['acoes', `Ações${step?.actions.length ? ` (${step.actions.length})` : ''}`],
    ['avancar', 'Avançar'],
    ['notas', `Notas${step?.notes.trim() ? ' •' : ''}`],
    ['estado', `Estado${step?.state ? ' 💾' : ''}`],
  ];

  return (
    <div className="studio">
      <div className="st-toolbar">
        <select className="st-sel" value={cur.id} onChange={(ev) => select(ev.target.value)} aria-label="Apresentação">
          {mine.length > 0 && (
            <optgroup label="Minhas apresentações">
              {mine.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Modelos (editar cria uma cópia)">
            {builtins.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        </select>
        <span className="btngroup">
          <button className="btn sm" onClick={create} title="Nova apresentação em branco">
            ＋ Nova
          </button>
          <button className="btn sm" onClick={duplicate} title="Duplicar esta apresentação">
            ⧉ Duplicar
          </button>
          <button className="btn sm" disabled={cur.builtin} onClick={remove} title={cur.builtin ? 'Modelos não podem ser excluídos' : 'Excluir esta apresentação'}>
            🗑 Excluir
          </button>
          <button className="btn sm" disabled={cur.builtin || undo.current.id !== cur.id || !undo.current.list.length} onClick={doUndo} title="Desfazer a última alteração">
            ↶ Desfazer
          </button>
        </span>
        <span className="btngroup">
          <button className="btn sm" onClick={() => fileRef.current?.click()} title="Abrir um arquivo .json de apresentação (de outro computador, de um colega…)">
            ⭳ Importar
          </button>
          <button className="btn sm" onClick={() => downloadText(presFileName(cur), exportText(cur))} title="Salvar esta apresentação num arquivo .json">
            ⭱ Exportar
          </button>
          <button
            className="btn sm"
            onClick={() => downloadText(presFileName(cur, 'md'), scriptMarkdown(cur), 'text/markdown')}
            title="Roteiro em texto: textos, notas, ações e gatilhos de cada etapa (para revisar ou imprimir)"
          >
            📄 Roteiro
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(ev) => {
              const f = ev.target.files?.[0];
              ev.target.value = '';
              if (f) void importFile(f);
            }}
          />
        </span>
        <span className="btngroup st-play-btns">
          {onStage && (
            <button className="btn sm on" onClick={onStage}>
              ▶ Voltar ao palco ({(presPlayer.k ?? 0) + 1}/{presPlayer.pres?.steps.length ?? 0})
            </button>
          )}
          {isPanelWindow && <span className="subtle">Para apresentar, use a janela principal (aqui só edição).</span>}
          <button className="btn ok" disabled={isPanelWindow} onClick={() => play(0)} title="Apresenta do início (ponto de partida definido em ⚙ Apresentação)">
            ▶ Apresentar
          </button>
          <button className="btn sm" disabled={k <= 0 || isPanelWindow} onClick={() => play(k)} title="Começa do ponto de partida e executa as etapas anteriores em velocidade acelerada, pela física, até chegar nesta">
            ⏩ Desta etapa
          </button>
          <button className="btn sm" disabled={k < 0 || isPanelWindow} onClick={() => play(k, true)} title="Testa só esta etapa, a partir da situação atual do simulador (sem voltar ao início)">
            ▷ Testar etapa
          </button>
        </span>
      </div>
      {cur.builtin && <div className="st-banner">Modelo somente leitura — qualquer alteração cria automaticamente uma cópia em “Minhas apresentações”.</div>}

      <div className="st-grid">
        {/* ------------------------------------------------ etapas */}
        <div className="st-steps panel">
          <button className={`st-item st-cfg ${k < 0 ? 'sel' : ''}`} onClick={() => setStepSel(SETTINGS)}>
            <span className="st-num">⚙</span>
            <span className="st-title">Apresentação e ponto de partida</span>
            {probSteps.has(-1) && <span className="st-icons warn">⚠</span>}
          </button>
          {cur.steps.map((s, i) => (
            <button key={s.id} className={`st-item ${i === k ? 'sel' : ''}`} onClick={() => setStepSel(s.id)} title={advanceText(cur, s)}>
              <span className="st-num">{i + 1}</span>
              <span className="st-title">{s.title || '(sem título)'}</span>
              <span className="st-icons">
                {s.format.style === 'titulo' ? 'T ' : ''}
                {trigIcon(s)}
                {s.actions.length ? ` ⚡${s.actions.length}` : ''}
                {s.state && s.loadState ? ' 💾' : ''}
                {s.visual.screen !== 'palco' ? ' 🖥' : ''}
                {s.advance.next ? ' ↪' : ''}
                {probSteps.has(i) ? ' ⚠' : ''}
              </span>
            </button>
          ))}
          <div className="btngroup st-step-btns">
            <button className="btn sm ok" onClick={addStep} title="Nova etapa depois da selecionada (com a mesma visualização)">
              ＋ Etapa
            </button>
            <button className="btn sm" disabled={!step} onClick={dupStep} title="Duplicar a etapa">
              ⧉
            </button>
            <button className="btn sm" disabled={k <= 0} onClick={() => moveStep(-1)} title="Mover para cima">
              ↑
            </button>
            <button className="btn sm" disabled={k < 0 || k >= cur.steps.length - 1} onClick={() => moveStep(1)} title="Mover para baixo">
              ↓
            </button>
            <button className="btn sm" disabled={!step} onClick={delStep} title="Excluir a etapa">
              🗑
            </button>
          </div>
          <div className="subtle st-legend">👆 manual · ⏱ tempo · ⚑ condição · ⚡ ações · 💾 estado guardado · 🖥 outra tela · ↪ desvio</div>
        </div>

        {/* ------------------------------------------------ palco (pré-visualização) */}
        <div className="st-center">
          <EditorStage e={e} cur={cur} step={step} k={k} pose={pose} />
          <div className="st-preview-bar row">
            <button className="btn sm" disabled={!step} onClick={() => step && applyVisual(step)} title="Coloca no palco a câmera e as camadas desta etapa">
              👁 Ver visualização da etapa
            </button>
            <button
              className="btn sm ok"
              disabled={!step}
              onClick={captureVisual}
              title="Guarda na etapa a câmera (com a posição da câmera livre, do drone ou a visada do passadiço) e as camadas que estão no palco agora"
            >
              📷 Usar a visualização atual
            </button>
            <label className="chk subtle" title="Ao selecionar uma etapa, o palco mostra a câmera e as camadas dela">
              <input type="checkbox" checked={autoApply} onChange={(ev) => setAutoApply(ev.target.checked)} /> aplicar ao selecionar
            </label>
            <span className="st-sim row">
              <button className={`btn sm ${runner.running ? 'on' : 'ok'}`} onClick={() => ((runner.running = !runner.running), runner.notify())}>
                {runner.running ? '❚❚' : '▶'}
              </button>
              <span className="clock mono">{fmtTime(e.state.t)}</span>
              <button
                className="btn sm warn"
                onClick={() => {
                  presPlayer.loadStart(runner, cur);
                  pres.initial = serializeEngine(runner.engine, `Início: ${cur.name}`);
                  ui.toast('Simulador no ponto de partida da apresentação (pausado).');
                }}
                title="Coloca o simulador no ponto de partida desta apresentação (para preparar e capturar estados)"
              >
                ↺ Ponto de partida
              </button>
            </span>
          </div>
          {problems.length > 0 && (
            <div className="st-problems">
              {problems.map((p, i) => (
                <div key={i} className="warn-text">
                  ⚠ {p.step >= 0 ? `Etapa ${p.step + 1}: ` : ''}
                  {p.text}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ------------------------------------------------ formulário */}
        <div className="st-form panel">
          {k < 0 || !step ? (
            <SettingsForm cur={cur} update={update} e={e} />
          ) : (
            <>
              <div className="st-form-head">
                <span className="st-num big">{k + 1}</span>
                <input className="st-title-input" type="text" value={step.title} onChange={(ev) => updStep((s) => void (s.title = ev.target.value))} aria-label="Título da etapa" placeholder="Título da etapa" />
              </div>
              <div className="seg st-tabs">
                {tabs.map(([id, l]) => (
                  <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="st-tab-body">
                {tab === 'texto' && <TextTab step={step} updStep={updStep} />}
                {tab === 'visual' && <VisualTab e={e} step={step} updStep={updStep} capture={captureVisual} />}
                {tab === 'acoes' && <ActionsTab e={e} step={step} updStep={updStep} />}
                {tab === 'avancar' && <AdvanceTab e={e} cur={cur} step={step} k={k} updStep={updStep} />}
                {tab === 'notas' && <NotesTab step={step} updStep={updStep} />}
                {tab === 'estado' && <StateTab e={e} step={step} k={k} updStep={updStep} />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- palco do editor
function EditorStage({ e, cur, step, k, pose }: { e: SimulationEngine; cur: UserPresentation; step: PresStep | null; k: number; pose: { key: number; pose: CamPose } | null }) {
  const [quality, setQuality] = useQuality();
  const card = step ? previewCard(cur, step, k, e) : null;
  return (
    <div className="st-preview">
      <Scene3D quality={quality} view={pres.view} layers={pres.layers} labels={false} persistKey="studio" camPose={pose} hud="compact">
        {step && <PresHudView items={previewHud(step, e)} side={hudSide(card)} />}
        {card && (
          <div className="st-in">
            <PresCardView c={card} />
          </div>
        )}
        <OverlayCtl
          persistKey="studio"
          sections={[
            viewSection(
              VIEW_OPTIONS.map(([id, label]) => ({ id, label })),
              pres.view,
              (v) => pres.setView(v, true),
            ),
            {
              id: 'camadas',
              label: <>Camadas ({LAYER_LIST.filter((x) => !!pres.layers[x]).length})</>,
              title: 'Tanques, vetores, identificações e ambiente do palco',
              className: 'scene-layer-pop',
              content: <SceneLayerPanel e={e} keys={LAYER_LIST} value={pres.layers} onChange={(p) => pres.setLayers(p)} hullControl />,
            },
            ...seaSections(quality, setQuality),
          ]}
        />
      </Scene3D>
      {card && (
        <div className="st-under">
          <PresCardView c={card} compact />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- campos
/** número editável sem perder o que está sendo digitado ("-", "0,") */
function NumInput({ value, onChange, min, max, step, width, title }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; width?: number; title?: string }) {
  const [txt, setTxt] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setTxt(String(value));
  }, [value]);
  return (
    <input
      type="number"
      value={txt}
      min={min}
      max={max}
      step={step ?? 'any'}
      title={title}
      style={width ? { width } : undefined}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        setTxt(String(value));
      }}
      onChange={(ev) => {
        setTxt(ev.target.value);
        const v = Number(ev.target.value.replace(',', '.'));
        if (ev.target.value.trim() !== '' && Number.isFinite(v)) onChange(min !== undefined || max !== undefined ? Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v)) : v);
      }}
    />
  );
}

function Seg<T extends string | number>({ value, options, onChange, title }: { value: T; options: [T, string, string?][]; onChange: (v: T) => void; title?: string }) {
  return (
    <span className="seg st-seg" title={title}>
      {options.map(([v, l, t]) => (
        <button key={String(v)} className={value === v ? 'on' : ''} onClick={() => onChange(v)} title={t}>
          {l}
        </button>
      ))}
    </span>
  );
}

function VarSelect({ value, onChange, placeholder }: { value: string; onChange: (id: string) => void; placeholder?: string }) {
  return (
    <select value={value} onChange={(ev) => onChange(ev.target.value)} className="st-var-sel">
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {VAR_GROUPS.map((g) => (
        <optgroup key={g} label={g}>
          {PRES_VARS.filter((v) => v.group === g).map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
              {v.unit ? ` (${v.unit})` : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

type UpdStep = (fn: (s: PresStep, p: UserPresentation) => void) => void;

// ---------------------------------------------------------------- aba Texto
function TextTab({ step, updStep }: { step: PresStep; updStep: UpdStep }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [delta, setDelta] = useState(false);
  const f = step.format;
  const setText = (t: string, sel?: [number, number]) => {
    updStep((s) => void (s.text = t));
    if (sel)
      requestAnimationFrame(() => {
        ta.current?.focus();
        ta.current?.setSelectionRange(sel[0], sel[1]);
      });
  };
  const wrap = (a: string, b: string, def = 'texto') => {
    const el = ta.current;
    const v = step.text;
    const s0 = el?.selectionStart ?? v.length;
    const s1 = el?.selectionEnd ?? v.length;
    const mid = v.slice(s0, s1) || def;
    setText(v.slice(0, s0) + a + mid + b + v.slice(s1), [s0 + a.length, s0 + a.length + mid.length]);
  };
  const insert = (txt: string) => {
    const el = ta.current;
    const v = step.text;
    const s0 = el?.selectionStart ?? v.length;
    const s1 = el?.selectionEnd ?? v.length;
    setText(v.slice(0, s0) + txt + v.slice(s1), [s0 + txt.length, s0 + txt.length]);
  };
  const prefix = (pfx: string) => {
    const el = ta.current;
    const v = step.text;
    const s0 = el?.selectionStart ?? v.length;
    const ls = v.lastIndexOf('\n', s0 - 1) + 1;
    setText(v.slice(0, ls) + pfx + v.slice(ls), [s0 + pfx.length, s0 + pfx.length]);
  };
  const unknown = [...unknownPlaceholders(step.text), ...unknownPlaceholders(step.why), ...unknownPlaceholders(step.title)];
  const upFmt = (p: Partial<PresStep['format']>) => updStep((s) => void Object.assign(s.format, p));
  return (
    <div className="col">
      <div className="st-rt-toolbar">
        <button className="btn sm" onClick={() => wrap('**', '**')} title="Negrito: **texto**">
          <b>N</b>
        </button>
        <button className="btn sm" onClick={() => wrap('*', '*')} title="Itálico: *texto*">
          <i>I</i>
        </button>
        <button className="btn sm" onClick={() => wrap('__', '__')} title="Sublinhado: __texto__">
          <u>S</u>
        </button>
        <button className="btn sm" onClick={() => wrap('==', '==')} title="Realce: ==texto==">
          <mark className="rt-mark">R</mark>
        </button>
        <span className="st-swatches" title="Cor do texto selecionado">
          {Object.entries(TEXT_COLORS).map(([name, c]) => (
            <button key={name} className="st-swatch" style={{ background: c.css }} onClick={() => wrap(`[${name}]`, `[/${name}]`)} title={`${name} — ${c.hint}`} />
          ))}
        </span>
        <button className="btn sm" onClick={() => prefix('- ')} title="Item de lista: linha começando com “- ”">
          • Lista
        </button>
        <button className="btn sm" onClick={() => prefix('# ')} title="Título grande: linha começando com “# ” (subtítulo: “## ”)">
          # Título
        </button>
        <select
          className="st-var-sel"
          value=""
          onChange={(ev) => {
            if (ev.target.value) insert(`{${delta ? 'Δ' : ''}${ev.target.value}}`);
          }}
          title="Insere um valor ao vivo no ponto do cursor"
        >
          <option value="">＋ Valor ao vivo…</option>
          {VAR_GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {PRES_VARS.filter((v) => v.group === g).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                  {v.unit ? ` (${v.unit})` : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <label className="chk subtle" title="Insere a VARIAÇÃO desde o início da etapa ({Δpeso}) em vez do valor">
          <input type="checkbox" checked={delta} onChange={(ev) => setDelta(ev.target.checked)} /> variação Δ
        </label>
      </div>
      <textarea
        ref={ta}
        className="st-textarea"
        rows={7}
        value={step.text}
        onChange={(ev) => updStep((s) => void (s.text = ev.target.value))}
        placeholder="O que a plateia lê nesta etapa. Use a barra acima para negrito, cores, listas e valores ao vivo."
      />
      <label className="field">
        <span>Por quê (explicação curta, em itálico, opcional)</span>
        <textarea className="st-textarea" rows={2} value={step.why} onChange={(ev) => updStep((s) => void (s.why = ev.target.value))} />
      </label>
      {unknown.length > 0 && <div className="warn-text">⚠ Valores desconhecidos (aparecem como estão): {unknown.join(' ')}</div>}
      <div className="st-fmt">
        <div className="st-fmt-row">
          <span className="st-lbl">Estilo</span>
          <Seg
            value={f.style}
            options={STYLE_OPTIONS.map(([v, l, t]) => [v, l, t])}
            onChange={(style) => upFmt(style === 'titulo' ? { style, position: 'centro', size: f.size === 'P' || f.size === 'M' ? 'G' : f.size } : { style })}
          />
        </div>
        {f.style !== 'oculto' && (
          <>
            <div className="st-fmt-row">
              <span className="st-lbl">Posição</span>
              <Seg value={f.position} options={POS_OPTIONS.map(([v, l]) => [v, l])} onChange={(position) => upFmt({ position })} />
            </div>
            <div className="st-fmt-row">
              <span className="st-lbl">Tamanho</span>
              <Seg value={f.size} options={SIZE_OPTIONS.map((v) => [v, v])} onChange={(size) => upFmt({ size })} />
            </div>
            <div className="st-fmt-row">
              <span className="st-lbl">Destaque</span>
              <span className="st-swatches">
                {Object.entries(TEXT_COLORS).map(([name, c]) => (
                  <button key={name} className={`st-swatch ${f.accent === name ? 'sel' : ''}`} style={{ background: c.css }} onClick={() => upFmt({ accent: name })} title={name} />
                ))}
              </span>
            </div>
          </>
        )}
        <div className="st-fmt-row">
          <label className="chk">
            <input type="checkbox" checked={f.showProgress} onChange={(ev) => upFmt({ showProgress: ev.target.checked })} /> número da etapa e progresso
          </label>
          <label className="chk">
            <input type="checkbox" checked={f.showStatus} onChange={(ev) => upFmt({ showStatus: ev.target.checked })} /> linha de status (aguardando…)
          </label>
        </div>
      </div>
      <details className="st-help">
        <summary>Como formatar o texto</summary>
        <div className="subtle">
          <div>
            <code>**negrito**</code> · <code>*itálico*</code> · <code>__sublinhado__</code> · <code>==realce==</code>
          </div>
          <div>
            <code>[azul]texto[/azul]</code> — cores:{' '}
            {Object.entries(TEXT_COLORS)
              .map(([n, c]) => `${n} (${c.hint})`)
              .join(', ')}
          </div>
          <div>
            <code># Título</code>, <code>## Subtítulo</code>, <code>- item de lista</code>; linha em branco = novo parágrafo
          </div>
          <div>
            Valores ao vivo: <code>{'{prof}'}</code> (valor), <code>{'{prof:2}'}</code> (2 casas), <code>{'{Δpeso}'}</code> (variação desde o início da etapa). Funcionam no título, no texto, no “por quê” e nas notas.
          </div>
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------- aba Visualização
function VisualTab({ e, step, updStep, capture }: { e: SimulationEngine; step: PresStep; updStep: UpdStep; capture: () => void }) {
  const v = step.visual;
  const upV = (p: Partial<PresStep['visual']>) => updStep((s) => void Object.assign(s.visual, p));
  return (
    <div className="col">
      <button className="btn ok" onClick={capture} title="Guarda a câmera e as camadas que estão no palco agora">
        📷 Usar a visualização atual do palco nesta etapa
      </button>
      <label className="field">
        <span>Onde mostrar</span>
        <select value={v.screen} onChange={(ev) => upV({ screen: ev.target.value as StepScreen })}>
          {SCREEN_OPTIONS.map(([id, l]) => (
            <option key={id} value={id}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {v.screen !== 'palco' && <div className="note">Ao entrar nesta etapa o simulador abre essa tela; o cartão aparece flutuando sobre ela, com os controles do apresentador.</div>}
      <div className="field">
        <span>Câmera ao entrar</span>
        <span className="btngroup">
          <button className={`btn sm ${v.view === null ? 'on' : ''}`} onClick={() => upV({ view: null, camPose: null, drone: null, bridge: null })} title="Não muda a câmera">
            Manter
          </button>
          {VIEW_OPTIONS.map(([id, l]) => (
            <button
              key={id}
              className={`btn sm ${v.view === id ? 'on' : ''}`}
              onClick={() => {
                // posições guardadas (livre, drone, passadiço) ficam: só valem quando a vista é a delas
                upV({ view: id });
                pres.setView(id);
              }}
            >
              {l}
            </button>
          ))}
        </span>
      </div>
      <CameraPose v={v} upV={upV} />
      <div className="field">
        <span>Camadas ao entrar</span>
        <Seg
          value={v.layers ? 'def' : 'keep'}
          options={[
            ['keep', 'Manter as atuais'],
            ['def', 'Definir nesta etapa'],
          ]}
          onChange={(x) => upV({ layers: x === 'def' ? { ...pres.layers } : null })}
        />
      </div>
      {v.layers && (
        <div className="st-layers">
          <SceneLayerPanel
            e={e}
            keys={LAYER_LIST}
            value={v.layers}
            hullControl
            onChange={(p: Partial<SceneLayers>) => {
              updStep((s) => void (s.visual.layers = { ...s.visual.layers!, ...p }));
              pres.setLayers(p);
            }}
          />
        </div>
      )}
      <div className="field">
        <span>Mostradores ao vivo sobre a cena</span>
        <div className="st-chips">
          {v.hud.map((id) => (
            <span key={id} className="st-chip">
              {presVar(id)?.label ?? id}
              <button onClick={() => upV({ hud: v.hud.filter((x) => x !== id) })} title="Remover">
                ×
              </button>
            </span>
          ))}
          {v.hud.length < 12 && <VarSelect value="" placeholder="＋ mostrador…" onChange={(id) => id && !v.hud.includes(id) && upV({ hud: [...v.hud, id] })} />}
        </div>
        <span className="btngroup">
          {HUD_PRESETS.map(([l, ids]) => (
            <button key={l} className="btn sm" onClick={() => upV({ hud: [...new Set([...v.hud, ...ids])] })}>
              + {l}
            </button>
          ))}
          {v.hud.length > 0 && (
            <button className="btn sm" onClick={() => upV({ hud: [] })}>
              Limpar
            </button>
          )}
        </span>
      </div>
      <div className="field">
        <span>Perspectiva ao entrar (todas as vistas)</span>
        <Seg<'m' | 'n' | 'p'>
          value={v.persp === null ? 'm' : v.persp ? 'p' : 'n'}
          options={[
            ['m', 'Manter', 'Não muda a perspectiva'],
            ['n', 'Normal', 'Lente normal'],
            ['p', '◢ Profunda', 'Grande-angular de perto, mesmo enquadramento: mais sensação de profundidade (intensidade em “Mar e gráfico” no palco)'],
          ]}
          onChange={(x) => {
            upV({ persp: x === 'm' ? null : x === 'p' });
            if (x !== 'm') graphics.set({ deepPersp: x === 'p' });
          }}
        />
      </div>
      <div className="field">
        <span>Simulação ao entrar</span>
        <Seg value={v.run} options={RUN_OPTIONS} onChange={(run) => upV({ run })} />
      </div>
      <div className="field">
        <span>Velocidade do tempo</span>
        <Seg<number | 'm'>
          value={v.timeScale ?? 'm'}
          options={[['m', 'Manter'], ...SCALES.map((s) => [s, `×${String(s).replace('.', ',')}`] as [number, string])]}
          onChange={(x) => upV({ timeScale: x === 'm' ? null : x })}
        />
      </div>
    </div>
  );
}

/** posição guardada da câmera na etapa: livre (relativa ao submarino), drone (no mundo) ou passadiço (visada) */
function CameraPose({ v, upV }: { v: PresStep['visual']; upV: (p: Partial<PresStep['visual']>) => void }) {
  if (v.view === 'livre')
    return (
      <div className="st-campose">
        <span className={v.camPose ? 'ok-text' : 'subtle'}>{v.camPose ? '✓ posição da câmera livre guardada (acompanha o submarino)' : 'Posição: a que estiver na hora'}</span>
        <span className="btngroup">
          <button className="btn sm" onClick={() => upV({ camPose: loadPersisted<CamPose | null>('cam.studio', null) })} title="Arraste a cena do palco até o enquadramento desejado e clique aqui">
            Guardar a posição atual
          </button>
          {v.camPose && (
            <button className="btn sm" onClick={() => upV({ camPose: null })}>
              Esquecer
            </button>
          )}
        </span>
        <span className="subtle">No palco: arraste para girar, roda para aproximar, botão direito para deslocar.</span>
      </div>
    );
  if (v.view === 'drone') {
    const d = v.drone;
    const rel = v.droneFrame === 'submarino';
    const save = () => droneCtl.pose && upV({ drone: droneToStep(droneCtl.pose, subRef(runner.engine), v.droneFrame) });
    // trocar a referência converte a posição guardada (pela posição atual do submarino)
    const setFrame = (f: DroneFrame) => upV({ droneFrame: f, drone: d ? droneToStep(droneFromStep(d, subRef(runner.engine), v.droneFrame), subRef(runner.engine), f) : null });
    const where = d
      ? rel
        ? `${fmt(Math.abs(d.n), 0)} m ${d.n >= 0 ? 'à vante' : 'à ré'} e ${fmt(Math.abs(d.e), 0)} m ${d.e >= 0 ? 'a boreste' : 'a bombordo'} do submarino`
        : `ponto fixo do mapa (N ${fmt(d.n, 0)} m, L ${fmt(d.e, 0)} m)`
      : '';
    return (
      <div className="st-campose">
        <Seg
          value={v.droneFrame}
          options={[
            ['submarino', 'Em relação ao submarino', 'O drone aparece sempre no mesmo enquadramento do submarino, esteja ele onde estiver'],
            ['mapa', 'Ponto fixo no mapa', 'O drone vai sempre ao mesmo lugar do cenário (ex.: sobre a orla)'],
          ]}
          onChange={setFrame}
        />
        <span className={d ? 'ok-text' : 'subtle'}>{d ? `✓ drone guardado: ${where}, ${fmt(d.up, 0)} m de altura, inclinação ${fmt(d.pitch, 0)}°` : 'Posição do drone: a que estiver na hora'}</span>
        <span className="btngroup">
          <button className="btn sm" disabled={!droneCtl.pose} onClick={save} title="Voe com o drone no palco até o ponto desejado e clique aqui">
            Guardar a posição atual do drone
          </button>
          {d && (
            <button className="btn sm" onClick={() => upV({ drone: null })}>
              Esquecer
            </button>
          )}
        </span>
        <span className="subtle">
          No palco: W A S D move, Q/E sobe e desce, arrastar olha em volta, Shift acelera, roda muda a velocidade. Ao entrar na etapa o drone é posicionado e fica parado no cenário (o submarino passa por ele).
        </span>
      </div>
    );
  }
  if (v.view === 'passadico') {
    const b = v.bridge;
    return (
      <div className="st-campose">
        <span className={b ? 'ok-text' : 'subtle'}>
          {b ? `✓ visada guardada: ${fmt(b.bearing, 0)}° em relação à proa, elevação ${fmt(b.elev, 0)}°${bridgeSight.binoculars(b) ? ', com binóculo' : ''}` : 'Visada: a que estiver na hora'}
        </span>
        <span className="btngroup">
          <button className="btn sm" onClick={() => upV({ bridge: { ...bridgeSight.get() } })} title="Olhe para a direção desejada no palco e clique aqui">
            Guardar a visada atual
          </button>
          {b && (
            <button className="btn sm" onClick={() => upV({ bridge: null })}>
              Esquecer
            </button>
          )}
        </span>
        <span className="subtle">No palco: arraste para olhar em volta; B ou a roda do mouse = binóculo.</span>
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------- aba Ações
function FieldInput({ f, value, e, onChange }: { f: FieldDef; value: ParamValue | undefined; e: SimulationEngine; onChange: (v: ParamValue) => void }) {
  if (f.type === 'number')
    return (
      <label className="st-field">
        <span>{f.label}</span>
        <span className="row" style={{ gap: 4 }}>
          <NumInput value={Number(value ?? 0)} min={f.min} max={f.max} step={f.step} onChange={onChange} />
          {f.unit && <span className="subtle">{f.unit}</span>}
          {f.presets && (
            <select value="" onChange={(ev) => ev.target.value !== '' && onChange(Number(ev.target.value))} title="Valores usuais">
              <option value="">…</option>
              {f.presets.map(([v, l]) => (
                <option key={v} value={v}>
                  {l} ({String(v).replace('.', ',')})
                </option>
              ))}
            </select>
          )}
        </span>
      </label>
    );
  if (f.type === 'select') {
    let opts: [string, string][] = [];
    try {
      opts = f.options(e);
    } catch {
      opts = [];
    }
    return (
      <label className="st-field">
        <span>{f.label}</span>
        <select value={String(value ?? '')} onChange={(ev) => onChange(ev.target.value)}>
          {!opts.some((o) => o[0] === String(value ?? '')) && <option value={String(value ?? '')}>{String(value ?? '')}</option>}
          {opts.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (f.type === 'bool')
    return (
      <div className="st-field">
        <span>{f.label}</span>
        <Seg
          value={value === true || value === 'true' ? 'on' : 'off'}
          options={[
            ['on', f.on],
            ['off', f.off],
          ]}
          onChange={(x) => onChange(x === 'on')}
        />
      </div>
    );
  return (
    <label className="st-field wide">
      <span>{f.label}</span>
      <textarea className="st-textarea mono" rows={f.rows ?? 3} value={String(value ?? '')} onChange={(ev) => onChange(ev.target.value)} />
    </label>
  );
}

function ActionRow({ a, i, n, e, onChange, onMove, onDel }: { a: StepAction; i: number; n: number; e: SimulationEngine; onChange: (a: StepAction) => void; onMove: (d: number) => void; onDel: () => void }) {
  const ui = useUi();
  const t = actionType(a.t);
  const problem = actionProblem(a);
  return (
    <div className="st-action">
      <div className="st-action-head">
        <label className="st-delay" title="Segundos depois de entrar na etapa (relógio da apresentação)">
          após <NumInput value={a.delay} min={0} max={36000} step={0.5} width={58} onChange={(delay) => onChange({ ...a, delay })} /> s
        </label>
        <select className="st-act-type" value={a.t} onChange={(ev) => onChange({ ...newAction(ev.target.value), id: a.id, delay: a.delay })}>
          {ACTION_GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {ACTION_TYPES.filter((x) => x.group === g).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="btngroup">
          <button
            className="btn sm"
            onClick={() => {
              runAction(a, editorCtx());
              ui.toast(`Executado agora: ${describeAction(a, runner.engine)}`);
            }}
            title="Executa esta ação agora, na simulação atual (para conferir)"
          >
            ▶
          </button>
          <button className="btn sm" disabled={i === 0} onClick={() => onMove(-1)} title="Mover para cima">
            ↑
          </button>
          <button className="btn sm" disabled={i >= n - 1} onClick={() => onMove(1)} title="Mover para baixo">
            ↓
          </button>
          <button className="btn sm" onClick={onDel} title="Remover a ação">
            🗑
          </button>
        </span>
      </div>
      {t && t.fields.length > 0 && (
        <div className="st-fields">
          {t.fields.map((f) => (
            <FieldInput key={f.key} f={f} e={e} value={a.p[f.key]} onChange={(v) => onChange({ ...a, p: { ...a.p, [f.key]: v } })} />
          ))}
        </div>
      )}
      {t?.hint && <div className="subtle">{t.hint}</div>}
      <div className="st-act-desc">→ {describeAction(a, e)}</div>
      {problem && <div className="warn-text">⚠ {problem}</div>}
    </div>
  );
}

function ActionsTab({ e, step, updStep }: { e: SimulationEngine; step: PresStep; updStep: UpdStep }) {
  return (
    <div className="col">
      <div className="note">Executadas ao entrar na etapa, em ordem de tempo (“após 0 s” = na hora). As que mexem no submarino são comandos registrados no histórico, como os do operador; a resposta é a da física.</div>
      {step.actions.length === 0 && <div className="subtle">Nenhuma ação: a etapa só mostra e explica.</div>}
      {step.actions.map((a, i) => (
        <ActionRow
          key={a.id}
          a={a}
          i={i}
          n={step.actions.length}
          e={e}
          onChange={(na) => updStep((s) => void (s.actions[i] = na))}
          onMove={(d) =>
            updStep((s) => {
              const [x] = s.actions.splice(i, 1);
              s.actions.splice(i + d, 0, x);
            })
          }
          onDel={() => updStep((s) => void s.actions.splice(i, 1))}
        />
      ))}
      <select className="st-add" value="" onChange={(ev) => ev.target.value && updStep((s) => void s.actions.push(newAction(ev.target.value)))}>
        <option value="">＋ Adicionar ação…</option>
        {ACTION_GROUPS.map((g) => (
          <optgroup key={g} label={g}>
            {ACTION_TYPES.filter((x) => x.group === g).map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------- aba Avançar
function ConditionRow({ c, e, onChange, onDel }: { c: Condition; e: SimulationEngine; onChange: (c: Condition) => void; onDel: () => void }) {
  const v = presVar(c.v);
  const x = readVar(c.v, e, varCtx());
  const ok = testCondition(c, x);
  return (
    <div className="st-cond">
      <VarSelect value={c.v} onChange={(id) => onChange({ ...c, v: id, ...(presVar(id)?.bool ? { op: '=', value: 1 } : {}) })} />
      {v?.bool ? (
        <select value={(c.op === '≠') !== c.value > 0.5 ? 'sim' : 'nao'} onChange={(ev) => onChange({ ...c, op: '=', value: ev.target.value === 'sim' ? 1 : 0 })}>
          <option value="sim">é sim</option>
          <option value="nao">é não</option>
        </select>
      ) : (
        <span className="row" style={{ gap: 4 }}>
          <select value={c.op} onChange={(ev) => onChange({ ...c, op: ev.target.value as CondOp })} title={COND_OPS.find((o) => o.op === c.op)?.label}>
            {COND_OPS.map((o) => (
              <option key={o.op} value={o.op}>
                {o.op} {o.label}
              </option>
            ))}
          </select>
          <NumInput value={c.value} width={76} onChange={(value) => onChange({ ...c, value })} />
          {c.op === '≈' && (
            <>
              ± <NumInput value={c.tol} min={0} width={64} onChange={(tol) => onChange({ ...c, tol })} />
            </>
          )}
          {v?.unit && <span className="subtle">{v.unit}</span>}
        </span>
      )}
      <span className={`st-now ${ok ? 'ok-text' : 'subtle'}`} title="Valor agora, na simulação atual">
        agora {v ? fmtVarUnit(v, x) : '—'} {ok ? '✓' : '✗'}
      </span>
      <button className="btn sm" onClick={onDel} title="Remover a condição">
        🗑
      </button>
    </div>
  );
}

function AdvanceTab({ e, cur, step, k, updStep }: { e: SimulationEngine; cur: UserPresentation; step: PresStep; k: number; updStep: UpdStep }) {
  const a = step.advance;
  const upA = (p: Partial<PresStep['advance']>) => updStep((s) => void Object.assign(s.advance, p));
  const MODES: [AdvanceMode, string, string][] = [
    ['manual', '👆 Manual', 'Quando o apresentador quiser (→, Page Down, botão Próxima ou controle remoto)'],
    ['tempo', '⏱ Tempo', 'Depois de alguns segundos'],
    ['condicao', '⚑ Condição física', 'Quando o submarino atingir uma situação (profundidade, velocidade, tanques…)'],
  ];
  return (
    <div className="col">
      <div className="field">
        <span>Avançar para a próxima etapa</span>
        <Seg value={a.mode} options={MODES} onChange={(mode) => upA(mode === 'condicao' && !a.conditions.length ? { mode, conditions: [{ v: 'prof', op: '>', value: 30, tol: 1 }] } : { mode })} />
      </div>
      {a.mode === 'manual' && <div className="note">Fica nesta etapa até você avançar: → ou Page Down no teclado, o botão “Próxima” ou um controle remoto de slides. Na tela cheia também funciona.</div>}
      {a.mode === 'tempo' && (
        <label className="row">
          Depois de <NumInput value={a.seconds} min={0} max={36000} step={1} width={70} onChange={(seconds) => upA({ seconds })} /> s
          <span className="subtle">(contados com a simulação rodando, ou sempre se a etapa pausa a cena)</span>
        </label>
      )}
      {a.mode === 'condicao' && (
        <>
          {a.conditions.map((c, i) => (
            <ConditionRow key={i} c={c} e={e} onChange={(nc) => updStep((s) => void (s.advance.conditions[i] = nc))} onDel={() => updStep((s) => void s.advance.conditions.splice(i, 1))} />
          ))}
          <div className="row">
            <button className="btn sm" onClick={() => updStep((s) => void s.advance.conditions.push({ v: 'prof', op: '>', value: 30, tol: 1 }))}>
              ＋ Condição
            </button>
            {a.conditions.length > 1 && (
              <Seg
                value={a.logic}
                options={[
                  ['todas', 'todas (E)'],
                  ['qualquer', 'qualquer uma (OU)'],
                ]}
                onChange={(logic) => upA({ logic })}
              />
            )}
          </div>
          <div className="st-adv-grid">
            <label title="A condição precisa ficar verdadeira sem interrupção por esse tempo (evita avançar numa passagem rápida)">
              Manter verdadeira por <NumInput value={a.hold} min={0} width={58} onChange={(hold) => upA({ hold })} /> s
            </label>
            <label title="Mesmo com a condição atingida, a etapa fica pelo menos esse tempo na tela (leitura)">
              Tempo mínimo de leitura <NumInput value={a.minDwell} min={0} width={58} onChange={(minDwell) => upA({ minDwell })} /> s
            </label>
            <label title="Segundos de simulação; 0 = sem limite">
              Limite <NumInput value={a.timeout} min={0} width={70} onChange={(timeout) => upA({ timeout })} /> s
            </label>
            {a.timeout > 0 && (
              <Seg
                value={a.onTimeout}
                options={[
                  ['avancar', 'ao esgotar: avançar'],
                  ['aguardar', 'continuar aguardando'],
                ]}
                onChange={(onTimeout) => upA({ onTimeout })}
              />
            )}
          </div>
          <label className="field">
            <span>Texto enquanto aguarda (vazio = gerado das condições)</span>
            <input type="text" value={a.waitText} placeholder={a.conditions.map(describeCondition).join(a.logic === 'todas' ? ' e ' : ' ou ')} onChange={(ev) => upA({ waitText: ev.target.value })} />
          </label>
        </>
      )}
      <label className="field">
        <span>Depois desta etapa</span>
        <select value={a.next} onChange={(ev) => upA({ next: ev.target.value })}>
          <option value="">{k + 1 < cur.steps.length ? `Próxima etapa (${k + 2}. ${cur.steps[k + 1].title})` : 'Encerrar (última etapa)'}</option>
          {cur.steps.map((s, i) =>
            i === k + 1 ? null : (
              <option key={s.id} value={s.id}>
                Ir para {i + 1}. {s.title}
              </option>
            ),
          )}
          <option value={NEXT_END}>Encerrar a apresentação</option>
        </select>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------- abas Notas e Estado
function NotesTab({ step, updStep }: { step: PresStep; updStep: UpdStep }) {
  return (
    <div className="col">
      <div className="note">Só para você: aparecem no painel do apresentador e nunca na 2ª janela (projetor). Aceitam formatação e valores ao vivo.</div>
      <textarea className="st-textarea" rows={10} value={step.notes} onChange={(ev) => updStep((s) => void (s.notes = ev.target.value))} placeholder="Lembretes, perguntas para a plateia, o que destacar…" />
    </div>
  );
}

function stateInfo(f: NonNullable<PresStep['state']>): string {
  try {
    const e = deserializeEngine(f);
    e.computeOutputs();
    return `t = ${fmtTime(f.simTime)} · ${fmt(e.outputs.depthKeel, 1)} m · ${fmtSpeed(e.state.body.vel.x)} · cenário ${SCENARIOS.find((s) => s.id === f.scenarioId)?.name ?? f.scenarioId}`;
  } catch {
    return `t = ${fmtTime(f.simTime)}`;
  }
}

function StateTab({ e, step, k, updStep }: { e: SimulationEngine; step: PresStep; k: number; updStep: UpdStep }) {
  const ui = useUi();
  const [info, setInfo] = useState('');
  useEffect(() => setInfo(step.state ? stateInfo(step.state) : ''), [step.state]);
  const capture = () => {
    updStep((s) => {
      s.state = serializeEngine(runner.engine, `Etapa ${k + 1}: ${s.title}`);
      s.loadState = true;
    });
    ui.toast(`Situação atual guardada na etapa ${k + 1}.`);
  };
  return (
    <div className="col">
      <div className="note">
        Opcional. Guarda a situação da simulação (posição, cota, velocidade, tanques, válvulas…) para que esta etapa comece sempre do mesmo ponto — útil para ensaiar, pular etapas ou recomeçar no meio sem depender das
        anteriores.
      </div>
      <div className="subtle">
        Agora no simulador: t = {fmtTime(e.state.t)} · {fmt(e.outputs.depthKeel, 1)} m · {fmtSpeed(e.state.body.vel.x)}
      </div>
      {step.state ? (
        <>
          <div className="ok-text">💾 Guardado: {info}</div>
          <label className="chk">
            <input type="checkbox" checked={step.loadState} onChange={(ev) => updStep((s) => void (s.loadState = ev.target.checked))} /> Carregar este estado ao entrar na etapa
          </label>
          <span className="btngroup">
            <button className="btn sm" onClick={capture}>
              💾 Guardar de novo (situação atual)
            </button>
            <button
              className="btn sm"
              onClick={() => {
                runner.running = false;
                runner.replaceEngine(deserializeEngine(step.state!));
                ui.toast('Estado guardado carregado no simulador (pausado).');
              }}
            >
              ⭳ Carregar no simulador
            </button>
            <button className="btn sm warn" onClick={() => updStep((s) => ((s.state = null), (s.loadState = false)))}>
              Remover
            </button>
          </span>
          <div className="subtle">Ocupa ~{Math.round(JSON.stringify(step.state).length / 1024)} KB.</div>
        </>
      ) : (
        <button className="btn ok" onClick={capture}>
          💾 Guardar a situação atual do simulador nesta etapa
        </button>
      )}
      <div className="note">Para preparar: use “↺ Ponto de partida”, opere o submarino (aqui, na Pilotagem ou com “▷ Testar etapa”) até a situação desejada e guarde.</div>
    </div>
  );
}

// ---------------------------------------------------------------- configurações da apresentação
function SettingsForm({ cur, update, e }: { cur: UserPresentation; update: (fn: (p: UserPresentation) => void) => void; e: SimulationEngine }) {
  const st = cur.start;
  const upS = (p: Partial<UserPresentation['start']>) => update((x) => void Object.assign(x.start, p));
  const dur = cur.steps.reduce((a, s) => a + (s.advance.mode === 'tempo' ? s.advance.seconds : s.advance.mode === 'condicao' ? s.advance.minDwell : 0), 0);
  return (
    <div className="col st-tab-body">
      <label className="field">
        <span>Nome</span>
        <input type="text" value={cur.name} onChange={(ev) => update((p) => void (p.name = ev.target.value))} />
      </label>
      <label className="field">
        <span>Descrição</span>
        <textarea className="st-textarea" rows={3} value={cur.description} onChange={(ev) => update((p) => void (p.description = ev.target.value))} />
      </label>
      <label className="field">
        <span>Autor</span>
        <input type="text" value={cur.author} onChange={(ev) => update((p) => void (p.author = ev.target.value))} />
      </label>
      <div className="field">
        <span>Ponto de partida</span>
        <Seg
          value={st.mode}
          options={[
            ['cenario', 'Cenário', 'Sempre a mesma condição inicial'],
            ['estado', 'Estado guardado', 'Uma situação capturada do simulador'],
            ['atual', 'Situação atual', 'Continua de onde o simulador estiver'],
          ]}
          onChange={(mode) => upS({ mode })}
        />
      </div>
      {st.mode === 'cenario' && (
        <div className="col st-indent">
          <label className="field">
            <span>Cenário</span>
            <select value={st.scenario} onChange={(ev) => upS({ scenario: ev.target.value })}>
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Estado do mar</span>
            <Seg<number | 'c'> value={st.sea ?? 'c'} options={[['c', 'do cenário'], ...[0, 1, 2, 3, 4, 5, 6].map((x) => [x, String(x)] as [number, string])]} onChange={(x) => upS({ sea: x === 'c' ? null : x })} />
          </div>
          <label className="field">
            <span>Condição de carga</span>
            <select value={st.load} onChange={(ev) => upS({ load: ev.target.value as LoadCondition })}>
              {(Object.keys(LOAD_LABELS) as LoadCondition[]).map((x) => (
                <option key={x} value={x}>
                  {LOAD_LABELS[x]}
                </option>
              ))}
            </select>
          </label>
          <label className="chk">
            <input type="checkbox" checked={st.precompensated} onChange={(ev) => upS({ precompensated: ev.target.checked })} /> Compensação pré-calculada para a carga
          </label>
        </div>
      )}
      {st.mode === 'estado' && (
        <div className="col st-indent">
          {st.state ? <div className="ok-text">💾 {stateInfo(st.state)}</div> : <div className="warn-text">Nenhum estado guardado ainda.</div>}
          <span className="btngroup">
            <button className="btn sm ok" onClick={() => upS({ state: serializeEngine(runner.engine, `Início: ${cur.name}`) })}>
              💾 Guardar a situação atual (t = {fmtTime(e.state.t)})
            </button>
            {st.state && (
              <button className="btn sm warn" onClick={() => upS({ state: null })}>
                Remover
              </button>
            )}
          </span>
        </div>
      )}
      {st.mode === 'atual' && <div className="note">A apresentação começa da situação em que o simulador estiver na hora (útil para demonstrações ao vivo).</div>}
      <div className="subtle">
        {cur.steps.length} etapas · leitura mínima ~{fmtTime(dur)} (fora as etapas manuais e a física) · {presSizeKB(cur)} KB
        {cur.builtin ? ' · modelo' : ` · atualizada em ${new Date(cur.updatedAt).toLocaleString('pt-BR')}`}
      </div>
      <details className="st-help" open>
        <summary>Como funciona</summary>
        <div className="subtle">
          <div>1. Crie as etapas na lista à esquerda (＋ Etapa). Cada etapa tem texto, visualização, ações, gatilho para avançar, notas e, se quiser, um estado guardado.</div>
          <div>2. Ajuste a câmera e as camadas no palco e clique em “📷 Usar a visualização atual”.</div>
          <div>3. Ensaie: “▷ Testar etapa” roda só a etapa selecionada; “⏩ Desta etapa” chega nela pela física, acelerado.</div>
          <div>4. “▶ Apresentar”: → / Page Down avançam, ← / Page Up voltam (com a física daquele momento), Espaço pausa. Com a 2ª janela aberta, o projetor mostra a cena e o cartão, sem as notas.</div>
          <div>Tudo fica salvo neste navegador. Use “⭱ Exportar” para levar a apresentação para outro computador.</div>
        </div>
      </details>
    </div>
  );
}

// ====================================================================== palco (apresentando)
function PlayerStage({ onEditor }: { onEditor: () => void }) {
  const e = useSim(8);
  const ui = useUi();
  const [quality] = useQuality();
  const stageRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = usePersisted('studio.panel', true);
  const [hideBar, setHideBar] = useState(false);
  const [fs, setFs] = useState(false);
  useEffect(() => {
    const f = () => setFs(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  const pl = presPlayer;
  const P = pl.pres;
  if (!P) return null;
  const card = pl.active || pl.ff ? pl.card(e) : null;
  const hud = pl.active || pl.ff ? pl.hud(e) : [];
  const fsToggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void stageRef.current?.requestFullscreen().catch(() => ui.toast('Tela cheia indisponível neste navegador.'));
  };
  const again = () => {
    const def = presLibrary.get(P.id) ?? P;
    presPlayer.start(runner, def);
  };
  const close = () => {
    presPlayer.dismiss(runner);
    onEditor();
  };
  return (
    <div className={`st-play ${panel && !fs ? 'with-panel' : ''}`}>
      <div className="st-stage" ref={stageRef}>
        <Scene3D quality={quality} view={pres.view} layers={pres.layers} labels={false} persistKey="studio" camPose={pl.cam} hud="compact">
          <PresHudView items={hud} side={hudSide(card)} />
          {card && (
            <div className="st-in">
              <PresCardView c={card} />
            </div>
          )}
          {pl.ff && (
            <div className="st-ff">
              ⏩ Avançando acelerado pela física até a etapa {pl.ff.target + 1} — agora na etapa {pl.k + 1}, t = {fmtTime(e.state.t)}
              <button className="btn sm" onClick={() => pl.cancelFastForward()}>
                Parar aqui
              </button>
            </div>
          )}
          {!pl.active && !pl.ff && pl.finished && (
            <div className="pc-wrap pos-centro sz-M">
              <div className="pc-card">
                <div className="pc-head">
                  <b>Apresentação concluída — {P.name}</b>
                </div>
                <div>
                  {pl.finished.ok}/{P.steps.length} etapas concluídas
                  {pl.finished.timeout ? ` · ${pl.finished.timeout} com tempo esgotado` : ''}
                  {pl.finished.skipped ? ` · ${pl.finished.skipped} puladas` : ''} · {fmtTime(pl.finished.duration)} de simulação
                </div>
                <div className="row mt8">
                  <button className="btn ok" onClick={again}>
                    ↺ Apresentar de novo
                  </button>
                  <button className="btn" onClick={close}>
                    ✎ Voltar ao editor
                  </button>
                </div>
              </div>
            </div>
          )}
          {(pl.active || pl.ff) && (
            <div className="st-in">
              {hideBar ? (
                <button className="btn sm st-bar-show" onClick={() => setHideBar(false)} title="Mostrar os controles">
                  ▴
                </button>
              ) : (
                <PresenterBar e={e} fs={fs} onFs={fsToggle} onHide={() => setHideBar(true)} onPanel={() => setPanel(!panel)} panel={panel} onEditor={onEditor} />
              )}
            </div>
          )}
        </Scene3D>
        {/* telas estreitas: cartão e controles abaixo da cena (na tela cheia ficam sobre ela) */}
        {(pl.active || pl.ff) && (
          <div className="st-under">
            {card && <PresCardView c={card} compact />}
            <PresenterBar e={e} fs={fs} onFs={fsToggle} onPanel={() => setPanel(!panel)} panel={panel} onEditor={onEditor} />
          </div>
        )}
      </div>
      {panel && !fs && <PresenterPanel e={e} />}
    </div>
  );
}

function PresenterBar({ e, fs, onFs, onHide, onPanel, panel, onEditor }: { e: SimulationEngine; fs: boolean; onFs: () => void; onHide?: () => void; onPanel: () => void; panel: boolean; onEditor: () => void }) {
  const pl = presPlayer;
  const P = pl.pres!;
  const st = pl.step;
  const s = pl.status();
  const busy = !!pl.ff;
  return (
    <div className="st-bar">
      <span className="btngroup">
        <button className="btn" disabled={busy} onClick={() => pl.prev(runner)} title="Etapa anterior, com a física de quando ela começou (← ou Page Up)">
          ◀
        </button>
        <button className={`btn ${pl.paused ? 'ok' : ''}`} disabled={busy} onClick={() => pl.pause(runner)} title="Pausar/continuar a apresentação (Espaço)">
          {pl.paused ? '▶' : '❚❚'}
        </button>
        <button className="btn ok" disabled={busy} onClick={() => pl.next(runner)} title="Próxima etapa (→ ou Page Down)">
          Próxima ▶
        </button>
      </span>
      <span className="st-bar-info">
        <b>
          {pl.k + 1}/{P.steps.length}
        </b>{' '}
        {st?.title ? fillTemplate(st.title, e, pl.varCtx(), pl.base) : ''}
        <span className={`st-bar-status ${s.kind}`}> · {s.text}</span>
      </span>
      <span className="btngroup">
        <button className="btn sm" disabled={busy} onClick={() => pl.restartStep(runner)} title="Repetir esta etapa desde o começo (física restaurada)">
          ↺
        </button>
        {!fs && (
          <button className={`btn sm ${panel ? 'on' : ''}`} onClick={onPanel} title="Painel do apresentador: notas, próxima etapa e lista de etapas">
            ☰
          </button>
        )}
        <button className={`btn sm ${fs ? 'on' : ''}`} onClick={onFs} title="Tela cheia (Esc sai)">
          ⛶
        </button>
        {onHide && (
          <button className="btn sm" onClick={onHide} title="Esconder estes controles (as teclas continuam funcionando)">
            ▾
          </button>
        )}
        {!fs && (
          <button className="btn sm" onClick={onEditor} title="Abrir o editor (a apresentação continua)">
            ✎
          </button>
        )}
        <button className="btn sm warn" onClick={() => pl.stop(runner)} title="Encerrar a apresentação">
          ■
        </button>
      </span>
    </div>
  );
}

function PresenterPanel({ e }: { e: SimulationEngine }) {
  const ui = useUi();
  const pl = presPlayer;
  const P = pl.pres!;
  const st = pl.step;
  const notes = pl.notes(e);
  const nx = st ? pl.nextIndex(st) : -1;
  const sent = pl.sentHere();
  const go = (j: number) => {
    const how = pl.goto(runner, j);
    if (how === 'acelerada') ui.toast(`Avançando pela física, acelerado, até a etapa ${j + 1}…`);
    else if (how === 'direta') ui.toast(`Etapa ${j + 1}: começa a partir da situação atual (ela ainda não tinha sido visitada).`);
  };
  return (
    <div className="st-panel panel">
      <header>
        <h3>Painel do apresentador</h3>
      </header>
      <div className="body col">
        <div>
          <div className="st-ph">Notas da etapa {pl.k + 1}</div>
          {notes.trim() ? <RichText text={notes} className="st-notes" /> : <div className="subtle">Sem notas nesta etapa.</div>}
        </div>
        {st && (
          <div>
            <div className="st-ph">A seguir</div>
            <div>{nx >= 0 ? `${nx + 1}. ${P.steps[nx].title}` : 'Fim da apresentação'}</div>
            <div className="subtle">Avança: {advanceText(P, st)}</div>
          </div>
        )}
        <div>
          <div className="st-ph">Etapas</div>
          <div className="st-plist">
            {P.steps.map((s, i) => (
              <button key={s.id} className={`st-pitem ${i === pl.k ? 'cur' : ''} ${pl.outcome[i] === 'concluída' ? 'done' : ''}`} disabled={!!pl.ff} onClick={() => go(i)} title="Ir para esta etapa">
                <span>{OUT_ICON[pl.outcome[i] ?? 'pendente']}</span> {i + 1}. {s.title}
              </button>
            ))}
          </div>
        </div>
        {sent.length > 0 && (
          <div>
            <div className="st-ph">Comandos desta etapa</div>
            {sent.slice(-6).map((c, i) => (
              <div key={i} className="subtle mono">
                {fmtTime(c.t)} {c.text}
              </div>
            ))}
          </div>
        )}
        <div className="subtle">Teclas: → / Page Down próxima · ← / Page Up anterior · Espaço pausa. Funcionam com controles remotos de slides.</div>
        <div className="row">
          <span className="subtle">Velocidade do tempo ×{String(runner.timeScale).replace('.', ',')}</span>
        </div>
      </div>
    </div>
  );
}
