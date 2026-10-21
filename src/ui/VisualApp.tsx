/**
 * JANELA DE VISUALIZAÇÃO (segundo monitor): só a cena, os indicadores e a
 * narração. Não roda física — espelha a janela de controle pelo
 * BroadcastChannel. Cliques em objetos abrem os controles na outra janela.
 */
import { useEffect, useReducer, useState } from 'react';
import { runner, useSim } from './store';
import { Scene3D, defaultQuality } from './components/Scene3D';
import { OpsStrip } from './ops/OpsStrip';
import { link } from './link';
import { allLayersOff, allLayersOn, defaultLayers, type SceneLayers } from '../render3d/layers';
import type { LayerKey } from './components/LayerPanel';
import type { ViewMode } from '../render3d/SubmarineScene';
import { usePersisted } from './persist';
import { verticalBalance, toTf } from '../sim/forceVectors';
import { fmt } from './format';
import { identity } from './identity';

/** camadas que podem ser ligadas/desligadas nesta janela (independentes da janela de controle) */
const LAYER_BTNS: [keyof SceneLayers, string][] = [
  ['tanks', 'Tanques'],
  ['vectors', 'Peso/empuxo'],
  ['hydroVectors', 'Hélice/lemes'],
  ['trimVectors', 'Vetores de trim'],
  ['flows', 'Escoamentos'],
  ['pipes', 'Tubulações'],
  ['labels', 'Identificações'],
  ['batteryInfo', 'Bateria (%)'],
  ['airInfo', 'Ar comprimido'],
  ['markers', 'Boias'],
  ['wake', 'Esteira'],
  ['noWater', 'Sem água'],
  ['trimRef', 'Calado/trim'],
  ['ships', 'Navios'],
  ['hull', 'Casco'],
];
/** “Marcar/Desmarcar todas”: as camadas de informação (o casco fica fora: é o próprio submarino) */
const ALL_KEYS = LAYER_BTNS.map(([k]) => k).filter((k): k is LayerKey => k !== 'hull');

const VIEWS: [ViewMode | 'seguir', string][] = [
  ['seguir', 'Igual ao controle'],
  ['piloto', 'Lateral'],
  ['perseguicao', 'Perseguição'],
  ['superficie', 'Superfície'],
  ['submerso', 'Submerso'],
  ['tanques', 'Vista tanques'],
  ['forcas', 'Vista forças'],
  ['calado', 'Calado'],
  ['navio', 'Navio próximo'],
  ['fixa', 'Fixa'],
  ['livre', 'Livre'],
];

export function VisualApp() {
  const e = useSim(6);
  const v = link.viewer;
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => v?.subscribe(force), []);
  const [mode, setMode] = usePersisted<ViewMode | 'seguir'>('visual.view', 'seguir');
  const [hideUi, setHideUi] = useState(false);
  const view: ViewMode = mode === 'seguir' ? (v?.view ?? 'piloto') : mode;
  // camadas: as da janela de controle, com as alterações feitas aqui por cima
  const [over, setOver] = usePersisted<Partial<SceneLayers>>('visual.layers', {});
  const base = v?.layers ?? { ...defaultLayers(), tanks: false };
  const layers: SceneLayers = { ...base, ...over };
  const toggle = (k: keyof SceneLayers) => setOver({ ...over, [k]: !layers[k] });
  const pickView = (k: ViewMode | 'seguir') => {
    setMode(k);
    if (k === 'tanques') setOver({ ...over, tanks: true });
    if (k === 'forcas') setOver({ ...over, vectors: true });
    if (k === 'calado') setOver({ ...over, trimRef: true });
  };
  const ov = v?.overlay;
  const vb = verticalBalance(e);
  const connected = !!v?.connected;
  useEffect(() => {
    document.title = `${identity.get().name} — visualização`;
  }, []);
  return (
    <div className="visual-app">
      <Scene3D quality={defaultQuality()} view={view} layers={layers} labels={false} persistKey="visual" onPick={(p) => p && v?.pick(p)}>
        {!hideUi && (
          <div className="visual-status">
            <span className={`badge ${connected ? 'ok' : 'warn'}`}>{connected ? 'Espelhando a janela de controle' : 'Sem conexão'}</span>
            {ov?.alarm && <span className={`badge ${ov.alarm.priority <= 2 ? 'alarm blink' : 'warn'}`}>{ov.alarm.text}</span>}
            {ov?.rec && <span className="badge info">{ov.rec}</span>}
            {(layers.vectors || layers.hydroVectors) && (
              <span className="badge info">
                E {fmt(toTf(vb.buoyancyN, vb.g), 1)} tf · P {fmt(toTf(vb.weightN, vb.g), 1)} tf · E − P {fmt(toTf(vb.netN, vb.g), 2)} tf
              </span>
            )}
          </div>
        )}
        <div className="visual-ctl">
          {!hideUi && (
            <div className="seg">
              {VIEWS.map(([k, l]) => (
                <button key={k} className={mode === k ? 'on' : ''} onClick={() => pickView(k)}>
                  {l}
                </button>
              ))}
            </div>
          )}
          {!hideUi && (
            <div className="btngroup visual-layers">
              {LAYER_BTNS.map(([k, l]) => (
                <button key={k} className={`btn sm ${layers[k] ? 'on' : ''}`} onClick={() => toggle(k)} title={k in over ? 'Alterado nesta janela' : 'Igual à janela de controle'}>
                  {layers[k] ? '☑' : '☐'} {l}
                  {k in over ? ' •' : ''}
                </button>
              ))}
              <button className="btn sm" onClick={() => setOver({ ...over, ...allLayersOn(ALL_KEYS) })} title="Liga todas as camadas de informação nesta janela">
                ☑ Todas
              </button>
              <button className="btn sm" onClick={() => setOver({ ...over, ...allLayersOff(ALL_KEYS) })} title="Desliga todas as camadas nesta janela">
                ☐ Nenhuma
              </button>
              <button className="btn sm" disabled={Object.keys(over).length === 0} onClick={() => setOver({})} title="Volta a usar as camadas da janela de controle">
                ↺ Igual ao controle
              </button>
            </div>
          )}
          <div className="btngroup">
            {!hideUi && (
              <button className="btn sm" onClick={() => v?.toggleRun()}>
                {runner.running ? '❚❚ Pausar' : '▶ Executar'}
              </button>
            )}
            <button className="btn sm" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)}>
              ⛶ Tela cheia
            </button>
            <button className="btn sm" onClick={() => setHideUi(!hideUi)}>
              {hideUi ? 'Mostrar botões' : 'Ocultar botões'}
            </button>
          </div>
        </div>
        {(ov?.tour || ov?.maneuver) && (
          <div className="pres-bottom" style={{ justifyContent: 'flex-start' }}>
            <div className="tourcard">
              {ov.tour ? (
                <>
                  <div className="tc-head">
                    <span className="tc-n">
                      {ov.tour.k + 1}/{ov.tour.n}
                    </span>
                    <b>{ov.tour.title}</b>
                  </div>
                  <div className="tc-text">{ov.tour.text}</div>
                  {ov.tour.why && <div className="tc-why">Por quê: {ov.tour.why}</div>}
                  <div className="tc-status">{ov.tour.met ? <span className="ok">✓ próxima etapa em {Math.ceil(ov.tour.remaining)} s</span> : <span className="wait">⟳ aguardando: {ov.tour.waitFor}</span>}</div>
                </>
              ) : (
                <div className="tc-text">⟳ {ov.maneuver}</div>
              )}
            </div>
          </div>
        )}
        {!connected && (
          <div className="visual-wait">
            <b>Aguardando a janela de controle…</b>
            <span>Esta janela mostra a mesma simulação da janela principal do simulador (aberta no mesmo navegador). Abra o simulador e use “⧉ Visual em outra janela”, ou deixe as duas abertas.</span>
            {!v?.available && <span className="badge alarm">Este navegador não permite comunicação entre janelas (BroadcastChannel).</span>}
          </div>
        )}
      </Scene3D>
      <OpsStrip e={e} />
    </div>
  );
}
