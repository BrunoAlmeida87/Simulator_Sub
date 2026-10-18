# Guia de operação

## Conceitos

- **Lastro principal (TLP)** faz a transição superfície ↔ imersão: ~208 m³ de reserva de flutuabilidade.
- **Compensação** ajusta o peso submerso para o equilíbrio hidrostático (toneladas).
- **Trim e banda** redistribuem pesos e mudam a atitude de equilíbrio estático.
- **Lemes** produzem forças dinâmicas ∝ U². Sem velocidade não há efeito; com velocidade, mantêm a profundidade mesmo com pequenos desequilíbrios.

## Tela de pilotagem

A aba **Pilotagem** mostra o submarino em 3D (vista lateral, de perseguição ou livre) com os comandos ao lado:
- **Telégrafo:** rotação do eixo; a velocidade cresce lentamente pela inércia.
- **Lemes:** vante e ré (SUBIR/DESCER) e direção (BB/BE). Só funcionam com velocidade.
- **Lastro principal:** suspiros, sopro e sopro de emergência.
- **Mar e gráfico:** o seletor **Mar** (0 calmo a 6 muito grosso) muda as ondas na física e no 3D ao mesmo tempo; o seletor **Gráfico** (baixa/média/alta) ajusta a qualidade do oceano ao aparelho.
- **Manobras rápidas:** "Imergir para X m" (velocidade, suspiros e piloto de profundidade; os suspiros fecham quando os TLP enchem), "Emergir" (sobe com lemes até a cota periscópica e sopra os TLP) e "Manter profundidade". Elas apenas emitem comandos registrados; o comportamento é o da física.

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

## Falhas para treinamento

Na tela **Segurança**, injete:
- **Bomba de compensação:** não é possível esgotar; use velocidade e lemes.
- **Planta hidráulica:** a pressão cai com o uso e os lemes ficam lentos até travar.
- **Bateria isolada:** o barramento depende dos geradores; sem eles, tudo para.
- **Sensor PRF-1 em deriva:** alarme de divergência; o piloto automático usa a média e é afetado.
- **Vazamento no suspiro:** o TLP alaga lentamente mesmo com o suspiro fechado (perda de empuxo na superfície).

## Modo engenharia

Ative ⓘ e clique em qualquer tanque, válvula, bomba, leme ou instrumento. O painel mostra função, variáveis ao vivo (MED/CALC/CMD/VERD), equações, consequências previstas, gráfico antes × depois e a decomposição de forças e momentos (por que sobe, por que muda o pitch, por que guina, por que aderna).
