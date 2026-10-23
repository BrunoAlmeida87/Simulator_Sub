/**
 * REDE DA COMPENSAÇÃO — vazões por trecho de tubulação, derivadas do estado.
 *
 * Topologia: um coletor único liga a admissão de mar (V-AM), a sucção da
 * bomba BC (→ V-DM → mar) e o ramal de cada tanque: o central (VC → TC) e os
 * dois de banda (VC-BB → TB-BB, VC-BE → TB-BE). Cada nó do
 * coletor injeta uma vazão: admissão +Q_adm, bomba −Q_desc, tanque −Q_tanque
 * (Q_tanque > 0 = enchendo). Num trecho entre dois nós vizinhos a vazão é a
 * soma das injeções de um lado (conservação de massa); o sinal dá o sentido.
 *
 * Usado pelos diagramas (2D e 3D) para animar só o que a física move e no
 * sentido em que move. Não altera a simulação.
 */
import type { CompensationConfig, TransferSystemConfig } from '../config/types';
import type { CompensationState, TransferState } from '../core/state';
import { compensationBranches } from './internalTanks';

export interface ManifoldNode {
  id: string;
  /** posição ao longo do coletor (qualquer unidade crescente) */
  x: number;
  /** vazão injetada no coletor, m³/s (negativa = sai do coletor) */
  q: number;
}

export interface ManifoldSegment {
  from: ManifoldNode;
  to: ManifoldNode;
  /** m³/s; positiva = de `from` para `to` (sentido de x crescente) */
  q: number;
}

export interface CompensationFlows {
  /** admissão de mar → coletor */
  qIn: number;
  /** coletor → bomba → V-DM → mar */
  qOut: number;
  /** coletor → tanque (positiva enchendo, negativa esvaziando) */
  tanks: Record<string, number>;
  /** abaixo disto a vazão é tratada como nula (as densidades do mar e nominal diferem ~0,3 %) */
  tol: number;
}

/** Vazões da compensação; com `heelCfg`/`heelSt`, inclui os ramais dos tanques de banda (vazão de compensação, sem a transferência BB ↔ BE). */
export function compensationFlows(cfg: CompensationConfig, st: CompensationState, heelCfg?: TransferSystemConfig, heelSt?: TransferState): CompensationFlows {
  const tanks: Record<string, number> = {};
  let big = Math.max(st.qIn, st.qOut);
  for (const b of compensationBranches(cfg, st, heelCfg, heelSt)) {
    const q = (b.st.flow ?? 0) - (b.st.transferFlow ?? 0);
    tanks[b.id] = q;
    big = Math.max(big, Math.abs(q));
  }
  return { qIn: st.qIn, qOut: st.qOut, tanks, tol: Math.max(1e-5, 0.02 * big) };
}

/** zera vazões menores que a tolerância */
export const clean = (q: number, tol: number): number => (Math.abs(q) < tol ? 0 : q);

/** Vazão de cada trecho do coletor entre nós vizinhos (ordenados por x). */
export function manifoldSegments(nodes: ManifoldNode[], tol: number): ManifoldSegment[] {
  const s = [...nodes].sort((a, b) => a.x - b.x);
  const out: ManifoldSegment[] = [];
  let acc = 0;
  for (let i = 0; i < s.length - 1; i++) {
    acc += s[i].q;
    out.push({ from: s[i], to: s[i + 1], q: clean(acc, tol) });
  }
  return out;
}

/** Nós do coletor nas posições dadas (admissão, bomba e um por tanque). */
export function compensationNodes(f: CompensationFlows, xInlet: number, xPump: number, xTank: Record<string, number>): ManifoldNode[] {
  return [{ id: 'inlet', x: xInlet, q: f.qIn }, { id: 'pump', x: xPump, q: -f.qOut }, ...Object.keys(xTank).map((id) => ({ id, x: xTank[id], q: -(f.tanks[id] ?? 0) }))];
}
