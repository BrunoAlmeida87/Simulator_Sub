# Simplificações e limitações

O simulador prioriza a coerência física e lógica entre os sistemas, mas usa modelos simplificados. Esta lista documenta as simplificações adotadas.

**Escopo da validação.** Os testes verificam sinais, simetrias, balanços de massa e energia nas sequências ensaiadas e regressões conhecidas (ver `docs/VALIDACAO.md`). Eles **não** provam conservação de massa e energia em todas as condições nem fidelidade quantitativa de engenharia: os coeficientes não são calibrados em tanque, CFD ou dados de mar. O SX-1 é fictício.

## Ambiente
- **Ondas lineares (Airy):** espectro de Pierson–Moskowitz com 24 componentes em águas profundas e espalhamento direcional cos². Não há quebra de onda, interação onda–onda, correntes ou vento. O “chop” de Gerstner no 3D é só visual; a física usa a elevação linear das mesmas componentes.
- A força de onda é por fatias (empuxo com a elevação local + inércia de Froude–Krylov + massa adicional Ca = 1); não há difração nem radiação de ondas pelo casco. A sucção média perto da superfície aparece como efeito de segunda ordem desse modelo, não calibrada.
- Perfis de temperatura e salinidade dependem só da profundidade (estratificação horizontal).
- A densidade usada no empuxo é a do nível do eixo, uniforme ao longo do casco.
- O fundo é uniforme (padrão, 300 m) ou uma função analítica (declividade + ondulações), sem tipos de sedimento.
- Ondas sempre em águas profundas (k = ω²/g), mesmo nos cenários rasos. A pressão dinâmica da onda usa g = 9,80665 m/s² fixo. As pressões de embornais e suspiros dos TLP e a imersão do hélice usam o nível médio (sem a onda); sensores e snorkel usam a superfície local. Os lemes não recebem a velocidade orbital das ondas, e não há excitação de onda em surge.

## Geometria e hidrostática
- Casco como corpo de revolução; a vela não desloca água (alagamento livre) e não há casco externo separado.
- Lemes de vante na vela e superfícies de ré totalmente móveis (sem estabilizadores fixos). Na superfície os lemes de vela ficam fora d'água e não produzem força; a interação esteira da vela × lemes de ré não é modelada.
- A compressibilidade do casco é linear e uniforme. A estrutura não falha: os limites são apenas alarmes.
- Tanques internos representados como prismas ao longo do comprimento, com seção que acompanha o casco resistente (fundo/costado abaulados), e água a partir do fundo. **Não há efeito de superfície livre** (a água não se desloca com a atitude).

## Dinâmica
- CG tratado na origem para os termos inerciais (o desvio de G entra pelos momentos do peso); produtos de inércia desprezados.
- Massa adicional diagonal, constante e escalada pela fração imersa.
- A quantidade de movimento da água admitida nos tanques não é considerada.
- Contato com o fundo por três molas-amortecedores na quilha, com força vertical (não acompanha a inclinação do fundo).
- O acoplamento translação–rotação da massa adicional (força a₁×ω e momento de Munk a₁×v) usa o mesmo fator k_Munk = 0,75 nos dois termos, o que mantém nula a potência desse par. A redução viscosa real do momento de Munk não é calibrada.
- Integração: RK4 só no corpo rígido; eixo e energia por Euler explícito, água dos TLP por Euler implícito, atuadores discretos e acoplamento sequencial. O conjunto **não** é de 4ª ordem (no mergulho de 30 s o erro cai ~pela metade com dt/2, como num método de 1ª ordem).
- Rigidez de pitch e banda calculada com sinal: com rigidez negativa (equilíbrio instável) não há previsão linear do ângulo de equilíbrio. A previsão é linear (pequenos ângulos).

## Hidrodinâmica
- Modelo por componentes (resistência, escoamento cruzado, sustentação do casco, superfícies, Munk), com coeficientes plausíveis mas **não calibrados** em tanque de provas.
- Sem interação hélice–leme (o jato do hélice não aumenta a efetividade do leme a baixa velocidade).
- Sem sucção de superfície nem interação com o fundo (efeito de águas rasas).
- Resistência de ondas na superfície por fator multiplicativo; radiação de ondas como amortecimento linear.
- Curva de sustentação com estol simplificado; eficiência em marcha a ré por fator constante. O arrasto de separação dos lemes cresce suavemente entre 17° e 23° de ângulo de ataque (transição empírica, sem calibração).
- A sustentação do casco usa |u| (em marcha a ré também se opõe à velocidade transversal), com o centro de pressão espelhado em ré; esse centro em ré não é calibrado.
- Hélice: K_T e K_Q lineares no avanço J, proporcionais a |n|. Com o eixo parado não há arrasto da hélice nem autorrotação; frenagem e marcha a ré são extensões simplificadas, não um modelo de quatro quadrantes.

## Fluidos e ar comprimido
- Ar isotérmico e gás ideal (sem resfriamento na expansão rápida nem fator de compressibilidade a 250 bar).
- A pressão interna dos TLP usa a altura de água no referencial do tanque (sem projeção na atitude) e não há superfície livre. O suspiro só deixa o ar sair; a admissão de ar atmosférico ocorre apenas com os embornais emersos.
- Garrafas AP abertas equalizam instantaneamente no coletor.
- Circuitos de compensação, trim e banda são **arquiteturas fictícias** com lógica de alinhamento simplificada. A bomba de transferência não permite fluxo por gravidade quando parada.
- Bombas centrífugas pelas leis de afinidade; potência hidráulica com rendimento constante. A distribuição da admissão entre os ramais da compensação usa pesos de abertura × capacidade; o grafo de válvulas verifica os caminhos, mas não resolve pressões e perdas em cada ramo.
- Sequências automáticas de compensação: o pedido é limitado à capacidade dos tanques ligados; sem vazão por 15 s, a sequência é encerrada e informa quanto faltou.
- Hidráulica: a pressão é um estado com taxa de recarga e consumo equivalente (sem volume do acumulador nem balanço de energia). Válvulas marcadas como não hidráulicas (sopro de emergência e isolamento das ampolas) movem sem a planta.

## Energia e propulsão
- Bateria com circuito equivalente linear (sem Peukert, sem temperatura, sem envelhecimento).
- Barramento único; sem disjuntores por carga nem rejeição de cargas por prioridade. A demanda não atendida (sobrecarga da bateria ou barramento desenergizado) é registrada, mas as cargas continuam operando no passo em que faltou energia; só a propulsão é limitada no passo seguinte.
- Recarga plena até 90 % de SoC e reduzida linearmente a zero em 100 %; a bateria vazia aceita recarga. A eficiência de recarga (0,92) reduz o ganho de SoC, mas o balanço "químico" integra V_oc·I.
- Geradores sem consumo em vazio, eficiência em carga parcial nem rampa de carga; se o combustível acabar no meio de um passo, a energia daquele passo não é reduzida.
- Sem regeneração: a potência negativa do eixo é dissipada.
- Diesel-geradores com potência despachável e partida temporizada; sem dinâmica térmica.

## Instrumentação e controle
- Sensores com ruído gaussiano, atraso de 1ª ordem e falhas típicas (congelado, deriva, zero, ruído). Sem modelos detalhados de giroscópio e INS.
- A profundidade usada pelo piloto é a média dos dois profundímetros, **sem votação nem tolerância a falhas**: um canal congelado ou zerado conduz o piloto (útil para treinar a falha). A navegação estimada usa a velocidade vertical verdadeira, e q/r são usados como taxas de pitch/rumo (pequenos ângulos). Os alarmes usam grandezas verdadeiras, não as medições.
- O Doppler usa velocidade em relação à água, que é igual à velocidade sobre o fundo porque não há correntes.
- Piloto automático PID com ganhos fixos escalonados por U². Não é um controlador de navio real. Em marcha a ré o pitch ordenado pela malha de profundidade se inverte (ż ≈ −u·sen θ), com passagem contínua entre 0 e −0,5 m/s; a sintonia foi feita avante. Não há filtro de ondas: na cota periscópica com mar, os lemes de ré acompanham o caturro de cada onda (ângulo pequeno, mas em movimento contínuo).

## Segurança
- Limites, alarmes e respostas são **exclusivamente educacionais** e não correspondem a procedimentos ou valores de embarcação real.
- O alagamento não pode ser esgotado (sistema de esgoto previsto para a Fase 3); o rombo pode ser "reparado" pela tela de falhas.

## Peso deslocável
- A carga de 30 t sobre trilho (da qual se escolhe quanto deslocar, sem mudar a massa total) é um recurso didático da embarcação fictícia (massa pontual; o carro não tem dinâmica própria além da velocidade limitada).
- A compensação sugerida anula o binário das cargas deslocadas (peso + tanques de trim). Outros desequilíbrios de trim, como os de compensação e alagamento, aparecem no pitch de equilíbrio estático.

## Representações visuais
- A esteira, a onda de proa, os braços de Kelvin, o rastro do hélice e o jato dos suspiros são **representações** acionadas pelo estado físico (velocidade, empuxo, vazão de ar, proximidade da superfície). Não são soluções de escoamento: o ângulo de Kelvin (≈ 19,5°) e o jato ∝ √(T/ρA) dão a forma e a intensidade.
- O traçado das tubulações e a posição de bombas, válvulas e garrafas no corte são esquemáticos (arquitetura fictícia). As vazões e os estados exibidos são os simulados.
- O nível dos TLP em seção "D" é obtido invertendo a curva área × altura da seção desenhada. O volume mostrado é o simulado, mas a forma do tanque é simplificada.
- A vazão por tanque da compensação é a parcela atribuída a cada tanque pelo modelo (proporcional a abertura da válvula × capacidade do tanque; o que um tanque cheio ou vazio não aceita passa aos outros ramais abertos). A vazão de cada trecho do coletor é obtida por conservação de massa entre os nós (admissão, bomba, tanques); a diferença de densidade entre a água do mar admitida e a nominal (~0,1 %) é desprezada na animação.
- Descarga dos diesel-geradores: a existência da descarga vem do estado dos geradores (EM CARGA queima combustível; em PARTINDO a descarga é só animação da partida, sem consumo nem energia contabilizados) e o caminho do mastro (içado → mastro; recolhido → dispersores atrás da vela). A posição dos dispersores, a quantidade de bolhas e a carga mínima de 15 % atribuída a um gerador em carga para a intensidade do efeito são representações, não medidas.
- As referências de profundidade (faixas a cada 20 m e sombra no fundo) são auxílios visuais; não representam camadas físicas da água.
- A iluminação subaquática não é medida: no perfil **Clara** (padrão) e **Estúdio** a água é mais clara do que no mar real a essa profundidade e há uma luz presa à câmera, para o submarino ficar visível. O perfil **Natural** aproxima o escurecimento com a profundidade.

## Interface
- A simulação avança pelo `requestAnimationFrame`. Com a aba do navegador oculta, o tempo simulado fica suspenso.
- O motor roda na thread principal. A separação total (sem DOM) permite migrá-lo para um Web Worker se necessário.

## Costa, navios e estaleiro

- A costa cobre só a região de Sepetiba (−23,20° a −22,80°; −44,20° a −43,50°). Fora dela, a borda da grade é estendida (ao sul, mar aberto).
- Linha de costa com resolução de ~50 m (polígonos simplificados do OpenStreetMap) e relevo de 200 m; a batimetria é **estimada** e a real (rasa) da baía não é usada — o fundo de mar aberto é o configurado e a transição até a orla é uma curva suave.
- Os navios são apenas visuais (sem colisão): são os contatos fictícios do quadro tático e o tráfego adicional, não posições AIS reais. O tráfego adicional é sorteado em volta da origem do cenário (raio de 1,2 a 9 km); perto da costa podem caber menos navios do que o pedido, porque trechos sem água suficiente são recusados.
- Estaleiro da Ilha da Madeira: contornos traçados em imagem Sentinel-2 de 10 m (precisão ≈ ±10 m). Galpões, tanques e guindastes têm posição, tamanho e altura **estimados** (não há medidas oficiais publicadas) e são só visuais, assim como o submarino no shiplift e o píer do Porto Sudeste. A profundidade dragada da bacia (16 m) é estimada. O contato do casco com os cais é o mesmo modelo de contato com o fundo (pontos da quilha), sem impacto lateral.
- A costa de 50 m vem do OpenStreetMap anterior à obra; o aterro, os quebra-mares e a dragagem do estaleiro são sobrepostos a ela.
- A costa vem desligada nos cenários originais (feitos para mar aberto); ligue em Configurações.

## Efeitos visuais do mar
- O **vento** é só visual (não há vento na física): direção = sentido das ondas, intensidade típica do estado do mar; o vento aparente usa a velocidade do submarino sobre o fundo.
- A **descarga dos diesel** (bolhas atrás da vela) e a **aspiração do snorkel** são efeitos derivados do estado dos geradores e do mastro; não há modelo de pluma térmica, contrapressão da descarga nem mistura do gás com água.
- Peixes e cardumes são decorativos (sem comportamento de fuga nem interação com o submarino).

## Sala de comando e periscópio
- O arranjo da sala, os consoles e as telas são **ilustrativos**, inspirados em salas de controle de submarinos convencionais; não reproduzem nenhum navio real.
- O periscópio não tem arrasto nem esteira na física (nem limite de velocidade com ele içado; o aviso de esteira acima de 5 nós é só informativo). A visada usa a mesma cena 3D externa (sem distorção óptica); as ondas na ocular são um efeito de tela.
- Identificação, alcance visual (horizonte geométrico) e estadímetro do periscópio são **auxílios ilustrativos**: a altura do mastro é a típica da classe, sem refração, visibilidade meteorológica nem iluminação noturna. As marcações são anotações da interface (não entram na gravação).
- O som da sala é sintetizado e ilustrativo (não são gravações reais); a voz depende das vozes pt-BR instaladas no navegador.
- Escotilhas (torre, vante e ré) não são modeladas: o indicador de aberturas do casco as mostra sempre fechadas.
- A exposição do periscópio, do GPS e do MAGE usa a posição de cada cabeça de mastro com o caturro e o balanço, sobre o nível médio da água; a onda entra só no efeito de água na ocular.
- Sonar passivo e MAGE são **modelos ilustrativos** (perdas esféricas, ruído próprio crescendo com a velocidade, zona cega a ré, emissores por tipo de navio); não há propagação acústica real, camadas de sombra nem classificação por assinatura.
- O sistema de combate é fictício. O lançamento de armas é um **tiro de exercício** ilustrativo (seção *Torpedos*).
- A inclinação da sala (opção) gira a vista de quem anda em torno da cabeça, mantida na vertical; não há equilíbrio, deslizamento nem objetos soltos. Sentado num posto, a câmera é solidária ao navio; a atitude aparece nos instrumentos, na bolha e no pêndulo.

## Torpedos (tiro de exercício)
- A arma é um F21 **de exercício** com valores de ordem de grandeza pública; não representa o desempenho real de nenhum torpedo, nem procedimentos de nenhuma marinha.
- A corrida é **cinemática**: velocidade com partida de 1ª ordem, guinada e variação de cota limitadas, sem hidrodinâmica da arma, correntes, ondas, ruído próprio, cavitação ou consumo variável da bateria. O autodiretor é um cone com alcance fixo (sem acústica, reverberação, despistadores ou perda de contato por ruído); a guiagem pelo fio vai ao ponto de interceptação com o rumo e a velocidade verdadeiros do alvo.
- O alvo não reage (não manobra nem sofre dano): é tiro de exercício, a arma passa sob ele e flutua.
- A ejeção usa aceleração constante no tubo e não modela o pulso de pressão, a bolha de ar nem a água empurrada para fora do tubo; o ar da garrafa vai para dentro do casco sem alterar a pressão interna (constante no simulador).
- A compensação automática é ideal (sem atraso de válvulas nem bomba própria); a correção do binário usa a transferência automática do sistema de trim.
- A partir da antepara de vante os tubos passam dentro do TLP-1; o volume do TLP-1 na física não desconta os tubos.

## Rio de Janeiro, sol e luzes (só visual)

- Rio de Janeiro: a batimetria real da Baía de Guanabara e da orla não é usada — o fundo segue a profundidade configurada com a faixa costeira genérica. Lagoas (Rodrigo de Freitas, Jacarepaguá) e ilhotas com menos de ~6 células de 50 m entram como terra ou somem da costa física. A Ponte Rio–Niterói e o Cristo Redentor são só visuais (sem colisão); o traçado da ponte segue a imagem de satélite.
- A imagem de satélite é de uma única data (agosto/2024, 22–30 m por pixel): de perto a textura fica borrada, e prédios aparecem só como cor sobre o relevo (o modelo de 30 m é de superfície e inclui parte das edificações).
- Sol: caminho do equinócio (declinação zero) na latitude de −23°, sem estações do ano; sem sombras projetadas. A lua é sempre cheia e oposta ao sol.
- Luzes da cidade à noite: estimadas pela cor da imagem (áreas cinzentas = urbanas), não por dados reais de iluminação.
- Luzes de navegação e faróis não interferem na física nem nos sensores; os faróis não espalham luz fora dos feixes desenhados.
- Submarinos atracados no estaleiro: decorativos (sem colisão).
