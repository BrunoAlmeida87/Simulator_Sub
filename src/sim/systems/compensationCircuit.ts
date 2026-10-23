/** A mesma rede hidráulica alimenta a física, o esquema 2D e as tubulações 3D.
 * VDC 4/2: A e B são os coletores selecionados; T é a sucção e P a descarga.
 * Direta: A→T, P→B. Inversa: B→T, P→A. Durante a comutação, as vias ficam temporariamente bloqueadas.
 */
import type { CompensationState, CompensationTransferState } from '../core/state';

export type DirectionalPosition = 'direta' | 'inversa' | 'transito';
export interface CircuitEdge {
  id: string;
  from: string;
  to: string;
  open: boolean;
  directed?: boolean;
}
export interface CircuitRoute {
  source: string;
  destination: string;
  steps: { edge: string; sign: number }[];
}
export interface CompensationCircuit {
  position: DirectionalPosition;
  isolated: boolean;
  edges: CircuitEdge[];
  route: CircuitRoute | null;
}

export function directionalPosition(pos: number): DirectionalPosition {
  if (pos < 0.001) return 'direta';
  if (pos > 0.999) return 'inversa';
  return 'transito';
}

export function buildCompensationCircuit(st: CompensationState, tankIds: string[]): CompensationCircuit {
  const tr = st.transfer;
  const position = tr ? directionalPosition(tr.direction.pos) : 'transito';
  const isolated = st.inlet.pos < 0.001 && st.discharge.pos < 0.001 && st.pump.speed < 0.001 && !st.dosing?.active;
  const edges: CircuitEdge[] = [];
  for (const id of tankIds) {
    edges.push({ id: `${id}:A`, from: `tank:${id}`, to: 'header:A', open: !!tr && tr.source === id && tr.valveA.pos > 0.02 });
    edges.push({ id: `${id}:B`, from: `tank:${id}`, to: 'header:B', open: !!tr && tr.destination === id && tr.valveB.pos > 0.02 });
  }
  edges.push(
    { id: 'header:A', from: 'header:A', to: 'vdc:A', open: true },
    { id: 'header:B', from: 'header:B', to: 'vdc:B', open: true },
    { id: 'suction', from: 'vdc:T', to: 'pump:in', open: true },
    { id: 'pump', from: 'pump:in', to: 'pump:out', open: true, directed: true },
    { id: 'discharge', from: 'pump:out', to: 'vdc:P', open: true },
    { id: 'A:T', from: 'vdc:A', to: 'vdc:T', open: position === 'direta', directed: true },
    { id: 'P:B', from: 'vdc:P', to: 'vdc:B', open: position === 'direta', directed: true },
    { id: 'B:T', from: 'vdc:B', to: 'vdc:T', open: position === 'inversa', directed: true },
    { id: 'P:A', from: 'vdc:P', to: 'vdc:A', open: position === 'inversa', directed: true },
  );
  const routes = findPumpRoutes(edges, tankIds);
  return { position, isolated, edges, route: isolated && routes.length === 1 ? routes[0] : null };
}

/** Só existe transferência com um caminho contínuo que atravesse a bomba. */
export function findPumpRoutes(edges: CircuitEdge[], tankIds: string[]): CircuitRoute[] {
  const routes: CircuitRoute[] = [];
  for (const source of tankIds) {
    const walk = (node: string, visited: Set<string>, steps: CircuitRoute['steps']) => {
      if (node.startsWith('tank:') && node !== `tank:${source}`) {
        if (steps.some(s => s.edge === 'pump')) routes.push({ source, destination: node.slice(5), steps });
        return;
      }
      for (const edge of edges) {
        if (!edge.open) continue;
        const sign = edge.from === node ? 1 : !edge.directed && edge.to === node ? -1 : 0;
        if (!sign) continue;
        const next = sign > 0 ? edge.to : edge.from;
        if (visited.has(next)) continue;
        walk(next, new Set([...visited, next]), [...steps, { edge: edge.id, sign }]);
      }
    };
    walk(`tank:${source}`, new Set([`tank:${source}`]), []);
  }
  return routes;
}

export function circuitEdgeFlow(circuit: CompensationCircuit, edge: string, pumpFlow: number): number {
  return (circuit.route?.steps.find(s => s.edge === edge)?.sign ?? 0) * Math.abs(pumpFlow);
}

/** Uma via por tanque e por coletor; portas não selecionadas ficam fechadas. */
export function selectorValve(tr: CompensationTransferState, tank: string, header: 'A' | 'B') {
  const selected = header === 'A' ? tr.source : tr.destination;
  return selected === tank ? (header === 'A' ? tr.valveA : tr.valveB) : { cmd: 0, pos: 0, stuck: false };
}
