# Relatório de validação física

Gerado automaticamente por `npm run report` em 2026-10-19T01:52:21.891Z.

Cada caso executa um cenário demonstrativo independente e compara **métricas numéricas** com critérios objetivos. Os mesmos casos são executados por `npm test` (Vitest) e pela tela **Validação** do simulador.

**Resultado: 13 / 13 casos aprovados.**

## ✅ 1. Resposta ao equilíbrio de flutuabilidade

Pairando sem seguimento: admitir 1,5 t de água de compensação deve gerar flutuabilidade negativa de ~1,5 t e afundamento progressivo; esgotar 3 t deve inverter a tendência.

| Métrica | Valor | Unidade | Critério | OK |
|---|---:|---|---|:-:|
| Deriva com equilíbrio neutro (60 s) | 0.0000 | m | |Δz| < 0,5 m | ✓ |
| Flutuabilidade líquida após admitir 1,5 t | -1513.9629 | kg | −1500 ± 150 kg | ✓ |
| Afundamento em 240 s | 30.3203 | m | > 5 m | ✓ |
| Velocidade vertical (descendo) | 0.2145 | m/s | > 0 e ±15 % da terminal prevista | ✓ |
| Velocidade terminal prevista (arrasto cruzado + linear) | 0.2257 | m/s | referência | ✓ |
| Velocidade vertical após esgotar 3 t | -0.1993 | m/s | < 0 (subindo) | ✓ |

> Velocidade terminal: ½·ρ·C_dc·A_lat·v² + c_lin·v = |Δm|·g (peso aparente equilibrado pelo arrasto vertical). (tempo de execução: 1890 ms)

## ✅ 2. Redistribuição longitudinal de massa altera o trim

Transferir 1 t de TT-AV para TT-AR (velocidade nula): proa deve subir; ângulo final comparado com a previsão estática Δθ = Δm·g·Δx / (W·BG).

| Métrica | Valor | Unidade | Critério | OK |
|---|---:|---|---|:-:|
| Massa transferida | 999.1081 | kg | 1000 ± 30 kg | ✓ |
| Variação de pitch (simulada) | 2.8699 | ° | > 0 (proa para cima) | ✓ |
| Variação de pitch (prevista) | 2.8699 | ° | referência | ✓ |
| Erro relativo simulado × previsto | 4.317e-4 | % | < 10 % | ✓ |
| Rigidez longitudinal W·BG | 6.7513 | MN·m/rad | referência | ✓ |

> Oscilação amortecida de longo período (≈ 2π√(I_yy/(W·BG))) antes de estabilizar. (tempo de execução: 1046 ms)

## ✅ 3. Redistribuição transversal de massa altera a banda

Transferir 1 t de TB-BB para TB-BE: o submarino deve adernar para boreste conforme Δφ = Δm·g·Δy / (W·BG).

| Métrica | Valor | Unidade | Critério | OK |
|---|---:|---|---|:-:|
| Massa transferida | 999.1200 | kg | 1000 ± 30 kg | ✓ |
| Variação de banda (simulada) | 0.3997 | ° | > 0 (boreste) | ✓ |
| Variação de banda (prevista) | 0.3997 | ° | referência | ✓ |
| Erro relativo | 8.259e-8 | % | < 10 % | ✓ |

> Arquitetura de banda fictícia (tanques laterais). (tempo de execução: 405 ms)

## ✅ 4. Efetividade dos lemes depende da velocidade

Mesma deflexão dos lemes de ré (10°) a 0, 0,5 e 5 m/s: força ∝ U² (razão ≈ 100 entre 5 e 0,5 m/s) e resposta de pitch muito maior com escoamento significativo.

| Métrica | Valor | Unidade | Critério | OK |
|---|---:|---|---|:-:|
| Força nos lemes de ré a U = 0 | 0.0000 | N | = 0 | ✓ |
| Força a U = 0,5 m/s | 907.6085 | N | referência | ✓ |
| Força a U = 5 m/s | 90760.8529 | N | referência | ✓ |
| Razão de forças (5 / 0,5 m/s) | 100.0000 | — | 100 ± 10 (∝ U²) | ✓ |
| Δpitch em 20 s a 0,5 m/s | 0.1785 | ° | pequeno | ✓ |
| Δpitch em 20 s a 5 m/s | 8.8613 | ° | > 10× o caso lento | ✓ |

> L = ½·ρ·U²·A·C_L(α): sem escoamento não há força hidrodinâmica. (tempo de execução: 141 ms)

## ✅ 5. Rumo responde progressivamente à deflexão do leme

A 6 nós: leme 15° BE ⇒ taxa de guinada cresce gradualmente e o rumo aumenta; 15° BB ⇒ simétrico; leme a meio ⇒ rumo mantido.

| Métrica | Valor | Unidade | Critério | OK |
|---|---:|---|---|:-:|
| Δrumo em 60 s (15° BE) | 27.4077 | ° | > 15° | ✓ |
| Δrumo em 60 s (15° BB) | -27.4028 | ° | < −15° (simétrico ±10 %) | ✓ |
| Δrumo em 60 s (leme a meio) | 0.0019 | ° | |Δψ| < 0,5° | ✓ |
| Taxa de guinada após 5 s | 0.2180 | °/s | < taxa após 60 s (progressiva) | ✓ |
| Taxa de guinada após 60 s | 0.4924 | °/s | referência | ✓ |
| Rumo monotônico (BE) | 1.0000 | bool | 1 | ✓ |

> O casco ganha ângulo de deriva e a guinada se estabelece após o transitório de inércia. (tempo de execução: 338 ms)

## ✅ 6. Bombas e válvulas possuem estados transitórios

Curso das válvulas, partida das bombas e alagamento dos TLP não são instantâneos.

| Métrica | Valor | Unidade | Critério | OK |
|---|---:|---|---|:-:|
| Posição do suspiro em t_curso/2 | 0.5040 | — | 0,5 ± 0,05 | ✓ |
| Posição do suspiro em t_curso | 1.0000 | — | 1,0 | ✓ |
| Enchimento do TLP após 5 s | 12.1335 | % | < 40 % (limitado pela saída de ar) | ✓ |
| Enchimento do TLP após 90 s | 99.9276 | % | > 95 % | ✓ |
| Rotação da bomba em t_partida/2 | 0.5000 | — | 0,5 ± 0,05 | ✓ |
| Vazão da bomba de trim em t_partida/2 | 4.7911 | L/s | < vazão plena | ✓ |
| Vazão plena da bomba de trim | 11.2583 | L/s | > 0 | ✓ |

> O alagamento é limitado pela vazão de ar através do suspiro (orifício compressível). (tempo de execução: 325 ms)

## ✅ 7. Coerência entre profundidade e pressão

A pressão externa cresce monotonicamente com a profundidade (≈ 1 bar/10 m), a leitura do sensor coincide com o estado e a profundidade indicada usa ρ_cal.

| Métrica | Valor | Unidade | Critério | OK |
|---|---:|---|---|:-:|
| Pressão monotônica com a profundidade | 1.0000 | bool | 1 | ✓ |
| Gradiente entre 90 e 100 m | 1.0066 | bar/10 m | 1,00 ± 0,03 | ✓ |
| Erro ρ médio × ρ(z/2) | 7.400e-5 | % | < 0,5 % | ✓ |
| Sensor PEXT − pressão real | 0.0000 | bar | |Δ| < 1e−6 | ✓ |
| Profundidade indicada − geométrica | 0.0529 | m | |Δ| < 1 % (efeito de ρ_cal) | ✓ |
| Pressão a 300 m (absoluta) | 31.2170 | bar | ≈ 31,3 | ✓ |

> dp/dz = ρ(S,T,p)·g integrada com EOS-80; profundímetro: z = (p − p_atm)/(ρ_cal·g), ρ_cal = 1025 (tempo de execução: 5 ms)

## ✅ 8. Estado válido com pausa, reinício, aceleração e salvamento

Passo fixo: ×1 e ×10 produzem estados idênticos; pausa não altera o estado; reinício reproduz o cenário; salvar/recuperar continua identicamente.

| Métrica | Valor | Unidade | Critério | OK |
|---|---:|---|---|:-:|
| Passos executados (×1) | 1500.0000 | passos | referência | ✓ |
| Estado ×1 = estado ×10 (mesmo tempo simulado) | 1.0000 | bool | 1 | ✓ |
| Estado inalterado durante pausa | 1.0000 | bool | 1 | ✓ |
| Reinício reproduz o cenário | 1.0000 | bool | 1 | ✓ |
| Continuação após salvar/recuperar idêntica | 1.0000 | bool | 1 | ✓ |
| Variáveis de estado finitas | 1.0000 | bool | 1 | ✓ |

> Determinismo: acumulador de tempo real com passo fixo dt = 0,02 s. (tempo de execução: 357 ms)

## ✅ 9. Instrumentos consistentes com o estado simulado

Sem ruído, as leituras coincidem com as grandezas físicas; com instrumentação avançada, o erro médio é pequeno e o desvio corresponde ao ruído configurado.

| Métrica | Valor | Unidade | Critério | OK |
|---|---:|---|---|:-:|
| Girobússola − rumo real | 0.0000 | ° | < 1e−6 | ✓ |
| Agulha magnética − (rumo − declinação) | 0.0000 | ° | < 1e−6 | ✓ |
| INS pitch − pitch real | 0.0000 | ° | < 1e−9 | ✓ |
| INS banda − banda real | 0.0000 | ° | < 1e−9 | ✓ |
| Doppler − velocidade real | 0.0000 | m/s | < 1e−9 | ✓ |
| Ecobatímetro − altitude real | 0.0000 | m | < 1e−9 | ✓ |
| Profundímetro − conversão da pressão | 0.0000 | m | < 1e−9 | ✓ |
| Modo avançado: erro médio do profundímetro | 6.372e-4 | m | |média| < σ | ✓ |
| Modo avançado: RMS do erro | 0.0515 | m | ≈ σ (0,5σ … 2σ) | ✓ |

> Classificação na interface: MED (sensor), CALC (calculado), CMD (comando). (tempo de execução: 190 ms)

## ✅ 10. Sem geração artificial de massa ou energia

Sequência com mergulho, compensação, sopro e diesel: balanços de massa e energia fecham; casco sem propulsão perde energia mecânica monotonicamente.

| Métrica | Valor | Unidade | Critério | OK |
|---|---:|---|---|:-:|
| Erro do balanço de massa interna | -2.894e-4 | kg | |erro| < 1 kg | ✓ |
| Água admitida do mar | 799.9830 | kg | referência | ✓ |
| Água descarregada ao mar | 1199.7386 | kg | referência | ✓ |
| Ar ventilado + derramado | 1385.4893 | kg | referência | ✓ |
| Ar comprimido admitido (compressor) | 14.4000 | kg | referência | ✓ |
| Combustível queimado | 5.9125 | kg | > 0 (diesel operou) | ✓ |
| Bateria: E_química − E_terminais − perdas | -3.763e-7 | J | |erro| < 1 J | ✓ |
| Barramento: cargas − (geradores + bateria) | 0.0000 | J | |erro| < 1 J | ✓ |
| Trabalho no hélice ≤ energia elétrica | 0.7809 | — | < 1 | ✓ |
| Energia cinética do casco passivo não cresce | 1.0000 | bool | 1 | ✓ |
| Energia cinética inicial → final | 0.2641 | fração | < 1 | ✓ |

> Massa interna exclui a água livre dos TLP (comunicante com o mar). Fronteiras: admissão/descarga de mar, ar ventilado/derramado, compressor, combustível compensado, alagamentos. (tempo de execução: 1911 ms)

## ✅ Extra: ondas — resposta decai com a profundidade

Mesmo espectro de ondas (estado do mar 4) na física e no oceano 3D: na superfície o submarino joga; a 100 m a resposta praticamente desaparece (e^−kz); com mar calmo não há movimento; na cota periscópica as cristas cobrem o snorkel.

| Métrica | Valor | Unidade | Critério | OK |
|---|---:|---|---|:-:|
| Hs do estado do mar 4 | 2.0000 | m | referência | ✓ |
| Velocidade vertical RMS na superfície | 0.2088 | m/s | > 0,05 | ✓ |
| Taxa de pitch RMS na superfície | 0.2983 | °/s | > 0,05 | ✓ |
| Velocidade vertical RMS a 100 m | 9.666e-4 | m/s | referência | ✓ |
| Razão 100 m / superfície | 0.0046 | — | < 0,1 (decaimento exponencial) | ✓ |
| Velocidade vertical RMS com mar calmo | 1.061e-8 | m/s | < 1e−3 | ✓ |
| Snorkel em mar 5: amostras com válvula de cabeça fechada | 53.0000 | de 120 | > 0 (cristas cobrem a cabeça) | ✓ |
| Snorkel em mar 5: amostras com válvula aberta | 67.0000 | de 120 | > 0 | ✓ |

> Empuxo por fatia com a elevação local, forças de inércia da água (Froude–Krylov + massa adicional) e escoamento relativo; o oceano 3D usa as mesmas componentes. Perto da superfície surge uma força média para baixo e um momento de proa para baixo (sucção de ondas), compensados aqui pelo piloto automático de profundidade. (tempo de execução: 2661 ms)

## ✅ Extra: equação de estado EOS-80 e hidrostática

Valores de verificação publicados da UNESCO e volume submerso igual ao volume geométrico do envelope.

| Métrica | Valor | Unidade | Critério | OK |
|---|---:|---|---|:-:|
| ρ(35, 5 °C, 0 bar) | 1027.6755 | kg/m³ | 1027,67547 ± 0,001 | ✓ |
| ρ(35, 5 °C, 1000 bar) | 1069.4891 | kg/m³ | 1069,48914 ± 0,001 | ✓ |
| ρ(35, 25 °C, 1000 bar) | 1062.5382 | kg/m³ | 1062,53817 ± 0,001 | ✓ |
| Volume imerso (totalmente submerso, atitude qualquer) | 1763.9370 | m³ | = volume do envelope | ✓ |
| Volume imerso fora d’água | 0.0000 | m³ | = 0 | ✓ |
| Reserva de flutuabilidade (TLP) | 11.7918 | % do envelope | 8–15 % | ✓ |
| Borda livre do casco na superfície | 1.1525 | m | > 0 | ✓ |
| Pitch de equilíbrio na superfície | 0.2287 | ° | |θ| < 1,5° | ✓ |

> Fofonoff & Millard (1983), UNESCO Tech. Pap. Mar. Sci. 44. (tempo de execução: 13 ms)

## ✅ Extra: sequência completa de operação

Superfície → mergulho → 50 m → equilíbrio → mudança de rumo → ajuste de trim → emersão, executada por um operador automatizado (roteiro de demonstração).

| Métrica | Valor | Unidade | Critério | OK |
|---|---:|---|---|:-:|
| Preparar: ordenar 6 nós | 45.0000 | s | velocidade > 4 nós | ✓ |
| Mergulhar: abrir suspiros dos TLP | 77.0000 | s | TLP > 95 % cheios | ✓ |
| Descer com lemes a 50 m (piloto de profundidade) | 192.0000 | s | |z − 50| < 2 m | ✓ |
| Fechar suspiros e equilibrar (compensação) | 209.0000 | s | |flutuabilidade líquida| < 300 kg | ✓ |
| Alterar rumo em +90° | 302.0000 | s | erro de rumo < 2° | ✓ |
| Ajustar trim (equilíbrio estático < 0,5°) | 308.0000 | s | |θ_eq estático| < 0,5° | ✓ |
| Emergir: subir a cota periscópica e soprar TLP | 400.0000 | s | quilha < 8 m (superfície) | ✓ |

> O mesmo roteiro está disponível na interface como "Demonstração automática". (tempo de execução: 935 ms)
