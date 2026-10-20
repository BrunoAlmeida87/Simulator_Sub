# SX-1 · Simulador Técnico de Submarino

Plataforma de **simulação de engenharia e treinamento conceitual** de um submarino convencional diesel-elétrico **fictício** ("SX-1 Marlim"), executada no navegador ou como aplicativo desktop com Electron.

Não é um jogo: todas as respostas visuais vêm de um **motor físico independente** com estado central compartilhado. Abrir um suspiro libera ar por um orifício compressível, a água entra pelos embornais, a massa aumenta, o empuxo líquido muda e o casco 6-GL responde. Nenhuma animação simula um efeito por conta própria.

**▶ Simulador publicado:** https://brunoalmeida87.github.io/Simulator_Sub/

> A embarcação e todos os parâmetros são fictícios, com ordem de grandeza pública e referência conceitual a submarinos convencionais modernos. Não há dados operacionais restritos, documentação proprietária nem valores não públicos. Os limites e as respostas de segurança servem apenas para fins educacionais.

---

## Sumário

- [O que a Fase 1 entrega](#o-que-a-fase-1-entrega)
- [Instalação e execução](#instalação-e-execução)
- [Executável para Windows (Electron)](#executável-para-windows-electron)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Arquitetura](#arquitetura)
- [Telas](#telas)
- [Operação rápida](#operação-rápida)
- [Testes e validação](#testes-e-validação)
- [Documentação técnica](#documentação-técnica)
- [Simplificações e limitações](#simplificações-e-limitações)
- [Roteiro (Fases 2 e 3)](#roteiro-fases-2-e-3)

---

## O que a Fase 1 entrega

| Item da Fase 1 | Situação |
|---|---|
| Modelo físico de flutuabilidade e movimento | ✅ **6 graus de liberdade** completos (surge, sway, heave, roll, pitch, yaw), integração RK4, quatérnios |
| Lastro principal | ✅ 4 TLP com suspiro, sopro, embornais, ar AP, transitórios e limites de vazão |
| Compensação e trim | ✅ Circuitos fictícios com bombas, válvulas, sequência automática de dosagem e cálculo de compensação |
| Propulsão | ✅ Motor elétrico, eixo, hélice de 4 quadrantes, rampa de rotação, limites de torque e potência |
| Lemes de direção e de profundidade | ✅ Lemes de vante na vela, lemes de ré e direção totalmente móveis (sem estabilizadores fixos), atuadores limitados em velocidade; força proporcional a U² e estol |
| Indicadores | ✅ Profundidade, rumo, velocidade, pitch, banda e muitos outros, classificados como MED, CALC ou CMD |
| Modelo 3D animado | ✅ Three.js com corte dos tanques (TLP em seção "D" que acompanha o casco), tubulações, válvulas, bombas e escoamentos animados pelas vazões simuladas; hélice, lemes, bolhas e fundo |
| Vetores de força | ✅ Peso (em G), empuxo (em B) e resultante E − P com ampliação declarada; empuxo do hélice, resistência da água e forças dos lemes — valores do último passo do motor |
| Percepção de movimento | ✅ Esteira persistente fixa no mundo, onda de proa e braços de Kelvin (∝ U²), rastro do hélice (∝ empuxo), jato de ar dos suspiros, boias e marcadores de distância, câmera fixa |
| Cenários guiados | ✅ Roteiros automáticos e narrados, etapa por etapa (primeiro: "Submergir e descer para 50 m"), com valores ao vivo, câmera e camadas por etapa e tempo de leitura |
| Trimagem demonstrável | ✅ Peso deslocável de 5 t sobre trilho, compensação calculada pelos tanques de trim e camada própria de vetores de trim (binários e momento líquido) |
| Central de operação | ✅ Pilotagem com a cena sempre visível, comandos essenciais fixos, 9 grupos de sistemas expansíveis com resumo, até 2 grupos fixados e controles abertos ao clicar em tanques, lemes, hélice, mastro, bateria, válvulas ou alarmes |
| Duas janelas | ✅ "⧉ 2ª janela": a cena numa segunda janela/monitor, espelhando a mesma simulação (BroadcastChannel); cliques nela abrem os controles na janela principal |
| Mapa tático | ✅ Posição geográfica (Baía de Sepetiba, EBN da Ilha da Madeira, Itaguaí), derrota, vetor de velocidade, navegação estimada, contatos fictícios com CPA, rota por pontos de passagem com seguimento automático e medição; fundos gratuitos sem chave de API (OpenStreetMap, OpenTopoMap, Sentinel-2/EOX, OpenSeaMap) |
| Fluxo de energia | ✅ Diagrama animado (largura ∝ potência): geradores → barramento → bateria/consumidores; carga e descarga com tempo estimado |
| Modo apresentação | ✅ Cena, tanques, forças e indicadores na mesma tela; situações prontas, câmera lenta, estado inicial, antes × agora, camadas independentes e etapas das manobras automáticas |
| Oceano realista + ondas físicas | ✅ Oceano em shader (reflexo do céu, brilho do sol, espuma, cáusticas, janela de Snell vista de baixo) com as mesmas ondas que movem o submarino; estado do mar 0–6, qualidade gráfica e iluminação (natural, clara, estúdio) ajustáveis |
| Interface e controles | ✅ 7 telas, mais cenários, auxiliares, validação, guia e modo engenharia; executar, pausar, passo, reiniciar e acelerar |
| Configurações | ✅ Aba própria com sessões, gravações, identificação, gráficos, ambiente, fundo, simulação e embarcação; cada grupo indica se é VISUAL, se muda a física AGORA ou se exige REINICIAR |
| Salvar e continuar | ✅ Sessão completa (estado físico, automações em andamento, aceleração, identificação, posição geográfica) em arquivo compartilhável; carrega pausado; arquivos antigos abrem com conversão |
| Gravação e reprodução | ✅ Comandos estruturados (operador e automações) com passo fixo e tempo; reprodução exata a partir do estado inicial gravado, com pontos de controle e automações sem duplicar |
| Identificação | ✅ “S50 Vasco da Gama”: emblema na vela (estilizado ou imagem própria), inscrição vermelha configurável, cor dos lemes, snorkel destacado, texturas detalhadas (placas anecoicas, lemes perfilados, hélice de 7 pás) |
| Trim na superfície | ✅ Investigação documentada (física correta: ~130× mais rígido que submerso); marcas de calado, leitura de calados AV/AR, vista Calado e ampliação opcional identificada |
| Painel de governo | ✅ Aba Governo: manche (leme + lemes de ré), alavanca dos lemes de vante, telégrafo em alavanca, piloto com botões giratórios; mouse e toque; comandado × real |
| Fluxo de energia e propulsão | ✅ Equipamentos clicáveis com estados e comandos; diagrama motor → eixo → hélice com rotação, sentido, torque, potência e empuxo |
| Navios e costa no 3D | ✅ Contatos da mesa tática como navios 3D na mesma posição; costa de Sepetiba embutida (offline) com terra, orla, fundo costeiro na física e cais modelado |

**Antecipados das Fases 2 e 3** (funcionais, mas simplificados): banda por tanques laterais, balanço de energia com bateria, diesel-geradores, combustível compensado e compressor; sensores com ruído, atraso e falhas; alarmes com prioridade e registro; gráficos históricos sincronizados; piloto automático PID; injeção de falhas (bombas, válvulas, sensores, energia, hidráulica, alagamento); termoclina; topografia do fundo.

Tudo o que ainda não foi implementado aparece na interface com a marca **FUTURO** (tela *Sistemas auxiliares* e *Guia → Roteiro*).

---

## Instalação e execução

Requisitos: **Node.js 22.12 ou superior** e npm. Recomendado: Node.js **24 LTS**.

```bash
git clone https://github.com/BrunoAlmeida87/Simulator_Sub.git
cd Simulator_Sub
npm install
npm run dev        # servidor de desenvolvimento → http://localhost:5173
```

| Comando | Função |
|---|---|
| `npm run dev` | Servidor de desenvolvimento com recarga automática |
| `npm run build` | Verificação de tipos (TypeScript) e build de produção em `dist/` |
| `npm run preview` | Serve o build de produção localmente |
| `npm test` | Testes automáticos: validação física, apresentação, sessão, fundo e costa, trim na superfície, gravação/reprodução, navios e unidades |
| `npm run report` | Executa a validação e gera `docs/VALIDACAO.md` |
| `npm run typecheck` | Somente verificação de tipos |

O build usa caminho base relativo (`base: './'`), então funciona em qualquer subcaminho, como o GitHub Pages. A publicação é automática pelo workflow `.github/workflows/deploy.yml`.

## Executável para Windows (Electron)

Instale o Node.js LTS, baixe e extraia o projeto e dê dois cliques em **GERAR-EXECUTAVEL.cmd**. Os arquivos serão criados em **release/**: um instalador e uma versão portátil para Windows 10/11 de 64 bits. O computador que recebe o executável não precisa de Node.js.

**[Passo a passo para iniciantes, com alternativa pelo GitHub →](docs/EXECUTAVEL-WINDOWS.md)**

| Comando | Função |
|---|---|
| `npm run desktop` | Compila o simulador e abre a janela do Electron |
| `npm run dist:win` | Compila e gera instalador `.exe` e versão portátil `.exe` em `release/` |

A simulação, a cena 3D e a costa de Sepetiba (dados embutidos) funcionam offline; os fundos do mapa tático dependem de internet (sem ela o mapa mostra a grade e a costa do simulador). O aplicativo mantém a visualização em segunda janela e a exportação/importação de estados. Os executáveis são gerados sem assinatura digital.

---

## Estrutura de pastas

```
├── index.html
├── src/
│   ├── main.tsx                  # laço principal (requestAnimationFrame → passos fixos)
│   ├── sim/                      # MOTOR DE SIMULAÇÃO — sem DOM, React ou Three.js
│   │   ├── core/                 # matemática, estado central, motor, executor, contexto
│   │   ├── config/               # tipos de configuração + embarcação fictícia padrão
│   │   ├── environment/          # EOS-80 (água do mar), perfis T/S, pressão, fundo
│   │   ├── physics/              # geometria do casco, hidrostática, hidrodinâmica, 6-GL, massas
│   │   ├── systems/              # lastro, ar AP, compensação/trim/banda, propulsão, energia,
│   │   │                         # atuação, piloto automático, sensores, alarmes
│   │   ├── validation/suite.ts   # cenários de validação com métricas numéricas
│   │   ├── commands.ts           # API de comandos + catálogo de falhas
│   │   ├── scenarios.ts          # cenários de treinamento
│   │   ├── equilibrium.ts        # cálculo de compensação e equilíbrio na superfície
│   │   ├── history.ts            # registro histórico (buffers circulares)
│   │   └── persistence.ts        # salvar/recuperar estado completo (JSON)
│   ├── render3d/SubmarineScene.ts # visualização 3D (somente leitura do estado)
│   ├── ui/                       # React: telas, instrumentos SVG/canvas, modo engenharia
│   └── styles/global.css
├── tests/                        # Vitest: validação física e testes unitários
├── scripts/report.ts             # gera docs/VALIDACAO.md
└── docs/                         # documentação técnica
```

---

## Arquitetura

```
 Interface (React) ──comandos──▶ SimRunner ──passos fixos dt──▶ SimulationEngine
       ▲                                                           │
       └──────── leitura do estado (10–15 Hz) ◀────── SimState (JSON) + saídas derivadas
 Visualização 3D ◀──── leitura a cada quadro (interpolação entre passos) ─┘
```

- **Estado físico central único** (`SimState`, serializável): todos os módulos leem e escrevem nele.
- **Passo fixo** (padrão de 0,02 s): o acumulador de tempo real × aceleração define quantos passos rodam por quadro. A física é a mesma em ×1 ou ×20, o que o teste V08 confirma.
- **Ordem de cada passo:** controle automático → atuadores → ar AP e lastro → compensação, trim, banda e alagamento → hidráulica → propulsão → propriedades de massa → corpo rígido 6-GL (RK4) → sensores → balanço elétrico → alarmes e balanços de massa e energia.
- **Comandos:** a interface nunca altera o estado diretamente. Ela envia comandos tipados, que ficam registrados com o instante de simulação.
- **Extensibilidade:** um novo sistema é um módulo que lê e escreve no estado, declara cargas elétricas, consumos e massas e entra na sequência do passo. Detalhes em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

---

## Telas

- **Apresentação:** tela para conduzir demonstrações. Reúne a cena 3D, os vetores de peso, empuxo e resultante, os tanques (clique para destacar um), os comandos de lastro, compensação, trim, banda e máquinas, e os indicadores físicos. Tem situações prontas, pausa, câmera lenta (×0,25), +0,1 s, retorno ao estado inicial, comparação "antes × agora", enquadramentos rápidos (superfície, submerso, tanques, forças, fixa) e camadas que podem ser ligadas separadamente (vetores, tanques, tubulações, escoamentos, identificações, esteira, boias, iluminação).

0. **Pilotagem (tela inicial) — central de operação:** cena 3D sempre visível, faixa de indicadores, comandos essenciais e grupos expansíveis de todos os sistemas (ver docs/OPERACAO.md). Antes era: o submarino em 3D numa vista lateral que acompanha o casco, com os comandos ao lado (telégrafo, lemes, lastro, piloto automático e as manobras rápidas "Imergir para X m", "Emergir" e "Manter profundidade"). Você vê o submarino avançar, alagar os tanques, mergulhar, nivelar e emergir conforme opera os comandos. As referências de movimento (partículas em suspensão, esteira na superfície, bolhas e fita de profundidade) também vêm do estado físico.
1. **Central de comando:** fita de profundidade, rosa de rumo, indicador de atitude, velocidade e RPM, lemes (comandado × real), telégrafo, piloto automático, perfil vertical da situação e o painel *"Por que está subindo ou descendo?"*.
2. **Lastro e compensação:** diagrama interativo (TLP, garrafas AP, coletor, circuito de compensação), tabela dos tanques, sequência automática de dosagem e cálculo de compensação.
3. **Trim e banda:** distribuição longitudinal de massas, G e B, pitch estático × dinâmico, vista frontal, transferências com previsão do ângulo resultante e decomposição de momentos.
4. **Propulsão e energia:** motor, hélice (J, η₀, empuxo × resistência), bateria, cargas por consumidor, diesel-geradores e snorkel.
5. **Segurança:** alarmes com prioridade e reconhecimento, registro cronológico, sensores redundantes e injeção de falhas.
6. **Visualização 3D:** câmeras lateral, perseguição, perspectiva, perfil, frente, topo, fixa, livre e os enquadramentos de apresentação; corte com níveis reais dos tanques, tubulações e escoamentos; vetores de força; boias; trajetória; bolhas proporcionais à vazão de ar.
7. **Histórico:** gráficos sincronizados (grandezas de unidades diferentes em eixos separados, à esquerda e à direita), marcas dos comandos, comparação antes × depois e exportação em CSV.

Também há as telas **Governo** (painel visual de governo com manche, alavancas e instrumentos), **Cenários** (11 cenários e condições de carga), **⚙ Configurações** (sessões salvas e arquivos, gravação e reprodução de comandos, identificação, gráficos, ambiente, fundo e costa, parâmetros), **Sistemas auxiliares** (arquitetura prevista e estado), **Validação** (testes executados no navegador) e **Guia** (procedimento guiado com verificação automática e demonstração automática).

O **modo engenharia** (botão ⓘ ou tecla `I`) permite clicar em tanques, válvulas, bombas, lemes e instrumentos. O painel mostra a função do componente, as variáveis ao vivo, o estado, a influência na dinâmica, as equações, as consequências previstas e um gráfico antes × depois.

---

## Operação rápida

0. Mais simples: na tela **Pilotagem**, pressione **▶ Iniciar simulação** e use **⬇ Imergir para 50 m** ou **⬆ Emergir**, ou opere manualmente o telégrafo e os lemes.
1. **Cenários → "Superfície — pronto para imergir" → Iniciar**, depois ▶ **Executar**.
2. Telégrafo **AV MEIA** (75 rpm) e, quando passar de 4 nós, **Abrir suspiros**.
3. Com os TLP alagados, lemes de vante **10↓** até ~20 m. Em seguida, **Fechar suspiros**.
4. Piloto de profundidade **AUTO** com referência de 50 m. Na cota, **Executar ajuste calculado** da compensação.
5. Corrija o trim pela previsão da tela 3 e altere o rumo (piloto de rumo ou leme).
6. Para emergir: referência de 14 m, depois **Soprar TLP** e lemes **SUBIR**. Feche o sopro quando os tanques esvaziarem.

O mesmo roteiro está no **Guia → Demonstração automática**. Detalhes em [docs/OPERACAO.md](docs/OPERACAO.md).

Atalhos: `Espaço` executar/pausar · `A`/`D` leme de direção · `W`/`S` lemes de ré · `Q`/`E` lemes de vante · `+`/`−` telégrafo · `1`–`7` telas · `I` modo engenharia.

---

## Testes e validação

`npm test` executa **28 testes**. Os 12 casos de validação física produzem **métricas numéricas** verificáveis:

| # | Verificação | Exemplo de resultado |
|---|---|---|
| 1 | Resposta ao equilíbrio de flutuabilidade | 1,5 t admitida ⇒ −1 514 kg; afunda 30 m em 240 s; velocidade terminal dentro de ±15 % da prevista |
| 2 | Redistribuição longitudinal altera o trim | 1 t AV→AR ⇒ +2,870° (previsto 2,870°) |
| 3 | Redistribuição transversal altera a banda | 1 t BB→BE ⇒ +0,400° (previsto 0,400°) |
| 4 | Efetividade dos lemes × velocidade | força nula a U = 0; razão 100,0 entre 5 e 0,5 m/s (∝ U²) |
| 5 | Rumo responde ao leme | 15° BE ⇒ +27,4° em 60 s, progressivo e simétrico |
| 6 | Transitórios de bombas e válvulas | válvula a 50 % na metade do curso; TLP 12 % em 5 s e 99,9 % em 90 s |
| 7 | Coerência profundidade × pressão | 1,007 bar a cada 10 m; sensor = estado; ρ_cal documentada |
| 8 | Pausa, reinício, aceleração e salvamento | estados idênticos em ×1 e ×10; pausa não altera o estado; continuação idêntica após recuperar |
| 9 | Instrumentos consistentes | erro nulo sem ruído; RMS ≈ σ no modo avançado |
| 10 | Sem geração artificial de massa ou energia | erro de massa < 0,001 kg; balanço elétrico < 1 J; energia cinética passiva decrescente |
| + | EOS-80 e hidrostática | valores de verificação da UNESCO com erro < 0,001 kg/m³ |
| + | Sequência completa | superfície → 50 m → equilíbrio → guinada → trim → emersão em ~400 s |

Relatório completo: [docs/VALIDACAO.md](docs/VALIDACAO.md) (gerado por `npm run report`).

---

## Documentação técnica

- [docs/ARQUITETURA.md](docs/ARQUITETURA.md): módulos, estado, ciclo de passo, comandos e como estender
- [docs/EQUACOES.md](docs/EQUACOES.md): todas as equações implementadas
- [docs/PARAMETROS.md](docs/PARAMETROS.md): parâmetros fictícios da embarcação e do ambiente
- [docs/LIMITACOES.md](docs/LIMITACOES.md): simplificações e limitações
- [docs/OPERACAO.md](docs/OPERACAO.md): procedimentos de operação e cenários
- [docs/VALIDACAO.md](docs/VALIDACAO.md): relatório de validação

---

## Simplificações e limitações

Resumo (lista completa em [docs/LIMITACOES.md](docs/LIMITACOES.md)):

- Ondas lineares (Airy, Pierson–Moskowitz, 24 componentes) sem quebra nem correntes; o "chop" visual do oceano 3D não entra na física.
- Derivadas hidrodinâmicas por componentes (casco, escoamento cruzado, sustentação do casco, superfícies, Munk), sem dados de tanque de provas.
- CG tratado na origem para os termos inerciais; produtos de inércia desprezados; massa adicional diagonal.
- Ar dos tanques isotérmico; sem superfície livre nos tanques; água do mar homogênea ao longo do casco.
- Circuitos de fluidos fictícios e simplificados. Bateria com modelo de circuito equivalente linear.
- Limites estruturais, de profundidade e de segurança são fictícios e educacionais.

---

## Roteiro (Fases 2 e 3)

- **Fase 2:** navegação inercial com deriva, distribuição elétrica com disjuntores e rejeição de cargas, soprador de baixa pressão, mais sensores redundantes e cenários de falhas combinadas.
- **Fase 3:** ondas e correntes, sucção de superfície, superfície livre nos tanques, atmosfera interna (O₂/CO₂), refrigeração, esgoto, controle de avarias, hidrodinâmica refinada e WebAssembly, se houver ganho comprovado.

