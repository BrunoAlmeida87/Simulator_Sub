# Guia de operação

## Conceitos

- **Lastro principal (TLP)** faz a transição superfície ↔ imersão: ~208 m³ de reserva de flutuabilidade.
- **Compensação** ajusta o peso submerso para o equilíbrio hidrostático (toneladas).
- **Trim e banda** redistribuem pesos e mudam a atitude de equilíbrio estático.
- **Lemes** produzem forças dinâmicas ∝ U². Sem velocidade não há efeito; com velocidade, mantêm a profundidade mesmo com pequenos desequilíbrios.

## Pilotagem — central de operação

A aba **Pilotagem** concentra a operação. A cena do submarino fica sempre visível, com a faixa de indicadores embaixo: profundidade, velocidade vertical, velocidade, rumo, pitch, banda, bateria e flutuabilidade (ou reserva, na superfície). O painel lateral tem rolagem própria.

- **Barra superior (fixa):** executar/pausar, passo, reiniciar, velocidade do tempo, seletor de **cenário** + Carregar, **⧉ 2ª janela** e alarmes. Clicar no alarme abre o sistema afetado na Pilotagem.
- **Comandos essenciais (sempre visíveis no topo do painel):** executar/pausar, telégrafo, lemes de vante, ré e direção, profundidade (MAN/AUTO + ordem) e manobras rápidas (Imergir para X m, Emergir, Manter).
- **Grupos expansíveis**, com resumo no cabeçalho mesmo recolhidos:
  - *Navegação*: telégrafo com régua, lemes e pilotos de rumo, profundidade e inclinação.
  - *Lastro principal*: suspiro e sopro de cada TLP, sopro de emergência.
  - *Compensação*: válvulas, bomba, dosagem e ajuste calculado.
  - *Trim e banda*: transferências com efeito previsto e peso deslocável.
  - *Ar comprimido*: garrafas, isolamento, pressão e compressor.
  - *Energia e snorkel*: bateria, disjuntor, demanda, geradores e mastro.
  - *Falhas e segurança*: alarmes, reconhecimento, injeção e remoção de falhas.
  - *Ambiente e configuração*: mar, condições da água, cenário e acesso aos parâmetros avançados.
  - *Cenários guiados*.
- **📌 Fixar**: até dois grupos ficam sempre abertos no topo, por exemplo Lastro + Ar comprimido. *Recolher todos* fecha os demais.
- **Controles ligados à cena:**
  - clicar num **tanque** abre o grupo do tanque, destaca a linha dele e realça as suas conexões;
  - clicar num **leme** ou no **hélice** abre a Navegação;
  - clicar no **mastro**, na **bateria** ou nos **geradores** (visíveis no corte) abre Energia e snorkel;
  - clicar nas **garrafas AP** abre Ar comprimido;
  - clicar em **válvulas e bombas** abre o sistema delas;
  - o botão *Sistema →* de um alarme leva ao sistema afetado.

As outras abas continuam servindo para diagramas maiores, histórico e detalhes técnicos. Todas usam os mesmos comandos e o mesmo estado.

## Mapa tático

A aba **Mapa tático** mostra a posição geográfica do submarino. O ponto de partida padrão fica na Baía de Sepetiba, junto ao **Estaleiro e Base Naval da Ilha da Madeira (Itaguaí-RJ)**. O mapa mostra:
- o símbolo do submarino, com vetor de velocidade (6 min de avanço sobre o fundo), rumo ordenado e derrota percorrida;
- a posição de **navegação estimada** e o erro em relação à posição real;
- os círculos de 1, 2 e 5 milhas, a base EBN e uma área de exercícios fictícia;
- **contatos de superfície fictícios** (mercantes, pesqueiro, rebocador, patrulha), com vetor e, no painel, marcação, distância, rumo/velocidade e **CPA/TCPA** (em vermelho se menor que 1 milha nos próximos 30 min);
- a grade de 5′.

Ferramentas:
- **Planejar rota**: clique nos pontos e use *Seguir rota*. O piloto de rumo recebe o rumo para cada ponto, e o ponto é dado como alcançado a 150 m.
- **Medir**: distância em milhas e km, e marcação entre dois pontos.
- **Definir posição**: reposiciona a referência geográfica. A física não muda.

Fundos de mapa, todos gratuitos e sem chave de API: tático escuro e mapa (OpenStreetMap), relevo (OpenTopoMap) e satélite (Sentinel-2 sem nuvens, EOX), mais sinais náuticos do OpenSeaMap. Eles vêm da internet; sem conexão, fica só a grade (opção *Nenhum*). A batimetria real não é modelada: a profundidade do fundo é a do cenário.

## Fluxo de energia

A aba **Fluxo de energia** desenha o balanço elétrico como um diagrama de fluxo, em que a largura de cada faixa é proporcional à potência e o tracejado anda no sentido do fluxo. O caminho completo é: combustível e ar do snorkel → diesel-geradores (com o consumo de óleo) → barramento → bateria e consumidores (motor principal, habitabilidade, navegação, hidráulica, compressor, bombas).
- **Geradores em carga:** a bateria aparece **carregando**, com a corrente e o tempo estimado até a carga completa.
- **Geradores parados:** a bateria aparece **descarregando** para os sistemas, com a autonomia estimada.

*Preparar demonstração* carrega a cota periscópica com mar calmo, piloto de profundidade em 14 m e snorkel içando. Depois é só partir os geradores. Com os diesel em carga, a cena 3D mostra **fumaça** saindo do topo do mastro, mais escura na partida.

## Duas janelas (dois monitores)

**⧉ 2ª janela** abre a cena numa nova janela, que pode ir para o outro monitor (use *Tela cheia*). A física roda só na janela principal. A segunda espelha o estado pelo canal de comunicação entre janelas do navegador (BroadcastChannel; é preciso o mesmo navegador e o mesmo endereço). O que ela mostra:
- a câmera "Igual ao controle", ou uma câmera própria;
- as mesmas camadas (tanques, vetores, escoamentos);
- os indicadores principais;
- a narração dos cenários guiados e as manobras.

Clicar num objeto na segunda janela abre os controles correspondentes na janela principal. A segunda janela tem também os seus próprios botões de camadas: tanques, peso/empuxo, hélice/lemes, vetores de trim, escoamentos, tubulações, identificações, boias e esteira. Eles valem só para ela; um • indica o que foi alterado ali, e "↺ Igual ao controle" volta a seguir a janela principal.

Os botões de câmera *Vista tanques* e *Vista forças* (em todas as telas) mudam o enquadramento e já ligam, respectivamente, os tanques e os vetores. Os botões de camada (*Ver tanques*, *Vetores*, *Trim*) ligam e desligam o que é desenhado. Mantenha a janela principal visível (não minimizada): navegadores pausam a animação de janelas minimizadas, e com isso a simulação também pausa.

## Modo apresentação

A aba **Apresentação** foi feita para quem conduz uma demonstração para um público. A cena, os tanques, os vetores de força e os indicadores ficam juntos, de modo que, ao operar uma válvula, se veja ao mesmo tempo o tanque enchendo, a massa e o peso aumentando, a resultante mudando e a resposta do submarino.

**Condução**
- *Situação pronta* + **Preparar**: carrega o cenário, o estado do mar, o enquadramento e as camadas sugeridas, já pausado. O texto abaixo da lista sugere o que mostrar.
- **Executar/Pausar**, **+0,1 s**, **+1 s** e velocidades de **×0,25** a **×10** (câmera lenta abaixo de ×1; a física usa sempre o mesmo passo fixo).
- **↺ Estado inicial** volta exatamente à condição preparada.
- **📌 Marcar "antes"** guarda o estado atual; a tabela **Antes × agora** mostra profundidade, velocidade vertical, atitude, massa, P, E, E − P, volume deslocado, fração imersa e os volumes de cada tanque, com as diferenças. **↩ Voltar ao "antes"** repete a demonstração a partir do ponto marcado.

**Enquadramentos**: *Superfície* (3/4 elevado, mostra esteira e proa), *Submerso*, *Tanques* (corte de perto), *Forças* (vista lateral para os vetores), *Seguir*, *Perseguição*, *Fixa* (câmera parada no cenário, o submarino atravessa o quadro) e *Livre*.

**Camadas** (independentes): peso/empuxo, hélice/lemes/resistência, tanques, tubulações, escoamentos, identificações, esteira, boias/marcos, trajetória e iluminação de apresentação. A transparência do casco é ajustável. **Sem água** esconde o mar, a superfície, o fundo e as partículas para ver o submarino isolado sobre fundo neutro; um clique devolve tudo.

**Escolha dos vetores**: nas telas Pilotagem e Visualização 3D, o botão **Vetores** liga os vetores e abre um painel recolhível para marcar quais aparecem (peso, empuxo, resultante, hélice, resistência, lemes de vante, ré e direção, trim), com *Todos* e *Nenhum*. O botão **💧 Tirar água / Pôr água** faz o mesmo que a camada *Sem água*.

**Vetores**: peso e empuxo usam a mesma escala (14 m = peso na condição inicial). Como os dois quase se equilibram, a resultante pode ser ampliada (automática: 1, 2 ou 5 × 10ⁿ, ou ×1, ×10, ×100, ×1000); o fator aparece sempre no rótulo. Com o casco todo submerso, encher um tanque só aumenta o peso (o empuxo fica praticamente constante); na superfície, o casco afunda e o empuxo cresce junto com a fração imersa.

**Tanques e escoamentos**: lastro principal (azul), compensação (verde), trim (laranja) e banda (roxo). Clique num tanque (na lista ou no corte) para destacá-lo; os demais ficam discretos. As partículas mostram o sentido e a intensidade das vazões calculadas: ar saindo pelos suspiros (jato acima da água, bolhas debaixo dela), água entrando ou saindo pelos embornais, ar comprimido das garrafas ao coletor e aos TLP durante o sopro, admissão e descarga de compensação e transferências de trim e banda. Válvulas: verde aberta, vermelha fechada, âmbar em curso. Bombas em funcionamento ficam verdes e o rotor gira.

**Manobras automáticas**: a barra sobre a cena mostra a etapa atual, as etapas seguintes e os comandos enviados. Ao terminar, informa **SUCESSO**, **TEMPO ESGOTADO**, **CANCELADA** ou **FALHA** (por exemplo, falta de ar comprimido ou profundidade de teste excedida).

## Cenários guiados (automáticos)

Em **Apresentação** (ou **Pilotagem**, que leva até ela), *Cenários guiados → ▶ Iniciar*. O simulador conduz a operação sozinho, devagar. Em cada etapa ele:
- explica o que está acontecendo, com os valores ao vivo;
- explica o porquê;
- troca a câmera e as camadas (mostrando, por exemplo, só os TLP enquanto alagam);
- só avança quando a condição física é atingida **e** passou o tempo mínimo de leitura.

Os comandos enviados aparecem no cartão e ficam no registro. **Pausar**, **Próxima etapa** e **Encerrar** ficam sempre disponíveis. Ao final, o cartão informa as etapas concluídas, as que tiveram tempo esgotado e as puladas, e oferece **Repetir**.

Primeiro roteiro, **Submergir e descer para 50 m** (cerca de 3 min):
1. Situação inicial.
2. Ganhar seguimento.
3. Abrir os suspiros.
4. TLP cheios.
5. Fechar os suspiros.
6. Descer com os lemes.
7. Nivelar na cota.
8. Equilibrar pela compensação.
9. Resumo.

Os cenários existentes não são alterados: o roteiro parte do cenário *Superfície*.

## Peso deslocável e trimagem

Uma carga de demonstração de 5 t corre num trilho longitudinal (−25 a +25 m, a 1 m/s). Na posição neutra ela faz parte da condição de projeto (trim nulo).
- **Deslocar:** levá-la para vante ou ré cria um binário: +P na nova posição e −P na original. Pairando a 80 m, o submarino inclina cerca de 10°. Na superfície o efeito é pequeno, porque o plano de flutuação é muito mais rígido.
- **Compensar com o trim:** transfere a água entre TT-AV e TT-AR que anula o binário, e o submarino volta a nivelar.
- **Massa da carga:** 0, 2, 5 ou 10 t (entra no balanço de massa). Com 10 t a 25 m, os tanques de trim não bastam, e o painel avisa.
- **Vetores de trim:** camada própria, que liga e desliga sem afetar as outras. Mostra o binário do peso, a variação de peso em TT-AV e TT-AR e um arco com o momento líquido ("Trim compensado" quando os momentos se anulam).
- **Onde está o painel:** Apresentação (situação pronta "Trim: deslocar peso e compensar"), Pilotagem e Trim e banda.

## Tanques visíveis e visualização salva

- **Tanques visíveis:** ao ligar *Ver tanques*, abre a lista de tanques. Você pode mostrar todos, só um grupo (lastro principal, compensação, trim, banda) ou tanques individuais. As tubulações e os escoamentos acompanham a seleção.
- **Visualização salva:** Pilotagem, Visualização 3D e Apresentação guardam a câmera, a posição da câmera livre, os botões e a seleção de tanques ao trocar de aba. Também ficam guardados ao recarregar a página.

## Sequência completa (cenário "Superfície — pronto para imergir")

1. **Preparar:** telégrafo **AV MEIA** (75 rpm). Aguarde > 4 nós. A compensação já está pré-calculada para ~40 m.
2. **Imergir:** **Abrir suspiros** (tela 1 ou 2). Observe as bolhas no 3D, os TLP enchendo (~40 s) e a reserva de flutuabilidade caindo.
3. **Descer:** lemes de vante **10↓**. O submarino inclina a proa e desce. Perto de 20 m, **Fechar suspiros**.
4. **Estabelecer a cota:** piloto de profundidade **AUTO** com referência de 50 m, ou nivele manualmente com lemes de ré.
5. **Equilibrar:** tela 2 → "Executar ajuste calculado" (ou dosagens). Verifique a flutuabilidade líquida em ±300 kg e o painel "Por que está subindo ou descendo?".
6. **Trim:** tela 3. O pitch de equilíbrio estático (CALC) deve ficar próximo de 0°. Transfira água conforme a previsão.
7. **Navegar e guinar:** piloto de rumo AUTO com nova referência, ou leme de direção manual. Observe a banda para dentro da curva (efeito da vela) e a perda de velocidade.
8. **Emergir:** referência de profundidade de 14 m e, ao chegar, **Soprar TLP** + lemes **SUBIR**. Feche o sopro quando os tanques estiverem vazios. O ar se expande na subida e expulsa mais água.

O roteiro automático equivalente fica em **Guia → Demonstração automática**.

## Outros cenários

| Cenário | O que observar |
|---|---|
| Pairando a 80 m | Lemes sem efeito com velocidade nula; somente a compensação controla a profundidade. |
| Termoclina acentuada | O submarino ganha empuxo ao entrar na camada fria e densa. |
| Águas rasas | Alarmes de altitude; contato com o fundo. |
| Compensação desajustada | Após o mergulho o submarino tende a afundar; é preciso esgotar 4 t. |
| Cota periscópica | Snorkel, diesel-geradores, recarga da bateria e aumento de peso pelo combustível compensado. |
| Mar grosso | Estado do mar 5 na cota periscópica: o casco joga, as cristas fecham a válvula do snorkel e há sucção para baixo; use o piloto de profundidade. |
| Alagamento a 120 m | A vazão do rombo diminui à medida que o submarino sobe (√Δp); sopro de emergência, lemes a subir e toda força. |

## Configurações (aba ⚙)

Reúne as opções alteráveis. Cada grupo traz uma etiqueta com o tipo de efeito:

| Etiqueta | Significado |
|---|---|
| **VISUAL** | só aparência; aplicada na hora, sem efeito na física |
| **SIMULAÇÃO · AGORA** | muda a física da simulação em curso, sem reiniciar; fica registrada no histórico de comandos |
| **SIMULAÇÃO · REINICIAR** | vale quando o cenário é reiniciado (“Salvar e reiniciar o cenário”) |

- **Sessão — salvar e continuar:** *Salvar a simulação atual* (guarda no navegador), *Baixar arquivo* (.json para guardar ou abrir em outro computador), *Carregar arquivo* e *Retomar a simulação*. Ao carregar, tudo volta ao ponto salvo — posição, profundidade, rumo, velocidade, inclinação, tempo, tanques, bateria, combustível, ar, válvulas, bombas, telégrafo, lemes, piloto e referências, falhas, alarmes, ambiente e as automações em andamento (manobra rápida, demonstração, cenário guiado, rota) — e a simulação fica **pausada** até *Retomar*. Arquivos de versões anteriores abrem com conversão automática.
- **Identificação do submarino** (VISUAL): nome, inscrição vermelha da vela, emblema e cor dos lemes.
- **Qualidade gráfica** (VISUAL): cena/oceano e texturas; vale para todas as abas e para a 2ª janela.
- **Ambiente** (AGORA): estado do mar, salinidade, temperaturas, termoclina e declinação. *Aplicar agora* mantém o estado; *Usar nos próximos cenários* guarda como padrão.
- **Fundo do mar** (AGORA): uniforme (padrão de 300 m) ou com relevo. O simulador recusa um fundo que ficaria acima do casco na posição atual.
- **Simulação** e **Parâmetros da embarcação** (REINICIAR): passo de integração, semente, instrumentação e parâmetros fictícios do casco, propulsão, bombas, lemes e limites.

A aba **Cenários** fica só com as condições iniciais e a condição de carga.

## Falhas para treinamento

Na tela **Segurança**, injete:
- **Bomba de compensação:** não é possível esgotar; use velocidade e lemes.
- **Planta hidráulica:** a pressão cai com o uso e os lemes ficam lentos até travar.
- **Bateria isolada:** o barramento depende dos geradores; sem eles, tudo para.
- **Sensor PRF-1 em deriva:** alarme de divergência; o piloto automático usa a média e é afetado.
- **Vazamento no suspiro:** o TLP alaga lentamente mesmo com o suspiro fechado (perda de empuxo na superfície).

## Modo engenharia

Ative ⓘ e clique em qualquer tanque, válvula, bomba, leme ou instrumento. O painel mostra função, variáveis ao vivo (MED/CALC/CMD/VERD), equações, consequências previstas, gráfico antes × depois e a decomposição de forças e momentos (por que sobe, por que muda o pitch, por que guina, por que aderna).

## Aplicativo Windows

Para gerar e abrir a versão Electron, siga [Executável para Windows](EXECUTAVEL-WINDOWS.md). O aplicativo inclui a simulação local e mantém os comandos descritos neste guia. O botão **2ª janela** abre uma visualização para outro monitor; ao fechar a janela principal, a visualização também é fechada. Os fundos do mapa precisam de internet.
