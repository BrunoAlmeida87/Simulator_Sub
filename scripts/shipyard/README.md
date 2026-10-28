# Dados do Estaleiro e Base Naval (Ilha da Madeira, Itaguaí)

`src/sim/environment/shipyardData.ts` é gerado por estes scripts (Python 3 com
`numpy`, `Pillow` e `rasterio`). Só precisam de internet para baixar as
imagens; o simulador usa o arquivo gerado e funciona offline.

Fonte: imagens **Sentinel-2 L2A** (Copernicus, ESA; 10 m por pixel) do
bucket público `sentinel-cogs` (AWS Open Data), quadrícula 23KPQ, cenas de
01/07/2026 e 21/07/2026 (sem nuvens). Contém dados modificados do Copernicus
Sentinel (2026).

Passos (numa pasta de trabalho vazia, com `s2/img/` e `yard/` criadas):

```sh
python3 s2_crop.py S2C_23KPQ_20260721_0_L2A s2/img/a        # cor verdadeira + georreferência (a.json)
for S in S2C_23KPQ_20260721_0_L2A S2C_23KPQ_20260701_0_L2A; do
  python3 s2_band.py $S B08 s2/img/${S:10:8}_B08.npy           # infravermelho
  python3 s2_band.py $S B04 s2/img/${S:10:8}_B04.npy           # vermelho
done
python3 classify.py 20260721 20260701                         # água / vegetação / construído
cp trace.json yard/                                           # traçado manual (pixels da imagem a.png)
python3 fit.py                                                # ajusta o traçado à máscara (deslocamento + centro dos molhes)
python3 gen.py caminho/para/src/sim/environment/shipyardData.ts
```

`trace.json` tem o contorno do aterro, o eixo e a largura de cada molhe, o
shiplift, a área dragada e o píer do Porto Sudeste, em pixels da imagem
recortada. Os galpões (posição, tamanho e altura) estão em `gen.py`: foram
estimados dos telhados visíveis na imagem de 10 m e de fotografias aéreas —
não há medidas oficiais publicadas. A profundidade dragada (16 m) também é
estimada.
