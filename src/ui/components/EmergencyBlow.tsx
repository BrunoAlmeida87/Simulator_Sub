/**
 * SOPRO DE EMERGÊNCIA com tampa de proteção — o mesmo controle em todas as telas
 * (Operação, Central de comando, Lastro). Fechado → “Levantar tampa” → em até
 * 5 s “SOPRAR TODOS OS TLP” → ativo (com “Fechar sopro de emergência”). Um clique
 * sozinho nunca dispara o sopro. Na Sala de comando a alavanca 3D tem a mesma
 * lógica (ControlRoomScene.addEmergency). Só lê o estado e envia Commands.
 */
import { useEffect, useState } from 'react';
import { cmd } from '../store';
import type { SimulationEngine } from '../../sim/core/engine';
import { bankPressure, emergencyBlowActive } from '../../sim/systems/hpAir';
import { fmt, fmtTime } from '../format';

/** prazo para soprar depois de levantar a tampa */
export const ARM_MS = 5000;

export function EmergencyBox({ e }: { e: SimulationEngine }) {
  const s = e.state;
  const v = e.vessel;
  const active = emergencyBlowActive(s);
  const [armedAt, setArmedAt] = useState(0);
  const armed = !active && armedAt > 0 && performance.now() - armedAt < ARM_MS;
  useEffect(() => {
    if (!armedAt) return;
    const t = window.setTimeout(() => setArmedAt(0), ARM_MS);
    return () => window.clearTimeout(t);
  }, [armedAt]);
  const banks = v.hpAir.banks.filter((b) => b.purpose === 'emergency');
  const pEm = banks.length ? Math.min(...banks.map((b) => bankPressure(v.hpAir, b.id, s.hpAir.banks[b.id].mass) / 1e5)) : 0;
  const fill = v.ballast.tanks.reduce((a, t) => a + s.ballast[t.id].water, 0) / v.ballast.tanks.reduce((a, t) => a + t.volume, 0);
  const rec = active ? [...s.commands].reverse().find((r) => r.text.startsWith('SOPRO DE EMERGÊNCIA')) : undefined;
  if (active)
    return (
      <div className="ops-emer on" role="region" aria-label="Sopro de emergência">
        <b>SOPRO DE EMERGÊNCIA ATIVO{rec ? ` · há ${fmtTime(s.t - rec.t)}` : ''}</b>
        <button onClick={() => cmd({ type: 'emergencyBlow', open: false })}>Fechar sopro de emergência</button>
        <small>
          Ampolas de emergência {fmt(pEm, 0)} bar · TLP {fmt(fill * 100, 0)} % · compressor automático
        </small>
      </div>
    );
  if (armed)
    return (
      <div className="ops-emer armed" role="region" aria-label="Sopro de emergência">
        <b>TAMPA LEVANTADA</b>
        <button
          className="fire"
          onClick={() => {
            cmd({ type: 'emergencyBlow' });
            setArmedAt(0);
          }}
        >
          SOPRAR TODOS OS TLP
        </button>
        <small>
          Fecha suspiros e sopro normal, abre as ampolas ·{' '}
          <button className="link" onClick={() => setArmedAt(0)}>
            baixar tampa
          </button>
        </small>
      </div>
    );
  return (
    <div className="ops-emer" role="region" aria-label="Sopro de emergência">
      <b>SOPRO DE EMERGÊNCIA</b>
      <button onClick={() => setArmedAt(performance.now())} title="Primeiro levante a tampa; depois, em até 5 s, sopre">
        ⛉ Levantar tampa
      </button>
      <small>Fechado · ampolas de emergência {fmt(pEm, 0)} bar</small>
    </div>
  );
}
