# Sonar integrado — arquitetura, operação e limites

## Diagnóstico do projeto e decisão de integração

Base examinada: `main` em `13e5080`, após atualizar a cópia inicial. React 18.3,
TypeScript 5.9, Vite 6, Three.js 0.170, `WebGLRenderer` e Vitest. O repositório
atual já continha Electron (`electron/main.cjs`, `electron-builder.yml`), navios
3D, tráfego adicional e uma demonstração geométrica isolada em `src/sim/sonar.ts`.
Essa demonstração e seus testes permanecem como referência legada; a aba Sonar
passou a operar o submarino existente.

| Sistema existente | Reutilização |
|---|---|
| `sim/core/engine.ts`, `runner.ts` | Física NED, passo fixo 0,02 s, posição, rumo, velocidade, pausa e aceleração |
| `sim/environment/environment.ts` | Temperatura/salinidade com termoclina, mar, fundo físico, costa e relevo |
| `sim/geo.ts`, `traffic.ts`, `render3d/Ships.ts` | Mesmas rotas, origem geográfica e quantidade de navios do mapa e do 3D |
| Propulsão, elétrica, hidráulica, compensação, trim/banda, ar AP | Rotação real do eixo, velocidade, diesel em funcionamento, bombas e compressor |
| `sim/commands.ts` | Comandos registrados, gravação/reprodução e operação em janela espelhada |
| `render3d/layers.ts`, `SceneLayerPanel` | Catálogo único, controles e persistência das camadas |
| `ui/sync.ts` | Mestre único, janelas de tela e de visualização |
| `sim/persistence.ts` | Sessões JSON, migração de arquivos sem sonar e continuação determinística |
| `Panel`, estilos existentes | Console responsivo e padrões visuais do simulador |

A análise e a proposta foram apresentadas antes das alterações. O anexo recebido
terminava no item 4 da Fase 1; a implementação cobre os recursos descritos nas
seções anteriores, com as aproximações explicitadas abaixo.

## Módulos e fronteira dos dados

- `src/sonar/acoustics/`: velocidade do som, ambiente, absorção, raios, caminhos.
- `sources/`: biblioteca genérica sintética e ruído próprio.
- `sensors/`: recepção passiva e emissão/recepção ativa temporizada.
- `dsp/`: síntese do sinal, FFT Hann/radix-2, envelope DEMON e reamostragem aural.
- `contacts/`: associação por marcação, identificadores Snnn, histórico circular.
- `tma/`: mínimos quadrados ponderados, observabilidade e incerteza aproximada.
- `classification/`: comparação dos picos medidos com a biblioteca sintética.
- `display/`: cascatas, espectro instantâneo, áudio Web Audio.
- `visualization/`: corte, SVP, diagnóstico Three.js, camadas e replay.
- `integration/`: adaptação do mundo, cadência, comandos e transporte incremental.
- `tests/sonarIntegrated.test.ts`: testes técnicos; testes existentes verificam
  gravação, sessão, sistemas físicos e camadas.

`worldSources()` é o adaptador da verdade física. Apenas sensores e propagação
recebem entidades do mundo. Trilhas operacionais têm marcação, erro angular,
SNR, origem da medição, horário, picos e classificação estimada. Não têm nome,
ID do navio ou coordenadas verdadeiras do alvo. O histórico guarda a posição do
**observador**, necessária ao TMA. O console e o posto de sonar na sala de
comando leem essas mesmas trilhas, sem consultar a identidade das entidades.

O diagnóstico científico é opt-in e pode mostrar o ambiente e os caminhos
simulados. O mapa tático preexistente continua exibindo seu quadro de mundo;
não é usado como instrumento de detecção acústica. Não há conexão nova com armas.

## Como operar

1. Abra **Operação → Sonar**. O sonar nasce ligado, mas requer barramento
   energizado e avanço do relógio. Execute a simulação ou use **+1 s**.
2. Ajuste máquinas/velocidade nas telas existentes e observe o ruído próprio.
   O efeito é gradual pelo SNR, sem um limite de velocidade que apague contatos.
3. Em **Banda larga**, clique para posicionar o cursor e use **Marcar contato**;
   clique duplo também marca. Clique numa trilha Snnn para acompanhar seu feixe.
4. Alterne para **LOFAR** ou **DEMON**. As cascatas continuam guardadas ao mudar
   modo ou aba. LOFAR oferece zoom de frequência e espectro instantâneo. Cada
   linha histórica pertence ao feixe recebido naquele instante; mudar de contato
   não reescreve o passado. Picos tonais são medidas de FFT, não nomes de navios.
5. **Escutar feixe** inicia áudio após gesto do usuário. Volume e passa-altas/
   passa-baixas são locais à janela. O sinal é o mesmo usado pelo DSP, reamostrado
   de 2.048 para 8.192 Hz para compatibilidade Web Audio. Pausar a física silencia
   a reprodução. A taxa aural acompanha a aceleração até ×4; acima disso os novos
   sinais continuam vindo do tempo simulado, com reprodução limitada a ×4.
6. **Emitir pulso** agenda ecos; a marcação/distância ativa aparece somente após
   sua chegada. A incerteza inclui tempo e erro de velocidade do som. A indicação
   da distância mostra também a idade do eco, separada da marcação passiva atual.
7. Ative **Emissões didáticas das patrulhas** para fontes existentes dessa
   categoria emitirem a cada ciclo de 30 s. A recepção tem atraso de percurso e
   fornece marcação, sem distância por escuta unilateral.
8. Compare tons com a **Biblioteca sintética**, registre uma hipótese manual e
   observe a sugestão automática com confiança limitada. DEMON mostra modulações;
   uma frequência isolada não determina univocamente o número de pás.
9. Para TMA, colete marcações e manobre o observador. Uma medição ou movimento
   retilíneo uniforme deixam distância ambígua; o painel informa a insuficiência.

O controle **Tráfego adicional existente** usa o mesmo conjunto dos Gráficos,
mapa e cena. Ruído de tráfego distante e atividade biológica são parâmetros
ambientais separados. **Memória (s)** limita o histórico a 30–900 amostras,
240 por padrão; a janela temporal seleciona quanto dele desenhar. Trilhas têm
180 medições cada, até 48 trilhas. Reduzir a memória retém as amostras recentes.

## Diagnóstico, perfis e replay

**Abrir diagnóstico científico** mostra o corte vertical, SVP e a cena Three.js
existente. Há presets Tropical, Verão, Inverno, Águas frias e Homogêneo acústico.
Temperaturas, salinidade, centro e espessura da termoclina usam os comandos do
ambiente existente; portanto os ajustes de T/S também alteram a água da física.
O preset homogêneo é uma comparação acústica de c = 1.500 m/s, sem mudar a
hidrostática. A salinidade profunda permanece configurável na tela de ambiente.

As 11 camadas podem ser desligadas individualmente: raios, frente de onda,
termoclina, SVP, baixa cobertura amostrada, densidade de raios, reflexões de
superfície/fundo, ecos, marcações e réguas. Há opacidade global. A densidade de
raios é um mapa de amostragem, não uma medida absoluta de nível sonoro.
As camadas estão também em Operação, Governo, Visualização 3D, Apresentação e
2ª janela. Nesta última, escolha **Camadas → Camadas do controle** para seguir
exatamente a seleção e o tempo do replay da janela principal.

Em **Fontes · configuração científica**, cada navio existente pode receber nível,
rotação de eixo, pás, tons e emissão da propulsão próprios. A configuração mostra
explicitamente a verdade do cenário; não identifica trilhas operacionais. Restaurar
a assinatura genérica volta à variação pela velocidade do navio.

Plano do corte e número de raios são configuráveis. Padrão 64; regular 8–128;
256/512 são opções de alta qualidade com custo maior. **Vista acústica** enquadra
o corte; **Câmera livre** permite órbita; **Ping Cam** acompanha uma trajetória
armazenada, sem modificar a física. Não existe ganho artificial de curvatura.
O gráfico 2D amplia o eixo vertical na tela e identifica explicitamente isso;
as coordenadas calculadas permanecem em metros.

Cada ping preserva sua origem, batimetria, perfil, raios, trajetórias de retorno
e eventos. O replay usa esses dados, sem refazer a propagação a cada quadro:
velocidade real, ×0,5/×0,25/×0,1, pausa, ±0,05 s, slider e marcadores. O eco volta
pela trajetória armazenada. Apenas ecos próximos ao plano (±5°) aparecem no
corte; a cena 3D os projeta na direção correspondente. As marcações operacionais
ao vivo são ocultadas durante replay para evitar misturar instantes.

Novos ajustes de ambiente/plano/qualidade passam a valer no próximo ping;
o replay anterior continua representando a emissão original. **Ao vivo** retorna
ao relógio da simulação. Pausar/rebobinar o replay não pausa/rebobina o submarino.

## Modelo e aproximações

- c(T,S,z): aproximação tipo Mackenzie; pressão representada pelo termo de
  profundidade. O SVP tem camada superficial, termoclina suave e aumento profundo
  por pressão. Perfis suficientemente profundos permitem demonstrar canal sonoro.
- Raios verticais: `dθ/ds = −cos(θ) (dc/dz)/c`, integração espacial com ponto
  médio, superfície plana e reflexão especular no fundo inclinado. O fundo é
  amostrado da função física em até 1.024 intervalos (10 m quando possível), com
  interpolação linear. Obstáculos menores que essa resolução podem ser omitidos.
- Perda: espalhamento esférico `20 log10(r)`, absorção de Thorp por frequência,
  1 dB por reflexão superficial e 5 dB por reflexão no fundo. Não modela tipos de
  sedimento, difração, interferência coerente ou espalhamento de superfície rugosa.
- Detecção: busca angular independente da qualidade visual; largura finita de
  feixe transforma distância ao raio em penalidade contínua. Ausência de raio
  amostrado não prova sombra absoluta. Percursos interrompidos por terra não são
  reaproveitados como atalhos de baixa perda.
- Passivo: 180 feixes de 2°, energia agregada, atenuação suave a ré, erro angular,
  probabilidade de detecção e associação angular. Contatos próximos ou cruzados
  podem se fundir ou trocar trilha; não há associação oculta pelo ID verdadeiro.
- Ativo: equação sintética de ida/volta, alvo extenso aproximado por feixe finito,
  até três caminhos separados em tempo, reflexão recíproca e correção radial de
  movimento de primeira ordem. Meio e trajetórias congelam na emissão; não há
  solução completa de interceptação em meio móvel. Não modela clutter de volume
  ou uma malha de ecos de rochas/destroços independentes.
- Ruído próprio: velocidade na água, rotação efetiva, geradores em partida/carga/
  parada, bombas de compensação/transferência/trim/banda, hidráulica e compressor.
  Contribuições são sintéticas, somadas em potência. A carga elétrica do sonar é
  tratada como parte dos consumidores de navegação existentes, sem novo balanço.
- DSP: 4.096 amostras a 2.048 Hz, FFT com janela Hann (0,5 Hz), histórico LOFAR
  reduzido a 256 bins; DEMON usa passa-altas, envelope RMS, remoção de média e FFT
  (0,5 Hz, até 128 Hz). Um quadro sonoro usa máquinas/geometria congeladas durante
  sua janela sintética de 2 s. Não é processamento de gravação hidroacústica real.
- Classificação: correspondência de tons com escala de rotação; confiança limitada
  e opção manual. Modulações são hipóteses, não identificadores exclusivos.
- TMA: modelo de velocidade constante, mínimos quadrados ponderados em marcações,
  teste de manobra, condicionamento e resíduo. Incerteza é indicativa, sem garantia
  estatística calibrada; mudanças de curso do alvo ou associação errada degradam
  a solução. Não estima uma posição verdadeira a partir da entidade do mundo.

## Cadência, memória e compatibilidade

Ecos são entregues no passo de 0,02 s. Aquisição passiva/FFT é de 1 Hz. A busca
por caminhos é distribuída em dez fontes por segundo, com cache de até 5 s e
invalidação por ambiente/movimento. Há uma breve aquisição inicial enquanto os
caminhos ficam disponíveis; mudanças ambientais podem levar alguns segundos
para alcançar todas as fontes. Cursor, cache e RNG próprios fazem parte da sessão,
preservando continuação exata e sem consumir o RNG do motor físico.

Históricos usam buffers circulares, em 0,1 dB nos displays para limitar o JSON;
o sinal aural e os picos de FFT mantêm a resolução original. Janelas recebem
novas linhas e medições incrementalmente, e o snapshot do ping apenas quando muda.
A geometria Three.js é reconstruída somente quando muda o snapshot; frentes,
ecos e marcações reutilizam buffers. Recursos são liberados com a cena e o áudio
fecha ao sair da tela. Qualidade não modifica a detecção.

Sem dependências externas novas, CDN, WebGPU ou Compute Shaders. O build relativo
do Vite continua incluído no pacote Electron e o sonar funciona com acesso externo
bloqueado. Tiles dos mapas existentes continuam dependendo de rede. Web Audio tem
fallback de mensagem se indisponível. O instalador Windows não foi executado neste
ambiente Linux; a compatibilidade se apoia nas mesmas APIs do Chromium e no build
web verificado.

O benchmark reproduzível é `npm exec vite-node scripts/sonar-benchmark.ts`.
Referência de CPU da execução: AMD EPYC 9V74, Node 24.19, ambiente cloud, sem GPU
representativa do computador do operador. Com 20 navios adicionais, a distribuição
por passos reduziu os picos periódicos observados de ~100 ms para aquisição com
p95 abaixo de 9 ms na medição intermediária. Ray tracing de 512 raios continua
podendo ocupar ~100 ms numa emissão. O benchmark registra também o tamanho do
estado e do delta. Números variam com concorrência, ambiente e hardware; não há
promessa de 60 FPS. O cálculo foi mantido determinístico no passo fixo após essa
redução; Web Workers não são exigidos. Em hardware limitado, use 8–32 raios e
menos tráfego, especialmente em tempo acelerado.

Para histórico longo/qualidade alta, prefira exportar a sessão para arquivo: a
cota de armazenamento local do navegador pode limitar salvamentos maiores.

## Verificação

- `npm run build`: TypeScript e bundle Vite.
- `npm test`: suíte do projeto e testes do novo subsistema.
- Testes específicos: refração/reflexões, terra, atenuação, FFT, DEMON,
  reamostragem aural, ruído próprio, anonimização, associação, atraso de eco,
  pausa, histórico circular, comandos, transporte e TMA observável/ambíguo.
- Regressões: continuação após salvar/restaurar, gravação de comandos, ar de
  emergência, navegação, sala de comando, persistência de camadas e física.
- Chromium/Playwright: desktop, 390 px sem overflow, seleção, modos, pulso,
  diagnóstico, replay, áudio e janelas espelhadas. Capturas em `docs/img/sonar/`.
