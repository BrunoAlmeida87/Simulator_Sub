import json, math, numpy as np
from PIL import Image
g=json.load(open('grid_10m.json'))
NX,NY,dlat,dlon=g['NX'],g['NY'],g['dlat'],g['dlon']
LAT1,LON0=g['LAT1'],g['LON0']
vec=np.load('mask_10m.npy').astype(bool)
M=np.load('mosaic.npy')
xs0,ys0,W,H=map(int,open('mosaic_meta.txt').read().split())
Z=12; n=2**Z*256
# DEM amostrado nos centros das células (vizinho mais próximo)
lats=LAT1-(np.arange(NY)+0.5)*dlat
lons=LON0+(np.arange(NX)+0.5)*dlon
px=((lons+180)/360*n - xs0*256).astype(int)
r=np.radians(lats); py=((1-np.log(np.tan(r)+1/np.cos(r))/math.pi)/2*n - ys0*256).astype(int)
D=M[np.clip(py,0,H-1)][:,np.clip(px,0,W-1)]
D=np.where((D<-500)|(D>3000), 0, D)  # descarta valores sem dado
np.save('dem50.npy', D.astype(np.float32))
for thr in (3,8):
    dem=D>thr
    img=np.zeros((NY,NX,3),dtype=np.uint8)
    img[vec&dem]=(230,230,230)   # ambos terra
    img[vec&~dem]=(230,190,60)   # só vetor
    img[~vec&dem]=(220,60,60)    # só DEM
    img[~vec&~dem]=(20,40,90)
    Image.fromarray(img).resize((NX*2//3,NY*2//3)).save(f'cmp_{thr}.png')
    print(thr,'só vetor',(vec&~dem).sum(),'só DEM',(~vec&dem).sum())
