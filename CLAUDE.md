# CLAUDE.md — Simulador de submarino SX-1

Guia rápido para quem for trabalhar no projeto (lido automaticamente pelo Claude Code).
Objetivo: ir direto aos arquivos certos sem reler o projeto inteiro.

## O que é
Simulador técnico de um submarino convencional fictício (SX-1): física 6-DOF, lastro,
compensação, trim/banda, ar comprimido, energia, piloto automático, cena 3D e telas de
operação. Feito para **apresentações** conduzidas pelo usuário (Bruno). Interface e
documentação em **português do Brasil**.

- Site: https://brunoalmeida87.github.io/Simulator_Sub/
- Stack: React 18 + TypeScript + Vite, Three.js (3D), Leaflet (mapa), Vitest (testes).

## Comandos
- `npm run dev` — servidor local
- `npm test` — testes (validação física + apresentação), ~20 s
- `npm run build` — typecheck + build de produção
- `npm run typecheck`
- Formatação: Prettier com `--single-quote --print-width 220` (não usar o padrão de aspas duplas).

## Fluxo de trabalho (git)
- Branch principal: **`main`**. A publicação no GitHub Pages roda a cada push na `main`
  (`.github/workflows/deploy.yml`: testes → build → branch `gh-pages`).
- Cada conversa trabalha na sua própria branch, criada a partir da `main`.
- **"Publicar"** = rodar testes e build, push da branch da conversa, abrir PR para `main`
  e fazer o merge quando a verificação do PR passar. O site atualiza em ~2 min.
- Antes de começar, traga a `main` atualizada (`git fetch origin main` e merge), porque outras conversas podem ter publicado.

## Mapa do código
```
src/sim/              FÍSICA (não depende de UI nem de 3D)
  core/engine.ts      motor de passo fixo (dt 0,02 s, RK4, referencial NED)
  core/runner.ts      SimRunner: acumulador de tempo real × aceleração
  core/state.ts       tipos do estado; initialState.ts
  config/defaultVessel.ts  TODOS os parâmetros do navio (casco, tanques, lemes, peso móvel…)
  physics/            hidrostática, hidrodinâmica (finForce), dinâmica (computeForces), massas
  systems/            lastro, tanques internos, ar AP, elétrica, propulsão, piloto, alarmes, sensores
                      compensationNetwork.ts (vazão por trecho do circuito), exhaust.ts (descarga dos geradores)
  environment/        água do mar, ondas
  commands.ts         ÚNICA via para alterar a simulação (tipo Command + applyCommand)
  scenarios.ts        cenários iniciais (SCENARIOS)
  forceVectors.ts     vetores de força para exibição (peso/empuxo/resultante, hélice, lemes, trim)
  geo.ts              lat/lon ↔ NED, contatos fictícios (Sepetiba e Rio), CPA (mapa tático)
  environment/coast.ts  costa física por regiões (Sepetiba: coastData.ts; Rio: coastDataRio.ts, gerado por scripts/rio)
  traffic.ts          navios adicionais (quantidade em Gráficos), validados contra o fundo simulado
  validation/suite.ts testes de validação física V01…
src/render3d/         CENA 3D (só LÊ o estado; nunca altera a física)
  SubmarineScene.ts   cena principal: casco, lemes, câmeras, pick(), modo sem água
  subModel.ts         modelo .glb do SX-1 (public/models/sx1-leve|alta.glb): nomes fixos das peças (SUB_PARTS),
                      SubModelRig liga lemes/hélice/mastros ao estado; sem o arquivo fica o casco gerado (reserva)
  pressureHull.ts     casco resistente (raio interno 2,9 m, anteparas antes dos TLP): o corte (Systems.ts) e o interior do Blender
                      ficam dentro dele; teste tests/systemsLayout.test.ts
  (interior)          public/models/sx1-interior.glb: tanques/tubos/válvulas do corte modelados no Blender (ainda não usado;
                      scripts/blender/build_sx1_interior.py + exportar_interior.ts; teste tests/subInterior.test.ts)
  subEnvironment.ts   reflexo do céu só no submarino (.glb): mapa de ambiente com as cores da cena (dia/noite/submerso)
  renderPerf.ts       escala de resolução (fixa ou automática, AdaptiveScale), FrameMeter e contadores do renderizador;
                      as duas cenas (SubmarineScene, ControlRoomScene) têm setRenderScale()/renderStats(); UI: components/FpsMeter.tsx
  layers.ts           SceneLayers: flags de camadas (vetores, tanques, escoamentos, vento, noWater, hiddenVectors…)
                      + LAYER_INFO (catálogo/nomes), LAYER_GROUPS (grupos do painel), allLayersOn/Off,
                      fullExternalLayers (o "3D completo" da 2ª janela)
  DepthRefs.ts        referências discretas de profundidade (faixas de partículas, sombra no fundo)
  DepthLines.ts       linhas de profundidade a cada 25 m com a cota (camada depthLines), até o fundo
  Terrain.ts          fundo e terra (mesma função da física) + imagem de satélite e luzes da cidade (terrainAssets.ts)
  RioLandmarks.ts     Cristo Redentor, Ponte Rio–Niterói e nomes dos lugares do Rio
  Shipyard.ts         estaleiro de Itaguaí (aterro, molhes, shiplift, galpões, submarinos atracados)
  deepPerspective.ts  perspectiva profunda (botão nas cenas 3D): grande-angular + câmera aproximada na mesma proporção
                      (dolly-zoom) nas vistas de 3ª pessoa; graphics.deepPersp/deepLevel; seção na fileira (SeaControls)
  daylight.ts         sol pela hora do dia, cores do céu/névoa/água, noite (cúpula, estrelas, lua, luar)
  NavLights.ts        luzes de navegação (setores do RIPEAM) do submarino e dos navios; faróis do submarino
  CargoVis.ts         cargas deslocáveis a bordo (torpedos, tripulantes, mantimentos; mass.shiftLoads / comando shiftLoad)
  PitchAngle.ts       camada pitchAngle: horizontal × eixo do casco, arco graduado e θ
  Ensign.ts           camada flag: bandeira no mastro da vela, tremulando com o vento aparente (some ao submergir)
  ForceArrows.ts, TrimVis.ts, Systems.ts (tubulações/escoamentos), SurfaceFx.ts (esteira, aspiração do snorkel),
                      WindFx.ts (vento aparente: faixas e flâmula), Markers.ts, Ocean.ts
  controlRoom/        SALA DE COMANDO em 1ª pessoa: ControlRoomScene (sala, câmera, colisão, seleção),
                      panel.ts (canvas + regiões clicáveis), panels*.ts (telas/faces por posto), furniture/textures,
                      stations.ts (postos e enquadramentos), actions.ts (RoomActions: a cena só monta Commands),
                      periscope.ts (óptica do periscópio: horizonte, contatos à vista, estadímetro)
src/ui/               INTERFACE (React)
  App.tsx             barra superior, telas (screens) e atalhos de teclado
  nav.ts              NAVEGAÇÃO: SCREEN_IDS/ScreenId, grupos NAV_GROUPS (grupo → telas, teclas 0–8), marcas de alarme
                      (tela nova = id em SCREEN_IDS + entrada num grupo + componente em App.tsx; Sala de comando sempre a última)
  VisualApp.tsx       segunda janela (só visual) — modo dois monitores
  sync.ts             BroadcastChannel 'sx1-sync-v1' entre janelas (mestre envia estado a 30 Hz); janela de tela
                      (#tela=N, "＋ Tela"): App completo espelhado, runner remoto (comandos/executar/cenário vão ao mestre)
  mirror.ts           janela de tela: espelho das automações (manobra, roteiro, demo, rota, checklist) e ações remotas
  screens/            uma tela por aba (Pilot, View3D, Presentation, TacticalMap, EnergyFlow, Ballast, ControlRoom…)
                      SystemsOverview (Sistemas › Visão geral: cartões por sistema)
                      sala: RoomPip (submarino 3D em PiP), RoomPeriscope (visada), periMarks, roomAudio (som e 1MC)
  ops/                central de operação da Pilotagem (grupos expansíveis, faixa inferior, opsBus)
  components/         controles, seletores (TankSelector, VectorSelector, LayerPanel, LightPanel = Sol e luzes), gráficos, Scene3D
  graphics.ts         preferências gráficas (qualidade, iluminação, sol e luzes…), salvas e enviadas à 2ª janela,
                      NavBar (navegação em dois níveis; no celular, grupo ▾ + telas)
  inspector/          modo engenharia (registry.ts = textos e variáveis por componente)
  maneuvers.ts        manobras rápidas (Imergir/Emergir)
  tours.ts            cenários guiados automáticos passo a passo (TOURS)
  presBuilder/        ESTÚDIO DE APRESENTAÇÕES (aba Apresentação › Estúdio): model.ts (etapas em JSON), variables.ts
                      (valores ao vivo/condições), actions.ts (catálogo de ações → Commands), player.ts (execução, voltar,
                      avanço acelerado), library.ts (localStorage, importar/exportar), templates.ts (modelos), richText.ts
                      tela: screens/StudioScreen.tsx; cartão: components/PresCard.tsx (palco, PresFloating e 2ª janela)
  demo.ts, presentation.ts, checklist.ts, routeNav.ts
  persist.ts          usePersisted: preferências de UI no localStorage (prefixo 'sx1.ui.')
scripts/rio/          preparação dos dados do Rio (Copernicus DEM, Sentinel-2) — reprodutível
tests/                validation.test.ts, presentation.test.ts, units.test.ts
docs/                 OPERACAO, ARQUITETURA, EQUACOES, PARAMETROS, LIMITACOES, VALIDACAO
```

## Regras do projeto
- **Física separada da exibição.** Tudo o que aparece (vetores, escoamentos, tanques, fumaça)
  vem do estado calculado. Nada visual pode alterar a física.
- **Comandos registrados.** Mudanças no estado passam por `applyCommand` (aparecem no histórico).
- **Não alterar cenários existentes** (`SCENARIOS`, `TOURS`) ao criar novos — acrescentar.
- **Duas janelas:** toda camada/flag nova do 3D precisa chegar à segunda janela
  (`VisualApp.tsx` + `sync.ts`). Já houve erro de vetores/tanques sumindo nela.
- **Janela de tela (＋ Tela):** roda o `App` sem física. Alterações têm de passar por `runner.command`/`cmd`,
  `runner.running`/`timeScale`/`stepOnce`/`replaceEngine` ou por métodos de automação listados em `mirror.ts`
  (novos métodos de tours/maneuver/demo/route/checklist chamados pela UI precisam entrar lá). Mexer direto em
  `runner.engine` (ex.: `applyCommand(runner.engine, …)`) só altera a cópia local da tela.
- **Camadas novas:** adicionar em `layers.ts` (com valor padrão, entrada em `LAYER_INFO` e num grupo de `LAYER_GROUPS`), tratar em
  `SubmarineScene.ts` e expor nas telas (View3D/Pilot/Helm `*_LAYER_KEYS`, Presentation `LAYER_LIST`,
  VisualApp `LAYER_KEYS`). Toda camada precisa poder ser desligada ("Desmarcar todas").
- **Preferências de visualização** persistem entre abas com `usePersisted`.
- **Celular:** a interface precisa funcionar em tela estreita (sem rolagem horizontal).
- Mapas: só fontes **gratuitas sem chave de API** (OpenStreetMap, OpenTopoMap, EOX, OpenSeaMap).
- **Sala de comando:** botão novo num painel = região registrada no desenho (`button`/`lampButton` em `draw.ts`) que chama
  `act.cmd(...)`; o teste `tests/controlRoom.test.ts` executa todas as regiões e confere os comandos. Telas pesadas: manter
  o redesenho por `hz` e o orçamento por quadro do `ControlRoomScene.render()`.
- Ao mudar parâmetros físicos, conferir `npm test` e atualizar `docs/PARAMETROS.md`.
- Ao criar funções visíveis ao usuário, atualizar `docs/OPERACAO.md` (e o README se for recurso novo).

## Verificação visual
Chromium + Playwright estão disponíveis no ambiente de nuvem. Para conferir uma tela:
`npm run build && npx vite preview`, depois um script Playwright que abre a aba e tira print.
Cuidado com nomes de botão parecidos nos seletores (ex.: "Preparar" casa com "PARAR").
