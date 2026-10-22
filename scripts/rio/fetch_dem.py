"""Relevo Copernicus GLO-30 (DSM 30 m, AWS Open Data) para a região Sepetiba + Rio.
Grava dem30.npy (float32, grade lat/lon regular) e dem30_meta.json."""
import json, numpy as np, rasterio
from rasterio.merge import merge
LON0, LON1, LAT0, LAT1 = -44.25, -42.95, -23.25, -22.60
tiles = []
for lat in (23, 24):
    for lon in (44, 45):
        n = f'Copernicus_DSM_COG_10_S{lat:02d}_00_W{lon:03d}_00_DEM'
        tiles.append(f'/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/{n}/{n}.tif')
srcs = []
for t in tiles:
    try:
        srcs.append(rasterio.open(t)); print('ok', t[-40:])
    except Exception as e:
        print('sem', t[-40:], e)
arr, tr = merge(srcs, bounds=(LON0, LAT0, LON1, LAT1), nodata=-9999)
a = arr[0].astype(np.float32)
a[a < -500] = 0
print(a.shape, a.min(), a.max(), tr)
np.save('dem30.npy', a)
json.dump({'lon0': LON0, 'lat1': LAT1, 'dlon': tr.a, 'dlat': -tr.e, 'nx': a.shape[1], 'ny': a.shape[0], 'x0': tr.c, 'y0': tr.f}, open('dem30_meta.json', 'w'))
