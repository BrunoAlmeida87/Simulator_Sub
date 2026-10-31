# Parâmetros da embarcação fictícia SX-1 "Marlim"

Todos os valores são **fictícios**, escolhidos com ordem de grandeza pública para um submarino convencional de ~70 m. Nenhum valor corresponde a um navio real. A fonte única é `src/sim/config/defaultVessel.ts`; a maioria pode ser alterada na aba **⚙ Configurações** (ambiente e fundo sem reiniciar; embarcação e passo ao reiniciar o cenário).

## Dimensões e massas

| Parâmetro | Valor | Observação |
|---|---|---|
| Comprimento total | 70 m | |
| Diâmetro do casco | 6,2 m | corpo de revolução |
| Proa (elíptica) / popa (parabólica) | 9 m / 20 m | |
| Volume do envelope | 1 763,9 m³ | calculado (100 fatias) |
| Área molhada | 1 220 m² | × 1,1 para apêndices |
| Centro de carena submerso (x) | +2,64 m | a vante da meia-eslora |
| Deslocamento submerso | ≈ 1 807 t | a 50 m, ρ ≈ 1 025 kg/m³ |
| Deslocamento na superfície | ≈ 1 594 t | TLP vazios |
| Reserva de flutuabilidade | ≈ 213 t (11,8 %) | volume dos TLP |
| Peso leve (automático) | ≈ 1 436 t | condição de projeto: neutro a 100 m, S = 35, T = 15 °C |
| BG de projeto | 0,38 m | G abaixo de B |
| Raios de giração (peso leve) | k_xx 2,4 m · k_yy = k_zz 17 m | |
| Compressibilidade do casco | 4,6 × 10⁻¹⁰ Pa⁻¹ | sobre o volume não TLP |
| Calado na superfície (quilha) | ≈ 5,05 m | 88 % do envelope imerso |
| Mastro do snorkel | x = +8 m, curso 4,5 m, 12 s | hidráulico |
| Periscópio de ataque | x = +12 m, curso 5,0 m, 8 s | hidráulico (mesmo consumo por curso do snorkel); sem efeito hidrodinâmico; cabeça fora d’água com a quilha a ≈ 16 m |

### Cargas variáveis (padrão)

| Item | Massa | Posição x |
|---|---|---|
| Tripulação e mantimentos | 9 t | +4 m |
| Carga útil (fictícia), sem os torpedos | 4,4 t | +19 m |
| Torpedos nos tubos (6 × 1,6 t) | 9,6 t | +27,5 m (estivados nos tubos) |
| Água doce e lubrificantes | 6 t | −6 m |
| Combustível (100 m³, tanque compensado de 120 m³) | 84 t + 20,5 t de água | −2 m |
| Condição de carga leve / pesada | −6 t / +6 t | +3 m |
| Peso deslocável (carga existente; desloca-se 2 a 30 t, padrão 5 t, sem mudar a massa total) | 30 t | +2 m (neutra), trilho −25 a +25 m |
| Cargas deslocáveis: torpedos de reserva (2 × 1,6 t; 0,25 m/s) | 3,2 t | +13 m (estiva), +11 a +22 m |
| Cargas deslocáveis: tripulantes (16 × 85 kg; 0,8 m/s) | 1,36 t | −10 m (estiva), −14 a +22 m |
| Cargas deslocáveis: mantimentos (12 × 50 kg; 0,4 m/s) | 0,6 t | −3 m (estiva), −14 a +22 m |

As cargas deslocáveis (`mass.shiftLoads`) entram na condição de projeto na posição de estiva — o peso leve automático as desconta, então massa total e centro de gravidade não mudam —; deslocadas, só criam momento de trim. Arquivos salvos antes delas continuam sem elas.

## Tanques

| Tanque | Capacidade | Centro (x, y, z) | Observação |
|---|---|---|---|
| TLP-1 BB / BE | 58 m³ cada | (28,0; ∓1,35; 0) | suspiro 350 cm², embornais 0,6 m², sopro 3 cm² |
| TLP-2 BB / BE | 46 m³ cada | (−23,5; ∓1,15; 0) | suspiro 280 cm², embornais 0,5 m², sopro 2,5 cm² |
| TC (compensação central) | 22 m³ (um só tanque) | (2,6; 0; 2,25) | sob o CG; seção 2,6 × 1,5 m recortada pelo casco resistente (R 2,9 m), fundo abaulado, 6,5 m de comprimento; ramal VC no coletor |
| TT-AV / TT-AR (trim) | 12 m³ cada (iniciam com 6 m³) | (21,5 / −13,0; 0; 2,2) | braço de 34,5 m; seção 2,2 × 1,4 m com fundo abaulado (R 2,9 m) |
| TB-BB / TB-BE (banda, fictícios) | 5 m³ cada | (2,6; ∓2,25; 1,05) | junto ao costado: seção 1,3 × 2,5 m recortada pelo casco (R 2,9 m), 2,0 m de comprimento; braço ≈ 4,1 m a meio nível (o centroide muda com o nível); ao lado do TC; também compensação (ramais VC-BB / VC-BE) |
| Garrafas AP normais (AP1 / AP2) | 4 m³ a 250 bar cada | | ≈ 1 188 kg de ar cada; coletor normal |
| Ampolas de emergência (AE1 / AE2) | 2 m³ a 250 bar cada | | ≈ 594 kg de ar cada; coletor independente, isoladas inicialmente |

## Tubos lançadores e torpedos (`vessel.weapons`, `defaultWeapons()` em `defaultVessel.ts`)

| Item | Valor | Observação |
|---|---|---|
| Tubos | 6 × 533 mm (furo 556 mm, parede 32 mm) | retos, paralelos ao eixo; colunas em y = ±0,7 m, fileiras em z = −0,6 / 0,2 / 1,0 m; culatra em x = 24,1 m |
| Comprimento | 9,7 a 10,4 m | até a parede chegar a 3 cm do casco externo; portas no nariz da proa (x ≈ 33,9–34,9 m) |
| Arma | F21 de exercício (ordem de grandeza pública): 1,6 t, 6,4 m, 1,3 m³ | velocidade baixa 25 nós / 50 km, alta 50 nós / 20 km; partida 2,5 s; guinada 12 °/s; cota 2,5 m/s |
| Guiagem | fio de 50 km; distância de segurança 200 m | autodiretor: 1,8 km, cone ±45°; acerto de exercício a < 25 m do alvo (passa sob ele) |
| Fim de corrida | subida a 1 m/s | exercício: flutua para ser recolhida; combate: afunda |
| Arma de combate | espoleta de proximidade 12 m (distância 3D, `weapon.fuzeRadius`) | só contra submarino inimigo; desce à cota do alvo na aproximação final |
| Submarino inimigo (`weapons.enemy`) | fuga 9 nós, guinada 1,5 °/s, cota 0,5 m/s, aceleração 0,06 m/s² | alerta a 2,5 km do torpedo em ataque; atingido, afunda a 1,2 m/s; cota ≥ 15 m e ≥ 12 m acima do fundo |
| Ejeção | 13 m/s na boca, aceleração constante no tubo (≈ 1,5 s) | reação −(m_arma + ½ m_água)·a no meio do tubo |
| Garrafa de lançamento | 0,25 m³ a 150 bar (≈ 45 kg de ar) | mínimo 100 bar para disparar; recarga do coletor AP a 0,4 kg/s; sobram 20 bar |
| Alagamento / drenagem | 0,02 / 0,03 m³/s | água do / para o TCA |
| Equalização | constante de tempo 2 s | a porta só abre com Δp < 0,05 bar |
| Porta da boca / culatra | 12 s / 6 s | hidráulicas |
| Recarga | 300 s | da reserva (`shiftLoads.torpedos`, 2 armas) |
| TCA-BB / TCA-BE | 5,2 m³ cada (iniciam com 3,5 m³) | (21,6; ∓1,75; 2,0), seção 1,2 × 1,0 m recortada pelo casco (R 2,9 m), x ≈ 18,7…24,5 m, sob o piso da sala de torpedos |
| Compensação automática | até 40 kg/s | mantém W = Σ armas nos tubos + água dos tubos + TCA + reserva; corrige o binário por transferência TT-AV ↔ TT-AR quando passa de ≈ 1 t·m |

As 6 armas, a água inicial dos TCA e o ar das garrafas entram na condição de projeto (o peso leve automático as desconta); com a carga útil reduzida nas mesmas 9,6 t, a massa total e o G do navio no início ficam iguais aos de antes dos tubos (teste `tests/weapons.test.ts`).

### Míssil antinavio SM39 (Exocet) na cápsula VSM (`weapons.missile`, `src/sim/systems/missiles.ts`)

Ordens de grandeza públicas (MBDA, CSIS Missile Threat, EDR Magazine). Cinemática simples, sem aerodinâmica do míssil.

| Item | Valor | Observação |
|---|---|---|
| Cápsula VSM com o míssil | 1 345 kg, 5,8 m × 533 mm, 1,3 m³ | entra no tubo no lugar do F21 (`TubeState.kind = 'sm39'`); a compensação usa a massa e o volume do tipo carregado |
| Míssil | 655 kg, 4,69 m × 350 mm, ogiva 165 kg | asas em X abrem depois da separação |
| Reserva | 2 SM39 (`missileReserve`) | junto aos torpedos de reserva (x = 13 m); entra na condição de projeto (peso leve automático) |
| Motor da cápsula | acende 1,5 s depois de sair do tubo; 20 m/s (constante 1,2 s) | sobe a 45° (oblíqua) ou 75° (quase vertical); arfagem 12 °/s; desvio lateral até ±40° a 8 °/s |
| Superfície | nariz ejetado 0,25 s depois de romper; separação a 20 m de altura (ou 3 s) | a cápsula cai no mar |
| Acelerador | acende 1,0 s depois da separação; queima 2,6 s | sobe para 40 m |
| Cruzeiro | 310 m/s (Mach ≈ 0,93) a 12 m | navegação inercial até o ponto de busca (posição prevista do alvo no lançamento) |
| Autodiretor | ligado a 12 km do ponto de busca; alcance 15 km; cone ±30°; travamento após ≈ 1 s de varredura | fase terminal a max(3 m; 0,8·Hs + 1,5 m) |
| Manobra | guinada 9 °/s; ângulo de trajetória 10 °/s | |
| Alcance | 50 km de voo depois da separação | depois cai no mar |
| Alvo em terra | subida a 5 km do alvo até 180 m acima do terreno; mergulho a ≈ 1,3 km | licença do simulador (no Exocet, Bloco 3 com GPS) |
| Dano | 0,55 por impacto de ogiva | fragata: incêndio e para; com dano ≥ 1 afunda (dois mísseis); alvo em terra: destruído com um |
| Fragata (alvo) | classe Tamandaré: 107,2 × 15,95 m, calado 5,2 m, até 26 nós | manobra evasiva (proa para o míssil, toda força) com o míssil em busca/terminal a < 9 km |
| Submarino inimigo na superfície | cota 1,8 m (`depth: 0` no comando `enemy`) | único alvo submarino aceito pelo míssil |

## Bombas e válvulas

| Componente | Valor |
|---|---|
| Bomba de compensação BC | 10 L/s a Δp = 0; shutoff 45 bar; η = 0,55; partida 4 s |
| Limitador de admissão de mar | 12 L/s (orifício de 25 cm²) |
| Bomba de trim BT | 12 L/s; shutoff 5 bar; perda na linha 0,6 bar |
| Bomba de banda BB | 6 L/s; shutoff 3 bar |
| Curso das válvulas | suspiros 2,5 s · sopro normal/emergência 1,5 s · mar 5 s · tanques 3–4 s |
| Sopro de emergência | mesmo orifício do normal em ramal dedicado; válvulas de emergência e isolamento AE independem da hidráulica |

## Superfícies de controle

| Superfície | Posição x | Área | Alongamento efetivo | Batente | Velocidade |
|---|---|---|---|---|---|
| Lemes horizontais de vante (na vela) | +10,5 m, z = −5,8 m | 11 m² | 3,0 | ±25° | 5°/s |
| Lemes horizontais de ré (totalmente móveis) | −31,5 m | 21 m² | 3,0 | ±25° | 4°/s |
| Leme de direção (totalmente móvel) | −31,5 m | 21 m² | 3,0 | ±30° | 4°/s |
| Vela (efeito hidrodinâmico) | +9 m, z = −5,7 m | 40 m² | 1,0 | — | — |

### Piloto automático (`AP_GAINS` em `systems/autopilot.ts`)

Os ganhos que comandam lemes (rumo, pitch e lemes de vela) são multiplicados por K = min(4, (U₀/U)²), U₀ = 4 m/s; a malha profundidade → pitch ordenado não. e_z = z − z_ref (m), ż em m/s, ângulos em graus.

| Malha | Parâmetro | Valor |
|---|---|---|
| Rumo → leme de direção | Kp · Ki · Kd | 2,2 · 0,04 · 25 |
| Profundidade → pitch ordenado (lemes de ré) | Kz · Ki · Kzd | 1,0 °/m · 0,01 °/(m·s) · 10 °/(m/s) |
| | θ_max (normal / baixa velocidade) | ±10,5° / ±4° |
| | integral de profundidade ativo | só com erro de cota < 3 m |
| Pitch → lemes de ré | Kθ · Ki · Kq | 2,5 · 0,06 · 30 °/(°/s); autoridade ±20° |
| Lemes de vela (ajuste fino) | Kb · Kbd | 1,0 °/m · 10 °/(m/s) |
| | faixa fina b / transição f | 3 m / 5 m (a ação sobre ż some com erro de cota > 8 m) |
| | ajuda na travessia a₀ | 0,7 × Kb·b (≈ 3,5° a 6 nós) |
| | autoridade (normal / baixa velocidade) | ±10° / ±20° |
| Alocação a baixa velocidade | U_alto → U_baixo | 2,0 → 1,6 m/s (~3,9 → 3,1 nós) |

## Hidrodinâmica

| Parâmetro | Valor |
|---|---|
| C_t (resistência total) | 0,0022 |
| Acréscimo de resistência na superfície | +120 % |
| C_dc (escoamento cruzado) | 0,8 |
| Sustentação do casco C_Lc (base D²) | 1,2 em x_cp = −8 m |
| Fator de Munk | 0,75 (aplicado à força a₁×ω e ao momento a₁×v, mantendo potência nula) |
| Massa adicional | X_u̇ = 2,5 % · Y_v̇ = Z_ẇ = 95 % de ρV · M_q̇ = N_ṙ = 0,85·ρ∫πr²x²dx |
| Amortecimento linear | sway/heave 3×10⁴ N·s/m · roll 3×10⁶ · pitch/yaw 4×10⁷ N·m·s |
| Radiação de ondas (superfície) | heave 1,2×10⁶ · pitch 4×10⁸ · roll 2×10⁶ |

## Propulsão e energia

| Parâmetro | Valor |
|---|---|
| Motor elétrico principal | 3,0 MW a 160 rpm; torque máx. 215 kN·m; η = 0,95 |
| Rampa de rotação | 8 rpm/s |
| Hélice | D = 4,4 m, 7 pás; K_T0 = 0,229; K_Q0 = 0,0372; J₀ = 1,0/1,1; w = 0,25; t = 0,15 |
| Velocidade máxima submersa (resultado do modelo) | ≈ 18 nós (limitada pela potência) |
| Bateria | 11 000 Ah; V_oc 440–560 V; R = 4 mΩ; I_máx 7 000 A (e ≤ V_oc/2R); recarga 3 500 A até 90 % de SoC, reduzida linearmente a 0 em 100 %; η_recarga 0,92 |
| Diesel-geradores | 2 × 1,1 MW; partida em 30 s; consumo específico de 215 g/kWh |
| Cargas fixas | habitabilidade 60 kW; navegação/controle 12 kW |
| Compressor de ar | 0,12 kg/s total; 80 kW; recarrega os dois circuitos até o menor limite entre banco e compressor; prioridade às ampolas durante emergência |
| Hidráulica | 200 bar nominal; mínimo de 90 bar |

## Limites fictícios (educacionais)

| Limite | Valor |
|---|---|
| Profundidade operacional | 250 m |
| Profundidade de teste | 300 m |
| Pitch / banda (alarme) | 15° / 8° |
| Velocidade vertical | 1,5 m/s |
| Altitude mínima | 30 m (alerta) · 10 m (crítico) |

## Ambiente padrão

| Parâmetro | Valor |
|---|---|
| Salinidade | 35 PSU |
| Temperatura | 22 °C na superfície → 12 °C abaixo da termoclina (80 m, espessura de 25 m) |
| Costa | Desligada por padrão (ligada nos cenários costeiros); faixa costeira de 1.000 m (Restinga: 3.000 m; Saída da base: 400 m com fundo de 30 m): fundo = profundidade de mar aberto × suavização (3x² − 2x³), x = distância à orla / faixa; em terra, altura do terreno |
| Estaleiro (Ilha da Madeira) | Com a costa ligada: aterro, cais e shiplift a +3 m (paredes verticais); quebra-mares de enrocamento com crista a +5 m e talude 1:1,5; fora das estruturas o fundo é limitado por d/1,5 ÷ (1 − (d/300)²) (d = distância à estrutura, m) e, na área dragada, nunca menor que 16 m (estimado) |
| Fundo | Padrão de sessões novas: **uniforme, 300 m**. Modo relevo: profundidade na origem + declividades (+6 m/km N, −3 m/km E) e ondulações de ±25 m (λ = 1.800 m). Arquivos salvos antigos e o cenário “Águas rasas” continuam em relevo (antigo padrão: 420 m na origem) |
| Declinação magnética | −21,5° |
| Passo de integração | 0,02 s (50 Hz) |

### Transferência de banda pelo circuito de compensação

BTC: 10 L/s a Δp = 0, shutoff 5 bar, eficiência 0,60, potência em vazio 2 kW, partida 3 s. VDC 4/2 (quatro vias, duas posições) e isolamentos: curso 3 s, atuação hidráulica. Posições reais da VDC: 0 direta (A→T/P→B) e 1 inversa (B→T/P→A). Não há posição central estável; o fluxo é interrompido durante a comutação. T = sucção e P = descarga da BTC. Perda da linha: 0,6 bar na vazão nominal. Rotas: BB ↔ BE, BB ↔ TC central, BE ↔ TC central. O TC usa a geometria atual do conjunto de compensação, com y = 0; os tanques de banda ficam em BB/BE, na mesma posição longitudinal. O nível de origem, a cota de descarga e a atitude do casco determinam a carga estática.

## Acústica sintética

Valores educacionais, não assinaturas reais: `src/sonar/sources/signatures.ts`
(biblioteca e ruído próprio), `acoustics/environment.ts` (SVP/absorção/presets),
`sensors/active.ts` (nível ativo 210 dB, margem de reverberação 10 dB),
`acoustics/propagation.ts` (reflexões: superfície 1 dB, fundo 5 dB).
Aquisição 1 Hz, atualização de eco 0,02 s, FFT 4.096 amostras/2.048 Hz,
64 raios visuais por padrão, faixa 8–512, memória 30–900 s (240 padrão).
Não foram recalibrados casco, propulsão ou balanços existentes para o sonar.
Veja [SONAR.md](SONAR.md) para equações, observabilidade e limitações.
