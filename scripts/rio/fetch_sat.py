"""Sentinel-2 L2A (AWS Open Data, COG) — cena de 05/08/2024 (nuvens 0,02 %),
blocos 23KPQ e 23KNQ. Reprojeta para grades lat/lon regulares:
 - cor verdadeira (TCI 10 m) → texturas JPEG de Sepetiba e do Rio;
 - classificação da cena (SCL 20 m, classe 6 = água) → máscara de água do Rio.
Uso: python3 fetch_sat.py <pasta de saída das texturas>"""
import json, math, sys, numpy as np, rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin
from PIL import Image, ImageEnhance
BASE = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/23/K/{sq}/2024/8/S2B_23K{sq}_20240805_0_L2A/{band}.tif'
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'

def grid(lon0, lon1, lat0, lat1, cell):
    latc = (lat0 + lat1) / 2
    dlat = cell / 111320.0
    dlon = cell / (111320.0 * math.cos(math.radians(latc)))
    nx = int(math.ceil((lon1 - lon0) / dlon)); ny = int(math.ceil((lat1 - lat0) / dlat))
    return dict(lon0=lon0, lon1=lon0 + nx * dlon, lat0=lat1 - ny * dlat, lat1=lat1, dlon=dlon, dlat=dlat, nx=nx, ny=ny)

def warp(band, g, squares, resampling, count, dtype):
    dst = np.zeros((count, g['ny'], g['nx']), dtype=dtype)
    tr = from_origin(g['lon0'], g['lat1'], g['dlon'], g['dlat'])
    for sq in squares:
        with rasterio.open('/vsicurl/' + BASE.format(sq=sq, band=band)) as src:
            tmp = np.zeros_like(dst)
            reproject(source=rasterio.band(src, list(range(1, count + 1))) if count > 1 else rasterio.band(src, 1),
                      destination=tmp if count > 1 else tmp[0], src_transform=src.transform, src_crs=src.crs,
                      dst_transform=tr, dst_crs='EPSG:4326', resampling=resampling, src_nodata=0, dst_nodata=0)
            fill = (dst.sum(axis=0) == 0) & (tmp.sum(axis=0) > 0)
            dst[:, fill] = tmp[:, fill]
            print(band, sq, 'ok')
    return dst

def texture(name, g, squares):
    a = warp('TCI', g, squares, Resampling.average, 3, np.uint8)
    img = Image.fromarray(np.moveaxis(a, 0, -1))
    # a TCI é escura: realce leve (brilho/contraste/saturação) para o 3D
    img = ImageEnhance.Brightness(img).enhance(1.25)
    img = ImageEnhance.Contrast(img).enhance(1.08)
    img = ImageEnhance.Color(img).enhance(1.15)
    img.save(f'{OUT}/{name}_sat.jpg', quality=84, optimize=True, progressive=True)
    json.dump(g, open(f'{name}_sat_grid.json', 'w'))
    print(name, img.size)

if __name__ == '__main__':
    what = sys.argv[2] if len(sys.argv) > 2 else 'all'
    if what in ('all', 'scl'):
        g = grid(-43.56, -43.00, -23.10, -22.64, 25.0)
        scl = warp('SCL', g, ['PQ'], Resampling.nearest, 1, np.uint8)[0]
        np.save('rio_scl25.npy', scl); json.dump(g, open('rio_scl25_grid.json', 'w'))
        print('SCL água %', (scl == 6).mean() * 100)
    if what in ('all', 'tex'):
        texture('rio', grid(-43.56, -43.00, -23.10, -22.64, 22.0), ['PQ'])
        texture('sepetiba', grid(-44.20, -43.50, -23.20, -22.80, 30.0), ['PQ', 'NQ'])
