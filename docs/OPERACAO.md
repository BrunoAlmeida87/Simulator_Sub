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

**Diagrama da compensação (aba Lastro e compensação):** um coletor liga a admissão do mar (**V-AM**, à direita), a sucção da bomba **BC** (que recalca pela **V-DM** para o mar, à esquerda) e o ramal de cada tanque (**VC-1 → TC-1**, **VC-2 → TC-2**). Cada trecho anima com a vazão calculada para ele, no sentido real do escoamento: admitindo, a água vai do mar para os tanques abertos; esgotando, dos tanques para a bomba e o mar; ramais com válvula fechada, trechos isolados e a bomba com a V-DM fechada (aviso “descarga fechada”) ou sem tanque aberto (“sem sucção”) ficam parados. Com admissão e bomba ao mesmo tempo, o excedente passa direto da admissão para a bomba. As vazões de admissão e descarga aparecem junto às linhas. O corte 3D usa as mesmas vazões por trecho.
  - *Trim e banda*: transferências com efeito previsto e peso deslocável.
  - *Ar comprimido*: garrafas, isolamento, pressão e compressor.
  - *Energia e snorkel*: bateria, disjuntor, demanda, geradores e mastro.
  - *Falhas e segurança*: alarmes, reconhecimento, injeção e remoção de falhas.
  - *Ambiente e configuração*: mar, condições da água, cenário e acesso aos parâmetros avançados.
  - *Roteiros automáticos*.
- **📌 Fixar**: até dois grupos ficam sempre abertos no topo, por exemplo Lastro + Ar comprimido. *Recolher todos* fecha os demais.
- **Controles ligados à cena:**
  - clicar num **tanque** abre o grupo do tanque, destaca a linha dele e realça as suas conexões;
  - clicar num **leme** ou no **hélice** abre a Navegação;
  - clicar no **mastro**, na **bateria** ou nos **geradores** (visíveis no corte) abre Energia e snorkel;
  - clicar nas **garrafas AP** abre Ar comprimido;
  - clicar em **válvulas e bombas** abre o sistema delas;
  - o botão *Sistema →* de um alarme leva ao sistema afetado.

As outras abas continuam servindo para diagramas maiores, histórico e detalhes técnicos. Todas usam os mesmos comandos e o mesmo estado.

## Painel de governo (aba Governo)

Inspirado no posto de governo de um submarino, com cena 3D (perseguição, lateral, topo ou livre) em cima e três blocos embaixo:
- **GOVERNO** (azul): **manche** — arrastar para os lados comanda o leme de direção (BB/BE); empurrar (para cima) comanda os lemes de ré a DESCER e puxar (para baixo) a SUBIR. **Alavanca dos lemes de vante** ao lado. Botões giratórios de **rumo** e **profundidade** ordenados (gire e solte) com MAN/AUTO.
- **INSTRUMENTOS**: rosa de rumo (com o rumo ordenado), fita de profundidade (com a cota ordenada e o fundo), atitude e velocidade.
- **POTÊNCIA** (laranja): **alavanca do telégrafo**, que encaixa nas ordens (RÉ TODA … AV TODA), ajuste fino de ±5 rpm, rotação do eixo, potência e empuxo.

A peça que se move mostra o **comandado**; o marcador **verde** mostra a resposta **real** (ângulo dos lemes, rotação do eixo). Funciona com mouse e toque. Os comandos são os mesmos das outras telas (aparecem no histórico, entram na gravação e ficam sincronizados com a Pilotagem); mover o manche com o piloto em AUTO desengaja o canal, como nas outras telas.

## Sala de comando (primeira pessoa)

A aba **Sala de comando** coloca você **dentro** do submarino, numa sala de controle em 3D inspirada nas de submarinos convencionais (posto de governo a vante e a bombordo, painel do lastro a boreste, periscópios no centro, consoles multifunção a bombordo, mesa tática à ré). Tudo o que aparece nas telas, lâmpadas, ponteiros, manches e no periscópio vem do estado da simulação; todo acionamento envia os **mesmos comandos** das outras telas (histórico, gravação, segunda janela).

**Andar e olhar**
- **W A S D** ou **setas** andam (Shift corre); **arrastar** em ponto vazio olha ao redor; a **roda do mouse** dá um passo. No celular: botões **▲ ▼ ◀ ▶** e arrastar o dedo.
- **Postos ▾** leva direto a cada posto; **↺ Voltar à entrada** retorna ao ponto inicial (à ré da mesa tática). A posição fica guardada ao trocar de aba.

**Dois jeitos de operar**
1. **Clicar num posto de longe**: a câmera se aproxima e abre, ao lado (no celular, abaixo), o **painel 2D da estação** com todos os controles e um texto sobre como é aquele posto num submarino real (ⓘ). **Esc** ou *Sair do posto* volta a andar; *✕* fecha só o painel.
2. **Acionar direto na cena** (de perto ou com a estação em foco): os botões das telas e dos painéis, os volantes e o anunciador respondem ao clique; os **manches** e o **telégrafo** respondem ao arrasto. A barra inferior mostra o que está sob o mouse (borda verde = clique aciona; sem borda = clique aproxima). No posto em foco, a **roda do mouse** aproxima a vista das telas (zoom).

**Postos**
| Posto | O que tem | Comandos |
|---|---|---|
| Posto de governo | PLANADOR (esquerda): profundidade, atitude, lemes horizontais. Centro: OFICIAL DE MANOBRA (pilotos automáticos, telégrafo, manobras, periscópio). TIMONEIRO (direita): rumo e leme de direção | **Manche do planador**: arrastar para cima = empurrar = lemes de ré DESCER; para baixo = puxar = SUBIR. **Manche do timoneiro**: para os lados = leme BB/BE; cima/baixo = lemes de vante. **Telégrafo**: arrastar para cima = avante, para baixo = a ré (encaixa nas ordens ao soltar). Botões de toque: MAN/AUTO e valores ordenados de rumo, profundidade e inclinação; ordens do telégrafo; IMERGIR/EMERGIR/CANCELAR; içar periscópio |
| Instrumentos de mergulho | Antepara de vante: profundímetro principal e de precisão, odômetro, repetidora da giro, relógio, inclinômetro de bolha e clinômetro de pêndulo | só leitura (sensores) |
| Anunciador de alarmes | Uma janela por alarme (vermelho = crítico/alto, âmbar = médio, branco = informativo); pisca até ser reconhecida. Um sinalizador gira no teto com alarme crítico não reconhecido | clicar numa janela reconhece; RECONHECER (todos); TESTE LÂMP. |
| Painel do lastro | Indicador de aberturas do casco ("árvore de Natal": — verde = fechada, O vermelho = aberta; *quadro verde* = casco estanque), suspiro e sopro de cada TLP, ar AP, compressor, flutuabilidade | botões luminosos de suspiro/sopro (individuais e de todos), isolamento dos grupos AP, compressor; **SOPRO DE EMERGÊNCIA** vante e ré: 1º clique levanta a tampa, 2º puxa (fecha os suspiros, abre o sopro do grupo e os grupos AP); clicar de novo recoloca (fecha o sopro) |
| Segurança do mergulho | Compensação (mar ⇄ TC-1/TC-2) e trim/banda (transferência interna) com diagramas animados pelas vazões | válvulas, bombas, sentido, dosagem (admitir/esgotar/transferir), interromper, **ajuste calculado** |
| Coletor de válvulas | Manômetros (hidráulica, ar AP) e volantes das válvulas manuais | volantes: isolamento AP-1/AP-2, admissão/descarga de mar, trim vante/ré, banda BB/BE (as mesmas válvulas dos consoles) |
| Plataforma | Bateria, disjuntor, diesel-geradores, snorkel, combustível, cargas; motor, hidráulica, compressor | disjuntor (abrir pede confirmação), partir/parar geradores, içar/arriar snorkel, compressor |
| Periscópio de ataque | Coluna com a alavanca de içamento; a ocular sobe com o mastro | alavanca: içar/arriar; clique na ocular (ou **Periscópio**) abre a visada |
| Consoles de sonar, tático e navegação | Cascata do sonar passivo (o ruído próprio cresce com a velocidade; zona cega a ré), contatos, MAGE (só com mastro fora d’água), quadro tático com PMA, INS/GPS (GPS só com antena fora d’água), rota | escalas do quadro tático |
| Mesa tática | Carta horizontal com terra e águas rasas (mesmo fundo da física), derrota, rota, contatos e área de exercícios | escalas (2–50 km) |
| Estação do instrutor | Falhas por grupo, tempo da simulação, estado do mar, cenários, peso deslocável, iluminação | injetar/remover falhas, executar/pausar, aceleração, mar, carregar cenário, mover o peso, luz |

**Visada do periscópio**: mostra o mar com o retículo, a marcação verdadeira e relativa e a elevação. Arraste (ou ◀ ▶, setas) para girar; **1,5×/6×** muda o aumento; *Içar/Arriar* comanda o mastro. Com o periscópio arriado a visada fica escura; com a cabeça submersa vê-se debaixo d’água. A cabeça fica fora d’água na cota periscópica (quilha a ≈ 16 m com o periscópio todo içado). Na cena 3D externa o periscópio sobe na vela (arriado, não aparece).

**Iluminação**: *Luz* (ou o interruptor junto à porta de ré, ou o instrutor) alterna normal, **vermelha** (noturna: preserva a adaptação ao escuro para o periscópio) e azul. Sem energia no barramento, ficam só as lanternas de emergência. Alagamento no compartimento central aparece como água no piso.

**Vista externa e 2ª janela**: o botão *Vista externa* abre uma miniatura da cena 3D (perseguição, lateral ou topo). A **2ª janela** continua mostrando a cena externa completa enquanto você opera de dentro da sala (a sala e a visada do periscópio não mudam a câmera nem as camadas da 2ª janela).

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

**Navios no 3D:** os contatos do quadro tático aparecem como navios no mar das cenas 3D (camada **Navios**, ligada por padrão), na mesma posição geográfica, com o mesmo rumo e a mesma velocidade da tabela de contatos — a conversão é a mesma (`contactsLocal`). Modelos leves por tipo: graneleiro (M1), porta-contêineres (M2), pesqueiro (P1), rebocador (R1) e navio-patrulha (N1), com esteira proporcional à velocidade e rótulo com identificação, distância, rumo e velocidade. A vista **Navio próximo** mira o navio mais perto, com teleobjetiva. O alcance de desenho (5–30 km) fica em Configurações → Qualidade gráfica. São apenas visuais: não colidem nem interagem com a física. Os contatos são fictícios (não são posições AIS reais).

**Navios adicionais:** em Configurações → Qualidade gráfica, *Navios adicionais* (0 a 20) acrescenta tráfego fictício em volta da área do cenário (ids T01, T02…), além dos cinco contatos fixos. Cada navio percorre em vaivém um trecho reto que só é aceito se houver água com profundidade para o seu calado em todo o caminho (segundo o fundo e a costa simulados), se passar a mais de 500 m da posição inicial do submarino e se ficar afastado dos trechos de todos os outros navios — por isso nunca aparecem sobrepostos. Mesma posição na cena 3D, no mapa e na tabela de contatos (com CPA). Para manter a fluidez, só os navios dentro do alcance de desenho são desenhados, com modelos leves; aumentar ou reduzir a quantidade vale na hora.

## Fluxo de energia

A aba **Fluxo de energia** desenha o balanço elétrico como um diagrama de fluxo, em que a largura de cada faixa é proporcional à potência e o tracejado anda no sentido do fluxo. O caminho completo é: combustível e ar do snorkel → diesel-geradores (com o consumo de óleo) → barramento → bateria e consumidores (motor principal, habitabilidade, navegação, hidráulica, compressor, bombas).
- **Geradores em carga:** a bateria aparece **carregando**, com a corrente e o tempo estimado até a carga completa.
- **Geradores parados:** a bateria aparece **descarregando** para os sistemas, com a autonomia estimada.

*Preparar demonstração* carrega a cota periscópica com mar calmo, piloto de profundidade em 14 m e snorkel içando. Depois é só partir os geradores. Com os diesel em carga, a cena 3D mostra **fumaça** saindo do topo do mastro, mais escura na partida.

**Descarga dos geradores pelos dispersores (bolhas):** os geradores só funcionam com tomada de ar — na superfície ou com o snorkel içado e a válvula de cabeça aberta; submerso com o mastro recolhido, um gerador comandado fica **SEM AR** e não há descarga. Com gerador em carga e o mastro **recolhido** (operação na superfície), a descarga sai pelos dispersores no casco, logo atrás da vela, abaixo da linha d'água: um fluxo moderado de bolhas pequenas sobe até a superfície, mais intenso com mais geradores e na partida, e acompanha a posição, a inclinação e o movimento do submarino. Com o mastro **içado**, a descarga sai pelo mastro (fumaça). Ao parar os geradores as bolhas cessam. A lógica dos geradores não foi alterada para o efeito (ver `src/sim/systems/exhaust.ts`).

**Interativo:** clique em qualquer equipamento do diagrama para abrir o painel ao lado com o estado (desligado, partindo, funcionando, parando, sem ar, falha) e os comandos que fazem sentido: partir/parar diesel-geradores (exigem tomada de ar), içar/arriar o snorkel, abrir/fechar o disjuntor da bateria, telégrafo do motor principal, partir/parar as bombas de compensação, trim e banda e o compressor. Elementos sem liga/desliga (combustível, barramento, hidráulica automática, cargas fixas) mostram a explicação do estado. O anel em volta de cada consumidor indica o estado (verde funcionando, âmbar em transição, cinza desligado, vermelho falha/sem energia). Os comandos são os mesmos das outras telas e respeitam as condições físicas (ex.: gerador comandado sem ar fica “SEM AR”).

## Propulsão — linha de eixo

No topo da aba **Propulsão e energia**, o diagrama **barramento → motor elétrico principal → eixo → mancal de escora → hélice**, desenhado da direita (proa) para a esquerda (popa) como os diagramas de trim e lastro, mostra os valores de cada passo: potência e corrente elétricas do motor, rotação real e ordenada, torque do motor (barra fica vermelha no torque máximo), potência no eixo, sentido de giro (horário visto da popa = avante), empuxo transmitido ao casco pelo mancal de escora (seta para vante ou para ré), torque absorvido pelo hélice, coeficiente de avanço J e rendimento elétrico→eixo. O rotor e o hélice giram na rotação real (multiplicada pela aceleração; param com a simulação pausada). Os mostradores, o telégrafo e as leituras que já existiam continuam abaixo.

## Costa, terra e estaleiro (região de Sepetiba)

A costa da Baía de Sepetiba — continente de Itaguaí a Guaratiba, Restinga e Ilha da Marambaia, ilhas da baía e o leste da Ilha Grande — está embutida no simulador (funciona sem internet).
- **Com a costa ligada** (Configurações → Fundo do mar → Costa), a terra entra na física: numa faixa costeira (padrão 1 km) o fundo sobe suavemente da profundidade de mar aberto até zero na orla, e em terra o “fundo” fica acima d'água — encostar é **encalhe** (contato com o fundo). O ecobatímetro, os alarmes de altitude e o desenho 3D usam a mesma função.
- **No 3D**: fundo texturizado e terra com cores por altura e declive (praia, mata, rocha), em três níveis de detalhe que acompanham o submarino (perto, médio e longe — este só acima d'água; a névoa vai mais longe e a serra aparece ao fundo). Detalhe em Configurações → Qualidade gráfica → Terreno e costa.
- **Estaleiro e Base Naval da Ilha da Madeira (Itaguaí)** no lugar real, traçado de imagens de satélite Sentinel-2 (julho/2026) e conferido com fotografias: aterro com cais a +3 m, quebra-mares de enrocamento (crista a +5 m, talude 1:1,5) com cabeças arredondadas, cais interno, **shiplift** (110 × 20 m, 8 000 t, 34 guinchos) com um submarino içado, trilhos de transferência, galpões (prédio principal do estaleiro de construção, manutenção, oficinas, transferência, administração e apoio), tanques de combustível, guindastes e, a oeste, o píer de minério do Porto Sudeste como referência.
  - **Na física**: aterro, cais, quebra-mares e shiplift são terra (encostar = contato); junto a eles o fundo sobe com o mesmo talude, exceto na **bacia, na entrada e na aproximação, dragadas a 16 m** (estimado). O aterro vale sobre o relevo antigo do morro (que foi cortado e nivelado).
  - **Só visuais**: galpões, tanques, guindastes, o submarino no shiplift e o Porto Sudeste. Posições e alturas dos galpões são estimadas.
  - Com rótulos ligados, a cena mostra “Estaleiro e Base Naval — Itaguaí” e a distância.
- **No mapa tático**: o botão *Costa do simulador* desenha em laranja a costa usada pela simulação e, por cima, o estaleiro com os mesmos contornos da física e do 3D (aterro, molhes na largura real, shiplift, galpões, área dragada tracejada e o píer do Porto Sudeste), também sem internet. O marcador da base (EBN) fica no centro da bacia.
- **Cenários**: *Saída da base — Estaleiro e Base Naval de Itaguaí* (superfície, no centro da bacia, aproado à entrada a 214°; baía com fundo de 30 m) e *Aproximação da Restinga da Marambaia* (submerso, fundo subindo, alarmes antes do encalhe) vêm com a costa ligada. Os outros cenários continuam em mar aberto (costa desligada), como antes — partindo da baía, vários encontrariam terra em poucos quilômetros.
- **Posição geográfica**: *Definir posição* e *Posição inicial* no mapa mudam a posição da simulação (comando registrado); com a costa ligada, o simulador recusa colocar o casco em terra ou sobre o fundo.

Dados: polígonos de terra do OpenStreetMap (© colaboradores do OpenStreetMap, ODbL; pacote geo-maps) corrigidos com o relevo Terrarium (AWS Open Data/Mapzen: SRTM e outros). A batimetria real da baía não é usada: o fundo de mar aberto é o configurado.

## Duas janelas (dois monitores)

**⧉ 2ª janela** abre a cena numa nova janela, que pode ir para o outro monitor (use *Tela cheia*). A física roda só na janela principal. A segunda espelha o estado pelo canal de comunicação entre janelas do navegador (BroadcastChannel; é preciso o mesmo navegador e o mesmo endereço). O que ela mostra:
- a câmera "Igual ao controle", ou uma câmera própria;
- as mesmas camadas (tanques, vetores, escoamentos);
- os indicadores principais;
- a narração dos roteiros automáticos e as manobras.

Clicar num objeto na segunda janela abre os controles correspondentes na janela principal. A segunda janela tem também os seus próprios botões de camadas: tanques, peso/empuxo, hélice/lemes, vetores de trim, escoamentos, tubulações, identificações, bateria (%), ar comprimido, boias, esteira, sem água, calado/trim, navios e casco, com **☑ Todas** e **☐ Nenhuma**. Eles valem só para ela; um • indica o que foi alterado ali, e "↺ Igual ao controle" volta a seguir a janela principal. Os navios adicionais, as referências de profundidade e a quantidade de peixes chegam a ela junto com as preferências gráficas.

Os botões de câmera *Vista tanques* e *Vista forças* (em todas as telas) mudam o enquadramento e já ligam, respectivamente, os tanques e os vetores. Os botões de camada (*Ver tanques*, *Vetores*, *Trim*) ligam e desligam o que é desenhado. Mantenha a janela principal visível (não minimizada): navegadores pausam a animação de janelas minimizadas, e com isso a simulação também pausa.

## Modo apresentação

A aba **Apresentação** foi feita para quem conduz uma demonstração para um público. A cena, os tanques, os vetores de força e os indicadores ficam juntos, de modo que, ao operar uma válvula, se veja ao mesmo tempo o tanque enchendo, a massa e o peso aumentando, a resultante mudando e a resposta do submarino.

**Situações de aula e condução**
- *Situação de aula* + **Preparar**: carrega o cenário, o estado do mar, o enquadramento e as camadas sugeridas, já pausado. O texto abaixo da lista sugere o que mostrar. As mesmas situações aparecem, com descrição, na aba **Cenários**; o botão **📚 Biblioteca** leva até lá.
- **Executar/Pausar**, **+0,1 s**, **+1 s** e velocidades de **×0,25** a **×10** (câmera lenta abaixo de ×1; a física usa sempre o mesmo passo fixo).
- **↺ Estado inicial** volta exatamente à condição preparada.
- **📌 Marcar "antes"** guarda o estado atual; a tabela **Antes × agora** mostra profundidade, velocidade vertical, atitude, massa, P, E, E − P, volume deslocado, fração imersa e os volumes de cada tanque, com as diferenças. **↩ Voltar ao "antes"** repete a demonstração a partir do ponto marcado.

**Enquadramentos**: *Superfície* (3/4 elevado, mostra esteira e proa), *Submerso*, *Tanques* (corte de perto), *Forças* (vista lateral para os vetores), *Seguir*, *Perseguição*, *Fixa* (câmera parada no cenário, o submarino atravessa o quadro) e *Livre*.

**Casco:** *Externo* (casco opaco, forma externa, vela, lemes e pintura), *Corte* (casco transparente com os componentes internos; transparência ajustável) e *Sem casco* (esconde casco, vela e convés; ficam os componentes internos, lemes, hélice, mastro e o contorno do casco). Trocar a vista do casco não altera a simulação.

**Camadas** (independentes): peso/empuxo, hélice/lemes/resistência, vetores de trim, tanques (corte), tubulações, escoamentos, identificações, **bateria (%)**, **ar comprimido**, esteira, boias/marcos, trajetória, iluminação de apresentação, sem água, calado/trim e navios. **☑ Marcar todas** liga as camadas de informação (não tira a água nem muda a iluminação); **☐ Desmarcar todas** desliga todas — fica só o submarino no mar, sem vetores, textos ou percentuais. Nenhuma camada volta sozinha. **Sem água** esconde o mar, a superfície, o fundo e as partículas para ver o submarino isolado sobre fundo neutro; um clique devolve tudo.

**Camadas de informação dos sistemas** (junto aos componentes, com o corte ligado):
- **Bateria (%)**: carga da bateria (e “carregando”) e geradores em carga. Antes o percentual aparecia sobre o casco fechado na Pilotagem sem opção para ocultar; agora tem camada própria. Os instrumentos e a barra superior continuam mostrando a bateria.
- **Ar comprimido**: para cada grupo de garrafas (AP1, AP2), a **pressão** (p = m·R·T/V), a **massa de ar** armazenada, o **ar livre equivalente** a 1 atm (V·p/p_atm), o volume das garrafas, o estado da válvula e a vazão de **consumo** (sopro) ou **recarga** (compressor) medida no tempo de simulação. Pressão e quantidade são grandezas diferentes: com a válvula aberta os grupos se equalizam na pressão, mas cada um guarda a sua massa.

**Escolha dos vetores**: nas telas Pilotagem e Visualização 3D, o botão **Vetores** liga os vetores e abre um painel recolhível para marcar quais aparecem (peso, empuxo, resultante, hélice, resistência, lemes de vante, ré e direção, trim), com *Todos* e *Nenhum*. O botão **💧 Tirar água / Pôr água** faz o mesmo que a camada *Sem água*.

**Vetores**: peso e empuxo usam a mesma escala (14 m = peso na condição inicial). Como os dois quase se equilibram, a resultante pode ser ampliada (automática: 1, 2 ou 5 × 10ⁿ, ou ×1, ×10, ×100, ×1000); o fator aparece sempre no rótulo. Com o casco todo submerso, encher um tanque só aumenta o peso (o empuxo fica praticamente constante); na superfície, o casco afunda e o empuxo cresce junto com a fração imersa.

**Tanques e escoamentos**: lastro principal (azul), compensação (verde), trim (laranja) e banda (roxo). Clique num tanque (na lista ou no corte) para destacá-lo; os demais ficam discretos. As partículas mostram o sentido e a intensidade das vazões calculadas: ar saindo pelos suspiros (jato acima da água, bolhas debaixo dela), água entrando ou saindo pelos embornais, ar comprimido das garrafas ao coletor e aos TLP durante o sopro, admissão e descarga de compensação e transferências de trim e banda. Válvulas: verde aberta, vermelha fechada, âmbar em curso. Bombas em funcionamento ficam verdes e o rotor gira.

**Manobras automáticas**: a barra sobre a cena mostra a etapa atual, as etapas seguintes e os comandos enviados. Ao terminar, informa **SUCESSO**, **TEMPO ESGOTADO**, **CANCELADA** ou **FALHA** (por exemplo, falta de ar comprimido ou profundidade de teste excedida).

## Roteiros automáticos

Na aba **Cenários**, em **Apresentação** ou em **Pilotagem** (que leva até a Apresentação), *Roteiros automáticos → ▶ Iniciar*. O simulador conduz a operação sozinho, devagar. Em cada etapa ele:
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

### Trim na superfície (por que quase não aparece)

Na superfície o plano de flutuação resiste à inclinação: a rigidez de trim fica ~130× maior que submerso. Os 5 t levados 23 m a vante, que embicam o submarino ~9,5° submerso, mudam o pitch só ~0,09° na superfície — cerca de 6 cm de diferença entre os calados a vante e a ré. É o comportamento físico correto (conferido em `tests/trim-surface.test.ts`). Para perceber:
- **Marcas de calado** pintadas na proa (x = +25 m) e na popa (x = −13,4 m), numerais a cada metro e traços a cada 0,2 m.
- **Camada Calado/trim**: linha d'água do casco (amarela, presa ao casco) × nível do mar (ciano), com as leituras de calado AV e AR, o trim em centímetros e a rigidez em relação à submersa. Os mesmos valores aparecem na aba Trim e banda (painel "Calados e trim").
- **Vista Calado**: câmera lateral rente à água com teleobjetiva, o casco inteiro no quadro.
- **Ampliar trim** (×5 a ×50): multiplica só o ângulo de pitch **desenhado**, para demonstração. Enquanto ligada, todas as cenas (inclusive a 2ª janela) mostram o aviso "TRIM AMPLIADO ×N" com o ângulo real; ao recarregar a página volta ao real.

## Tanques visíveis e visualização salva

- **Tanques visíveis:** ao ligar *Ver tanques*, abre a lista de tanques. Você pode mostrar todos, nenhum (*Nenhum*), só um grupo (lastro principal, compensação, trim, banda) ou tanques individuais — inclusive desmarcar o último. As tubulações e os escoamentos acompanham a seleção.
- **Camadas ▾ (Pilotagem, Visualização 3D e Governo):** abre a lista completa de camadas com **☑ Marcar todas** e **☐ Desmarcar todas** — identificações, tubulações, escoamentos, bateria (%), ar comprimido, esteira, trajetória e as demais, que antes ficavam sempre ligadas nessas telas. Os botões rápidos (Ver tanques, Vetores, Boias…) continuam e refletem a mesma escolha. Com *Identificações* desligadas somem também os rótulos de superfície, cota e fundo e a linha tracejada entre eles.
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

- **Sessão — salvar e continuar:** *Salvar a simulação atual* (guarda no navegador), *Baixar arquivo* (.json para guardar ou abrir em outro computador), *Carregar arquivo* e *Retomar a simulação*. Ao carregar, tudo volta ao ponto salvo — posição, profundidade, rumo, velocidade, inclinação, tempo, tanques, bateria, combustível, ar, válvulas, bombas, telégrafo, lemes, piloto e referências, falhas, alarmes, ambiente e as automações em andamento (manobra rápida, demonstração, roteiro automático, rota) — e a simulação fica **pausada** até *Retomar*. Arquivos de versões anteriores abrem com conversão automática.
- **Identificação do submarino** (VISUAL): nome, inscrição vermelha da vela, emblema e cor dos lemes.
- **Qualidade gráfica** (VISUAL): cena/oceano, texturas e **iluminação da cena**; vale para todas as abas e para a 2ª janela. Também aqui:
  - **Navios adicionais** (0 a 20): tráfego fictício além dos contatos fixos (ver *Mapa tático*).
  - **Referências discretas de profundidade** (ligadas por padrão): faixas finas de partículas em suspensão em cotas fixas, a cada 20 m — ao subir ou descer o submarino as atravessa, o que mostra a variação de profundidade sem linhas nem números — e uma sombra suave no fundo, sob o submarino, que fica mais nítida e escura quanto mais perto do fundo (alinhada ao declive local). A linha tracejada superfície–submarino–fundo também segue esta opção.
- **Vida marinha** (VISUAL): quantidade **Desligada**, **Discreta** (padrão; cerca de 4 peixes à vista em média) ou **Moderada** (cerca de 6), com controles separados para **Saltos ocasionais na superfície** e **Peixes nadando na água e perto do fundo**. Pequenos peixes de cores, tamanhos e trajetórias variados ocupam a água e o fundo; saltos são raros, em locais e intervalos aleatórios. Não aparecem em terra, sob o fundo nem na vista “Sem água”. A animação acompanha o tempo, a pausa e a velocidade da simulação; as preferências ficam salvas no navegador e são enviadas à segunda janela. A fauna é decorativa e não interfere na física.
- **Iluminação da cena** (VISUAL) — também no seletor **Luz** ao lado de “Gráfico” nas cenas 3D (Pilotagem, Visualização 3D, Apresentação):
  - **Natural**: a água escurece com a profundidade, como no mar; o casco escuro fica pouco visível em cotas grandes.
  - **Clara** (padrão): água mais clara, luz suave presa à câmera e contorno do casco realçado — o submarino se destaca do fundo em qualquer profundidade.
  - **Estúdio**: luz forte presa à câmera, para projetor ou sala clara.
  Nenhuma das três altera a física; a escolha fica guardada e chega à 2ª janela.
- **Ambiente** (AGORA): estado do mar, salinidade, temperaturas, termoclina e declinação. *Aplicar agora* mantém o estado; *Usar nos próximos cenários* guarda como padrão.
- **Fundo do mar** (AGORA): uniforme (padrão de 300 m) ou com relevo. O simulador recusa um fundo que ficaria acima do casco na posição atual.
- **Simulação** e **Parâmetros da embarcação** (REINICIAR): passo de integração, semente, instrumentação e parâmetros fictícios do casco, propulsão, bombas, lemes e limites.

A aba **Cenários** é a biblioteca de tudo o que dá para carregar, em três seções. Cada cartão diz o que faz e se o lugar tem costa (**com costa**) ou não (**mar aberto**):
- **Condições iniciais** (*só posiciona*): coloca o navio numa situação de partida e para; o operador conduz. A condição de carga e a compensação pré-calculada valem para estas.
- **Situações de aula** (*posiciona e enquadra*): parte de uma condição inicial e já ajusta o mar, a câmera e as camadas para explicar um tema. *▶ Abrir na Apresentação* prepara a situação (pausada) e abre a aba Apresentação.
- **Roteiros automáticos** (*executa sozinho*): o simulador conduz a operação etapa por etapa, com narração (veja *Roteiros automáticos*).

A palavra "cenário" fica para as condições iniciais. Os cenários que não fixam a costa seguem o que está em Configurações; a indicação do cartão é calculada ao abrir a aba.

## Gravação e reprodução de comandos

Em **Configurações → Gravação e reprodução de comandos**:
- **Iniciar gravação**: guarda a condição atual completa como ponto de partida e passa a registrar cada comando — os seus e os das automações (manobras rápidas, demonstração, roteiro automático, rota) — com o passo fixo e o tempo de simulação em que foi aplicado, além da narração das automações. A barra superior mostra **● REC**.
- **Parar gravação**, **Salvar** (no navegador, até 6), **Baixar gravação** (.json) e **Carregar gravação**.
- **Reproduzir**: volta à condição inicial gravada e reaplica os comandos nos mesmos passos; **Pausar/Continuar**; **Encerrar reprodução** devolve o controle no ponto em que estiver. Durante a reprodução, as automações ficam paradas (seus comandos já estão na gravação, então nada é executado duas vezes) e os comandos manuais são recusados com um aviso.
- **Conferência**: a cada 10 s de simulação a gravação guarda um ponto de controle (posição, atitude, velocidade, bateria e um resumo do estado). Na reprodução o painel mostra quantos pontos ficaram idênticos.

Limitações: trocar de cenário ou reiniciar encerra a gravação (o trecho gravado é mantido). Uma gravação feita em outra versão do simulador abre com aviso; se a física mudou entre as versões, ou se o navegador calcula funções matemáticas de modo ligeiramente diferente, a reprodução pode divergir aos poucos — a conferência mostra o desvio.

## Falhas para treinamento

Na tela **Segurança**, injete:
- **Bomba de compensação:** não é possível esgotar; use velocidade e lemes.
- **Planta hidráulica:** a pressão cai com o uso e os lemes ficam lentos até travar.
- **Bateria isolada:** o barramento depende dos geradores; sem eles, tudo para.
- **Sensor PRF-1 em deriva:** alarme de divergência; o piloto automático usa a média e é afetado.
- **Vazamento no suspiro:** o TLP alaga lentamente mesmo com o suspiro fechado (perda de empuxo na superfície).

## Modo engenharia

Ative ⓘ e clique em qualquer tanque, válvula, bomba, leme ou instrumento. O painel mostra função, variáveis ao vivo (MED/CALC/CMD/VERD), equações, consequências previstas, gráfico antes × depois e a decomposição de forças e momentos (por que sobe, por que muda o pitch, por que guina, por que aderna).

## Celular

A página se adapta à tela do celular, em pé ou deitado (telas de toque pequenas). No PC nada muda, em nenhum tamanho de janela.
- **Cabeçalho compacto**: nome, ▶ Executar/❚❚ Pausar, relógio e **☰**. O ☰ abre o resto: passo a passo, reiniciar, aceleração do tempo, cenário, 2ª janela, engenharia e procedimento. Abaixo ficam os dados principais (profundidade, velocidade, rumo…) numa linha que rola para o lado. Alarmes ativos continuam sempre visíveis. O cabeçalho rola com a página; a barra de abas fica presa no topo.
- **Cenas 3D**: os controles de vista, camadas, mar, gráfico e luz ficam no botão **⚙ Vista**, para não cobrir a cena. Com o celular deitado, a cena ocupa a altura da tela (sobra uma faixa para rolar a página).
- **Diagramas** (fluxo de energia, lastro, trim, linha de eixo, arquitetura de sistemas): mantêm o texto legível e rolam para o lado (“↔ arraste para o lado”).
- Para rolar a página, arraste fora da cena 3D: arrastar dentro dela gira a câmera.
- **Sala de comando**: botões ▲ ▼ ◀ ▶ para andar, arrastar para olhar, toque num posto para se aproximar; o painel da estação abre abaixo da cena.

## Aplicativo Windows

Para gerar e abrir a versão Electron, siga [Executável para Windows](EXECUTAVEL-WINDOWS.md). O aplicativo inclui a simulação local e mantém os comandos descritos neste guia. O botão **2ª janela** abre uma visualização para outro monitor; ao fechar a janela principal, a visualização também é fechada. Os fundos do mapa precisam de internet.
