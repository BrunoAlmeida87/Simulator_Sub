/**
 * Sistemas → Visão geral: um cartão por sistema com os números principais e a cor
 * do pior alarme (nível 1 de uma hierarquia de telas: visão geral → tela de detalhe).
 * Só LÊ o estado; os botões apenas trocam de tela ou abrem o grupo na tela Operação.
 */
import type { ReactNode } from 'react';
import { useSim } from '../store';
import { useUi } from '../uiContext';
import { visibleAlarms } from '../../sim/systems/alarms';
import { bankPressure } from '../../sim/systems/hpAir';
import { compensationWater } from '../../sim/systems/internalTanks';
import { RHO_NOMINAL } from '../../sim/core/context';
import { failureCatalog, isFailureActive } from '../../sim/commands';
import type { SimulationEngine } from '../../sim/core/engine';
import { fmt, fmtPower, fmtSpeed } from '../format';
import { opsBus, type GroupId } from '../ops/opsBus';
import { screenLabel, type ScreenId } from '../nav';

interface Kpi {
  label: string;
  value: string;
  unit?: string;
  tone?: 'warn' | 'alarm';
}

interface SysCard {
  id: string;
  title: string;
  about: string;
  /** sistemas dos alarmes (alarms.ts) que colorem o cartão ('*' = todos) */
  systems: string[];
  /** telas de detalhe */
  screens: ScreenId[];
  /** grupo correspondente na central de operação (tela Operação) */
  ops?: GroupId;
  kpis: (e: SimulationEngine) => Kpi[];
  warn?: (e: SimulationEngine) => boolean;
}

const ballastFill = (e: SimulationEngine) => e.vessel.ballast.tanks.reduce((a, t) => a + e.state.ballast[t.id].water, 0) / e.vessel.ballast.tanks.reduce((a, t) => a + t.volume, 0);
const onOff = (on: boolean, a: string, b: string) => (on ? a : b);

const CARDS: SysCard[] = [
  {
    id: 'lastro',
    title: 'Lastro principal (TLP)',
    about: 'Transição superfície ↔ imersão',
    systems: ['Lastro'],
    screens: ['lastro'],
    ops: 'lastro',
    kpis: (e) => {
      const t = e.vessel.ballast.tanks;
      const vent = t.some((x) => e.state.ballast[x.id].vent.cmd > 0.5);
      const blow = t.some((x) => e.state.ballast[x.id].blow.cmd > 0.5);
      return [
        { label: 'TLP cheios', value: fmt(ballastFill(e) * 100, 0), unit: '%' },
        { label: 'Suspiros', value: onOff(vent, 'ABERTOS', 'fechados'), tone: vent ? 'warn' : undefined },
        { label: 'Sopro', value: onOff(blow, 'SOPRANDO', 'fechado'), tone: blow ? 'warn' : undefined },
      ];
    },
  },
  {
    id: 'comp',
    title: 'Compensação',
    about: 'Ajuste fino do peso submerso',
    systems: ['Fluidos'],
    screens: ['lastro'],
    ops: 'comp',
    kpis: (e) => {
      const c = e.state.compensation;
      const vol = compensationWater(e.vessel.compensation, c, e.vessel.heel, e.state.heel) / RHO_NOMINAL;
      const o = e.outputs;
      return [
        { label: 'Água (TC + TB)', value: fmt(vol, 2), unit: 'm³' },
        o.surfaced
          ? { label: 'Reserva', value: fmt(o.reserveKg / 1000, 1), unit: 't' }
          : { label: 'Flutuab.', value: fmt(o.netBuoyancyKg / 1000, 2), unit: 't', tone: Math.abs(o.netBuoyancyKg) > 2000 ? 'warn' : undefined },
        { label: 'Bomba', value: c.dosing?.active ? 'DOSANDO' : onOff(c.pump.speed > 0.05, 'ligada', 'parada') },
      ];
    },
  },
  {
    id: 'trim',
    title: 'Trim e banda',
    about: 'Atitude de equilíbrio pela distribuição de pesos',
    systems: ['Atitude'],
    screens: ['trim'],
    ops: 'trim',
    kpis: (e) => [
      { label: 'Pitch θ', value: fmt(e.outputs.euler.pitch, 1), unit: '°' },
      { label: 'Equilíbrio', value: fmt(e.outputs.staticPitchEq, 1), unit: '°' },
      { label: 'Banda φ', value: fmt(e.outputs.euler.roll, 1), unit: '°' },
    ],
  },
  {
    id: 'ar',
    title: 'Ar comprimido (AP)',
    about: 'Sopro dos TLP e recarga pelo compressor',
    systems: ['Ar comprimido'],
    screens: ['lastro', 'auxiliares'],
    ops: 'ar',
    kpis: (e) => {
      const v = e.vessel.hpAir;
      const pmin = Math.min(...v.banks.map((b) => bankPressure(v, b.id, e.state.hpAir.banks[b.id].mass) / 1e5));
      return [
        { label: 'Menor garrafa', value: fmt(pmin, 0), unit: 'bar', tone: pmin < 100 ? 'warn' : undefined },
        { label: 'Coletor', value: fmt(e.outputs.hpManifoldBar, 0), unit: 'bar' },
        { label: 'Compressor', value: onOff(e.state.hpAir.compressorRunning, 'em carga', 'parado') },
      ];
    },
    warn: (e) => e.outputs.hpManifoldBar < 60,
  },
  {
    id: 'propulsao',
    title: 'Propulsão',
    about: 'Motor elétrico, linha de eixo e hélice',
    systems: ['Propulsão'],
    screens: ['propulsao'],
    ops: 'nav',
    kpis: (e) => [
      { label: 'Rotação', value: fmt(e.outputs.rpm, 0), unit: 'rpm' },
      { label: 'Velocidade', value: fmtSpeed(e.outputs.speed) },
      { label: 'Potência eixo', value: fmtPower(e.state.propulsion.shaftPower) },
    ],
  },
  {
    id: 'energia',
    title: 'Energia e snorkel',
    about: 'Bateria, barramento, diesel-geradores',
    systems: ['Elétrico'],
    screens: ['propulsao', 'energia'],
    ops: 'energia',
    kpis: (e) => {
      const el = e.state.electrical;
      const run = e.vessel.electrical.generators.filter((g) => el.generators[g.id].status === 'EM CARGA').length;
      return [
        { label: 'Bateria', value: fmt(el.soc * 100, 0), unit: '%', tone: el.soc < 0.08 ? 'alarm' : el.soc < 0.25 ? 'warn' : undefined },
        { label: 'Demanda', value: fmtPower(el.totalLoad) },
        { label: 'Geradores', value: run ? `${run} em carga` : 'parados' },
      ];
    },
    warn: (e) => e.state.electrical.soc < 0.25 || !e.state.electrical.energized,
  },
  {
    id: 'hid',
    title: 'Hidráulica e governo',
    about: 'Atuação de lemes, válvulas e mastros',
    systems: ['Hidráulica', 'Governo'],
    screens: ['auxiliares', 'comando'],
    ops: 'nav',
    kpis: (e) => {
      const jam = Object.values(e.state.surfaces).filter((x) => x.jammed).length;
      return [
        { label: 'Pressão', value: fmt(e.state.hydraulics.pressure / 1e5, 0), unit: 'bar', tone: e.state.hydraulics.pressure < e.vessel.hydraulics.minPressure * 1.25 ? 'warn' : undefined },
        { label: 'Bomba', value: onOff(e.state.hydraulics.pumpOn, 'em carga', 'em espera') },
        { label: 'Lemes', value: jam ? `${jam} travado${jam > 1 ? 's' : ''}` : 'livres', tone: jam ? 'alarm' : undefined },
      ];
    },
  },
  {
    id: 'seg',
    title: 'Segurança',
    about: 'Todos os alarmes, sensores redundantes e falhas de treinamento',
    systems: ['*'],
    screens: ['seguranca'],
    ops: 'falhas',
    kpis: (e) => {
      const vis = visibleAlarms(e.state);
      const act = vis.filter((a) => a.active).length;
      const un = vis.filter((a) => !a.acked).length;
      const fails = failureCatalog(e).filter((f) => isFailureActive(e, f.target)).length;
      return [
        { label: 'Alarmes ativos', value: String(act), tone: act ? 'warn' : undefined },
        { label: 'Sem reconhecer', value: String(un), tone: un ? 'warn' : undefined },
        { label: 'Falhas injetadas', value: String(fails), tone: fails ? 'warn' : undefined },
      ];
    },
    warn: (e) => failureCatalog(e).some((f) => isFailureActive(e, f.target)),
  },
];

type Status = 'ok' | 'warn' | 'alarm';
const STATUS_TEXT: Record<Status, string> = { ok: 'NORMAL', warn: 'ATENÇÃO', alarm: 'ALARME' };

export function SystemsOverview() {
  const e = useSim(4);
  const ui = useUi();
  const vis = visibleAlarms(e.state);
  return (
    <div className="sysov">
      <p className="subtle sysov-intro">
        Resumo de cada sistema, com a cor do pior alarme (<span className="badge alarm">ALARME</span> <span className="badge warn">ATENÇÃO</span> <span className="badge ok">NORMAL</span>). Os botões abrem a tela de
        detalhe ou o grupo do sistema na tela Operação.
      </p>
      <div className="sysov-grid">
        {CARDS.map((c) => {
          const al = c.systems.includes('*') ? vis : vis.filter((a) => c.systems.includes(a.def.system));
          const status: Status = al.some((a) => a.active && a.def.priority <= 2) ? 'alarm' : al.length || c.warn?.(e) ? 'warn' : 'ok';
          const top = al[0];
          let actions: ReactNode[] = c.screens.map((s) => (
            <button key={s} className="btn sm" onClick={() => ui.setScreen(s)} title={`Abrir a tela ${screenLabel(s)}`}>
              {screenLabel(s)} →
            </button>
          ));
          if (c.ops) {
            const g = c.ops;
            actions = actions.concat(
              <button
                key="ops"
                className="btn sm"
                onClick={() => {
                  ui.setScreen('pilotagem');
                  opsBus.focus(g);
                }}
                title="Abrir o grupo deste sistema na central de operação (tela Operação)"
              >
                Operação ↗
              </button>,
            );
          }
          return (
            <section key={c.id} className={`sysov-card ${status}`} aria-label={`${c.title}: ${STATUS_TEXT[status]}`}>
              <header>
                <h3>{c.title}</h3>
                <span className={`badge ${status}`}>{STATUS_TEXT[status]}</span>
              </header>
              <div className="sysov-about">{c.about}</div>
              <div className="sysov-kpis">
                {c.kpis(e).map((k) => (
                  <div key={k.label} className={`sysov-kpi ${k.tone ?? ''}`}>
                    <small>{k.label}</small>
                    <b className={/^[-+]?\d/.test(k.value) ? undefined : 'txt'}>
                      {k.value}
                      {k.unit && <span>{k.unit}</span>}
                    </b>
                  </div>
                ))}
              </div>
              <div className={`sysov-alarm ${top ? (top.active && top.def.priority <= 2 ? 'alarm' : 'warn') : ''}`}>
                {top ? `${top.active ? '' : '(normalizado) '}${top.def.text}${al.length > 1 ? ` · +${al.length - 1}` : ''}` : 'sem alarmes deste sistema'}
              </div>
              <footer className="btngroup">{actions}</footer>
            </section>
          );
        })}
      </div>
    </div>
  );
}
