# recorta o TCI (cor verdadeira, 10 m) do Sentinel-2 em volta do estaleiro; salva PNG + metadados
# uso: python3 s2_crop.py S2C_23KPQ_20260721_0_L2A s2/img/a
import sys, json, os
import numpy as np, rasterio
from rasterio.windows import from_bounds
from rasterio.warp import transform, transform_bounds
from PIL import Image
scene, out = sys.argv[1], sys.argv[2]
lon0, lat0, lon1, lat1 = [float(x) for x in sys.argv[3:7]] if len(sys.argv) > 6 else (-43.875, -22.955, -43.815, -22.905)
Y, M = scene[10:14], int(scene[14:16])
url = f"/vsicurl/https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/23/K/PQ/{Y}/{M}/{scene}/TCI.tif"
with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif'):
    with rasterio.open(url) as ds:
        b = transform_bounds('EPSG:4326', ds.crs, lon0, lat0, lon1, lat1)
        win = from_bounds(*b, ds.transform).round_offsets().round_lengths()
        arr = ds.read(window=win)
        tr = ds.window_transform(win)
        crs = ds.crs.to_string()
img = np.transpose(arr, (1, 2, 0))
Image.fromarray(img).save(out + '.png')
json.dump({'crs': crs, 'transform': list(tr)[:6], 'w': img.shape[1], 'h': img.shape[0]}, open(out + '.json', 'w'))
print(img.shape, crs, list(tr)[:6])
