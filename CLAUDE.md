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
  geo.ts              lat/lon ↔ NED, contatos fictícios, CPA (mapa tático)
  traffic.ts          navios adicionais (quantidade em Gráficos), validados contra o fundo simulado
  validation/suite.ts testes de validação física V01…
src/render3d/         CENA 3D (só LÊ o estado; nunca altera a física)
  SubmarineScene.ts   cena principal: casco, lemes, câmeras, pick(), modo sem água
  layers.ts           SceneLayers: flags de camadas (vetores, tanques, escoamentos, vento, noWater, hiddenVectors…)
                      + LAYER_INFO (catálogo/nomes), LAYER_GROUPS (grupos do painel), allLayersOn/Off,
                      fullExternalLayers (o "3D completo" da 2ª janela)
  DepthRefs.ts        referências discretas de profundidade (faixas de partículas, sombra no fundo)
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
  sync.ts             BroadcastChannel 'sx1-sync-v1' entre janelas (mestre envia estado a 30 Hz)
  screens/            uma tela por aba (Pilot, View3D, Presentation, TacticalMap, EnergyFlow, Ballast, ControlRoom…)
                      SystemsOverview (Sistemas › Visão geral: cartões por sistema)
                      sala: RoomPip (submarino 3D em PiP), RoomPeriscope (visada), periMarks, roomAudio (som e 1MC)
  ops/                central de operação da Pilotagem (grupos expansíveis, faixa inferior, opsBus)
  components/         controles, seletores (TankSelector, VectorSelector, LayerPanel), gráficos, Scene3D,
                      NavBar (navegação em dois níveis; no celular, grupo ▾ + telas)
  inspector/          modo engenharia (registry.ts = textos e variáveis por componente)
  maneuvers.ts        manobras rápidas (Imergir/Emergir)
  tours.ts            cenários guiados automáticos passo a passo (TOURS)
  demo.ts, presentation.ts, checklist.ts, routeNav.ts
  persist.ts          usePersisted: preferências de UI no localStorage (prefixo 'sx1.ui.')
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
