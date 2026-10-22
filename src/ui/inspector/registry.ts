/**
 * Conteúdo didático do MODO ENGENHARIA: para cada componente, função,
 * variáveis (ao vivo), estado, influência na dinâmica, equações aplicáveis e
 * consequências previstas (calculadas a partir do estado atual).
 */
import type { SimulationEngine } from '../../sim/core/engine';
import type { Kind } from '../components/Readout';
import { valveStatus, pumpStatus, pumpFlow, pumpPower } from '../../sim/systems/components';
import { ballastFillStatus, gasMassFlux } from '../../sim/systems/ballast';
import { bankPressure } from '../../sim/systems/hpAir';
import { tankVolume } from '../../sim/systems/internalTanks';
import { SENSOR_DEFS, RHO_CAL } from '../../sim/systems/sensors';
import { R_AIR, RHO_NOMINAL } from '../../sim/core/context';
import { liftCurveSlope } from '../../sim/physics/hydrodynamics';
import { RAD } from '../../sim/core/math';
import { toKnots, KNOT } from '../../sim/units';
import { fmt, fmtMass, fmtPower, fmtForce, fmtMoment } from '../format';

export interface InspVar {
  name: string;
  value: string;
  kind: Kind;
}

export interface InspectorContent {
  title: string;
  func: string;
  vars: InspVar[];
  state: string;
  influence: string;
  equations: string[];
  predictions: string[];
  channels?: string[]; // canais do histórico relevantes (antes/depois)
}

const V = (name: string, value: string, kind: Kind = 'CALC'): InspVar => ({ name, value, kind });

function terminalVz(e: SimulationEngine, dKg: number): number {
  const qa = 0.5 * e.outputs.rhoLocal * e.vessel.hydro.crossflowDrag * e.geom.slices.reduce((a, s) => a + 2 * s.r * s.dx, 0);
  const ql = e.vessel.hydro.linearDamping.heave;
  const W = Math.abs(dKg) * 9.80665;
  return (-ql + Math.sqrt(ql * ql + 4 * qa * W)) / (2 * qa);
}

/** velocidade de regime estimada para uma rotação (submerso). */
function speedForRpm(e: SimulationEngine, rpm: number): number {
  const v = e.vessel;
  const p = v.propulsion.propeller;
  const n = rpm / 60;
  if (n <= 0) return 0;
  const D = p.diameter;
  const rho = e.outputs.rhoLocal;
  const S = e.geom.wettedArea * v.hydro.appendageFactor;
  const a = 0.5 * rho * S * v.hydro.totalResistanceCoeff;
  // (1−t)·ρD⁴K_T0(n² − n·u(1−w)/(D·J0)) = a·u²
  const k = (1 - p.thrustDeduction) * rho * D ** 4 * p.KT0;
  const b = (k * n * (1 - p.wakeFraction)) / (D * p.J0T);
  const c = k * n * n;
  return (-b + Math.sqrt(b * b + 4 * a * c)) / (2 * a);
}

export function inspectorContent(e: SimulationEngine, id: string): InspectorContent | null {
  const s = e.state;
  const o = e.outputs;
  const v = e.vessel;
  const g = e.env.cfg.gravity;
  const [kind, sub] = id.split(':');
  const T = e.env.temperatureAt(Math.max(0, s.body.pos.z)) + 273.15;

  switch (kind) {
    case 'mbt': {
      const t = v.ballast.tanks.find((x) => x.id === sub) ?? v.ballast.tanks[0];
      const st = s.ballast[t.id];
      const va = t.volume - st.water;
      const pExt = st.pExtPort || e.env.pressureAt(o.depthKeel);
      const p10 = e.env.pressureAt(Math.max(0, o.depthKeel - 10));
      const vaUp = st.air > 0 ? Math.min(t.volume, (st.air * R_AIR * T) / p10) : 0;
      const qVent = 0.8 * t.ventArea * gasMassFlux(pExt + 0.3e5, pExt, T);
      return {
        title: t.name,
        func: 'Tanque de lastro principal de alagamento livre (fora do casco resistente). Cheio de água submerso; soprado com ar na superfície, fornece a reserva de flutuabilidade. Responsável pela TRANSIÇÃO entre superfície e imersão — não pelo equilíbrio fino.',
        vars: [
          V('Capacidade', `${t.volume} m³`),
          V('Água', `${st.water.toFixed(2)} m³ (${((st.water / t.volume) * 100).toFixed(1)} %)`, 'MED'),
          V('Massa de ar', `${st.air.toFixed(1)} kg`),
          V('Volume de ar', `${va.toFixed(2)} m³`),
          V('Pressão do ar', `${(st.pAir / 1e5).toFixed(3)} bar`),
          V('Pressão externa nos embornais', `${(pExt / 1e5).toFixed(3)} bar`),
          V('Vazão de água', `${(st.qWater * 1000).toFixed(1)} L/s`),
          V('Vazão de ar (suspiro / sopro / escape)', `${st.mdotVent.toFixed(2)} / ${st.mdotBlow.toFixed(2)} / ${st.mdotSpill.toFixed(2)} kg/s`),
          V('Suspiro', `${valveStatus(st.vent)} (${(st.vent.pos * 100).toFixed(0)} %)`, 'MED'),
          V('Sopro', `${valveStatus(st.blow)} (${(st.blow.pos * 100).toFixed(0)} %)`, 'MED'),
          V('Sopro de emergência', `${valveStatus(st.emergencyBlow)} · ${st.mdotEmergencyBlow.toFixed(2)} kg/s`, 'MED'),
        ],
        state: `${ballastFillStatus(t, st)}${st.ventLeak > 0 ? ' — VAZAMENTO NO SUSPIRO' : ''}${st.vent.stuck || st.blow.stuck ? ' — VÁLVULA TRAVADA' : ''}`,
        influence: `Cada m³ de água no TLP adiciona ${(o.rhoLocal / 1000).toFixed(3)} t ao peso; como o volume do tanque já está no envelope de deslocamento, o TLP cheio torna o submarino neutro e o TLP vazio dá flutuabilidade positiva. Posição longitudinal x = ${t.center.x} m ⇒ alagamento assimétrico gera momento de trim.`,
        equations: [
          'p_ar = m_ar·R·T / (V_t − V_água)        (gás ideal isotérmico)',
          'Δp = p_ext(z_embornal) − p_ar − ρ·g·h',
          'Q_água = C_d·A_emb·√(2|Δp|/ρ)·sinal(Δp)  (integrada implicitamente)',
          'ṁ_suspiro = C_d·A_s·Φ(p_ar, p_ext,topo)   (orifício compressível)',
          'ṁ_sopro = C_d·A_b·Φ(p_coletor, p_ar)',
        ],
        predictions: [
          `Alagar o restante (${va.toFixed(1)} m³) ⇒ +${fmtMass(va * o.rhoLocal)} de peso.`,
          st.air > 0 ? `Subindo 10 m, o ar (${st.air.toFixed(0)} kg) se expandiria de ${va.toFixed(2)} para ${vaUp.toFixed(2)} m³ — expulsando ${(vaUp - va).toFixed(2)} m³ de água (+${fmtMass((vaUp - va) * o.rhoLocal)} de empuxo).` : 'Sem ar no tanque: totalmente alagado.',
          `Com suspiro aberto e 0,3 bar de sobrepressão, saída de ar ≈ ${qVent.toFixed(1)} kg/s.`,
        ],
        channels: ['mbt', 'depth', 'net'],
      };
    }
    case 'hp': {
      const b = v.hpAir.banks.find((x) => x.id === sub) ?? v.hpAir.banks[0];
      const st = s.hpAir.banks[b.id];
      const p = bankPressure(v.hpAir, b.id, st.mass);
      const pExt = e.env.pressureAt(o.depthKeel);
      const totalMbt = v.ballast.tanks.reduce((a, t) => a + t.volume, 0);
      const need = (pExt * totalMbt) / (R_AIR * T);
      const avail = v.hpAir.banks.filter((x) => (x.purpose ?? 'normal') === (b.purpose ?? 'normal')).reduce((a, x) => a + s.hpAir.banks[x.id].mass, 0);
      return {
        title: 'Ar comprimido de alta pressão — ' + b.name,
        func: b.purpose === 'emergency' ? 'Ampolas exclusivas do sopro de emergência, na mesma pressão e com menor volume que os bancos normais. Circuito independente; compressor automático durante a emergência com tomada de ar e energia.' : 'Armazena ar para o sopro normal dos TLP em circuito independente da reserva de emergência. Recarregado pelo compressor com tomada de ar e energia.',
        vars: [V('Pressão', `${(p / 1e5).toFixed(1)} bar`, 'MED'), V('Massa de ar', `${st.mass.toFixed(0)} kg`), V('Volume hidráulico', `${b.volume} m³`), V('Válvula de isolamento', valveStatus(st.valve), 'MED'), V('Pressão do coletor', `${(b.purpose === 'emergency' ? s.hpAir.emergencyManifoldPressure / 1e5 : o.hpManifoldBar).toFixed(1)} bar`, 'MED')],
        state: st.valve.pos > 0.5 ? 'Conectado ao coletor' : 'Isolado',
        influence: 'A vazão de sopro é proporcional à pressão do coletor (escoamento crítico); quanto mais fundo, maior a massa de ar necessária para expulsar o mesmo volume de água.',
        equations: ['p = m·R·T / V', 'ṁ (crítico) = C_d·A·p₀·√(γ/(R·T))·(2/(γ+1))^((γ+1)/(2(γ−1)))'],
        predictions: [`Massa de ar para esvaziar todos os TLP à profundidade atual: ${need.toFixed(0)} kg (disponível: ${avail.toFixed(0)} kg → ${((avail / need) * 100).toFixed(0)} %).`],
        channels: ['hp', 'mbt'],
      };
    }
    case 'comp': {
      const c = v.compensation;
      const st = s.compensation;
      const zc = e.outputs.depthKeel;
      const dp = Math.max(0, e.env.pressureAt(zc) - v.internalPressure);
      const qp = pumpFlow(c.pump, 1, dp);
      const pp = pumpPower(c.pump, 1, qp, dp);
      const total = Object.values(st.tanks).reduce((a, t) => a + t.mass, 0);
      const vt = terminalVz(e, 500);
      return {
        title: sub === 'pump' ? c.pump.name : sub === 'inlet' ? c.inletValve.name : sub === 'discharge' ? c.dischargeValve.name : 'Sistema de compensação de peso',
        func: 'Ajusta a MASSA total do submarino submerso trocando água com o mar, para obter equilíbrio hidrostático (flutuabilidade neutra). Diferente do controle de profundidade pelos lemes, atua mesmo sem velocidade.',
        vars: [
          V('Água de compensação', `${(total / 1000).toFixed(3)} t`, 'MED'),
          ...c.tanks.map((t) => V(t.name, `${tankVolume(st.tanks[t.id]).toFixed(3)} / ${t.capacity} m³`, 'MED')),
          V('Admissão', `${(st.qIn * 1000).toFixed(2)} L/s — ${valveStatus(st.inlet)}`, 'MED'),
          V('Descarga', `${(st.qOut * 1000).toFixed(2)} L/s — ${valveStatus(st.discharge)}`, 'MED'),
          V('Bomba', `${pumpStatus(st.pump, s.electrical.energized)} · ${(st.pump.speed * 100).toFixed(0)} % · ${fmtPower(st.pump.power)}`, 'MED'),
          V('Δp mar–interior', `${(dp / 1e5).toFixed(2)} bar`),
          V('Flutuabilidade líquida', fmtMass(o.netBuoyancyKg)),
        ],
        state: st.dosing?.active ? `Sequência ${st.dosing.mode}: ${st.dosing.phase}` : 'Manual',
        influence: 'Admitir água aumenta o peso (tendência de descer); esgotar reduz (tendência de subir). Os tanques ficam perto de G para alterar pouco o trim.',
        equations: ['Q_adm = min(C_d·A·a·√(2Δp/ρ), Q_reg)', 'Q_bomba = Q₀·√(1 − Δp/Δp₀)', 'P = Q·Δp/η + P₀', 'F_líquida = (ρ·V_desl − m)·g'],
        predictions: [
          `Admitir 500 kg ⇒ flutuabilidade −0,5 t ⇒ velocidade vertical terminal parado ≈ ${fmt(vt, 2)} m/s (descendo).`,
          `Esgotar nesta profundidade: Q ≈ ${(qp * 1000).toFixed(1)} L/s, P ≈ ${fmtPower(pp)}; 1 t levaria ≈ ${fmt(1000 / RHO_NOMINAL / Math.max(qp, 1e-6) / 60, 1)} min.`,
          `Admitir nesta profundidade: até ${(c.inletRegulatorFlow * 1000).toFixed(0)} L/s (limitador).`,
        ],
        channels: ['comp', 'net', 'depth', 'vz'],
      };
    }
    case 'trim': {
      const c = v.trim;
      const st = s.trim;
      const arm = c.tankA.center.x - c.tankB.center.x;
      const d500 = Math.atan((500 * g * arm) / o.pitchStiffness) * RAD;
      return {
        title: 'Sistema de trim longitudinal',
        func: 'Transfere água entre os tanques de trim de vante e de ré, deslocando o centro de gravidade longitudinal e alterando o equilíbrio estático de pitch, sem mudar a massa total.',
        vars: [
          V('TT-AV', `${tankVolume(st.tankA).toFixed(3)} m³`, 'MED'),
          V('TT-AR', `${tankVolume(st.tankB).toFixed(3)} m³`, 'MED'),
          V('Vazão', `${(st.flow * 1000).toFixed(2)} L/s (+ AV→AR)`, 'MED'),
          V('Bomba', `${pumpStatus(st.pump, s.electrical.energized)} · ${fmtPower(st.pump.power)} · Δp ${(st.pump.dp / 1e5).toFixed(2)} bar`, 'MED'),
          V('x_G − x_B', `${((o.mp.cg.x - o.forces.hs.center.x) * 1000).toFixed(1)} mm`),
          V('Momento dos pesos', fmtMoment(o.weightTrimMoment)),
          V('Rigidez W·BG', `${fmt(o.pitchStiffness / 1e6, 2)} MN·m/rad`),
          V('θ medido / θ estático', `${fmt(o.euler.pitch, 2)}° / ${fmt(o.staticPitchEq, 2)}°`),
        ],
        state: st.dosing?.active ? `Transferindo (${st.dosing.phase})` : 'Parado',
        influence: 'Momento dos pesos M = −W·(x_G − x_B): peso a ré de B levanta a proa. Submerso, o momento restaurador é W·BG·sen θ (sem plano de flutuação). Os lemes produzem atitude DINÂMICA (dependente de U²); o trim muda o EQUILÍBRIO ESTÁTICO.',
        equations: ['Δx_G = Δm·(x_AR − x_AV)/m', 'θ_eq ≈ atan(Δm·g·Δx / (W·BG))', 'Δp_bomba = ρ·g·(z_origem − z_destino) + k·Q²'],
        predictions: [`Transferir 500 kg AV→AR ⇒ Δθ ≈ +${fmt(d500, 2)}° (proa para cima); AR→AV ⇒ ${fmt(-d500, 2)}°.`, `Período natural de pitch submerso ≈ ${fmt(2 * Math.PI * Math.sqrt((o.mp.inertia.y + e.added.M) / o.pitchStiffness), 0)} s.`],
        channels: ['pitch', 'pitchEq', 'trimA', 'trimB'],
      };
    }
    case 'heel': {
      const c = v.heel;
      const st = s.heel;
      const arm = c.tankB.center.y - c.tankA.center.y;
      const d = Math.atan((500 * g * arm) / o.rollStiffness) * RAD;
      return {
        title: 'Sistema de banda (arquitetura fictícia)',
        func: 'Tanques laterais com bomba de transferência para provocar e corrigir pequenas bandas (arquitetura conceitual, identificada como fictícia).',
        vars: [
          V('TB-BB', `${tankVolume(st.tankA).toFixed(3)} m³`, 'MED'),
          V('TB-BE', `${tankVolume(st.tankB).toFixed(3)} m³`, 'MED'),
          V('y_G', `${(o.mp.cg.y * 1000).toFixed(1)} mm`),
          V('Momento transversal', fmtMoment(o.weightHeelMoment)),
          V('Rigidez transversal', `${fmt(o.rollStiffness / 1e6, 2)} MN·m/rad`),
          V('φ medido / φ estático', `${fmt(o.euler.roll, 2)}° / ${fmt(o.staticRollEq, 2)}°`),
          V('Reação do torque do eixo', fmtMoment(o.forces.propeller.M.x)),
        ],
        state: st.dosing?.active ? `Transferindo (${st.dosing.phase})` : 'Parado',
        influence: 'Banda de equilíbrio: tan φ = W·y_G / (W·BG) + efeitos dinâmicos (vela em guinada, torque do hélice). A banda responde progressivamente pela inércia de roll e amortecimento.',
        equations: ['M_banda = W·(y_G − y_B)', 'φ_eq ≈ atan(Δm·g·Δy / (W·BG))', 'I_xx·ṗ = M_hidrostático + M_amortec. + M_vela + M_hélice'],
        predictions: [`Transferir 500 kg BB→BE ⇒ Δφ ≈ +${fmt(d, 2)}° (adernar a BE).`, `Período natural de roll ≈ ${fmt(2 * Math.PI * Math.sqrt((o.mp.inertia.x + e.added.K) / o.rollStiffness), 1)} s.`],
        channels: ['roll', 'heelA', 'heelB'],
      };
    }
    case 'fin': {
      const f = v.fins.find((x) => x.id === sub)!;
      const st = s.surfaces[f.id];
      const fr = o.forces.fins[f.id];
      const U = Math.max(0.01, Math.abs(s.body.vel.x));
      const cla = liftCurveSlope(f.aspectRatio);
      const L10 = 0.5 * o.rhoLocal * U * U * f.area * cla * 10 * (Math.PI / 180);
      const arm = Math.abs(f.position.x);
      const isR = f.id === 'rudder';
      return {
        title: f.name,
        func: isR
          ? 'Gera força lateral na popa, criando momento de guinada; o casco adquire ângulo de deriva e a sustentação do casco completa a curva.'
          : f.id === 'bow'
            ? 'Lemes horizontais de vante: força vertical perto da proa — atuam principalmente sobre o movimento vertical (heave), com pouco momento.'
            : 'Lemes horizontais de ré: força vertical longe de G — atuam principalmente sobre o pitch; a atitude resultante gera sustentação do casco que muda a profundidade.',
        vars: [
          V('Ângulo comandado', `${fmt(st.cmd, 1)}°`, 'CMD'),
          V('Ângulo real', `${fmt(st.actual, 2)}°`, 'MED'),
          V('Velocidade do atuador', `${f.rate}°/s × fator hidráulico`),
          V('Velocidade local²', `${fmt(fr.speed2, 2)} m²/s²`),
          V('Ângulo de ataque efetivo', `${fmt(fr.alpha * RAD, 2)}°`),
          V('Sustentação / arrasto', `${fmtForce(fr.lift)} / ${fmtForce(fr.drag)}`),
          V(isR ? 'Momento de guinada' : 'Momento de pitch', fmtMoment(isR ? fr.M.z : fr.M.y)),
          V('Área / alongamento', `${f.area} m² / ${f.aspectRatio}`),
        ],
        state: st.jammed ? 'TRAVADO' : Math.abs(st.actual - st.cmd) > 0.05 ? 'Em movimento' : 'Em posição',
        influence: `Força ∝ U²: a ${fmt(toKnots(U), 1)} nós, 10° produzem ≈ ${fmtForce(L10)} (${fmtMoment(L10 * arm)} de momento). Com velocidade praticamente nula, a efetividade desaparece.`,
        equations: ['α = δ + atan2(v_n, u_local)', 'L = ½·ρ·U²·A·C_L(α),  C_Lα = 2π·AR/(2 + √(AR² + 4))', `C_Lα = ${cla.toFixed(2)} /rad; estol em ${f.stallAngle}°`, 'M = r × F'],
        predictions: [
          `Dobrar a velocidade multiplica a força por 4 (${fmtForce(4 * L10)} a 10°).`,
          `A 6 nós, 10° gerariam ${fmtForce(0.5 * o.rhoLocal * (6 * KNOT) ** 2 * f.area * cla * 10 * (Math.PI / 180))}; a 1 nó: ${fmtForce(0.5 * o.rhoLocal * KNOT ** 2 * f.area * cla * 10 * (Math.PI / 180))}.`,
          'Acima do ângulo de estol, a sustentação cai e o arrasto cresce.',
        ],
        channels: isR ? ['rudder', 'rudderCmd', 'heading'] : [f.id, f.id + 'Cmd', 'pitch', 'depth'],
      };
    }
    case 'propulsion':
    case 'propeller': {
      const p = s.propulsion;
      const m = v.propulsion.motor;
      const pr = v.propulsion.propeller;
      return {
        title: kind === 'propeller' ? 'Hélice e resistência ao avanço' : 'Propulsão diesel-elétrica — motor elétrico principal',
        func: 'O motor elétrico (alimentado pela bateria e/ou diesel-geradores) gira o eixo; o hélice converte torque em empuxo, equilibrando a resistência hidrodinâmica.',
        vars: [
          V('Ordem / referência / real', `${fmt(p.rpmCmd, 0)} / ${fmt(p.rpmRef, 0)} / ${fmt(o.rpm, 1)} rpm`, 'MED'),
          V('Torque motor / hélice', `${fmt(p.motorTorque / 1e3, 1)} / ${fmt(p.propTorque / 1e3, 1)} kN·m`),
          V('Empuxo efetivo', fmtForce(p.thrust)),
          V('Resistência', fmtForce(-o.forces.resistance.F.x)),
          V('J', fmt(p.advance, 3)),
          V('Potência eixo / elétrica', `${fmtPower(p.shaftPower)} / ${fmtPower(p.elecPower)}`),
          V('Velocidade', `${fmt(toKnots(s.body.vel.x), 2)} nós`, 'MED'),
        ],
        state: p.failed ? 'FALHA' : p.powerLimited ? 'Limitado em potência' : 'Normal',
        influence: 'Empuxo − resistência = (m + m_a)·u̇: a velocidade muda lentamente pela grande inércia. A velocidade também define a efetividade dos lemes (∝ U²).',
        equations: [
          'I·ω̇ = Q_motor − Q_hélice − c·ω',
          'T = ρ·D⁴·K_T0·(n|n| − |n|·u_a/(D·J0T)),  u_a = u(1 − w)',
          'Q = ρ·D⁵·K_Q0·(n|n| − |n|·u_a/(D·J0Q))',
          'R = ½·ρ·S·C_t·(1 + k·f_sup)·u|u|',
          `|Q_motor| ≤ min(${fmt(m.maxTorque / 1e3, 0)} kN·m, P_disp/|ω|)`,
        ],
        predictions: [60, 100, 140, m.ratedRpm].map((r) => `${r} rpm ⇒ velocidade de regime submersa estimada ≈ ${fmt(toKnots(speedForRpm(e, r)), 1)} nós (sem limite de potência).`).concat([`Hélice: D = ${pr.diameter} m, ${pr.blades} pás, esteira w = ${pr.wakeFraction}, dedução t = ${pr.thrustDeduction}.`]),
        channels: ['speed', 'rpm', 'rpmCmd', 'power'],
      };
    }
    case 'battery':
    case 'electrical':
    case 'diesel': {
      const el = s.electrical;
      const b = v.electrical.battery;
      const h = el.current > 1 ? (el.soc * b.capacityAh) / el.current : Infinity;
      const e4 = (el.soc * b.capacityAh * el.ocv) / (v.electrical.hotelLoad + v.electrical.navLoad + 30e3);
      return {
        title: kind === 'diesel' ? 'Diesel-geradores e snorkel' : 'Sistema elétrico e bateria',
        func: 'Balanço energético simplificado: a bateria (e os geradores, com tomada de ar) alimentam propulsão, bombas, hidráulica, compressor, habitabilidade e instrumentos.',
        vars: [
          V('Estado de carga', `${fmt(el.soc * 100, 1)} %`),
          V('V_oc / V terminais', `${fmt(el.ocv, 0)} / ${fmt(el.voltage, 0)} V`, 'MED'),
          V('Corrente', `${fmt(el.current, 0)} A`, 'MED'),
          V('Demanda total', fmtPower(el.totalLoad), 'MED'),
          V('Geração diesel', fmtPower(el.generation), 'MED'),
          V('Combustível', `${fmt(el.fuel, 2)} m³`, 'MED'),
          V('Energia entregue às cargas', `${fmt(s.ledger.loadEnergy / 3.6e9, 3)} MWh`),
          V('Perdas internas (I²R)', `${fmt(s.ledger.batteryLoss / 3.6e6, 2)} kWh`),
        ],
        state: el.energized ? 'Barramento energizado' : 'BARRAMENTO DESENERGIZADO',
        influence: 'Sem energia: bombas param, a hidráulica perde pressão (lemes e válvulas imobilizam), o motor perde torque. O combustível consumido é compensado com água do mar (o submarino fica mais pesado).',
        equations: ['V_oc = V_min + (V_max − V_min)·SoC', 'I = (V_oc − √(V_oc² − 4R·P))/(2R)', 'dSoC/dt = −I/(3600·C_Ah)', 'ṁ_comb = sfc·P_ger'],
        predictions: [`Autonomia no consumo atual: ${Number.isFinite(h) ? fmt(h, 1) + ' h' : '—'}.`, `Autonomia só com cargas de bordo (~${fmtPower(v.electrical.hotelLoad + v.electrical.navLoad + 30e3)}): ≈ ${fmt(e4, 0)} h.`],
        channels: ['soc', 'power'],
      };
    }
    case 'sensor': {
      const d = SENSOR_DEFS.find((x) => x.id === sub)!;
      const st = s.sensors[d.id];
      const trueMap: Record<string, number> = {
        PRF1: o.depthKeel,
        PRF2: o.depthKeel,
        PEXT: o.pressureKeel / 1e5,
        GIRO: o.euler.heading,
        AGM: (o.euler.heading - e.env.cfg.magneticDeclination + 360) % 360,
        INSP: o.euler.pitch,
        INSR: o.euler.roll,
        DVLU: s.body.vel.x,
        ECO: o.altitude,
      };
      return {
        title: `${d.id} — ${d.name}`,
        func: d.description,
        vars: [V('Leitura', `${fmt(st.value, 3)} ${d.unit}`, 'MED'), V('Valor físico de referência', `${fmt(trueMap[d.id] ?? NaN, 3)} ${d.unit}`, 'VERD'), V('Modo de falha', st.failMode), V('Ruído/atraso', e.config.settings.advancedInstrumentation ? 'ATIVOS (modo avançado)' : 'desativados')],
        state: st.failMode !== 'normal' ? 'FALHA: ' + st.failMode : st.valid ? 'Válido' : 'Fora de alcance',
        influence: 'O controle automático e os alarmes usam a LEITURA do sensor, não o valor físico: uma falha de sensor pode levar o controlador a agir errado.',
        equations: d.id.startsWith('PRF') ? [`z_ind = (p − p_atm)/(ρ_cal·g), ρ_cal = ${RHO_CAL} kg/m³`, `densidade real local: ${fmt(o.rhoLocal, 2)} kg/m³ ⇒ diferença ${fmt((st.value - o.depthKeel) * 100, 1)} cm`] : d.id === 'AGM' ? ['ψ_mag = ψ_verd − declinação', `declinação = ${e.env.cfg.magneticDeclination}°`] : ['leitura = filtro_1ª ordem(valor) + ruído (modo avançado)'],
        predictions: ['Falha "congelado": leitura fixa — taxa de profundidade calculada vai a zero.', 'Falha "deriva": erro crescente — gera alarme de divergência quando há redundância.'],
        channels: d.id.startsWith('PRF') ? ['depthInd', 'depth'] : d.id === 'GIRO' ? ['heading'] : d.id === 'INSP' ? ['pitch'] : undefined,
      };
    }
    case 'autopilot': {
      const ap = s.autopilot;
      return {
        title: 'Controle automático (PID conceitual)',
        func: 'Mantém rumo, profundidade ou pitch atuando nos lemes, a partir das leituras dos sensores, respeitando batentes, velocidade dos atuadores e efetividade ∝ U².',
        vars: [
          V('Rumo', `${ap.headingMode} — ref ${fmt(ap.headingSet, 0)}° · erro ${fmt(ap.tHeading.error, 1)}° · saída ${fmt(ap.tHeading.output, 1)}°`, 'CMD'),
          V('Profundidade', `${ap.depthMode} — ref ${fmt(ap.depthSet, 0)} m · erro ${fmt(ap.tDepth.error, 1)} m · θ_cmd ${fmt(ap.tDepth.output, 1)}°`, 'CMD'),
          V('Pitch', `${ap.pitchMode} — saída lemes de ré ${fmt(ap.tPitch.output, 1)}°`, 'CMD'),
          V('Escalonamento (U₀/U)²', fmt(Math.min(4, (4 / Math.max(0.2, Math.abs(s.body.vel.x))) ** 2), 2)),
        ],
        state: ap.tPitch.lowEffectiveness || ap.tHeading.lowEffectiveness ? 'BAIXA EFETIVIDADE (velocidade insuficiente)' : 'Normal',
        influence: 'Em baixa velocidade os lemes saturam sem efeito; a profundidade passa a depender do equilíbrio estático — use a compensação.',
        equations: ['δ_r = K·[Kp·e_ψ + Ki·∫e_ψ − Kd·r]', 'θ_cmd = sat(Kz·e_z + Ki·∫e_z + Kzd·ż)', 'δ_ré = K·[Kθ·(θ_cmd − θ) + Ki·∫ − Kq·q];  δ_vante = K·[Kb·e_z + Kbd·ż]', 'K = min(4, (U₀/U)²)'],
        predictions: ['Comutar para AUTO inicializa o integrador com a posição atual (sem salto).', 'Mover manualmente um leme desengaja o canal.'],
        channels: ['depth', 'depthSet', 'heading', 'headingSet', 'stern', 'bow', 'rudder'],
      };
    }
    case 'buoyancy':
    case 'vertical': {
      const dp = e.env.gaugePressureAt(Math.max(0, s.body.pos.z));
      const comp = v.hull.compressibility * dp * e.compressibleVolume;
      const dRho100 = e.env.densityAt(s.body.pos.z + 100) - o.rhoLocal;
      const vComp100 = v.hull.compressibility * (e.env.gaugePressureAt(s.body.pos.z + 100) - dp) * e.compressibleVolume;
      return {
        title: 'Flutuabilidade e equilíbrio vertical',
        func: 'Princípio de Arquimedes: empuxo = peso do volume de água deslocado. A diferença entre empuxo e peso define a tendência vertical estática; lemes e casco acrescentam forças dinâmicas proporcionais a U².',
        vars: [
          V('Massa total', fmtMass(o.mp.mass)),
          V('Volume deslocado', `${fmt(o.forces.displacedVolume, 2)} m³`),
          V('Densidade local ρ(S,T,p)', `${fmt(o.rhoLocal, 3)} kg/m³`),
          V('Temperatura / salinidade', `${fmt(o.seaTemp, 2)} °C / ${fmt(o.salinity, 2)} PSU`),
          V('Empuxo ρ·V', fmtMass(o.displacementKg)),
          V('Flutuabilidade líquida', fmtMass(o.netBuoyancyKg)),
          V('Redução de volume por compressão do casco', `${fmt(comp, 3)} m³`),
          V('Velocidade vertical', `${fmt(o.verticalSpeed, 3)} m/s (+ desce)`, 'VERD'),
        ],
        state: Math.abs(o.netBuoyancyKg) < 100 ? 'NEUTRA' : o.netBuoyancyKg > 0 ? 'POSITIVA' : 'NEGATIVA',
        influence: 'Positiva: tende a subir; negativa: tende a descer; neutra: permanece (equilíbrio indiferente/instável com a profundidade).',
        equations: ['E = ρ(S,T,p)·g·V_imerso·(1 − c_casco·Δp)', 'F = (E − m·g)', '(m + m_a)·ẇ = Σ F_z', 'v_terminal: ½ρC_dc·A_lat·v² + c·v = |F|'],
        predictions: [
          `Descendo 100 m: ρ varia ${fmt(dRho100, 3)} kg/m³ (${fmtMass(dRho100 * o.forces.displacedVolume)} de empuxo) e o casco perde ${fmt(vComp100, 3)} m³ (${fmtMass(-vComp100 * o.rhoLocal)}).`,
          `Com a flutuabilidade atual e velocidade nula, velocidade vertical terminal ≈ ${fmt(terminalVz(e, o.netBuoyancyKg), 3)} m/s.`,
        ],
        channels: ['net', 'vz', 'depth', 'rho'],
      };
    }
    case 'attitude':
      return inspectorContent(e, 'trim');
  }
  return null;
}
