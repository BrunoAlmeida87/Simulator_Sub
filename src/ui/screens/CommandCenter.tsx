/** Tela 1 — Central de comando. */
import { useSim } from '../store';
import { Panel } from '../components/Panel';
import { Readout, KindTag } from '../components/Readout';
import { Attitude, Compass, DepthTape, Dial } from '../components/gauges';
import { AutopilotPanel, QuickBallast, SurfaceControl, Telegraph } from '../components/Controls';
import { SituationView } from '../components/SituationView';
import { VerticalExplain } from '../components/Explain';
import { toKnots } from '../../sim/units';
import { fmt, fmtMass } from '../format';

export function CommandCenter() {
  const e = useSim(12);
  const s = e.state;
  const o = e.outputs;
  const sn = s.sensors;
  const depthInd = 0.5 * (sn.PRF1.value + sn.PRF2.value);
  const L = e.vessel.limits;
  const ap = s.autopilot;
  const kn = toKnots(sn.DVLU.value);
  const statusDepth = o.depthKeel > L.testDepth ? 'alarm' : o.depthKeel > L.operatingDepth ? 'warn' : '';
  return (
    <div className="grid">
      <Panel title="Profundidade" inspect="sensor:PRF1">
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <DepthTape depth={depthInd} ordered={ap.depthMode === 'AUTO' ? ap.depthSet : null} bottom={o.bottomDepth} rate={o.depthRateCalc} opLimit={L.operatingDepth} testLimit={L.testDepth} />
          <div className="readouts" style={{ flex: 1, gridTemplateColumns: '1fr' }}>
            <Readout label="Profundidade (quilha)" value={depthInd} unit="m" kind="MED" truth={o.depthKeel} status={statusDepth} inspect="sensor:PRF1" />
            <Readout label="Profundidade ordenada" value={ap.depthMode === 'AUTO' ? ap.depthSet : '—'} unit={ap.depthMode === 'AUTO' ? 'm' : ''} digits={0} kind="CMD" />
            <Readout label="Taxa vertical (+ desce)" value={o.depthRateCalc} unit="m/s" digits={2} kind="CALC" truth={o.verticalSpeed} status={Math.abs(o.verticalSpeed) > L.maxVerticalSpeed ? 'warn' : ''} />
            <Readout label="Pressão externa" value={sn.PEXT.value} unit="bar" digits={2} kind="MED" inspect="sensor:PEXT" />
            <Readout label="Altitude s/ fundo" value={sn.ECO.valid ? sn.ECO.value : 'S/ ECO'} unit="m" kind="MED" truth={o.altitude} status={o.altitude < L.minAltitudeCrit ? 'alarm' : o.altitude < L.minAltitudeWarn ? 'warn' : ''} inspect="sensor:ECO" />
          </div>
        </div>
      </Panel>
      <Panel title="Rumo e navegação" inspect="sensor:GIRO">
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <div style={{ flex: '0 0 55%' }}>
            <Compass heading={sn.GIRO.value} ordered={ap.headingMode === 'AUTO' ? ap.headingSet : null} cog={o.speedOverGround > 0.1 ? o.courseOverGround : undefined} rudder={s.surfaces.rudder.actual} />
          </div>
          <div className="readouts" style={{ flex: 1, gridTemplateColumns: '1fr' }}>
            <Readout label="Rumo verdadeiro" value={sn.GIRO.value} unit="°" kind="MED" truth={o.euler.heading} inspect="sensor:GIRO" />
            <Readout label="Rumo magnético" value={sn.AGM.value} unit="°" kind="MED" inspect="sensor:AGM" />
            <Readout label="Rumo no fundo" value={o.speedOverGround > 0.1 ? o.courseOverGround : '—'} unit={o.speedOverGround > 0.1 ? '°' : ''} kind="CALC" />
            <Readout label="Taxa de guinada" value={sn.INSW.value} unit="°/s" digits={2} kind="MED" />
            <Readout label="Distância percorrida" value={s.nav.distance / 1852} unit="mn" digits={2} kind="CALC" />
          </div>
        </div>
      </Panel>
      <Panel title="Atitude" inspect="attitude">
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <div style={{ flex: '0 0 55%' }}>
            <Attitude pitch={sn.INSP.value} roll={sn.INSR.value} staticPitch={o.staticPitchEq} />
          </div>
          <div className="readouts" style={{ flex: 1, gridTemplateColumns: '1fr' }}>
            <Readout label="Pitch" value={sn.INSP.value} unit="°" digits={2} kind="MED" truth={o.euler.pitch} status={Math.abs(o.euler.pitch) > L.maxPitch ? 'warn' : ''} inspect="sensor:INSP" />
            <Readout label="Banda" value={sn.INSR.value} unit="°" digits={2} kind="MED" truth={o.euler.roll} status={Math.abs(o.euler.roll) > L.maxRoll ? 'warn' : ''} inspect="sensor:INSR" />
            <Readout label="Pitch de equilíbrio estático" value={o.staticPitchEq} unit="°" digits={2} kind="CALC" inspect="trim" title="Ângulo em que o submarino se estabilizaria apenas sob pesos e empuxo" />
            <Readout label="Banda de equilíbrio estático" value={o.staticRollEq} unit="°" digits={2} kind="CALC" inspect="heel" />
          </div>
        </div>
      </Panel>
      <Panel title="Velocidade e propulsão" inspect="propulsion">
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <Dial value={kn} min={-8} max={20} label="Velocidade" unit="nós" digits={1} />
          <Dial value={o.rpm} min={-160} max={160} label="Eixo" unit="rpm" cmd={s.propulsion.rpmCmd} />
        </div>
        <div className="readouts mt8">
          <Readout label="Velocidade (Doppler)" value={kn} unit="nós" kind="MED" truth={toKnots(s.body.vel.x)} inspect="sensor:DVLU" />
          <Readout label="Ordem do telégrafo" value={s.propulsion.rpmCmd} unit="rpm" digits={0} kind="CMD" />
          <Readout label="Potência no eixo" value={s.propulsion.shaftPower / 1e3} unit="kW" digits={0} kind="MED" />
        </div>
        <div className="mt8">
          <Telegraph e={e} />
        </div>
      </Panel>
      <Panel title="Lemes horizontais e de direção" inspect="fin:stern" className="span2">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 260px' }}>
            <SurfaceControl e={e} id="bow" />
          </div>
          <div style={{ flex: '1 1 260px' }}>
            <SurfaceControl e={e} id="stern" />
          </div>
          <div style={{ flex: '1 1 260px' }}>
            <SurfaceControl e={e} id="rudder" />
          </div>
        </div>
        <div className="note">
          Efetividade dos lemes ∝ U². Velocidade atual {fmt(toKnots(s.body.vel.x), 1)} nós ⇒ força relativa a 6 nós: <b className="mono">{fmt(((s.body.vel.x / 3.087) ** 2) * 100, 0)} %</b>.
        </div>
      </Panel>
      <Panel title="Controle automático (PID conceitual)" inspect="autopilot" className="span2">
        <AutopilotPanel e={e} />
      </Panel>
      <Panel title="Situação vertical" className="span2">
        <SituationView e={e} />
      </Panel>
      <Panel title="Por que está subindo ou descendo?" inspect="vertical" tag={<KindTag kind="CALC" />}>
        <VerticalExplain e={e} />
      </Panel>
      <Panel title="Lastro principal e equilíbrio" inspect="buoyancy">
        <QuickBallast e={e} />
        <div className="readouts mt8">
          <Readout label="Flutuabilidade líquida" value={fmtMass(o.netBuoyancyKg)} kind="CALC" status={Math.abs(o.netBuoyancyKg) > 3000 ? 'warn' : ''} inspect="buoyancy" />
          <Readout label="Massa total" value={o.mp.mass / 1000} unit="t" digits={1} kind="CALC" />
          <Readout label="Deslocamento ρ·V" value={o.displacementKg / 1000} unit="t" digits={1} kind="CALC" />
          <Readout label="Densidade local" value={o.rhoLocal} unit="kg/m³" digits={2} kind="CALC" />
        </div>
      </Panel>
    </div>
  );
}
