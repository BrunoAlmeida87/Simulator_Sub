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
import { defaultLayers } from '../render3d/layers';
import type { ViewMode } from '../render3d/SubmarineScene';
import { usePersisted } from './persist';
import { verticalBalance, toTf } from '../sim/forceVectors';
import { fmt } from './format';

const VIEWS: [ViewMode | 'seguir', string][] = [
  ['seguir', 'Igual ao controle'],
  ['piloto', 'Lateral'],
  ['perseguicao', 'Perseguição'],
  ['superficie', 'Superfície'],
  ['submerso', 'Submerso'],
  ['tanques', 'Tanques'],
  ['forcas', 'Forças'],
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
  const layers = v?.layers ?? { ...defaultLayers(), tanks: false };
  const ov = v?.overlay;
  const vb = verticalBalance(e);
  const connected = !!v?.connected;
  useEffect(() => {
    document.title = 'SX-1 — visualização';
  }, []);
  return (
    <div className="visual-app">
      <Scene3D quality={defaultQuality()} view={view} layers={layers} labels={false} persistKey="visual" onPick={(p) => p && v?.pick(p)}>
        {!hideUi && (
          <div className="visual-status">
            <span className={`badge ${connected ? 'ok' : 'warn'}`}>{connected ? 'Espelhando a janela de controle' : 'Sem conexão'}</span>
            {ov?.alarm && <span className={`badge ${ov.alarm.priority <= 2 ? 'alarm blink' : 'warn'}`}>{ov.alarm.text}</span>}
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
                <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>
                  {l}
                </button>
              ))}
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
