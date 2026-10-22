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

/** seções "Mar e gráfico" e "Sol e luzes" das cenas 3D */
export function seaSections(quality: OceanQuality, setQuality: (q: OceanQuality) => void): OverlaySection[] {
  return [
    { id: 'mar', label: <SeaLabel />, title: 'Mar e gráfico: estado do mar, qualidade gráfica e iluminação', content: <SeaPanel quality={quality} setQuality={setQuality} /> },
    { id: 'sol', label: <SunLabel />, title: 'Sol e luzes: hora do dia, direção do sol, luar, luzes de navegação, faróis e água escura (só visual)', content: <LightPanel foldable /> },
  ];
}
