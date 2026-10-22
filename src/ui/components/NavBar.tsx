/**
 * Barra de navegação em dois níveis: grupos (com ícone) e as telas do grupo atual.
 * Clicar num grupo abre a última tela usada nele. Teclas 0–8 aparecem discretas.
 * Celular: uma linha só (grupo ▾ + telas do grupo); o ▾ abre o mapa de todas as telas.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useSim } from '../store';
import { visibleAlarms } from '../../sim/systems/alarms';
import { usePersisted } from '../persist';
import { NAV_GROUPS, alarmMarks, groupMark, groupOf, groupTarget, type NavGroup, type NavGroupId, type NavMark, type ScreenId } from '../nav';

const ICON_PATHS: Record<NavGroupId, string[]> = {
  // timão
  operacao: ['M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12z', 'M12 10.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2z', 'M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8'],
  // manômetro
  sistemas: ['M3.5 17a8.5 8.5 0 1 1 17 0', 'M12 17l4.2-5.2', 'M6.2 12.5l1.3.8M12 8.5v1.5M17.8 12.5l-1.3.8', 'M3 20h18'],
  // quadro de apresentação
  apresentacao: ['M3 4h18v12H3z', 'M12 16v4M8 20h8', 'M6.5 12.5l3.2-3.2 2.4 2.4 4.4-4.4'],
  // gráfico
  analise: ['M4 4v16h16', 'M7.5 15l3.5-4.5 3 2.5 5-6.5'],
  // ajustes
  ajustes: ['M4 7h9M18 7h2M4 17h3M12 17h8', 'M15.5 5a2 2 0 1 0 0 4a2 2 0 1 0 0-4z', 'M9.5 15a2 2 0 1 0 0 4a2 2 0 1 0 0-4z'],
  // periscópio
  sala: ['M9.5 21V6.5A2.5 2.5 0 0 1 12 4h7v4.5h-5.5V21', 'M5 14.5h4.5M5 18h4.5'],
};

export function NavIcon({ id }: { id: NavGroupId }) {
  return (
    <svg className="nav2-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      {ICON_PATHS[id].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

const MARK_TEXT: Record<NavMark, string> = { alarm: 'alarme ativo', warn: 'alarme ou aviso' };
const Dot = ({ m }: { m?: NavMark }) => (m ? <span className={`nav2-dot ${m}`} role="img" aria-label={MARK_TEXT[m]} /> : null);

/** mantém a tela atual visível numa linha com rolagem lateral (sem rolar a página) */
function useKeepVisible(row: RefObject<HTMLElement>, dep: unknown) {
  useEffect(() => {
    const r = row.current;
    const el = r?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!r || !el) return;
    const a = el.offsetLeft - 24;
    const b = el.offsetLeft + el.offsetWidth + 24;
    if (a < r.scrollLeft) r.scrollLeft = a;
    else if (b > r.scrollLeft + r.clientWidth) r.scrollLeft = b - r.clientWidth;
  }, [row, dep]);
}

export function NavBar({ screen, setScreen, navRef }: { screen: ScreenId; setScreen: (s: ScreenId) => void; navRef: RefObject<HTMLDivElement> }) {
  const e = useSim(4);
  const marks = alarmMarks(visibleAlarms(e.state));
  const cur = groupOf(screen);
  const [last, setLast] = usePersisted<Partial<Record<NavGroupId, string>>>('nav.last', {});
  const [menu, setMenu] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  useKeepVisible(rowRef, screen);

  // última tela usada em cada grupo (vale também para trocas por tecla, alarme ou botões das telas)
  useEffect(() => {
    if (last[cur.id] !== screen) setLast({ ...last, [cur.id]: screen });
    setMenu(false);
  }, [screen]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setMenu(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const openGroup = (g: NavGroup) => setScreen(groupTarget(g, last));
  const keysOf = (g: NavGroup) => g.screens.filter((s) => s.key).map((s) => s.key);
  const groupTitle = (g: NavGroup) => {
    const k = keysOf(g);
    return `${g.hint}${k.length ? ` · teclas ${k.join(', ')}` : ''}`;
  };

  return (
    <div className="nav2" ref={navRef}>
      <nav className="nav2-groups" aria-label="Grupos de telas">
        {NAV_GROUPS.map((g) => {
          const on = g.id === cur.id;
          return (
            <button key={g.id} className={`nav2-group${on ? ' active' : ''}${g.id === 'sala' ? ' last' : ''}`} aria-current={on ? 'true' : undefined} onClick={() => openGroup(g)} title={groupTitle(g)}>
              <NavIcon id={g.id} />
              <span className="lbl">{g.label}</span>
              <Dot m={groupMark(g, marks)} />
            </button>
          );
        })}
      </nav>
      <nav className="nav2-screens" aria-label={`Telas do grupo ${cur.label}`}>
        <button className={`nav2-chip${menu ? ' on' : ''}`} onClick={() => setMenu(!menu)} aria-expanded={menu} aria-haspopup="true" title="Todas as telas, por grupo">
          <NavIcon id={cur.id} />
          <span className="lbl">{cur.short}</span>
          <Dot m={groupMark(cur, marks)} />
          <span className="car" aria-hidden="true">
            ▾
          </span>
        </button>
        <div className="nav2-row" ref={rowRef}>
          {cur.screens.map((s) => (
            <button key={s.id} className={screen === s.id ? 'active' : ''} aria-current={screen === s.id ? 'page' : undefined} onClick={() => setScreen(s.id)} title={`${s.hint}${s.key ? ` (tecla ${s.key})` : ''}`}>
              {s.key && <span className="n">{s.key}</span>}
              {s.label}
              <Dot m={marks.get(s.id)} />
            </button>
          ))}
          {cur.screens.length === 1 && <span className="nav2-hint">{cur.hint}</span>}
        </div>
        <span className="nav2-keys" title="Teclas 0–8: telas numeradas · Espaço: executar/pausar · I: modo engenharia">
          teclas 0–8
        </span>
      </nav>
      {menu && (
        <>
          <div className="nav2-backdrop" onClick={() => setMenu(false)} />
          <nav className="nav2-menu" aria-label="Todas as telas">
            {NAV_GROUPS.map((g) => (
              <section key={g.id} className={g.id === cur.id ? 'cur' : ''}>
                <h4>
                  <NavIcon id={g.id} />
                  {g.label}
                  <Dot m={groupMark(g, marks)} />
                </h4>
                <div className="items">
                  {g.screens.map((s) => (
                    <button
                      key={s.id}
                      className={screen === s.id ? 'active' : ''}
                      aria-current={screen === s.id ? 'page' : undefined}
                      onClick={() => {
                        setScreen(s.id);
                        setMenu(false);
                      }}
                    >
                      {s.key && <span className="n">{s.key}</span>}
                      {s.label}
                      <Dot m={marks.get(s.id)} />
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}
