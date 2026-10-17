# Arquitetura e módulos

## Princípios

1. **Motor independente da interface.** `src/sim/` não importa React, DOM nem Three.js. Ele roda igual no navegador e no Node (testes).
2. **Estado físico central único.** `SimState` (`src/sim/core/state.ts`) é um objeto JSON com todo o estado dinâmico: corpo rígido, tanques, válvulas, bombas, energia, sensores, alarmes, registros e balanços. Salvar ou recuperar é serializar esse objeto junto com a configuração.
3. **Passo fixo determinístico.** `SimulationEngine.step()` avança `dt` (padrão de 0,02 s). O `SimRunner` converte tempo real × aceleração em número inteiro de passos, de modo que a sequência de passos não depende da taxa de quadros.
4. **Comandos como única entrada.** A interface envia `Command`s (`src/sim/commands.ts`), aplicados entre passos e registrados com o instante de simulação.
5. **Saídas derivadas recalculadas.** `SimOutputs` (forças por origem, massa, CG, momentos estáticos, flutuabilidade etc.) é recalculado a cada passo e não é salvo.

## Fluxo de um passo (`core/engine.ts`)

| # | Módulo | Arquivo | Lê | Escreve |
|---|---|---|---|---|
| 1 | Controle automático | `systems/autopilot.ts` | leituras de sensores | comandos dos lemes |
| 2 | Atuadores dos lemes | `systems/actuation.ts` | comandos, hidráulica | ângulos reais, consumo hidráulico |
| 3 | Mastro do snorkel | `systems/actuation.ts` | atitude, profundidade | tomada de ar disponível |
| 4 | Coletor de ar AP | `systems/hpAir.ts` | válvulas dos grupos | pressão do coletor |
| 5 | Tanques de lastro | `systems/ballast.ts` | pose, pressões, coletor | água/ar dos TLP, vazões |
| 6 | Compressor | `systems/hpAir.ts` | tomada de ar, energia | massa nas garrafas |
| 7 | Compensação, trim e banda | `systems/internalTanks.ts` | pose, pressão do mar, energia | massas de água, vazões, potência |
| 8 | Alagamento | `systems/actuation.ts` | pressão externa | água nos compartimentos |
| 9 | Planta hidráulica | `systems/actuation.ts` | consumo do passo, energia | pressão do acumulador |
| 10 | Propulsão | `systems/propulsion.ts` | velocidade, potência disponível | rotação, empuxo, torque, potência |
| 11 | Propriedades de massa | `physics/massProperties.ts` | todos os itens de peso | m, G, I |
| 12 | Corpo rígido 6-GL | `physics/dynamics.ts` | forças (hidrostática, hidrodinâmica, lemes, hélice, contato) | posição, atitude, velocidades |
| 13 | Saídas derivadas | `core/engine.ts` | estado | `SimOutputs` |
| 14 | Sensores e navegação | `systems/sensors.ts` | grandezas verdadeiras | leituras, posição estimada |
| 15 | Balanço elétrico | `systems/electrical.ts` | demandas de todas as cargas | SoC, tensão, geração, limite de propulsão |
| 16 | Alarmes | `systems/alarms.ts` | estado e saídas | alarmes ativos, registro |
| 17 | Balanços de verificação | `core/engine.ts` | registros (ledger) | erros de massa e energia |

Disponibilidade de energia e hidráulica: os consumidores usam o estado do barramento do passo anterior (atraso de 20 ms).

## Interligações (exemplos)

- **Suspiro aberto** → ar sai do TLP → água entra → **massa ↑** → (ρV − m) ↓ → aceleração vertical ↓ (6-GL).
- **Transferência de trim** → posição de G ↓ → momento de pesos → pitch de equilíbrio muda; a bomba consome energia proporcional a Δp·Q.
- **RPM ↑** → empuxo ↑ → velocidade ↑ → força nos lemes ∝ U² ↑ → resposta de rumo e profundidade mais rápida.
- **Perda de energia** → bombas param, motor sem torque, hidráulica perde pressão → lemes e válvulas imobilizados.
- **Diesel em operação** → combustível ↓ → água do mar entra no tanque compensado → massa ↑ → o submarino fica mais pesado.
- **Termoclina** → ρ aumenta com a profundidade → empuxo ↑ → o submarino "assenta" na camada.
- **Profundidade** → pressão ↑ → casco comprime (V ↓) → ar de um TLP parcialmente soprado comprime → empuxo ↓.

## Interface (`src/ui`)

- `store.ts`: instância única de `SimRunner` e hook `useSim(hz)`, que re-renderiza na taxa indicada e a cada comando.
- `main.tsx`: laço `requestAnimationFrame` → `runner.frame(dt_real)` + demonstração automática.
- `screens/`: a tela de pilotagem, as 7 telas principais e as telas complementares.
- `maneuvers.ts`: manobras rápidas (sequências de comandos condicionadas ao estado físico).
- `components/`: instrumentos SVG (fita de profundidade, rosa, atitude, mostradores, barras de ângulo), gráfico em canvas com cursor sincronizado, diagramas esquemáticos, decomposição de forças.
- `inspector/`: conteúdo do modo engenharia (função, variáveis, equações, previsões) para cada componente.
- `render3d/SubmarineScene.ts`: cena Three.js que apenas **lê** o estado, com interpolação de pose entre passos e origem flutuante.

## Como adicionar um sistema (ex.: atmosfera interna, Fase 3)

1. Declarar parâmetros em `config/types.ts` e valores fictícios em `config/defaultVessel.ts`.
2. Acrescentar o estado em `core/state.ts` e a inicialização em `core/initialState.ts`.
3. Criar `systems/atmosfera.ts` com `update(cfg, state, ctx)`, que lê o que precisa (snorkel, energia) e escreve seu estado.
4. Chamar o módulo em `SimulationEngine.step()` na posição adequada. Se ele consumir energia, registrar a carga no mapa `demands`; se alterar massa, incluir o item em `computeMassProps` e no balanço (ledger).
5. Opcional: comandos em `commands.ts`, alarmes em `systems/alarms.ts`, canais em `history.ts`, painel na interface e caso em `validation/suite.ts`.

## Desempenho

Um passo custa cerca de 7 avaliações hidrostáticas (RK4 + saídas + rigidezes) de 100 fatias e 4 resoluções implícitas dos TLP. No Node, o motor roda a cerca de 7 000 passos/s, o que permite aceleração de ×20 (1 000 passos/s) com folga. Se a CPU não acompanhar, o executor descarta o excesso de tempo e sinaliza "tempo reduzido", sem perder estabilidade.
