# Parâmetros da embarcação fictícia SX-1 "Marlim"

Todos os valores são **fictícios**, escolhidos com ordem de grandeza pública para um submarino convencional de ~70 m. Nenhum valor corresponde a um navio real. A fonte única é `src/sim/config/defaultVessel.ts`; a maioria pode ser alterada na tela **Cenários e configuração**.

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

### Cargas variáveis (padrão)

| Item | Massa | Posição x |
|---|---|---|
| Tripulação e mantimentos | 9 t | +4 m |
| Carga útil (fictícia) | 14 t | +19 m |
| Água doce e lubrificantes | 6 t | −6 m |
| Combustível (100 m³, tanque compensado de 120 m³) | 84 t + 20,5 t de água | −2 m |
| Condição de carga leve / pesada | −6 t / +6 t | +3 m |

## Tanques

| Tanque | Capacidade | Centro (x, y, z) | Observação |
|---|---|---|---|
| TLP-1 BB / BE | 58 m³ cada | (28,0; ∓1,35; 0) | suspiro 350 cm², embornais 0,6 m², sopro 3 cm² |
| TLP-2 BB / BE | 46 m³ cada | (−23,5; ∓1,15; 0) | suspiro 280 cm², embornais 0,5 m², sopro 2,5 cm² |
| TC-1 / TC-2 (compensação) | 12 m³ cada | (6,0 / −1,0; 0; 2,3) | |
| TT-AV / TT-AR (trim) | 8 m³ cada | (21,5 / −13,0; 0; 2,2) | braço de 34,5 m |
| TB-BB / TB-BE (banda, fictícios) | 4 m³ cada | (2,0; ∓2,4; 1,0) | braço de 4,8 m |
| Garrafas AP (2 grupos) | 4 m³ a 250 bar | | ≈ 1 188 kg de ar cada |

## Bombas e válvulas

| Componente | Valor |
|---|---|
| Bomba de compensação BC | 10 L/s a Δp = 0; shutoff 45 bar; η = 0,55; partida 4 s |
| Limitador de admissão de mar | 12 L/s (orifício de 25 cm²) |
| Bomba de trim BT | 12 L/s; shutoff 5 bar; perda na linha 0,6 bar |
| Bomba de banda BB | 6 L/s; shutoff 3 bar |
| Curso das válvulas | suspiros 2,5 s · sopro 1,5 s · mar 5 s · tanques 3–4 s |

## Superfícies de controle

| Superfície | Posição x | Área | Alongamento efetivo | Batente | Velocidade |
|---|---|---|---|---|---|
| Lemes horizontais de vante (na vela) | +10,5 m, z = −5,8 m | 11 m² | 3,0 | ±25° | 5°/s |
| Lemes horizontais de ré (totalmente móveis) | −31,5 m | 21 m² | 3,0 | ±25° | 4°/s |
| Leme de direção (totalmente móvel) | −31,5 m | 21 m² | 3,0 | ±30° | 4°/s |
| Vela (efeito hidrodinâmico) | +9 m, z = −5,7 m | 40 m² | 1,0 | — | — |

## Hidrodinâmica

| Parâmetro | Valor |
|---|---|
| C_t (resistência total) | 0,0022 |
| Acréscimo de resistência na superfície | +120 % |
| C_dc (escoamento cruzado) | 0,8 |
| Sustentação do casco C_Lc (base D²) | 1,2 em x_cp = −8 m |
| Fator de Munk | 0,75 |
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
| Bateria | 11 000 Ah; V_oc 440–560 V; R = 4 mΩ; I_máx 7 000 A |
| Diesel-geradores | 2 × 1,1 MW; partida em 30 s; consumo específico de 215 g/kWh |
| Cargas fixas | habitabilidade 60 kW; navegação/controle 12 kW |
| Compressor de ar | 0,12 kg/s; 80 kW |
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
| Fundo | 420 m na origem; declividades de +6 m/km (N) e −3 m/km (E); relevo de ±25 m |
| Declinação magnética | −21,5° |
| Passo de integração | 0,02 s (50 Hz) |
