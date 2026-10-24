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
    mat('fundido', (0.30, 0.31, 0.33), 0.45, 0.6)  # corpos de válvula e bombas
    mat('volante', (0.55, 0.05, 0.04), 0.5, 0.1)  # volantes vermelhos
    mat('placa', (0.85, 0.82, 0.62), 0.6, 0.0)  # plaquetas de identificação
    mat('motor', (0.16, 0.24, 0.30), 0.5, 0.2)  # motores elétricos (azul-acinzentado)
    mat('gerador', (0.22, 0.26, 0.22), 0.55, 0.25)  # diesel (verde-oliva)
    mat('celula', (0.05, 0.05, 0.06), 0.6, 0.0)  # células da bateria
    mat('polo_pos', (0.6, 0.06, 0.04), 0.4, 0.5)
    mat('polo_neg', (0.02, 0.02, 0.02), 0.4, 0.5)
    mat('cobre', (0.75, 0.42, 0.2), 0.3, 1.0)
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


def build_pipes(D, M, parent):
    for i, p in enumerate(D['tubos']):
        r = p['raio'] * 0.75  # o desenho do site exagera o diâmetro; aqui fica mais realista
        path = rounded(p['pontos'], rb=3.0 * r)
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
    for i, bt in enumerate(D['bateria']):
        c = v3(bt['centro'])
        w, l, h = bt['tamanho']
        name = f'SX1I_Bateria_{i + 1}'
        tray = [box(c - v3((0, 0, h / 2 - 0.04)), (w + 0.06, l + 0.06, 0.08))]
        e = mesh_obj(name, tray, M['aco'], parent, c, extras={'tipo': 'bateria'})
        nx, ny = max(1, round(w / 0.38)), max(1, round(l / 0.26))
        dx, dy = w / nx, l / ny
        cells, pos, neg = [], [], []
        for ix in range(nx):
            for iy in range(ny):
                cc = c + v3((-w / 2 + dx * (ix + 0.5), -l / 2 + dy * (iy + 0.5), 0.02))
                cells.append(box(cc, (dx - 0.025, dy - 0.025, h - 0.12)))
                top = cc + v3((0, 0, (h - 0.12) / 2 + 0.025))
                pos.append(cylinder(top + v3((-dx * 0.25, 0, 0)), (0, 0, 1), 0.025, 0.05, n=8))
                neg.append(cylinder(top + v3((dx * 0.25, 0, 0)), (0, 0, 1), 0.025, 0.05, n=8))
        mesh_obj(name + '_Celulas', cells, M['celula'], e, c, sharp=30)
        mesh_obj(name + '_PolosPos', pos, M['polo_pos'], e, c)
        mesh_obj(name + '_PolosNeg', neg, M['polo_neg'], e, c)
        bars = [box(c + v3((-w / 2 + dx * (ix + 0.5), 0, (h - 0.12) / 2 + 0.07)), (0.04, l - 0.1, 0.02)) for ix in range(nx)]
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


# ------------------------------------------------------------------ montagem
def build_interior(json_path):
    D = json.load(open(json_path, encoding='utf-8'))
    M = materials(D)
    root = group('SX1I_Interior')
    root['gerado_de'] = D['gerado']
    grp = {k: group('SX1I_' + k, root) for k in ('Tanques', 'Tubulacoes', 'Valvulas', 'Bombas', 'ArAP', 'Aberturas', 'Energia')}
    build_tanks(D, M, grp['Tanques'])
    build_pipes(D, M, grp['Tubulacoes'])
    build_valves(D, M, grp['Valvulas'])
    build_pumps(D, M, grp['Bombas'])
    build_bottles(D, M, grp['ArAP'])
    build_ports(D, M, grp['Aberturas'])
    build_battery(D, M, grp['Energia'])
    build_generators(D, M, grp['Energia'])
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
    print('SX1I', info)
    return info


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    RESULT = main(args)
