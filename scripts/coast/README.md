# Dados da costa (Baía de Sepetiba)

`src/sim/environment/coastData.ts` é gerado por estes scripts (Python 3 com
`numpy` e `Pillow`). Eles só precisam de internet para baixar os dados; o
simulador usa o arquivo gerado e funciona offline.

Fontes:
- Polígonos de terra do OpenStreetMap (© colaboradores do OpenStreetMap,
  licença ODbL), pacote npm `@geo-maps/earth-lands-10m` 0.6.0.
- Relevo: blocos Terrarium (AWS Open Data / Mapzen; SRTM, GMTED, ETOPO1 e
  outras fontes), zoom 12.

Passos (numa pasta de trabalho vazia):

```sh
python3 fetch_dem.py                       # baixa os blocos de relevo em dem/
mkdir -p geo && curl -o geo/lands10m.tgz https://registry.npmjs.org/@geo-maps/earth-lands-10m/-/earth-lands-10m-0.6.0.tgz
mkdir -p geo/p10 && tar xzf geo/lands10m.tgz -C geo/p10 package/map.geo.json
python3 clip.py geo/p10/package/map.geo.json geo/clip10m.json   # recorta a região
python3 raster2.py geo/clip10m.json 10m 50  # máscara terra/água em 50 m
python3 mosaic.py                          # monta o mosaico de relevo (mosaic.npy)
python3 combine.py                          # amostra o relevo na grade (dem50.npy)
python3 build_coast.py                      # limpa a máscara (lagoas, ilhotas, terra alta)
python3 encode.py                           # escreve coastData.ts
```

`combine.py` espera `mosaic.npy`/`mosaic_meta.txt` (mosaico dos blocos de
relevo decodificados: altura = R·256 + G + B/256 − 32768). Para ampliar a
região, ajuste os limites em `fetch_dem.py`, `clip.py` e `raster2.py`.
