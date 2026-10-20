import json, math, numpy as np
from collections import deque
from PIL import Image
g=json.load(open('grid_10m.json'))
NX,NY,dlat,dlon=g['NX'],g['NY'],g['dlat'],g['dlon']
LAT0,LAT1,LON0,LON1=g['LAT0'],g['LAT1'],g['LON0'],g['LON1']
vec=np.load('mask_10m.npy').astype(bool)
D=np.load('dem50.npy')
land=vec|(D>15)
# --- componentes conexos (4-vizinhança) com rótulos por varredura + union-find
def components(m):
    lab=np.zeros(m.shape,dtype=np.int32)
    parent=[0]
    def find(a):
        while parent[a]!=a:
            parent[a]=parent[parent[a]]; a=parent[a]
        return a
    H,W=m.shape
    nxt=1
    for y in range(H):
        row=m[y]; up=lab[y-1] if y>0 else None
        for x in np.flatnonzero(row):
            l=lab[y,x-1] if x>0 and row[x-1] else 0
            u=up[x] if up is not None and m[y-1,x] else 0
            if l and u:
                a,b=find(l),find(u)
                if a!=b: parent[max(a,b)]=min(a,b)
                lab[y,x]=min(a,b)
            elif l or u: lab[y,x]=l or u
            else:
                parent.append(nxt); lab[y,x]=nxt; nxt+=1
    roots=np.array([find(i) for i in range(len(parent))],dtype=np.int32)
    return roots[lab]
# água: componentes; as que não tocam a borda e são pequenas viram terra
wl=components(~land)
border=set(np.unique(np.concatenate([wl[0],wl[-1],wl[:,0],wl[:,-1]]))) - {0}
ids,counts=np.unique(wl[wl>0],return_counts=True)
filled=0
for i,c in zip(ids,counts):
    if i not in border and c<4000:
        land[wl==i]=True; filled+=1
# terra: ilhas minúsculas (< 4 células) removidas
ll=components(land)
ids,counts=np.unique(ll[ll>0],return_counts=True)
small=ids[counts<4]
land[np.isin(ll,small)]=False
print('lagos preenchidos',filled,'ilhotas removidas',len(small),'terra %',land.mean()*100)
np.save('land50.npy',land)
# --- distância com sinal (chanfro 3-4), em metros
INF=1e9
def chamfer(src):
    d=np.where(src,0.0,INF)
    a,b=g['CELL'],g['CELL']*math.sqrt(2)
    H,W=d.shape
    for y in range(H):
        for x in range(W):
            v=d[y,x]
            if v==0: continue
            if x>0: v=min(v,d[y,x-1]+a)
            if y>0:
                v=min(v,d[y-1,x]+a)
                if x>0: v=min(v,d[y-1,x-1]+b)
                if x<W-1: v=min(v,d[y-1,x+1]+b)
            d[y,x]=v
    for y in range(H-1,-1,-1):
        for x in range(W-1,-1,-1):
            v=d[y,x]
            if v==0: continue
            if x<W-1: v=min(v,d[y,x+1]+a)
            if y<H-1:
                v=min(v,d[y+1,x]+a)
                if x<W-1: v=min(v,d[y+1,x+1]+b)
                if x>0: v=min(v,d[y+1,x-1]+b)
            d[y,x]=v
    return d
import time; t=time.time()
dw=chamfer(land)   # distância até a terra (para água)
print('chanfro', time.time()-t)
def ll2cell(lat,lon): return int((LAT1-lat)/dlat), int((lon-LON0)/dlon)
for nm,(la,lo) in {'origem padrão':(-22.9455,-43.8395),'EBN':(-22.9318,-43.8368),'baía centro':(-22.98,-43.85),'área exercício N':(-23.15,-43.85),'mar aberto origem':(-23.3,-43.85)}.items():
    if LAT0<=la<=LAT1:
        r,c=ll2cell(la,lo); print(nm,'terra' if land[r,c] else 'água','dist até terra %.0f m'%dw[r,c])
img=np.zeros((NY,NX,3),dtype=np.uint8); img[land]=(220,220,210); img[~land]=(20,40,90)
Image.fromarray(img).resize((NX*2//3,NY*2//3)).save('land50.png')
