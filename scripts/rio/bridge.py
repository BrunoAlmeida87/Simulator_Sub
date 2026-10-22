"""Traçado e altura do tabuleiro da Ponte Rio–Niterói: pixels "não água" da
classificação Sentinel-2 (SCL 25 m) no corredor da ponte sobre a baía, e a
altura do modelo de superfície Copernicus (DSM, inclui o tabuleiro) ao longo
dele. Imprime a lista de pontos (lat, lon, altura do tabuleiro)."""
import json, numpy as np
scl = np.load('rio_scl25.npy'); g = json.load(open('rio_scl25_grid.json'))
m = json.load(open('dem30_meta.json')); D = np.load('dem30.npy')
lat_of = lambda r: g['lat1'] - (r + 0.5) * g['dlat']
lon_of = lambda c: g['lon0'] + (c + 0.5) * g['dlon']
def dsm(lat, lon):
    y = int((m['y0'] - lat) / m['dlat']); x = int((lon - m['x0']) / m['dlon'])
    return float(D[y - 1:y + 2, x - 1:x + 2].max())
LO0, LO1, LA0, LA1 = -43.207, -43.118, -22.886, -22.862
c0 = int((LO0 - g['lon0']) / g['dlon']); c1 = int((LO1 - g['lon0']) / g['dlon'])
r0 = int((g['lat1'] - LA1) / g['dlat']); r1 = int((g['lat1'] - LA0) / g['dlat'])
pts = []
prev = None
for c in range(c0, c1):
    col = scl[r0:r1, c]
    rows = np.flatnonzero(col != 6)
    if not len(rows): continue
    # componente mais próxima do ponto anterior (ponte contínua)
    rr = rows + r0
    if prev is not None:
        rr = rr[np.abs(rr - prev) <= 3]
        if not len(rr): continue
    r = float(np.median(rr)); prev = r
    pts.append((lat_of(r), lon_of(c)))
pts = np.array(pts)
# suaviza e amostra a cada ~400 m
from math import cos, radians
out = []
k = 9
for i in range(0, len(pts), 16):
    a = max(0, i - k); b = min(len(pts), i + k + 1)
    la, lo = pts[a:b, 0].mean(), pts[a:b, 1].mean()
    out.append((round(la, 5), round(lo, 5), round(dsm(la, lo), 1)))
for p in out: print(p)
