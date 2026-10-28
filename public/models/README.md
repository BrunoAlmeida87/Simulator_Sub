# Modelos 3D

Os oito GLBs foram exportados dos arquivos fornecidos pelo usuário, preservados
em `assets/blender`. O catálogo está em `src/render3d/modelAssets.ts`.

| GLB | Uso |
| --- | --- |
| graneleiro.glb | Contato M1 e galeria |
| carga.glb | Contato M2 e galeria |
| rebocador.glb | Contato R1 e galeria |
| rebocador_convencional.glb | Contato R2 e galeria |
| rebocador_asd.glb | Contato R3 e galeria |
| rebocador_trator_voith.glb | Contato R4 e galeria |
| rebocadores_frota.glb | Galeria: conjunto dos três tipos especializados |
| torpedo_f21.glb | Galeria: modelo visual |

## Exportação reproduzível

Use Python 3.13 com `bpy==5.2.3`, ou Blender 5.2:

```sh
python scripts/assets/export_blender.py --source assets/blender --output public/models
```

O exportador desativa scripts embutidos, avalia modificadores, converte textos e
curvas em malha e une as peças mantendo os materiais. Exclui câmeras, luzes e o
objeto `Superficie do mar` dos cargueiros. Os arquivos originais não são alterados.
A escala dos arquivos é preservada (1 unidade = 1 metro), com proa em -Z, altura
em +Y e linha d'água em Y=0 no GLB. Não há redimensionamento na cena operacional;
a galeria enquadra os objetos com escala temporária de visualização.

`manifest.json` registra hashes dos originais, tamanhos, limites geométricos e
objetos excluídos. Os testes carregam cada GLB com o mesmo loader do aplicativo.
O torpedo é somente um asset visual, sem mecânica de lançamento.

Os contatos seguem a cinemática existente do mapa; os rebocadores adicionais
usam trajetos fictícios paralelos ao R1. Eles não alteram a física do submarino.
Os navios permanecem na linha d'água estática, sem dinâmica de balanço nas ondas.
