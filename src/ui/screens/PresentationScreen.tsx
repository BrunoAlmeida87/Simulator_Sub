/**
 * Tela de APRESENTAÇÃO: cena 3D, tanques, vetores de força e indicadores
 * físicos reunidos, com controles de condução (situações prontas, pausa,
 * câmera lenta, estado inicial, comparação antes × depois e camadas).
 * Tudo o que aparece é lido do estado do motor.
 */
import { useEffect, useReducer, useState } from 'react';
import { cmd, runner, useSim } from '../store';
import { Scene3D } from '../components/Scene3D';
import { useQuality } from '../graphics';
import { seaSections } from '../components/SeaControls';
import { Panel } from '../components/Panel';
import { Telegraph } from '../components/Controls';
import { ManeuverStatus } from '../components/ManeuverStatus';
import { CargoPanel } from '../components/CargoPanel';
import { TrimDemoPanel } from '../components/TrimDemo';
import { TourCard, TourList } from '../components/TourCard';
import { tours } from '../tours';
import type { ViewMode } from '../../render3d/SubmarineScene';
import { FORCE_STYLE, TANK_STYLE, type TankCategory } from '../../render3d/layers';
import { pres, PRESETS, METRICS, takeMetrics, mbtGroup } from '../presentation';
import { maneuver } from '../maneuvers';
import { verticalBalance, toTf } from '../../sim/forceVectors';
import { tankVolume } from '../../sim/systems/internalTanks';
import type { SimulationEngine } from '../../sim/core/engine';
import { fmt, fmtTime } from '../format';
import { toKnots } from '../../sim/units';
import { OverlayCtl } from '../components/OverlayCtl';
import { useUi } from '../uiContext';
import type { LayerKey } from '../components/LayerPanel';
import { SceneLayerPanel } from '../components/SceneLayerPanel';

const FRAMES: [ViewMode, string, string][] = [
  ['superficie', 'Superfície', 'Navegação na superfície: esteira, proa e hélice'],
  ['perspectiva', 'Perspectiva', 'Grande-angular de perto, 3/4 pela proa: a proa (mais perto) aparece bem maior que a popa'],
  ['submerso', 'Submerso', 'Operação submersa, ao nível do casco'],
  ['tanques', 'Tanques', 'Inspeção dos tanques e circuitos no corte'],
  ['forcas', 'Forças', 'Vista lateral para os vetores de peso, empuxo e resultante'],
  ['calado', 'Calado', 'Lateral rente à água: calados a vante e a ré e linha d’água (trim na superfície)'],
  ['navio', 'Navio', 'Mira o navio (contato da mesa tática) mais próximo'],
  ['piloto', 'Seguir', 'Câmera lateral que acompanha o submarino'],
  ['perseguicao', 'Perseguição', 'Câmera atrás do submarino'],
  ['fixa', 'Fixa', 'Câmera parada no cenário: o submarino atravessa o quadro'],
  ['passadico', 'Passadiço', 'Passadiço: em pé no alto da vela, olhando em volta (arraste); roda do mouse ou B = binóculo 7×50'],
  ['drone', 'Drone', 'Drone: câmera livre no cenário (mar, orla, cidade). WASD mover · Q/E subir/descer · arrastar olhar · Shift rápido · roda = velocidade'],
  ['livre', 'Livre', 'Arraste para girar, roda/pinça para aproximar'],
];

/** camadas da apresentação (nomes no catálogo LAYER_INFO) */
const LAYER_LIST: LayerKey[] = [
  'vectors',
  'hydroVectors',
  'trimVectors',
  'tanks',
  'pipes',
  'flows',
  'labels',
  'batteryInfo',
  'airInfo',
  'wake',
  'wind',
  'pennant',
  'markers',
  'trail',
  'presLight',
  'noWater',
  'trimRef',
  'depthLines',
  'ships',
];

function usePres() {
  const [, f] = useReducer((x: number) => x + 1, 0);
  useEffect(() => pres.subscribe(f), []);
  return pres;
}

const tf = (N: number, g: number, d = 1) => `${fmt(toTf(N, g), d)} tf`;

function ForceHud({ e, gain }: { e: SimulationEngine; gain: string }) {
  const vb = verticalBalance(e);
  const g = vb.g;
  const net = toTf(vb.netN, g);
  return (
    <div className="pres-hud">
      <div className="fr" style={{ color: FORCE_STYLE.buoyancy.css }}>
        <span>▲ Empuxo E</span>
        <b>{tf(vb.buoyancyN, g)}</b>
      </div>
      <div className="fr" style={{ color: FORCE_STYLE.weight.css }}>
        <span>▼ Peso P</span>
        <b>{tf(vb.weightN, g)}</b>
      </div>
      <div className="fr" style={{ color: FORCE_STYLE.net.css }}>
        <span>{net >= 0 ? '▲' : '▼'} E − P</span>
        <b>{fmt(net, 2)} tf</b>
      </div>
      <div className="subtle">
        V = {fmt(vb.displacedM3, 1)} m³ · {fmt(vb.immersedFraction * 100, 1)} % imerso · m = {fmt(vb.massKg / 1000, 1)} t
      </div>
      <div className="subtle">
        {fmt(e.outputs.depthKeel, 1)} m · {e.outputs.verticalSpeed >= 0 ? 'desce' : 'sobe'} {fmt(Math.abs(e.outputs.verticalSpeed), 2)} m/s · {fmt(toKnots(e.state.body.vel.x), 1)} nós · θ {fmt(e.outputs.euler.pitch, 1)}°
      </div>
      <div className="subtle">Escala: peso inicial = 14 m · resultante: {gain}</div>
    </div>
  );
}

interface TankRow {
  id: string;
  cat: TankCategory;
  name: string;
  vol: number;
  cap: number;
  flow: number;
}

function tankRows(e: SimulationEngine): TankRow[] {
  const v = e.vessel;
  const s = e.state;
  const rows: TankRow[] = [];
  for (const t of v.ballast.tanks) rows.push({ id: t.id, cat: 'lastro', name: t.name, vol: s.ballast[t.id].water, cap: t.volume, flow: s.ballast[t.id].qWater });
  for (const t of v.compensation.tanks) rows.push({ id: t.id, cat: 'compensacao', name: t.name, vol: tankVolume(s.compensation.tanks[t.id]), cap: t.capacity, flow: s.compensation.tanks[t.id].flow ?? 0 });
  rows.push({ id: v.trim.tankA.id, cat: 'trim', name: v.trim.tankA.name, vol: tankVolume(s.trim.tankA), cap: v.trim.tankA.capacity, flow: -s.trim.flow });
  rows.push({ id: v.trim.tankB.id, cat: 'trim', name: v.trim.tankB.name, vol: tankVolume(s.trim.tankB), cap: v.trim.tankB.capacity, flow: s.trim.flow });
  rows.push({ id: v.heel.tankA.id, cat: 'banda', name: v.heel.tankA.name, vol: tankVolume(s.heel.tankA), cap: v.heel.tankA.capacity, flow: (s.heel.tankA.flow ?? 0) - s.heel.flow });
  rows.push({ id: v.heel.tankB.id, cat: 'banda', name: v.heel.tankB.name, vol: tankVolume(s.heel.tankB), cap: v.heel.tankB.capacity, flow: (s.heel.tankB.flow ?? 0) + s.heel.flow });
  return rows;
}

const flowTxt = (q: number) => {
  const a = Math.abs(q);
  if (a < 1e-4) return '';
  return `${q > 0 ? '▲ enchendo' : '▼ esvaziando'} ${a >= 0.1 ? `${fmt(a, 2)} m³/s` : `${fmt(a * 1000, 1)} L/s`}`;
};

function TankList({ e, highlight, onPick }: { e: SimulationEngine; highlight: string | null; onPick: (id: string | null) => void }) {
  const rows = tankRows(e);
  const cats = Object.keys(TANK_STYLE) as TankCategory[];
  return (
    <div className="tanklist">
      {cats.map((c) => (
        <div key={c} className="tgroup">
          <div className="thead" style={{ color: TANK_STYLE[c].css }}>
            <i style={{ background: TANK_STYLE[c].css }} />
            {TANK_STYLE[c].label} <span className="subtle">— {TANK_STYLE[c].fn}</span>
          </div>
          {rows
            .filter((r) => r.cat === c)
            .map((r) => {
              const f = Math.max(0, Math.min(1, r.vol / r.cap));
              return (
                <button key={r.id} className={`trow ${highlight === r.id ? 'sel' : ''}`} onClick={() => onPick(highlight === r.id ? null : r.id)} title="Destacar este tanque no corte">
                  <span className="tname">{r.name}</span>
                  <span className="tbar">
                    <span style={{ width: `${f * 100}%`, background: TANK_STYLE[c].css }} />
                  </span>
                  <span className="mono tpct">{fmt(f * 100, 0)} %</span>
                  <span className="mono tvol subtle">
                    {fmt(r.vol, r.cap > 20 ? 1 : 2)}/{fmt(r.cap, 0)} m³ {flowTxt(r.flow)}
                  </span>
                </button>
              );
            })}
        </div>
      ))}
    </div>
  );
}

function Compare({ e }: { e: SimulationEngine }) {
  const b = pres.before;
  if (!b) return <div className="subtle">Marque o “antes” e opere um comando: a tabela compara os dois estados.</div>;
  const now = takeMetrics(e);
  return (
    <table className="t compare">
      <thead>
        <tr>
          <th />
          <th>Antes ({b.label})</th>
          <th>Agora</th>
          <th>Δ</th>
        </tr>
      </thead>
      <tbody>
        {METRICS.map((m) => {
          const d = now[m.id] - b.metrics[m.id];
          const sig = Math.abs(d) >= Math.pow(10, -m.dec) / 2;
          return (
            <tr key={m.id} className={sig ? 'chg' : ''}>
              <td>{m.label}</td>
              <td className="mono">
                {fmt(b.metrics[m.id], m.dec)} {m.unit}
              </td>
              <td className="mono">
                {fmt(now[m.id], m.dec)} {m.unit}
              </td>
              <td className="mono">{sig ? `${d > 0 ? '+' : ''}${fmt(d, m.dec)}` : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function PresentationScreen() {
  const e = useSim(8);
  const p = usePres();
  const ui = useUi();
  const [quality, setQuality] = useQuality();
  const [presetSel, setPresetSel] = useState(PRESETS.some((x) => x.id === p.presetId) ? p.presetId! : PRESETS[0].id);
  useEffect(() => pres.ensureInitial(runner), []);
  const L = p.layers;
  const pick = (id: string | null) => pres.setLayers({ highlight: id, ...(id ? { tanks: true } : {}) });
  const preset = PRESETS.find((x) => x.id === presetSel) ?? PRESETS[0];
  const vb = verticalBalance(e);
  const gainTxt = L.resultantGain === 'auto' ? 'ampliação automática (fator no rótulo)' : `×${L.resultantGain}`;
  const scales = [0.25, 0.5, 1, 2, 5, 10];
  return (
    <div className="pres">
      <div className="pres-view">
        <Scene3D quality={quality} view={p.view} layers={L} labels={false} persistKey="pres" onPickTank={(id) => id && pick(id)}>
          {(L.vectors || L.hydroVectors) && (
            <div className="only-wide">
              <ForceHud e={e} gain={gainTxt} />
            </div>
          )}
          <OverlayCtl persistKey="pres" sections={seaSections(quality, setQuality)} />
          <div className="pres-bottom only-wide">{tours.active || tours.finished ? <TourCard /> : <ManeuverStatus />}</div>
        </Scene3D>
        <div className="only-narrow pres-under">
          {tours.active || tours.finished ? <TourCard compact /> : <ManeuverStatus compact />}
          {(L.vectors || L.hydroVectors) && <ForceHud e={e} gain={gainTxt} />}
        </div>
      </div>
      <div className="pres-side">
        <Panel title="Roteiros automáticos">
          <TourList />
        </Panel>

        <Panel
          title="Situações de aula e condução"
          right={
            <button className="btn sm" onClick={() => ui.setScreen('cenarios')} title="Abre a biblioteca: condições iniciais, situações de aula e roteiros automáticos">
              📚 Biblioteca
            </button>
          }
        >
          <div className="row">
            <select value={presetSel} onChange={(ev) => setPresetSel(ev.target.value)} style={{ flex: 1, minWidth: 0 }} aria-label="Situação de aula">
              {PRESETS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <button className="btn ok" onClick={() => pres.prepare(runner, preset)} title="Carrega a situação, a câmera e as camadas sugeridas (pausado)">
              Preparar
            </button>
          </div>
          <div className="note" style={{ marginTop: 4 }}>
            {preset.note}
          </div>
          <div className="row mt8">
            <button className={`btn ${runner.running ? 'on' : 'ok'}`} onClick={() => ((runner.running = !runner.running), runner.notify())}>
              {runner.running ? '❚❚ Pausar' : '▶ Executar'}
            </button>
            <button className="btn" disabled={runner.running} onClick={() => runner.stepOnce(5)} title="Avança 0,1 s">
              +0,1 s
            </button>
            <button className="btn" disabled={runner.running} onClick={() => runner.stepOnce(50)} title="Avança 1 s">
              +1 s
            </button>
            <span className="clock mono">{fmtTime(e.state.t)}</span>
          </div>
          <div className="row mt8">
            <div className="seg" title="Velocidade do tempo (câmera lenta abaixo de ×1)">
              {scales.map((s) => (
                <button key={s} className={runner.timeScale === s ? 'on' : ''} onClick={() => ((runner.timeScale = s), runner.notify())}>
                  ×{String(s).replace('.', ',')}
                </button>
              ))}
            </div>
          </div>
          <div className="row mt8">
            <button className="btn warn" disabled={!p.initial} onClick={() => pres.restoreInitial(runner)} title="Volta ao estado em que a situação foi preparada">
              ↺ Estado inicial
            </button>
            <button className="btn" onClick={() => pres.markBefore(runner)} title="Guarda o estado atual para comparar depois de uma ação">
              📌 Marcar “antes”
            </button>
            <button className="btn" disabled={!p.before} onClick={() => pres.restoreBefore(runner)} title="Volta ao estado marcado como “antes”">
              ↩ Voltar ao “antes”
            </button>
          </div>
        </Panel>

        <Panel title="Enquadramento" fold="pres.frames" tag={<span className="subtle panel-val">{FRAMES.find(([v]) => v === p.view)?.[1] ?? ''}</span>}>
          <div className="btngroup">
            {FRAMES.map(([v, l, tip]) => (
              <button key={v} className={`btn sm ${p.view === v ? 'on' : ''}`} onClick={() => pres.setView(v, true)} title={tip}>
                {l}
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Camadas" fold="pres.layers" foldOpen={false} tag={<span className="subtle panel-val">{LAYER_LIST.filter((k) => !!L[k]).length} ligadas</span>}>
          <SceneLayerPanel e={e} keys={LAYER_LIST} value={L} onChange={(p) => pres.setLayers(p)} hullControl />
          <div className="note mt8">Clique num tanque na lista ou no corte para destacá-lo. Cada grupo reúne a visibilidade e os ajustes dos seus itens.</div>
        </Panel>

        <Panel title="Forças e equilíbrio vertical">
          <table className="t">
            <tbody>
              <tr>
                <td style={{ color: FORCE_STYLE.weight.css }}>Peso P = m·g (em G)</td>
                <td className="mono">{tf(vb.weightN, vb.g, 2)}</td>
                <td className="mono subtle">{fmt(vb.weightN / 1000, 0)} kN</td>
              </tr>
              <tr>
                <td style={{ color: FORCE_STYLE.buoyancy.css }}>Empuxo E = ρ·g·V (em B)</td>
                <td className="mono">{tf(vb.buoyancyN, vb.g, 2)}</td>
                <td className="mono subtle">{fmt(vb.buoyancyN / 1000, 0)} kN</td>
              </tr>
              <tr>
                <td style={{ color: FORCE_STYLE.net.css }}>Resultante E − P</td>
                <td className="mono">{tf(vb.netN, vb.g, 2)}</td>
                <td className="mono subtle">{Math.abs(toTf(vb.netN, vb.g)) < 0.05 ? 'neutro (equilíbrio)' : vb.netN > 0 ? 'tende a subir' : 'tende a descer'}</td>
              </tr>
              <tr>
                <td>Volume deslocado / envelope</td>
                <td className="mono">{fmt(vb.displacedM3, 1)} m³</td>
                <td className="mono subtle">
                  {fmt(vb.envelopeM3, 0)} m³ ({fmt(vb.immersedFraction * 100, 1)} %)
                </td>
              </tr>
              <tr>
                <td>Densidade da água</td>
                <td className="mono">{fmt(vb.rho, 2)} kg/m³</td>
                <td />
              </tr>
              <tr>
                <td>Água nos TLP / compensação</td>
                <td className="mono">{fmt(vb.mbtWaterKg / 1000, 1)} t</td>
                <td className="mono subtle">{fmt(vb.compKg / 1000, 2)} t</td>
              </tr>
              <tr>
                <td>Trim / banda (água)</td>
                <td className="mono">{fmt(vb.trimKg / 1000, 2)} t</td>
                <td className="mono subtle">{fmt(vb.heelKg / 1000, 2)} t</td>
              </tr>
            </tbody>
          </table>
        </Panel>

        <Panel title="Cargas a bordo — trim e banda">
          <CargoPanel e={e} />
        </Panel>

        <Panel title="Trim — peso deslocável">
          <TrimDemoPanel e={e} compact />
        </Panel>

        <Panel
          title="Tanques"
          right={
            L.highlight ? (
              <button className="btn sm" onClick={() => pick(null)}>
                Limpar destaque
              </button>
            ) : undefined
          }
        >
          <TankList e={e} highlight={L.highlight} onPick={pick} />
        </Panel>

        <Panel title="Comandos">
          <div className="subtle mb4">Lastro principal (TLP)</div>
          <div className="btngroup">
            <button className="btn sm" onClick={() => mbtGroup(e, 'todos', 'vent', true, cmd)}>
              Abrir suspiros
            </button>
            <button className="btn sm" onClick={() => mbtGroup(e, 'todos', 'vent', false, cmd)}>
              Fechar suspiros
            </button>
            <button className="btn sm ok" onClick={() => mbtGroup(e, 'todos', 'blow', true, cmd)}>
              Soprar TLP
            </button>
            <button className="btn sm" onClick={() => mbtGroup(e, 'todos', 'blow', false, cmd)}>
              Fechar sopro
            </button>
          </div>
          <div className="btngroup mt4">
            <button className="btn sm" onClick={() => mbtGroup(e, 'vante', 'vent', true, cmd)}>
              Suspiros vante
            </button>
            <button className="btn sm" onClick={() => mbtGroup(e, 're', 'vent', true, cmd)}>
              Suspiros ré
            </button>
            <button className="btn sm" onClick={() => mbtGroup(e, 'vante', 'blow', true, cmd)}>
              Soprar vante
            </button>
            <button className="btn sm" onClick={() => mbtGroup(e, 're', 'blow', true, cmd)}>
              Soprar ré
            </button>
          </div>
          <div className="subtle mb4 mt8">Compensação · trim · banda (sequências automáticas)</div>
          <div className="btngroup">
            <button className="btn sm" onClick={() => cmd({ type: 'dosing', system: 'compensation', mode: 'admitir', kg: 1000 })}>
              Admitir 1 t
            </button>
            <button className="btn sm" onClick={() => cmd({ type: 'dosing', system: 'compensation', mode: 'esgotar', kg: 1000 })}>
              Esgotar 1 t
            </button>
            <button className="btn sm" onClick={() => cmd({ type: 'dosing', system: 'trim', mode: 'transferir', kg: 1000, dir: 'AtoB' })}>
              Trim 1 t AV→AR
            </button>
            <button className="btn sm" onClick={() => cmd({ type: 'dosing', system: 'trim', mode: 'transferir', kg: 1000, dir: 'BtoA' })}>
              Trim 1 t AR→AV
            </button>
            <button className="btn sm" onClick={() => cmd({ type: 'dosing', system: 'heel', mode: 'transferir', kg: 500, dir: 'AtoB' })}>
              Banda 0,5 t BB→BE
            </button>
            <button className="btn sm" onClick={() => cmd({ type: 'dosing', system: 'heel', mode: 'transferir', kg: 500, dir: 'BtoA' })}>
              Banda 0,5 t BE→BB
            </button>
          </div>
          {(['compensation', 'trim', 'heel'] as const).map((sys) => {
            const d = e.state[sys].dosing;
            if (!d) return null;
            return (
              <div key={sys} className="subtle mt4">
                {sys === 'compensation' ? 'Compensação' : sys === 'trim' ? 'Trim' : 'Banda'}: {d.phase} — {fmt(d.moved, 0)}/{fmt(d.target, 0)} kg {d.message ? `· ${d.message}` : ''}
              </div>
            );
          })}
          <div className="subtle mb4 mt8">Máquinas</div>
          <Telegraph e={e} />
          <div className="subtle mb4 mt8">Manobras automáticas</div>
          <div className="btngroup">
            <button className={`btn sm ${maneuver.active === 'imergir' ? 'on' : ''}`} onClick={() => maneuver.start(runner, 'imergir', 50)}>
              ⬇ Imergir para 50 m
            </button>
            <button className={`btn sm ${maneuver.active === 'emergir' ? 'on' : ''}`} onClick={() => maneuver.start(runner, 'emergir')}>
              ⬆ Emergir
            </button>
            {maneuver.active && (
              <button className="btn sm warn" onClick={() => maneuver.cancel(runner)}>
                Cancelar
              </button>
            )}
          </div>
        </Panel>

        <Panel title="Antes × agora">
          <Compare e={e} />
        </Panel>
      </div>
    </div>
  );
}
