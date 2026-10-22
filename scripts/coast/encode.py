import json, math, base64, numpy as np
g=json.load(open('grid_10m.json'))
NX,NY=g['NX'],g['NY']
land=np.load('land50.npy')
D=np.load('dem50.npy')
# --- máscara: comprimentos de sequência por linha (começa com água), varint LEB128
def varint(n,out):
    while True:
        b=n&0x7f; n>>=7
        if n: out.append(b|0x80)
        else: out.append(b); break
buf=bytearray()
for y in range(NY):
    row=land[y]; cur=False; run=0
    for v in row:
        if bool(v)==cur: run+=1
        else:
            varint(run,buf); cur=not cur; run=1
    varint(run,buf)
mask_b64=base64.b64encode(bytes(buf)).decode()
# --- relevo: blocos de 4×4 células (200 m), média da altura nas células de terra
F=4
EX=(NX+F-1)//F; EY=(NY+F-1)//F
H=np.zeros((EY,EX),dtype=np.float32)
for by in range(EY):
    for bx in range(EX):
        m=land[by*F:(by+1)*F, bx*F:(bx+1)*F]
        if m.any():
            d=D[by*F:(by+1)*F, bx*F:(bx+1)*F][m]
            H[by,bx]=max(1.5, float(np.clip(d,0,None).mean()))
K=6.0
V=np.clip(np.round(np.sqrt(H)*K),0,255).astype(np.uint8)
V[(H>0)&(V==0)]=1
eb=bytearray(); flat=V.flatten(); i=0
while i<len(flat):
    if flat[i]==0:
        j=i
        while j<len(flat) and flat[j]==0 and j-i<255: j+=1
        eb.append(0); eb.append(j-i); i=j
    else:
        eb.append(int(flat[i])); i+=1
elev_b64=base64.b64encode(bytes(eb)).decode()
print('máscara bytes',len(buf),'b64',len(mask_b64),'| relevo',EX,EY,'bytes',len(eb),'b64',len(elev_b64),'| h máx',H.max())
meta=dict(lat0=g['LAT0'],lat1=g['LAT1'],lon0=g['LON0'],lon1=g['LON1'],dlat=g['dlat'],dlon=g['dlon'],nx=NX,ny=NY,cell=g['CELL'],elevFactor=F,ex=EX,ey=EY,elevK=K)
ts='''/**
 * DADOS DA COSTA (gerados; não editar à mão) — região da Baía de Sepetiba,
 * Restinga e Ilha da Marambaia, Itaguaí e Ilha Grande (leste).
 *
 * - Máscara terra/água em grade de 50 m: polígonos de terra do OpenStreetMap
 *   (© colaboradores do OpenStreetMap, licença ODbL), pacote geo-maps 0.6.0
 *   (earth-lands-10m), completados onde o relevo indica terra alta (> 15 m),
 *   lagoas fechadas pequenas preenchidas e ilhotas < 4 células removidas.
 * - Relevo em grade de 200 m: blocos de elevação Terrarium (Mapzen/AWS Open
 *   Data: SRTM, GMTED, ETOPO1 e outras fontes), média sobre as células de terra.
 *
 * Codificação: máscara = comprimentos de sequência por linha (de norte para
 * sul; cada linha começa com água), em varint LEB128, base64. Relevo = bytes
 * v com altura h = (v / elevK)², zeros em sequência como (0, n), base64.
 * Gerado por scripts/coast/README.md (procedimento descrito lá).
 */
export const COAST_META = '''+json.dumps(meta)+''' as const;

export const COAST_MASK_B64 =
  \''''+mask_b64+'''\';

export const COAST_ELEV_B64 =
  \''''+elev_b64+'''\';
'''
open('../../src/sim/environment/coastData.ts','w').write(ts)
print('arquivo', len(ts))
