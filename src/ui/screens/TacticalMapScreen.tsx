/**
 * MAPA TÁTICO — posição geográfica do submarino (Baía de Sepetiba / Estaleiro
 * e Base Naval da Ilha da Madeira, Itaguaí-RJ), derrota percorrida, vetor de
 * velocidade, rumo ordenado, posição estimada (navegação estimada), círculos
 * de distância, base, área de exercícios, contatos de superfície fictícios
 * com marcação/distância/CPA, rota por pontos de passagem e ferramenta de
 * medição. A física continua em coordenadas locais; o mapa só converte.
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { runner, useSim } from '../store';
import { Panel } from '../components/Panel';
import { usePersisted } from '../persist';
import { route, mapOrigin, geoOriginOf } from '../routeNav';
import { cmd } from '../store';
import { useUi } from '../uiContext';
import { Environment } from '../../sim/environment/environment';
import { coastMask } from '../../sim/environment/coast';
import { bearingRange, contactsAt, contactsLocal, cpa, QUAY, DEFAULT_ORIGIN, EBN_ITAGUAI, EXERCISE_AREA, fmtLat, fmtLon, latLonToNed, NM, nedToLatLon, OFFSHORE_ORIGIN, type LatLon } from '../../sim/geo';
import { toKnots } from '../../sim/units';
import { fmt, fmtTime } from '../format';
import { useIdentity } from '../appearance';

type Mode = 'nav' | 'rota' | 'medir' | 'origem';
type Base = 'tatico' | 'mapa' | 'relevo' | 'satelite' | 'nenhum';

/** Fundos de mapa GRATUITOS, sem chave de API (uso leve, com atribuição). */
const BASES: Record<Exclude<Base, 'nenhum'>, { url: string; att: string; label: string; sub?: string[]; dark?: boolean; maxZoom: number }> = {
  // OpenStreetMap com filtro escuro (aparência de quadro tático)
  tatico: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', att: '© colaboradores do OpenStreetMap', label: 'Tático (escuro)', dark: true, maxZoom: 19 },
  mapa: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', att: '© colaboradores do OpenStreetMap', label: 'Mapa', maxZoom: 19 },
  relevo: { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', att: '© OpenStreetMap · SRTM · estilo © OpenTopoMap (CC-BY-SA)', label: 'Relevo', sub: ['a', 'b', 'c'], maxZoom: 17 },
  satelite: { url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg', att: 'Sentinel-2 cloudless — s2maps.eu, EOX IT Services GmbH (dados Copernicus 2020)', label: 'Satélite', maxZoom: 16 },
};

const KIND_STYLE: Record<string, { color: string; shape: 'square' | 'circle'; label: string }> = {
  mercante: { color: '#4cd964', shape: 'square', label: 'Neutro — mercante' },
  pesqueiro: { color: '#4cd964', shape: 'square', label: 'Neutro — pesqueiro' },
  rebocador: { color: '#4cd964', shape: 'square', label: 'Neutro — rebocador' },
  patrulha: { color: '#49a7ff', shape: 'circle', label: 'Amigo — patrulha' },
};

const ll = (p: LatLon): L.LatLngExpression => [p.lat, p.lon];

function ownIcon(): L.DivIcon {
  // símbolo de submarino amigo (semicírculo aberto em cima)
  return L.divIcon({
    className: 'tm-icon',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<svg viewBox="0 0 34 34" width="34" height="34"><path d="M5 12 A12 12 0 0 0 29 12" fill="rgba(73,167,255,0.25)" stroke="#49a7ff" stroke-width="2.6"/><circle cx="17" cy="12" r="2.4" fill="#49a7ff"/></svg>`,
  });
}

function contactIcon(kind: string): L.DivIcon {
  const st = KIND_STYLE[kind];
  const shape = st.shape === 'square' ? `<rect x="5" y="5" width="16" height="16" fill="none" stroke="${st.color}" stroke-width="2.4" transform="rotate(45 13 13)"/>` : `<circle cx="13" cy="13" r="8" fill="none" stroke="${st.color}" stroke-width="2.4"/>`;
  return L.divIcon({ className: 'tm-icon', iconSize: [26, 26], iconAnchor: [13, 13], html: `<svg viewBox="0 0 26 26" width="26" height="26">${shape}</svg>` });
}

function baseIcon(): L.DivIcon {
  return L.divIcon({
    className: 'tm-icon',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<svg viewBox="0 0 28 28" width="28" height="28"><circle cx="14" cy="14" r="12" fill="#0b131c" stroke="#ffd23f" stroke-width="2"/><path d="M14 6 v14 M9 10 h10 M8 16 q6 6 12 0" fill="none" stroke="#ffd23f" stroke-width="2"/></svg>`,
  });
}

export function TacticalMapScreen() {
  const e = useSim(4);
  const id = useIdentity();
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => route.subscribe(force), []);
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const L_ = useRef<Record<string, L.Layer | L.Layer[] | null>>({});
  const [base, setBase] = usePersisted<Base>('map.base', 'tatico');
  const [seamarks, setSeamarks] = usePersisted('map.seamarks', true);
  const [follow, setFollow] = usePersisted('map.follow', true);
  const [rings, setRings] = usePersisted('map.rings', true);
  const [mode, setMode] = useState<Mode>('nav');
  const [measure, setMeasure] = useState<LatLon[]>([]);
  const ui = useUi();
  const [coastOv, setCoastOv] = usePersisted('map.coastOverlay', true);
  // origem do referencial local: a da simulação (mesma do 3D e da física)
  const origin = geoOriginOf(e);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  /** muda a posição geográfica do submarino (comando registrado quando a simulação guarda a origem) */
  const setOrigin = (o: LatLon) => {
    const eng = runner.engine;
    const geo = eng.config.environment.geo;
    if (geo) {
      if (geo.coast) {
        // com a costa ligada, a posição muda a física: recusa colocar o casco em terra ou sobre o fundo
        const env = new Environment({ ...structuredClone(eng.config.environment), geo: { ...geo, origin: o } });
        const p = eng.state.body.pos;
        const b = env.bottomDepthAt(p.x, p.y);
        const hull = Math.max(eng.outputs.depthKeel, p.z + eng.vessel.hull.diameter / 2);
        if (b < hull + 2) {
          ui.toast(`Posição recusada: ali o fundo fica a ${b.toFixed(0)} m (terra ou águas rasas) e o casco está a ${hull.toFixed(0)} m. Escolha um ponto mais afastado da costa.`);
          return;
        }
      }
      cmd({ type: 'environment', patch: { geo: { origin: o } } });
    }
    mapOrigin.set(o);
    force();
  };

  const s = e.state;
  const own = { n: s.body.pos.x, e: s.body.pos.y };
  const ownLL = nedToLatLon(origin, own.n, own.e);

  // ---- criação do mapa
  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true, worldCopyJump: false }).setView(ll(ownLL), 12);
    L.control.scale({ metric: true, imperial: false }).addTo(m);
    m.on('click', (ev: L.LeafletMouseEvent) => {
      const p = { lat: ev.latlng.lat, lon: ev.latlng.lng };
      const md = modeRef.current;
      if (md === 'rota') route.add(p);
      else if (md === 'medir') setMeasure((q) => (q.length >= 2 ? [p] : [...q, p]));
      else if (md === 'origem') {
        // a posição atual do submarino passa a ficar no ponto clicado
        const eng = runner.engine;
        const o0 = { lat: p.lat, lon: p.lon };
        const shifted = nedToLatLon(o0, -eng.state.body.pos.x, -eng.state.body.pos.y);
        setOrigin(shifted);
        setMode('nav');
      }
    });
    m.on('dragstart', () => setFollow(false));
    mapRef.current = m;
    return () => {
      m.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- camada de base
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    for (const k of ['base', 'sea']) {
      const ly = L_.current[k] as L.Layer | null;
      if (ly) m.removeLayer(ly);
      L_.current[k] = null;
    }
    if (base !== 'nenhum') {
      const b = BASES[base];
      L_.current.base = L.tileLayer(b.url, { attribution: b.att, maxZoom: 19, maxNativeZoom: b.maxZoom, subdomains: b.sub ?? 'abc', className: b.dark ? 'tm-dark' : '' }).addTo(m);
    }
    if (seamarks) L_.current.sea = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { attribution: 'Sinais náuticos © OpenSeaMap', maxZoom: 18, opacity: 0.9 }).addTo(m);
  }, [base, seamarks]);

  // ---- costa usada pela simulação (máscara embutida) e cais modelado
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !coastOv) return;
    const { land, nx, ny, bounds } = coastMask();
    const c = document.createElement('canvas');
    c.width = nx;
    c.height = ny;
    const g = c.getContext('2d')!;
    const img = g.createImageData(nx, ny);
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i = y * nx + x;
        if (!land[i]) continue;
        const edge = (x > 0 && !land[i - 1]) || (x < nx - 1 && !land[i + 1]) || (y > 0 && !land[i - nx]) || (y < ny - 1 && !land[i + nx]);
        const k = i * 4;
        img.data[k] = 255;
        img.data[k + 1] = edge ? 140 : 205;
        img.data[k + 2] = edge ? 40 : 90;
        img.data[k + 3] = edge ? 255 : 60;
      }
    g.putImageData(img, 0, 0);
    const ov = L.imageOverlay(c.toDataURL(), [
      [bounds.lat0, bounds.lon0],
      [bounds.lat1, bounds.lon1],
    ], { opacity: 0.9, interactive: false }).addTo(m);
    const q1 = QUAY.root;
    const b = (QUAY.bearing * Math.PI) / 180;
    const q2 = nedToLatLon(q1, Math.cos(b) * QUAY.length, Math.sin(b) * QUAY.length);
    const pier = L.polyline([ll(q1), ll(q2)], { color: '#e8e8e8', weight: 5, opacity: 0.95 }).bindTooltip('Cais modelado no 3D (Ilha da Madeira, Itaguaí)').addTo(m);
    return () => {
      m.removeLayer(ov);
      m.removeLayer(pier);
    };
  }, [coastOv]);

  // ---- elementos fixos (base, área, grade)
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const fixed: L.Layer[] = [];
    fixed.push(L.marker(ll(EBN_ITAGUAI), { icon: baseIcon() }).bindTooltip('EBN — Estaleiro e Base Naval<br/>Ilha da Madeira, Itaguaí (RJ)', { direction: 'right', permanent: false }));
    fixed.push(L.polygon(EXERCISE_AREA.map(ll), { color: '#ffb347', weight: 1.5, dashArray: '6 6', fill: true, fillOpacity: 0.05 }).bindTooltip('Área de exercícios (fictícia)', { sticky: true }));
    // grade de latitude/longitude a cada 5′
    for (let lat = -23.75; lat <= -22.5; lat += 1 / 12) fixed.push(L.polyline([[lat, -44.6], [lat, -43.2]], { color: '#36506e', weight: 0.6, opacity: 0.55, interactive: false }));
    for (let lon = -44.6; lon <= -43.2; lon += 1 / 12) fixed.push(L.polyline([[-23.75, lon], [-22.5, lon]], { color: '#36506e', weight: 0.6, opacity: 0.55, interactive: false }));
    for (const f of fixed) f.addTo(m);
    return () => {
      for (const f of fixed) m.removeLayer(f);
    };
  }, []);

  // ---- elementos dinâmicos (4 Hz)
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const g = L.layerGroup().addTo(m);
    const eng = runner.engine;
    const st = eng.state;
    const o = eng.outputs;
    const pos = nedToLatLon(origin, st.body.pos.x, st.body.pos.y);
    // derrota percorrida
    const trail = st.nav.trail.map((p) => ll(nedToLatLon(origin, p.n, p.e)));
    trail.push(ll(pos));
    L.polyline(trail, { color: '#ffb347', weight: 2, opacity: 0.85 }).addTo(g);
    // vetor de velocidade (6 min de avanço sobre o fundo)
    const vn = o.velNED.x;
    const ve = o.velNED.y;
    const lead = nedToLatLon(origin, st.body.pos.x + vn * 360, st.body.pos.y + ve * 360);
    L.polyline([ll(pos), ll(lead)], { color: '#49a7ff', weight: 2.5 }).addTo(g);
    // rumo ordenado
    if (st.autopilot.headingMode === 'AUTO') {
      const h = (st.autopilot.headingSet * Math.PI) / 180;
      const p2 = nedToLatLon(origin, st.body.pos.x + Math.cos(h) * 3000, st.body.pos.y + Math.sin(h) * 3000);
      L.polyline([ll(pos), ll(p2)], { color: '#49a7ff', weight: 1.4, dashArray: '4 6', opacity: 0.8 }).addTo(g);
    }
    // navegação estimada
    const dr = nedToLatLon(origin, st.nav.drNorth, st.nav.drEast);
    L.polyline([ll(pos), ll(dr)], { color: '#c77dff', weight: 1, dashArray: '2 4' }).addTo(g);
    L.circleMarker(ll(dr), { radius: 6, color: '#c77dff', weight: 2, fill: false }).bindTooltip('Posição estimada (navegação estimada)').addTo(g);
    // círculos de distância
    if (rings)
      for (const r of [1, 2, 5]) {
        L.circle(ll(pos), { radius: r * NM, color: '#49a7ff', weight: 0.8, opacity: 0.45, fill: false, interactive: false }).addTo(g);
        L.marker(ll(nedToLatLon(origin, st.body.pos.x + r * NM, st.body.pos.y)), { icon: L.divIcon({ className: 'tm-ring', html: `${r} mn`, iconSize: [36, 14], iconAnchor: [18, 7] }), interactive: false }).addTo(g);
      }
    // próprio navio
    L.marker(ll(pos), { icon: ownIcon(), zIndexOffset: 1000 })
      .bindTooltip(`${id.name} · ${o.depthKeel.toFixed(0)} m · ${toKnots(st.body.vel.x).toFixed(1)} nós · ${o.euler.heading.toFixed(0)}°`, { permanent: true, direction: 'right', className: 'tm-tip own' })
      .addTo(g);
    // contatos
    for (const c of contactsAt(st.t)) {
      const cll = nedToLatLon(DEFAULT_ORIGIN, c.n, c.e);
      const c2 = nedToLatLon(DEFAULT_ORIGIN, c.n + Math.cos((c.course * Math.PI) / 180) * c.speed * 360, c.e + Math.sin((c.course * Math.PI) / 180) * c.speed * 360);
      L.polyline([ll(cll), ll(c2)], { color: KIND_STYLE[c.kind].color, weight: 1.6 }).addTo(g);
      L.marker(ll(cll), { icon: contactIcon(c.kind) })
        .bindTooltip(`${c.id}`, { permanent: true, direction: 'top', className: 'tm-tip' })
        .addTo(g);
    }
    // rota
    if (route.points.length) {
      L.polyline([ll(pos), ...route.points.slice(route.active ? route.idx : 0).map(ll)], { color: '#ffe14d', weight: 1.8, dashArray: route.active ? undefined : '6 5' }).addTo(g);
      route.points.forEach((p, i) =>
        L.circleMarker(ll(p), { radius: 6, color: '#ffe14d', weight: 2, fillOpacity: route.active && i === route.idx ? 0.8 : 0.1 })
          .bindTooltip(`P${i + 1}`, { permanent: true, direction: 'top', className: 'tm-tip' })
          .addTo(g),
      );
    }
    // medição
    if (measure.length) {
      measure.forEach((p) => L.circleMarker(ll(p), { radius: 4, color: '#ffffff', weight: 2 }).addTo(g));
      if (measure.length === 2) {
        const a = latLonToNed(origin, measure[0]);
        const b = latLonToNed(origin, measure[1]);
        const br = bearingRange(a, b);
        L.polyline(measure.map(ll), { color: '#ffffff', weight: 1.5, dashArray: '3 4' })
          .bindTooltip(`${(br.rng / NM).toFixed(2)} mn · ${(br.rng / 1000).toFixed(2)} km · ${br.brg.toFixed(0)}°`, { permanent: true, className: 'tm-tip' })
          .addTo(g);
      }
    }
    if (follow) m.panTo(ll(pos), { animate: false });
    return () => {
      m.removeLayer(g);
    };
  });

  // ---- painel
  const o = e.outputs;
  // mesma conversão usada pela cena 3D (navios): mesma posição, rumo e velocidade
  const contacts = contactsLocal(s.t, origin).map((cc) => {
    const c = cc;
    const br = bearingRange(own, cc);
    const cp = cpa({ ...own, vn: o.velNED.x, ve: o.velNED.y }, cc);
    return { c, br, cp };
  });
  const toBase = bearingRange(own, latLonToNed(origin, EBN_ITAGUAI));
  const drErr = Math.hypot(s.nav.drNorth - own.n, s.nav.drEast - own.e);
  const drLL = nedToLatLon(origin, s.nav.drNorth, s.nav.drEast);
  const sog = o.speedOverGround;
  let routeDist = 0;
  {
    let prev = own;
    for (const p of route.points.slice(route.active ? route.idx : 0)) {
      const q = latLonToNed(origin, p);
      routeDist += Math.hypot(q.n - prev.n, q.e - prev.e);
      prev = q;
    }
  }
  return (
    <div className="tmap">
      <div className="tmap-view">
        <div ref={box} className="tmap-map" />
        <div className="tmap-modes">
          {(
            [
              ['nav', '🧭 Navegar'],
              ['rota', '📍 Planejar rota'],
              ['medir', '📏 Medir'],
              ['origem', '⌖ Definir posição'],
            ] as [Mode, string][]
          ).map(([k, l]) => (
            <button key={k} className={`btn sm ${mode === k ? 'on' : ''}`} onClick={() => (setMode(k), k !== 'medir' && setMeasure([]))}>
              {l}
            </button>
          ))}
          <button className={`btn sm ${follow ? 'on' : ''}`} onClick={() => setFollow(!follow)}>
            ⊙ Seguir submarino
          </button>
        </div>
        {mode !== 'nav' && (
          <div className="tmap-hint">
            {mode === 'rota' ? 'Clique no mapa para acrescentar pontos de passagem.' : mode === 'medir' ? 'Clique em dois pontos para medir distância e marcação.' : 'Clique no mapa para colocar o submarino nesse ponto (a física não muda; só a referência geográfica).'}
          </div>
        )}
      </div>
      <div className="tmap-side">
        <Panel title={`Próprio navio — ${id.name}`}>
          <table className="t">
            <tbody>
              <tr>
                <td>Posição</td>
                <td className="mono">
                  {fmtLat(ownLL.lat)} · {fmtLon(ownLL.lon)}
                </td>
              </tr>
              <tr>
                <td>Rumo / velocidade</td>
                <td className="mono">
                  {fmt(o.euler.heading, 0)}° · {fmt(toKnots(s.body.vel.x), 1)} nós
                </td>
              </tr>
              <tr>
                <td>Rumo / vel. no fundo</td>
                <td className="mono">
                  {fmt(o.courseOverGround, 0)}° · {fmt(toKnots(sog), 1)} nós
                </td>
              </tr>
              <tr>
                <td>Profundidade / altitude</td>
                <td className="mono">
                  {fmt(o.depthKeel, 1)} m · {fmt(o.altitude, 0)} m
                </td>
              </tr>
              <tr>
                <td>Ordens</td>
                <td className="mono">
                  rumo {s.autopilot.headingMode === 'AUTO' ? `${fmt(s.autopilot.headingSet, 0)}°` : 'MAN'} · prof. {s.autopilot.depthMode === 'AUTO' ? `${fmt(s.autopilot.depthSet, 0)} m` : 'MAN'}
                </td>
              </tr>
              <tr>
                <td style={{ color: '#c77dff' }}>Navegação estimada</td>
                <td className="mono">
                  {fmtLat(drLL.lat)} · {fmtLon(drLL.lon)} <span className="subtle">(erro {fmt(drErr, 0)} m)</span>
                </td>
              </tr>
              <tr>
                <td>Base (EBN Itaguaí)</td>
                <td className="mono">
                  {fmt(toBase.brg, 0)}° · {fmt(toBase.rng / NM, 2)} mn
                </td>
              </tr>
              <tr>
                <td>Distância navegada</td>
                <td className="mono">{fmt(s.nav.distance / NM, 2)} mn</td>
              </tr>
            </tbody>
          </table>
        </Panel>
        <Panel title="Contatos de superfície (fictícios)">
          <table className="t">
            <thead>
              <tr>
                <th>Id</th>
                <th>Marc.</th>
                <th>Dist.</th>
                <th>Rumo/vel.</th>
                <th>CPA</th>
              </tr>
            </thead>
            <tbody>
              {contacts
                .sort((a, b) => a.br.rng - b.br.rng)
                .map(({ c, br, cp }) => {
                  const danger = cp.dcpa < NM && cp.tcpa < 1800;
                  return (
                    <tr key={c.id} title={`${c.name} — ${KIND_STYLE[c.kind].label}`}>
                      <td>
                        <b style={{ color: KIND_STYLE[c.kind].color }}>{c.id}</b> <span className="subtle">{c.kind}</span>
                      </td>
                      <td className="mono">{fmt(br.brg, 0)}°</td>
                      <td className="mono">{fmt(br.rng / NM, 1)} mn</td>
                      <td className="mono">
                        {fmt(c.course, 0)}° · {fmt(toKnots(c.speed), 0)} nós
                      </td>
                      <td className={`mono ${danger ? 'tm-danger' : ''}`}>
                        {fmt(cp.dcpa / NM, 1)} mn · {cp.tcpa > 0 ? fmtTime(cp.tcpa) : 'afastando'}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <div className="note">CPA: ponto de maior aproximação, considerando o rumo e a velocidade atuais (em vermelho se menor que 1 mn nos próximos 30 min). Os contatos são fictícios (não são posições AIS reais) e aparecem como navios na cena 3D, na mesma posição; não há sonar simulado.</div>
        </Panel>
        <Panel title="Rota (pontos de passagem)">
          <div className="row">
            <button className={`btn sm ${mode === 'rota' ? 'on' : ''}`} onClick={() => setMode(mode === 'rota' ? 'nav' : 'rota')}>
              📍 Planejar
            </button>
            <button className="btn sm" disabled={!route.points.length} onClick={() => route.removeLast()}>
              Desfazer último
            </button>
            <button className="btn sm" disabled={!route.points.length} onClick={() => route.clear(runner)}>
              Limpar
            </button>
            {route.active ? (
              <button className="btn sm warn" onClick={() => route.stop(runner)}>
                ■ Parar
              </button>
            ) : (
              <button className="btn sm ok" disabled={!route.points.length} onClick={() => route.start(runner)}>
                ▶ Seguir rota
              </button>
            )}
          </div>
          <div className="subtle mt4">
            {route.points.length} ponto(s) · {fmt(routeDist / NM, 2)} mn restantes
            {sog > 0.3 ? ` · ETA ${fmtTime(routeDist / sog)}` : ''}
            {route.active ? ` · indo para P${route.idx + 1}` : route.arrived ? ' · rota concluída' : ''}
          </div>
          <div className="note">“Seguir rota” liga o piloto de rumo e ordena, a cada segundo, o rumo para o próximo ponto (troca de ponto a 150 m). Mover o leme manualmente desliga o seguimento.</div>
        </Panel>
        <Panel title="Mapa">
          <div className="row">
            <span className="subtle">Fundo</span>
            <div className="seg">
              {(['tatico', 'mapa', 'relevo', 'satelite', 'nenhum'] as Base[]).map((b) => (
                <button key={b} className={base === b ? 'on' : ''} onClick={() => setBase(b)}>
                  {b === 'nenhum' ? 'Só grade' : BASES[b].label}
                </button>
              ))}
            </div>
          </div>
          <div className="row mt4">
            <button className={`btn sm ${seamarks ? 'on' : ''}`} onClick={() => setSeamarks(!seamarks)}>
              Sinais náuticos (OpenSeaMap)
            </button>
            <button className={`btn sm ${rings ? 'on' : ''}`} onClick={() => setRings(!rings)}>
              Círculos 1/2/5 mn
            </button>
            <button className={`btn sm ${coastOv ? 'on' : ''}`} onClick={() => setCoastOv(!coastOv)} title="Contorno da costa usada pela simulação e pela cena 3D (dados embutidos, funciona sem internet)">
              Costa do simulador
            </button>
          </div>
          <div className="row mt4">
            <span className="subtle">Posição inicial</span>
            <button className="btn sm" onClick={() => setOrigin(DEFAULT_ORIGIN)} title="Baía de Sepetiba, junto ao Estaleiro e Base Naval">
              Base — Ilha da Madeira
            </button>
            <button className="btn sm" onClick={() => setOrigin(OFFSHORE_ORIGIN)} title="Mar aberto, a sul da Restinga da Marambaia">
              Mar aberto
            </button>
            <button className={`btn sm ${mode === 'origem' ? 'on' : ''}`} onClick={() => setMode('origem')}>
              Clicar no mapa
            </button>
          </div>
          <div className="note">
            Coordenadas aproximadas. Costa do simulador (laranja): dados embutidos do OpenStreetMap (© colaboradores do OpenStreetMap, ODbL) e relevo Terrarium — a mesma da cena 3D e, com a costa ligada, da física. O fundo de mar aberto é o configurado (a batimetria real da baía não é modelada). Fundos gratuitos, sem chave de API: OpenStreetMap, OpenTopoMap, Sentinel-2 (EOX) e sinais náuticos do OpenSeaMap — vêm da internet; sem conexão, fica a grade de 5′.
          </div>
        </Panel>
      </div>
    </div>
  );
}
