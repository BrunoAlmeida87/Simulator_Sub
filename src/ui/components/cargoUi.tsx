/** Cargas a bordo: estilos, modelos prontos, nomes automáticos, posição dentro do casco e dica (tooltip) em SVG. */
import type { SimulationEngine } from '../../sim/core/engine';
import type { CargoLoad } from '../../sim/core/state';
import type { Vec3 } from '../../sim/core/math';
import { fmt } from '../format';

export type CargoCategory = CargoLoad['category'];

export const CARGO_STYLE: Record<CargoCategory, { label: string; color: string; icon: string }> = {
  pessoas: { label: 'Pessoas', color: '#5ec8ff', icon: '👤' },
  carga: { label: 'Carga', color: '#ffb347', icon: '📦' },
  torpedos: { label: 'Torpedos (fictícios)', color: '#ff6b81', icon: '🚀' },
  equipamentos: { label: 'Equipamentos', color: '#b48cff', icon: '⚙' },
};
export const CARGO_CATEGORIES = Object.keys(CARGO_STYLE) as CargoCategory[];

export interface CargoModel {
  id: string;
  label: string;
  category: CargoCategory;
  /** nome-base: o painel acrescenta o número (Torpedo 1, Torpedo 2…) */
  base: string;
  quantity: number;
  unitMass: number;
  position: Vec3;
}

/** Modelos prontos: um clique preenche tipo, nome, quantidade, massa e um local típico. */
export const CARGO_MODELS: CargoModel[] = [
  { id: 'tripulante', label: 'Tripulante', category: 'pessoas', base: 'Tripulante', quantity: 1, unitMass: 85, position: { x: 3, y: 0, z: 0.5 } },
  { id: 'equipe', label: 'Equipe (10 pessoas)', category: 'pessoas', base: 'Equipe', quantity: 10, unitMass: 85, position: { x: 3, y: 0, z: 0.5 } },
  { id: 'mergulhadores', label: 'Mergulhadores', category: 'pessoas', base: 'Mergulhadores', quantity: 4, unitMass: 130, position: { x: 17, y: 0, z: 0.5 } },
  { id: 'torpedo', label: 'Torpedo', category: 'torpedos', base: 'Torpedo', quantity: 1, unitMass: 1500, position: { x: 20, y: 0, z: 0.8 } },
  { id: 'mantimentos', label: 'Mantimentos', category: 'carga', base: 'Mantimentos', quantity: 2, unitMass: 250, position: { x: -2, y: 0, z: 1.5 } },
  { id: 'lastro', label: 'Lastro sólido', category: 'carga', base: 'Lastro sólido', quantity: 1, unitMass: 1000, position: { x: 0, y: 0, z: 2.2 } },
  { id: 'sobressalentes', label: 'Sobressalentes', category: 'equipamentos', base: 'Sobressalentes', quantity: 1, unitMass: 300, position: { x: -9, y: 0, z: 1 } },
  { id: 'eletronico', label: 'Equip. eletrônico', category: 'equipamentos', base: 'Equipamento', quantity: 1, unitMass: 800, position: { x: 5, y: 0, z: -0.5 } },
];

/** nome-base padrão de cada tipo (quando o nome fica em branco) */
export const CATEGORY_BASE: Record<CargoCategory, string> = { pessoas: 'Pessoas', carga: 'Carga', torpedos: 'Torpedo', equipamentos: 'Equipamento' };

export const cargoMass = (l: Pick<CargoLoad, 'quantity' | 'unitMass'>) => l.quantity * l.unitMass;

/** Próximo nome livre: "Torpedo 1", "Torpedo 2"… (ignora a própria carga em edição). */
export function nextCargoName(base: string, loads: readonly CargoLoad[], excludeId = ''): string {
  const b = base.trim() || 'Carga';
  const used = new Set(loads.filter((l) => l.id !== excludeId).map((l) => l.name.trim().toLowerCase()));
  for (let n = 1; ; n++) if (!used.has(`${b} ${n}`.toLowerCase())) return `${b} ${n}`;
}

export const newCargoId = () => `cargo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const round = (v: number, step: number) => Math.round(v / step) * step;
const trunc2 = (v: number) => Math.trunc(v * 100) / 100;

/** Leva a posição para dentro do casco resistente (com folga), arredondada: X a 0,5 m; Y e Z a 0,1 m. */
export function clampInHull(e: SimulationEngine, p: Vec3, margin = 0.2): Vec3 {
  const half = e.vessel.hull.length / 2 - 0.5;
  const x = Math.max(-half, Math.min(half, round(p.x, 0.5)));
  let y = round(p.y, 0.1);
  let z = round(p.z, 0.1);
  const r = Math.max(0, e.geom.radiusAt(x) - margin);
  const d = Math.hypot(y, z);
  if (d > r) {
    const f = d > 0 ? r / d : 0;
    y = trunc2(y * f);
    z = trunc2(z * f);
  }
  // evita "-0" nos campos
  return { x: x + 0, y: y + 0, z: z + 0 };
}

export const insideHull = (e: SimulationEngine, p: Vec3) => Math.abs(p.x) <= e.vessel.hull.length / 2 && Math.hypot(p.y, p.z) <= e.geom.radiusAt(p.x);

/** Compartimento pela posição longitudinal (nomes dos compartimentos do navio). */
export function compartmentOf(e: SimulationEngine, x: number): string {
  const c = e.vessel.compartments.find((k) => x <= k.xFwd && x >= k.xAft);
  if (c) return c.name;
  const fwd = Math.max(...e.vessel.compartments.map((k) => k.xFwd));
  return x > fwd ? 'Proa (vante do compartimento de vante)' : 'Popa (ré da praça de máquinas)';
}

export const sideOf = (y: number) => (y < -0.25 ? 'bombordo' : y > 0.25 ? 'boreste' : 'linha de centro');
export const heightOf = (z: number) => (z < -0.6 ? 'alto' : z > 1.3 ? 'baixo (porão)' : 'meia altura');

/** Linhas da dica de uma carga (nome primeiro). */
export function cargoTipLines(e: SimulationEngine, l: CargoLoad): string[] {
  const m = cargoMass(l);
  const { x, y, z } = l.position;
  return [
    l.name,
    `${CARGO_STYLE[l.category]?.label ?? l.category} · ${l.quantity} × ${fmt(l.unitMass, 0)} kg = ${fmt(m / 1000, m < 1000 ? 3 : 2)} t`,
    `${compartmentOf(e, x)} · ${sideOf(y)} · ${heightOf(z)}`,
    `X ${fmt(x, 1)} m · Y ${fmt(y, 1)} m · Z ${fmt(z, 1)} m`,
  ];
}

/** Raio do marcador conforme a massa (visível mesmo para uma pessoa; limitado para cargas grandes). */
export const markerRadius = (kg: number) => Math.min(11, 4.5 + Math.sqrt(kg / 1000) * 2.2);

/** Dica desenhada no próprio SVG (aparece na hora, também no toque). W/H = limites do viewBox. */
export function SvgTip({ x, y, lines, W, H, fs = 10.5 }: { x: number; y: number; lines: string[]; W: number; H: number; fs?: number }) {
  if (!lines.length) return null;
  const lh = fs * 1.3;
  const w = Math.min(W - 4, Math.max(...lines.map((l) => l.length)) * fs * 0.55 + 14);
  const h = lines.length * lh + 8;
  let tx = x + 12;
  if (tx + w > W - 2) tx = x - 12 - w;
  tx = Math.max(2, tx);
  let ty = y - h - 10;
  if (ty < 2) ty = Math.min(H - h - 2, y + 12);
  return (
    <g pointerEvents="none" className="svg-tip">
      <rect x={tx} y={ty} width={w} height={h} rx={4} fill="rgba(8,16,26,0.95)" stroke="#5a7da3" />
      {lines.map((l, i) => (
        <text key={i} x={tx + 7} y={ty + 4 + (i + 1) * lh - fs * 0.3} fontSize={fs} fill={i === 0 ? '#ffffff' : '#bcd0e4'} fontWeight={i === 0 ? 700 : 400}>
          {l}
        </text>
      ))}
    </g>
  );
}
