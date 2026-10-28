# recorta uma banda (ex.: B08, infravermelho 10 m) na mesma janela do TCI
# uso: python3 s2_band.py S2C_23KPQ_20260721_0_L2A B08 s2/img/20260721_B08.npy
import sys, json
import numpy as np, rasterio
from rasterio.windows import Window
scene, band, out = sys.argv[1], sys.argv[2], sys.argv[3]
meta = json.load(open('s2/img/a.json'))
Y, M = scene[10:14], int(scene[14:16])
url = f"/vsicurl/https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/23/K/PQ/{Y}/{M}/{scene}/{band}.tif"
with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif'):
    with rasterio.open(url) as ds:
        a, b, c, d, e, f = meta['transform']
        col = int(round((c - ds.transform.c) / ds.transform.a)); row = int(round((f - ds.transform.f) / ds.transform.e))
        arr = ds.read(1, window=Window(col, row, meta['w'], meta['h'])).astype(np.float32)
np.save(out, arr); print(arr.shape, arr.min(), arr.max())
