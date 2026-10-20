import math, os, sys, urllib.request, ssl
Z=12
LAT0,LAT1=-23.17,-22.83
LON0,LON1=-44.13,-43.54
def tx(lon): return int((lon+180)/360*2**Z)
def ty(lat):
    r=math.radians(lat); return int((1-math.log(math.tan(r)+1/math.cos(r))/math.pi)/2*2**Z)
xs=range(tx(LON0),tx(LON1)+1); ys=range(ty(LAT1),ty(LAT0)+1)
print('x',list(xs),'y',list(ys))
ctx=ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE'))
for x in xs:
    for y in ys:
        fn=f'dem/{Z}_{x}_{y}.png'
        if os.path.exists(fn): continue
        url=f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png'
        with urllib.request.urlopen(url, context=ctx, timeout=60) as r: open(fn,'wb').write(r.read())
        print('ok',fn, os.path.getsize(fn))
