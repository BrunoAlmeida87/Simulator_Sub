import math, glob, numpy as np
from PIL import Image
Z=12
tiles=sorted(glob.glob('dem/12_*.png'))
xs=sorted({int(t.split('_')[1]) for t in tiles}); ys=sorted({int(t.split('_')[2].split('.')[0]) for t in tiles})
W=256*len(xs); H=256*len(ys)
M=np.zeros((H,W),dtype=np.float32)
for t in tiles:
    x=int(t.split('_')[1]); y=int(t.split('_')[2].split('.')[0])
    a=np.asarray(Image.open(t).convert('RGB')).astype(np.float64)
    e=(a[:,:,0]*256+a[:,:,1]+a[:,:,2]/256)-32768
    M[(y-ys[0])*256:(y-ys[0]+1)*256,(x-xs[0])*256:(x-xs[0]+1)*256]=e
np.save('mosaic.npy',M)
open('mosaic_meta.txt','w').write(f'{xs[0]} {ys[0]} {W} {H}')
print(M.shape, M.min(), M.max())
# pixel → lat/lon
def px2ll(px,py):
    n=2**Z*256
    lon=(xs[0]*256+px)/n*360-180
    yy=(ys[0]*256+py)/n
    lat=math.degrees(math.atan(math.sinh(math.pi*(1-2*yy))))
    return lat,lon
print('canto NO', px2ll(0,0), 'SE', px2ll(W,H))
# imagem de inspeção
img=np.zeros((H,W,3),dtype=np.uint8)
land=M>0
img[land]=np.stack([np.clip(60+M[land]*0.4,0,255)]*3,axis=1).astype(np.uint8)
img[~land]=(20,40,90)
img[(M>-1)&(M<=0)]=(200,180,60)
Image.fromarray(img).save('mosaic.png')
def ll2px(lat,lon):
    n=2**Z*256
    px=(lon+180)/360*n - xs[0]*256
    r=math.radians(lat); py=(1-math.log(math.tan(r)+1/math.cos(r))/math.pi)/2*n - ys[0]*256
    return px,py
for nm,(la,lo) in {'origem padrão':(-22.9455,-43.8395),'EBN':(-22.9318,-43.8368),'baía centro':(-22.98,-43.85),'Itaguaí':(-22.865,-43.775),'Marambaia leste':(-23.06,-43.60),'restinga meio':(-23.045,-43.80),'mar aberto':(-23.15,-43.85)}.items():
    px,py=ll2px(la,lo); print(nm, la, lo, '→ elev', M[int(py),int(px)])
