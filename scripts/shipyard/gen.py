# gera src/sim/environment/shipyardData.ts a partir do traçado ajustado (pixels Sentinel-2 → lat/lon)
import json, sys, math, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from s2_px import px2ll
t = json.load(open('yard/trace_fit.json'))  # saída de fit.py
DY = 0.7  # mesmo deslocamento do ajuste global (dx 0, dy 0,7)
def ll(p): la, lo = px2ll(p[0], p[1]); return [round(la, 6), round(lo, 6)]
def arr(ps): return '[' + ', '.join('[%.6f, %.6f]' % tuple(ll(p)) for p in ps) + ']'
PX = 10.0  # m por pixel
moles = {
  'oeste': ('Quebra-mar oeste', 'enrocamento'),
  'sul': ('Quebra-mar sul', 'enrocamento'),
  'norte': ('Molhe norte', 'enrocamento'),
  'interno': ('Cais interno', 'cais'),
}
# galpões: centro em pixels do recorte (já com o deslocamento), comprimento, largura, altura (m), rumo do eixo maior
B = [
  ('principal', 'Estaleiro de Construção — prédio principal', (304.5, 264.3 + DY), 150, 60, 42, 59),
  ('manutencao', 'Estaleiro de Manutenção', (316.0, 258.5 + DY), 75, 45, 34, 59),
  ('oficinas', 'Oficinas', (284.0, 281.2 + DY), 160, 30, 20, 59),
  ('transferencia', 'Prédio de transferência (shiplift)', (268.0, 279.5 + DY), 100, 38, 30, 59),
  ('administracao', 'Administração da base', (234.5, 239.2 + DY), 60, 35, 16, 56),
  ('apoio1', 'Apoio e alojamentos', (252.0, 235.5 + DY), 90, 35, 18, 56),
  ('apoio2', 'Apoio', (319.5, 271.2 + DY), 40, 25, 12, 59),
  ('tenda', 'Tenda de montagem', (262.0, 288.3 + DY), 40, 24, 12, 70.7),
  ('apoio3', 'Oficina de apoio', (241.0, 236.0 + DY), 40, 20, 10, 56),
  ('apoio4', 'Almoxarifado', (246.5, 230.5 + DY), 35, 22, 12, 56),
  ('apoio5', 'Apoio', (231.5, 242.6 + DY), 26, 16, 9, 56),
  ('oficina2', 'Oficinas', (279.0, 262.0 + DY), 50, 25, 12, 59),
  ('oficina3', 'Oficinas', (291.0, 268.5 + DY), 60, 25, 14, 59),
  ('apoio6', 'Apoio', (296.0, 255.0 + DY), 40, 30, 10, 59),
  ('apoio7', 'Apoio', (322.0, 262.0 + DY), 45, 25, 12, 59),
  ('portaria', 'Portaria e controle', (326.0, 245.0 + DY), 25, 15, 8, 59),
]
TANKS = [(329.0, 235.6 + DY), (330.2, 237.9 + DY)]
s = t['shiplift']
out = []
out.append('/**')
out.append(' * ESTALEIRO E BASE NAVAL DA ILHA DA MADEIRA (Itaguaí, RJ) — geometria em')
out.append(' * latitude/longitude. ARQUIVO GERADO (scripts/shipyard/gen.py) a partir de')
out.append(' * imagens Sentinel-2 L2A de 01/07/2026 e 21/07/2026 (10 m por pixel; banda')
out.append(' * infravermelha para separar água e estruturas), conferidas com fotografias')
out.append(' * aéreas. Precisão ≈ ±10 m. Contém dados modificados do Copernicus Sentinel (2026).')
out.append(' *')
out.append(' * Galpões: posição e tamanho ESTIMADOS (telhados na imagem de 10 m e fotos);')
out.append(' * alturas estimadas. Profundidade dragada: estimada (não publicada).')
out.append(' */')
out.append("import type { LatLon } from '../geo';")
out.append('')
out.append('const P = (a: [number, number][]): LatLon[] => a.map(([lat, lon]) => ({ lat, lon }));')
out.append('')
out.append('export type MoleKind = \'enrocamento\' | \'cais\';')
out.append('export interface MoleDef { id: string; name: string; kind: MoleKind; /** largura na linha d\'água (m) */ width: number; pts: LatLon[] }')
out.append('export interface BuildingDef { id: string; name: string; center: LatLon; length: number; width: number; height: number; /** rumo do eixo maior (graus) */ bearing: number }')
out.append('')
out.append('export const SHIPYARD_DATA = {')
out.append('  /** aterro (pátio a +3 m) */')
out.append('  platform: P(%s),' % arr(t['platform']))
out.append('  moles: [')
for k, (name, kind) in moles.items():
    m = t['moles'][k]
    out.append("    { id: '%s', name: '%s', kind: '%s', width: %d, pts: P(%s) }," % (k, name, kind, round(m['w'] * PX), arr(m['pts'])))
out.append('  ] as MoleDef[],')
out.append('  /** shiplift (elevador de navios, 110 × 20 m, 8 000 t, 34 guinchos): da raiz no pátio até a ponta na bacia; largura total com os dois píeres dos guinchos */')
out.append('  shiplift: { root: P([%s])[0], tip: P([%s])[0], width: %d },' % ('[%.6f, %.6f]' % tuple(ll(s['root'])), '[%.6f, %.6f]' % tuple(ll(s['tip'])), round(s['w'] * PX)))
out.append('  /** área dragada: bacia, entrada e aproximação */')
out.append('  dredge: P(%s),' % arr(t['dredge']))
out.append('  dredgeDepth: 16,')
out.append('  buildings: [')
for bid, name, c, L, W, H, brg in B:
    la, lo = ll(c)
    out.append("    { id: '%s', name: '%s', center: { lat: %.6f, lon: %.6f }, length: %d, width: %d, height: %d, bearing: %g }," % (bid, name, la, lo, L, W, H, brg))
out.append('  ] as BuildingDef[],')
out.append('  /** tanques de combustível (2 × 700 m³) */')
out.append('  tanks: P(%s),' % arr(TANKS))
out.append('  /** Porto Sudeste (vizinho a oeste; só referência visual): ponte de acesso e píer de minério */')
out.append('  sudeste: { trestle: P(%s), pier: P(%s) },' % (arr(t['sudeste_trestle']), arr(t['sudeste_pier'])))
out.append('};')
open(sys.argv[1], 'w').write('\n'.join(out) + '\n')
