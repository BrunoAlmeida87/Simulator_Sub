"""Converte arquivos .blend enviados a public/models em GLB para a galeria.

Use com bpy 5.2.3: python scripts/assets/export_gallery_blends.py public/models
O Blender abre os arquivos sem executar scripts embutidos. Arquivos GLB mais
novos que a origem são preservados.
"""

from pathlib import Path
import sys
import bpy

folder = Path(sys.argv[1] if len(sys.argv) > 1 else 'public/models').resolve()
bpy.context.preferences.filepaths.use_scripts_auto_execute = False

for source in sorted(folder.glob('*.blend')):
    target = source.with_suffix('.glb')
    if target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
        print('SKIP', source.name)
        continue
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    bpy.ops.object.select_all(action='DESELECT')
    objects = [obj for obj in bpy.context.scene.objects
               if obj.type in {'MESH', 'CURVE', 'FONT', 'SURFACE'} and not obj.hide_render
               and obj.name.casefold() not in {'oceano', 'superficie do mar', 'superfície do mar'}]
    if not objects:
        raise RuntimeError(f'{source.name}: nenhum objeto 3D exportável')
    for obj in objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB',
        use_selection=True, export_yup=True, export_animations=False,
        export_cameras=False, export_lights=False)
    print('EXPORTED', source.name, target.name, target.stat().st_size)
