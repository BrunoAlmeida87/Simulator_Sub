# Evolução do projeto — notas de conversa

Registro vivo das decisões e ideias discutidas para evoluir o SX-1. Atualizado a cada rodada de conversa.
Nada aqui foi implementado ainda, exceto onde indicado.

## Como trabalhar neste documento

- **Uma tarefa por conversa**, com escopo explícito, partindo da `main` atualizada (ver `CLAUDE.md`). Ao terminar: testes, build, capturas antes/depois quando for visual, e parar para o Bruno validar.
- **O Bruno valida cada tarefa** antes de pedir a próxima. Não emendar tarefas sem essa validação.
- **Modelo e esforço** são escolhidos por quem abre a conversa; este arquivo só sugere. Se a conversa estiver com configuração abaixo da sugerida para a tarefa, o modelo deve avisar antes de começar e deixar o Bruno decidir.
- Só dados **públicos e gratuitos**; nada de imagem comercial. Licença incerta = não incluir.
- Não alterar cenários existentes (`SCENARIOS`, `TOURS`); a física não depende da exibição.

| # | Tarefa | Modelo | Esforço |
|---|---|---|---|
| 1 | Artefatos de água/terreno no zoom out (seção 3) | Sonnet 5.5 | médio |
| 2 | Escala de resolução, qualidade dinâmica, medidor de FPS | Sonnet 5.5 | médio a alto |
| 3 | Teste visual automático (Playwright, capturas de referência) | Sonnet 5.5 | médio |
| 4 | Sensação de escala: FOV, névoa atmosférica, referências humanas | Sonnet 5.5 | alto |
| 5 | Sombras do sol e pós-processamento por perfil de qualidade | Opus 5.5 | alto |
| 6 | Física em Web Worker; dividir `SubmarineScene.ts` | Opus 5.5 | alto |
| 7 | Terreno: LOD contínuo; dados abertos (após licenças confirmadas) | Opus 5.5 | alto |
| 8 | Estaleiro: escala humana, detalhes, planta com ortofoto aberta | Sonnet 5.5 | alto |
| 9 | Modo palco, gravação, cenários de falha | Sonnet 5.5 | médio a alto |
| – | Decisões de arquitetura ou revisão ampla | Fable 5.1 | alto |

Evitar Haiku neste projeto (código grande e física delicada). Esforço máximo raramente compensa: se travar, dividir a tarefa.

## 1. Tecnologia: Three.js ou outro motor?

**Decisão: continuar com Three.js. Não migrar para o Godot.**

- A distribuição é por link (GitHub Pages), no navegador e no celular. O Godot exporta para web, mas pesado, com limites de WebGL2 e problemas em iOS.
- A maior parte do projeto é física (`src/sim`, TypeScript puro) e interface React (dezenas de telas). Migrar obrigaria a reescrever tudo, com pouco ganho visual.
- O gargalo gráfico não é o motor, e sim ajustes de câmera, profundidade, pós-processamento e ativos.
- Godot/Unreal/Unity só fariam sentido para um produto desktop ou VR, com a física em processo separado.
- Evolução natural na web: `WebGPURenderer` + TSL do Three.js (com queda para WebGL2), depois de resolver os itens abaixo.

## 2. Limitações do sistema atual

Ver também `docs/LIMITACOES.md` (física e representações visuais).

Gráficos:
- Cena 3D, física e React dividem a thread principal.
- Sem `EffectComposer`: sem SSAO, bloom real, SMAA/TAA. Só MSAA (`antialias: true`).
- Sem sombras projetadas.
- Satélite de uma data só, 22–30 m/pixel; prédios viram só cor.
- Modelo do submarino leve (`sx1-leve/alta.glb`, ~1 MB no total).
- Água sem refração, cáusticas ou absorção por profundidade; o perfil "Clara" é artificial.

Física: hidrodinâmica não calibrada, sem efeito de superfície livre, sem correntes e vento, ondas lineares (24 componentes), fundo simplificado.

## 3. Artefatos ao dar zoom out (água e terreno)

Relato: artefatos principalmente na água e no terreno com muito zoom out. Diagnóstico a partir do código (ainda **não reproduzido** com captura de tela):

1. **Precisão de profundidade (mais provável).**
   - Água: `transparent`, `depthWrite: false`, `renderOrder = 2`, sobre terreno opaco com "mar achatado" a −1,2 m.
   - Câmera: `near = 0,5` e `far = 30000`. Só o drone aumenta o `near` (`SubmarineScene.ts` ~1546–1556); as outras vistas ficam com razão far/near de 60 mil.
2. **Moiré / brilho piscando na água ao longe.** O shader (`Ocean.ts`) soma as ondas por pixel sem filtrar pela distância; o brilho do sol usa `pow(…, 700)`. MSAA não cobre isso.
3. **Emendas dos anéis do terreno** (`Terrain.ts`, classe `Ring`): resoluções diferentes, reconstrução por distância, textura de detalhe repetida a cada 80 m.
4. **Névoas desencontradas:** água a partir de 2500 m, terreno de 3000–5000 m até 14000–32000 m.

Plano de correção proposto (ordem):
1. `near` proporcional à distância/altura em todas as vistas (e opcionalmente `logarithmicDepthBuffer`).
2. Filtrar as ondas por pixel pela distância; especular com rugosidade.
3. Elevar a água sobre o mar achatado + `polygonOffset`.
4. Sobrepor os anéis do terreno e suavizar a textura de detalhe com a distância.
5. Alinhar as névoas.

Antes e depois: medir fps, chamadas de desenho e memória (Playwright) em superfície, submerso e sala de comando.

## 4. O que tornaria tudo mais realista

Visual (maior retorno primeiro):
1. **Sombras do sol** no casco, vela e água (hoje não há). É o maior sinal de "CG simples".
2. **Absorção de luz por profundidade** na água, por canal (vermelho some primeiro, depois verde), em vez de só cor de névoa.
3. **Reflexos por ambiente HDR/PMREM** e materiais PBR no casco (normal, rugosidade, desgaste, linha d'água, antiincrustante, riscos de ferrugem).
4. **Pós-processamento:** SSAO, bloom leve, SMAA/TAA, vinheta e tom ajustável.
5. **Mar espectral (FFT/Tessendorf)** no lugar de 24 componentes, com espuma persistente e esteira com espuma que dura.
6. **Céu físico** (Preetham/Hosek-Wilkie) com nuvens e halo do sol; raios de luz e cáusticas sob a água.
7. **Batimetria real** da Baía de Guanabara e de Sepetiba (hoje o fundo é uma função configurada).
8. **Satélite de maior resolução** e texturas de detalhe sem repetição visível.

Física/sistema: calibrar a hidrodinâmica, efeito de superfície livre nos tanques, correntes e vento na física, interação hélice–leme, sonar com propagação acústica real.

## 5. Sensação de grandeza ("bonito, mas não parece grande")

Hipótese do Bruno: tem a ver com a perspectiva. **Concordo, é uma das causas principais**, mas não a única.

O casco tem 70 m × 6,2 m (`defaultVessel.ts`). Causas prováveis:

1. **Câmera perto + grande-angular parece maquete.** A "Perspectiva profunda" (`deepPerspective.ts`) usa FOV de 65°/78°/92° com a câmera aproximada (dolly-zoom). Isso exagera a diferença de tamanho entre perto e longe, e o cérebro lê como brinquedo. Objetos grandes são filmados de longe com lente longa (FOV 25–40°).
2. **Falta de referência humana.** Não há pessoas na vela, escotilhas com escada, corrimãos, cabos, ferragens. Sem objeto de tamanho conhecido, o casco pode ter 7 m ou 70 m.
3. **Ondas e espuma fora de escala.** Se o comprimento de onda e o tamanho da espuma e dos respingos não forem proporcionais ao casco, a escala se perde. Ondas de 1–3 m perto de um casco de 70 m devem passar por cima e por baixo da linha d'água de modo visível.
4. **Sem perspectiva atmosférica.** A névoa só começa em 3000–5000 m, então o que está a 500 m–2 km tem o mesmo contraste e saturação do que está perto. A distância não "esfria" a imagem.
5. **Sem sombras.** Sem sombra do casco na água nem da vela no convés, falta o sinal de contato e volume.
6. **Sem profundidade de campo.** Pouca profundidade de campo dá o efeito "tilt-shift" de miniatura; o contrário (tudo nítido de perto e longe sem desfoque gradual nem névoa) também tira a leitura de distância. Um desfoque leve e variável ajuda mais a perspectiva do que o contrário.
7. **Esteira e velocidade.** Esteira, espuma e onda de proa que não aumentam em escala com a velocidade fazem 10 nós parecerem lentos. A esteira de um casco de 70 m é longa (centenas de metros) e persistente.
8. **Terreno com textura repetida a 80 m** quebra a noção de extensão.

Mudanças propostas (a testar com capturas):
- Vistas "heróis" com FOV ~30–40° e câmera mais afastada; deixar a perspectiva profunda para quando o usuário pedir.
- Referências: figuras humanas na vela e no convés, escotilhas, corrimãos, boias, um navio de porte conhecido ao fundo.
- Névoa/perspectiva atmosférica em escala de quilômetros, com cor do ar que muda com a hora.
- Sombras e contato água–casco.
- Esteira longa e persistente, escalada pela velocidade e pelo comprimento do casco.
- Escala de ondas e espuma consistente com o casco.
- Opcional: desfoque leve e variável fora do foco, com cuidado para não virar efeito de maquete.

## 6. Próximos passos (a confirmar com o Bruno)

1. Medir e reproduzir os artefatos (Playwright) em superfície, submerso e zoom out máximo.
2. Corrigir os itens 1–3 da seção 3 e comparar antes/depois.
3. Experimentar FOV menor e névoa atmosférica nas vistas externas.
4. Sombras do sol e pós-processamento com perfil de qualidade.
5. Mover a física para um Web Worker.
6. Avaliar `WebGPURenderer`.

## 7. Terreno e base naval: dados abertos (Rio e Sepetiba)

Foco: **Sepetiba/Itaguaí e Rio**. Regra: só dados **públicos e gratuitos**; nada que precise ser comprado, e nada de imagem comercial (Google, Bing, Maxar, Planet), cujos termos proíbem reutilização. Nenhum dado novo foi baixado ou incluído no projeto ainda.

Resolução atual (perfil alto): malha do terreno 20 m (anel próximo, 6 km), 60 m (médio, 24 km), 233 m (distante, 70 km); costa ~50 m (OpenStreetMap); relevo fino 200 m; estaleiro traçado sobre Sentinel-2 de 10 m (±10 m).

### Rio de Janeiro
- **Mosaico de trueortofotos 2024, IPP/Prefeitura do Rio** — RGB, 15 cm, 1º semestre de 2024, servido por ArcGIS ImageServer (`pgeo3.rio.rj.gov.br/.../Imagens/Mosaico_2024/ImageServer`). É, de longe, o melhor candidato: resolução ~70× melhor que a atual.
  - **Licença NÃO confirmada.** Uma busca indicou o campo de licença em branco; outra indicou CC BY 4.0. O host é bloqueado neste ambiente, então não consegui abrir a página. **Pendente: o Bruno abrir o item e ler a licença, ou perguntar ao IPP.**
  - Os termos da camada de edificações do IPP dizem: uso livre citando a fonte (IPP/Prefeitura do Rio); um geógrafo do IPP confirmou CC BY 4.0 para essa camada (isso é sobre edificações, não sobre ortofoto).
  - Portal: DATA.RIO (gerido pelo IPP).
- **Edificações do IPP** (importadas no OpenStreetMap): úteis para modelar prédios em 3D com crédito ao IPP.
- **LiDAR/MDT/MDS do Rio:** não encontrei página de download. Só um termo de referência do IPP (2016) prevê voo de 10 cm e perfilamento laser em 262 km². **Pendente: perguntar ao IPP se os produtos foram publicados.** (São Paulo publica MDT/MDS em LAZ; o Rio não apareceu.)

### Sepetiba / Itaguaí
- Não encontrei ortofoto nem LiDAR abertos de Itaguaí ou da Baía de Sepetiba (INEA, estado, IBGE). **Pendente: checar o geoportal do INEA, IBGE e o portal de dados do estado do RJ.** A busca devolveu apenas "Itagüí", da Colômbia (não confundir).
- Hoje o mais provável é continuar com Sentinel-2 (10 m), OpenStreetMap e modelagem própria do estaleiro.

### Batimetria
- **Baía de Sepetiba:** o IBGE publica o *Atlas Mar – Batimetria da Baía de Sepetiba*, derivado da **carta náutica 1622 da Marinha** (3ª ed., 2003, 1:40.000), com serviço WMS (visualização). Dá para consultar como mapa; o uso dos valores como dado exige conferir a licença do IBGE e da Marinha.
- **Baía de Guanabara:** nenhum download aberto encontrado.
- GEBCO/EMODnet: cobertura de águas brasileiras costeiras não confirmada; a GEBCO é grossa demais para as baías de qualquer modo.

### O que dá para fazer SEM novos dados (só técnica)
- Textura de detalhe procedural sem repetição visível, mistura por tipo de solo (classes do OpenStreetMap/MapBiomas), sombras e oclusão ambiente no relevo.
- LOD contínuo (quadtree/clipmap) no lugar dos três anéis fixos.
- Estaleiro: pessoas, veículos, cabos, defensas, iluminação de cais; escala humana ajuda a sensação de grandeza.

### Cuidados
- O estaleiro é instalação sensível: usar apenas dados públicos; não usar plantas ou documentos internos.
- Imagens de 15 cm do Rio são enormes: carregar por tiles, só perto da câmera, e só nos perfis Alto/Ultra. Com licença confirmada, o site precisa mostrar o crédito.
- Se a licença for incerta, não incluir; perguntar ao IPP antes.

### Pendências para o Bruno
1. Abrir o item do Mosaico 2024 no DATA.RIO e confirmar a licença (ou escrever ao IPP).
2. Perguntar ao IPP se há MDT/LiDAR publicado.
3. Procurar ortofoto/LiDAR de Itaguaí no INEA/IBGE.

## 8. Melhorias gerais (além das seções 3 a 7)

- **Apresentação:** modo palco (tela limpa, atalhos, controle remoto pelo celular), câmera cinematográfica como ação do Estúdio, gravação de vídeo, estado completo salvo por etapa, PWA offline.
- **Física:** calibração com dados publicados (ex.: DARPA SUBOFF), superfície livre nos tanques, correntes e vento na física, interação hélice–leme e águas rasas, acústica com camada térmica, cenários de falha e emergência, regressão física por curvas de referência.
- **Desempenho/arquitetura:** física em Web Worker, telemetria de FPS, carregamento sob demanda (Rio, estaleiro, sala de comando), dividir `SubmarineScene.ts`.
- **Qualidade:** testes visuais automáticos, testes de interface, acessibilidade, internacionalização (inglês).
- **Conteúdo:** novos locais pelo pipeline de `scripts/rio`, tráfego com comportamento, modo instrutor, modo multiusuário em rede.

Ordem de prioridade: artefatos → escala de resolução/FPS → teste visual → sensação de escala → sombras e pós-processamento → Worker → terreno e estaleiro → palco, gravação e falhas.
