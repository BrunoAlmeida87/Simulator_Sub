/**
 * ESTALEIRO E BASE NAVAL (Ilha da Madeira, Itaguaí): física, 3D e mapa usam
 * os mesmos contornos; fundo contínuo; bacia e entrada navegáveis.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Environment, defaultEnvironment } from '../src/sim/environment/environment';
import { SHIPYARD_DATA } from '../src/sim/environment/shipyardData';
import { shipyardAt, shipyardLocal, shipyardOutlines, insidePolygon, QUAY_TOP, MOUND_CREST, INFLUENCE } from '../src/sim/environment/shipyard';
import { latLonToNed, nedToLatLon, EBN_ITAGUAI, type LatLon } from '../src/sim/geo';
import { buildScenario } from '../src/sim/scenarios';
import { applyCommand } from '../src/sim/commands';
import { ShipyardModel } from '../src/render3d/Shipyard';

const ORIGIN: LatLon = { lat: -22.93041, lon: -43.85273 };
const env = new Environment({ ...defaultEnvironment(), geo: { origin: ORIGIN, coast: true, shelfWidth: 1000 } });
const at = (p: LatLon) => {
  const r = latLonToNed(ORIGIN, p);
  return env.bottomDepthAt(r.n, r.e);
};
const centroid = (ps: LatLon[]): LatLon => ({ lat: ps.reduce((a, p) => a + p.lat, 0) / ps.length, lon: ps.reduce((a, p) => a + p.lon, 0) / ps.length });

describe('Estaleiro: posição e dados', () => {
  it('fica a oeste do terminal de contêineres, junto à Ilha da Madeira (posição da imagem de satélite)', () => {
    // coordenada publicada da base: 22°55′50″S 43°50′57″W — a menos de 500 m do aterro
    const pub = { lat: -(22 + 55 / 60 + 50.3 / 3600), lon: -(43 + 50 / 60 + 56.7 / 3600) };
    const L = shipyardLocal();
    const r = latLonToNed(L.anchor, pub);
    let best = Infinity;
    for (const p of L.platform) best = Math.min(best, Math.hypot(p[0] - r.e, p[1] - r.n));
    expect(best).toBeLessThan(500);
    // o marcador da base no mapa está dentro da bacia
    expect(shipyardAt(EBN_ITAGUAI.lat, EBN_ITAGUAI.lon)!.sd).toBeGreaterThan(50);
  });

  it('galpões e tanques ficam sobre o aterro', () => {
    const L = shipyardLocal();
    for (const b of L.buildings) expect(insidePolygon(b.c[0], b.c[1], L.platform), b.name).toBe(true);
    for (const t of L.tanks) expect(insidePolygon(t[0], t[1], L.platform)).toBe(true);
  });
});

describe('Estaleiro na física (costa ligada)', () => {
  it('aterro +3 m, crista do quebra-mar +5 m, shiplift +3 m, bacia dragada ≥ 16 m', () => {
    expect(at(SHIPYARD_DATA.buildings[0].center)).toBeLessThanOrEqual(-QUAY_TOP + 1e-9);
    const oeste = SHIPYARD_DATA.moles.find((m) => m.id === 'oeste')!;
    expect(at(oeste.pts[3])).toBeCloseTo(-MOUND_CREST, 6);
    const s = SHIPYARD_DATA.shiplift;
    expect(at({ lat: (s.root.lat + s.tip.lat) / 2, lon: (s.root.lon + s.tip.lon) / 2 })).toBe(-QUAY_TOP);
    expect(at(ORIGIN)).toBeGreaterThanOrEqual(SHIPYARD_DATA.dredgeDepth);
    expect(at(EBN_ITAGUAI)).toBeGreaterThanOrEqual(SHIPYARD_DATA.dredgeDepth);
  });

  it('sem costa não há estaleiro (mar aberto como antes)', () => {
    const off = new Environment({ ...defaultEnvironment(), geo: { origin: ORIGIN, coast: false, shelfWidth: 1000 } });
    const r = latLonToNed(ORIGIN, SHIPYARD_DATA.buildings[0].center);
    expect(off.bottomDepthAt(r.n, r.e)).toBe(300);
  });

  it('fundo contínuo em volta (sem degraus na borda da influência)', () => {
    let worst = 0;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * 2 * Math.PI;
      let prev = NaN;
      // do centro da bacia até além do alcance de influência, em passos de 2 m
      for (let d = 0; d <= 1400; d += 2) {
        const n = Math.cos(a) * d;
        const e = Math.sin(a) * d;
        const z = env.bottomDepthAt(n, e);
        const y = shipyardAt(nedToLatLon(ORIGIN, n, e).lat, nedToLatLon(ORIGIN, n, e).lon);
        // saltos só são aceitos nas paredes verticais (cais/aterro) e na borda da dragagem
        const wall = y && Math.abs(y.sd) < 3;
        if (!isNaN(prev) && !wall && z > 0 && prev > 0 && Math.abs(z - prev) > worst && Math.abs(z - prev) < 50) worst = Math.abs(z - prev);
        if (!isNaN(prev) && !wall && z > 0 && prev > 0 && y === null) expect(Math.abs(z - prev)).toBeLessThan(15);
        prev = z;
      }
    }
    expect(INFLUENCE).toBeGreaterThan(100);
  });

  it('da bacia ao mar pela entrada (rumo 214°): água ≥ 16 m em todo o caminho', () => {
    const b = (214 * Math.PI) / 180;
    for (let d = 0; d <= 900; d += 5) expect(env.bottomDepthAt(Math.cos(b) * d, Math.sin(b) * d)).toBeGreaterThanOrEqual(16);
  });

  it('o fundo sobe junto ao quebra-mar fora da área dragada (talude)', () => {
    const sul = SHIPYARD_DATA.moles.find((m) => m.id === 'sul')!;
    const mid = centroid(sul.pts.slice(2, 4));
    const r = latLonToNed(ORIGIN, mid);
    // 40 m ao sul do eixo (lado de fora, sem dragagem)
    expect(env.bottomDepthAt(r.n - 40, r.e)).toBeLessThan(25);
    expect(env.bottomDepthAt(r.n - 40, r.e)).toBeGreaterThan(0);
  });
});

describe('Estaleiro: 3D e mapa = física', () => {
  it('o topo do aterro desenhado coincide com o contorno da física (< 1 m), para várias origens', () => {
    const model = new ShipyardModel('baixa');
    const L = shipyardLocal();
    const tops: THREE.Vector3[] = [];
    model.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - QUAY_TOP) < 1e-6) tops.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
    });
    for (const origin of [ORIGIN, { lat: -22.9455, lon: -43.8395 }, { lat: -23.05, lon: -43.9 }]) {
      model.place(origin, 0, 0, new THREE.Vector3());
      for (const pv of [SHIPYARD_DATA.platform[0], SHIPYARD_DATA.platform[17], SHIPYARD_DATA.platform[30]]) {
        const want = latLonToNed(origin, pv);
        let best = Infinity;
        for (const t of tops) best = Math.min(best, Math.hypot(t.x + model.group.position.x - want.e, -(t.z + model.group.position.z) - want.n));
        expect(best).toBeLessThan(1);
      }
    }
    expect(L.platform.length).toBe(SHIPYARD_DATA.platform.length);
    model.dispose();
  });

  it('submarinos atracados usam o modelo .glb (proa para +x) sem descartar as malhas compartilhadas', () => {
    const model = new ShipyardModel('baixa');
    expect(model.mooredUsesModel).toBe(false); // reserva: casco desenhado
    const src = new THREE.Group();
    const bow = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    bow.name = 'SX1_Casco';
    bow.position.set(0, 0, -35); // proa do arquivo (−Z)
    src.add(bow);
    let disposed = 0;
    bow.geometry.dispose = () => void disposed++;
    model.useSubModel(src);
    expect(model.mooredUsesModel).toBe(true);
    const moored = model.group.children.filter((o) => o.name === 'Submarino atracado');
    expect(moored.length).toBe(2);
    for (const g of moored) {
      const sub = g.getObjectByName('SX1_Modelo_atracado')!;
      sub.updateMatrixWorld(true);
      const p = new THREE.Vector3().setFromMatrixPosition(sub.getObjectByName('SX1_Casco')!.matrixWorld).applyMatrix4(new THREE.Matrix4().copy(g.matrixWorld).invert());
      expect(p.x).toBeCloseTo(35, 6);
      expect(Math.abs(p.z)).toBeLessThan(1e-6);
    }
    model.dispose();
    expect(disposed).toBe(0);
  });

  it('o mapa desenha os mesmos contornos (aterro idêntico; molhes com a largura da física)', () => {
    const o = shipyardOutlines();
    expect(o.platform.length).toBe(SHIPYARD_DATA.platform.length);
    for (let i = 0; i < o.platform.length; i++) {
      expect(o.platform[i].lat).toBeCloseTo(SHIPYARD_DATA.platform[i].lat, 9);
      expect(o.platform[i].lon).toBeCloseTo(SHIPYARD_DATA.platform[i].lon, 9);
    }
    // pontos do contorno de um molhe ficam na borda física (sd ≈ 0) ou dentro de outra estrutura (junções)
    let onEdge = 0;
    for (const mo of o.moles)
      for (const p of mo.ring) {
        const sd = shipyardAt(p.lat, p.lon)!.sd;
        expect(sd).toBeLessThan(1.5);
        if (Math.abs(sd) < 1.5) onEdge++;
      }
    expect(onEdge).toBeGreaterThan(0.6 * o.moles.reduce((a, m) => a + m.ring.length, 0));
  });
});

describe('Cenário Saída da base', () => {
  it('começa dentro da bacia, aproado à entrada, e sai pela entrada sem encalhar (piloto de rumo, 70 rpm)', () => {
    const e = buildScenario('base_itaguai');
    expect(e.state.scenarioId).toBe('base_itaguai');
    expect(shipyardAt(ORIGIN.lat, ORIGIN.lon)!.dredge).toBeGreaterThan(0);
    expect(e.outputs.euler.heading).toBeCloseTo(214, 0);
    applyCommand(e, { type: 'autopilot', channel: 'heading', mode: 'AUTO' });
    applyCommand(e, { type: 'setpoint', channel: 'heading', value: 214 });
    applyCommand(e, { type: 'telegraph', rpm: 70 });
    let minAlt = Infinity;
    for (let k = 0; k < 420; k++) {
      e.advanceSim(1);
      expect(e.state.contact).toBe(false);
      minAlt = Math.min(minAlt, e.outputs.altitude);
    }
    // saiu da bacia: mais de 500 m percorridos, fora da área dragada
    const d = Math.hypot(e.state.body.pos.x, e.state.body.pos.y);
    expect(d).toBeGreaterThan(600);
    expect(minAlt).toBeGreaterThan(5);
  });
});
