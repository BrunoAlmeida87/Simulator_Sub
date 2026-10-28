/**
 * SOL E LUZES (só visual): hora do dia e direção do sol, luar, luzes de
 * navegação, faróis do submarino e água escura. Vale para todas as cenas 3D
 * e para a segunda janela (preferências gráficas). Sobre a cena 3D
 * (foldable) cada bloco abre e fecha; o estado fica guardado.
 */
import type { ReactNode } from 'react';
import { DEFAULT_DAYLIGHT, periodName, sunAngles, type NavLightsMode } from '../../render3d/daylight';
import { graphics, useGraphics } from '../graphics';
import { usePersisted } from '../persist';

const PRESETS: { label: string; hour: number; title: string }[] = [
  { label: 'Amanhecer', hour: 6.1, title: 'Sol nascendo (6h06)' },
  { label: 'Manhã', hour: 7, title: 'Sol baixo da manhã (7h) — o padrão' },
  { label: 'Meio-dia', hour: 12, title: 'Sol alto ao norte (12h)' },
  { label: 'Pôr do sol', hour: 17.85, title: 'Sol se pondo (17h51)' },
  { label: 'Noite', hour: 22, title: 'Noite (22h): luar, estrelas e luzes acesas' },
];

const COMPASS = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
const compass = (az: number) => COMPASS[Math.round(az / 45) % 8];

/** "07:00" */
export function hhmm(h: number): string {
  const m = Math.round(h * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const NAV: { id: NavLightsMode; label: string; title: string }[] = [
  { id: 'auto', label: 'Automáticas', title: 'Acendem do crepúsculo ao amanhecer' },
  { id: 'ligadas', label: 'Ligadas', title: 'Sempre acesas (na superfície)' },
  { id: 'desligadas', label: 'Desligadas', title: 'Sempre apagadas' },
];

/** bloco que abre e fecha (só quando foldable); o resumo mostra o valor atual */
function Fold({ id, on, label, value, def, children }: { id: string; on: boolean; label: string; value: ReactNode; def: boolean; children: ReactNode }) {
  const [open, setOpen] = usePersisted(`light.fold.${id}`, def);
  if (!on) return <>{children}</>;
  return (
    <div className={`lp-fold${open ? ' open' : ''}`}>
      <button className="lp-fold-h" aria-expanded={open} onClick={() => setOpen(!open)} title={open ? 'Fechar' : 'Abrir'}>
        <span className="car">{open ? '▾' : '▸'}</span> <b>{label}</b> <span className="lp-fold-v">{value}</span>
      </button>
      {open && <div className="lp-fold-body">{children}</div>}
    </div>
  );
}

export function LightPanel({ foldable = false }: { foldable?: boolean }) {
  const g = useGraphics();
  const { el, az } = sunAngles(g.sunHour, g.sunTurn);
  const natural = sunAngles(g.sunHour, 0).az;
  const setAz = (v: number) => {
    // a direção mostrada é a do sol agora: guarda o giro em relação ao caminho natural
    let t = v - natural;
    t = ((((t + 180) % 360) + 360) % 360) - 180;
    graphics.set({ sunTurn: Math.round(t) });
  };
  const lightsOn = [g.moonlight && 'luar', `navegação ${NAV.find((n) => n.id === g.navLights)?.label.toLowerCase() ?? ''}`, g.subLights && 'faróis', g.darkWater && 'água escura'].filter(Boolean).join(' · ');
  return (
    <div className={`lightpanel${foldable ? ' foldable' : ''}`}>
      <div className="lp-row">
        <b>Sol e luzes</b>
        <small className="muted">só visual</small>
      </div>
      <Fold id="hora" on={foldable} def={true} label="Hora" value={`${hhmm(g.sunHour)} · ${periodName(el)}`}>
        <label className="lp-slider" title="Hora do dia: o sol nasce a leste às 6h, passa ao norte ao meio-dia e se põe a oeste às 18h (Rio de Janeiro, equinócio)">
          <span>Hora</span>
          <input type="range" min={0} max={24} step={0.25} value={g.sunHour} onChange={(ev) => graphics.set({ sunHour: Number(ev.target.value) })} aria-label="Hora do dia" />
          <span className="lp-val">
            {hhmm(g.sunHour)} · {periodName(el)}
          </span>
        </label>
        <div className="lp-row wrap">
          {PRESETS.map((p) => (
            <button key={p.label} className={`btn sm ${Math.abs(g.sunHour - p.hour) < 0.01 ? 'on' : ''}`} title={p.title} onClick={() => graphics.set({ sunHour: p.hour })}>
              {p.label}
            </button>
          ))}
        </div>
      </Fold>
      <Fold id="direcao" on={foldable} def={false} label="Direção do sol" value={`${compass(az)} ${Math.round(az)}° · altura ${Math.round(el)}°`}>
        <label className="lp-slider" title="De que lado vem a luz do sol (ou da lua, oposta a ele): gira o caminho do sol">
          <span>Direção</span>
          <input type="range" min={0} max={359} step={1} value={Math.round(az)} onChange={(ev) => setAz(Number(ev.target.value))} aria-label="Direção do sol" />
          <span className="lp-val">
            {compass(az)} {Math.round(az)}° · altura {Math.round(el)}°
          </span>
        </label>
      </Fold>
      <Fold id="luzes" on={foldable} def={false} label="Luzes" value={lightsOn}>
        <label className="lp-check" title="Lua cheia oposta ao sol: luz azulada fraca, reflexo na água e lua no céu">
          <input type="checkbox" checked={g.moonlight} onChange={(ev) => graphics.set({ moonlight: ev.target.checked })} /> Luar (lua cheia)
        </label>
        <div className="lp-row wrap" title="Luzes de navegação do submarino (mastro, bordos, alcançado e a amarela de lampejos dos submarinos) e dos navios">
          <span>Luzes de navegação</span>
          {NAV.map((n) => (
            <button key={n.id} className={`btn sm ${g.navLights === n.id ? 'on' : ''}`} title={n.title} onClick={() => graphics.set({ navLights: n.id })}>
              {n.label}
            </button>
          ))}
        </div>
        <label className="lp-check" title="Holofotes de proa, luz sob o casco (ilumina o fundo) e luz suave sobre o casco; debaixo d'água os feixes aparecem na água">
          <input type="checkbox" checked={g.subLights} onChange={(ev) => graphics.set({ subLights: ev.target.checked })} /> Faróis do submarino
        </label>
        <label className="lp-check" title="Debaixo d'água quase sem luz natural: só os faróis mostram o caminho">
          <input type="checkbox" checked={g.darkWater} onChange={(ev) => graphics.set({ darkWater: ev.target.checked })} /> Água escura (submerso)
        </label>
      </Fold>
      <div className="lp-row wrap">
        <button className="btn sm" title="Noite com luar, faróis ligados e água escura" onClick={() => graphics.set({ sunHour: 22, subLights: true, darkWater: true })}>
          Mergulho noturno
        </button>
        <button className="btn sm" title="Volta ao sol da manhã, sem faróis e com a água clara" onClick={() => graphics.set({ ...DEFAULT_DAYLIGHT })}>
          Padrão
        </button>
      </div>
    </div>
  );
}
