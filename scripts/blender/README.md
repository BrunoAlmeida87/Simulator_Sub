# Modelo 3D do SX-1 (Blender)

Gera `public/models/sx1-alta.glb` e `public/models/sx1-leve.glb`, lidos por `src/render3d/subModel.ts`.
O SX-1 é fictício. O desenho segue o exterior **público** do Scorpène e da classe Riachuelo (S-BR), sem
marcas, numerais ou brasões reais. As medidas vêm da física (`defaultVessel.ts`, `hullGeometry.ts`):
se elas mudarem, atualize as constantes no topo de `build_sx1.py` e gere de novo.

## Passo a passo

1. Montar e exportar (Blender 5.2, sem interface):

   ```bash
   "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P scripts/blender/build_sx1.py
   ```

   Saída em `build/modelo/` (fora do git): `sx1-alta.raw.glb`, `sx1-leve.raw.glb`, `sx1.blend` e `texturas/`.
   Opções depois de `--`: `--saida <pasta>` e `--nivel alta|leve|ambos`.

2. Comprimir e copiar para o site:

   ```bash
   npm run modelo:otimizar
   ```

   O script aplica meshopt (as texturas já saem do Blender em WebP) e confere os limites: alta ≤ 6 MB, leve ≤ 2 MB.

3. Conferir: `npm test` (`tests/subModelFile.test.ts` confere nomes, pivôs, casco sobre `radiusAt`,
   compressão e tamanho) e, se quiser ver as vistas, `scripts/blender/preview_sx1.py`
   (`blender -b build/modelo/sx1.blend -P scripts/blender/preview_sx1.py -- build/modelo/vistas`).

Prints do site, antes e depois (Playwright, que não é dependência do projeto):

```bash
npm run build
npx vite preview --port 4173
node scripts/prints/modelo3d.mjs
```

O segundo comando fica rodando: dê o terceiro em outro terminal. Os prints saem em `build/prints/`.

## Contrato com a cena (subModel.ts)

- Metros; origem no eixo do casco, a meio comprimento. Blender: +Y = proa, +X = boreste, +Z = cima.
  Exportado em glTF com +Y para cima.
- Peças com nomes fixos (`SUB_PARTS`). Cada peça móvel é um **nó vazio** com o nome, a origem sobre o
  eixo de giro e na posição de repouso (lemes a zero, mastros arriados como no desenho antigo). A
  malha é filha (`<nome>_Malha`), sem transformação. Assim a quantização do meshopt mexe só na malha,
  nunca no pivô.
- Malhas fixas do casco externo usam o prefixo `SX1_Casco_…`: escotilhas, sonar de flanco, embornais,
  portas dos tubos, carenagens e janelas da vela. O topo do casco é liso, sem faixa de convés em relevo.
- As marcas de calado continuam sendo desenhadas pelo código (`SX1_MarcasCalado` é opcional e não é gerado).
- **Oclusão ambiente**: calculada no Cycles (`bake_ao`) com todas as malhas juntas e gravada no atributo de
  cor `AO`, exportado como `COLOR_0` (multiplica a cor base no site). Os mastros móveis ficam sem sombra de
  contato, porque arriados estão dentro da vela. Ajustes: `AO_DISTANCE`, `AO_STRENGTH`, `AO_BOTTOM`.
- O **reflexo do céu** não está no arquivo: é gerado no site (`src/render3d/subEnvironment.ts`) com as cores da cena.

## Interior (para a futura vista em corte)

`build_sx1_interior.py` modela, em estilo técnico, o que o corte do site mostra hoje: os 9 tanques
(lastro, compensação, trim e banda), as tubulações com flanges e faixas de identificação do fluido,
as 32 válvulas (corpo, castelo, volante e plaqueta), as 4 bombas (com motor), as 12 garrafas de ar AP,
as aberturas para o mar, a bateria e os dois geradores. As posições vêm do próprio site:

```bash
npx vite-node scripts/blender/exportar_interior.ts
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P scripts/blender/build_sx1_interior.py -- --corte
npm run modelo:otimizar
```

O primeiro comando grava `build/modelo/interior.json` a partir de `src/render3d/Systems.ts`; o segundo monta
o interior, calcula a oclusão e exporta `sx1-interior.raw.glb`; com `--corte` também renderiza a prévia do
meio casco aberto em `build/modelo/corte/`; o terceiro comprime para `public/models/sx1-interior.glb`.

- O site **ainda não carrega** o `sx1-interior.glb`; o corte atual continua o mesmo. O teste
  `tests/subInterior.test.ts` garante que o arquivo segue o corte publicado (mesmas peças e posições).
- Nomes fixos (`SX1I_Tanque_<ID>`, `SX1I_Valvula_<nome>`, `SX1I_Bomba_<nome>`, `SX1I_Tubo_<n>`…), nós só com
  translação; volantes e rotores são filhos com origem no eixo de giro (`eixo_giro` em extras).
  Nome, sistemas e trajetos ficam em extras (no Three.js, `userData`) para ligar cada peça ao estado.
- Todas as malhas são fechadas: um plano de corte com tampa (stencil) ou uma booleana funcionam.
- Se o corte do site mudar (tanque, tubo ou válvula novos), rode os três comandos de novo.

## Referências

As fotos usadas como referência ficam em `referencias/` (fora do git, por direitos autorais), com a
fonte de cada uma em `referencias/FONTES.txt`.
