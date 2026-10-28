"""
INTERIOR DO SX-1 (fictício) — tanques, tubulações, válvulas, bombas, garrafas de ar AP, bateria e
geradores do corte PUBLICADO, modelados em estilo técnico realista para uma futura vista em corte
(meio casco aberto). Só visual; a física não muda.

O arranjo vem do próprio site: scripts/blender/exportar_interior.ts grava build/modelo/interior.json
a partir de src/render3d/Systems.ts (mesmas posições, trajetos e orientações). Este script lê esse
arquivo e monta as peças.

Uso (sem interface):
  npx vite-node scripts/blender/exportar_interior.ts
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
      -P scripts/blender/build_sx1_interior.py -- [--json build/modelo/interior.json] [--saida build/modelo] [--corte]
  npm run modelo:otimizar
--corte: também monta o casco externo e renderiza a prévia do meio casco aberto (build/modelo/corte/).

Contrato (para o corte futuro no site):
  - metros; mesmas convenções do casco (origem no eixo, a meio comprimento; +Y proa, +X boreste, +Z cima);
  - nós com nomes fixos e só translação (a quantização mexe só nas malhas filhas "_Malha"):
      SX1I_Tanque_<ID>            casco do tanque (malha fechada; o nível de água será recortado no site)
      SX1I_Tubo_<n>               tubulação (malha fechada) + SX1I_Tubo_<n>_Flanges
      SX1I_Valvula_<nome>         válvula: origem no centro do corpo; filho SX1I_Valvula_<nome>_Volante
                                  com origem no centro do volante (gira em torno da haste)
      SX1I_Bomba_<nome>           bomba; filho SX1I_Bomba_<nome>_Rotor (acoplamento, gira no eixo vertical)
      SX1I_Garrafa_<grupo>_<k>, SX1I_Abertura_<n>, SX1I_Bateria_<k>, SX1I_Gerador_<id>
      SX1I_TuboTorpedo_<n>        tubo lançador (n = 1…6; ímpares BE); filhos _PortaInterna e _PortaExterna
                                  (origem na dobradiça, eixo_giro e abre_graus em extras), _Ejetor, _Garrafa,
                                  _ValvulaDisparo, _ValvulaAlagamento, _ValvulaSuspiro, _Passagem, _Trilho
      SX1I_SalaTorpedos           piso sobre o TT-AV, estantes e trilhos de içamento
  - cada nó leva em "extras" os dados originais (nome, sistemas, eixo do tubo, haste…): no Three.js
    ficam em object.userData;
  - toda malha é fechada (manifold): um plano de corte com tampa (stencil) ou booleana funciona.
"""
import json
import math
import os
import re
import sys
import unicodedata

import bmesh
import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(globals().get('__file__', os.path.join(os.getcwd(), 'scripts', 'blender', 'x.py'))))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import build_sx1 as base  # noqa: E402  (reaproveita utilidades e o casco externo)

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SEG = 16  # lados do tubo


# ------------------------------------------------------------------ utilidades
def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    s = s.replace('→', '_para_')
    return re.sub(r'[^A-Za-z0-9]+', '_', s).strip('_')


def srgb(hexstr, k=1.0):
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) * k for x in c)


def tinted(hexstr, k, grey):
    """Cinza (linear) misturado com uma fração k da cor dada."""
    c = srgb(hexstr)
    return tuple(k * x + (1 - k) * grey for x in c)


def v3(a):
    return np.array(a, dtype=float)


def unit(a):
    n = np.linalg.norm(a)
    return a / n if n > 1e-9 else a


def frame(axis):
    """Base ortonormal (u, w) perpendicular ao eixo."""
    a = unit(v3(axis))
    ref = v3((0, 0, 1)) if abs(a[2]) < 0.9 else v3((1, 0, 0))
    u = unit(np.cross(a, ref))
    w = np.cross(a, u)
    return a, u, w


def cylinder(c, axis, r, length, n=SEG, r2=None):
    """Cilindro (ou tronco de cone) fechado, centrado em c, ao longo de axis."""
    a, u, w = frame(axis)
    c = v3(c)
    r2 = r if r2 is None else r2
    verts = []
    for s, rr in ((-0.5, r), (0.5, r2)):
        for k in range(n):
            t = 2 * math.pi * k / n
            verts.append(c + a * s * length + (u * math.cos(t) + w * math.sin(t)) * rr)
    faces = [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple(n + k for k in range(n)))
    return [tuple(p) for p in verts], faces


def torus(c, normal, R, r, nu=24, nv=8):
    a, u, w = frame(normal)
    c = v3(c)
    verts = []
    for i in range(nu):
        t = 2 * math.pi * i / nu
        d = u * math.cos(t) + w * math.sin(t)
        for j in range(nv):
            p = 2 * math.pi * j / nv
            verts.append(tuple(c + d * (R + r * math.cos(p)) + a * r * math.sin(p)))
    faces = []
    for i in range(nu):
        for j in range(nv):
            i1, j1 = (i + 1) % nu, (j + 1) % nv
            faces.append((i * nv + j, i1 * nv + j, i1 * nv + j1, i * nv + j1))
    return verts, faces


def box(c, size, basis=None):
    c = v3(c)
    ex, ey, ez = (v3(b) for b in (basis or ((1, 0, 0), (0, 1, 0), (0, 0, 1))))
    hx, hy, hz = (s / 2 for s in size)
    verts = [tuple(c + ex * sx * hx + ey * sy * hy + ez * sz * hz) for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    return verts, faces


def sphere(c, r, n=16):
    c = v3(c)
    verts = [tuple(c + v3((0, 0, r)))]
    rings = n // 2
    for i in range(1, rings):
        th = math.pi * i / rings
        for j in range(n):
            ph = 2 * math.pi * j / n
            verts.append(tuple(c + r * v3((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)))))
    verts.append(tuple(c - v3((0, 0, r))))
    faces = [(0, 1 + (j + 1) % n, 1 + j) for j in range(n)]
    for i in range(rings - 2):
        for j in range(n):
            a, b = 1 + i * n + j, 1 + i * n + (j + 1) % n
            faces.append((a, b, b + n, a + n))
    last = len(verts) - 1
    o = 1 + (rings - 2) * n
    faces += [(o + j, o + (j + 1) % n, last) for j in range(n)]
    return verts, faces


def merge(parts):
    verts, faces = [], []
    for v, f in parts:
        b = len(verts)
        verts += [tuple(p) for p in v]
        faces += [tuple(i + b for i in ff) for ff in f]
    return verts, faces


def mesh_obj(name, parts, mat, parent=None, origin=(0, 0, 0), sharp=40, extras=None):
    """Malha fechada filha de um nó vazio com o nome (origem = pivô); vértices relativos à origem."""
    verts, faces = merge(parts)
    o = v3(origin)
    verts = [tuple(v3(p) - o) for p in verts]
    uvs = [tuple((p[0] + p[1], p[2]) for p in (verts[i] for i in f)) for f in faces]
    me = base.make_mesh(name, verts, faces, uvs, mat, sharp_deg=sharp)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    # posição local: as peças não têm rotação, então basta descontar a posição acumulada dos pais
    pw = v3((0, 0, 0))
    p = parent
    while p is not None:
        pw = pw + v3(p.location)
        p = p.parent
    e = base.add_object(name, None, tuple(o - pw), parent)
    e.empty_display_size = 0.2
    for k, val in (extras or {}).items():
        e[k] = val
    base.add_object(name + '_Malha', me, (0, 0, 0), e)
    return e


def group(name, parent=None, loc=(0, 0, 0)):
    e = base.add_object(name, None, loc, parent)
    e.empty_display_size = 0.3
    return e


# ------------------------------------------------------------------ materiais
def materials(D):
    M = {}

    def mat(key, color, rough, metal=0.0):
        M[key] = base.principled('SX1I_' + key, color, rough, metal)[0]

    mat('aco', (0.42, 0.44, 0.46), 0.38, 0.75)  # flanges, braçadeiras, suportes
    mat('casco_res', (0.5, 0.52, 0.5), 0.55, 0.3)  # casco resistente (pintura interna clara)
    mat('caverna', (0.4, 0.42, 0.41), 0.55, 0.35)
    mat('eixo', (0.62, 0.62, 0.64), 0.22, 0.95)  # aço do eixo, polido
    mat('bronze', (0.55, 0.38, 0.2), 0.35, 0.9)
    mat('fundido', (0.30, 0.31, 0.33), 0.45, 0.6)  # corpos de válvula e bombas
    mat('volante', (0.55, 0.05, 0.04), 0.5, 0.1)  # volantes vermelhos
    mat('placa', (0.85, 0.82, 0.62), 0.6, 0.0)  # plaquetas de identificação
    mat('motor', (0.16, 0.24, 0.30), 0.5, 0.2)  # motores elétricos (azul-acinzentado)
    mat('gerador', (0.22, 0.26, 0.22), 0.55, 0.25)  # diesel (verde-oliva)
    mat('celula', (0.05, 0.05, 0.06), 0.6, 0.0)  # células da bateria
    mat('polo_pos', (0.6, 0.06, 0.04), 0.4, 0.5)
    mat('polo_neg', (0.02, 0.02, 0.02), 0.4, 0.5)
    mat('cobre', (0.75, 0.42, 0.2), 0.3, 1.0)
    mat('tubo_torpedo', (0.44, 0.47, 0.46), 0.55, 0.35)  # tubos lançadores (aço pintado: pouco espelhado, sem faixas da compressão)
    mat('porta_tubo', (0.22, 0.26, 0.30), 0.45, 0.5)  # portas interna e externa dos tubos
    mat('ejetor', (0.28, 0.34, 0.40), 0.45, 0.4)  # cilindros de ejeção
    mat('estante', (0.33, 0.35, 0.36), 0.5, 0.55)  # piso, estantes e trilhos da sala de torpedos
    for cat in {t['categoria'] for t in D['tanques']}:
        cor = next(t['cor'] for t in D['tanques'] if t['categoria'] == cat)
        # tanque: chapa pintada de cinza claro, levemente tingida pela categoria (estilo técnico)
        mat('tanque_' + cat, tinted(cor, 0.45, 0.3), 0.6, 0.2)
    for cor in {p['cor'] for p in D['tubos']} | {g['cor'] for g in D['garrafas']} | {a['cor'] for a in D['aberturas']}:
        # tubos e garrafas: tinta cinza com um toque da cor do fluido; faixas de identificação na cor cheia
        mat('pintura_' + cor.lstrip('#'), tinted(cor, 0.6, 0.22), 0.45, 0.25)
        mat('faixa_' + cor.lstrip('#'), srgb(cor), 0.5, 0.1)
    return M


# ------------------------------------------------------------------ tubulações
def rounded(pts, rb, nseg=6):
    P = [v3(p) for p in pts]
    clean = [P[0]]
    for p in P[1:]:
        if np.linalg.norm(p - clean[-1]) > 1e-4:
            clean.append(p)
    P = clean
    if len(P) < 2:
        return P
    out = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        d1, d2 = b - a, c - b
        L1, L2 = np.linalg.norm(d1), np.linalg.norm(d2)
        d1, d2 = d1 / L1, d2 / L2
        ang = math.acos(max(-1.0, min(1.0, float(np.dot(d1, d2)))))
        if ang < 1e-3:
            out.append(b)
            continue
        t = min(rb * math.tan(ang / 2), 0.45 * L1, 0.45 * L2)
        p1, p2 = b - d1 * t, b + d2 * t
        for k in range(nseg + 1):
            s = k / nseg
            out.append((1 - s) ** 2 * p1 + 2 * (1 - s) * s * b + s * s * p2)
    out.append(P[-1])
    return out


def sweep(path, r, n=SEG):
    """Tubo fechado ao longo do caminho (transporte paralelo do referencial)."""
    T = []
    for i in range(len(path)):
        a = path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]
        T.append(unit(a))
    _, u, _ = frame(T[0])
    verts = []
    for i, p in enumerate(path):
        if i > 0:
            u = u - T[i] * np.dot(u, T[i])
            u = unit(u)
        w = np.cross(T[i], u)
        for k in range(n):
            t = 2 * math.pi * k / n
            verts.append(tuple(p + (u * math.cos(t) + w * math.sin(t)) * r))
    faces = []
    for i in range(len(path) - 1):
        for k in range(n):
            k1 = (k + 1) % n
            faces.append((i * n + k, i * n + k1, (i + 1) * n + k1, (i + 1) * n + k))
    faces.append(tuple(range(n - 1, -1, -1)))
    last = (len(path) - 1) * n
    faces.append(tuple(last + k for k in range(n)))
    return verts, faces


def clip_to_hull(pts):
    """Tubos que saem para o mar terminam rente ao casco externo (no site vão até a seta de vazão)."""
    P = [v3(q) for q in pts]

    def out_r(q):
        return math.hypot(q[0], q[2]) - (base.radius_at(q[1]) - 0.02)

    for rev in (False, True):
        if rev:
            P.reverse()
        while len(P) > 1 and out_r(P[-1]) > 0 and out_r(P[-2]) > 0:
            P.pop()
        if len(P) > 1 and out_r(P[-1]) > 0 >= out_r(P[-2]):
            a, b = P[-2], P[-1]
            lo, hi = 0.0, 1.0
            for _ in range(30):
                m = (lo + hi) / 2
                if out_r(a + (b - a) * m) > 0:
                    hi = m
                else:
                    lo = m
            P[-1] = a + (b - a) * lo
    P.reverse()
    return [tuple(q) for q in P]


def build_pipes(D, M, parent):
    for i, p in enumerate(D['tubos']):
        r = p['raio'] * 0.75  # o desenho do site exagera o diâmetro; aqui fica mais realista
        path = rounded(clip_to_hull(p['pontos']), rb=3.0 * r)
        if len(path) < 2:
            continue
        name = f'SX1I_Tubo_{i + 1:02d}'
        extras = {'tipo': 'tubo', 'sistemas': ','.join(p['sistemas']), 'cor_site': p['cor'], 'raio_site': p['raio'], 'pontos': json.dumps(p['pontos'])}
        e = mesh_obj(name, [sweep(path, r)], M['pintura_' + p['cor'].lstrip('#')], parent, path[0], sharp=60, extras=extras)
        # flanges nas pontas e a cada ~3,5 m; braçadeiras a cada ~1,8 m
        fl = []
        L = [0.0]
        for k in range(1, len(path)):
            L.append(L[-1] + float(np.linalg.norm(path[k] - path[k - 1])))
        total = L[-1]

        def at(s):
            k = max(1, min(len(path) - 1, int(np.searchsorted(L, s))))
            t = (s - L[k - 1]) / max(1e-9, L[k] - L[k - 1])
            return path[k - 1] + (path[k] - path[k - 1]) * t, unit(path[k] - path[k - 1])

        marks = [(0.04, 'f'), (total - 0.04, 'f')]
        s = 3.5
        while s < total - 1.0:
            marks.append((s, 'f'))
            s += 3.5
        s = 1.8
        while s < total - 0.5:
            marks.append((s, 'b'))
            s += 1.8
        for s, kind in marks:
            if total < 0.15:
                break
            c, d = at(max(0.0, min(total, s)))
            if kind == 'f':
                fl.append((cylinder(c, d, r * 1.75, 0.045, n=SEG), 'f'))
            else:
                fl.append((cylinder(c, d, r * 1.06, 0.14, n=SEG), 'b'))  # faixa de identificação do fluido
        bands = [b for b in fl if b[0] is not None and b[1] == 'b']
        flanges = [b for b in fl if b[1] == 'f']
        if flanges:
            mesh_obj(name + '_Flanges', [b[0] for b in flanges], M['aco'], e, path[0], sharp=60)
        if bands:
            mesh_obj(name + '_Faixas', [b[0] for b in bands], M['faixa_' + p['cor'].lstrip('#')], e, path[0], sharp=60)


# ------------------------------------------------------------------ válvulas
def build_valves(D, M, parent):
    used = {}
    for v in D['valvulas']:
        s = slug(v['nome'])
        used[s] = used.get(s, 0) + 1
        if used[s] > 1:
            s = f'{s}_{used[s]}'
        name = 'SX1I_Valvula_' + s
        c = v3(v['centro'])
        a = unit(v3(v['eixo']))
        h = unit(v3(v['haste']))
        r = 0.08  # raio de referência do tubo
        extras = {'tipo': 'valvula', 'nome': v['nome'], 'sistemas': ','.join(v['sistemas']), 'sistema': v['sistema'], 'eixo': v['eixo'], 'haste': v['haste']}
        if 'VDC' in v['nome']:
            # válvula direcional de 4 vias: bloco com dois solenoides
            ax2 = np.cross(a, h)
            body = [box(c, (0.42, 0.26, 0.24), (a, ax2, h))]
            for sx in (-1, 1):
                body.append(cylinder(c + a * sx * 0.3, a, 0.08, 0.18))
            for k in range(4):
                body.append(cylinder(c - h * 0.16 + a * (k - 1.5) * 0.09, h, 0.035, 0.1))
            body.append(box(c + h * 0.125 + ax2 * 0.0, (0.2, 0.08, 0.01), (a, ax2, h)))
            e = mesh_obj(name, body, M['fundido'], parent, c, extras=extras)
            continue
        body = [sphere(c, r * 2.0, 16)]
        for sx in (-1, 1):
            body.append(cylinder(c + a * sx * r * 2.2, a, r * 1.05, r * 1.6))  # pescoços
            body.append(cylinder(c + a * sx * r * 3.0, a, r * 2.1, 0.04))  # flanges
        body.append(cylinder(c + h * r * 2.6, h, r * 1.15, r * 1.6))  # castelo
        body.append(cylinder(c + h * r * 3.6, h, r * 1.5, r * 0.4))  # flange do castelo
        stem_top = c + h * r * 6.0
        body.append(cylinder(c + h * r * 4.8, h, r * 0.22, r * 2.4))  # haste
        plate_c = c + h * r * 2.6 + np.cross(a, h) * r * 1.2
        e = mesh_obj(name, body, M['fundido'], parent, c, extras=extras)
        mesh_obj(name + '_Placa', [box(plate_c, (r * 1.6, 0.012, r * 0.9), (a, np.cross(a, h), h))], M['placa'], e, plate_c)
        # volante (gira em torno da haste): aro, cubo e 3 raios
        wheel = [torus(stem_top, h, r * 2.6, r * 0.32, 28, 8), cylinder(stem_top, h, r * 0.45, r * 0.6)]
        _, u, w = frame(h)
        for k in range(3):
            t = 2 * math.pi * k / 3
            d = u * math.cos(t) + w * math.sin(t)
            wheel.append(cylinder(stem_top + d * r * 1.3, d, r * 0.16, r * 2.4, n=8))
        mesh_obj(name + '_Volante', wheel, M['volante'], e, stem_top, extras={'eixo_giro': [float(x) for x in h]})


# ------------------------------------------------------------------ bombas
def build_pumps(D, M, parent):
    for p in D['bombas']:
        name = 'SX1I_Bomba_' + slug(p['nome'].split('(')[-1].rstrip(')') if '(' in p['nome'] else p['nome'])
        c = v3(p['centro'])
        z = v3((0, 0, 1))
        extras = {'tipo': 'bomba', 'nome': p['nome'], 'sistemas': ','.join(p['sistemas'])}
        casing = [cylinder(c, z, 0.36, 0.3), cylinder(c + z * 0.0, (1, 0, 0), 0.1, 0.95), cylinder(c - z * 0.25, z, 0.22, 0.2)]
        for sx in (-1, 1):
            casing.append(cylinder(c + v3((sx * 0.45, 0, 0)), (1, 0, 0), 0.17, 0.04))
        casing.append(box(c - z * 0.4, (0.9, 0.7, 0.06)))  # base
        e = mesh_obj(name, casing, M['fundido'], parent, c, extras=extras)
        motor = [cylinder(c + z * 0.62, z, 0.27, 0.62)]
        for k in range(5):
            motor.append(cylinder(c + z * (0.4 + k * 0.11), z, 0.3, 0.025))  # aletas
        motor.append(box(c + z * 0.62 + v3((0, 0.3, 0)), (0.18, 0.12, 0.16)))  # caixa de ligação
        mesh_obj(name + '_Motor', motor, M['motor'], e, c + z * 0.62)
        rotor = [cylinder(c + z * 0.22, z, 0.11, 0.12, n=10)]
        for k in range(4):
            t = math.pi * k / 2
            rotor.append(box(c + z * 0.22 + v3((math.cos(t) * 0.1, math.sin(t) * 0.1, 0)), (0.06, 0.06, 0.1)))
        mesh_obj(name + '_Rotor', rotor, M['aco'], e, c + z * 0.22, extras={'eixo_giro': [0.0, 0.0, 1.0]})


# ------------------------------------------------------------------ garrafas de ar AP
def bottle_profile(L, R):
    prof = []
    for k in range(9):  # domo inferior
        t = (math.pi / 2) * k / 8
        prof.append((R * math.sin(t), -L / 2 + R * (1 - math.cos(t))))
    prof += [(R, L / 2 - R)]
    for k in range(1, 9):  # domo superior
        t = (math.pi / 2) * k / 8
        prof.append((max(0.06, R * math.cos(t)), L / 2 - R + R * math.sin(t) * 0.9))
    prof += [(0.06, L / 2 + 0.05), (0.0, L / 2 + 0.05)]
    return prof


def lathe(c, axis, prof, n=20):
    a, u, w = frame(axis)
    c = v3(c)
    verts = [tuple(c + a * prof[0][1])]
    rings = prof[1:-1]
    for rr, hh in rings:
        for k in range(n):
            t = 2 * math.pi * k / n
            verts.append(tuple(c + a * hh + (u * math.cos(t) + w * math.sin(t)) * rr))
    verts.append(tuple(c + a * prof[-1][1]))
    faces = [(0, 1 + (k + 1) % n, 1 + k) for k in range(n)]
    for i in range(len(rings) - 1):
        for k in range(n):
            k1 = (k + 1) % n
            faces.append((1 + i * n + k, 1 + i * n + k1, 1 + (i + 1) * n + k1, 1 + (i + 1) * n + k))
    last = len(verts) - 1
    o = 1 + (len(rings) - 1) * n
    faces += [(o + k, o + (k + 1) % n, last) for k in range(n)]
    return verts, faces


def build_bottles(D, M, parent):
    count = {}
    for b in D['garrafas']:
        count[b['grupo']] = count.get(b['grupo'], 0) + 1
        name = f"SX1I_Garrafa_{b['grupo']}_{count[b['grupo']]}"
        c, a = v3(b['centro']), unit(v3(b['eixo']))
        L, R = b['comprimento'], b['raio']
        extras = {'tipo': 'garrafa', 'grupo': b['grupo'], 'emergencia': bool(b['emergencia'])}
        e = mesh_obj(name, [lathe(c, a, bottle_profile(L, R))], M['pintura_' + b['cor'].lstrip('#')], parent, c, sharp=70, extras=extras)
        fit = [cylinder(c + a * (L / 2 + 0.1), a, 0.07, 0.1), torus(c + a * (L / 2 + 0.18), a, 0.09, 0.02, 16, 6)]
        for s in (-0.3, 0.25):
            fit.append(torus(c + a * s * L, a, R + 0.012, 0.016, 28, 6))  # cintas
            fit.append(box(c + a * s * L - v3((0, 0, R + 0.06)), (0.12, 0.12, 0.12)))  # berço
        mesh_obj(name + '_Ferragens', fit, M['aco'], e, c)


# ------------------------------------------------------------------ aberturas para o mar, bateria, geradores
def build_ports(D, M, parent):
    for i, p in enumerate(D['aberturas']):
        b, d = v3(p['base']), unit(v3(p['saida']))
        # no site a base fica fora do casco (seta de vazão); aqui a peça termina rente ao casco externo
        for _ in range(200):
            if math.hypot(b[0], b[2]) <= base.radius_at(b[1]) - 0.5:
                break
            b = b - d * 0.05
        name = f'SX1I_Abertura_{i + 1:02d}'
        parts = [cylinder(b + d * 0.25, d, 0.1, 0.5), cylinder(b + d * 0.02, d, 0.18, 0.04), cylinder(b + d * 0.48, d, 0.17, 0.04)]
        mesh_obj(name, parts, M['pintura_' + p['cor'].lstrip('#')], parent, b, extras={'tipo': 'abertura', 'sistemas': ','.join(p['sistemas']), 'saida': p['saida']})


def build_battery(D, M, parent):
    """Bateria: colunas de células em degraus acompanhando o fundo do casco resistente.

    O bloco do corte do site é um paralelepípedo que atravessa o casco; aqui o topo fica na mesma altura
    e cada coluna desce até onde o casco permite (colunas baixas demais ficam de fora)."""
    r_lim = D['casco']['raioResistente'] - 0.2  # folga para as cavernas
    for i, bt in enumerate(D['bateria']):
        c = v3(bt['centro'])
        w, l, h = bt['tamanho']
        name = f'SX1I_Bateria_{i + 1}'
        nx, ny = max(1, round(w / 0.38)), max(1, round(l / 0.26))
        dx, dy = w / nx, l / ny
        top = c[2] + h / 2 - 0.1
        e = group(name, parent, tuple(c))
        e['tipo'] = 'bateria'
        cells, pos, neg, trays, bars = [], [], [], [], []
        for ix in range(nx):
            xc = c[0] - w / 2 + dx * (ix + 0.5)
            xo = abs(xc) + dx / 2
            if xo >= r_lim:
                continue
            bottom = max(c[2] - h / 2 + 0.08, -math.sqrt(r_lim * r_lim - xo * xo) + 0.08)
            hh = top - bottom
            if hh < 0.25:
                continue
            trays.append(box((xc, c[1], bottom - 0.04), (dx + 0.02, l + 0.06, 0.08)))
            bars.append(box((xc, c[1], top + 0.07), (0.04, l - 0.1, 0.02)))
            for iy in range(ny):
                cc = v3((xc, c[1] - l / 2 + dy * (iy + 0.5), bottom + hh / 2))
                cells.append(box(cc, (dx - 0.025, dy - 0.025, hh)))
                tp = v3((xc, cc[1], top + 0.025))
                pos.append(cylinder(tp + v3((-dx * 0.25, 0, 0)), (0, 0, 1), 0.025, 0.05, n=8))
                neg.append(cylinder(tp + v3((dx * 0.25, 0, 0)), (0, 0, 1), 0.025, 0.05, n=8))
        mesh_obj(name + '_Bandeja', trays, M['aco'], e, c)
        mesh_obj(name + '_Celulas', cells, M['celula'], e, c, sharp=30)
        mesh_obj(name + '_PolosPos', pos, M['polo_pos'], e, c)
        mesh_obj(name + '_PolosNeg', neg, M['polo_neg'], e, c)
        mesh_obj(name + '_Barramentos', bars, M['cobre'], e, c)


def build_generators(D, M, parent):
    for g in D['geradores']:
        c = v3(g['centro'])
        w, l, h = g['tamanho']
        name = f"SX1I_Gerador_{g['id']}"
        y = v3((0, 1, 0))
        z = v3((0, 0, 1))
        skid = [box(c - z * (h / 2 - 0.05), (w + 0.1, l + 0.1, 0.1))]
        e = mesh_obj(name, skid, M['aco'], parent, c, extras={'tipo': 'gerador', 'id': g['id']})
        eng_l = l * 0.62
        ec = c + y * (l / 2 - eng_l / 2) + z * 0.0
        engine = [box(ec, (w * 0.82, eng_l, h * 0.62)), box(ec + z * (h * 0.31 + 0.08), (w * 0.55, eng_l * 0.92, 0.16))]
        for k in range(6):  # tampas de cilindro
            engine.append(box(ec + z * (h * 0.31 + 0.2) + y * (-eng_l / 2 + eng_l * (k + 0.5) / 6), (w * 0.45, eng_l / 6 - 0.04, 0.08)))
        engine.append(cylinder(ec + y * (eng_l / 2 - 0.25) + v3((w * 0.42, 0, 0.15)), (1, 0, 0), 0.16, 0.25))  # turbo
        engine.append(cylinder(ec + y * (eng_l / 2 - 0.25) + v3((w * 0.42, 0, 0.45)), z, 0.08, 0.5))  # descarga
        mesh_obj(name + '_Motor', engine, M['gerador'], e, ec)
        alt_c = c - y * (l / 2 - (l - eng_l) / 2)
        alt = [cylinder(alt_c, y, h * 0.36, l - eng_l - 0.1), cylinder(alt_c + y * ((l - eng_l) / 2), y, h * 0.25, 0.08)]
        mesh_obj(name + '_Alternador', alt, M['motor'], e, alt_c)


def build_tanks(D, M, parent):
    for t in D['tanques']:
        tri = t['triangulos']
        verts = [tuple(p) for p in tri]
        faces = [(i, i + 1, i + 2) for i in range(0, len(verts), 3)]
        c = np.mean(np.array(verts), axis=0)
        extras = {'tipo': 'tanque', 'id': t['id'], 'nome': t['nome'], 'curto': t['curto'], 'categoria': t['categoria'], 'capacidade': t['capacidade']}
        e = mesh_obj('SX1I_Tanque_' + t['id'], [(verts, faces)], M['tanque_' + t['categoria']], parent, tuple(c), sharp=30, extras=extras)
        # tampa de inspeção no topo do tanque
        top = max(p[2] for p in verts)
        tc = (c[0], c[1], top + 0.02)
        hatch = [cylinder(tc, (0, 0, 1), 0.28, 0.04), cylinder(np.array(tc) + v3((0, 0, 0.03)), (0, 0, 1), 0.2, 0.03)]
        mesh_obj('SX1I_Tanque_' + t['id'] + '_Visita', hatch, M['aco'], e, tc)


# ------------------------------------------------------------------ casco resistente
# Medidas (padrão; o JSON do site, de src/render3d/pressureHull.ts, prevalece): raio interno = o da física
# (hullRadius 2,9 m dos tanques internos); chapa de 5 cm; a ré o casco
# resistente afina junto com o casco externo (12 cm de folga). Anteparas resistentes em domo (convexas para
# fora) logo antes dos TLP: os tanques de lastro principais ficam FORA do casco resistente, nas pontas.
PH_T = 0.05
PH_GAP = 0.12
BH_FWD = (24.7, 0.75)  # base e flecha do domo de vante (ápice 25,45 m; TLP-1 começa em 25,5 m)
BH_AFT = (-19.9, 0.6)  # base e flecha do domo de ré (ápice −20,5 m; TLP-2 começa em −20,7 m)
FRAME_STEP = 0.6


def ph_out(y, r_in):
    return min(r_in + PH_T, base.radius_at(y) - PH_GAP)


def revolve_loop(prof, n=72):
    """Sólido de revolução (em torno de Y) de um contorno fechado [(r, y)] que não toca o eixo."""
    verts = []
    for r, y in prof:
        for k in range(n):
            t = 2 * math.pi * k / n
            verts.append((r * math.cos(t), y, r * math.sin(t)))
    m = len(prof)
    faces = []
    for i in range(m):
        i1 = (i + 1) % m
        for k in range(n):
            k1 = (k + 1) % n
            faces.append((i * n + k, i * n + k1, i1 * n + k1, i1 * n + k))
    return verts, faces


def obstacles(D):
    """Caixas (min, max) do que fica encostado no casco resistente: as cavernas desviam delas."""
    out = []
    for t in D['tanques']:
        if t['categoria'] == 'lastro':
            continue
        a = np.array(t['triangulos'])
        out.append((a.min(0) - 0.06, a.max(0) + 0.06))
    for b in D['bateria'] + D['geradores']:
        c, sz = v3(b['centro']), v3(b['tamanho'])
        out.append((c - sz / 2 - 0.08, c + sz / 2 + 0.08))
    for g in D['garrafas']:
        c, a = v3(g['centro']), np.abs(unit(v3(g['eixo'])))
        half = a * g['comprimento'] / 2 + (1 - a) * g['raio'] + 0.08
        out.append((c - half, c + half))
    return out


def frame_parts(y, r_in, obs, n=64):
    """Caverna em T (alma + flange) colada por dentro do casco; interrompida onde há tanque/equipamento."""
    sec = [(0, -0.015), (-0.135, -0.015), (-0.135, -0.05), (-0.16, -0.05), (-0.16, 0.05), (-0.135, 0.05), (-0.135, 0.015), (0, 0.015)]
    free = []
    for k in range(n):
        t = 2 * math.pi * k / n
        p = v3(((r_in - 0.08) * math.cos(t), y, (r_in - 0.08) * math.sin(t)))
        free.append(not any(np.all(p >= lo) and np.all(p <= hi) for lo, hi in obs))
    runs = []
    if all(free):
        runs.append((list(range(n)), True))
    else:
        start = next(k for k in range(n) if not free[k])
        cur = []
        for j in range(1, n + 1):
            k = (start + j) % n
            if free[k]:
                cur.append(k)
            elif cur:
                runs.append((cur, False))
                cur = []
        if cur:
            runs.append((cur, False))
    parts = []
    for ks, closed in runs:
        if len(ks) < 2:
            continue
        verts = []
        for k in ks:
            t = 2 * math.pi * k / n
            for dr, dy in sec:
                r = r_in + dr
                verts.append((r * math.cos(t), y + dy, r * math.sin(t)))
        m = len(sec)
        faces = []
        segs = len(ks) if closed else len(ks) - 1
        for i in range(segs):
            i1 = (i + 1) % len(ks)
            for j in range(m):
                j1 = (j + 1) % m
                faces.append((i * m + j, i * m + j1, i1 * m + j1, i1 * m + j))
        if not closed:
            faces.append(tuple(range(m - 1, -1, -1)))
            last = (len(ks) - 1) * m
            faces.append(tuple(last + j for j in range(m)))
        parts.append((verts, faces))
    return parts


def build_pressure_hull(D, M, parent):
    # medidas do site (src/render3d/pressureHull.ts, gravadas pelo exportar_interior.ts)
    global PH_T, PH_GAP, BH_FWD, BH_AFT
    ph = D['casco'].get('cascoResistente')
    if ph:
        PH_T, PH_GAP = ph['thickness'], ph['gap']
        BH_FWD = (ph['fwd']['base'], ph['fwd']['depth'])
        BH_AFT = (ph['aft']['base'], ph['aft']['depth'])
    r_in = D['casco']['raioResistente']
    ya, da = BH_AFT
    yf, df = BH_FWD
    ys = sorted(set([round(y, 4) for y in list(np.arange(ya, -14.9, 0.25)) + [yf - 2.0, yf]]))
    outer = [(ph_out(y, r_in), y) for y in ys]
    inner = [(r - PH_T, y) for r, y in reversed(outer)]
    e = mesh_obj('SX1I_CascoResistente', [revolve_loop(outer + inner)], M['casco_res'], parent, (0, 0, 0), sharp=30,
                 extras={'tipo': 'casco_resistente', 'raio_interno': r_in, 'espessura': PH_T, 'y_re': ya, 'y_vante': yf})
    # anteparas resistentes (domo elíptico, convexo para fora)
    for name, yb, depth, sgn in (('SX1I_Antepara_Vante', yf, df, 1), ('SX1I_Antepara_Re', ya, da, -1)):
        rb = ph_out(yb, r_in)
        prof = []
        for k in range(17):  # face externa: do ápice à borda
            t = (math.pi / 2) * k / 16
            prof.append((rb * math.sin(t), depth * math.cos(t)))
        for k in range(16, -1, -1):  # face interna: da borda ao ápice
            t = (math.pi / 2) * k / 16
            prof.append(((rb - PH_T) * math.sin(t), (depth - PH_T) * math.cos(t)))
        prof[0] = (0.0, depth)
        prof[-1] = (0.0, depth - PH_T)
        # lathe: o 1º e o último ponto são polos; remove pontos repetidos no polo
        prof = [prof[0]] + [p for p in prof[1:-1] if p[0] > 1e-6] + [prof[-1]]
        c = (0, yb, 0)
        mesh_obj(name, [lathe(c, (0, sgn, 0), prof, n=72)], M['casco_res'], parent, c, sharp=30,
                 extras={'tipo': 'antepara', 'y_base': yb, 'y_apice': yb + sgn * depth})
        # reforços radiais na face interna (lado de dentro do casco resistente)
        ribs = []
        for k in range(8):
            t = 2 * math.pi * k / 8
            d = v3((math.cos(t), 0, math.sin(t)))
            mid = v3(c) + d * (rb * 0.55) + v3((0, sgn * (depth * 0.55 - 0.12), 0))
            ribs.append(box(mid, (0.04, 0.16, rb * 0.8), (v3((0, 1, 0)), np.cross(d, v3((0, 1, 0))), d)))
        mesh_obj(name + '_Reforcos', ribs, M['caverna'], e, c, sharp=30)
    # cavernas
    obs = obstacles(D)
    parts = []
    y = ya + 0.45
    while y < yf - 0.3:
        parts += frame_parts(y, ph_out(y, r_in) - PH_T, obs)
        y += FRAME_STEP
    mesh_obj('SX1I_Cavernas', parts, M['caverna'], e, (0, 0, 0), sharp=30, extras={'tipo': 'cavernas', 'espacamento': FRAME_STEP})
    return e


# ------------------------------------------------------------------ linha de eixo (propulsão)
# Medidas: src/render3d/shaftLine.ts (gravadas no JSON pelo exportar_interior.ts). Eixo do casco: x = z = 0.
def ring_solid(y0, y1, r_out, r_in, n=64):
    """Anel (tubo de parede grossa) fechado, ao longo de Y."""
    return revolve_loop([(r_in, y0), (r_out, y0), (r_out, y1), (r_in, y1)], n)


def build_propulsion(D, M, parent):
    S = D['casco'].get('linhaEixo')
    if not S:
        return None
    mot, tb = S['motor'], S['thrustBearing']
    rs = S['shaftRadius']
    ya, yf = mot['aft'], mot['fwd']
    ym = (ya + yf) / 2
    R = mot['radius']
    P = group('SX1I_Propulsao', parent)
    info = D['casco'].get('motor', {})
    # --- motor elétrico principal (ímã permanente, acionamento direto): carcaça aletada, tampas, caixa de ligação
    stator = [ring_solid(ya + 0.2, yf - 0.2, R - 0.08, 0.95, 72)]
    k = 0
    y = ya + 0.32
    while y < yf - 0.3:  # aletas de refrigeração
        stator.append(ring_solid(y - 0.03, y + 0.03, R, R - 0.1, 72))
        y += 0.22
        k += 1
    for y0, y1 in ((ya, ya + 0.2), (yf - 0.2, yf)):  # tampas (escudos) com o furo do eixo
        stator.append(ring_solid(y0, y1, R - 0.12, rs + 0.06, 72))
    stator.append(box((0, ym - 0.4, R - 0.02 + 0.2), (0.7, 0.6, 0.4)))  # caixa de ligação
    for sx in (-1, 1):  # cabos de força saindo da caixa
        stator.append(cylinder((sx * 0.22, ym - 0.1, R + 0.3), (0, 1, 0), 0.05, 0.9, n=10))
    for yy in (ya + 0.45, yf - 0.45):  # berço: duas selas apoiadas no teto do tanque de trim de ré
        stator.append(box((0, yy, -(R * 0.55 + 0.45)), (2.0, 0.25, 0.9)))
    e = mesh_obj('SX1I_Motor', stator, M['motor'], P, (0, ym, 0), sharp=35,
                 extras={'tipo': 'motor', 'nome': 'Motor elétrico principal (ímã permanente)', 'potencia_W': info.get('ratedPower', 0),
                         'rpm_nominal': info.get('ratedRpm', 0), 'torque_max_Nm': info.get('maxTorque', 0)})
    mesh_obj('SX1I_Motor_Placa', [box((0.42, ym - 0.4, R + 0.2), (0.01, 0.35, 0.2))], M['placa'], e, (0, ym, 0))
    # água de refrigeração: das tampas por cima da carcaça (entrada a ré, saída a vante)
    cool = []
    for sx in (-0.55, 0.55):
        z0 = math.sqrt(max(0.0, (R - 0.12) ** 2 - sx * sx)) - 0.05
        path = [v3((sx, ya + 0.1, z0)), v3((sx, ya + 0.1, R + 0.22)), v3((sx, yf - 0.1, R + 0.22)), v3((sx, yf - 0.1, z0))]
        cool.append(sweep(rounded([tuple(q) for q in path], 0.15), 0.045, 12))
    mesh_obj('SX1I_Motor_Refrigeracao', cool, M['pintura_168a52'] if 'pintura_168a52' in M else M['aco'], e, (0, ym, 0))
    # rotor (gira com o eixo): cubo, raios e aro com ímãs
    rot = [cylinder((0, ym, 0), (0, 1, 0), 0.32, yf - ya - 0.5), ring_solid(ya + 0.3, yf - 0.3, 0.9, 0.75, 64)]
    for j in range(6):
        t = 2 * math.pi * j / 6
        d = v3((math.cos(t), 0, math.sin(t)))
        rot.append(box(d * 0.54 + v3((0, ym, 0)), (0.42, yf - ya - 0.7, 0.1), (d, v3((0, 1, 0)), np.cross(d, v3((0, 1, 0))))))
    mesh_obj('SX1I_Motor_Rotor', rot, M['aco'], e, (0, ym, 0), extras={'eixo_giro': [0.0, 1.0, 0.0]})
    mags = []
    for j in range(32):  # ímãs na periferia do rotor
        t = 2 * math.pi * j / 32
        d = v3((math.cos(t), 0, math.sin(t)))
        mags.append(box(d * 0.915 + v3((0, ym, 0)), (0.03, yf - ya - 0.7, 0.13), (d, v3((0, 1, 0)), np.cross(d, v3((0, 1, 0))))))
    rotor = bpy.data.objects['SX1I_Motor_Rotor']
    mesh_obj('SX1I_Motor_Rotor_Imas', mags, M['celula'], rotor, (0, ym, 0))

    # --- eixo (gira): do mancal de vante do motor até o cubo do hélice, com acoplamento e colar de escora
    y_end = S['aftEnd']
    ycoup = (ya + tb['x'] + tb['length'] / 2) / 2
    shaft = [cylinder((0, (yf - 0.1 + y_end) / 2, 0), (0, 1, 0), rs, (yf - 0.1) - y_end, n=24)]
    for dy in (-0.06, 0.06):  # acoplamento de flanges
        shaft.append(cylinder((0, ycoup + dy, 0), (0, 1, 0), 0.38, 0.1, n=32))
    for j in range(8):  # parafusos do acoplamento
        t = 2 * math.pi * j / 8
        shaft.append(cylinder((0.3 * math.cos(t), ycoup, 0.3 * math.sin(t)), (0, 1, 0), 0.03, 0.3, n=8))
    shaft.append(cylinder((0, tb['x'], 0), (0, 1, 0), 0.45, 0.12, n=40))  # colar de escora
    ymid = (yf + y_end) / 2
    mesh_obj('SX1I_Eixo', shaft, M['eixo'], P, (0, ymid, 0), sharp=40,
             extras={'tipo': 'eixo', 'nome': 'Eixo propulsor', 'eixo_giro': [0.0, 1.0, 0.0], 'raio': rs, 'y_vante': yf, 'y_re': y_end})

    # --- mancal de escora: carcaça com câmara do colar, tampa, tubos de óleo e jazente até o fundo
    L = tb['length']
    yb = tb['x']
    hull_r = D['casco']['raioResistente']
    prof = [(rs + 0.03, yb - L / 2), (tb['radius'], yb - L / 2), (tb['radius'], yb + L / 2), (rs + 0.03, yb + L / 2),
            (rs + 0.03, yb + L / 2 - 0.15), (0.5, yb + L / 2 - 0.15), (0.5, yb - L / 2 + 0.15), (rs + 0.03, yb - L / 2 + 0.15)]
    mb = [revolve_loop(prof, 48)]
    mb.append(box((0, yb, tb['radius'] + 0.06), (0.5, L * 0.7, 0.12)))  # tampa de inspeção
    zf_top, zf_bot = -tb['radius'] + 0.1, -(hull_r - 0.2)
    mb.append(box((0, yb, (zf_top + zf_bot) / 2), (0.5, L, zf_top - zf_bot)))  # jazente (entre os geradores)
    mb.append(box((0, yb, -tb['radius'] - 0.02), (1.1, L + 0.1, 0.12)))  # chapa de assentamento
    e = mesh_obj('SX1I_MancalEscora', mb, M['fundido'], P, (0, yb, 0), sharp=35,
                 extras={'tipo': 'mancal_escora', 'nome': 'Mancal de escora', 'funcao': 'transmite o empuxo do hélice ao casco'})
    # óleo de lubrificação: do topo do mancal à tampa de ré do motor (circuito comum)
    oil_path = [(0.2, yb, tb['radius'] + 0.12), (0.2, yb, tb['radius'] + 0.45), (0.2, ya - 0.15, tb['radius'] + 0.45), (0.2, ya - 0.15, 0.7), (0.2, ya + 0.02, 0.7)]
    oil = [sweep(rounded(oil_path, 0.12), 0.035, 10)]
    mesh_obj('SX1I_MancalEscora_Oleo', oil, M['cobre'], e, (0, yb, 0))
    mesh_obj('SX1I_MancalEscora_Placa', [box((tb['radius'] + 0.005, yb, 0.15), (0.01, 0.3, 0.16))], M['placa'], e, (0, yb, 0))

    # --- bucim (passagem estanque do eixo) na antepara resistente de ré
    ph = D['casco'].get('cascoResistente', {})
    y_bh = ph.get('aft', {}).get('base', -19.9) - ph.get('aft', {}).get('depth', 0.6)
    gland = [ring_solid(y_bh - 0.05, y_bh + 0.35, 0.36, rs + 0.02, 40)]
    for j in range(6):
        t = 2 * math.pi * j / 6
        gland.append(cylinder((0.3 * math.cos(t), y_bh + 0.38, 0.3 * math.sin(t)), (0, 1, 0), 0.025, 0.12, n=8))
    mesh_obj('SX1I_Bucim', gland, M['bronze'], P, (0, y_bh, 0), extras={'tipo': 'bucim', 'nome': 'Bucim do eixo (antepara de ré)'})

    # --- tubo telescópico (a ré do TLP-2) e mancal de apoio com pedestal
    tlp_aft = min(min(p[1] for p in t['triangulos']) for t in D['tanques'] if t['categoria'] == 'lastro' and t['id'].startswith('TLP2'))
    t0, t1 = tlp_aft - 0.1, y_end + 0.35
    mesh_obj('SX1I_TuboTelescopico', [ring_solid(t1, t0, 0.25, rs + 0.03, 40)], M['aco'], P, (0, (t0 + t1) / 2, 0),
             extras={'tipo': 'tubo_telescopico', 'nome': 'Tubo telescópico do eixo'})
    ysb = S['supportBearing']['x']
    r_hull = base.radius_at(ysb)
    sb = [ring_solid(ysb - 0.2, ysb + 0.2, 0.36, 0.25, 40), box((0, ysb, -(0.36 + r_hull - 0.1) / 2), (0.3, 0.35, r_hull - 0.1 - 0.36))]
    mesh_obj('SX1I_MancalApoio', sb, M['fundido'], P, (0, ysb, 0), extras={'tipo': 'mancal_apoio', 'nome': 'Mancal de apoio do eixo'})
    return P


# ------------------------------------------------------------------ tubos lançadores e sala de torpedos
# Medidas: src/render3d/torpedoTubes.ts (gravadas no JSON pelo exportar_interior.ts, em coordenadas do CORPO:
# x vante, y boreste, z para baixo). Seis tubos de 533 mm da culatra (porta interna, na sala de torpedos) até a
# boca (porta externa do tubo, atrás da porta do casco); ejeção por ar comprimido: garrafa de lançamento →
# válvula de disparo → cilindro de ejeção → água na culatra. Estantes laterais e piso sobre o TT-AV.
def bpt(p):
    """corpo (x vante, y boreste, z baixo) → Blender (X boreste, Y proa, Z cima)"""
    return v3((p['y'], p['x'], -p['z'])) if isinstance(p, dict) else v3((p[1], p[0], -p[2]))


def tube_shell(c0, axis, length, r_out, r_in, n=32):
    """Tubo de parede (anel) fechado: de c0 ao longo de axis, com furo de raio r_in."""
    a, u, w = frame(axis)
    c0 = v3(c0)
    verts = []
    for s in (0.0, length):
        for rr in (r_out, r_in):
            for k in range(n):
                t = 2 * math.pi * k / n
                verts.append(tuple(c0 + a * s + (u * math.cos(t) + w * math.sin(t)) * rr))
    o0, i0, o1, i1 = 0, n, 2 * n, 3 * n
    faces = []
    for k in range(n):
        k1 = (k + 1) % n
        faces.append((o0 + k, o0 + k1, o1 + k1, o1 + k))  # face externa
        faces.append((i0 + k1, i0 + k, i1 + k, i1 + k1))  # furo
        faces.append((o0 + k1, o0 + k, i0 + k, i0 + k1))  # topo de ré
        faces.append((o1 + k, o1 + k1, i1 + k1, i1 + k))  # topo de vante
    return verts, faces


def small_valve(c, axis, stem, r):
    """Válvula pequena (corpo, pescoços, castelo e haste); devolve (partes do corpo, centro do volante)."""
    c, a, h = v3(c), unit(v3(axis)), unit(v3(stem))
    body = [sphere(c, r * 2.0, 8)]
    for sx in (-1, 1):
        body.append(cylinder(c + a * sx * r * 2.4, a, r * 1.1, r * 1.4, n=8))
        body.append(cylinder(c + a * sx * r * 3.1, a, r * 2.0, r * 0.4, n=10))
    body.append(cylinder(c + h * r * 2.6, h, r * 1.1, r * 1.6, n=8))
    body.append(cylinder(c + h * r * 4.6, h, r * 0.22, r * 2.4, n=6))
    return body, c + h * r * 5.8


def wheel_parts(c, h, R):
    wheel = [torus(c, h, R, R * 0.13, 14, 4), cylinder(c, h, R * 0.18, R * 0.25, n=6)]
    _, u, w = frame(h)
    for k in range(3):
        t = 2 * math.pi * k / 3
        d = u * math.cos(t) + w * math.sin(t)
        wheel.append(cylinder(c + d * R * 0.5, d, R * 0.07, R * 0.95, n=4))
    return wheel


def build_torpedoes(D, M, parent):
    T = D['torpedos']
    S = T['sala']
    up = v3((0, 0, 1))
    hp_cor = next(g['cor'] for g in D['garrafas'])
    for t in T['tubos']:
        n = t['n']
        side = 1 if t['side'] == 'BE' else -1
        name = f'SX1I_TuboTorpedo_{n}'
        a = unit(bpt(t['eixo']))
        b = bpt(t['culatra'])
        Lt = t['comprimento']
        muzzle = b + a * Lt
        # referenciais da seção: "lado" (para fora, horizontal) e "cima" (perpendicular ao eixo)
        lat = unit(np.cross(a, up)) * (-1 if np.dot(np.cross(a, up), v3((side, 0, 0))) < 0 else 1)
        upp = unit(np.cross(lat, a)) * 1.0
        if upp[2] < 0:
            upp = -upp
        ro, ri = T['outerRadius'], T['boreRadius']
        extras = {
            'tipo': 'tubo_torpedo', 'nome': t['nome'], 'numero': n, 'bordo': t['side'], 'calibre': T['caliber'],
            'comprimento': round(Lt, 4), 'eixo': [round(float(x), 5) for x in a],
            'culatra': [round(float(x), 4) for x in b], 'boca': [round(float(x), 4) for x in muzzle],
        }
        body = [tube_shell(b, a, Lt, ro, ri)]
        # flange da culatra e anel da boca: anéis por fora da parede (sem vértices em comum com o tubo)
        body.append(tube_shell(b - a * 0.06, a, 0.2, ro + 0.06, ri + 0.004))
        body.append(tube_shell(muzzle - a * 0.1, a, 0.097, ro + 0.02, ro - 0.012, n=24))
        s = 1.6
        while s < Lt - 0.8:  # cintas de reforço
            body.append(tube_shell(b + a * s, a, 0.05, ro + 0.02, ro - 0.012, n=24))
            s += 2.0
        e = mesh_obj(name, body, M['tubo_torpedo'], parent, b, sharp=35, extras=extras)
        # anel de passagem na antepara resistente e trilho-guia no fundo do furo
        s_bh = t['antepara']
        rail_c = b + a * (Lt / 2) - upp * (ri - 0.012)
        mesh_obj(name + '_Passagem', [tube_shell(b + a * (s_bh - 0.08), a, 0.16, ro + 0.11, ro + 0.002, n=24)], M['aco'], e, b + a * s_bh)
        mesh_obj(name + '_Trilho', [box(rail_c, (0.05, Lt - 0.3, 0.022), (lat, a, upp))], M['aco'], e, rail_c)
        # porta interna (culatra): disco com anel de travamento e alavanca; dobradiça vertical do lado de fora
        hinge_i = b - a * 0.09 + lat * (ro + 0.08)
        dc = b - a * 0.09
        door = [cylinder(dc, a, ro + 0.05, 0.07, n=32), torus(dc - a * 0.045, a, ro - 0.02, 0.022, 24, 4)]
        door.append(cylinder(dc - a * 0.07, a, 0.09, 0.06, n=12))  # cubo do fecho
        door.append(box(dc - a * 0.1 - lat * 0.12, (0.32, 0.035, 0.035), (lat, upp, a)))  # alavanca
        for dz in (-0.18, 0.18):
            door.append(cylinder(hinge_i + upp * dz, upp, 0.035, 0.12, n=8))  # dobradiças
            door.append(box(hinge_i + upp * dz - lat * 0.06 - a * 0.0, (0.12, 0.05, 0.05), (lat, upp, a)))
        mesh_obj(name + '_PortaInterna', door, M['porta_tubo'], e, hinge_i,
                 extras={'tipo': 'porta_tubo', 'eixo_giro': [float(x) for x in upp], 'abre_graus': 100})
        # porta externa do tubo (na boca), dobradiça em cima
        hinge_o = muzzle + a * 0.04 + upp * (ro + 0.03)
        oc = muzzle + a * 0.04
        odoor = [cylinder(oc, a, ro - 0.01, 0.05, n=24), cylinder(oc + a * 0.03, a, ro * 0.55, 0.02, n=16)]
        odoor.append(cylinder(hinge_o, lat, 0.03, 0.3, n=8))
        mesh_obj(name + '_PortaExterna', odoor, M['porta_tubo'], e, hinge_o,
                 extras={'tipo': 'porta_tubo', 'eixo_giro': [float(x) for x in lat], 'abre_graus': 95})
        # ejeção por ar comprimido: cilindro de ejeção ao lado da culatra, garrafa de lançamento e válvula de disparo
        z = T['rowZ'][t['row']]
        ej, fl = S['ejector'], S['flask']
        ej_c = bpt({'x': (ej['x0'] + ej['x1']) / 2, 'y': side * ej['y'], 'z': z})
        ej_len = ej['x1'] - ej['x0']
        yax = v3((0, 1, 0))
        cyl = [cylinder(ej_c, yax, ej['radius'], ej_len, n=20)]
        for sx in (-0.5, 0.5):
            cyl.append(cylinder(ej_c + yax * sx * ej_len, yax, ej['radius'] + 0.04, 0.06, n=20))  # flanges
        cyl.append(box(ej_c - v3((0, 0, ej['radius'] + 0.08)), (0.3, ej_len * 0.7, 0.1)))  # jazente
        # conduto de água: da cabeça do cilindro até a lateral do tubo, logo à vante da culatra
        s_in = (bpt({'x': ej['x1'] + 0.42, 'y': 0, 'z': 0})[1] - b[1]) / a[1]
        tube_side = b + a * s_in + lat * (ro - 0.02)
        p0 = ej_c + yax * (ej_len / 2)
        p1 = v3((p0[0], tube_side[1], p0[2]))
        duct = rounded([p0, p1, tube_side], 0.12)
        cyl.append(sweep(duct, 0.085, 10))
        ejn = mesh_obj(name + '_Ejetor', cyl, M['ejetor'], e, ej_c, extras={'tipo': 'ejetor', 'nome': f"Cilindro de ejeção {n}"})
        fl_c = bpt({'x': (fl['x0'] + fl['x1']) / 2, 'y': side * fl['y'], 'z': z})
        fl_len = fl['x1'] - fl['x0']
        flask = [lathe(fl_c, yax, bottle_profile(fl_len, fl['radius']), 12)]
        for sx in (-0.3, 0.25):
            flask.append(torus(fl_c + yax * sx * fl_len, yax, fl['radius'] + 0.01, 0.014, 14, 4))
        mesh_obj(name + '_Garrafa', flask, M['pintura_' + hp_cor.lstrip('#')], e, fl_c,
                 extras={'tipo': 'garrafa_lancamento', 'nome': f'Garrafa de lançamento {n}'})
        # linha de ar: bico da garrafa → válvula de disparo → lateral do cilindro de ejeção
        v_c = fl_c + yax * (fl_len / 2 + 0.32)
        q0 = fl_c + yax * (fl_len / 2 + 0.08)
        q2 = v3((ej_c[0] + side * (ej['radius'] - 0.02), v_c[1], v_c[2]))
        air = [sweep(rounded([q0, v_c, q2], 0.08, 4), 0.035, 8)]
        mesh_obj(name + '_LinhaAr', air, M['pintura_' + hp_cor.lstrip('#')], e, v_c)
        vb, wc = small_valve(v_c, v3((side, 0, 0)), up, 0.045)
        vb.append(box(wc + up * 0.02, (0.16, 0.12, 0.1)))  # atuador (disparo remoto)
        mesh_obj(name + '_ValvulaDisparo', vb, M['fundido'], e, v_c, extras={'tipo': 'valvula_tubo', 'nome': f'Válvula de disparo {n}'})
        # alagamento (embaixo) e suspiro (em cima), do lado de dentro dos tubos
        for k, (nome, s_v, dz) in enumerate((('Alagamento', 1.15, -1), ('Suspiro', 0.8, 1))):
            c_t = b + a * s_v
            vc = c_t - lat * (ro + 0.12) + upp * dz * 0.14
            parts, wcen = small_valve(vc, upp, -lat, 0.035)
            parts.append(sweep([c_t - lat * (ro - 0.03) + upp * dz * 0.14, vc], 0.03, 8))
            vn = mesh_obj(f'{name}_Valvula{nome}', parts, M['fundido'], e, vc, extras={'tipo': 'valvula_tubo', 'nome': f'{nome} do tubo {n}'})
            mesh_obj(f'{name}_Valvula{nome}_Volante', wheel_parts(wcen, -lat, 0.09), M['volante'], vn, wcen,
                     extras={'eixo_giro': [float(x) for x in -lat]})
    # ---- sala de torpedos: piso sobre o TT-AV, estantes laterais e trilhos de içamento
    room = []
    dk = S['deck']
    zt = -dk['z']
    half = math.sqrt(max(0.0, D['casco']['raioResistente'] ** 2 - (dk['z'] + 0.03) ** 2)) - 0.04
    dc = v3((0, (dk['x0'] + dk['x1']) / 2, zt - dk['thickness'] / 2))
    room.append(box(dc, (2 * half, dk['x1'] - dk['x0'], dk['thickness'])))
    rk = S['racks']
    rl = rk['x1'] - rk['x0']
    for sd in (1, -1):
        yc = sd * rk['y']
        for tz in rk['tiers']:
            zc = -tz - 0.267  # apoio logo abaixo da arma
            for dy in (-0.2, 0.2):  # longarinas
                room.append(box(v3((yc + dy, (rk['x0'] + rk['x1']) / 2, zc - 0.05)), (0.06, rl, 0.08)))
            for k in range(4):  # berços
                xx = rk['x0'] + 0.4 + k * (rl - 0.8) / 3
                room.append(box(v3((yc, xx, zc + 0.02)), (0.56, 0.1, 0.07)))
                for dy in (-0.25, 0.25):
                    room.append(box(v3((yc + dy, xx, zc + 0.12)), (0.06, 0.1, 0.18)))
        # colunas da estante, do piso (sobre os TCA) até acima do nível de cima
        yo = sd * (rk['y'] + 0.36)
        zbot = -dk['z']
        ztop = -min(rk['tiers']) + 0.35
        for k in range(3):
            xx = rk['x0'] + 0.05 + k * (rl - 0.1) / 2
            room.append(box(v3((yo, xx, (zbot + ztop) / 2)), (0.08, 0.08, ztop - zbot)))
            for tz in rk['tiers']:
                room.append(box(v3(((yo + yc) / 2, xx, -tz - 0.32)), (abs(yo - yc) + 0.25, 0.06, 0.06)))  # braços
    ho = S['hoist']
    for sd in (1, -1):
        yc = sd * ho['y']
        hz = -ho['z']
        hl = ho['x1'] - ho['x0']
        room.append(box(v3((yc, (ho['x0'] + ho['x1']) / 2, hz)), (0.08, hl, 0.16)))  # viga I (alma)
        for dz in (-0.08, 0.08):
            room.append(box(v3((yc, (ho['x0'] + ho['x1']) / 2, hz + dz)), (0.16, hl, 0.025)))  # mesas
        ztop = math.sqrt(max(0.0, D['casco']['raioResistente'] ** 2 - yc ** 2)) - 0.05
        for k in range(4):
            xx = ho['x0'] + 0.3 + k * (hl - 0.6) / 3
            room.append(box(v3((yc, xx, (hz + 0.08 + ztop) / 2)), (0.05, 0.05, ztop - hz - 0.08)))  # pendurais
    mesh_obj('SX1I_SalaTorpedos', room, M['estante'], parent, v3((0, (rk['x0'] + dk['x1']) / 2, 0)), sharp=30,
             extras={'tipo': 'sala_torpedos', 'nome': 'Sala de torpedos'})


# ------------------------------------------------------------------ montagem
def build_interior(json_path):
    D = json.load(open(json_path, encoding='utf-8'))
    M = materials(D)
    root = group('SX1I_Interior')
    root['gerado_de'] = D['gerado']
    grp = {k: group('SX1I_' + k, root) for k in ('Estrutura', 'Tanques', 'Tubulacoes', 'Valvulas', 'Bombas', 'ArAP', 'Aberturas', 'Energia', 'Armas')}
    build_pressure_hull(D, M, grp['Estrutura'])
    build_propulsion(D, M, root)
    build_tanks(D, M, grp['Tanques'])
    build_pipes(D, M, grp['Tubulacoes'])
    build_valves(D, M, grp['Valvulas'])
    build_pumps(D, M, grp['Bombas'])
    build_bottles(D, M, grp['ArAP'])
    build_ports(D, M, grp['Aberturas'])
    build_battery(D, M, grp['Energia'])
    build_generators(D, M, grp['Energia'])
    if 'torpedos' in D:
        build_torpedoes(D, M, grp['Armas'])
    bpy.context.view_layer.update()
    return D


def interior_meshes():
    out = []
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        top = o
        while top.parent is not None:
            top = top.parent
        if top.name == 'SX1I_Interior':
            out.append(o)
    return out


def bake_ao(objs, samples=48, distance=0.7, strength=0.7):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.seed = 0
    w = sc.world or bpy.data.worlds.new('SX1_Mundo')
    sc.world = w
    w.light_settings.distance = distance
    for o in objs:
        ca = o.data.color_attributes
        if 'AO' in ca:
            ca.remove(ca['AO'])
        ca.active_color = ca.new('AO', 'BYTE_COLOR', 'CORNER')
    for o in bpy.context.view_layer.objects:
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    for o in objs:
        me = o.data
        n = len(me.loops)
        col = np.empty(n * 4, dtype=np.float32)
        me.color_attributes['AO'].data.foreach_get('color', col)
        ao = col.reshape(-1, 4)[:, 0]
        if under(o, 'SX1I_Armas'):
            # peças longas (tubos de 8 m): média por vértice, senão o ruído de cada canto vira faixa ao longo da face
            vi = np.empty(n, dtype=np.int64)
            me.loops.foreach_get('vertex_index', vi)
            soma = np.bincount(vi, weights=ao, minlength=len(me.vertices))
            cont = np.maximum(np.bincount(vi, minlength=len(me.vertices)), 1)
            ao = (soma / cont)[vi]
        f = np.clip(1 - strength * (1 - ao), 0.3, 1.0)
        out = np.repeat(f[:, None], 4, axis=1)
        out[:, 3] = 1.0
        me.color_attributes['AO'].data.foreach_set('color', out.ravel())


def export_interior(path):
    for o in bpy.context.view_layer.objects:
        top = o
        while top.parent is not None:
            top = top.parent
        o.select_set(top.name == 'SX1I_Interior')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        use_selection=True,
        export_extras=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_vertex_color='NAME',
        export_vertex_color_name='AO',
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=False,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    return os.path.getsize(path)


def stats():
    objs = interior_meshes()
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
    nonmanifold = []
    for o in objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        if any(not e.is_manifold for e in bm.edges):
            nonmanifold.append(o.name)
        bm.free()
    return dict(objetos=len(objs), tris=tris, nao_fechadas=nonmanifold)


# ------------------------------------------------------------------ prévia do meio casco aberto
def cut_half(objs, cap):
    """Corta no plano x = 0 (eixo) e remove o bordo de bombordo (x < 0). cap=True fecha a face de corte."""
    bpy.context.view_layer.update()
    for o in objs:
        loc = o.matrix_world.translation
        bm = bmesh.new()
        bm.from_mesh(o.data)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=(-loc.x, 0, 0), plane_no=(1, 0, 0), clear_inner=True)
        if cap:
            cut = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge) and e.is_boundary]
            if cut:
                bmesh.ops.holes_fill(bm, edges=cut, sides=0)
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()


def preview_cut(json_path, out_dir):
    """Prévia do meio casco aberto: casco externo + interior cortados no plano do eixo (some bombordo)."""
    base.build('alta')  # casco externo (limpa a cena)
    exterior = [o for o in bpy.data.objects if o.type == 'MESH']
    build_interior(json_path)
    inner = interior_meshes()
    bake_ao(inner, samples=24)
    cut_half(exterior, cap=False)  # casco: casca fina, só aparada
    cut_half(inner, cap=True)  # peças fechadas: face de corte preenchida
    h = {'__file__': os.path.join(HERE, 'preview_sx1.py'), '__name__': 'sx1_prev'}
    exec(compile(open(h['__file__'], encoding='utf-8').read(), h['__file__'], 'exec'), h)
    # luz entrando pelo lado aberto (bombordo) e de cima
    sun = bpy.data.objects.new('CUT_Sun', bpy.data.lights.new('CUT_Sun', 'SUN'))
    bpy.context.scene.collection.objects.link(sun)
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(-35), math.radians(-40), 0)
    h['VIEWS'].clear()
    h['VIEWS'].update(
        {
            'corte_lado': ((-80, 2, 1), (0, 2, 0), 32),
            'corte_34_proa': ((-38, 46, 10), (0, 10, -0.5), 34),
            'corte_34_popa': ((-34, -46, 9), (0, -12, -0.5), 34),
            'corte_meio': ((-13, 10, 2.5), (0, 3, -1.4), 30),
            'corte_ar_ap': ((-12, -16, 2.5), (0, -7, -0.8), 30),
            'corte_vante': ((-12, 33, 2.5), (0, 25, -0.3), 30),
        }
    )
    return h['render_all'](out_dir)


def under(o, name):
    p = o
    while p is not None:
        if p.name == name:
            return True
        p = p.parent
    return False


def preview_propulsion(json_path, out_dir):
    """Prévia da futura vista da propulsão: só motor, eixo, mancais e hélice, dentro do submarino translúcido."""
    base.build('alta')
    exterior = [o for o in bpy.data.objects if o.type == 'MESH']
    build_interior(json_path)
    prop = [o for o in interior_meshes() if under(o, 'SX1I_Propulsao')]
    bake_ao(prop, samples=24)
    for o in interior_meshes():
        if o not in prop:
            o.hide_render = True
    ghost = {}
    for o in exterior:
        if under(o, 'SX1_Helice'):
            continue  # hélice inteiro, opaco
        for i, m in enumerate(o.data.materials):
            if m is None:
                continue
            if m.name not in ghost:
                g = m.copy()
                g.name = m.name + '_fantasma'
                b = g.node_tree.nodes['Principled BSDF']
                b.inputs['Alpha'].default_value = 0.13
                if hasattr(g, 'surface_render_method'):
                    g.surface_render_method = 'BLENDED'
                g.use_backface_culling = True
                ghost[m.name] = g
            o.data.materials[i] = ghost[m.name]
    h = {'__file__': os.path.join(HERE, 'preview_sx1.py'), '__name__': 'sx1_prev'}
    exec(compile(open(h['__file__'], encoding='utf-8').read(), h['__file__'], 'exec'), h)
    h['VIEWS'].clear()
    h['VIEWS'].update(
        {
            'propulsao_lado': ((-80, -2, 4), (0, -2, 0), 32),
            'propulsao_34_popa': ((-30, -58, 16), (0, -22, 0), 32),
            'propulsao_motor': ((-8, -9.5, 3.5), (0, -15.5, -0.3), 32),
            'propulsao_popa': ((-9, -40, 3), (0, -31, 0), 30),
        }
    )
    return h['render_all'](out_dir)


FILL = {'lastro': 0.6, 'compensacao': 0.5, 'trim': 0.5, 'banda': 0.5}  # imersão em andamento
FLOW_COLORS = {'#9fe0ff', '#ffffff', '#9dffc8', '#ffd18a'}  # água dos TLP, ar dos suspiros, compensação, trim
OPEN_VALVES = ('Suspiro', 'Admissão de mar', 'Válvula TC', 'Isolamento TT')


def fluid_mat(name, hexstr, alpha, emit):
    m, b = base.principled(name, srgb(hexstr), 0.25, 0.0)
    b.inputs['Alpha'].default_value = alpha
    b.inputs['Emission Color'].default_value = (*srgb(hexstr), 1)
    b.inputs['Emission Strength'].default_value = emit
    if hasattr(m, 'surface_render_method'):
        m.surface_render_method = 'BLENDED'
    m.use_backface_culling = False
    return m


def water_solid(o, fill):
    """Sólido de água: o tanque recortado no nível que contém fill × volume (busca binária no volume)."""

    def below(z):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=(0, 0, z), plane_no=(0, 0, 1), clear_outer=True)
        cut = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge) and e.is_boundary]
        if cut:
            bmesh.ops.holes_fill(bm, edges=cut, sides=0)
        return bm

    zs = [v.co.z for v in o.data.vertices]
    bm = below(max(zs) + 1)
    full = bm.calc_volume()
    bm.free()
    lo, hi = min(zs), max(zs)
    for _ in range(24):
        mid = (lo + hi) / 2
        bm = below(mid)
        v = bm.calc_volume()
        bm.free()
        if v < fill * full:
            lo = mid
        else:
            hi = mid
    bm = below((lo + hi) / 2)
    me = bpy.data.meshes.new(o.name + '_Agua')
    bm.to_mesh(me)
    bm.free()
    w = bpy.data.objects.new(o.name.replace('_Malha', '_Agua'), me)
    base.collection().objects.link(w)
    w.matrix_world = o.matrix_world.copy()
    return w


def preview_fluids(json_path, out_dir):
    """Prévia do meio casco aberto com fluidos de exemplo (imersão em andamento): água nos tanques no nível,
    partículas de escoamento nos trajetos do site e volantes coloridos pela posição (verde aberta, vermelha
    fechada). É o que o site desenharia sobre o modelo; os níveis aqui são fixos, só para a prévia."""
    D = json.load(open(json_path, encoding='utf-8'))
    base.build('alta')
    exterior = [o for o in bpy.data.objects if o.type == 'MESH']
    build_interior(json_path)
    inner = interior_meshes()
    bake_ao(inner, samples=16)
    tanks = {t['id']: t for t in D['tanques']}
    waters = []
    for o in inner:
        mm = re.match(r'SX1I_Tanque_([A-Z0-9]+)_Malha$', o.name)
        if not mm:
            continue
        t = tanks[mm.group(1)]
        w = water_solid(o, FILL[t['categoria']])
        w.data.materials.append(fluid_mat('SX1I_agua_' + t['categoria'], t['cor'], 0.82, 0.6))
        waters.append(w)
        # parede do tanque: vidro tingido (o ar fica visível acima da água)
        m = o.data.materials[0]
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Alpha'].default_value = 0.18
        if hasattr(m, 'surface_render_method'):
            m.surface_render_method = 'BLENDED'
        m.use_backface_culling = False
    # partículas de escoamento nos trajetos do site
    for k, st in enumerate(D['escoamentos']):
        if st['cor'] not in FLOW_COLORS:
            continue
        P = [v3(q) for q in st['pontos']]
        mat = fluid_mat('SX1I_fluxo_' + st['cor'].lstrip('#'), st['cor'], 1.0, 3.0)
        dots = []
        for i in range(len(P) - 1):
            L = float(np.linalg.norm(P[i + 1] - P[i]))
            for j in range(int(L / 0.4) + 1):
                q = P[i] + (P[i + 1] - P[i]) * min(1.0, j * 0.4 / max(L, 1e-6))
                if q[0] >= -0.05:
                    dots.append(sphere(q, 0.06, 8))
        if dots:
            verts, faces = merge(dots)
            me = base.make_mesh(f'SX1I_Fluxo_{k}', verts, faces, None, mat)
            base.add_object(f'SX1I_Fluxo_{k}', me)
    # volantes pela posição das válvulas (verde aberta, vermelha fechada)
    green = base.principled('SX1I_volante_aberta', (0.05, 0.55, 0.12), 0.45, 0.1)[0]
    for o in inner:
        if o.name.endswith('_Volante_Malha') and o.parent and o.parent.parent:
            nome = o.parent.parent.get('nome', '')
            if any(k in nome for k in OPEN_VALVES):
                o.data.materials[0] = green
    tank_meshes = [o for o in inner if re.match(r'SX1I_Tanque_[A-Z0-9]+_Malha$', o.name)]
    cut_half(exterior, cap=False)
    cut_half([o for o in inner if o not in tank_meshes], cap=True)
    cut_half(tank_meshes, cap=False)
    cut_half(waters, cap=True)
    h = {'__file__': os.path.join(HERE, 'preview_sx1.py'), '__name__': 'sx1_prev'}
    exec(compile(open(h['__file__'], encoding='utf-8').read(), h['__file__'], 'exec'), h)
    sun = bpy.data.objects.new('CUT_Sun', bpy.data.lights.new('CUT_Sun', 'SUN'))
    bpy.context.scene.collection.objects.link(sun)
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(-35), math.radians(-40), 0)
    h['VIEWS'].clear()
    h['VIEWS'].update(
        {
            'fluidos_lado': ((-80, 2, 1), (0, 2, 0), 32),
            'fluidos_34_proa': ((-38, 46, 10), (0, 10, -0.5), 34),
            'fluidos_vante': ((-11, 33, 2.5), (0, 25.5, -0.3), 30),
            'fluidos_re': ((-11, -28, 2.5), (0, -20, -0.5), 30),
            'fluidos_meio': ((-12, 9, 2.5), (0, 3, -1.4), 30),
            'fluidos_ar_ap': ((-12, -16, 2.5), (0, -7, -0.8), 30),
        }
    )
    return h['render_all'](out_dir)


def preview_torpedoes(json_path, out_dir):
    """Prévia dos tubos lançadores e da sala de torpedos dentro do submarino translúcido."""
    base.build('alta')
    exterior = [o for o in bpy.data.objects if o.type == 'MESH']
    build_interior(json_path)
    keep = [o for o in interior_meshes() if under(o, 'SX1I_Armas') or under(o, 'SX1I_Antepara_Vante')]
    bake_ao(keep, samples=24)
    for o in interior_meshes():
        if o not in keep:
            o.hide_render = True
    ghost = {}
    for o in exterior:
        for i, m in enumerate(o.data.materials):
            if m is None:
                continue
            if m.name not in ghost:
                g = m.copy()
                g.name = m.name + '_fantasma'
                b = g.node_tree.nodes['Principled BSDF']
                b.inputs['Alpha'].default_value = 0.12
                if hasattr(g, 'surface_render_method'):
                    g.surface_render_method = 'BLENDED'
                g.use_backface_culling = True
                ghost[m.name] = g
            o.data.materials[i] = ghost[m.name]
    h = {'__file__': os.path.join(HERE, 'preview_sx1.py'), '__name__': 'sx1_prev'}
    exec(compile(open(h['__file__'], encoding='utf-8').read(), h['__file__'], 'exec'), h)
    h['VIEWS'].clear()
    h['VIEWS'].update(
        {
            'torpedos_lado': ((-30, 26, 3), (0, 26.5, -0.3), 40),
            'torpedos_34_proa': ((16, 47, -7), (0, 28, -0.6), 40),
            'torpedos_cima': ((0.5, 25, 34), (0, 25, 0), 40),
            'torpedos_sala': ((-0.4, 15.2, 0.9), (0, 24.0, -0.2), 22),
        }
    )
    return h['render_all'](out_dir)


def main(argv):
    jp = os.path.join(ROOT, 'build', 'modelo', 'interior.json')
    out = os.path.join(ROOT, 'build', 'modelo')
    if '--json' in argv:
        jp = os.path.abspath(argv[argv.index('--json') + 1])
    if '--saida' in argv:
        out = os.path.abspath(argv[argv.index('--saida') + 1])
    base.TEX_DIR = os.path.join(out, 'texturas')
    base.clear_scene()
    build_interior(jp)
    info = stats()
    bake_ao(interior_meshes())
    info['bytes'] = export_interior(os.path.join(out, 'sx1-interior.raw.glb'))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'sx1-interior.blend'), compress=True)
    if '--corte' in argv:
        info['previas'] = preview_cut(jp, os.path.join(out, 'corte'))
    if '--propulsao' in argv:
        info['propulsao'] = preview_propulsion(jp, os.path.join(out, 'propulsao'))
    if '--torpedos' in argv:
        info['torpedos'] = preview_torpedoes(jp, os.path.join(out, 'torpedos'))
    if '--fluidos' in argv:
        info['fluidos'] = preview_fluids(jp, os.path.join(out, 'fluidos'))
    print('SX1I', info)
    return info


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    RESULT = main(args)
