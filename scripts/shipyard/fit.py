# ajusta o traçado à máscara do Sentinel-2: deslocamento global + centro dos molhes
import json, numpy as np
from PIL import Image, ImageDraw
t = json.load(open('yard/trace.json'))
water, veg, built = np.load('s2/img/cls.npy').astype(bool)
n = (np.load('s2/img/20260721_B08.npy') + np.load('s2/img/20260701_B08.npy')) / 2
land = ~water
K = 4  # sub-amostragem
x0, y0, x1, y1 = 199, 222, 334, 332
def raster(tr, dx, dy):
    im = Image.new('L', ((x1 - x0) * K, (y1 - y0) * K), 0); d = ImageDraw.Draw(im)
    S = lambda p: ((p[0] + dx - x0) * K, (p[1] + dy - y0) * K)
    d.polygon([S(p) for p in tr['platform']], fill=1)
    for m in tr['moles'].values(): d.line([S(p) for p in m['pts']], fill=1, width=max(1, int(m['w'] * K)))
    s = tr['shiplift']; d.line([S(s['root']), S(s['tip'])], fill=1, width=int(s['w'] * K))
    return np.asarray(im, bool)
ref = np.kron((built | (land & ~veg))[y0:y1, x0:x1], np.ones((K, K), bool))
best = None
for dx in np.arange(-1.5, 1.51, 0.1):
    for dy in np.arange(-1.5, 1.51, 0.1):
        r = raster(t, dx, dy); iou = (r & ref).sum() / (r | ref).sum()
        if best is None or iou > best[0]: best = (iou, dx, dy)
print('IoU %.3f  dx %.1f dy %.1f' % best)
_, dx, dy = best
sh = lambda p: [round(p[0] + dx, 2), round(p[1] + dy, 2)]
t['platform'] = [sh(p) for p in t['platform']]
t['dredge'] = [sh(p) for p in t['dredge']]
t['shiplift']['root'] = sh(t['shiplift']['root']); t['shiplift']['tip'] = sh(t['shiplift']['tip'])
# centro de cada vértice interno dos molhes: centróide ponderado do infravermelho numa janela 5x5
for name, m in t['moles'].items():
    pts = [sh(p) for p in m['pts']]
    out = []
    for i, (px, py) in enumerate(pts):
        attach = (name in ('sul', 'norte', 'interno') and i in (0, len(pts) - 1)) or (name == 'oeste' and i == 0)
        if attach: out.append([px, py]); continue
        cx, cy = int(px), int(py)
        ys, xs = np.mgrid[cy - 2:cy + 3, cx - 2:cx + 3]
        wgt = np.clip(n[ys, xs] - 600, 0, None) * (~veg[ys, xs])
        if wgt.sum() > 0:
            nx_, ny_ = (wgt * (xs + 0.5)).sum() / wgt.sum(), (wgt * (ys + 0.5)).sum() / wgt.sum()
            # limita o ajuste a 1,5 px
            ddx, ddy = np.clip(nx_ - px, -1.5, 1.5), np.clip(ny_ - py, -1.5, 1.5)
            out.append([round(px + ddx, 2), round(py + ddy, 2)])
        else: out.append([px, py])
    m['pts'] = out
t['sudeste_trestle'] = [sh(p) for p in t['sudeste_trestle']]; t['sudeste_pier'] = [sh(p) for p in t['sudeste_pier']]
r = raster(t, 0, 0); print('IoU após ajuste %.3f' % ((r & ref).sum() / (r | ref).sum()))
json.dump(t, open('yard/trace_fit.json', 'w'), indent=1)
