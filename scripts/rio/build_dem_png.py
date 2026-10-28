"""Relevo fino (30 m) para o DESENHO 3D da terra: PNG em tons de cinza, altura
h = (v / K)² m (v = 0…255), amostrado do Copernicus DEM GLO-30 (dem30.npy) nas
mesmas grades das texturas de satélite. A física usa a grade de 200 m de
coastData*.ts; este relevo só dá forma aos morros (Pão de Açúcar, Corcovado…).
Uso: python3 build_dem_png.py <pasta de saída>"""
import json, math, sys, numpy as np
from PIL import Image
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
K = 255 / math.sqrt(1750)
m = json.load(open('dem30_meta.json')); D30 = np.load('dem30.npy')
def grid(lon0, lon1, lat0, lat1, cell):
    latc = (lat0 + lat1) / 2
    dlat = cell / 111320.0; dlon = cell / (111320.0 * math.cos(math.radians(latc)))
    nx = int(math.ceil((lon1 - lon0) / dlon)); ny = int(math.ceil((lat1 - lat0) / dlat))
    return dict(lon0=lon0, lon1=lon0 + nx * dlon, lat0=lat1 - ny * dlat, lat1=lat1, dlon=dlon, dlat=dlat, nx=nx, ny=ny)
meta = {}
for name, g in (('rio', grid(-43.56, -43.00, -23.10, -22.64, 30.0)), ('sepetiba', grid(-44.20, -43.50, -23.20, -22.80, 30.0))):
    lats = g['lat1'] - (np.arange(g['ny']) + 0.5) * g['dlat']
    lons = g['lon0'] + (np.arange(g['nx']) + 0.5) * g['dlon']
    fy = (m['y0'] - lats) / m['dlat'] - 0.5
    fx = (lons - m['x0']) / m['dlon'] - 0.5
    y0 = np.clip(np.floor(fy).astype(int), 0, m['ny'] - 2); x0 = np.clip(np.floor(fx).astype(int), 0, m['nx'] - 2)
    ty = (fy - y0)[:, None]; tx = (fx - x0)[None, :]
    a = D30[y0][:, x0]; b = D30[y0][:, x0 + 1]; c = D30[y0 + 1][:, x0]; d = D30[y0 + 1][:, x0 + 1]
    H = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
    H = np.clip(H, 0, 1750)
    V = np.clip(np.round(np.sqrt(H) * K), 0, 255).astype(np.uint8)
    Image.fromarray(V, 'L').save(f'{OUT}/{name}_dem.png', optimize=True)
    g['K'] = K
    meta[name] = g
    print(name, V.shape, 'h máx', H.max())
json.dump(meta, open('terrain_meta.json', 'w'), indent=1)
