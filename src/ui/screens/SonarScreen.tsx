import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Panel } from '../components/Panel';
import { DISPLAY_SPEED, INITIAL_CONTACTS, SONAR_OBJECTS, SOUND_SPEED, changeObjectType, contactPoint, echoTime, makeContact, passiveLevel, pointContact, type SonarContact, type SonarObjectType } from '../../sim/sonar';

type Mode = 'active' | 'passive';
interface Ping { start: number; contacts: SonarContact[]; speed: number }

const MAX_RANGE = 6000;
const R = 260;
const COLORS = ['#55e5d0', '#f5bc69', '#a99bff', '#fa8e9a', '#8acbfa', '#90df9b'];
const fmt = (n: number, digits = 0) => n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function sonarClock() {
  return performance.now() / 1000;
}

function ObjectGlyph({ type, color }: { type: SonarObjectType; color: string }) {
  const shape = {
    ship: <path d="M-8 7V-4L-4-10H4L8-4V7Z" />,
    submarine: <><ellipse cx="0" cy="2" rx="11" ry="5" /><path d="M-2-3v-5h5v5" /></>,
    rock: <path d="M-11 7-7-3-1-8 5-4 10 7Z" />,
    wreck: <><path d="M-11 6-5-5 2-2 9-7 11 5Z" /><path d="M-7-7 7 9M6-8-4 9" /></>,
  }[type];
  return <g fill="#10202d" stroke={color} strokeWidth="2" strokeLinejoin="round">{shape}</g>;
}

export function SonarScreen() {
  const [mode, setMode] = useState<Mode>('active');
  const [contacts, setContacts] = useState<SonarContact[]>(INITIAL_CONTACTS);
  const [selected, setSelected] = useState('A');
  const [speed, setSpeed] = useState(SOUND_SPEED);
  const [ping, setPing] = useState<Ping | null>(null);
  const [now, setNow] = useState(sonarClock);
  const [showTruth, setShowTruth] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const contact = contacts.find((c) => c.id === selected) ?? contacts[0];

  useEffect(() => {
    let frame = 0;
    let last = 0;
    const animate = (t: number) => {
      if (t - last >= 32) { setNow(t / 1000); last = t; }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  const elapsed = ping ? Math.max(0, (now - ping.start) * DISPLAY_SPEED) : 0;
  const outgoing = ping ? elapsed * ping.speed : 0;
  const pingComplete = elapsed > echoTime(MAX_RANGE, ping?.speed ?? speed) + 0.5;

  const emit = () => setPing({ start: sonarClock(), contacts: contacts.map((c) => ({ ...c })), speed });
  const updateContact = (id: string, patch: Partial<SonarContact>) => setContacts((old) => old.map((c) => c.id === id ? { ...c, ...patch } : c));
  const addContact = (type: SonarObjectType) => {
    if (contacts.length >= COLORS.length) return;
    const id = String.fromCharCode(65 + contacts.length);
    setContacts([...contacts, makeContact(id, type, (220 + contacts.length * 37) % 360, 2300 + contacts.length * 450)]);
    setSelected(id);
  };
  const moveSelected = (ev: PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current || !contact) return;
    const p = svgRef.current.createSVGPoint();
    p.x = ev.clientX;
    p.y = ev.clientY;
    const matrix = svgRef.current.getScreenCTM();
    if (!matrix) return;
    const xy = p.matrixTransform(matrix.inverse());
    const next = pointContact(xy.x, xy.y, MAX_RANGE);
    if (next.range < 100 || next.range > MAX_RANGE) return;
    updateContact(contact.id, { range: Math.round(next.range / 50) * 50, bearing: Math.round(next.bearing) });
  };

  const detections = ping?.contacts.filter((c) => c.reflectivity > 0 && elapsed >= echoTime(c.range, ping.speed)) ?? [];
  const grid = Array.from({ length: 4 }, (_, i) => ((i + 1) * MAX_RANGE) / 4);

  return (
    <div className="sonar-screen">
      <div className="sonar-heading">
        <div><h2>Sonar</h2><p>Laboratório visual de propagação acústica · SX-1</p></div>
        <span className="sonar-demo-badge">DEMONSTRAÇÃO FICTÍCIA</span>
      </div>
      <div className="sonar-toolbar">
        <div className="seg" aria-label="Modo do sonar">
          <button className={mode === 'active' ? 'on' : ''} onClick={() => setMode('active')}>Ativo · emitir e escutar</button>
          <button className={mode === 'passive' ? 'on' : ''} onClick={() => setMode('passive')}>Passivo · apenas escutar</button>
        </div>
        {mode === 'active' && <button className="btn ok" onClick={emit}>◉ Emitir pulso</button>}
        <label className="sonar-speed">Velocidade do som <input type="range" min="1400" max="1600" step="10" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /> <b>{speed} m/s</b></label>
        <label className="chk"><input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} /> Mostrar objetos do cenário</label>
      </div>
      <div className="sonar-layout">
        <Panel title="Plano horizontal da água">
          <div className="sonar-plot-wrap">
            <svg ref={svgRef} className="sonar-plot" viewBox="0 0 600 600" role="img" aria-label="Plano do sonar com pulso, alvos e ecos" onPointerDown={moveSelected}>
              <defs>
                <radialGradient id="sonar-water"><stop stopColor="#102e3c" /><stop offset="1" stopColor="#06141f" /></radialGradient>
                <clipPath id="sonar-disc"><circle cx="300" cy="300" r={R} /></clipPath>
              </defs>
              <circle cx="300" cy="300" r={R} fill="url(#sonar-water)" stroke="#386c7d" strokeWidth="2" />
              <g clipPath="url(#sonar-disc)">
                {grid.map((range) => <circle key={range} cx="300" cy="300" r={(range / MAX_RANGE) * R} fill="none" stroke="#2c5968" strokeDasharray="4 7" />)}
                <path d="M300 40V560M40 300H560" stroke="#2c5968" strokeWidth="1" />
                {mode === 'passive' && contacts.map((c, idx) => {
                  const p = contactPoint(c, MAX_RANGE);
                  const level = passiveLevel(c, MAX_RANGE);
                  const cycle = ((now * DISPLAY_SPEED * speed) % 1600) / MAX_RANGE * R;
                  if (level === 0) return null;
                  return <g key={c.id} opacity={0.25 + 0.55 * level}>
                    {[0, 1, 2].map((k) => <circle key={k} cx={p.x} cy={p.y} r={(cycle + k * 75) % 220} fill="none" stroke={COLORS[idx % COLORS.length]} strokeWidth="1.6" />)}
                    <path d={`M300 300L${p.x} ${p.y}`} stroke={COLORS[idx % COLORS.length]} strokeDasharray="3 7" opacity="0.8" />
                  </g>;
                })}
                {mode === 'active' && ping && <>
                  {outgoing <= MAX_RANGE && <circle cx="300" cy="300" r={(outgoing / MAX_RANGE) * R} fill="none" stroke="#56f1e5" strokeWidth="3" opacity="0.9" />}
                  {ping.contacts.map((c, idx) => {
                    const p = contactPoint(c, MAX_RANGE);
                    const echoRadius = Math.max(0, (outgoing - c.range) / MAX_RANGE * R);
                    if (c.reflectivity === 0 || outgoing < c.range || echoRadius > R * 2) return null;
                    return <g key={c.id}>
                      <circle cx={p.x} cy={p.y} r={echoRadius} fill="none" stroke={COLORS[idx % COLORS.length]} strokeWidth="2.2" opacity={c.reflectivity * Math.max(0.1, 0.75 - echoRadius / 400)} />
                      <circle cx={p.x} cy={p.y} r="7" fill={COLORS[idx % COLORS.length]} opacity={c.reflectivity * 0.9} />
                    </g>;
                  })}
                </>}
                {showTruth && contacts.map((c, idx) => {
                  const p = contactPoint(c, MAX_RANGE);
                  return <g key={c.id} transform={`translate(${p.x} ${p.y})`} style={{ cursor: 'pointer' }} onPointerDown={(ev) => { ev.stopPropagation(); setSelected(c.id); }}>
                    <circle r="21" fill="transparent" stroke={c.id === selected ? COLORS[idx % COLORS.length] : 'none'} strokeWidth="1" strokeDasharray="3 3" />
                    <ObjectGlyph type={c.type} color={COLORS[idx % COLORS.length]} />
                    <text y="31" textAnchor="middle" fill="#d9eff2" fontSize="10" fontWeight="700">{c.id} · {SONAR_OBJECTS[c.type].label}</text>
                  </g>;
                })}
              </g>
              <circle cx="300" cy="300" r="9" fill="#8de8f5" stroke="#05202e" strokeWidth="3" />
              <path d="M300 279l-6 11h12z" fill="#8de8f5" />
              <text x="300" y="25" textAnchor="middle" className="sonar-svg-label">N · 000°</text>
              <text x="575" y="304" textAnchor="middle" className="sonar-svg-label">L</text>
              <text x="300" y="588" textAnchor="middle" className="sonar-svg-label">S</text>
              <text x="25" y="304" textAnchor="middle" className="sonar-svg-label">O</text>
              {grid.map((range) => <text key={range} x="305" y={300 - (range / MAX_RANGE) * R - 5} className="sonar-range-label">{fmt(range / 1000, 1)} km</text>)}
            </svg>
          </div>
          <div className="sonar-plot-footer"><span>Alcance visual: {fmt(MAX_RANGE / 1000)} km</span><span>Tempo visual: ×{DISPLAY_SPEED}</span><span>Clique no plano para mover o alvo selecionado</span></div>
        </Panel>
        <div className="sonar-side">
          {mode === 'active' ? <Panel title="Ecos do último pulso">
            <div className="sonar-readouts">
              <div><small>Frente de onda</small><b>{ping ? pingComplete ? 'Concluído' : `${fmt(Math.min(outgoing, MAX_RANGE) / 1000, 2)} km` : 'Aguardando pulso'}</b></div>
              <div><small>Tempo acústico</small><b>{ping ? `${fmt(elapsed, 2)} s` : '—'}</b></div>
              <div><small>Ecos recebidos</small><b>{detections.length} / {ping?.contacts.length ?? contacts.length}</b></div>
            </div>
            <div className="sonar-echo-track"><div style={{ width: `${ping ? Math.min(100, (outgoing / MAX_RANGE) * 100) : 0}%` }} /></div>
            <div className="sonar-contact-list">
              {(ping?.contacts ?? contacts).map((c, idx) => {
                const heard = ping && c.reflectivity > 0 && elapsed >= echoTime(c.range, ping.speed);
                return <div key={c.id} className={`sonar-contact-row ${heard ? 'heard' : ''}`}>
                  <span className="sonar-contact-dot" style={{ background: COLORS[idx % COLORS.length] }} />
                  <b>{c.id}{showTruth ? ` · ${SONAR_OBJECTS[c.type].label}` : ''}</b><span>{heard ? `${fmt(c.bearing)}°` : '—'}</span><span>{heard ? `${fmt(c.range / 1000, 2)} km` : 'sem eco'}</span><small>{heard && ping ? `${fmt(echoTime(c.range, ping.speed), 2)} s` : pingComplete ? 'sem retorno' : 'aguardando'}</small>
                </div>;
              })}
            </div>
            <p className="note">Distância calculada pelo tempo de ida e volta: <b>d = c × Δt / 2</b>. O pulso e os ecos são simulados; não há emissão de áudio físico.</p>
          </Panel> : <Panel title="Cascata passiva · marcação × tempo">
            <div className="sonar-waterfall" aria-label="Cascata de intensidade por direção">
              <div className="sonar-waterfall-top"><span>0° N</span><span>90° L</span><span>180° S</span><span>270° O</span><span>360°</span></div>
              <div className="sonar-waterfall-plot">
                {contacts.map((c, idx) => {
                  const level = passiveLevel(c, MAX_RANGE);
                  return level > 0 && <div key={c.id} className="sonar-waterfall-line" style={{ left: `${(c.bearing / 360) * 100}%`, opacity: 0.3 + level * 0.7, background: COLORS[idx % COLORS.length], boxShadow: `0 0 ${4 + level * 20}px ${COLORS[idx % COLORS.length]}` }} title={`${c.id}: marcação ${c.bearing}°, nível relativo ${fmt(level, 2)}`} />;
                })}
                <div className="sonar-waterfall-scan" style={{ top: `${(now * 8) % 100}%` }} />
              </div>
            </div>
            <div className="sonar-contact-list">
              {contacts.filter((c) => c.noise > 0).map((c) => <div key={c.id} className="sonar-contact-row heard"><span className="sonar-contact-dot" style={{ background: COLORS[contacts.indexOf(c) % COLORS.length] }} /><b>{c.id}{showTruth ? ` · ${SONAR_OBJECTS[c.type].label}` : ''}</b><span>{fmt(c.bearing)}°</span><span>Nível {fmt(passiveLevel(c, MAX_RANGE) * 100)}%</span><small>dist. ?</small></div>)}
            </div>
            <p className="note">O passivo representa sons emitidos pelos contatos. Rochas e destroços silenciosos só produzem eco no modo ativo. A direção e a intensidade são didáticas; não há medida direta de distância nem espectrograma real.</p>
          </Panel>}
          <Panel title="Editar cenário">
            <div className="sonar-target-select">
              {contacts.map((c, idx) => <button key={c.id} className={`btn sm ${selected === c.id ? 'on' : ''}`} onClick={() => setSelected(c.id)} style={{ borderColor: selected === c.id ? COLORS[idx % COLORS.length] : undefined }}>{c.id}</button>)}
              <button className="btn sm" onClick={() => addContact('submarine')} disabled={contacts.length >= COLORS.length}>+ Submarino</button>
              <button className="btn sm" onClick={() => addContact('wreck')} disabled={contacts.length >= COLORS.length}>+ Objeto</button>
              <button className="btn sm" onClick={() => { setContacts(INITIAL_CONTACTS); setSelected('A'); setPing(null); }}>Restaurar</button>
            </div>
            {contact && <div className="sonar-sliders">
              <label className="sonar-type-field">Objeto <select value={contact.type} onChange={(e) => setContacts((old) => old.map((c) => c.id === contact.id ? changeObjectType(c, e.target.value as SonarObjectType) : c))}>{(Object.keys(SONAR_OBJECTS) as SonarObjectType[]).map((type) => <option key={type} value={type}>{SONAR_OBJECTS[type].label}</option>)}</select></label>
              <label>Marcação <b>{fmt(contact.bearing)}°</b><input type="range" min="0" max="359" value={contact.bearing} onChange={(e) => updateContact(contact.id, { bearing: Number(e.target.value) })} /></label>
              <label>Distância <b>{fmt(contact.range / 1000, 2)} km</b><input type="range" min="100" max={MAX_RANGE} step="50" value={contact.range} onChange={(e) => updateContact(contact.id, { range: Number(e.target.value) })} /></label>
              <label>Ruído emitido <b>{fmt(contact.noise * 100)}%</b><input type="range" min="0" max="1" step="0.05" value={contact.noise} onChange={(e) => updateContact(contact.id, { noise: Number(e.target.value) })} /></label>
              <label>Reflexão <b>{fmt(contact.reflectivity * 100)}%</b><input type="range" min="0" max="1" step="0.05" value={contact.reflectivity} onChange={(e) => updateContact(contact.id, { reflectivity: Number(e.target.value) })} /></label>
            </div>}
          </Panel>
        </div>
      </div>
      <p className="sonar-footnote">Modelo visual independente do mapa tático e da física do SX-1. Alvos fixos e fictícios; sem batimetria, refração, frequência ou hidrofones reais.</p>
    </div>
  );
}
