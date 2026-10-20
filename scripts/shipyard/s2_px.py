import json, sys
from rasterio.warp import transform
meta = json.load(open('s2/img/a.json'))
a, b, c, d, e, f = meta['transform']
def ll2px(lat, lon):
    x, y = transform('EPSG:4326', meta['crs'], [lon], [lat])
    return ((x[0] - c) / a, (y[0] - f) / e)
def px2ll(px, py):
    x = c + a * px; y = f + e * py
    lon, lat = transform(meta['crs'], 'EPSG:4326', [x], [y])
    return (lat[0], lon[0])
if __name__ == '__main__':
    for name, lat, lon in [('QUAY.root', -22.93093, -43.83673), ('wiki', -22.93064, -43.84908), ('base_itaguai origin', -22.93498, -43.84015)]:
        print(name, [round(v, 1) for v in ll2px(lat, lon)])
