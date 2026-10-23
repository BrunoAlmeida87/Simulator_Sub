"""
Renderiza vistas de conferência do modelo SX-1 já montado na cena (build_sx1.py).
Uso no Blender: exec deste arquivo com OUT_DIR definido, ou
  blender -b build/modelo/sx1.blend -P scripts/blender/preview_sx1.py -- <pasta_saida>
Câmera e luzes são de conferência (o .glb é exportado sem elas).
"""
import math
import os
import sys

import bpy
import mathutils

VIEWS = {
    'lado': ((95, 0, 3), (0, 0, 1.5), 40),
    'proa34': ((38, 46, 12), (0, 10, 2), 38),
    'popa34': ((20, -56, 7), (0, -32, 0), 45),
    'popa_baixo': ((-14, -48, -7), (0, -33, 0), 45),
    'vela': ((16, 19, 10), (0, 9.5, 6), 45),
    'topo': ((0, 0, 120), (0, 0, 0), 30),
}


def setup():
    sc = bpy.context.scene
    for n in ('PV_Cam', 'PV_Sun', 'PV_Fill'):
        o = bpy.data.objects.get(n)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
    cam = bpy.data.objects.new('PV_Cam', bpy.data.cameras.new('PV_Cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    sun = bpy.data.objects.new('PV_Sun', bpy.data.lights.new('PV_Sun', 'SUN'))
    sc.collection.objects.link(sun)
    sun.data.energy = 4.5
    sun.rotation_euler = (math.radians(40), math.radians(20), math.radians(-30))
    fill = bpy.data.objects.new('PV_Fill', bpy.data.lights.new('PV_Fill', 'SUN'))
    sc.collection.objects.link(fill)
    fill.data.energy = 1.5
    fill.rotation_euler = (math.radians(-60), 0, math.radians(150))
    w = sc.world or bpy.data.worlds.new('W')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.62, 0.68, 0.75, 1)
    bg.inputs[1].default_value = 1.0
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 1600, 700
    sc.view_settings.view_transform = 'Standard'
    return sc, cam


def render_all(out_dir, names=None):
    sc, cam = setup()
    os.makedirs(out_dir, exist_ok=True)
    done = []
    for k, (loc, tgt, lens) in VIEWS.items():
        if names and k not in names:
            continue
        cam.data.lens = lens
        cam.location = loc
        d = mathutils.Vector(tgt) - mathutils.Vector(loc)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y' if k != 'topo' else 'Y').to_euler()
        if k == 'topo':
            cam.rotation_euler = (0, 0, math.radians(-90))
        sc.render.filepath = os.path.join(out_dir, k + '.png')
        bpy.ops.render.render(write_still=True)
        done.append(sc.render.filepath)
    return done


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    render_all(args[0] if args else os.path.join(os.getcwd(), 'build', 'modelo', 'vistas'))
