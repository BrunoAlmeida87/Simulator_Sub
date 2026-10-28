"""Máscara terra/água (50 m) e relevo (200 m) da região do Rio de Janeiro →
src/sim/environment/coastDataRio.ts (mesma codificação de coastData.ts).
Entradas: geo/rio10m.json (clip_rio.py) e dem30.npy/dem30_meta.json (fetch_dem.py)."""
import json, math, sys, base64, numpy as np
from collections import deque
from PIL import Image
LAT0, LAT1, LON0, LON1 = -23.10, -22.64, -43.56, -43.00
CELL = 50.0
latc = (LAT0 + LAT1) / 2
dlat = CELL / 111320.0
dlon = CELL / (111320.0 * math.cos(math.radians(latc)))
NY = int(math.ceil((LAT1 - LAT0) / dlat)); NX = int(math.ceil((LON1 - LON0) / dlon))
# água pela classificação da cena Sentinel-2 (SCL 25 m, classe 6), maioria em cada célula de 50 m
scl = np.load('rio_scl25.npy')
g25 = json.load(open('rio_scl25_grid.json'))
assert abs(g25['dlat'] * 2 - dlat) < 1e-12 and abs(g25['dlon'] * 2 - dlon) < 1e-12
W = np.zeros((NY * 2, NX * 2), dtype=np.float32)
h, w = min(NY * 2, scl.shape[0]), min(NX * 2, scl.shape[1])
W[:h, :w] = (scl[:h, :w] == 6)
water_frac = W.reshape(NY, 2, NX, 2).mean(axis=(1, 3))
land = ~(water_frac >= 0.5)
print('terra % (SCL)', land.mean() * 100)
# relevo no centro das células (vizinho mais próximo do DEM 30 m)
m = json.load(open('dem30_meta.json')); D30 = np.load('dem30.npy')
lats = LAT1 - (np.arange(NY) + 0.5) * dlat
lons = LON0 + (np.arange(NX) + 0.5) * dlon
py = np.clip(((m['y0'] - lats) / m['dlat']).astype(int), 0, m['ny'] - 1)
px = np.clip(((lons - m['x0']) / m['dlon']).astype(int), 0, m['nx'] - 1)
D = D30[py][:, px]
# sombra de morro classificada como água: só é água abaixo de 12 m no modelo de superfície
land |= D > 12
# abertura (erosão + dilatação em cruz): some o que tem 1–2 células de largura —
# ponte Rio–Niterói, navios fundeados, píeres —, a costa e as ilhas ficam
def erode(m):
    e = m.copy()
    e[1:] &= m[:-1]; e[:-1] &= m[1:]; e[:, 1:] &= m[:, :-1]; e[:, :-1] &= m[:, 1:]
    return e
def dilate(m):
    d = m.copy()
    d[1:] |= m[:-1]; d[:-1] |= m[1:]; d[:, 1:] |= m[:, :-1]; d[:, :-1] |= m[:, 1:]
    return d
before = land.copy()
land = dilate(erode(land)) | (before & erode(erode(before)))
print('terra % após abertura', land.mean() * 100)
# componentes conexos (4-vizinhança) por BFS
def components(mask):
    lab = np.zeros(mask.shape, dtype=np.int32); n = 0
    H, W = mask.shape
    for y0 in range(H):
        for x0 in np.flatnonzero(mask[y0] & (lab[y0] == 0)):
            if lab[y0, x0]: continue
            n += 1; q = deque([(y0, x0)]); lab[y0, x0] = n
            while q:
                y, x = q.popleft()
                for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= yy < H and 0 <= xx < W and mask[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = n; q.append((yy, xx))
    return lab, n
# água fechada (lagoas e lagos sem ligação com o mar na grade) vira terra
wl, n = components(~land)
border = set(np.unique(np.concatenate([wl[0], wl[-1], wl[:, 0], wl[:, -1]]))) - {0}
ids, counts = np.unique(wl[wl > 0], return_counts=True)
filled = 0
for i, c in zip(ids, counts):
    if i not in border:
        land[wl == i] = True; filled += 1
# a maior componente de água (mar + baía) fica; outras grandes ligadas à borda (lagoas costeiras abertas) também
ll, n = components(land)
ids, counts = np.unique(ll[ll > 0], return_counts=True)
small = ids[counts < 6]
land[np.isin(ll, small)] = False
print('lagos/lagoas internos preenchidos', filled, 'ilhotas removidas', len(small), 'terra %', land.mean() * 100)
img = np.zeros((NY, NX, 3), dtype=np.uint8); img[land] = (220, 220, 210); img[~land] = (20, 40, 90)
Image.fromarray(img).save('rio_land50.png')
np.save('rio_land50.npy', land)
# --- codificação (igual a scripts/coast/encode.py)
def varint(n, out):
    while True:
        b = n & 0x7f; n >>= 7
        if n: out.append(b | 0x80)
        else: out.append(b); break
buf = bytearray()
for y in range(NY):
    row = land[y]; cur = False; run = 0
    for v in row:
        if bool(v) == cur: run += 1
        else:
            varint(run, buf); cur = not cur; run = 1
    varint(run, buf)
mask_b64 = base64.b64encode(bytes(buf)).decode()
F = 4
EX = (NX + F - 1) // F; EY = (NY + F - 1) // F
H = np.zeros((EY, EX), dtype=np.float32)
for by in range(EY):
    for bx in range(EX):
        mm = land[by * F:(by + 1) * F, bx * F:(bx + 1) * F]
        if mm.any():
            d = D[by * F:(by + 1) * F, bx * F:(bx + 1) * F][mm]
            H[by, bx] = max(1.5, float(np.clip(d, 0, None).mean()))
K = 6.0
V = np.clip(np.round(np.sqrt(H) * K), 0, 255).astype(np.uint8)
V[(H > 0) & (V == 0)] = 1
eb = bytearray(); flat = V.flatten(); i = 0
while i < len(flat):
    if flat[i] == 0:
        j = i
        while j < len(flat) and flat[j] == 0 and j - i < 255: j += 1
        eb.append(0); eb.append(j - i); i = j
    else:
        eb.append(int(flat[i])); i += 1
elev_b64 = base64.b64encode(bytes(eb)).decode()
print('máscara b64', len(mask_b64), '| relevo', EX, EY, 'b64', len(elev_b64), '| h máx', H.max())
meta = dict(lat0=LAT0, lat1=LAT1, lon0=LON0, lon1=LON1, dlat=dlat, dlon=dlon, nx=NX, ny=NY, cell=CELL, elevFactor=F, ex=EX, ey=EY, elevK=K)
def chunk(s, n=100): return '\n'.join(f"  '{s[i:i+n]}' +" for i in range(0, len(s), n)).rstrip(' +') 
out = sys.argv[1] if len(sys.argv) > 1 else 'coastDataRio.ts'
open(out, 'w').write(f'''/**
 * DADOS DA COSTA DO RIO DE JANEIRO (gerados; não editar à mão) — Baía de
 * Guanabara (Rio e Niterói, ilhas), orla oceânica do Leme ao Pontal e Barra
 * de Guaratiba.
 *
 * - Máscara terra/água em grade de 50 m: classificação da cena Sentinel-2
 *   L2A de 05/08/2024 (classe "água", maioria em cada célula; contém dados
 *   Copernicus Sentinel modificados, 2024), água só abaixo de 12 m no relevo;
 *   abertura morfológica (some a ponte Rio–Niterói, navios fundeados e
 *   píeres estreitos), lagoas fechadas preenchidas e ilhotas < 6 células
 *   removidas.
 * - Relevo em grade de 200 m: Copernicus DEM GLO-30 (DSM; © DLR/Airbus,
 *   Copernicus, AWS Open Data), média sobre as células de terra.
 *
 * Mesma codificação de coastData.ts. Gerado por scripts/rio (README).
 */
export const COAST_RIO_META = {json.dumps(meta)} as const;

export const COAST_RIO_MASK_B64 =
{chunk(mask_b64)};

export const COAST_RIO_ELEV_B64 =
{chunk(elev_b64)};
''')
print('escrito', out)
