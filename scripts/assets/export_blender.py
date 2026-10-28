"""Exporta com bpy 5.2.3: python export_blender.py --source assets/blender --output public/models.
Também aceita: blender -b --disable-autoexec --python export_blender.py -- --source ... --output ...
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
p = argparse.ArgumentParser()
p.add_argument('--source', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args(args)
a.output.mkdir(parents=True, exist_ok=True)
names = {'navio_graneleiro': 'graneleiro', 'navio_cargueiro': 'carga'}
manifest = []
bpy.context.preferences.filepaths.use_scripts_auto_execute = False
for path in sorted(a.source.glob('*.blend')):
    bpy.ops.wm.open_mainfile(filepath=str(path.resolve()), load_ui=False, use_scripts=False)
    bpy.ops.object.select_all(action='DESELECT')
    objects = [o for o in bpy.context.scene.objects
               if o.type in {'MESH', 'CURVE', 'FONT', 'SURFACE'} and not o.hide_render
               and o.name != 'Superficie do mar']
    excluded = [o.name for o in bpy.context.scene.objects if o not in objects]
    if not objects:
        raise RuntimeError(f'Sem geometria: {path}')
    for obj in objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.join()
    model = bpy.context.object
    model.name = path.stem
    model.data.validate(clean_customdata=False)
    model.data.update()
    # Proa +X -> +Y do Blender -> -Z do glTF. Linha d'água intacta.
    model.matrix_world = Matrix.Rotation(math.pi / 2, 4, 'Z') @ model.matrix_world
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.update()
    points = [model.matrix_world @ Vector(c) for c in model.bound_box]
    low = [min(v[i] for v in points) for i in range(3)]
    high = [max(v[i] for v in points) for i in range(3)]
    out = a.output / (names.get(path.stem, path.stem) + '.glb')
    bpy.ops.export_scene.gltf(filepath=str(out.resolve()), export_format='GLB',
        use_selection=True, export_yup=True, export_apply=True,
        export_animations=False, export_cameras=False, export_lights=False)
    manifest.append({'source': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'file': out.name, 'bytes': out.stat().st_size, 'sourceObjects': len(objects),
        'excluded': excluded, 'bounds': {'min': [low[0],low[2],-high[1]],
        'max': [high[0],high[2],-low[1]]}, 'forward': '-Z', 'up': '+Y', 'waterline': 0})
(a.output / 'manifest.json').write_text(json.dumps({'exporter': bpy.app.version_string,
    'assets': manifest}, ensure_ascii=False, indent=2) + '\n')
print('EXPORT_COMPLETE', len(manifest))
