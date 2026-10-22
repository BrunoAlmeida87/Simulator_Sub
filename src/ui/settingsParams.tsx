/** Parâmetros editáveis nas Configurações (ambiente, fundo e embarcação). */
import type { SimConfig } from '../sim/config/types';

export interface Param {
  label: string;
  unit: string;
  get: (c: SimConfig) => number;
  set: (c: SimConfig, v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}

/** água do mar (aplicáveis sem reiniciar) */
export const WATER_PARAMS: Param[] = [
  { label: 'Salinidade superficial', unit: 'PSU', get: (c) => c.environment.salinity, set: (c, v) => (c.environment.salinity = v), step: 0.1, min: 0, max: 42 },
  { label: 'Salinidade profunda', unit: 'PSU', get: (c) => c.environment.deepSalinity, set: (c, v) => (c.environment.deepSalinity = v), step: 0.1, min: 0, max: 42 },
  { label: 'Temperatura superficial', unit: '°C', get: (c) => c.environment.surfaceTemperature, set: (c, v) => (c.environment.surfaceTemperature = v), step: 0.5, min: -2, max: 35 },
  { label: 'Temperatura profunda', unit: '°C', get: (c) => c.environment.deepTemperature, set: (c, v) => (c.environment.deepTemperature = v), step: 0.5, min: -2, max: 35 },
  { label: 'Profundidade da termoclina', unit: 'm', get: (c) => c.environment.thermoclineDepth, set: (c, v) => (c.environment.thermoclineDepth = v), step: 5, min: 0, max: 1000 },
  { label: 'Espessura da termoclina', unit: 'm', get: (c) => c.environment.thermoclineThickness, set: (c, v) => (c.environment.thermoclineThickness = v), step: 1, min: 1, max: 500 },
  { label: 'Declinação magnética', unit: '°', get: (c) => c.environment.magneticDeclination, set: (c, v) => (c.environment.magneticDeclination = v), step: 0.5, min: -60, max: 60 },
];

/** relevo do fundo (modo relevo) */
export const BOTTOM_RELIEF_PARAMS: Param[] = [
  { label: 'Declividade para o Norte', unit: 'm/km', get: (c) => c.environment.bottom.slopeNorth, set: (c, v) => (c.environment.bottom.slopeNorth = v), step: 1 },
  { label: 'Declividade para o Leste', unit: 'm/km', get: (c) => c.environment.bottom.slopeEast, set: (c, v) => (c.environment.bottom.slopeEast = v), step: 1 },
  { label: 'Rugosidade do relevo', unit: 'm', get: (c) => c.environment.bottom.roughness, set: (c, v) => (c.environment.bottom.roughness = v), step: 1, min: 0, max: 300 },
  { label: 'Comprimento de onda do relevo', unit: 'm', get: (c) => c.environment.bottom.wavelength, set: (c, v) => (c.environment.bottom.wavelength = v), step: 50, min: 100, max: 20000 },
];

export const VESSEL_PARAMS: Param[] = [
  { label: 'BG de projeto', unit: 'm', get: (c) => c.vessel.mass.designBG, set: (c, v) => (c.vessel.mass.designBG = v), step: 0.02, min: 0.05, max: 1.5 },
  { label: 'Compressibilidade do casco', unit: '×10⁻¹⁰/Pa', get: (c) => c.vessel.hull.compressibility * 1e10, set: (c, v) => (c.vessel.hull.compressibility = v * 1e-10), step: 0.2, min: 0, max: 20 },
  { label: 'Coef. de resistência C_t', unit: '', get: (c) => c.vessel.hydro.totalResistanceCoeff, set: (c, v) => (c.vessel.hydro.totalResistanceCoeff = v), step: 0.0001, min: 0.0005, max: 0.02 },
  { label: 'Coef. de escoamento cruzado', unit: '', get: (c) => c.vessel.hydro.crossflowDrag, set: (c, v) => (c.vessel.hydro.crossflowDrag = v), step: 0.05, min: 0.1, max: 2 },
  { label: 'Fator do momento de Munk', unit: '', get: (c) => c.vessel.hydro.munkFactor, set: (c, v) => (c.vessel.hydro.munkFactor = v), step: 0.05, min: 0, max: 1.2 },
  { label: 'Reação do torque do eixo (banda)', unit: '×', get: (c) => c.vessel.hydro.propTorqueRollFactor, set: (c, v) => (c.vessel.hydro.propTorqueRollFactor = v), step: 0.1, min: 0, max: 1 },
  { label: 'Potência nominal do motor', unit: 'MW', get: (c) => c.vessel.propulsion.motor.ratedPower / 1e6, set: (c, v) => (c.vessel.propulsion.motor.ratedPower = v * 1e6), step: 0.1, min: 0.2, max: 10 },
  { label: 'Rampa de rotação', unit: 'rpm/s', get: (c) => c.vessel.propulsion.motor.rpmRampRate, set: (c, v) => (c.vessel.propulsion.motor.rpmRampRate = v), step: 1, min: 0.5, max: 60 },
  { label: 'Capacidade da bateria', unit: 'Ah', get: (c) => c.vessel.electrical.battery.capacityAh, set: (c, v) => (c.vessel.electrical.battery.capacityAh = v), step: 500, min: 500, max: 50000 },
  { label: 'Vazão da bomba de compensação', unit: 'L/s', get: (c) => c.vessel.compensation.pump.ratedFlow * 1000, set: (c, v) => (c.vessel.compensation.pump.ratedFlow = v / 1000), step: 1, min: 1, max: 60 },
  { label: 'Pressão de shutoff da bomba BC', unit: 'bar', get: (c) => c.vessel.compensation.pump.shutoffPressure / 1e5, set: (c, v) => (c.vessel.compensation.pump.shutoffPressure = v * 1e5), step: 5, min: 5, max: 200 },
  { label: 'Limitador de admissão', unit: 'L/s', get: (c) => c.vessel.compensation.inletRegulatorFlow * 1000, set: (c, v) => (c.vessel.compensation.inletRegulatorFlow = v / 1000), step: 1, min: 1, max: 100 },
  { label: 'Vazão da bomba de trim', unit: 'L/s', get: (c) => c.vessel.trim.pump.ratedFlow * 1000, set: (c, v) => (c.vessel.trim.pump.ratedFlow = v / 1000), step: 1, min: 1, max: 60 },
  { label: 'Vazão da bomba de banda', unit: 'L/s', get: (c) => c.vessel.heel.pump.ratedFlow * 1000, set: (c, v) => (c.vessel.heel.pump.ratedFlow = v / 1000), step: 1, min: 1, max: 60 },
  {
    label: 'Área dos suspiros dos TLP (escala)',
    unit: '×',
    get: (c) => c.vessel.ballast.tanks[0].ventArea / 0.035,
    set: (c, v) => c.vessel.ballast.tanks.forEach((t, i) => (t.ventArea = (i < 2 ? 0.035 : 0.028) * v)),
    step: 0.1,
    min: 0.1,
    max: 5,
  },
  {
    label: 'Orifício de sopro (escala)',
    unit: '×',
    get: (c) => c.vessel.ballast.tanks[0].blowArea / 3e-4,
    set: (c, v) => c.vessel.ballast.tanks.forEach((t, i) => (t.blowArea = (i < 2 ? 3e-4 : 2.5e-4) * v)),
    step: 0.1,
    min: 0.1,
    max: 5,
  },
  {
    label: 'Pressão inicial das garrafas AP',
    unit: 'bar',
    get: (c) => c.vessel.hpAir.banks[0].initialPressure / 1e5,
    set: (c, v) => c.vessel.hpAir.banks.forEach((b) => (b.initialPressure = Math.min(b.maxPressure, v * 1e5))),
    step: 10,
    min: 10,
    max: 250,
  },
  { label: 'Velocidade dos lemes de vante', unit: '°/s', get: (c) => c.vessel.fins.find((f) => f.id === 'bow')!.rate, set: (c, v) => (c.vessel.fins.find((f) => f.id === 'bow')!.rate = v), step: 0.5, min: 0.5, max: 20 },
  { label: 'Velocidade dos lemes de ré', unit: '°/s', get: (c) => c.vessel.fins.find((f) => f.id === 'stern')!.rate, set: (c, v) => (c.vessel.fins.find((f) => f.id === 'stern')!.rate = v), step: 0.5, min: 0.5, max: 20 },
  {
    label: 'Velocidade do leme de direção',
    unit: '°/s',
    get: (c) => c.vessel.fins.find((f) => f.id === 'rudder')!.rate,
    set: (c, v) => (c.vessel.fins.find((f) => f.id === 'rudder')!.rate = v),
    step: 0.5,
    min: 0.5,
    max: 20,
  },
  {
    label: 'Batente lemes horizontais',
    unit: '°',
    get: (c) => c.vessel.fins.find((f) => f.id === 'stern')!.maxDeflection,
    set: (c, v) => c.vessel.fins.filter((f) => f.id === 'stern' || f.id === 'bow').forEach((f) => (f.maxDeflection = v)),
    step: 1,
    min: 5,
    max: 40,
  },
  {
    label: 'Batente leme de direção',
    unit: '°',
    get: (c) => c.vessel.fins.find((f) => f.id === 'rudder')!.maxDeflection,
    set: (c, v) => (c.vessel.fins.find((f) => f.id === 'rudder')!.maxDeflection = v),
    step: 1,
    min: 5,
    max: 40,
  },
  { label: 'Limite operacional (fictício)', unit: 'm', get: (c) => c.vessel.limits.operatingDepth, set: (c, v) => (c.vessel.limits.operatingDepth = v), step: 10, min: 20, max: 2000 },
  { label: 'Limite de teste (fictício)', unit: 'm', get: (c) => c.vessel.limits.testDepth, set: (c, v) => (c.vessel.limits.testDepth = v), step: 10, min: 20, max: 2000 },
  { label: 'Pitch máximo (alarme)', unit: '°', get: (c) => c.vessel.limits.maxPitch, set: (c, v) => (c.vessel.limits.maxPitch = v), step: 1, min: 1, max: 45 },
  { label: 'Banda máxima (alarme)', unit: '°', get: (c) => c.vessel.limits.maxRoll, set: (c, v) => (c.vessel.limits.maxRoll = v), step: 1, min: 1, max: 45 },
  { label: 'Velocidade vertical máxima', unit: 'm/s', get: (c) => c.vessel.limits.maxVerticalSpeed, set: (c, v) => (c.vessel.limits.maxVerticalSpeed = v), step: 0.1, min: 0.1, max: 10 },
  { label: 'Altitude mínima (alerta)', unit: 'm', get: (c) => c.vessel.limits.minAltitudeWarn, set: (c, v) => (c.vessel.limits.minAltitudeWarn = v), step: 5, min: 1, max: 500 },
  { label: 'Ruído do profundímetro σ', unit: 'm', get: (c) => c.vessel.sensors.depth, set: (c, v) => (c.vessel.sensors.depth = v), step: 0.01, min: 0, max: 5 },
];

export function ParamGrid({ params, cfg, onChange }: { params: Param[]; cfg: SimConfig; onChange: () => void }) {
  return (
    <div className="formgrid">
      {params.map((p) => (
        <label className="field" key={p.label}>
          <span>
            {p.label} {p.unit && `(${p.unit})`}
          </span>
          <input
            type="number"
            step={p.step}
            min={p.min}
            max={p.max}
            value={Number(p.get(cfg).toPrecision(6))}
            onChange={(ev) => {
              const v = Number(ev.target.value);
              if (Number.isFinite(v)) {
                p.set(cfg, p.min !== undefined ? Math.max(p.min, p.max !== undefined ? Math.min(p.max, v) : v) : v);
                onChange();
              }
            }}
            style={{ width: '100%' }}
          />
        </label>
      ))}
    </div>
  );
}
