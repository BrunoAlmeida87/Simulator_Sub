# Simplificações e limitações

O simulador prioriza a coerência física e lógica entre os sistemas, mas usa modelos simplificados. Esta lista documenta as simplificações adotadas na Fase 1.

## Ambiente
- **Ondas lineares (Airy):** espectro de Pierson–Moskowitz com 24 componentes em águas profundas e espalhamento direcional cos². Não há quebra de onda, interação onda–onda, correntes ou vento. O “chop” de Gerstner no 3D é só visual; a física usa a elevação linear das mesmas componentes.
- A força de onda é por fatias (empuxo com a elevação local + inércia de Froude–Krylov + massa adicional Ca = 1); não há difração nem radiação de ondas pelo casco. A sucção média perto da superfície aparece como efeito de segunda ordem desse modelo, não calibrada.
- Perfis de temperatura e salinidade dependem só da profundidade (estratificação horizontal).
- A densidade usada no empuxo é a do nível do eixo, uniforme ao longo do casco.
- O fundo é uma função analítica (declividade + ondulações), sem tipos de sedimento.

## Geometria e hidrostática
- Casco como corpo de revolução; a vela não desloca água (alagamento livre) e não há casco externo separado.
- A compressibilidade do casco é linear e uniforme. A estrutura não falha: os limites são apenas alarmes.
- Tanques representados como prismas com água a partir do fundo. **Não há efeito de superfície livre** (a água não se desloca com a atitude).

## Dinâmica
- CG tratado na origem para os termos inerciais (o desvio de G entra pelos momentos do peso); produtos de inércia desprezados.
- Massa adicional diagonal, constante e escalada pela fração imersa.
- A quantidade de movimento da água admitida nos tanques não é considerada.
- Contato com o fundo por três molas-amortecedores na quilha.

## Hidrodinâmica
- Modelo por componentes (resistência, escoamento cruzado, sustentação do casco, superfícies, Munk), com coeficientes plausíveis mas **não calibrados** em tanque de provas.
- Sem interação hélice–leme (o jato do hélice não aumenta a efetividade do leme a baixa velocidade).
- Sem sucção de superfície nem interação com o fundo (efeito de águas rasas).
- Resistência de ondas na superfície por fator multiplicativo; radiação de ondas como amortecimento linear.
- Curva de sustentação com estol simplificado; eficiência em marcha a ré por fator constante.

## Fluidos e ar comprimido
- Ar isotérmico (sem resfriamento adiabático na expansão).
- Garrafas AP abertas equalizam instantaneamente no coletor.
- Circuitos de compensação, trim e banda são **arquiteturas fictícias** com lógica de alinhamento simplificada. A bomba de transferência não permite fluxo por gravidade quando parada.
- Bombas centrífugas pelas leis de afinidade; potência hidráulica com rendimento constante.

## Energia e propulsão
- Bateria com circuito equivalente linear (sem Peukert, sem temperatura, sem envelhecimento).
- Barramento único; sem disjuntores por carga nem rejeição de cargas por prioridade.
- Sem regeneração: a potência negativa do eixo é dissipada.
- Diesel-geradores com potência despachável e partida temporizada; sem dinâmica térmica.

## Instrumentação e controle
- Sensores com ruído gaussiano, atraso de 1ª ordem e falhas típicas (congelado, deriva, zero, ruído). Sem modelos detalhados de giroscópio e INS.
- O Doppler usa velocidade em relação à água, que é igual à velocidade sobre o fundo porque não há correntes.
- Piloto automático PID com ganhos fixos escalonados por U². Não é um controlador de navio real.

## Segurança
- Limites, alarmes e respostas são **exclusivamente educacionais** e não correspondem a procedimentos ou valores de embarcação real.
- O alagamento não pode ser esgotado (sistema de esgoto previsto para a Fase 3); o rombo pode ser "reparado" pela tela de falhas.

## Peso deslocável
- A carga de 5 t sobre trilho é um recurso didático da embarcação fictícia (massa pontual; o carro não tem dinâmica própria além da velocidade limitada).
- A compensação sugerida anula o binário das cargas deslocadas (peso + tanques de trim). Outros desequilíbrios de trim, como os de compensação e alagamento, aparecem no pitch de equilíbrio estático.

## Representações visuais
- A esteira, a onda de proa, os braços de Kelvin, o rastro do hélice e o jato dos suspiros são **representações** acionadas pelo estado físico (velocidade, empuxo, vazão de ar, proximidade da superfície). Não são soluções de escoamento: o ângulo de Kelvin (≈ 19,5°) e o jato ∝ √(T/ρA) dão a forma e a intensidade.
- O traçado das tubulações e a posição de bombas, válvulas e garrafas no corte são esquemáticos (arquitetura fictícia). As vazões e os estados exibidos são os simulados.
- O nível dos TLP em seção "D" é obtido invertendo a curva área × altura da seção desenhada. O volume mostrado é o simulado, mas a forma do tanque é simplificada.
- A vazão por tanque da compensação é a parcela atribuída a cada tanque pelo modelo (proporcional à abertura da válvula do tanque).

## Interface
- A simulação avança pelo `requestAnimationFrame`. Com a aba do navegador oculta, o tempo simulado fica suspenso.
- O motor roda na thread principal. A separação total (sem DOM) permite migrá-lo para um Web Worker se necessário.
