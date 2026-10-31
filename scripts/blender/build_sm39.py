"""
MÍSSIL EXOCET SM39 NA CÁPSULA VSM para o simulador, a partir de public/models/SM_39VSM.blend (cena SM39_VSM).

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b public/models/SM_39VSM.blend
      -P scripts/blender/build_sm39.py -- [saida.glb]
  npm run modelo:otimizar           (→ public/models/sx1-sm39.glb)

O que muda em relação ao arquivo de origem:
  - sai a inscrição do fabricante (só ficam "EXOCET SM39", "VSM" e "VEHICULE SOUS-MARIN");
  - saem os controles, o painel de inspeção (corte) e as guias internas; textos, curvas e modificadores viram malha;
  - as peças são juntadas em nós de nome fixo (src/render3d/MissileVis.ts, SM39_PARTS):
      SM39_VSM          raiz: cápsula fechada com o míssil dentro (estado do quadro 1 da animação);
      VSM_Casco         casco estanque, juntas, popa, bocal e estabilizadores (fixo);
      VSM_Nariz         nariz removível — pivô na junta com o casco (é ejetado na superfície);
      SM39              míssil — pivô no meio do comprimento (sai pela frente da cápsula);
      SM39_Corpo        corpo, radomo, bocal e detalhes do míssil;
      SM39_Superficies  asas delta e aletas, ABERTAS na malha base, com a forma "Recolhida" (morph) para dentro do VSM;
  - eixo = +Y do Blender (proa para vante, como o SX-1 e o F21) → −Z no glTF; origem no meio do VSM (5,80 m).
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix

ROT = Matrix.Rotation(math.radians(90), 4, 'Z')  # eixo +X do arquivo → +Y
NOSE_JOINT_X = 2.15  # junta do nariz removível com o casco (eixo +X do arquivo)


def ctrl(**vals):
    c = bpy.data.objects['CTRL_LANCAMENTO']
    if c.animation_data:
        c.animation_data.action = None
    for k, v in vals.items():
        c[k] = v
    c.update_tag()
    for o in bpy.data.objects:
        o.update_tag()
    bpy.context.view_layer.update()
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()


def evaluated_copy(o, name):
    """malha avaliada (modificadores, forma, driver) em coordenadas do mundo"""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=False, depsgraph=dg)
    me.transform(o.matrix_world)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def main(out):
    sc = bpy.context.scene
    col = lambda key: [o for o in sc.objects if any(key in c.name for c in o.users_collection)]
    skip = lambda o: o.type not in ('MESH', 'CURVE', 'FONT') or 'MBDA' in o.name or (o.type == 'FONT' and 'MBDA' in o.data.body) or 'painel lateral' in o.name or 'guia interna' in o.name
    groups = {
        'VSM_Casco': [o for o in col('VSM 04') + col('VSM 06') if not skip(o)],
        'VSM_Nariz': [o for o in col('VSM 05') if not skip(o)],
        'SM39_Corpo': [o for o in col('VSM 01') + col('VSM 03') if not skip(o)],
    }
    wings = [o for o in col('VSM 02') if not skip(o)]
    # 1) cápsula e corpo do míssil: quadro 1 (fechado, míssil dentro)
    ctrl(abertura_nariz=0.0, extracao_missil=0.0, abertura_asas=0.0, corte_inspecao=0.0)
    built = {name: join([evaluated_copy(o, o.name + '_ev') for o in parts], name) for name, parts in groups.items()}
    # 2) superfícies: malha base ABERTA (asas = 1) e a forma "Recolhida" (asas = 0), mesma topologia
    #    (o bisel com limite de sobreposição muda a topologia quando a asa encolhe: nas asas ele fica sem o limite;
    #    se ainda assim mudar, as asas saem sem bisel — são chapas finas, não faz diferença à distância)
    for o in wings:
        for m in o.modifiers:
            if m.type == 'BEVEL':
                m.use_clamp_overlap = False
    ctrl(abertura_nariz=0.0, extracao_missil=0.0, abertura_asas=1.0, corte_inspecao=0.0)
    probe = [len(evaluated_copy(o, 'p').data.vertices) for o in wings]
    ctrl(abertura_nariz=0.0, extracao_missil=0.0, abertura_asas=0.0, corte_inspecao=0.0)
    probe2 = [len(evaluated_copy(o, 'q').data.vertices) for o in wings]
    for o in [x for x in sc.objects if x.name.startswith(('p', 'q')) and x.name[1:2] in ('', '.')]:
        bpy.data.objects.remove(o, do_unlink=True)
    if probe != probe2:
        print('SM39: bisel removido das superfícies (topologia variável)')
        for o in wings:
            for m in list(o.modifiers):
                if m.type == 'BEVEL':
                    o.modifiers.remove(m)
    ctrl(abertura_nariz=0.0, extracao_missil=0.0, abertura_asas=1.0, corte_inspecao=0.0)
    open_objs = [evaluated_copy(o, o.name + '_aberta') for o in wings]
    ctrl(abertura_nariz=0.0, extracao_missil=0.0, abertura_asas=0.0, corte_inspecao=0.0)
    folded = [evaluated_copy(o, o.name + '_recolhida') for o in wings]
    for a, b in zip(open_objs, folded):
        if len(a.data.vertices) != len(b.data.vertices):
            raise RuntimeError(f'topologia diferente entre aberta e recolhida: {a.name}')
    surf = join(open_objs, 'SM39_Superficies')
    fold = join(folded, 'SM39_Superficies_Recolhida')
    if len(surf.data.vertices) != len(fold.data.vertices):
        raise RuntimeError('topologia das superfícies')
    surf.shape_key_add(name='Basis')
    key = surf.shape_key_add(name='Recolhida')
    for i, v in enumerate(fold.data.vertices):
        key.data[i].co = v.co
    bpy.data.objects.remove(fold, do_unlink=True)
    built['SM39_Superficies'] = surf
    # originais fora (só ficam as peças montadas)
    keep = set(built.values())
    for o in list(sc.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    # pivôs (eixo +X do arquivo): meio do VSM = 0; nariz na junta; míssil no meio do seu comprimento (= 0 dentro do VSM)
    lo = min(v.co.x for v in built['SM39_Corpo'].data.vertices)
    hi = max(v.co.x for v in built['SM39_Corpo'].data.vertices)
    missile_cx = (lo + hi) / 2
    pivots = {'VSM_Casco': 0.0, 'VSM_Nariz': NOSE_JOINT_X, 'SM39_Corpo': missile_cx, 'SM39_Superficies': missile_cx}
    root = bpy.data.objects.new('SM39_VSM', None)
    sc.collection.objects.link(root)
    missile = bpy.data.objects.new('SM39', None)
    sc.collection.objects.link(missile)
    missile.parent = root
    missile.location = ROT @ Matrix.Translation((missile_cx, 0, 0)).translation
    info = {'missile_center_x': missile_cx, 'missile_length': hi - lo}
    for name, o in built.items():
        me = o.data
        px = pivots[name]
        sk = me.shape_keys is not None
        me.transform(Matrix.Translation((-px, 0, 0)), shape_keys=sk)
        me.transform(ROT, shape_keys=sk)
        for p in me.polygons:
            p.use_smooth = True
        o.name = name + '_Malha'
        holder = bpy.data.objects.new(name, None)
        sc.collection.objects.link(holder)
        if name.startswith('SM39_'):
            holder.parent = missile
            holder.location = (0, 0, 0)
        else:
            holder.parent = root
            holder.location = ROT @ Matrix.Translation((px, 0, 0)).translation
        o.parent = holder
        o.matrix_parent_inverse = Matrix.Identity(4)
        o.location = (0, 0, 0)
        info[name] = sum(len(p.vertices) - 2 for p in me.polygons)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        export_yup=True,
        export_apply=False,
        export_morph=True,
        export_morph_normal=False,
        export_normals=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        use_selection=False,
    )
    print('SM39', {'info': info, 'bytes': os.path.getsize(out)})


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(os.path.abspath(args[0]) if args else os.path.join(os.getcwd(), 'build', 'modelo', 'sx1-sm39.raw.glb'))
