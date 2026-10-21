/**
 * CONFIGURAÇÕES — reúne as opções alteráveis do simulador: sessões salvas,
 * identificação do submarino, gráficos, ambiente, fundo do mar, simulação e
 * parâmetros da embarcação. Cada grupo indica claramente se a mudança é
 * apenas VISUAL, se afeta a SIMULAÇÃO AGORA (comando registrado, sem
 * reiniciar) ou se EXIGE REINICIAR o cenário.
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import { RecordingPanel } from '../components/RecordingPanel';
import { baseConfig, cmd, runner, useSim } from '../store';
import { Panel } from '../components/Panel';
import { useUi } from '../uiContext';
import { storage, downloadText } from '../storage';
import { captureSession, restoreSession, resumeSimulation, sessionFileName, type RestoreReport } from '../session';
import { parseSaveText, saveToText, type SaveFile } from '../../sim/persistence';
import { identity, FIN_COLORS, DEFAULT_IDENTITY } from '../identity';
import { graphics, useGraphics, LIGHTING_LABELS, LIGHTINGS } from '../graphics';
import type { SceneLighting } from '../../render3d/lighting';
import { currentAppearance, useIdentity } from '../appearance';
import { drawSailDecal } from '../../render3d/sailArt';
import { TrimGainSelect } from '../components/TrimGain';
import { WATER_PARAMS, BOTTOM_RELIEF_PARAMS, VESSEL_PARAMS, ParamGrid } from '../settingsParams';
import { defaultSimConfig } from '../../sim/config/defaultVessel';
import type { SimConfig } from '../../sim/config/types';
import { Environment, type EnvironmentConfig } from '../../sim/environment/environment';
import { buildScenario, scenarioById } from '../../sim/scenarios';
import { SEA_STATES } from '../../sim/environment/waves';
import type { EnvironmentPatch } from '../../sim/commands';
import { SIM_VERSION } from '../../sim/version';
import { useScenarioOptions } from './ScenarioScreen';
import { demo } from '../demo';
import { maneuver } from '../maneuvers';
import { tours } from '../tours';
import { toKnots } from '../../sim/units';
import { fmt, fmtTime } from '../format';

// ------------------------------------------------------------ tipo de efeito
type KindId = 'visual' | 'agora' | 'reiniciar';
const KIND: Record<KindId, { label: string; cls: string; title: string }> = {
  visual: { label: 'VISUAL', cls: 'kind-visual', title: 'Só muda a aparência: aplicado na hora, sem nenhum efeito na física.' },
  agora: { label: 'SIMULAÇÃO · AGORA', cls: 'kind-now', title: 'Afeta a física. Aplicado na simulação em curso, sem reiniciar, e registrado no histórico de comandos.' },
  reiniciar: { label: 'SIMULAÇÃO · REINICIAR', cls: 'kind-restart', title: 'Afeta a física. Só vale quando o cenário é reiniciado (o estado atual é descartado).' },
};

export function Kind({ k }: { k: KindId }) {
  return (
    <span className={`kind ${KIND[k].cls}`} title={KIND[k].title}>
      {KIND[k].label}
    </span>
  );
}

const errMsg = (ex: unknown) => (ex instanceof Error ? ex.message : String(ex));

/** Para as automações e reinicia o cenário atual com a configuração dada. */
function restartWith(cfg: SimConfig, load: Parameters<typeof buildScenario>[2]): void {
  demo.stop(runner);
  maneuver.cancel(runner);
  if (tours.active) tours.stop(runner);
  runner.running = false;
  runner.replaceEngine(buildScenario(runner.engine.state.scenarioId, structuredClone(cfg), load));
}

// ------------------------------------------------------------ sessão
function SessionPanel() {
  const e = useSim(2);
  const ui = useUi();
  const [name, setName] = useState('');
  const [last, setLast] = useState<RestoreReport | null>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const fileRef = useRef<HTMLInputElement>(null);
  const saves = storage.listSaves();
  const auto = storage.getAutosave();
  const s = e.state;
  const label = () => name.trim() || `${scenarioById(s.scenarioId).name.split(' — ')[0]} · t = ${fmtTime(s.t)}`;
  const load = (f: SaveFile | unknown) => {
    try {
      const r = restoreSession(f);
      setLast(r);
      ui.toast(`Sessão “${r.name}” carregada e PAUSADA (t = ${fmtTime(r.simTime)}). Use ▶ Retomar para continuar.`);
    } catch (ex) {
      ui.toast('Não foi possível carregar: ' + errMsg(ex));
    }
  };
  return (
    <Panel title="Sessão — salvar e continuar a simulação" className="span-all">
      <div className="sess-now">
        <span className={`badge ${runner.running ? 'ok' : 'warn'}`}>{runner.running ? 'EM EXECUÇÃO' : 'PAUSADA'}</span>
        <span className="mono">
          {scenarioById(s.scenarioId).name} · t = {fmtTime(s.t)} · {fmt(e.outputs.depthKeel, 1)} m · {fmt(toKnots(s.body.vel.x), 1)} nós · {fmt(e.outputs.euler.heading, 0)}° · bateria {fmt(s.electrical.soc * 100, 0)} %
        </span>
      </div>
      <div className="row mt8">
        <input type="text" placeholder="Nome da sessão (opcional)" value={name} onChange={(ev) => setName(ev.target.value)} style={{ flex: '1 1 200px', minWidth: 0 }} />
        <button
          className="btn"
          onClick={() => {
            const ok = storage.addSave(captureSession(label()));
            ui.toast(ok ? 'Sessão salva neste navegador.' : 'Armazenamento do navegador indisponível ou cheio — use “Baixar arquivo”.');
            setName('');
            bump();
          }}
          title="Guarda a condição completa da simulação neste navegador"
        >
          💾 Salvar a simulação atual
        </button>
        <button className="btn" onClick={() => downloadText(sessionFileName(label(), s.t), saveToText(captureSession(label(), true)))} title="Arquivo .json para guardar ou abrir em outro computador">
          ⬇ Baixar arquivo
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()} title="Abre um arquivo de sessão (.json) salvo antes">
          📂 Carregar arquivo
        </button>
        <button className="btn ok" disabled={runner.running} onClick={resumeSimulation} title="Continua a simulação a partir do ponto carregado">
          ▶ Retomar a simulação
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={async (ev) => {
            const f = ev.target.files?.[0];
            ev.target.value = '';
            if (!f) return;
            try {
              load(parseSaveText(await f.text()));
            } catch (ex) {
              ui.toast('Arquivo inválido: ' + errMsg(ex));
            }
          }}
        />
      </div>
      {last && (
        <div className="note">
          Carregado: <b>{last.name}</b> (t = {fmtTime(last.simTime)}){last.migratedFrom ? ` · arquivo do formato ${last.migratedFrom} convertido automaticamente` : ''}
          {last.resumed.length ? ` · retomando: ${last.resumed.join('; ')}` : ' · sem automações em andamento'}. A simulação fica pausada até ▶ Retomar.
        </div>
      )}
      {auto && (
        <div className="row mt8">
          <span className="subtle">
            Salvamento automático (a cada 20 s com a simulação rodando): t = {fmtTime(auto.simTime)} · {new Date(auto.savedAt).toLocaleString('pt-BR')}
          </span>
          <button className="btn sm" onClick={() => load(auto)}>
            Carregar
          </button>
        </div>
      )}
      <table className="t mt8">
        <tbody>
          {saves.length === 0 && (
            <tr>
              <td className="subtle">Nenhuma sessão salva neste navegador.</td>
            </tr>
          )}
          {saves.map((f) => (
            <tr key={f.savedAt}>
              <td>
                <b>{f.name}</b>
                <div className="subtle">
                  {new Date(f.savedAt).toLocaleString('pt-BR')} · {scenarioById(f.scenarioId).name} · t = {fmtTime(f.simTime)}
                  {f.version < 2 ? ' · formato antigo' : ''}
                </div>
              </td>
              <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                <button className="btn sm" onClick={() => load(f)}>
                  Carregar
                </button>{' '}
                <button className="btn sm" onClick={() => downloadText(sessionFileName(f.name, f.simTime), saveToText(f))}>
                  Baixar
                </button>{' '}
                <button
                  className="btn sm danger"
                  onClick={() => {
                    storage.deleteSave(f.savedAt);
                    bump();
                  }}
                >
                  Excluir
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="note">
        O arquivo guarda tudo o que é preciso para continuar: posição, profundidade, rumo, velocidade e inclinação; tempo de simulação; níveis dos tanques; bateria, combustível e ar comprimido; equipamentos, bombas e
        válvulas; telégrafo e lemes; piloto automático e referências; falhas, alarmes e ambiente; e as automações em andamento (manobra rápida, demonstração, roteiro automático, rota). Ao carregar, a simulação fica pausada.
        Pode ser aberto em outro computador com o simulador {SIM_VERSION} ou mais novo (arquivos de versões anteriores também abrem). Os gráficos do Histórico recomeçam a partir do ponto carregado.
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------ identificação
function SailPreview() {
  const ref = useRef<HTMLCanvasElement>(null);
  const id = useIdentity();
  const g = useGraphics();
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    // silhueta da vela sobre o mar
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1b3550';
    ctx.fillRect(0, H * 0.82, W, H * 0.18);
    ctx.fillStyle = '#2b3542';
    ctx.beginPath();
    ctx.moveTo(W * 0.1, H * 0.86);
    ctx.lineTo(W * 0.14, H * 0.12);
    ctx.quadraticCurveTo(W * 0.15, H * 0.06, W * 0.22, H * 0.06);
    ctx.lineTo(W * 0.82, H * 0.06);
    ctx.quadraticCurveTo(W * 0.95, H * 0.08, W * 0.96, H * 0.4);
    ctx.lineTo(W * 0.96, H * 0.86);
    ctx.closePath();
    ctx.fill();
    const dc = document.createElement('canvas');
    dc.width = 1024;
    dc.height = 512;
    drawSailDecal(dc, currentAppearance(), true, bump);
    const w = W * 0.66;
    ctx.drawImage(dc, W * 0.2, H * 0.06, w, w / 2);
    // lemes de vela (abaixo da pintura, como no modelo 3D)
    ctx.fillStyle = id.finColor;
    ctx.fillRect(W * 0.62, H * 0.06 + w / 2 + 4, W * 0.36, H * 0.05);
  });
  void g;
  return <canvas ref={ref} width={520} height={240} className="sail-preview" aria-label="Pré-visualização da vela" />;
}

function IdentityPanel() {
  const id = useIdentity();
  const ui = useUi();
  const fileRef = useRef<HTMLInputElement>(null);
  const onImage = async (f: File) => {
    try {
      let url = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(r.error);
        r.readAsDataURL(f);
      });
      // reduz imagens grandes para no máximo 512 px (PNG)
      if (url.length > 400_000 || !url.startsWith('data:image/svg')) {
        const im = new Image();
        await new Promise((res, rej) => {
          im.onload = res;
          im.onerror = rej;
          im.src = url;
        });
        const k = Math.min(1, 512 / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.naturalWidth * k));
        c.height = Math.max(1, Math.round(im.naturalHeight * k));
        c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
        url = c.toDataURL('image/png');
      }
      identity.set({ emblem: 'personalizado', emblemImage: url });
      ui.toast('Emblema personalizado aplicado na vela.');
    } catch (ex) {
      ui.toast('Imagem não pôde ser lida: ' + errMsg(ex));
    }
  };
  return (
    <Panel title="Identificação do submarino" tag={<Kind k="visual" />}>
      <div className="formgrid">
        <label className="field">
          <span>Nome (painéis, mapa e barra superior)</span>
          <input type="text" value={id.name} maxLength={40} onChange={(ev) => identity.set({ name: ev.target.value || DEFAULT_IDENTITY.name })} />
        </label>
        <label className="field">
          <span>Inscrição vermelha na vela</span>
          <input type="text" value={id.sailText} maxLength={16} onChange={(ev) => identity.set({ sailText: ev.target.value })} />
        </label>
        <label className="field">
          <span>Cor da inscrição</span>
          <span className="row" style={{ gap: 6 }}>
            <input type="color" value={id.sailTextColor} onChange={(ev) => identity.set({ sailTextColor: ev.target.value })} aria-label="Cor da inscrição" />
            <button className="btn sm" onClick={() => identity.set({ sailTextColor: DEFAULT_IDENTITY.sailTextColor })}>
              Vermelho padrão
            </button>
          </span>
        </label>
      </div>
      <div className="row mt8">
        <span className="subtle">Emblema na vela</span>
        <div className="seg">
          <button className={id.emblem === 'vasco' ? 'on' : ''} onClick={() => identity.set({ emblem: 'vasco' })} title="Desenho simplificado inspirado no escudo do Vasco">
            Vasco (estilizado)
          </button>
          <button className={id.emblem === 'personalizado' ? 'on' : ''} onClick={() => (id.emblemImage ? identity.set({ emblem: 'personalizado' }) : fileRef.current?.click())}>
            Imagem própria
          </button>
          <button className={id.emblem === 'nenhum' ? 'on' : ''} onClick={() => identity.set({ emblem: 'nenhum' })}>
            Nenhum
          </button>
        </div>
        <button className="btn sm" onClick={() => fileRef.current?.click()} title="PNG com fundo transparente funciona melhor">
          Escolher imagem…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          style={{ display: 'none' }}
          onChange={(ev) => {
            const f = ev.target.files?.[0];
            ev.target.value = '';
            if (f) void onImage(f);
          }}
        />
      </div>
      <div className="row mt8">
        <span className="subtle">Cor dos lemes</span>
        <div className="swatches">
          {FIN_COLORS.map(([c, l]) => (
            <button key={c} className={`swatch ${id.finColor === c ? 'on' : ''}`} style={{ background: c }} title={l} aria-label={`Lemes: ${l}`} onClick={() => identity.set({ finColor: c })} />
          ))}
        </div>
        <input type="color" value={id.finColor} onChange={(ev) => identity.set({ finColor: ev.target.value })} aria-label="Outra cor dos lemes" />
      </div>
      <SailPreview />
      <div className="row">
        <button className="btn sm" onClick={() => identity.reset()}>
          Restaurar padrão ({DEFAULT_IDENTITY.name})
        </button>
      </div>
      <div className="note">
        Aparece no modelo 3D (vela, lemes), na mesa tática, nos painéis e na segunda janela, e vai junto no arquivo de sessão. Não altera nenhum parâmetro físico do submarino. O emblema “Vasco” é um desenho simplificado;
        para usar o escudo oficial, escolha a imagem (PNG com fundo transparente).
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------ gráficos
const LIGHTING_HINTS: Record<SceneLighting, string> = {
  natural: 'A água escurece com a profundidade, como no mar',
  clara: 'Água mais clara, luz suave junto à câmera e contorno do casco realçado',
  estudio: 'Luz forte junto à câmera — para projetor ou sala clara',
};

function GraphicsPanel() {
  const g = useGraphics();
  return (
    <Panel title="Qualidade gráfica" tag={<Kind k="visual" />}>
      <div className="col">
        <div className="row">
          <span className="subtle" style={{ minWidth: 120 }}>
            Cena e oceano
          </span>
          <div className="seg">
            {(
              [
                ['baixa', 'Baixa'],
                ['media', 'Média'],
                ['alta', 'Alta'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={g.quality === k ? 'on' : ''} onClick={() => graphics.set({ quality: k })}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <span className="subtle" style={{ minWidth: 120 }}>
            Texturas do casco
          </span>
          <div className="seg">
            {(
              [
                ['normal', 'Normal'],
                ['alta', 'Detalhadas'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={g.textures === k ? 'on' : ''} onClick={() => graphics.set({ textures: k })}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="row mt8">
        <span className="subtle" style={{ minWidth: 120 }}>
          Iluminação da cena
        </span>
        <div className="seg">
          {LIGHTINGS.map((k) => (
            <button key={k} className={g.lighting === k ? 'on' : ''} onClick={() => graphics.set({ lighting: k })} title={LIGHTING_HINTS[k]}>
              {LIGHTING_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="row mt8">
        <span className="subtle" style={{ minWidth: 120 }}>
          Ampliação do trim
        </span>
        <TrimGainSelect compact />
      </div>
      <div className="row mt8">
        <span className="subtle" style={{ minWidth: 120 }}>
          Terreno e costa
        </span>
        <div className="seg">
          {(
            [
              ['baixa', 'Leve'],
              ['media', 'Médio'],
              ['alta', 'Detalhado'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={g.coastDetail === k ? 'on' : ''} onClick={() => graphics.set({ coastDetail: k })} title="Resolução do fundo e da terra perto do submarino e alcance da terra ao longe">
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="row mt8">
        <span className="subtle" style={{ minWidth: 120 }}>
          Alcance dos navios
        </span>
        <div className="seg">
          {[5, 12, 20, 30].map((k) => (
            <button key={k} className={g.shipRange === k ? 'on' : ''} onClick={() => graphics.set({ shipRange: k })}>
              {k} km
            </button>
          ))}
        </div>
      </div>
      <div className="note">
        A ampliação do trim multiplica só o ângulo de pitch <b>desenhado</b>, para demonstração (na superfície o trim real é de poucos centímetros). Enquanto ligada, todas as cenas mostram o aviso “TRIM AMPLIADO”; ao recarregar a
        página ela volta para o valor real.
      </div>
      <div className="note">
        Iluminação: <b>Natural</b> escurece a água com a profundidade, como no mar (o casco escuro some no fundo escuro); <b>Clara</b> (padrão) clareia a água, acende uma luz suave junto à câmera e realça o contorno do
        casco; <b>Estúdio</b> usa luz forte, para projetor ou sala clara. Também pode ser trocada no seletor “Luz” das cenas 3D.
      </div>
      <div className="note">
        Qualidade baixa: menos vértices no oceano, menos partículas e texturas menores — recomendada em notebooks sem placa de vídeo e em celulares. Vale para todas as abas e para a segunda janela.
      </div>
    </Panel>
  );
}

function MarineLifePanel() {
  const g = useGraphics();
  const disabled = g.fishDensity === 'desligada';
  return (
    <Panel title="Vida marinha" tag={<Kind k="visual" />}>
      <label className="field">
        <span>Quantidade de peixes</span>
        <select value={g.fishDensity} onChange={(ev) => graphics.set({ fishDensity: ev.target.value as typeof g.fishDensity })}>
          <option value="desligada">Desligada</option>
          <option value="discreta">Discreta (padrão)</option>
          <option value="moderada">Moderada</option>
        </select>
      </label>
      <div className="col mt8">
        <label className="row">
          <input type="checkbox" checked={g.fishJumps} disabled={disabled} onChange={(ev) => graphics.set({ fishJumps: ev.target.checked })} />
          Saltos ocasionais na superfície
        </label>
        <label className="row">
          <input type="checkbox" checked={g.fishUnderwater} disabled={disabled} onChange={(ev) => graphics.set({ fishUnderwater: ev.target.checked })} />
          Peixes nadando na água e perto do fundo
        </label>
      </div>
      <div className="note">
        Poucos peixes, com tamanhos, cores e trajetórias variados. Os saltos aparecem em locais e intervalos aleatórios; pode levar um tempo até ver um.
        As preferências ficam salvas e valem também para a segunda janela. A animação acompanha a pausa e a velocidade da simulação.
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------ ambiente (aplicável agora)
function useDraftEnv(): [EnvironmentConfig, () => void, (fn: (c: EnvironmentConfig) => void) => void] {
  const e = useSim(2);
  const [draft, setDraft] = useState<EnvironmentConfig>(() => structuredClone(e.config.environment));
  // novo motor (cenário carregado): volta a mostrar os valores dele
  useEffect(() => setDraft(structuredClone(e.config.environment)), [e]);
  return [draft, () => setDraft(structuredClone(runner.engine.config.environment)), (fn) => setDraft((d) => (fn(d), { ...d }))];
}

function patchOf(d: EnvironmentConfig, withBottom: boolean, withWater: boolean): EnvironmentPatch {
  const p: EnvironmentPatch = {};
  if (withWater) for (const k of ['salinity', 'deepSalinity', 'surfaceTemperature', 'deepTemperature', 'thermoclineDepth', 'thermoclineThickness', 'magneticDeclination'] as const) p[k] = d[k];
  if (withBottom) {
    p.bottom = { ...d.bottom };
    if (d.geo) p.geo = { coast: d.geo.coast, shelfWidth: d.geo.shelfWidth };
  }
  return p;
}

/** guarda partes do ambiente como padrão para os próximos cenários */
function saveEnvDefault(d: EnvironmentConfig, part: 'agua' | 'fundo'): void {
  const base = baseConfig();
  if (part === 'fundo') {
    base.environment.bottom = structuredClone(d.bottom);
    if (d.geo && base.environment.geo) base.environment.geo = { ...base.environment.geo, coast: d.geo.coast, shelfWidth: d.geo.shelfWidth };
  }
  else for (const k of ['salinity', 'deepSalinity', 'surfaceTemperature', 'deepTemperature', 'thermoclineDepth', 'thermoclineThickness', 'magneticDeclination'] as const) base.environment[k] = d[k];
  storage.setConfig(base);
}

function EnvironmentPanel() {
  const e = useSim(2);
  const ui = useUi();
  const [draft, reset, edit] = useDraftEnv();
  const cfgWrap = { environment: draft } as unknown as SimConfig;
  const changed = WATER_PARAMS.some((p) => p.get(cfgWrap) !== p.get(e.config));
  const ss = Math.round(e.env.cfg.waves?.seaState ?? 0);
  const dir = e.env.cfg.waves?.direction ?? 60;
  return (
    <Panel title="Ambiente" tag={<Kind k="agora" />}>
      <div className="row">
        <span className="subtle">Estado do mar</span>
        <select value={ss} onChange={(ev) => cmd({ type: 'seaState', value: Number(ev.target.value) })} aria-label="Estado do mar">
          {SEA_STATES.map((x, i) => (
            <option key={i} value={i}>
              {x.label}
            </option>
          ))}
        </select>
        <label className="row" style={{ gap: 4 }}>
          <span className="subtle">ondas para</span>
          <input
            type="number"
            step={10}
            min={0}
            max={359}
            value={dir}
            style={{ width: 70 }}
            onChange={(ev) => Number.isFinite(Number(ev.target.value)) && cmd({ type: 'seaState', value: ss, direction: ((Number(ev.target.value) % 360) + 360) % 360 })}
          />
          °
        </label>
        <span className="subtle">aplicado na hora</span>
      </div>
      <div className="mt8">
        <ParamGrid params={WATER_PARAMS} cfg={cfgWrap} onChange={() => edit(() => undefined)} />
      </div>
      <div className="row mt8">
        <button
          className={`btn ${changed ? 'ok' : ''}`}
          disabled={!changed}
          onClick={() => {
            cmd({ type: 'environment', patch: patchOf(draft, false, true) });
            ui.toast('Água do mar alterada na simulação em curso (estado mantido).');
          }}
        >
          Aplicar agora (mantém o estado)
        </button>
        <button
          className="btn"
          onClick={() => {
            saveEnvDefault(draft, 'agua');
            ui.toast('Valores guardados para os próximos cenários.');
          }}
        >
          Usar nos próximos cenários
        </button>
        <button className="btn sm" disabled={!changed} onClick={reset}>
          Desfazer
        </button>
        {changed && <span className="badge warn">alterações ainda não aplicadas</span>}
      </div>
      <div className="note">
        Densidade pela EOS-80 a partir de salinidade, temperatura e pressão; a termoclina cria camadas de densidade que mudam o empuxo. Os cenários que definem o próprio ambiente (ex.: Termoclina, Mar grosso) mantêm seus
        valores.
      </div>
    </Panel>
  );
}

function BottomPanel() {
  const e = useSim(2);
  const ui = useUi();
  const [draft, reset, edit] = useDraftEnv();
  const b = draft.bottom;
  const cur = e.config.environment.bottom;
  const geo = draft.geo;
  const curGeo = e.config.environment.geo;
  const changed = JSON.stringify({ ...b }) !== JSON.stringify({ ...cur }) || (!!geo && !!curGeo && (geo.coast !== curGeo.coast || geo.shelfWidth !== curGeo.shelfWidth));
  const coastDist = e.env.coastDistanceAt(e.state.body.pos.x, e.state.body.pos.y);
  const cfgWrap = { environment: draft } as unknown as SimConfig;
  const p = e.state.body.pos;
  const apply = () => {
    const env = new Environment(structuredClone(draft));
    const bNew = env.bottomDepthAt(p.x, p.y);
    const hullBottom = Math.max(e.outputs.depthKeel, p.z + e.vessel.hull.diameter / 2);
    if (bNew < hullBottom + 2) {
      ui.toast(`Não aplicado: o fundo ficaria a ${fmt(bNew, 0)} m, acima ou rente ao casco (quilha a ${fmt(hullBottom, 1)} m). Suba antes ou escolha um fundo mais profundo.`);
      return;
    }
    cmd({ type: 'environment', patch: patchOf(draft, true, false) });
    ui.toast(`Fundo alterado na simulação em curso: ${fmt(bNew, 0)} m sob o submarino.`);
  };
  return (
    <Panel title="Fundo do mar" tag={<Kind k="agora" />}>
      <div className="row">
        <div className="seg">
          <button className={b.mode === 'uniforme' ? 'on' : ''} onClick={() => edit((d) => (d.bottom.mode = 'uniforme'))}>
            Uniforme
          </button>
          <button className={b.mode !== 'uniforme' ? 'on' : ''} onClick={() => edit((d) => (d.bottom.mode = 'relevo'))}>
            Com relevo
          </button>
        </div>
        <label className="row" style={{ gap: 4 }}>
          <span className="subtle">{b.mode === 'uniforme' ? 'Profundidade' : 'Profundidade na origem'}</span>
          <input
            type="number"
            step={10}
            min={20}
            max={2900}
            value={b.baseDepth}
            style={{ width: 80 }}
            onChange={(ev) => {
              const v = Number(ev.target.value);
              if (Number.isFinite(v)) edit((d) => (d.bottom.baseDepth = Math.max(20, Math.min(2900, v))));
            }}
          />
          m
        </label>
      </div>
      {b.mode !== 'uniforme' && (
        <div className="mt8">
          <ParamGrid params={BOTTOM_RELIEF_PARAMS} cfg={cfgWrap} onChange={() => edit(() => undefined)} />
        </div>
      )}
      {geo ? (
        <div className="row mt8">
          <span className="subtle">Costa (Sepetiba)</span>
          <div className="seg">
            <button className={!geo.coast ? 'on' : ''} onClick={() => edit((d) => d.geo && (d.geo.coast = false))}>
              Desligada
            </button>
            <button className={geo.coast ? 'on' : ''} onClick={() => edit((d) => d.geo && (d.geo.coast = true))} title="Terra, orla e fundo costeiro passam a valer na física e no 3D">
              Ligada
            </button>
          </div>
          {geo.coast && (
            <label className="row" style={{ gap: 4 }}>
              <span className="subtle">faixa costeira</span>
              <input
                type="number"
                step={250}
                min={100}
                max={10000}
                value={geo.shelfWidth}
                style={{ width: 80 }}
                onChange={(ev) => {
                  const v = Number(ev.target.value);
                  if (Number.isFinite(v)) edit((d) => d.geo && (d.geo.shelfWidth = Math.max(100, Math.min(10000, v))));
                }}
              />
              m
            </label>
          )}
          <span className="subtle">
            posição {geo.origin.lat.toFixed(4)}°, {geo.origin.lon.toFixed(4)}° (definida no Mapa tático)
            {coastDist !== null ? ` · orla a ${fmt(Math.abs(coastDist), 0)} m${coastDist < 0 ? ' (em terra!)' : ''}` : ''}
          </span>
        </div>
      ) : (
        <div className="subtle mt8">Esta simulação veio de um arquivo antigo, sem referência geográfica: a costa não se aplica.</div>
      )}
      <div className="subtle mt8">
        Agora: fundo {cur.mode === 'uniforme' ? 'uniforme' : 'com relevo'} · <b className="mono">{fmt(e.outputs.bottomDepth, 0)} m</b> sob o submarino · altitude <b className="mono">{fmt(e.outputs.altitude, 0)} m</b> ·
        ecobatímetro <b className="mono">{fmt(e.state.sensors.ECO.value, 0)} m</b>
      </div>
      <div className="row mt8">
        <button className={`btn ${changed ? 'ok' : ''}`} disabled={!changed} onClick={apply}>
          Aplicar agora (mantém o estado)
        </button>
        <button
          className="btn"
          onClick={() => {
            saveEnvDefault(draft, 'fundo');
            ui.toast('Fundo guardado para os próximos cenários.');
          }}
        >
          Usar nos próximos cenários
        </button>
        <button className="btn sm" disabled={!changed} onClick={reset}>
          Desfazer
        </button>
        {changed && <span className="badge warn">alterações ainda não aplicadas</span>}
      </div>
      <div className="note">
        O mesmo fundo é usado pela física (contato com o casco), pelo ecobatímetro, pelos alarmes de altitude e pelo desenho 3D. Padrão de sessões novas: uniforme a 300 m. O cenário “Águas rasas” e os arquivos salvos
        antigos mantêm o fundo com relevo que tinham. <b>Costa ligada</b>: a terra, a orla e as ilhas da região de Sepetiba (dados embutidos, sem internet) entram na física — na faixa costeira o fundo sobe suavemente até
        zero na orla (contato = encalhe) — e aparecem no 3D. Vem ligada nos cenários costeiros (Saída da base, Restinga) e desligada nos demais, que foram feitos para mar aberto. O cais é só visual.
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------ simulação e embarcação (exigem reiniciar)
function useBaseDraft(): [SimConfig, boolean, () => void, (d?: SimConfig) => void] {
  const [draft, setDraft] = useState<SimConfig>(() => structuredClone(baseConfig()));
  const [dirty, setDirty] = useState(false);
  return [draft, dirty, () => setDirty(true), (d) => (setDraft(structuredClone(d ?? baseConfig())), setDirty(false))];
}

function RestartPanels() {
  const e = useSim(2);
  const ui = useUi();
  const opts = useScenarioOptions();
  const [draft, dirty, touch, resetDraft] = useBaseDraft();
  const saveAndRestart = () => {
    const base = baseConfig();
    base.vessel = structuredClone(draft.vessel);
    base.settings = structuredClone(draft.settings);
    storage.setConfig(base);
    restartWith(base, { load: opts.load, precompensated: opts.pre });
    resetDraft(base);
    ui.toast('Parâmetros salvos e cenário reiniciado (pausado).');
  };
  const pending = dirty && (
    <div className="row mt8">
      <span className="badge alarm">Alterações pendentes: valem ao reiniciar o cenário</span>
      <button className="btn ok" onClick={saveAndRestart}>
        Salvar e reiniciar o cenário
      </button>
      <button className="btn sm" onClick={() => resetDraft()}>
        Descartar
      </button>
    </div>
  );
  return (
    <>
      <Panel title="Simulação" tag={<Kind k="reiniciar" />}>
        <div className="formgrid">
          <label className="field">
            <span>Passo fixo de integração</span>
            <select
              value={draft.settings.dt}
              onChange={(ev) => {
                draft.settings.dt = Number(ev.target.value);
                touch();
              }}
            >
              <option value={0.01}>0,01 s (100 Hz)</option>
              <option value={0.02}>0,02 s (50 Hz) — padrão</option>
              <option value={0.05}>0,05 s (20 Hz)</option>
            </select>
          </label>
          <label className="field">
            <span>Semente do ruído</span>
            <input
              type="number"
              value={draft.settings.seed}
              onChange={(ev) => {
                draft.settings.seed = Number(ev.target.value) | 0;
                touch();
              }}
            />
          </label>
          <label className="chk">
            <input
              type="checkbox"
              checked={draft.settings.advancedInstrumentation}
              onChange={(ev) => {
                draft.settings.advancedInstrumentation = ev.target.checked;
                touch();
              }}
            />
            Instrumentação avançada (ruído/atraso)
          </label>
        </div>
        <div className="note">
          Em uso: dt = {e.config.settings.dt} s · semente {e.config.settings.seed} · instrumentação {e.config.settings.advancedInstrumentation ? 'avançada' : 'ideal'}. Condição de carga dos cenários: aba Cenários.
        </div>
        {pending}
      </Panel>
      <Panel title="Parâmetros fictícios da embarcação" tag={<Kind k="reiniciar" />} className="span-all">
        <ParamGrid params={VESSEL_PARAMS} cfg={draft} onChange={touch} />
        {pending}
        <div className="row mt8">
          <button className="btn" disabled={!dirty} onClick={saveAndRestart}>
            Salvar como padrão e reiniciar o cenário
          </button>
          <button
            className="btn warn"
            onClick={() => {
              const def = defaultSimConfig();
              const base = baseConfig();
              base.vessel = def.vessel;
              base.settings = def.settings;
              resetDraft(base);
              touch();
              ui.toast('Valores padrão carregados — clique em “Salvar e reiniciar” para usar.');
            }}
          >
            Restaurar padrões
          </button>
        </div>
        <div className="note">O peso leve e seu CG são recalculados automaticamente para manter a condição de projeto (neutro, trim nulo, BG especificado). Todos os valores são fictícios.</div>
      </Panel>
    </>
  );
}

// ------------------------------------------------------------ tela
export function SettingsScreen() {
  return (
    <div className="settings">
      <div className="settings-legend">
        <b>Tipos de alteração:</b> <Kind k="visual" /> só aparência, sem efeito na física · <Kind k="agora" /> muda a física da simulação em curso, sem reiniciar · <Kind k="reiniciar" /> vale ao reiniciar o cenário
      </div>
      <div className="grid g2">
        <SessionPanel />
        <RecordingPanel />
        <IdentityPanel />
        <GraphicsPanel />
        <MarineLifePanel />
        <EnvironmentPanel />
        <BottomPanel />
        <RestartPanels />
      </div>
    </div>
  );
}
