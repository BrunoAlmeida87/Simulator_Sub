"""
MODELO 3D DO SX-1 (fictício) — monta no Blender e exporta sx1-alta / sx1-leve (.glb cru).

Inspirado no exterior PÚBLICO do Scorpène e da classe Riachuelo (S-BR). Sem marcas,
numerais ou brasões reais. Só visual: as medidas vêm da física
(src/sim/config/defaultVessel.ts e src/sim/physics/hullGeometry.ts) e NÃO mudam nada nela.

Uso (sem interface):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
      -P scripts/blender/build_sx1.py -- [--saida build/modelo] [--nivel alta|leve|ambos]
Depois: npm run modelo:otimizar  (meshopt + cópia para public/models/)

Também roda dentro do Blender aberto (Text Editor ou exec), com os padrões.

Convenções (iguais a src/render3d/subModel.ts):
  - metros; origem no eixo do casco, a meio comprimento;
  - Blender: +Y = proa, +X = boreste, +Z = para cima (glTF exportado com +Y para cima);
  - cada peça móvel é um nó vazio com o nome fixo, ORIGEM sobre o eixo de giro e na posição de
    repouso (lemes a zero, mastros arriados); a malha é filha (nome + "_Malha"), sem transformação.
    Assim a compressão (quantização) mexe só na malha e nunca no pivô.
"""
import math
import os
import sys

import bmesh  # noqa: F401  (disponível para quem editar o script no Blender)
import bpy
import numpy as np

# ------------------------------------------------------------------ parâmetros da física (defaultVessel.ts)
L = 70.0  # comprimento
R = 3.1  # raio (diâmetro 6,2)
BOW_LEN = 9.0  # proa elíptica
STERN_LEN = 20.0  # popa parabólica
TAIL_R = 0.4  # raio na ponta da popa
SAIL = dict(x_fwd=14.0, x_aft=4.0, height=5.2, width=1.5)
SAIL_PLANE = dict(x=10.5, z=5.8)  # lemes de vela (madre), acima do eixo
STERN_X = -31.5  # lemes de popa (madre)
PROP = dict(x=-(L / 2 + 0.6), diameter=4.4, blades=7)
SNORKEL = dict(x=8.0, extension=4.5)
PERISCOPE = dict(x=12.0, extension=5.0)
# tanques de lastro (TLP): x do centro e meia-boca do embornal (Systems.ts: yF = rr·0,5)
TLP_X = [28.0, -23.5]

TEX_DIR = os.path.join(os.environ.get('TEMP', '/tmp'), 'sx1_texturas')  # main() troca para build/modelo/texturas

XB0 = L / 2 - BOW_LEN
XS0 = -L / 2 + STERN_LEN
SAIL_TOP = R + SAIL['height']  # 8,3 m acima do eixo

# padrão dos ladrilhos anecoicos: 40 placas na circunferência (5 repetições de 8)
TILE = 2 * math.pi * R / 40  # ≈ 0,487 m
REP = 8 * TILE  # comprimento de uma repetição da textura (m)


def radius_at(x):
    """Igual a radiusAt de hullGeometry.ts."""
    if x > L / 2 or x < -L / 2:
        return 0.0
    if x > XB0:
        t = (x - XB0) / BOW_LEN
        return R * math.sqrt(max(0.0, 1 - t * t))
    if x < XS0:
        s = (XS0 - x) / STERN_LEN
        return TAIL_R + (R - TAIL_R) * (1 - s * s)
    return R


LEVELS = {
    'alta': dict(seg=160, mid_step=0.8, stern_n=48, bow_n=36, tex=2048, tex_small=512, fin_k=24, prop_ns=16, prop_kc=14, slots=True, ao_samples=96),
    'leve': dict(seg=56, mid_step=2.5, stern_n=20, bow_n=16, tex=1024, tex_small=256, fin_k=12, prop_ns=8, prop_kc=7, slots=False, ao_samples=48),
}


# ------------------------------------------------------------------ utilidades
def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.node_groups):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)


def collection():
    c = bpy.data.collections.get('SX1')
    if not c:
        c = bpy.data.collections.new('SX1')
        bpy.context.scene.collection.children.link(c)
    return c


def radial_out(c):
    return (c[0], 0.0, c[2])


def make_mesh(name, verts, faces, uvs=None, mat=None, smooth=True, sharp_deg=None, outward='closed'):
    """verts: lista (x,y,z); faces: índices; uvs: lista paralela a faces com um (u,v) por canto.

    outward: 'closed' (malha fechada: normais recalculadas para fora) ou função centro→direção
    para fora (retalhos abertos colados a uma superfície)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    if uvs is not None:
        layer = me.uv_layers.new(name='UV')
        flat = [c for fu in uvs for uv in fu for c in uv]
        layer.data.foreach_set('uv', flat)
    if mat is not None:
        me.materials.append(mat)
    bm = bmesh.new()
    bm.from_mesh(me)
    if outward == 'closed':
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    elif outward is not None:
        for f in bm.faces:
            c = f.calc_center_median()
            d = outward((c.x, c.y, c.z))
            if f.normal.dot(d) < 0:
                f.normal_flip()
    bm.to_mesh(me)
    bm.free()
    me.validate(clean_customdata=False)
    if smooth:
        me.shade_smooth()
        if sharp_deg is not None:
            me.set_sharp_from_angle(angle=math.radians(sharp_deg))
    me.update()
    return me


def add_object(name, me=None, location=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, me)
    collection().objects.link(o)
    o.location = location
    if parent is not None:
        o.parent = parent
    return o


def moving_part(name, pivot, me, parent=None):
    """Nó vazio com o nome fixo (pivô) + malha filha sem transformação."""
    e = add_object(name, None, pivot, parent)
    e.empty_display_type = 'ARROWS'
    e.empty_display_size = 0.6
    add_object(name + '_Malha', me, (0, 0, 0), e)
    return e


def grid_faces(nu, nv, closed_u=False):
    """Quads de uma grade nu×nv (índice = i*nv + j); closed_u liga a última coluna à primeira em j."""
    faces = []
    for i in range(nu - 1):
        for j in range(nv if closed_u else nv - 1):
            j1 = (j + 1) % nv
            faces.append((i * nv + j, (i + 1) * nv + j, (i + 1) * nv + j1, i * nv + j1))
    return faces


# ------------------------------------------------------------------ texturas (numpy, determinísticas)
def periodic_noise(rng, n, scale):
    w = rng.standard_normal((n, n))
    f = np.fft.rfft2(w)
    ky = np.fft.fftfreq(n)[:, None]
    kx = np.fft.rfftfreq(n)[None, :]
    k = np.sqrt(kx * kx + ky * ky)
    f *= np.exp(-((k * n / scale) ** 2))
    out = np.fft.irfft2(f, s=(n, n))
    return out / (np.abs(out).max() + 1e-9)


def height_to_normal(h, strength):
    gy, gx = np.gradient(h)
    # bordas periódicas (a textura se repete)
    gx[:, 0] = (h[:, 1] - h[:, -1]) / 2
    gx[:, -1] = (h[:, 0] - h[:, -2]) / 2
    gy[0, :] = (h[1, :] - h[-1, :]) / 2
    gy[-1, :] = (h[0, :] - h[-2, :]) / 2
    nx, ny = -gx * strength, -gy * strength
    nz = np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], axis=-1)


def to_image(name, rgb, non_color):
    n = rgb.shape[0]
    img = bpy.data.images.get(name)
    if img and (img.size[0] != n):
        bpy.data.images.remove(img)
        img = None
    if not img:
        img = bpy.data.images.new(name, n, n, alpha=False, float_buffer=False)
    a = np.ones((n, n, 4), dtype=np.float32)
    a[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(a.ravel())
    img.update()
    # imagem "gerada" perde os pixels ao empacotar: grava em PNG e empacota o arquivo
    os.makedirs(TEX_DIR, exist_ok=True)
    img.filepath_raw = os.path.join(TEX_DIR, f'{name}_{n}.png')
    img.file_format = 'PNG'
    img.save()
    img.pack()
    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    return img


def tile_textures(n):
    """Ladrilhos anecoicos: 8×8 placas em fiadas desencontradas; juntas finas, leve relevo e variação."""
    rng = np.random.default_rng(87)
    v, u = np.mgrid[0:n, 0:n] / n * 8.0  # v = linha (para cima), u = coluna
    row = np.floor(v)
    uu = u + 0.5 * (row % 2)  # fiadas desencontradas (meia placa)
    col = np.floor(uu) % 8
    fx, fy = uu % 1.0, v % 1.0
    d = np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy))
    tid = (row * 8 + col).astype(int)
    rnd = rng.random(64)
    rnd2 = rng.random(64)
    groove = 0.006
    bevel = np.clip((d - groove) / 0.02, 0, 1)
    bevel = bevel * bevel * (3 - 2 * bevel)
    noise = periodic_noise(rng, n, n / 6)
    fine = periodic_noise(rng, n, n / 1.5)
    h = bevel * (1 + 0.05 * rnd[tid]) + 0.025 * noise * bevel + 0.01 * fine
    nrm = height_to_normal(h, n / 160)
    base = 0.042 + 0.007 * (rnd2[tid] - 0.5) + 0.004 * noise  # grafite muito escuro (linear ≈ 0,04)
    base = np.where(d < groove, 0.03, base)
    col_rgb = np.stack([base * 0.98, base, base * 1.04], axis=-1)
    # acetinado (revestimento levemente molhado): o reflexo do céu desenha a curvatura do casco
    rough = np.clip(0.46 + 0.08 * (rnd[tid] - 0.5) + 0.05 * noise, 0, 1)
    rough = np.where(d < groove, 0.58, rough)
    orm = np.stack([np.ones_like(rough), rough, np.zeros_like(rough)], axis=-1)
    return col_rgb, nrm, orm


def grate_textures(n):
    """Grade de embornal / sonar: 6 rasgos longitudinais com moldura (furo = preto)."""
    v, u = np.mgrid[0:n, 0:n] / n
    frame = 0.08
    inside = (u > frame) & (u < 1 - frame) & (v > frame) & (v < 1 - frame)
    k = ((u - frame) / (1 - 2 * frame)) * 6
    slot = inside & ((k % 1.0) > 0.22) & ((k % 1.0) < 0.78)
    h = np.where(slot, 0.0, 1.0)
    rng = np.random.default_rng(5)
    h = h - 0.02 * periodic_noise(rng, n, n / 8)
    # chanfro nas bordas dos rasgos
    from_edge = np.minimum(np.abs((k % 1.0) - 0.22), np.abs((k % 1.0) - 0.78))
    h = np.where(inside & ~slot, np.minimum(1.0, 0.6 + from_edge * 4), h)
    nrm = height_to_normal(h, n / 48)
    base = np.where(slot, 0.002, 0.024)
    col_rgb = np.stack([base, base, base * 1.05], axis=-1)
    return col_rgb, nrm


def deck_normal(n):
    """Antiderrapante: pontos em relevo a cada 4 cm (1 m por repetição)."""
    v, u = np.mgrid[0:n, 0:n] / n * 25.0
    fx, fy = u % 1.0 - 0.5, (v + 0.5 * (np.floor(u) % 2)) % 1.0 - 0.5
    dot = np.clip(1 - (fx * fx + fy * fy) / 0.08, 0, 1)
    rng = np.random.default_rng(11)
    h = dot * 0.6 + 0.15 * periodic_noise(rng, n, n / 10)
    return height_to_normal(h, n / 40)


# ------------------------------------------------------------------ materiais
def principled(name, color, rough, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m, b


def hook_textures(m, b, col=None, nrm=None, orm=None, nrm_strength=1.0):
    nt = m.node_tree
    tc = nt.nodes.new('ShaderNodeTexCoord')
    x = -900
    if col is not None:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = col
        t.location = (x, 300)
        nt.links.new(tc.outputs['UV'], t.inputs['Vector'])
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    if orm is not None:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = orm
        t.location = (x, 0)
        nt.links.new(tc.outputs['UV'], t.inputs['Vector'])
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        sep.location = (x + 300, 0)
        nt.links.new(t.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
    if nrm is not None:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = nrm
        t.location = (x, -300)
        nt.links.new(tc.outputs['UV'], t.inputs['Vector'])
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.location = (x + 300, -300)
        nm.inputs['Strength'].default_value = nrm_strength
        nt.links.new(t.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])


def build_materials(cfg):
    tc, tn, to = tile_textures(cfg['tex'])
    gc, gn = grate_textures(cfg['tex_small'])
    dn = deck_normal(cfg['tex_small'])
    img = dict(
        tile_c=to_image('SX1_ladrilho_cor', tc, False),
        tile_n=to_image('SX1_ladrilho_normal', tn, True),
        tile_orm=to_image('SX1_ladrilho_orm', to, True),
        grate_c=to_image('SX1_grade_cor', gc, False),
        grate_n=to_image('SX1_grade_normal', gn, True),
        deck_n=to_image('SX1_conves_normal', dn, True),
    )
    M = {}
    m, b = principled('SX1_Casco', (0.02, 0.02, 0.021), 0.8)
    hook_textures(m, b, img['tile_c'], img['tile_n'], img['tile_orm'], 0.4)
    M['casco'] = m
    m, b = principled('SX1_Conves', (0.045, 0.046, 0.048), 0.6)
    hook_textures(m, b, None, img['deck_n'], None, 0.7)
    M['conves'] = m
    m, b = principled('SX1_Grade', (0.02, 0.02, 0.02), 0.7, 0.2)
    hook_textures(m, b, img['grate_c'], img['grate_n'], None, 1.0)
    M['grade'] = m
    m, b = principled('SX1_Sonar', (0.035, 0.035, 0.038), 0.5, 0.1)
    hook_textures(m, b, None, img['grate_n'], None, 0.35)
    M['sonar'] = m
    M['porta'] = principled('SX1_Porta', (0.016, 0.016, 0.017), 0.45, 0.2)[0]
    M['helice'] = principled('SX1_Helice', (0.42, 0.31, 0.19), 0.32, 0.9)[0]
    M['mastro'] = principled('SX1_Mastro', (0.07, 0.075, 0.08), 0.45, 0.5)[0]
    M['vidro'] = principled('SX1_Vidro', (0.01, 0.02, 0.03), 0.05, 0.9)[0]
    return M


# ------------------------------------------------------------------ casco
def hull_stations(cfg):
    ys = []
    n = cfg['stern_n']
    for i in range(n):  # popa: mais densa perto da ponta
        t = i / n
        ys.append(-L / 2 + STERN_LEN * (1 - (1 - t) ** 1.3))
    y = XS0
    while y < XB0 - 1e-6:
        ys.append(y)
        y += cfg['mid_step']
    for i in range(cfg['bow_n'] + 1):  # proa elíptica: parâmetro angular (ponta bem resolvida)
        th = (math.pi / 2) * i / cfg['bow_n']
        ys.append(XB0 + BOW_LEN * math.sin(th))
    return sorted(set(round(v, 6) for v in ys))


def build_hull(cfg, M):
    seg = cfg['seg']
    ys = hull_stations(cfg)
    verts, faces, uvs = [], [], []
    # φ medido a partir do FUNDO (costura da textura embaixo); 5 repetições na volta
    phis = [math.pi + 2 * math.pi * j / seg for j in range(seg)]
    rings = []
    for y in ys:
        r = radius_at(y)
        if r < 1e-6:
            rings.append(None)
            continue
        rings.append(len(verts))
        for p in phis:
            verts.append((r * math.sin(p), y, r * math.cos(p)))
    tip = len(verts)
    verts.append((0.0, L / 2, 0.0))
    tail_c = len(verts)
    verts.append((0.0, -L / 2, 0.0))
    U = lambda j: 5.0 * j / seg  # noqa: E731
    V = lambda y: y / REP  # noqa: E731
    for i in range(len(ys) - 1):
        a, b = rings[i], rings[i + 1]
        if a is None:
            continue
        for j in range(seg):
            j1 = (j + 1) % seg
            if b is None:  # ponta da proa
                faces.append((a + j, a + j1, tip))
                uvs.append(((U(j), V(ys[i])), (U(j + 1), V(ys[i])), ((U(j) + U(j + 1)) / 2, V(ys[i + 1]))))
            else:
                faces.append((a + j, a + j1, b + j1, b + j))
                uvs.append(((U(j), V(ys[i])), (U(j + 1), V(ys[i])), (U(j + 1), V(ys[i + 1])), (U(j), V(ys[i + 1]))))
    a = rings[0]  # tampa da popa (atrás do cubo do hélice)
    for j in range(seg):
        j1 = (j + 1) % seg
        faces.append((a + j1, a + j, tail_c))
        uvs.append(((U(j + 1), 0), (U(j), 0), (U(j) + 0.01, 0.01)))
    me = make_mesh('SX1_Casco', verts, faces, uvs, M['casco'])
    o = add_object('SX1_Casco', me)
    # conferência: todo vértice do anel está exatamente em radiusAt(y)
    err = max(abs(math.hypot(v[0], v[2]) - radius_at(v[1])) for v in verts[: tip])
    assert err < 1e-4, f'casco fora de radiusAt: {err}'
    return o, err


def conformal_patch(name, y0, y1, ph0, ph1, off, mat, nu=2, nv=2, uv_rect=(0, 0, 1, 1), border=None):
    """Retalho colado ao casco (φ a partir do TOPO, + para boreste). border=(largura, altura) faz um ressalto."""
    verts, uvs_v = [], []
    for i in range(nu + 1):
        y = y0 + (y1 - y0) * i / nu
        for j in range(nv + 1):
            p = ph0 + (ph1 - ph0) * j / nv
            o = off
            if border:
                bw, bh = border
                dy = min(y - y0, y1 - y) / bw
                dp = min(p - ph0, ph1 - p) * radius_at(y) / bw
                o = off + bh * min(1.0, dy, dp)
            r = radius_at(y) + o
            verts.append((r * math.sin(p), y, r * math.cos(p)))
            uvs_v.append((uv_rect[0] + (uv_rect[2] - uv_rect[0]) * i / nu, uv_rect[1] + (uv_rect[3] - uv_rect[1]) * j / nv))
    faces = grid_faces(nu + 1, nv + 1)
    uvs = [tuple(uvs_v[k] for k in f) for f in faces]
    return verts, faces, uvs


def merge_parts(parts):
    verts, faces, uvs = [], [], []
    for v, f, u in parts:
        base = len(verts)
        verts += v
        faces += [tuple(k + base for k in ff) for ff in f]
        uvs += u
    return verts, faces, uvs


def build_hull_details(cfg, M):
    objs = []
    # topo do casco liso, como nas fotos (sem faixa de convés em relevo nem rasgos ou grades): escotilhas e cabeços retráteis
    parts = []
    for y, rr in ((21.0, 0.45), (2.2, 0.42), (-12.0, 0.42), (26.5, 0.3)):
        top = radius_at(y) + 0.03
        parts.append(disc(0, y, top, rr, 0.08, 24 if cfg['slots'] else 12))
    for y in (27.5, 17.0, -9.5, -17.5):
        top = radius_at(y) + 0.06
        for x in (-0.55, 0.55):
            parts.append(disc(x, y, top, 0.09, 0.2, 10))
    v, f, u = merge_parts(parts)
    objs.append(add_object('SX1_Casco_Escotilhas', make_mesh('SX1_Casco_Escotilhas', v, f, u, M['conves'], sharp_deg=50)))

    # sonar de flanco: painel em ressalto baixo nos dois bordos (x = 3…25 m)
    parts = []
    for s in (1, -1):
        ph = sorted((s * math.radians(100), s * math.radians(121)))
        parts.append(conformal_patch('sonar', 3.0, 25.0, ph[0], ph[1], 0.004, None, nu=44 if cfg['slots'] else 10, nv=6, uv_rect=(0, 0, 22.0 / 0.6, 1), border=(0.12, 0.035)))
    v, f, u = merge_parts(parts)
    objs.append(add_object('SX1_Casco_SonarFlanco', make_mesh('SX1_Casco_SonarFlanco', v, f, u, M['sonar'], sharp_deg=35, outward=radial_out)))

    # embornais dos TLP (fundo do casco, ±meia-boca·0,5, três por bordo — mesma posição do corte)
    parts = []
    for xc in TLP_X:
        rr = max(1.2, radius_at(xc) - 0.2)
        for s in (1, -1):
            yF = s * rr * 0.5
            r = radius_at(xc)
            ph_c = math.pi - math.asin(max(-1, min(1, yF / r)))  # medido do topo
            dph = 0.30 / r
            for dx in (-1.2, 0.0, 1.2):
                parts.append(conformal_patch('emb', xc + dx - 0.45, xc + dx + 0.45, ph_c - dph, ph_c + dph, 0.006, None, nu=2, nv=2))
    v, f, u = merge_parts(parts)
    objs.append(add_object('SX1_Casco_Embornais', make_mesh('SX1_Casco_Embornais', v, f, u, M['grade'], smooth=False, outward=radial_out)))

    # portas dos tubos (3 por bordo) na proa
    parts = []
    for s in (1, -1):
        for a in (104, 124, 144):
            ph = s * math.radians(a)
            p0, p1 = sorted((ph - s * math.radians(8.5), ph + s * math.radians(8.5)))
            parts.append(conformal_patch('porta', 32.55, 33.35, p0, p1, 0.006, None, nu=3, nv=3, border=(0.06, 0.012)))
    v, f, u = merge_parts(parts)
    objs.append(add_object('SX1_Casco_PortasTubos', make_mesh('SX1_Casco_PortasTubos', v, f, u, M['porta'], sharp_deg=40, outward=radial_out)))
    return objs


def disc(x, y, z_top, r, h, n):
    """Cilindro curto (tampa) com topo plano em z_top, base afundada h."""
    verts, faces, uvs = [], [], []
    for k in range(n):
        a = 2 * math.pi * k / n
        verts.append((x + r * math.cos(a), y + r * math.sin(a), z_top - h))
        verts.append((x + r * math.cos(a), y + r * math.sin(a), z_top))
    c = len(verts)
    verts.append((x, y, z_top + 0.01))
    for k in range(n):
        k1 = (k + 1) % n
        faces.append((2 * k, 2 * k1, 2 * k1 + 1, 2 * k + 1))
        uvs.append(((0, 0), (1, 0), (1, 1), (0, 1)))
        faces.append((2 * k + 1, 2 * k1 + 1, c))
        uvs.append(((0, 0), (1, 0), (0.5, 1)))
    faces.append(tuple(2 * k for k in range(n - 1, -1, -1)))
    uvs.append(tuple((0.5, 0.5) for _ in range(n)))
    return verts, faces, uvs


# ------------------------------------------------------------------ vela
def sail_outline(z, K):
    """Contorno da vela na cota z (acima do eixo): (lista de (x, y)) com K pontos, sentido anti-horário."""
    h = max(0.0, z - R)
    hn = min(1.0, h / SAIL['height'])
    le = SAIL['x_fwd'] - 0.30 * hn  # bordo de ataque quase vertical
    te = SAIL['x_aft'] + 1.55 * hn  # bordo de fuga inclinado (topo mais curto que a base)
    w = SAIL['width'] / 2
    if h < 0.6:  # concordância com o casco na base
        w += 0.42 * ((0.6 - h) / 0.6) ** 2
    # arredondamento do topo
    inset = 0.0
    if z > SAIL_TOP - 0.2:
        q = (z - (SAIL_TOP - 0.2)) / 0.2
        inset = 0.3 * (1 - math.sqrt(max(0.0, 1 - q * q)))
    w = max(0.12, w - inset)
    le -= inset
    te += inset
    a = 1.35  # nariz elíptico
    tl = 0.75  # afilamento a ré
    nn, ns, nt = K // 3, K // 6, K // 6
    pts = []
    # boreste: da ré para vante
    for i in range(ns):
        pts.append((w, te + tl + (le - a - te - tl) * i / ns))
    for i in range(nn + 1):
        al = math.pi * i / nn
        pts.append((w * math.cos(al), le - a + a * math.sin(al)))
    for i in range(1, ns + 1):
        pts.append((-w, le - a - (le - a - te - tl) * i / ns))
    # cauda: de bombordo a boreste passando pelo bordo de fuga
    m = K - len(pts)
    for i in range(1, m + 1):
        s = i / (m + 1)  # 0 → 1 de bombordo a boreste
        ang = math.pi * s
        f = math.sin(ang)  # 0 nas extremidades… usamos para o recuo
        x = -w * math.cos(ang) * (0.18 + 0.82 * abs(math.cos(ang)) ** 0.7)
        y = te + tl * (1 - f) + 0.02 * f
        pts.append((x, y))
    return pts


def sail_out(c):
    return (c[0], c[1] - 9.0, c[2] - 5.5)


def build_sail(cfg, M):
    K = 48 if cfg['slots'] else 24
    zs = [R - 0.5, R, R + 0.12, R + 0.28, R + 0.45, R + 0.6, R + 1.2, R + 2.2, R + 3.2, R + 4.2, SAIL_TOP - 0.2, SAIL_TOP - 0.1, SAIL_TOP - 0.04, SAIL_TOP]
    verts = []
    for z in zs:
        for x, y in sail_outline(z, K):
            verts.append((x, y, z))
    faces = grid_faces(len(zs), K, closed_u=True)
    top0 = (len(zs) - 1) * K
    faces.append(tuple(top0 + k for k in range(K)))
    uvs = []
    for f in faces:
        pts = [verts[k] for k in f]
        if len(f) > 4:
            uvs.append(tuple((p[1] / REP, p[0] / REP) for p in pts))
        else:
            uvs.append(tuple((p[1] / REP, p[2] / REP) for p in pts))
    me = make_mesh('SX1_Vela', verts, faces, uvs, M['casco'], sharp_deg=50, outward=sail_out)
    sail = add_object('SX1_Vela', me)

    objs = [sail]
    # carenagens na raiz dos lemes de vela (fixas)
    parts = []
    for s in (1, -1):
        parts.append(ellipsoid((s * (SAIL['width'] / 2), SAIL_PLANE['x'] - 0.15, SAIL_PLANE['z']), (0.2, 1.25, 0.24), 16 if cfg['slots'] else 8))
    v, f, u = merge_parts(parts)
    objs.append(add_object('SX1_Casco_RaizLemesVela', make_mesh('SX1_Casco_RaizLemesVela', v, f, u, M['casco'])))

    # mastros fixos e carenagens no topo da vela (vante → ré); periscópio (12) e snorkel (8) são móveis
    parts, heads = [], []
    for y, ax, ay, hgt in ((13.05, 0.30, 0.42, 0.10), (11.0, 0.24, 0.3, 0.42), (10.0, 0.19, 0.24, 0.5), (9.15, 0.24, 0.34, 0.32), (6.55, 0.15, 0.2, 0.55)):
        n = 16 if cfg['slots'] else 8
        parts.append(elliptic_cyl(0, y, SAIL_TOP - 0.05, SAIL_TOP + hgt, ax, ay, n))
        if hgt > 0.2:
            heads.append(elliptic_cyl(0, y, SAIL_TOP + hgt, SAIL_TOP + hgt + 0.12, ax * 0.75, ay * 0.75, n))
    v, f, u = merge_parts(parts)
    objs.append(add_object('SX1_Casco_CarenagensVela', make_mesh('SX1_Casco_CarenagensVela', v, f, u, M['casco'], sharp_deg=45)))
    v, f, u = merge_parts(heads)
    objs.append(add_object('SX1_Casco_SensoresVela', make_mesh('SX1_Casco_SensoresVela', v, f, u, M['mastro'], sharp_deg=45)))

    # janelas do passadiço (frente da vela) e abertura do passadiço no topo
    parts = []
    for z0, z1 in ((SAIL_TOP - 0.62, SAIL_TOP - 0.42), (SAIL_TOP - 1.25, SAIL_TOP - 1.1)):
        parts.append(nose_band(z0, z1, 0.55))
    yb = SAIL['x_fwd'] - 0.30 - 0.5
    parts.append(([(-0.42, yb - 0.55, SAIL_TOP + 0.003), (0.42, yb - 0.55, SAIL_TOP + 0.003), (0.42, yb + 0.2, SAIL_TOP + 0.003), (-0.42, yb + 0.2, SAIL_TOP + 0.003)], [(0, 1, 2, 3)], [((0, 0), (1, 0), (1, 1), (0, 1))]))
    v, f, u = merge_parts(parts)
    objs.append(add_object('SX1_Casco_JanelasVela', make_mesh('SX1_Casco_JanelasVela', v, f, u, M['vidro'], smooth=False, outward=sail_out)))
    return objs


def nose_band(z0, z1, half_angle):
    """Faixa colada ao nariz da vela entre z0 e z1, ±half_angle (rad) em torno da proa."""
    verts, uvs_v = [], []
    for z in (z0, z1):
        pts = sail_outline(z, 96)
        # nariz: índices do arco elíptico
        nn, ns = 96 // 3, 96 // 6
        arc = pts[ns: ns + nn + 1]
        mid = nn // 2
        k = max(1, int(half_angle / math.pi * nn))
        for i in range(mid - k, mid + k + 1):
            x, y = arc[i]
            ln = math.hypot(x, y - (arc[mid][1] - 1.35)) or 1
            verts.append((x * 1.01, y + 0.01, z))
            uvs_v.append((i / nn, 0 if z == z0 else 1))
    n = len(verts) // 2
    faces = [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)]
    uvs = [tuple(uvs_v[k] for k in f) for f in faces]
    return verts, faces, uvs


def ellipsoid(c, ax, n):
    verts = []
    nr = n // 2
    for i in range(1, nr):
        th = math.pi * i / nr
        for j in range(n):
            ph = 2 * math.pi * j / n
            verts.append((c[0] + ax[0] * math.sin(th) * math.cos(ph), c[1] + ax[1] * math.cos(th), c[2] + ax[2] * math.sin(th) * math.sin(ph)))
    faces = grid_faces(nr - 1, n, closed_u=True)
    p0, p1 = len(verts), len(verts) + 1
    verts += [(c[0], c[1] + ax[1], c[2]), (c[0], c[1] - ax[1], c[2])]
    last = (nr - 2) * n
    for j in range(n):
        faces.append((j, (j + 1) % n, p0))
        faces.append((last + (j + 1) % n, last + j, p1))
    uvs = [tuple((verts[k][1] / REP, verts[k][2] / REP) for k in f) for f in faces]
    return verts, faces, uvs


def elliptic_cyl(x, y, z0, z1, ax, ay, n, dome=0.0):
    verts = []
    for z in (z0, z1):
        for j in range(n):
            a = 2 * math.pi * j / n
            verts.append((x + ax * math.cos(a), y + ay * math.sin(a), z))
    faces = grid_faces(2, n, closed_u=True)
    c = len(verts)
    verts.append((x, y, z1 + dome))
    for j in range(n):
        faces.append((n + j, n + (j + 1) % n, c))
    faces.append(tuple(range(n - 1, -1, -1)))
    uvs = [tuple((verts[k][1] / REP + verts[k][0] / REP, verts[k][2] / REP) for k in f) for f in faces]
    return verts, faces, uvs


# ------------------------------------------------------------------ superfícies de controle
def naca(t_rel, K):
    """Perfil simétrico NACA 00xx: lista (s, ±y) com s 0 (ataque) → 1 (fuga), K pontos por face."""
    up, lo = [], []
    for i in range(K + 1):
        s = (1 - math.cos(math.pi * i / K)) / 2
        yt = 5 * t_rel * (0.2969 * math.sqrt(s) - 0.126 * s - 0.3516 * s ** 2 + 0.2843 * s ** 3 - 0.1036 * s ** 4)
        up.append((s, yt))
        lo.append((s, -yt))
    # anel: extradorso do ataque à fuga, intradorso da fuga ao ataque (sem repetir as pontas)
    return up + lo[-2:0:-1]


def fin_mesh(name, d, t, stock_y, r_root_fn, r_tip, c_root, c_tip, sweep, t_rel, K, n_span, pivot_frac, origin, base_z=0.0):
    """Leme genérico: d = direção radial (envergadura), t = direção da espessura, corda ao longo de −Y.

    r_root_fn(y) dá o raio da raiz (acompanha o casco/vela); pivot_frac = posição da madre na corda.
    Vértices relativos a origin (o pivô)."""
    ring = naca(t_rel, K)
    nr = len(ring)
    verts = []
    for k in range(n_span + 1):
        s = k / n_span
        c = c_root + (c_tip - c_root) * s
        le = stock_y + pivot_frac * c_root - sweep * s
        for sc, yt in ring:
            y = le - sc * c
            r = (1 - s) * r_root_fn(y) + s * r_tip
            th = yt * c
            p = (d[0] * r + t[0] * th - origin[0], y - origin[1], base_z + d[2] * r + t[2] * th - origin[2])
            verts.append(p)
    faces = grid_faces(n_span + 1, nr, closed_u=True)
    faces.append(tuple(range(nr - 1, -1, -1)))  # raiz (dentro do casco)
    faces.append(tuple(n_span * nr + k for k in range(nr)))  # ponta reta
    uvs = []
    for f in faces:
        uvs.append(tuple(((verts[k][1] + origin[1]) / REP, (math.hypot(verts[k][0] + origin[0], verts[k][2] + origin[2])) / REP) for k in f))
    return make_mesh(name, verts, faces, uvs, None, sharp_deg=40)


def build_fins(cfg, M):
    K = cfg['fin_k'] // 2
    out = []
    # lemes de vela: madre em (±0,75; 10,5; 5,8), envergadura 2,6 m, corda 2,1 → 1,6 m
    w = SAIL['width'] / 2
    for name, s in (('SX1_LemeVela_BE', 1), ('SX1_LemeVela_BB', -1)):
        pv = (s * w, SAIL_PLANE['x'], SAIL_PLANE['z'])
        me = fin_mesh(name, (s, 0, 0), (0, 0, 1), SAIL_PLANE['x'], lambda y: w - 0.06, w + 2.6, 2.1, 1.6, 0.25, 0.12, K, 6, 0.30, pv, base_z=SAIL_PLANE['z'])
        me.materials.append(M['casco'])
        out.append(moving_part(name, pv, me))
    # popa em cruz: horizontais 3,3 m; leme superior 3,6 m; inferior 2,2 m (mais curto, para pousar no fundo)
    r0 = radius_at(STERN_X) - 0.1
    root = lambda y: max(0.25, radius_at(y) - 0.04)  # noqa: E731
    for name, d, t, span, c_root, c_tip in (
        ('SX1_LemePopa_BE', (1, 0, 0), (0, 0, 1), 3.3, 3.4, 2.6),
        ('SX1_LemePopa_BB', (-1, 0, 0), (0, 0, 1), 3.3, 3.4, 2.6),
        ('SX1_LemePopa_Sup', (0, 0, 1), (1, 0, 0), 3.6, 3.6, 3.0),
        ('SX1_LemePopa_Inf', (0, 0, -1), (1, 0, 0), 2.2, 3.6, 3.2),
    ):
        pv = (d[0] * r0, STERN_X, d[2] * r0)
        me = fin_mesh(name, d, t, STERN_X, root, r0 + span, c_root, c_tip, 0.45, 0.10, K, 6, 0.30, pv)
        me.materials.append(M['casco'])
        out.append(moving_part(name, pv, me))
    return out


# ------------------------------------------------------------------ hélice (7 pás com saia)
def build_propeller(cfg, M):
    pv = (0.0, PROP['x'], 0.0)
    Rp = PROP['diameter'] / 2
    rh = 0.42
    P = PROP['diameter'] * 1.0  # passo
    ns, kc = cfg['prop_ns'], cfg['prop_kc']
    verts, faces = [], []
    for b in range(PROP['blades']):
        th0 = 2 * math.pi * b / PROP['blades']
        base = len(verts)
        ring_n = 2 * kc
        for k in range(ns + 1):
            rho = k / ns
            r = rh + (Rp - rh) * rho
            c = (0.6 + 0.7 * math.sin(math.pi * rho * 0.8)) * math.sqrt(max(0.0, 1 - rho ** 6)) + 0.06
            skew = 0.45 * rho * rho  # saia: pás recurvadas para trás do giro
            phi = math.atan2(P, 2 * math.pi * r)
            tmax = 0.12 * (1 - rho) + 0.014
            rake = -0.12 * rho
            ring = []
            for i in range(kc + 1):
                q = i / kc  # 0 = ataque, 1 = fuga
                sc = (0.5 - q) * c
                tt = tmax * 2 * math.sqrt(max(0.0, q * (1 - q)))
                ring.append((sc, tt / 2))
            for i in range(kc - 1, 0, -1):
                q = i / kc
                sc = (0.5 - q) * c
                tt = tmax * 2 * math.sqrt(max(0.0, q * (1 - q)))
                ring.append((sc, -tt / 2))
            for sc, tn in ring:
                rt = sc * math.cos(phi) - tn * math.sin(phi)
                ya = sc * math.sin(phi) + tn * math.cos(phi) + rake
                th = th0 - skew + rt / r
                verts.append((r * math.sin(th), ya, r * math.cos(th)))
        faces += [tuple(base + q for q in f) for f in grid_faces(ns + 1, ring_n, closed_u=True)]
        faces.append(tuple(base + ns * ring_n + q for q in range(ring_n)))
        faces.append(tuple(base + q for q in range(ring_n - 1, -1, -1)))
    uvs = [tuple((0.5, 0.5) for _ in f) for f in faces]
    # cubo: perfil de revolução que continua o cone da popa
    prof = [(-0.75, 0.40), (-0.55, 0.47), (-0.2, 0.5), (0.25, 0.5), (0.6, 0.44), (0.95, 0.3), (1.25, 0.13), (1.4, 0.0)]
    n = 24 if cfg['slots'] else 12
    base = len(verts)
    for yy, rr in prof[:-1]:
        for j in range(n):
            a = 2 * math.pi * j / n
            verts.append((rr * math.sin(a), -yy, rr * math.cos(a)))
    hub_faces = grid_faces(len(prof) - 1, n, closed_u=True)
    tipv = len(verts)
    verts.append((0.0, -prof[-1][0], 0.0))
    last = base + (len(prof) - 2) * n
    hub_faces += [(last - base + j, last - base + (j + 1) % n, tipv - base) for j in range(n)]
    faces += [tuple(base + q for q in f) for f in hub_faces]
    uvs += [tuple((0.5, 0.5) for _ in f) for f in hub_faces]
    faces.append(tuple(base + q for q in range(n - 1, -1, -1)))
    uvs.append(tuple((0.5, 0.5) for _ in range(n)))
    me = make_mesh('SX1_Helice', verts, faces, uvs, M['helice'], sharp_deg=55)
    return moving_part('SX1_Helice', pv, me)


# ------------------------------------------------------------------ mastros móveis
def build_masts(cfg, M):
    n = 20 if cfg['slots'] else 10
    # snorkel: centro em z = topo da vela − curso/2 (como o desenho atual); cabeça de admissão no topo
    ext = SNORKEL['extension']
    zc = SAIL_TOP - ext / 2
    parts = [elliptic_cyl(0, 0, -ext / 2, 1.6, 0.30, 0.30, n)]
    parts.append(elliptic_cyl(0, 0, 1.6, 2.72, 0.32, 0.5, n, dome=0.12))
    v, f, u = merge_parts(parts)
    me = make_mesh('SX1_Mastro_Snorkel', v, f, u, M['mastro'], sharp_deg=50)
    # grade de admissão na cabeça (frente e lados)
    sn = moving_part('SX1_Mastro_Snorkel', (0, SNORKEL['x'], zc), me)
    gr = []
    for s in (1, -1):
        gr.append(([(s * 0.325, y, z) for y, z in ((-0.18, 1.9), (0.18, 1.9), (0.18, 2.55), (-0.18, 2.55))], [(0, 1, 2, 3) if s > 0 else (3, 2, 1, 0)], [((0, 0), (1, 0), (1, 1), (0, 1))]))
    v, f, u = merge_parts(gr)
    add_object('SX1_Mastro_Snorkel_Grade', make_mesh('SX1_Mastro_Snorkel_Grade', v, f, u, M['grade'], smooth=False, outward=lambda c: (c[0], 0.0, 0.0)), (0, 0, 0), sn)

    # periscópio de ataque: tubo fino; cabeça (filha) gira com a marcação
    ext = PERISCOPE['extension']
    zc = (R + SAIL['height'] + 0.3) - ext / 2 - 0.65  # = −periscopeHeadZ(0) − ext/2 − 0,65 (desenho atual)
    v, f, u = elliptic_cyl(0, 0, -ext / 2, ext / 2 + 0.06, 0.19, 0.19, n)
    pm = moving_part('SX1_Mastro_Periscopio', (0, PERISCOPE['x'], zc), make_mesh('SX1_Mastro_Periscopio', v, f, u, M['mastro'], sharp_deg=50))
    parts = [elliptic_cyl(0, 0, -0.35, 0.3, 0.15, 0.15, n, dome=0.06)]
    v, f, u = merge_parts(parts)
    hd = moving_part('SX1_Periscopio_Cabeca', (0, 0, ext / 2 + 0.3), make_mesh('SX1_Periscopio_Cabeca', v, f, u, M['mastro'], sharp_deg=50), pm)
    win = ([(-0.08, 0.152, -0.04), (0.08, 0.152, -0.04), (0.08, 0.152, 0.14), (-0.08, 0.152, 0.14)], [(3, 2, 1, 0)], [((0, 0), (1, 0), (1, 1), (0, 1))])
    add_object('SX1_Periscopio_Janela', make_mesh('SX1_Periscopio_Janela', *win, M['vidro'], smooth=False, outward=lambda c: (0.0, 1.0, 0.0)), (0, 0, 0), hd)
    return sn, pm


# ------------------------------------------------------------------ oclusão ambiente (cores de vértice)
AO_DISTANCE = 2.5  # m: alcance das sombras de contato (junções vela/casco, raiz dos lemes, bordas)
AO_STRENGTH = 0.85  # 0 = sem efeito, 1 = oclusão inteira
AO_BOTTOM = 0.8  # fator na face de baixo do casco (luz vem de cima); 1 no topo
AO_MIN = 0.25


def bake_ao(cfg):
    """Calcula no Cycles a oclusão ambiente de TODAS as malhas juntas (uma peça sombreia a outra) e grava
    no atributo de cor "AO" (exportado como COLOR_0: multiplica a cor base no site)."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = cfg['ao_samples']
    sc.cycles.use_denoising = False
    sc.cycles.seed = 0
    w = sc.world or bpy.data.worlds.new('SX1_Mundo')
    sc.world = w
    w.light_settings.distance = AO_DISTANCE
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    for o in meshes:
        ca = o.data.color_attributes
        if 'AO' in ca:
            ca.remove(ca['AO'])
        ca.active_color = ca.new('AO', 'BYTE_COLOR', 'CORNER')
    for o in bpy.context.view_layer.objects:
        o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    # suaviza, inclui a luz vinda de cima e limita o escuro
    lo = 1.0
    for o in meshes:
        me = o.data
        n = len(me.loops)
        if not n:
            continue
        col = np.empty(n * 4, dtype=np.float32)
        me.color_attributes['AO'].data.foreach_get('color', col)
        ao = col.reshape(-1, 4)[:, 0]
        nrm = np.empty(n * 3, dtype=np.float32)
        me.corner_normals.foreach_get('vector', nrm)
        up = nrm.reshape(-1, 3)[:, 2]  # as peças não têm rotação: normal local = normal no mundo
        # mastros: arriados ficam dentro da vela (escuros); içados precisam da cor cheia — sem sombra de contato
        top = o
        while top.parent is not None:
            top = top.parent
        if top.name.startswith(('SX1_Mastro', 'SX1_Periscopio')):
            ao = np.ones_like(ao)
        f = (1 - AO_STRENGTH * (1 - ao)) * (AO_BOTTOM + (1 - AO_BOTTOM) * (0.5 + 0.5 * up))
        f = np.clip(f, AO_MIN, 1.0)
        lo = min(lo, float(f.min()))
        out = np.repeat(f[:, None], 4, axis=1)
        out[:, 3] = 1.0
        me.color_attributes['AO'].data.foreach_set('color', out.ravel())
        me.update()
    return lo


# ------------------------------------------------------------------ montagem e exportação
def build(level):
    cfg = LEVELS[level]
    clear_scene()
    M = build_materials(cfg)
    hull, err = build_hull(cfg, M)
    build_hull_details(cfg, M)
    build_sail(cfg, M)
    build_fins(cfg, M)
    build_propeller(cfg, M)
    build_masts(cfg, M)
    bpy.context.view_layer.update()
    ao_min = bake_ao(cfg)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    return dict(level=level, hull_err=err, tris=tris, objects=len(bpy.data.objects), ao_min=round(ao_min, 3))


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_image_format='WEBP',
        export_image_quality=88,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_vertex_color='NAME',
        export_vertex_color_name='AO',
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=False,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=False,
        use_selection=False,
    )
    return os.path.getsize(path)


def repo_root():
    here = globals().get('__file__')
    if here:
        return os.path.abspath(os.path.join(os.path.dirname(here), '..', '..'))
    return os.getcwd()


def main(argv):
    global TEX_DIR
    out = os.path.join(repo_root(), 'build', 'modelo')
    levels = ['alta', 'leve']
    if '--saida' in argv:
        out = os.path.abspath(argv[argv.index('--saida') + 1])
    if '--nivel' in argv:
        n = argv[argv.index('--nivel') + 1]
        levels = ['alta', 'leve'] if n == 'ambos' else [n]
    TEX_DIR = os.path.join(out, 'texturas')
    report = []
    for lv in levels:
        info = build(lv)
        info['bytes'] = export(os.path.join(out, f'sx1-{lv}.raw.glb'))
        report.append(info)
        if lv == 'alta':
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'sx1.blend'), compress=True)
    # deixa a versão alta aberta na cena (para conferir no Blender)
    if levels[-1] != 'alta' and 'alta' in levels:
        build('alta')
    print('SX1', report)
    return report


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    RESULT = main(args)
