/**
 * Tela ARMAS — sala de torpedos (tubos lançadores, torpedos e alvos).
 *
 * Seis tubos com o estado de cada um; lançamento AUTOMÁTICO (preparar, disparar, recarregar) ou PASSO A
 * PASSO (dez etapas em ordem: verde = liberada, vermelha = ainda não, âmbar = em andamento, ✓ = feita;
 * a cor vem de tubeSteps, a mesma regra dos intertravamentos da física); dados de tiro com arma de
 * exercício ou de combate; submarinos inimigos fictícios como alvo; o tubo em 3D etapa a etapa (corte,
 * fluxos e identificações ligáveis); a vista 3D com câmeras livres (torpedo, alvo…); torpedos em corrida
 * e a plotagem tática. Tudo passa por comandos ('tube', 'torpedo', 'enemy'); a física fica em
 * src/sim/systems/weapons.ts.
 */
import { useMemo, useState } from 'react';
import { cmd, useSim } from '../store';
import { Panel } from '../components/Panel';
import { Readout } from '../components/Readout';
import { Scene3D } from '../components/Scene3D';
import { TubeStage3D } from '../components/TubeStage3D';
import { usePersisted } from '../persist';
import { graphics } from '../graphics';
import { geoOriginOf } from '../routeNav';
import { fmt } from '../format';
import { makeDepthOf } from '../../sim/core/context';
import { qToMat3 } from '../../sim/core/math';
import { RHO_NOMINAL } from '../../sim/core/context';
import { tubeLength, stowedWeaponX } from '../../sim/systems/torpedoTubes';
import { DEFAULT_PRESETS, tubeSteps, tubeView, weaponTargets, isEnemyId, type ManualStep, type TubeAction, type TubeView } from '../../sim/systems/weapons';
import type { EnemySub, TorpedoRun, TubePresets, TubeState } from '../../sim/core/state';
import type { SimulationEngine } from '../../sim/core/engine';
import type { ViewMode } from '../../render3d/SubmarineScene';
import type { TubeLabelGroup, TubeStagePreset } from '../../render3d/TubeStage';
import { defaultLayers, type SceneLayers } from '../../render3d/layers';

const KT = 1852 / 3600;
const TONE_BADGE: Record<TubeView['tone'], string> = { off: 'off', busy: 'info', ready: 'ok', warn: 'warn' };
const PHASE: Record<TorpedoRun['phase'], [string, string]> = {
  afastamento: ['AFASTAMENTO', 'info'],
  guiado: ['GUIADO PELO FIO', 'info'],
  busca: ['CORRIDA', 'info'],
  ataque: ['ATAQUE', 'warn'],
  flutuando: ['FIM DE CORRIDA', 'off'],
  recolher: ['FLUTUANDO', 'ok'],
  explodiu: ['EXPLODIU', 'alarm'],
  perdido: ['AFUNDOU', 'off'],
};
const STEP_ICON: Record<ManualStep['state'], string> = { feito: '✓', andamento: '⏳', liberado: '▶', bloqueado: '⛔' };

/** contexto de leitura da pressão do mar na boca de cada tubo */
function seaCtx(e: SimulationEngine) {
  const s = e.state;
  return { env: e.env, depthOf: makeDepthOf(s.body.pos, qToMat3(s.body.quat)), rhoLocal: e.env.densityAt(Math.max(0, s.body.pos.z)) };
}

interface Target {
  id: string;
  name: string;
  n: number;
  e: number;
  course: number;
  speed: number;
  range: number;
  bearing: number;
  enemy: boolean;
  d?: number;
}

function useTargets(e: SimulationEngine): Target[] {
  const s = e.state;
  const origin = geoOriginOf(e);
  const traffic = graphics.get().traffic;
  return weaponTargets(e.env, origin, s.t, traffic, s.weapons)
    .map((c) => {
      const dn = c.n - s.body.pos.x;
      const de = c.e - s.body.pos.y;
      return { id: c.id, name: c.name, n: c.n, e: c.e, course: c.course, speed: c.speed, range: Math.hypot(dn, de), bearing: ((Math.atan2(de, dn) * 180) / Math.PI + 360) % 360, enemy: !!c.enemy, d: c.d };
    })
    .sort((a, b) => Number(b.enemy) - Number(a.enemy) || a.range - b.range);
}

const km = (m: number) => (m >= 1000 ? `${fmt(m / 1000, 1)} km` : `${fmt(m, 0)} m`);
const deg3 = (x: number) =>
  Math.round(((x % 360) + 360) % 360)
    .toString()
    .padStart(3, '0') + '°';

const TUBE_EMOJI = (vw: TubeView, st: TubeState) => (st.eject !== null ? '💨' : vw.ready ? '🟢' : st.reload !== null ? '🔄' : !st.weapon ? '⚪' : vw.tone === 'busy' ? '🟡' : '🔵');

export function WeaponsScreen() {
  const e = useSim(10);
  const s = e.state;
  const v = e.vessel;
  const w = v.weapons;
  const ws = s.weapons;
  const [sel, setSel] = usePersisted('armas.tubo', 1);
  const [draft, setDraft] = useState<Record<number, TubePresets>>({});
  const [mode, setMode] = usePersisted<'auto' | 'manual'>('armas.modo', 'manual');
  const [view, setView] = usePersisted<ViewMode>('armas.vista', 'torpedo');
  const [cut, setCut] = usePersisted('armas.corte', false);
  const [lbl3d, setLbl3d] = usePersisted('armas.rotulos3d', true);
  const [camKey, setCamKey] = useState(0);
  const [tsCut, setTsCut] = usePersisted('armas.tubo3d.corte', true);
  const [tsFlows, setTsFlows] = usePersisted('armas.tubo3d.fluxos', true);
  const [tsLbl, setTsLbl] = usePersisted<Record<TubeLabelGroup, boolean>>('armas.tubo3d.rotulos', { pecas: true, valvulas: true, valores: true });
  const [tsPreset, setTsPreset] = useState<{ key: number; p: TubeStagePreset } | undefined>(undefined);
  const [enemyCfg, setEnemyCfg] = usePersisted('armas.inimigo', { range: 3000, bearing: 20, depth: 60, speed: 5 });
  const targets = useTargets(e);
  const ctx = useMemo(() => seaCtx(e), [e, s.t]);
  if (!w || !ws) return <div className="note">Este navio não tem tubos lançadores na configuração.</div>;
  const views = w.tubes.map((_, i) => tubeView(v, s, ctx, e.geom.radiusAt, i));
  const i = Math.max(
    0,
    w.tubes.findIndex((t) => t.n === sel),
  );
  const tc = w.tubes[i];
  const t = ws.tubes[i];
  const tv = views[i];
  const pr: TubePresets = draft[tc.n] ?? t.presets;
  const setPr = (p: Partial<TubePresets>) => setDraft({ ...draft, [tc.n]: { ...pr, ...p } });
  const origin = geoOriginOf(e);
  const traffic = graphics.get().traffic;
  const order = (action: TubeAction, n = tc.n) => cmd({ type: 'tube', tube: n, action, presets: n === tc.n ? pr : undefined, origin, traffic });
  const target = pr.target ? targets.find((x) => x.id === pr.target) : undefined;
  const busy = t.auto !== null || t.eject !== null || t.reload !== null;
  const combat = pr.warhead === 'combate';
  const combatBad = combat && !!pr.target && !isEnemyId(pr.target);
  const steps = tubeSteps(v, s, ctx, e.geom.radiusAt, i, pr);
  const current = steps.find((x) => x.state === 'andamento') ?? steps.find((x) => x.state === 'liberado') ?? null;
  const enemies = ws.enemies ?? [];
  const layers: Partial<SceneLayers> = { ...defaultLayers(), torpedoes: true, tanks: cut, pipes: cut, flows: cut, labels: lbl3d, ships: true, wake: true, trail: true };
  const aim = (x: EnemySub) => {
    setPr({ target: x.id, warhead: 'combate' });
  };

  return (
    <div className="weapons-screen wx">
      {/* ---------- cabeçalho: tubos */}
      <section className="wx-hero">
        <div className="wx-title">
          <span className="wx-logo">🚀</span>
          <div>
            <h2>Sala de torpedos</h2>
            <span className="subtle">
              6 tubos · F21 · reserva <b>{ws.reserve}</b> · lançados <b>{ws.fired}</b>
              {enemies.length > 0 && (
                <>
                  {' '}
                  · inimigos <b className="wx-red">{enemies.filter((x) => x.sunk === null).length}</b>
                </>
              )}
            </span>
          </div>
        </div>
        <div className="wx-tubes">
          {[...w.tubes]
            .sort((a, b) => a.row - b.row || (a.side === 'BB' ? -1 : 1))
            .map((x) => {
              const k = w.tubes.indexOf(x);
              const st = ws.tubes[k];
              const vw = views[k];
              return (
                <button key={x.n} className={`wx-tube tone-${vw.tone} ${x.n === tc.n ? 'on' : ''}`} onClick={() => setSel(x.n)} title={`Tubo ${x.n} (${x.side === 'BE' ? 'boreste' : 'bombordo'}): ${vw.status}`}>
                  <span className="wx-muzzle">
                    <TubeMuzzle st={st} full={vw.fullWater} />
                  </span>
                  <span className="wx-tube-txt">
                    <b>
                      {TUBE_EMOJI(vw, st)} Tubo {x.n}
                    </b>
                    <small>{vw.status}</small>
                  </span>
                </button>
              );
            })}
        </div>
      </section>

      <div className="wx-cols">
        <div className="wx-col">
          {/* ---------- lançamento */}
          <Panel title={`Tubo ${tc.n} (${tc.side === 'BE' ? 'boreste' : 'bombordo'})`} className="wx-launch" right={<span className={`badge ${TONE_BADGE[tv.tone]}`}>{tv.status}</span>}>
            <div className="wx-mode">
              <button className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>
                ✋ Passo a passo
              </button>
              <button className={mode === 'auto' ? 'on' : ''} onClick={() => setMode('auto')}>
                🤖 Automático
              </button>
            </div>
            {mode === 'auto' ? (
              <div className="wx-auto">
                <button className="wx-big go" disabled={!t.weapon || busy || tv.ready} onClick={() => order('preparar')} title="Alimentar a arma, alagar com a água do TCA, equalizar com o mar e abrir a porta da boca">
                  <span>🛠️</span>Preparar
                </button>
                <button
                  className="wx-big fire"
                  disabled={!t.weapon || t.eject !== null || t.reload !== null || combatBad}
                  onClick={() => order('disparar')}
                  title={tv.ready ? 'Disparar agora (ejeção por ar comprimido)' : 'Preparar e disparar quando o tubo estiver pronto'}
                >
                  <span>🔥</span>
                  {tv.ready ? 'FOGO!' : 'Preparar e FOGO'}
                </button>
                <button className="wx-big" disabled={busy || t.door.pos <= 0.001} onClick={() => order('fechar')} title="Fechar a porta da boca e isolar o tubo do mar">
                  <span>🚪</span>Fechar porta
                </button>
                <button className="wx-big" disabled={busy || t.weapon || ws.reserve <= 0} onClick={() => order('recarregar')} title="Fechar a porta, drenar para o TCA, abrir a culatra e puxar uma arma da reserva">
                  <span>🔄</span>Recarregar ({ws.reserve})
                </button>
                <button className="wx-big warn" disabled={!t.auto} onClick={() => order('cancelar')}>
                  <span>✋</span>Cancelar
                </button>
                <button className="wx-big" onClick={() => order('dados')} title="Passar os dados de tiro à arma (registrados no histórico)">
                  <span>📡</span>Passar dados
                </button>
                {t.auto && <div className="wx-running">Sequência automática: {t.auto}…</div>}
              </div>
            ) : (
              <div className="wx-steps">
                {(['lancar', 'recarregar'] as const).map((g) => (
                  <div key={g} className="wx-lane">
                    <h4>{g === 'lancar' ? '🎯 Lançar' : '🔄 Recarregar'}</h4>
                    {steps
                      .filter((x) => x.group === g)
                      .map((x) => (
                        <button
                          key={x.action}
                          className={`wx-step st-${x.state} ${x.action === 'fogo' ? 'is-fire' : ''}`}
                          disabled={x.state !== 'liberado'}
                          onClick={() => order(x.action)}
                          title={`${x.hint}${x.why ? `\nAinda não: ${x.why}` : ''}`}
                        >
                          <span className="wx-num">{x.state === 'feito' ? '✓' : x.n}</span>
                          <span className="wx-step-txt">
                            <b>{x.label}</b>
                            <small>{x.state === 'bloqueado' ? x.why : x.state === 'andamento' ? 'em andamento…' : x.state === 'feito' ? 'feito' : 'liberado — clique'}</small>
                          </span>
                          <span className="wx-ico">{STEP_ICON[x.state]}</span>
                          {x.state === 'andamento' && <span className="wx-prog" style={{ width: `${Math.round(100 * Math.max(0.03, Math.min(1, x.progress ?? 0)))}%` }} />}
                        </button>
                      ))}
                  </div>
                ))}
              </div>
            )}
            {current && (
              <div className={`wx-now st-${current.state}`}>
                <b>
                  Etapa {current.n} · {current.label}
                </b>{' '}
                — {current.hint}
              </div>
            )}
            <TubeDiagram e={e} i={i} tv={tv} />
            <div className="readouts mt8">
              <Readout label="Água no tubo" value={t.water / RHO_NOMINAL} unit="m³" digits={2} kind="CALC" title={`Cheio com a arma: ${fmt(tv.fullWater / RHO_NOMINAL, 2)} m³`} />
              <Readout label="Pressão no tubo" value={t.pressure / 1e5} unit="bar" digits={2} kind="CALC" />
              <Readout label="Mar na boca" value={tv.seaPressure / 1e5} unit="bar" digits={2} kind="CALC" />
              <Readout label="Garrafa de lançamento" value={tv.flaskBar} unit="bar" digits={0} kind="CALC" title={`Mínimo para disparar: ${fmt(w.flask.minPressure / 1e5, 0)} bar`} />
            </div>
          </Panel>

          {/* ---------- dados de tiro */}
          <Panel title="🎯 Dados de tiro" className="wx-fire">
            <div className="wx-warhead">
              <button className={!combat ? 'on ex' : 'ex'} onClick={() => setPr({ warhead: 'exercicio' })} title="Passa sob o alvo, registra o acerto e flutua para ser recolhida">
                🟠 Exercício
              </button>
              <button className={combat ? 'on cb' : 'cb'} onClick={() => setPr({ warhead: 'combate' })} title="Ogiva real: explode no submarino inimigo (alvo fictício)">
                💥 Combate
              </button>
            </div>
            <div className="wx-targets">
              <button className={`wx-target ${!pr.target ? 'on' : ''}`} onClick={() => setPr({ target: null })}>
                <span>🧭</span>
                <b>Sem alvo</b>
                <small>corrida no rumo</small>
              </button>
              {targets.slice(0, 14).map((c) => (
                <button key={c.id} className={`wx-target ${c.enemy ? 'enemy' : ''} ${pr.target === c.id ? 'on' : ''}`} onClick={() => setPr({ target: c.id, ...(c.enemy ? {} : { warhead: 'exercicio' as const }) })}>
                  <span>{c.enemy ? '👾' : '🚢'}</span>
                  <b>{c.name.replace(' (fictício)', '')}</b>
                  <small>
                    {km(c.range)} · {deg3(c.bearing)}
                    {c.d !== undefined ? ` · ${fmt(c.d, 0)} m` : ''}
                  </small>
                </button>
              ))}
            </div>
            {combatBad && <div className="wx-alert">💥 A arma de combate só pode ir contra um submarino inimigo. Escolha um 👾 ou troque para exercício.</div>}
            <div className="wx-fields">
              <div className="wx-field">
                <span>Velocidade</span>
                <div className="seg">
                  {(['baixa', 'alta'] as const).map((sp) => (
                    <button key={sp} className={pr.speed === sp ? 'on' : ''} onClick={() => setPr({ speed: sp })}>
                      {sp} · {fmt(w.weapon.speeds[sp] / KT, 0)} nós
                    </button>
                  ))}
                </div>
              </div>
              <label className="wx-field">
                <span>
                  Cota de corrida <b>{fmt(pr.depth, 0)} m</b>
                </span>
                <input type="range" min={3} max={300} step={1} value={pr.depth} onChange={(ev) => setPr({ depth: Number(ev.target.value) || DEFAULT_PRESETS.depth })} />
              </label>
              <label className="wx-field">
                <span>Rumo (vazio = do submarino)</span>
                <input
                  className="num"
                  type="number"
                  min={0}
                  max={359}
                  placeholder="auto"
                  value={pr.course ?? ''}
                  onChange={(ev) => setPr({ course: ev.target.value === '' ? null : Number(ev.target.value) })}
                  style={{ width: 90 }}
                />
              </label>
            </div>
            {target && (
              <div className="note">
                {target.enemy ? '👾' : '🚢'} {target.name}: {km(target.range)} na marcação {deg3(target.bearing)}, rumo {deg3(target.course)}, {fmt(target.speed / KT, 1)} nós
                {target.d !== undefined ? `, cota ${fmt(target.d, 0)} m` : ''}. Tempo de corrida ≈ {fmt(target.range / w.weapon.speeds[pr.speed] / 60, 1)} min.{' '}
                {combat ? 'Arma de combate: desce à cota do alvo e explode na espoleta de proximidade.' : 'Arma de exercício: passa sob o alvo na cota ajustada.'}
              </div>
            )}
          </Panel>

          {/* ---------- inimigo */}
          <Panel title="👾 Submarino inimigo (alvo fictício)" className="wx-enemy">
            <div className="wx-fields">
              <label className="wx-field">
                <span>
                  Distância <b>{km(enemyCfg.range)}</b>
                </span>
                <input type="range" min={600} max={12000} step={100} value={enemyCfg.range} onChange={(ev) => setEnemyCfg({ ...enemyCfg, range: Number(ev.target.value) })} />
              </label>
              <label className="wx-field">
                <span>
                  Marcação relativa <b>{enemyCfg.bearing > 0 ? `${enemyCfg.bearing}° BE` : enemyCfg.bearing < 0 ? `${-enemyCfg.bearing}° BB` : 'pela proa'}</b>
                </span>
                <input type="range" min={-180} max={180} step={5} value={enemyCfg.bearing} onChange={(ev) => setEnemyCfg({ ...enemyCfg, bearing: Number(ev.target.value) })} />
              </label>
              <label className="wx-field">
                <span>
                  Cota <b>{enemyCfg.depth} m</b>
                </span>
                <input type="range" min={15} max={250} step={5} value={enemyCfg.depth} onChange={(ev) => setEnemyCfg({ ...enemyCfg, depth: Number(ev.target.value) })} />
              </label>
              <label className="wx-field">
                <span>
                  Velocidade <b>{enemyCfg.speed} nós</b>
                </span>
                <input type="range" min={0} max={15} step={1} value={enemyCfg.speed} onChange={(ev) => setEnemyCfg({ ...enemyCfg, speed: Number(ev.target.value) })} />
              </label>
            </div>
            <div className="row mt8">
              <button
                className="wx-big enemy"
                onClick={() => cmd({ type: 'enemy', action: 'add', range: enemyCfg.range, bearing: enemyCfg.bearing, depth: enemyCfg.depth, speed: enemyCfg.speed * KT })}
                title="O inimigo aparece na distância e marcação escolhidas, cruzando a proa do SX-1"
              >
                <span>👾</span>Colocar inimigo
              </button>
              {enemies.length > 0 && (
                <button className="btn" onClick={() => cmd({ type: 'enemy', action: 'clear' })}>
                  Remover todos
                </button>
              )}
            </div>
            {enemies.map((x) => {
              const rng = Math.hypot(x.n - s.body.pos.x, x.e - s.body.pos.y);
              return (
                <div key={x.id} className={`wx-foe ${x.sunk !== null ? 'sunk' : ''}`}>
                  <span className="wx-foe-ico">{x.sunk !== null ? '☠️' : '👾'}</span>
                  <span className="wx-foe-txt">
                    <b>{x.name}</b>
                    <small>
                      {x.sunk !== null
                        ? `atingido — afundando (${fmt(x.d, 0)} m)`
                        : `${km(rng)} · cota ${fmt(x.d, 0)} m · ${fmt(x.speed / KT, 0)} nós${x.evading ? ' · FUGINDO!' : ''}${x.hits ? ` · ${x.hits} acerto(s) de exercício` : ''}`}
                    </small>
                  </span>
                  {x.sunk === null && (
                    <button className={`btn ${pr.target === x.id && combat ? 'on' : ''}`} onClick={() => aim(x)} title={`Mirar o tubo ${tc.n} neste alvo com a arma de combate`}>
                      🎯 Mirar
                    </button>
                  )}
                  <button
                    className="btn"
                    onClick={() => {
                      setView('alvo');
                      setCamKey(camKey + 1);
                    }}
                    title="Câmera no inimigo"
                  >
                    👁️
                  </button>
                  <button className="btn" onClick={() => cmd({ type: 'enemy', action: 'remove', id: x.id })} title="Remover">
                    ✕
                  </button>
                </div>
              );
            })}
            {!enemies.length && <p className="subtle">Coloque um submarino inimigo, mire nele com 🎯, escolha 💥 Combate e dispare. A arma desce à cota dele e explode.</p>}
          </Panel>
        </div>

        <div className="wx-col">
          {/* ---------- tubo em 3D */}
          <Panel title="🔍 Tubo em 3D — etapa a etapa" className="wx-stage">
            <TubeStage3D tube={tc.n} cut={tsCut} flows={tsFlows} labels={tsLbl} focus={current?.action ?? null} preset={tsPreset} style={{ height: 440 }}>
              <div className="wx-stage-bar">
                {(
                  [
                    ['tres4', '¾'],
                    ['lado', 'Lado'],
                    ['boca', 'Boca'],
                    ['culatra', 'Culatra'],
                    ['cima', 'Cima'],
                  ] as [TubeStagePreset, string][]
                ).map(([p, l]) => (
                  <button key={p} onClick={() => setTsPreset({ key: (tsPreset?.key ?? 0) + 1, p })}>
                    {l}
                  </button>
                ))}
              </div>
              {current && (
                <div className={`wx-stage-cap st-${current.state}`}>
                  <b>
                    {current.n}. {current.label}
                  </b>
                  <span>{current.hint}</span>
                </div>
              )}
            </TubeStage3D>
            <div className="wx-toggles">
              <Toggle on={tsCut} set={setTsCut} label="✂️ Corte" title="Meio tubo aberto (desligado: tubo de vidro)" />
              <Toggle on={tsFlows} set={setTsFlows} label="💧 Fluxos" title="Escoamento nas tubulações e bolhas" />
              <Toggle on={tsLbl.pecas} set={(b) => setTsLbl({ ...tsLbl, pecas: b })} label="🏷️ Peças" />
              <Toggle on={tsLbl.valvulas} set={(b) => setTsLbl({ ...tsLbl, valvulas: b })} label="🔧 Válvulas" />
              <Toggle on={tsLbl.valores} set={(b) => setTsLbl({ ...tsLbl, valores: b })} label="🔢 Valores" />
            </div>
            <p className="subtle">Arraste para girar, roda/pinça para aproximar, botão direito (ou dois dedos) para deslocar. A peça da etapa atual pisca em amarelo.</p>
          </Panel>

          {/* ---------- vista 3D */}
          <Panel title="🌊 Vista 3D" className="weapons-3d">
            <div className="wx-cams">
              {(
                [
                  ['torpedo', '🚀 Torpedo'],
                  ['alvo', '👾 Alvo'],
                  ['perseguicao', '🎥 Perseguição'],
                  ['perspectiva', 'Proa ¾'],
                  ['frente', 'Frente'],
                  ['perfil', 'Perfil'],
                  ['livre', '🖐️ Livre'],
                ] as [ViewMode, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={view === id ? 'on' : ''}
                  onClick={() => {
                    setView(id);
                    setCamKey(camKey + 1);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="wx-toggles">
              <Toggle on={cut} set={setCut} label="✂️ Corte (armas nos tubos)" />
              <Toggle on={lbl3d} set={setLbl3d} label="🏷️ Identificações" />
            </div>
            <Scene3D view={view} viewKey={camKey} layers={layers} cutaway={cut} persistKey="armas" syncVisual={false} style={{ height: 460, position: 'relative' }} />
            <p className="subtle">Arraste para girar em volta do torpedo ou do alvo (a câmera continua acompanhando), roda para aproximar. Clique de novo no botão da câmera para voltar ao enquadramento padrão.</p>
          </Panel>

          {/* ---------- torpedos em corrida */}
          <Panel title="Torpedos em corrida">
            {ws.runs.length === 0 ? (
              <p className="subtle">Nenhum torpedo lançado.</p>
            ) : (
              <div className="scroll">
                <table className="t">
                  <thead>
                    <tr>
                      <th>Torpedo</th>
                      <th>Fase</th>
                      <th>Vel.</th>
                      <th>Cota</th>
                      <th>Percorrido</th>
                      <th>Alvo</th>
                      <th>Fio</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {ws.runs.map((r) => (
                      <RunRow key={r.id} r={r} targets={targets} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <TacticalPlot e={e} targets={targets} sel={pr.target} />
          </Panel>

          <Panel title="Compensação automática das armas" fold="armas.awc" foldOpen={false}>
            <div className="readouts">
              {w.tca.map((k, j) => (
                <Readout key={k.id} label={k.name.split(' ')[0]} value={ws.tca[j].mass / RHO_NOMINAL} unit="m³" digits={2} kind="CALC" title={`${k.name} — capacidade ${fmt(k.capacity, 1)} m³`} />
              ))}
              <Readout label="Admissão / descarga" value={ws.awcFlow} unit="kg/s" digits={1} kind="CALC" title="+ admitindo do mar, − descarregando" />
              <Readout label="Desvio de peso" value={weightError(e)} unit="kg" digits={0} kind="CALC" title="Peso de referência − peso atual (armas, água dos tubos, TCA e reserva)" />
              <Readout label="Trim corrigido" value={-(ws.awcTrim ?? 0) / 1000} unit="t·m" digits={1} kind="CALC" title="Momento já corrigido por transferências TT-AV ↔ TT-AR" />
            </div>
            <p className="subtle">
              Ao alagar, a água sai do TCA para o tubo (peso igual, mais a vante). No disparo sai a arma ({fmt(w.weapon.mass, 0)} kg) e entra no tubo o mar no lugar dela ({fmt(w.weapon.volume, 2)} m³): a compensação
              admite a diferença no TCA e, com os tubos parados, transfere água entre os tanques de trim para anular o binário.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, set, label, title }: { on: boolean; set: (b: boolean) => void; label: string; title?: string }) {
  return (
    <button className={`wx-tog ${on ? 'on' : ''}`} onClick={() => set(!on)} title={title} aria-pressed={on}>
      {label}
    </button>
  );
}

/** boca do tubo vista de frente: água (azul), arma (laranja) e a porta (aro) */
function TubeMuzzle({ st, full }: { st: TubeState; full: number }) {
  const f = Math.max(0, Math.min(1, full > 0 ? st.water / full : 0));
  const doorCol = st.door.pos > 0.999 ? '#3ddc84' : st.door.pos > 0.001 ? '#f5b041' : '#8399b1';
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <defs>
        <clipPath id={`mz${st.n}`}>
          <circle cx="20" cy="20" r="15" />
        </clipPath>
      </defs>
      <circle cx="20" cy="20" r="15" fill="#0b1622" />
      <rect x="4" y={35 - 30 * f} width="32" height={30 * f} fill="#2a92ec" opacity="0.8" clipPath={`url(#mz${st.n})`} />
      {st.weapon && <circle cx="20" cy="20" r="8" fill="#e8622b" stroke="#1a1a1a" strokeWidth="1.5" />}
      {st.weapon && <circle cx="20" cy="20" r="3" fill="#ffd27a" />}
      <circle cx="20" cy="20" r="17" fill="none" stroke={doorCol} strokeWidth="3.5" strokeDasharray={st.door.pos > 0.001 ? `${(1 - st.door.pos) * 107} 200` : undefined} />
    </svg>
  );
}

function weightError(e: SimulationEngine): number {
  const w = e.vessel.weapons!;
  const ws = e.state.weapons!;
  let m = ws.reserve * w.weapon.mass;
  for (const t of ws.tubes) m += (t.weapon ? w.weapon.mass : 0) + t.water;
  for (const k of ws.tca) m += k.mass;
  return ws.awcRef - m;
}

function RunRow({ r, targets }: { r: TorpedoRun; targets: Target[] }) {
  const [ph, tone] = PHASE[r.phase];
  const done = r.phase === 'flutuando' || r.phase === 'recolher' || r.phase === 'explodiu' || r.phase === 'perdido';
  return (
    <tr>
      <td>
        <b>{r.id}</b> <span className="subtle">tubo {r.tube}</span> {r.presets.warhead === 'combate' && <span title="arma de combate">💥</span>}
      </td>
      <td>
        <span className={`badge ${tone}`}>{ph}</span> {r.hit && <span className="badge ok">{r.phase === 'explodiu' ? 'ALVO ATINGIDO' : 'ACERTO'}</span>}
      </td>
      <td className="mono">{fmt(r.speed / KT, 0)} nós</td>
      <td className="mono">{fmt(r.d, 0)} m</td>
      <td className="mono">{km(r.run)}</td>
      <td>
        {r.tgt ? `${r.tgt.name} — ${km(r.tgt.range)}` : r.target ? r.target : '—'}
        {r.hit && (
          <div className="subtle">
            passou a {fmt(r.hit.dist, 0)} m, cota {fmt(r.hit.depth, 0)} m
          </div>
        )}
        {!r.hit && done && r.target && Number.isFinite(r.closest) && <div className="subtle">menor distância {km(r.closest)}</div>}
      </td>
      <td>{r.wire ? <span className="badge info">LIGADO</span> : <span className="badge off">—</span>}</td>
      <td>
        <div className="btngroup">
          {!done && r.wire && (
            <select value={r.target ?? ''} onChange={(ev) => cmd({ type: 'torpedo', id: r.id, action: 'alvo', target: ev.target.value || null })} title="Novo alvo pelo fio">
              <option value="">sem alvo</option>
              {targets
                .filter((c) => r.presets.warhead !== 'combate' || c.enemy)
                .slice(0, 30)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          )}
          {!done && r.wire && (
            <button className="btn sm" onClick={() => cmd({ type: 'torpedo', id: r.id, action: 'cortarFio' })}>
              Cortar fio
            </button>
          )}
          {(r.phase === 'recolher' || r.phase === 'explodiu' || r.phase === 'perdido') && (
            <button className="btn sm ok" onClick={() => cmd({ type: 'torpedo', id: r.id, action: 'recolher' })}>
              {r.phase === 'recolher' ? 'Recolher' : 'Tirar da lista'}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/** corte esquemático do tubo selecionado: culatra, água, arma, válvulas, porta da boca e casco */
function TubeDiagram({ e, i, tv }: { e: SimulationEngine; i: number; tv: TubeView }) {
  const w = e.vessel.weapons!;
  const tc = w.tubes[i];
  const t = e.state.weapons!.tubes[i];
  const L = tubeLength(w, tc, e.geom.radiusAt);
  const X0 = 40;
  const X1 = 560;
  const k = (X1 - X0) / L;
  const yT = 40;
  const H = 46;
  const fill = Math.max(0, Math.min(1, t.water / Math.max(1, tv.fullWater)));
  const wx = X0 + (stowedWeaponX(w) - w.weapon.length / 2 - w.breechX + (t.eject ?? 0)) * k;
  const valve = (x: number, y: number, st: { pos: number; cmd: number }, label: string) => (
    <g>
      <circle cx={x} cy={y} r="7" fill={st.pos > 0.999 ? '#3ddc84' : st.pos > 0.001 || st.cmd > 0.5 ? '#f5b041' : '#5a6f86'} stroke="#0a1017" />
      <text x={x} y={y + (y < yT ? -11 : 19)} textAnchor="middle" fontSize="10" fill="#8399b1">
        {label}
      </text>
    </g>
  );
  return (
    <svg viewBox="0 0 640 150" className="svgbox" style={{ width: '100%', maxHeight: 170 }}>
      {/* casco externo na boca */}
      <path d={`M ${X1 + 22} 10 Q ${X1 + 48} 63 ${X1 + 22} 116`} fill="none" stroke="#5a6f86" strokeWidth="3" />
      <text x={X1 + 50} y="20" fontSize="10" fill="#5a6f86">
        casco
      </text>
      {/* tubo */}
      <rect x={X0} y={yT} width={X1 - X0} height={H} fill="#0d1824" stroke="#8fa3b8" strokeWidth="2" />
      <rect x={X0 + 1} y={yT + H * (1 - fill)} width={X1 - X0 - 2} height={H * fill} fill="#2a7fd4" opacity="0.65" />
      {/* arma */}
      {t.weapon && (
        <g>
          <rect x={wx} y={yT + 9} width={w.weapon.length * k} height={H - 18} rx={(H - 18) / 2} fill="#1d262c" stroke="#c9d6e3" />
          <rect x={wx + w.weapon.length * k * 0.35} y={yT + 9} width={w.weapon.length * k * 0.34} height={H - 18} fill="#e8622b" />
          <text x={wx + (w.weapon.length * k) / 2} y={yT + H / 2 + 4} textAnchor="middle" fontSize="11" fill="#fff">
            F21
          </text>
        </g>
      )}
      {/* culatra e porta da boca */}
      <line x1={X0} y1={yT - 4} x2={X0 - 26 * t.breech.pos} y2={yT + H + 4 - 40 * t.breech.pos} stroke={t.breech.pos > 0.001 ? '#f5b041' : '#c9d6e3'} strokeWidth="5" />
      <line x1={X1} y1={yT - 4} x2={X1 + 26 * t.door.pos} y2={yT + H + 4 - 40 * t.door.pos} stroke={t.door.pos > 0.999 ? '#3ddc84' : t.door.pos > 0.001 ? '#f5b041' : '#c9d6e3'} strokeWidth="5" />
      <text x={X0} y={yT + H + 30} fontSize="10" fill="#8399b1" textAnchor="middle">
        culatra
      </text>
      <text x={X1} y={yT + H + 30} fontSize="10" fill="#8399b1" textAnchor="middle">
        porta da boca
      </text>
      {/* válvulas */}
      {valve(X0 + 70, yT + H + 16, t.flood, 'alagamento (TCA)')}
      {valve(X0 + 70, yT - 16, t.vent, 'suspiro')}
      {valve(X0 + 230, yT - 16, t.equalize, 'equalização (mar)')}
      {valve(X0 + 230, yT + H + 16, t.drain, 'drenagem (TCA)')}
      <text x={X0 + 380} y={yT - 12} fontSize="10" fill="#c9a227">
        garrafa {fmt(tv.flaskBar, 0)} bar {t.energized ? '· arma alimentada' : ''}
      </text>
      <text x="8" y="146" fontSize="10" fill="#5a6f86">
        {fmt(L, 2)} m da culatra à boca · água {fmt((fill * 100) as number, 0)} % · Δp tubo − mar {fmt((t.pressure - tv.seaPressure) / 1e5, 2)} bar
      </text>
    </svg>
  );
}

/** plotagem tática (norte para cima): próprio navio, contatos, alvo, derrotas e posição dos torpedos */
function TacticalPlot({ e, targets, sel }: { e: SimulationEngine; targets: Target[]; sel: string | null }) {
  const s = e.state;
  const runs = s.weapons?.runs ?? [];
  const foes = s.weapons?.enemies ?? [];
  const booms = (s.weapons?.explosions ?? []).filter((x) => s.t - x.t < 60);
  const own = { n: s.body.pos.x, e: s.body.pos.y };
  const focus = targets.filter((c) => c.id === sel || runs.some((r) => r.target === c.id));
  let span = 2000;
  for (const r of runs) for (const p of [r, ...r.track]) span = Math.max(span, Math.abs(p.n - own.n), Math.abs(p.e - own.e));
  for (const c of focus) span = Math.max(span, Math.abs(c.n - own.n), Math.abs(c.e - own.e));
  for (const c of foes) span = Math.max(span, Math.abs(c.n - own.n), Math.abs(c.e - own.e));
  span *= 1.15;
  const S = 360;
  const k = S / 2 / span;
  const xy = (n: number, ee: number) => [S / 2 + (ee - own.e) * k, S / 2 - (n - own.n) * k] as const;
  const hdg = (e.outputs.euler.heading * Math.PI) / 180;
  const ring = Math.pow(10, Math.floor(Math.log10(span / 2)));
  const step = span / ring > 6 ? ring * 2 : ring;
  const rings = [1, 2, 3].map((j) => j * step).filter((r) => r < span);
  return (
    <div className="mt8">
      <svg viewBox={`0 0 ${S} ${S}`} className="svgbox" style={{ width: '100%', maxWidth: 420, display: 'block', margin: '0 auto', background: '#08111a' }}>
        {rings.map((r) => (
          <g key={r}>
            <circle cx={S / 2} cy={S / 2} r={r * k} fill="none" stroke="#1d2e42" />
            <text x={S / 2 + 3} y={S / 2 - r * k - 2} fontSize="9" fill="#5a6f86">
              {km(r)}
            </text>
          </g>
        ))}
        <text x={S / 2} y="12" fontSize="10" fill="#5a6f86" textAnchor="middle">
          N
        </text>
        {targets
          .filter((c) => !c.enemy && Math.abs(c.n - own.n) < span && Math.abs(c.e - own.e) < span)
          .map((c) => {
            const [x, y] = xy(c.n, c.e);
            const ch = (c.course * Math.PI) / 180;
            const hot = c.id === sel || runs.some((r) => r.target === c.id);
            const vl = Math.min(40, c.speed * 360 * k);
            return (
              <g key={c.id}>
                <line x1={x} y1={y} x2={x + Math.sin(ch) * vl} y2={y - Math.cos(ch) * vl} stroke={hot ? '#ffb347' : '#5a6f86'} />
                <rect x={x - 4} y={y - 4} width="8" height="8" fill={hot ? '#ffb347' : '#8399b1'} />
                <text x={x + 7} y={y + 3} fontSize="9" fill={hot ? '#ffd9a0' : '#8399b1'}>
                  {c.name.replace(' (fictício)', '')}
                </text>
              </g>
            );
          })}
        {foes.map((x) => {
          const [px, py] = xy(x.n, x.e);
          const ch = (x.course * Math.PI) / 180;
          const vl = Math.min(40, x.speed * 360 * k);
          const dead = x.sunk !== null;
          return (
            <g key={x.id}>
              {!dead && <line x1={px} y1={py} x2={px + Math.sin(ch) * vl} y2={py - Math.cos(ch) * vl} stroke="#ff5257" />}
              <polygon points={`${px},${py - 6} ${px + 6},${py} ${px},${py + 6} ${px - 6},${py}`} fill={dead ? '#5a6f86' : '#ff5257'} stroke="#1a0000" />
              <text x={px + 8} y={py + 3} fontSize="10" fill={dead ? '#8399b1' : '#ff9a9c'} fontWeight="bold">
                {dead ? `☠ ${x.name}` : x.name}
              </text>
            </g>
          );
        })}
        {booms.map((x) => {
          const [px, py] = xy(x.n, x.e);
          const a = Math.max(0, 1 - (s.t - x.t) / 60);
          return (
            <g key={'b' + x.id} opacity={a}>
              <circle cx={px} cy={py} r={6 + 10 * (1 - a)} fill="none" stroke="#ffb347" strokeWidth="2" />
              <text x={px} y={py + 4} fontSize="12" textAnchor="middle">
                💥
              </text>
            </g>
          );
        })}
        {runs.map((r) => {
          const pts = [...r.track, r].map((p) => xy(p.n, p.e).join(',')).join(' ');
          const [x, y] = xy(r.n, r.e);
          return (
            <g key={r.id}>
              <polyline points={pts} fill="none" stroke={r.hit ? '#3ddc84' : '#36c5f0'} strokeWidth="1.5" strokeDasharray={r.wire ? undefined : '4 3'} />
              <circle cx={x} cy={y} r="3.5" fill={r.hit ? '#3ddc84' : '#36c5f0'} />
              <text x={x + 6} y={y - 5} fontSize="10" fill="#d8e4f0">
                {r.id}
              </text>
            </g>
          );
        })}
        <polygon
          points={`${S / 2 + Math.sin(hdg) * 9},${S / 2 - Math.cos(hdg) * 9} ${S / 2 + Math.sin(hdg + 2.5) * 6},${S / 2 - Math.cos(hdg + 2.5) * 6} ${S / 2 + Math.sin(hdg - 2.5) * 6},${S / 2 - Math.cos(hdg - 2.5) * 6}`}
          fill="#3ddc84"
        />
      </svg>
      <p className="subtle" style={{ textAlign: 'center' }}>
        Norte para cima. Verde: SX-1 · azul: torpedos (tracejado = sem fio) · laranja: alvo e contatos atacados (vetor de 6 min) · vermelho: submarino inimigo · 💥 explosão.
      </p>
    </div>
  );
}
