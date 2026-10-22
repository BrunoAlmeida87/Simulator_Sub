"""Recorta os polígonos de terra do OpenStreetMap (geo-maps earth-lands-10m) na região do Rio."""
import json, sys
src, dst = sys.argv[1], sys.argv[2]
LAT0, LAT1, LON0, LON1 = -23.10, -22.64, -43.56, -43.00
d = json.load(open(src))
geoms = d['geometries'] if 'geometries' in d else [f['geometry'] for f in d['features']]
out = []
def overlap(ring):
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    return not (max(xs) < LON0 or min(xs) > LON1 or max(ys) < LAT0 or min(ys) > LAT1)
for g in geoms:
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    for poly in polys:
        if overlap(poly[0]):
            out.append(poly)
print('polígonos', len(out), 'pontos', sum(len(r) for p in out for r in p))
json.dump(out, open(dst, 'w'))
