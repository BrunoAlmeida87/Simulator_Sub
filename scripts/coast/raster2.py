import json, math, sys, numpy as np
from PIL import Image
src, tag = sys.argv[1], sys.argv[2]
CELL=float(sys.argv[3]) if len(sys.argv)>3 else 50.0
LAT0,LAT1,LON0,LON1=-23.20,-22.80,-44.20,-43.50
latc=(LAT0+LAT1)/2
dlat=CELL/111320.0
dlon=CELL/(111320.0*math.cos(math.radians(latc)))
NY=int(math.ceil((LAT1-LAT0)/dlat)); NX=int(math.ceil((LON1-LON0)/dlon))
polys=json.load(open(src))
E=[]
for poly in polys:
    for ring in poly:
        a=np.asarray(ring,dtype=np.float64)
        x=(a[:,0]-LON0)/dlon; y=(LAT1-a[:,1])/dlat
        x1,y1,x2,y2=x[:-1],y[:-1],x[1:],y[1:]
        keep=(np.maximum(y1,y2)>=0)&(np.minimum(y1,y2)<=NY)&(y1!=y2)
        E.append(np.stack([x1[keep],y1[keep],x2[keep],y2[keep]],axis=1))
E=np.concatenate(E)
print(tag,'grade',NX,NY,'arestas úteis',len(E))
mask=np.zeros((NY,NX),dtype=np.uint8)
X1,Y1,X2,Y2=E.T
ymin=np.minimum(Y1,Y2); ymax=np.maximum(Y1,Y2)
for r in range(NY):
    yc=r+0.5
    sel=(ymin<=yc)&(ymax>yc)
    if not sel.any(): continue
    t=(yc-Y1[sel])/(Y2[sel]-Y1[sel])
    xs=np.sort(X1[sel]+t*(X2[sel]-X1[sel]))
    for i in range(0,len(xs)-1,2):
        a=int(math.ceil(xs[i]-0.5)); b=int(math.floor(xs[i+1]-0.5))
        a=max(a,0); b=min(b,NX-1)
        if b>=a: mask[r,a:b+1]=1
print('terra %', mask.mean()*100)
np.save(f'mask_{tag}.npy',mask)
Image.fromarray(mask*255).resize((NX//2,NY//2)).save(f'mask_{tag}_small.png')
json.dump({'LAT0':LAT0,'LAT1':LAT1,'LON0':LON0,'LON1':LON1,'dlat':dlat,'dlon':dlon,'NX':NX,'NY':NY,'CELL':CELL}, open(f'grid_{tag}.json','w'))
