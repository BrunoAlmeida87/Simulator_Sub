"""
FRAGATA TAMANDARÉ (F200) — alvo de superfície do tiro de mísseis, a partir de public/models/fragata_tamandare.blend.

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b public/models/fragata_tamandare.blend
      -P scripts/blender/build_fragata.py -- [saida.glb]
  npm run modelo:otimizar           (→ public/models/sx1-fragata.glb)

  - saem o mar, câmeras, luzes e o cubo padrão (coleções 07_Apresentacao e Collection);
  - textos, curvas e modificadores viram malha; as peças são juntadas por material num nó "Fragata";
  - o radar giratório fica num nó próprio, "Fragata_Radar", com o pivô no eixo de giro (gira na cena);
  - metros; proa +X do arquivo → +Y do Blender → −Z no glTF; linha d'água em y = 0; origem a meio navio (x = 0 do arquivo).
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

ROT = Matrix.Rotation(math.radians(90), 4, 'Z')
RADAR = ('Barra do radar de navega', 'Base do radar rotativo')


def evaluated_copy(o, name):
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
    excluded_cols = ('07_Apresentacao', 'Collection')
    src = [o for o in sc.objects if o.type in ('MESH', 'CURVE', 'FONT') and not o.hide_render and not any(c.name in excluded_cols for c in o.users_collection)]
    radar = [o for o in src if o.name.startswith(RADAR)]
    body = [o for o in src if o not in radar]
    ship = join([evaluated_copy(o, o.name + '_ev') for o in body], 'Fragata_Malha')
    rad = join([evaluated_copy(o, o.name + '_ev') for o in radar], 'Fragata_Radar_Malha') if radar else None
    keep = {ship, rad}
    for o in list(sc.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    root = bpy.data.objects.new('Fragata', None)
    sc.collection.objects.link(root)
    ship.data.transform(ROT)
    ship.parent = root
    info = {'tris': sum(len(p.vertices) - 2 for p in ship.data.polygons)}
    if rad:
        xs = [v.co.x for v in rad.data.vertices]
        ys = [v.co.y for v in rad.data.vertices]
        pivot = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, 0))
        rad.data.transform(Matrix.Translation(-pivot))
        rad.data.transform(ROT)
        holder = bpy.data.objects.new('Fragata_Radar', None)
        sc.collection.objects.link(holder)
        holder.parent = root
        holder.location = ROT @ pivot
        rad.parent = holder
        info['radar'] = list(holder.location)
    co = [v.co for v in ship.data.vertices]
    info['bounds'] = [[min(c[i] for c in co) for i in range(3)], [max(c[i] for c in co) for i in range(3)]]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        export_yup=True,
        export_apply=False,
        export_normals=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        use_selection=False,
    )
    print('FRAGATA', {'info': info, 'bytes': os.path.getsize(out)})


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(os.path.abspath(args[0]) if args else os.path.join(os.getcwd(), 'build', 'modelo', 'sx1-fragata.raw.glb'))
