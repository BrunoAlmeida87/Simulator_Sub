# Modelos 3D

## Inclusão automática na galeria

Adicione um arquivo `.glb` em `public/models/`: o próximo build o inclui na aba
**Modelos 3D**, sem editar o código. Arquivos `.blend` enviados para a mesma pasta
são exportados para `.glb` pelo workflow de publicação no GitHub antes do build.
Esse processo precisa de Blender 5.2.3; o navegador não consegue abrir `.blend`
diretamente. A conversão usa apenas objetos visíveis de geometria, exclui planos
de oceano da cena e não executa
scripts contidos no arquivo Blender. Os novos modelos aparecem na galeria após a
publicação do site; integrar um navio à simulação requer definir também o contato
e a associação do modelo no código.

Para exportar localmente, instale Python 3.13 e `bpy==5.2.3`, depois execute
`npm run modelos:exportar` e `npm run build`.

Os oito GLBs originais foram exportados dos arquivos fornecidos pelo usuário,
preservados em `assets/blender`. Eles têm associações fixas aos contatos em
`src/render3d/modelAssets.ts`. Os modelos adicionados depois aparecem pelo
catálogo gerado em `public/models/catalog.json` durante o build.

| GLB | Uso |
| --- | --- |
| graneleiro.glb | Contato M1 e galeria |
| carga.glb | Contato M2 e galeria |
| rebocador.glb | Contato R1 e galeria |
| rebocador_convencional.glb | Contato RCON e galeria |
| rebocador_asd.glb | Contato RASD e galeria |
| rebocador_trator_voith.glb | Contato RVOI e galeria |
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
em +Y e linha d'água em Y=0 no GLB. A cena operacional ajusta proporcionalmente o comprimento ao tamanho configurado
para o contato, preservando a origem na linha d'água; a galeria apresenta as
dimensões originais e usa escala temporária apenas para enquadramento.

`manifest.json` registra hashes dos originais, tamanhos, limites geométricos e
objetos excluídos. Os testes carregam cada GLB com o mesmo loader do aplicativo.
O torpedo é somente um asset visual, sem mecânica de lançamento.

Os contatos seguem a cinemática existente do mapa; os rebocadores adicionais
usam trajetos fictícios paralelos ao R1. Eles não alteram a física do submarino.
A camada de tráfego existente aplica ondas, esteiras, luzes, alcance e rótulos
aos modelos importados. Em falha de carregamento, mantém o modelo simplificado.

## Míssil SM39 e fragata Tamandaré (alvo)

`sx1-sm39.glb` (cápsula VSM com o míssil SM39, asas com a forma "Recolhida") e `sx1-fragata.glb` (fragata classe
Tamandaré, radar giratório) saem de `SM_39VSM.blend` e `fragata_tamandare.blend` desta pasta pelos scripts
`scripts/blender/build_sm39.py` e `build_fragata.py` e são comprimidos com `npm run modelo:otimizar -- sm39 fragata`.
São lidos por `src/render3d/MissileVis.ts` (contrato conferido em `tests/missileModels.test.ts`).
