/**
 * Filtros "Mar e gráfico" (estado do mar — física e visual —, qualidade
 * gráfica e iluminação) e "Sol e luzes" (só visual) das cenas 3D, como
 * seções recolhíveis do OverlayMenu.
 */
import { cmd, useSim } from '../store';
import { LightPanel, hhmm } from './LightPanel';
import { SEA_STATES } from '../../sim/environment/waves';
import type { OceanQuality } from '../../render3d/Ocean';
import type { SceneLighting } from '../../render3d/lighting';
import { graphics, useGraphics, LIGHTING_LABELS, LIGHTINGS } from '../graphics';
import type { OverlaySection } from './OverlayMenu';
import { DEEP_FOVS, DEEP_LABELS, type DeepLevel } from '../../render3d/deepPerspective';
import { RENDER_SCALE_LABELS, RENDER_SCALE_OPTIONS, parseRenderScale } from '../../render3d/renderPerf';

/** botão do filtro: "Mar 3 · Hs 1.0 m" */
function SeaLabel() {
  const e = useSim(4);
  const ss = Math.round(e.env.cfg.waves?.seaState ?? 0);
  return (
    <>
      Mar {ss} · Hs {e.env.waves.hs.toFixed(1)} m
    </>
  );
}

function SeaPanel({ quality, setQuality }: { quality: OceanQuality; setQuality: (q: OceanQuality) => void }) {
  const e = useSim(4);
  const g = useGraphics();
  const ss = Math.round(e.env.cfg.waves?.seaState ?? 0);
  return (
    <div className="ovl-form">
      <label title="Estado do mar: muda as ondas da física e da cena">
        <span>Mar</span>
        <select value={ss} onChange={(ev) => cmd({ type: 'seaState', value: Number(ev.target.value) })} aria-label="Estado do mar">
          {SEA_STATES.map((s, i) => (
            <option key={i} value={i}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label title="Qualidade gráfica da cena (só visual)">
        <span>Gráfico</span>
        <select value={quality} onChange={(ev) => setQuality(ev.target.value as OceanQuality)} aria-label="Qualidade gráfica">
          <option value="baixa">Baixo</option>
          <option value="media">Médio</option>
          <option value="alta">Alto</option>
        </select>
      </label>
      <label title="Resolução da imagem (só visual): menos pixels = mais quadros por segundo em computadores e celulares mais fracos. Automática reduz quando a cena fica lenta e volta quando sobra folga.">
        <span>Resolução</span>
        <select
          value={String(g.renderScale)}
          onChange={(ev) => graphics.set({ renderScale: parseRenderScale(ev.target.value === 'auto' ? 'auto' : Number(ev.target.value), g.renderScale) })}
          aria-label="Resolução da imagem"
        >
          {RENDER_SCALE_OPTIONS.map((k) => (
            <option key={k} value={String(k)}>
              {RENDER_SCALE_LABELS[String(k)]}
            </option>
          ))}
        </select>
      </label>
      <label title="Mostra FPS, tempo de quadro, resolução desenhada, chamadas de desenho e memória de GPU sobre a cena" style={{ flexDirection: 'row', gap: 6 }}>
        <input type="checkbox" checked={g.fpsMeter} onChange={(ev) => graphics.set({ fpsMeter: ev.target.checked })} aria-label="Medidor de FPS" />
        <span>Medidor de FPS</span>
      </label>
      <label title="Perspectiva profunda (botão “Perspectiva” na fileira): quanto a lente abre e a câmera se aproxima">
        <span>Perspectiva</span>
        <select
          value={g.deepPersp ? g.deepLevel : 'normal'}
          onChange={(ev) => graphics.set(ev.target.value === 'normal' ? { deepPersp: false } : { deepPersp: true, deepLevel: ev.target.value as DeepLevel })}
          aria-label="Perspectiva"
        >
          <option value="normal">Normal</option>
          {(Object.keys(DEEP_FOVS) as DeepLevel[]).map((k) => (
            <option key={k} value={k}>
              Profunda — {DEEP_LABELS[k].toLowerCase()} ({DEEP_FOVS[k]}°)
            </option>
          ))}
        </select>
      </label>
      <label title="Iluminação da cena (só visual): Natural escurece com a profundidade; Clara destaca o submarino; Estúdio para projetor">
        <span>Luz</span>
        <select value={g.lighting} onChange={(ev) => graphics.set({ lighting: ev.target.value as SceneLighting })} aria-label="Iluminação da cena">
          {LIGHTINGS.map((k) => (
            <option key={k} value={k}>
              {LIGHTING_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** botão do filtro: "☀ 07:00 · faróis" */
function SunLabel() {
  const g = useGraphics();
  const night = g.sunHour < 6 || g.sunHour > 18;
  return (
    <>
      {night ? '☾' : '☀'} {hhmm(g.sunHour)}
      {g.subLights ? ' · faróis' : ''}
    </>
  );
}

/**
 * Botão "Perspectiva: normal / profunda" — liga em todas as vistas de 3ª pessoa
 * o efeito da vista Perspectiva (grande-angular de perto, mesmo enquadramento).
 * Só visual; vale para todas as cenas e chega à 2ª janela com as preferências gráficas.
 */
export function PerspChip() {
  const g = useGraphics();
  const on = g.deepPersp;
  return (
    <button
      className={`btn sm ovl-chip persp-chip${on ? ' on' : ''}`}
      aria-pressed={on}
      onClick={() => graphics.set({ deepPersp: !on })}
      title={`Perspectiva ${on ? 'PROFUNDA (clique para voltar ao normal)' : 'normal (clique para a profunda)'} — em todas as vistas, a lente abre e a câmera se aproxima na mesma proporção: o submarino fica do mesmo tamanho, mas a proa e a popa ganham profundidade, como na vista Perspectiva. Intensidade em “Mar e gráfico”. Só visual.`}
    >
      ◢ Perspectiva: {on ? `profunda${g.deepLevel !== 'media' ? ` (${DEEP_LABELS[g.deepLevel].toLowerCase()})` : ''}` : 'normal'}
    </button>
  );
}

/** seção da fileira de filtros com o botão da perspectiva profunda */
export const perspSection = (): OverlaySection => ({ id: 'perspectiva', label: 'Perspectiva', button: <PerspChip /> });

/** seções "Perspectiva", "Mar e gráfico" e "Sol e luzes" das cenas 3D */
export function seaSections(quality: OceanQuality, setQuality: (q: OceanQuality) => void): OverlaySection[] {
  return [
    perspSection(),
    { id: 'mar', label: <SeaLabel />, title: 'Mar e gráfico: estado do mar, qualidade gráfica e iluminação', content: <SeaPanel quality={quality} setQuality={setQuality} /> },
    { id: 'sol', label: <SunLabel />, title: 'Sol e luzes: hora do dia, direção do sol, luar, luzes de navegação, faróis e água escura (só visual)', content: <LightPanel foldable /> },
  ];
}
