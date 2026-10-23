import json, sys
src, dst = sys.argv[1], sys.argv[2]
LAT0,LAT1,LON0,LON1=-23.20,-22.80,-44.20,-43.50
d=json.load(open(src))
out=[]
def bbox_overlap(ring):
    xs=[p[0] for p in ring]; ys=[p[1] for p in ring]
    return not (max(xs)<LON0 or min(xs)>LON1 or max(ys)<LAT0 or min(ys)>LAT1)
geoms = d['geometries'] if 'geometries' in d else [f['geometry'] for f in d['features']]
for g in geoms:
    polys = g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
    for poly in polys:
        if bbox_overlap(poly[0]):
            out.append(poly)
print('polígonos na região', len(out), 'pontos', sum(len(r) for p in out for r in p))
json.dump(out, open(dst,'w'))
