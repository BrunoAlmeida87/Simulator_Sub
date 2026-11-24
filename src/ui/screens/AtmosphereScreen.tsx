/** Sistemas › Atmosfera: composição do ar interno, equipamentos de purificação, ventilação e autonomia. */
import { cmd, useSim } from '../store';
import { Panel } from '../components/Panel';
import { KV, LevelRow, OnOff, Toggle } from '../components/StatusBits';
import { atmosphereEndurance, atmospherePercent, atmosphereRates, peopleAboard, ventilationAch } from '../../sim/systems/atmosphere';
import { defaultAtmosphere } from '../../sim/config/extSystems';
import { loadPowered } from '../../sim/systems/distribution';
import { fmt } from '../format';

export function AtmosphereScreen() {
  const e = useSim(4);
  const s = e.state;
  const at = s.atmosphere;
  const p = atmospherePercent(s);
  if (!at || !p) return <div className="panel">Atmosfera indisponível.</div>;
  const cfg = e.vessel.atmosphere ?? defaultAtmosphere();
  const powered = loadPowered(s, 'HOTEL');
  const end = atmosphereEndurance(e.vessel, s);
  const people = peopleAboard(e.vessel, s);
  const ach = ventilationAch(e.vessel, s, powered);
  const charging = s.electrical.current < 0;
  const rates = atmosphereRates(e.vessel, s, powered);
  const kgh = (x: number) => fmt(x * 3600, 2);
  return (
    <div className="grid">
      <Panel title="Composição do ar interno">
        <LevelRow label="Oxigênio (O₂)" value={p.o2} unit="%" digits={2} min={14} max={23} warn={18} alarm={16} low note="Normal ≈ 20,9 %. Abaixo de 18 %: atenção; abaixo de 16 %: alarme." />
        <LevelRow label="Gás carbônico (CO₂)" value={p.co2} unit="%" digits={2} max={4} warn={1.5} alarm={3} note="Absorvedores ligados mantêm um equilíbrio abaixo de 1 % com a tripulação normal." />
        <LevelRow label="Hidrogênio (H₂)" value={p.h2} unit="%" digits={2} max={4} warn={2} alarm={3} note="Liberado no fim da recarga da bateria. Limite inferior de explosividade ≈ 4 %." />
        <LevelRow label="Monóxido de carbono (CO)" value={p.coPpm} unit="ppm" digits={0} max={400} warn={50} alarm={200} note="Produzido por incêndio (Controle de avarias)." />
      </Panel>

      <Panel title="Purificação e ventilação">
        <div className="btnrow">
          <Toggle on={at.scrubbers} onClick={() => cmd({ type: 'atmosphere', scrubbers: !at.scrubbers })} title="Absorvedores de CO₂">
            Absorvedores de CO₂
          </Toggle>
          <OnOff on={at.scrubbers && powered} onText="REMOVENDO" offText={at.scrubbers ? 'SEM ENERGIA' : 'DESLIGADOS'} />
        </div>
        <div className="btnrow">
          <Toggle on={at.recombiners} onClick={() => cmd({ type: 'atmosphere', recombiners: !at.recombiners })} title="Queimadores (recombinadores) de H₂">
            Queimadores de H₂
          </Toggle>
          <OnOff on={at.recombiners && powered} onText="QUEIMANDO" offText={at.recombiners ? 'SEM ENERGIA' : 'DESLIGADOS'} />
        </div>
        <div className="btnrow">
          <Toggle on={at.o2Release} onClick={() => cmd({ type: 'atmosphere', o2Release: !at.o2Release })} title="Liberar O₂ de reserva (garrafas/candelas)">
            Liberar O₂ de reserva
          </Toggle>
          <span className="subtle">
            reserva {fmt(at.o2Stock, 0)} kg ({fmt(at.o2Stock / Math.max(1e-9, people * cfg.o2Use) / 3600, 0)} h para {people} pessoas)
          </span>
        </div>
        <div className="btnrow">
          <Toggle on={at.ventFan} onClick={() => cmd({ type: 'atmosphere', ventFan: !at.ventFan })} title="Ventilador de admissão pelo mastro do snorkel">
            Ventilador do snorkel
          </Toggle>
          <OnOff on={ach > 0} onText={`VENTILANDO ${fmt(ach, 0)} ren./h`} offText={s.snorkel.headValveOpen ? 'PARADO' : 'VÁLVULA DE CABEÇA FECHADA'} />
        </div>
        <p className="subtle">
          A renovação de ar só acontece com a válvula de cabeça do snorkel aberta (mastro içado com a cabeça fora d’água). Cada diesel em carga aspira ar e renova também. Os equipamentos fazem parte da carga de
          habitabilidade (disjuntor HOTEL).
        </p>
      </Panel>

      <Panel title="Autonomia e balanço">
        <KV
          rows={[
            ['Pessoas a bordo', `${people} (tripulação ${cfg.crew} + cargas “pessoas”)`],
            ['Consumo de O₂', `${kgh(people * cfg.o2Use)} kg/h`],
            ['Produção de CO₂', `${kgh(people * cfg.co2Make)} kg/h`],
            ['Balanço O₂ (sem ventilação)', `${kgh(rates.o2)} kg/h`],
            ['Balanço CO₂ (sem ventilação)', `${kgh(rates.co2)} kg/h`],
            ['H₂ da recarga', charging ? `${kgh(Math.max(0, rates.h2))} kg/h (corrente ${fmt(-s.electrical.current, 0)} A, SoC ${fmt(s.electrical.soc * 100, 0)} %)` : 'sem recarga'],
            ['Autonomia estimada', Number.isFinite(end.hours) ? `${fmt(end.hours, 1)} h (limite: ${end.limit === 'O₂' ? 'O₂ < 17 %' : 'CO₂ > 3 %'})` : 'estável (sem piora)'],
          ]}
        />
        <p className="subtle">
          Estimativa linear com as taxas atuais, sem ventilação (pior caso submerso). Experimente desligar os absorvedores, recarregar a bateria perto de 100 % sem ventilação, ou injetar um incêndio em Controle de
          avarias.
        </p>
      </Panel>
    </div>
  );
}
