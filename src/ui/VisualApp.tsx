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
import { fullExternalLayers, type SceneLayers } from '../render3d/layers';
import type { LayerKey } from './components/LayerPanel';
import { SceneLayerPanel } from './components/SceneLayerPanel';
import { OverlayMenu, viewSection, type ViewOption } from './components/OverlayMenu';
import type { ViewMode } from '../render3d/SubmarineScene';
import { usePersisted } from './persist';
import { verticalBalance, toTf } from '../sim/forceVectors';
import { fmt } from './format';
import { identity } from './identity';
import { PresCardView, PresHudView, hudSide } from './components/PresCard';

/** camadas desta janela (o casco tem botão próprio) */
const LAYER_KEYS: LayerKey[] = [
  'sonarRays',
  'sonarWave',
  'sonarThermocline',
  'sonarProfile',
  'sonarCoverage',
  'sonarHeatmap',
  'sonarSurface',
  'sonarBottom',
  'sonarEchoes',
  'sonarBearings',
  'sonarRulers',
  'vectors',
  'hydroVectors',
  'trimVectors',
  'tanks',
  'pipes',
  'flows',
  'halfCut',
  'batteryInfo',
  'airInfo',
  'wake',
  'wind',
  'pennant',
  'flag',
  'ships',
  'torpedoes',
  'markers',
  'trail',
  'labels',
  'trimRef',
  'pitchAngle',
  'depthLines',
  'noWater',
  'presLight',
];

const VIEWS: ViewOption<ViewMode | 'seguir'>[] = [
  { id: 'seguir', label: 'Igual ao controle', tip: 'Segue a vista da janela de controle' },
  { id: 'piloto', label: 'Lateral' },
  { id: 'perseguicao', label: 'Perseguição' },
  { id: 'cinematografica', label: 'Cinematográfica' },
  { id: 'perspectiva', label: 'Perspectiva' },
  { id: 'superficie', label: 'Superfície' },
  { id: 'submerso', label: 'Submerso' },
  { id: 'tanques', label: 'Vista tanques' },
  { id: 'forcas', label: 'Vista forças' },
  { id: 'calado', label: 'Calado' },
  { id: 'navio', label: 'Navio próximo' },
  { id: 'torpedo', label: 'Torpedo (acompanhar)' },
  { id: 'alvo', label: 'Alvo (submarino inimigo)' },
  { id: 'fixa', label: 'Fixa' },
  { id: 'passadico', label: 'Passadiço' },
  { id: 'drone', label: 'Drone (câmera livre)' },
  { id: 'livre', label: 'Livre' },
];

export function VisualApp() {
  const e = useSim(6);
  const v = link.viewer;
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => v?.subscribe(force), []);
  const [mode, setMode] = usePersisted<ViewMode | 'seguir'>('visual.view', 'seguir');
  const [hideUi, setHideUi] = useState(false);
  // apresentação do Estúdio: esta janela (projetor) segue a câmera e as camadas de cada etapa
  const [followPres, setFollowPres] = usePersisted('visual.followPres', true);
  const presOv = v?.overlay.pres ?? null;
  const presDrive = !!presOv && followPres;
  const view: ViewMode = presDrive || mode === 'seguir' ? (v?.view ?? 'piloto') : mode;
  // camadas: "3D completo" (padrão) ou as da janela de controle, com as alterações feitas aqui por cima
  const [src, setSrc] = usePersisted<'completo' | 'controle'>('visual.layerSrc', 'completo');
  const [over, setOver] = usePersisted<Partial<SceneLayers>>('visual.layers', {});
  const base = (presDrive || src === 'controle') && v?.layers ? v.layers : fullExternalLayers();
  const layers: SceneLayers = presDrive && v?.layers ? v.layers : { ...base, ...over };
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
      <Scene3D
        quality={defaultQuality()}
        view={view}
        layers={layers}
        labels={false}
        persistKey="visual"
        onPick={(p) => p && v?.pick(p)}
        bridge={(presDrive || mode === 'seguir') && view === 'passadico' ? (v?.bridge ?? undefined) : undefined}
        drone={(presDrive || mode === 'seguir') && view === 'drone' ? (v?.drone ?? undefined) : undefined}
        camPose={presDrive ? presOv?.cam : null}
      >
        {!hideUi && (
          <div className="visual-status">
            <span className={`badge ${connected ? 'ok' : 'warn'}`}>{connected ? 'Espelhando a janela de controle' : 'Sem conexão'}</span>
            {ov?.alarm && <span className={`badge ${ov.alarm.priority <= 2 ? 'alarm blink' : 'warn'}`}>{ov.alarm.text}</span>}
            {ov?.rec && <span className="badge info">{ov.rec}</span>}
            {presOv && (
              <button className={`badge ${followPres ? 'ok' : 'off'} st-follow`} onClick={() => setFollowPres(!followPres)} title="Seguir a câmera e as camadas de cada etapa da apresentação (clique para alternar)">
                {followPres ? '● Seguindo a apresentação' : '○ Câmera desta janela'}
              </button>
            )}
            {(layers.vectors || layers.hydroVectors) && (
              <span className="badge info">
                E {fmt(toTf(vb.buoyancyN, vb.g), 1)} tf · P {fmt(toTf(vb.weightN, vb.g), 1)} tf · E − P {fmt(toTf(vb.netN, vb.g), 2)} tf
              </span>
            )}
          </div>
        )}
        <div className="visual-ctl">
          {!hideUi && (
            <OverlayMenu
              persistKey="visual"
              sections={[
                viewSection(VIEWS, mode, pickView),
                {
                  id: 'camadas',
                  label: <>Camadas ({LAYER_KEYS.filter((k) => !!layers[k]).length})</>,
                  title: 'Ligar/desligar camadas nesta janela, por grupo',
                  className: 'scene-layer-pop visual-laypop',
                  content: (
                    <>
                      <div className="btngroup visual-layers">
                        <span className="seg" title="De onde vêm as camadas desta janela">
                          <button
                            className={src === 'completo' ? 'on' : ''}
                            onClick={() => setSrc('completo')}
                            title="Vetores, esteira e bolhas, vento, navios, boias, trajetória e rótulos — igual em qualquer aba da janela de controle"
                          >
                            3D completo
                          </button>
                          <button className={src === 'controle' ? 'on' : ''} onClick={() => setSrc('controle')} title="As camadas da última cena 3D aberta na janela de controle">
                            Camadas do controle
                          </button>
                        </span>
                        <button className="btn sm" disabled={Object.keys(over).length === 0} onClick={() => setOver({})} title="Desfaz as alterações feitas nesta janela">
                          ↺ Desfazer ajustes
                        </button>
                      </div>
                      <SceneLayerPanel e={e} hullControl keys={LAYER_KEYS} value={layers} onChange={(p) => setOver({ ...over, ...p })} marked={(k) => k in over} />
                    </>
                  ),
                },
              ]}
            />
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
        {presOv && (
          <>
            <PresHudView items={presOv.hud} side={hudSide(presOv.card)} />
            <PresCardView c={presOv.card} />
          </>
        )}
        {!presOv && (ov?.tour || ov?.maneuver) && (
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
