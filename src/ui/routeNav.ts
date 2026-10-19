/**
 * ROTA no mapa tático: pontos de passagem (waypoints). Ao "seguir a rota", o
 * piloto automático de rumo recebe, a cada segundo, o rumo para o próximo
 * ponto (comandos registrados, como os do operador); o ponto é dado como
 * alcançado a 150 m.
 */
import type { SimRunner } from '../sim/core/runner';
import { applyCommand } from '../sim/commands';
import { bearingRange, latLonToNed, type LatLon } from '../sim/geo';
import { loadPersisted, savePersisted } from './persist';

export class RouteNav {
  points: LatLon[] = loadPersisted<LatLon[]>('map.route', []);
  active = false;
  idx = 0;
  lastT = -1e9;
  lastSet = NaN;
  arrived = false;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    savePersisted('map.route', this.points);
    for (const l of this.listeners) l();
  }

  add(p: LatLon): void {
    this.points = [...this.points, p];
    this.emit();
  }
  removeLast(): void {
    this.points = this.points.slice(0, -1);
    if (this.idx >= this.points.length) this.idx = Math.max(0, this.points.length - 1);
    this.emit();
  }
  clear(r: SimRunner): void {
    this.stop(r);
    this.points = [];
    this.idx = 0;
    this.emit();
  }

  start(r: SimRunner): void {
    if (!this.points.length) return;
    this.active = true;
    this.arrived = false;
    this.idx = Math.min(this.idx, this.points.length - 1);
    this.lastT = -1e9;
    this.lastSet = NaN;
    r.engine.log(`Rota: seguir ${this.points.length} ponto(s) de passagem (piloto de rumo)`, 'Navegação');
    applyCommand(r.engine, { type: 'autopilot', channel: 'heading', mode: 'AUTO' });
    this.emit();
  }
  stop(r: SimRunner): void {
    if (this.active) r.engine.log('Rota: seguimento interrompido', 'Navegação');
    this.active = false;
    this.emit();
  }

  tick(r: SimRunner, origin: LatLon): void {
    if (!this.active) return;
    const e = r.engine;
    const t = e.state.t;
    if (t - this.lastT < 1) return;
    this.lastT = t;
    const wp = this.points[this.idx];
    if (!wp) return;
    const own = { n: e.state.body.pos.x, e: e.state.body.pos.y };
    const br = bearingRange(own, latLonToNed(origin, wp));
    if (br.rng < 150) {
      e.log(`Rota: ponto ${this.idx + 1} alcançado`, 'Navegação');
      if (this.idx + 1 >= this.points.length) {
        this.active = false;
        this.arrived = true;
        e.log('Rota: último ponto alcançado — mantendo o rumo atual', 'Navegação');
      } else this.idx++;
      this.emit();
      return;
    }
    if (e.state.autopilot.headingMode !== 'AUTO') {
      this.stop(r);
      return;
    }
    const set = Math.round(br.brg);
    if (!(Math.abs(((set - this.lastSet + 540) % 360) - 180) < 1)) {
      applyCommand(e, { type: 'setpoint', channel: 'heading', value: set });
      this.lastSet = set;
    }
  }
}

export const route = new RouteNav();

/** origem geográfica do mapa (posição inicial = (0, 0) da física) */
export const mapOrigin = {
  get(): LatLon {
    return loadPersisted<LatLon>('map.origin', { lat: -22.9455, lon: -43.8395 });
  },
  set(o: LatLon): void {
    savePersisted('map.origin', o);
  },
};
