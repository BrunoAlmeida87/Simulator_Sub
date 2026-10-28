"""
TORPEDO F21 DE EXERCÍCIO para o simulador, a partir do estudo visual torpedo_f21.blend (pasta kimi).

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b C:/Users/Bruno/Documents/kimi/workspace/torpedo_f21.blend
      -P scripts/blender/build_f21.py -- [saida.glb]
  npm run modelo:otimizar           (→ public/models/sx1-f21.glb)

O que muda em relação ao arquivo de origem:
  - sai a inscrição do fabricante; ficam "F21" e "EXERCISE" (arma de exercício, laranja);
  - saem câmera e luzes; textos, linhas e modificadores viram malha;
  - as peças são juntadas em três nós de nome fixo (src/render3d/torpedoModel.ts):
      F21_Corpo        casco, domo, cintas, carenagem e anel protetor (fixo);
      F21_Helice_Vante hélice dianteira (7 pás) — pivô no eixo, gira em torno do eixo da arma;
      F21_Helice_Re    hélice traseira (6 pás) — gira no sentido contrário;
  - eixo da arma = +Y do Blender (ponta para vante, como o SX-1), origem no meio do comprimento
    (6,4 m da ponta do domo ao anel protetor).
"""
import math
import os
import sys

import bpy
from mathutils import Matrix

NOSE_X = 3.0  # ponta do domo no arquivo de origem (eixo +X)
TAIL_X = -3.40  # fim do anel protetor
CENTER_X = (NOSE_X + TAIL_X) / 2


def main(out):
    for o in list(bpy.data.objects):
        body = o.data.body if o.type == 'FONT' else ''
        if o.type in ('CAMERA', 'LIGHT') or 'NAVAL' in body.upper() or 'GROUP' in body.upper():
            bpy.data.objects.remove(o, do_unlink=True)
    # textos, linhas e modificadores → malha
    bpy.ops.object.select_all(action='DESELECT')
    objs = [o for o in bpy.data.objects if o.type in ('MESH', 'FONT', 'CURVE')]
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target='MESH')
    objs = [o for o in bpy.data.objects if o.type == 'MESH']
    for o in objs:
        o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    groups = {
        'F21_Helice_Vante': [o for o in objs if o.name.startswith('Helice dianteira')],
        'F21_Helice_Re': [o for o in objs if o.name.startswith('Helice traseira')],
    }
    groups['F21_Corpo'] = [o for o in objs if o not in groups['F21_Helice_Vante'] and o not in groups['F21_Helice_Re']]
    hub = {'F21_Helice_Vante': -2.94, 'F21_Helice_Re': -3.17, 'F21_Corpo': CENTER_X}
    # eixo da arma: +X → +Y (gira 90° em torno de Z), origem no meio do comprimento
    rot = Matrix.Rotation(math.radians(90), 4, 'Z')
    root = bpy.data.objects.new('F21', None)
    bpy.context.scene.collection.objects.link(root)
    info = {}
    for name, parts in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in parts:
            o.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        if len(parts) > 1:
            bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active
        me = o.data
        pivot_x = hub[name] - CENTER_X
        me.transform(Matrix.Translation((-CENTER_X, 0, 0)))
        me.transform(rot)
        # malha em volta do pivô (no eixo); nó vazio com o nome fixo no pivô
        me.transform(Matrix.Translation((0, -pivot_x, 0)))
        me.name = name
        o.name = name + '_Malha'
        e = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(e)
        e.location = (0, pivot_x, 0)
        e.parent = root
        o.parent = e
        o.location = (0, 0, 0)
        for p in me.polygons:
            p.use_smooth = True
        info[name] = sum(len(p.vertices) - 2 for p in me.polygons)
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.parent is None:
            bpy.data.objects.remove(o, do_unlink=True)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        use_selection=False,
    )
    print('F21', {'tris': info, 'bytes': os.path.getsize(out)})


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(os.path.abspath(args[0]) if args else os.path.join(os.getcwd(), 'build', 'modelo', 'sx1-f21.raw.glb'))
