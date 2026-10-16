/**
 * Ambiente oceânico: perfis de temperatura/salinidade, densidade in situ,
 * pressão hidrostática integrada e topografia simplificada do fundo.
 *
 * Simplificações:
 *  - Mar calmo (sem ondas nem correntes — previstos para a Fase 3).
 *  - Perfis dependem apenas da profundidade (estratificação horizontal).
 *  - A pressão é obtida integrando dp/dz = ρ(S,T,p)·g a partir da superfície
 *    (tabela pré-calculada a cada 0,5 m, interpolação linear).
 */
import { seawaterDensity } from './seawater';

export interface BottomConfig {
  /** Profundidade de referência do fundo na origem (m). */
  baseDepth: number;
  /** Declividade para o Norte (m de profundidade a mais por km). */
  slopeNorth: number;
  /** Declividade para o Leste (m por km). */
  slopeEast: number;
  /** Amplitude das ondulações do relevo (m). */
  roughness: number;
  /** Comprimento de onda característico das ondulações (m). */
  wavelength: number;
}

export interface EnvironmentConfig {
  salinity: number; // PSU, superfície
  deepSalinity: number; // PSU, abaixo da termoclina
  surfaceTemperature: number; // °C
  deepTemperature: number; // °C
  thermoclineDepth: number; // m (centro da termoclina)
  thermoclineThickness: number; // m (espessura característica)
  atmosphericPressure: number; // Pa
  gravity: number; // m/s²
  magneticDeclination: number; // graus (positivo = Leste)
  bottom: BottomConfig;
}

export const defaultEnvironment = (): EnvironmentConfig => ({
  salinity: 35.0,
  deepSalinity: 35.0,
  surfaceTemperature: 22.0,
  deepTemperature: 12.0,
  thermoclineDepth: 80,
  thermoclineThickness: 25,
  atmosphericPressure: 101325,
  gravity: 9.80665,
  magneticDeclination: -21.5,
  bottom: {
    baseDepth: 420,
    slopeNorth: 6,
    slopeEast: -3,
    roughness: 25,
    wavelength: 1800,
  },
});

const TABLE_STEP = 0.5; // m
const TABLE_MAX = 3000; // m

export class Environment {
  readonly cfg: EnvironmentConfig;
  private pTable: Float64Array; // Pa absolutos
  private rhoTable: Float64Array;

  constructor(cfg: EnvironmentConfig) {
    this.cfg = cfg;
    const n = Math.ceil(TABLE_MAX / TABLE_STEP) + 1;
    this.pTable = new Float64Array(n);
    this.rhoTable = new Float64Array(n);
    const g = cfg.gravity;
    let p = cfg.atmosphericPressure;
    this.pTable[0] = p;
    this.rhoTable[0] = this.densityFromProfile(0, 0);
    for (let i = 1; i < n; i++) {
      const zMid = (i - 0.5) * TABLE_STEP;
      // Preditor–corretor: estima p no ponto médio e integra.
      const rhoGuess = this.densityFromProfile(zMid, (p - cfg.atmosphericPressure) / 1e5);
      const pMid = p + rhoGuess * g * TABLE_STEP * 0.5;
      const rhoMid = this.densityFromProfile(zMid, (pMid - cfg.atmosphericPressure) / 1e5);
      p += rhoMid * g * TABLE_STEP;
      this.pTable[i] = p;
      this.rhoTable[i] = this.densityFromProfile(i * TABLE_STEP, (p - cfg.atmosphericPressure) / 1e5);
    }
  }

  /** Temperatura (°C) na profundidade z (m). Perfil com termoclina em tanh. */
  temperatureAt(z: number): number {
    const c = this.cfg;
    const zz = Math.max(0, z);
    const s = 0.5 * (1 - Math.tanh((zz - c.thermoclineDepth) / Math.max(1, c.thermoclineThickness)));
    return c.deepTemperature + (c.surfaceTemperature - c.deepTemperature) * s;
  }

  /** Salinidade (PSU) na profundidade z (m). */
  salinityAt(z: number): number {
    const c = this.cfg;
    const zz = Math.max(0, z);
    const s = 0.5 * (1 - Math.tanh((zz - c.thermoclineDepth) / Math.max(1, c.thermoclineThickness)));
    return c.deepSalinity + (c.salinity - c.deepSalinity) * s;
  }

  private densityFromProfile(z: number, pBar: number): number {
    return seawaterDensity(this.salinityAt(z), this.temperatureAt(z), pBar);
  }

  private interp(table: Float64Array, z: number): number {
    if (z <= 0) return table[0];
    const f = z / TABLE_STEP;
    const i = Math.floor(f);
    if (i >= table.length - 1) return table[table.length - 1];
    const t = f - i;
    return table[i] * (1 - t) + table[i + 1] * t;
  }

  /** Pressão absoluta (Pa) na profundidade z (m). Acima da superfície → atmosférica. */
  pressureAt(z: number): number {
    if (z <= 0) return this.cfg.atmosphericPressure;
    return this.interp(this.pTable, z);
  }

  /** Pressão manométrica (Pa) — acima da atmosférica. */
  gaugePressureAt(z: number): number {
    return this.pressureAt(z) - this.cfg.atmosphericPressure;
  }

  /** Densidade in situ (kg/m³) na profundidade z. */
  densityAt(z: number): number {
    return this.interp(this.rhoTable, Math.max(0, z));
  }

  /** Densidade da água do mar à pressão atmosférica com T,S do nível z (água admitida no casco). */
  densityAtmosphericAt(z: number): number {
    return seawaterDensity(this.salinityAt(z), this.temperatureAt(z), 0);
  }

  /** Profundidade do fundo (m) na posição horizontal (Norte, Leste) em metros. */
  bottomDepthAt(north: number, east: number): number {
    const b = this.cfg.bottom;
    const k = (2 * Math.PI) / Math.max(50, b.wavelength);
    const relief =
      0.6 * Math.sin(k * north + 0.7) * Math.cos(0.8 * k * east - 0.3) +
      0.3 * Math.sin(2.3 * k * east + 1.9) +
      0.1 * Math.cos(3.7 * k * (north + east));
    const d = b.baseDepth + (b.slopeNorth * north) / 1000 + (b.slopeEast * east) / 1000 + b.roughness * relief;
    return Math.max(8, d);
  }
}
