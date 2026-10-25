# Equações do modelo

Este documento descreve as equações implementadas no motor (`src/sim`). Para cada simplificação há uma indicação. Os coeficientes são configuráveis em `src/sim/config/defaultVessel.ts`.

## 1. Convenções

- Referencial inercial **NED**: x = Norte, y = Leste, z = para baixo (profundidade positiva).
- Referencial do **corpo**: x = avante, y = boreste, z = quilha. A origem fica no eixo do casco, a meia-eslora.
- Atitude representada por quatérnio (sem singularidade em θ = ±90°). Os ângulos de Euler ZYX são exibidos assim: φ = banda (+ adernado a BE), θ = pitch (+ proa para cima) e ψ = rumo.
- Velocidades no corpo: ν = [u v w p q r].

## 2. Ambiente

### 2.1 Equação de estado da água do mar (UNESCO EOS-80)

```
ρ(S,T,p) = ρ(S,T,0) / (1 − p / K(S,T,p))        p em bar (manométrica)
ρ(S,T,0) = ρ_w(T) + A(T)·S + B(T)·S^1,5 + C·S²
K(S,T,p) = K(S,T,0) + A'(S,T)·p + B'(S,T)·p²
```

Implementação em `environment/seawater.ts`, com os coeficientes de Millero e Poisson (1981). Os valores de verificação publicados coincidem com erro abaixo de 0,001 kg/m³ (teste V11).

### 2.2 Perfis e pressão

Termoclina em tangente hiperbólica:

```
T(z) = T_prof + (T_sup − T_prof)·½·[1 − tanh((z − z_tc)/δ)]   (o mesmo para S)
```

A pressão hidrostática é integrada numericamente (preditor-corretor, passo de 0,5 m):

```
dp/dz = ρ(S(z), T(z), p(z))·g ,   p(0) = p_atm
```

### 2.3 Fundo

```
z_fundo(N,E) = z₀ + i_N·N/1000 + i_E·E/1000 + A·[0,6·sen(kN+0,7)·cos(0,8kE−0,3) + 0,3·sen(2,3kE+1,9) + 0,1·cos(3,7k(N+E))]
```

## 3. Geometria e hidrostática

### 3.1 Casco (corpo de revolução)

```
r(x) = R·√(1 − ((x − x_b0)/L_b)²)                  proa elíptica
r(x) = R                                            corpo paralelo
r(x) = r_t + (R − r_t)·(1 − s²),  s = (x_s0 − x)/L_s  popa parabólica
```

O casco é discretizado em fatias (100 por padrão). A vela é tratada como espaço de alagamento livre e não desloca água.

### 3.2 Imersão parcial (Princípio de Arquimedes)

Para cada fatia circular, a linha d'água no plano da seção fica a uma distância assinada s = −z_c/|n| do centro, com n = (R₃₂, R₃₃):

```
A(s) = r²·acos(s/r) − s·√(r² − s²)
c(s) = (2/3)·(r² − s²)^{3/2} / A          (centróide ao longo de n̂)
V = Σ A_i·Δx ;   B = Σ A_i·Δx·c_i / V
```

O cálculo é exato para fatias normais ao eixo, em qualquer pitch, banda ou calado. Com a mesma rotina, ele cobre a flutuação na superfície (estabilidade de plano de flutuação) e a condição submersa (estabilidade por BG).

### 3.3 Compressibilidade do casco

```
V_desl = V_imerso − c_casco·Δp·V_comprimível·(V_imerso/V_env)
```

Na equação, V_comprimível = V_envelope − ΣV_TLP.

### 3.4 Pesos e empuxo

```
W = m·g   (aplicado em G; vertical do mundo)
E = ρ(z)·g·V_desl   (aplicado em B; vertical do mundo)
```

Os momentos são r × F no corpo. G e m são recalculados a cada passo a partir de todos os itens (`physics/massProperties.ts`):

```
m = Σ m_i ;   G = Σ m_i·r_i / m ;   I_xx = Σ m_i(y_i² + z_i²) + m_L·k_xx²  (análogos)
```

Os itens são: peso leve, cargas variáveis, combustível compensado, ar AP, água e ar dos TLP, compensação, trim, banda e alagamentos.

**Peso leve automático:** m_L e G_L resultam da condição de projeto (neutro, trim nulo e BG especificado a 100 m, com S = 35 e T = 15 °C).

## 4. Dinâmica de corpo rígido (6 graus de liberdade)

```
(M_RB + M_A)·ν̇ = τ_hidrostático + τ_casco + τ_superfícies + τ_hélice + τ_contato + τ_Coriolis
η̇ = J(η)·ν :   ṗ_NED = R(q)·v ,   q̇ = ½·q ⊗ (0, ω)
```

- M_RB = diag(m, m, m, I_xx, I_yy, I_zz); M_A = diag(X_u̇, Y_v̇, Z_ẇ, K_ṗ, M_q̇, N_ṙ) (fatores de corpo esbelto), escalada pela fração imersa.
- Termos de Coriolis e centrípetos (lado direito):

```
F = −m(ω × v) + a₁ × ω ,            a₁ = (A₁₁u, A₂₂v, A₃₃w)
M = −ω × (Iω) + k_Munk·(a₁ × v) + b₁ × ω ,   b₁ = (A₄₄p, A₅₅q, A₆₆r)
```

- O termo a₁ × v contém o **momento de Munk**, (A₃₃ − A₁₁)·u·w em pitch e (A₁₁ − A₂₂)·u·v em guinada. Ele é instabilizante; k_Munk ≈ 0,75 representa a redução viscosa.
- Integração **RK4** com passo fixo. Massas e posições de lemes ficam congeladas dentro do passo (separação de operadores).

## 5. Forças hidrodinâmicas (`physics/hydrodynamics.ts`)

### 5.1 Resistência ao avanço

```
X_R = −½·ρ·S_m·C_t·(1 + k_sup·f_sup)·u|u| − c_u·u ,   f_sup = exp(−(z_eixo − R)/(2R))
```

### 5.2 Escoamento cruzado (teoria das faixas)

```
v_c,i = (v + r·x_i ,  w − q·x_i)
dF_i = −½·ρ·C_dc·D_i·Δx·imersão_i·|v_c,i|·v_c,i
M_y += −x_i·dF_z ,   N += x_i·dF_y
```

### 5.3 Sustentação do casco (linear)

```
Z_c = −½·ρ·D²·C_Lc·u·w ,   Y_c = −½·ρ·D²·C_Lc·u·v     (aplicadas em x_cp)
```

### 5.4 Superfícies de controle e estabilizadores

Para cada superfície, o escoamento local é v_loc = v + ω × r:

```
α = δ + atan2(v_n, v_x)                       (reduzido a [−90°, 90°]; placa fina)
C_Lα = 2π·AR / (2 + √(AR² + 4))               (Helmbold)
C_L = C_Lα·α (|α| ≤ α_estol); transição de 8°; depois 0,9·sen 2α
C_D = 0,008 + C_L²/(π·AR·0,85) + 1,1·sen²α
L = ½·ρ·|V|²·A·C_L ,   D = ½·ρ·|V|²·A·C_D
```

Com velocidade nula a força é nula, e ela cresce com U², o que o teste V04 verifica. Em marcha a ré, a eficiência é multiplicada por 0,7.

Convenções do operador: lemes horizontais **+ = SUBIR**, sendo que o leme de ré usa δ_geom = −δ_cmd; leme de direção **+ = BORESTE**.

### 5.5 Amortecimento residual e de superfície

Termos lineares em sway, heave, roll, pitch e yaw; termo quadrático em roll. Perto da superfície entra um amortecimento linear adicional em heave, pitch e roll, que representa a radiação de ondas.

### 5.6 Contato com o fundo

Molas e amortecedores em três pontos da quilha: F_n = k·δ + c·δ̇ (≥ 0), com atrito de Coulomb regularizado.

## 6. Lastro principal (`systems/ballast.ts`)

Estado por tanque: volume de água V_w e massa de ar m_a.

```
p_ar = m_a·R·T_mar / (V_t − V_w)                        (isotérmico)
Δp = p_ext(z_embornal) − p_ar − ρ·g·V_w/A_h
Q_água = C_d·A_emb·√(2/ρ)·Δp/√(|Δp| + Δp₀)               (Δp₀ = 200 Pa, regularização)
```

A água é integrada por **Euler implícito**: V_{n+1} − V_n − dt·Q(V_{n+1}) = 0, resolvido por bissecção (função monotônica).

Ar (orifício compressível, γ = 1,4):

```
crítico (p₂/p₁ ≤ 0,528):  ṁ = C_d·A·p₁·√(γ/(R·T))·(2/(γ+1))^((γ+1)/(2(γ−1)))
subsônico:  ṁ = C_d·A·p₁·√( 2γ/((γ−1)RT)·[(p₂/p₁)^(2/γ) − (p₂/p₁)^((γ+1)/γ)] )
ṁ_suspiro = Φ(p_ar → p_ext,topo) ;   ṁ_sopro = Φ(p_coletor → p_ar)
```

Há limites anti-ultrapassagem: o suspiro não reduz p_ar abaixo de p_ext,topo e o sopro não ultrapassa a pressão do coletor. O ar que excede o volume do tanque vazio escapa pelos embornais.

Algumas consequências emergem do modelo: o alagamento é limitado pela saída de ar; um TLP parcialmente soprado perde empuxo ao descer (Boyle); o ar se expande na subida; a superfície é reencontrada com tanques parcialmente cheios.

## 7. Ar comprimido (`systems/hpAir.ts`)

```
p_grupo = m·R·T_ar / V_grupo
```

Os grupos abertos se equalizam somente no coletor de seu circuito (normal ou emergência). Não há equalização nem consumo cruzado entre os circuitos. Cada TLP recebe ar por válvulas independentes, com o mesmo modelo de orifício compressível; o consumo de cada circuito é limitado à massa de seus bancos abertos para conservar massa mesmo ao esgotar as reservas.

O compressor adiciona no máximo ṁ_c·Δt ao conjunto de bancos por linhas com retenção, inclusive com os isolamentos de sopro fechados, sem ultrapassar a pressão máxima de cada banco ou a do compressor. A recarga é distribuída proporcionalmente à massa faltante. Durante o sopro de emergência há solicitação automática do compressor e prioridade às ampolas dedicadas; a operação exige tomada de ar disponível e energia. A massa admitida e a potência entram nos balanços do motor.

## 8. Compensação, trim e banda (`systems/internalTanks.ts`)

Água interna contabilizada em massa (ρ_nom = 1025 kg/m³ para nível e volume).

```
Admissão:     Q = min(C_d·A·a·√(2Δp/ρ), Q_reg) ,   Δp = p_mar − p_interna
Descarga:     Q = s·Q₀·√(1 − Δp/(s²·Δp₀))           (curva da bomba, leis de afinidade)
Transferência: Q² (1 + Q₀²k/Δp₀) = s²Q₀² (1 − Δp_est/H) = Q₀² (s² − Δp_est/Δp₀) ,  Δp_est = ρ·g·(z_nível,origem − z_topo,destino)
Potência:     P = Q·Δp/η + P₀·s
Previsão estática:  Δθ ≈ atan(Δm·g·Δx / (W·BG)) ,  Δφ ≈ atan(Δm·g·Δy / (W·BG))
```

Válvulas: dx/dt = sinal(x_cmd − x)/t_curso, com atuação hidráulica disponível. Bombas: rotação em rampa (t_partida).

Forma dos tanques internos (`systems/tankShape.ts`): a seção é o retângulo largura × altura recortado pelo círculo do casco resistente (raio R), prismática ao longo de x com L = V_tanque / A_seção. Nível e centroide da água por faixas horizontais: A(h) = Σ w(z)·dz do fundo ao nível, ȳ = Σ w·y_m·dz / A, z̄ = Σ w·z·dz / A. Nos tanques de banda o centroide se desloca para o costado ao encher.

Compensação com três tanques num coletor único (TC central + TB-BB e TB-BE, que também são os tanques de banda): a vazão líquida do coletor (admissão − descarga) divide-se pelos ramais abertos na proporção aᵢ·Vᵢ (abertura × capacidade); a parte que um tanque cheio (ou vazio) não aceita passa aos demais. Como os três tanques estão na posição longitudinal de G, a compensação não altera o trim; os ramais laterais abertos por igual não alteram a banda.

## 9. Propulsão (`systems/propulsion.ts`)

```
I_eixo·ω̇ = Q_motor − Q_hélice − c·ω
Q_motor = sat(Kp·(ω_ref − ω) + Ki·∫, ±min(Q_max, P_disp·η/|ω|))     (PI com anti-windup)
T = ρD⁴K_T0·(n|n| − |n|·u_a/(D·J0T)) ,   Q = ρD⁵K_Q0·(n|n| − |n|·u_a/(D·J0Q)) ,   u_a = u(1 − w)
Empuxo no casco = T·(1 − t)
P_elétrica = max(0, Q_motor·ω)/η + perdas em vazio
```

A reação do torque do eixo gera momento de banda (fator configurável).

## 10. Energia (`systems/electrical.ts`)

```
V_oc = V_min + (V_max − V_min)·SoC
I = (V_oc − √(V_oc² − 4R·P))/(2R)   (limitada a I_max)
dSoC/dt = −I/(3600·C_Ah)            (× η_carga quando I < 0)
ṁ_combustível = sfc·P_gerador ;  massa do tanque compensado = ρ_c·V_c + ρ_mar·(V_tanque − V_c)
```

## 11. Atuação (`systems/actuation.ts`)

```
Hidráulica:  dp_h/dt = Q_bombas − Σ consumos − vazamento
f_hid = clamp((p_h − p_min)/(0,75·p_nom − p_min), 0, 1)
Lemes:  δ̇ = sinal(δ_cmd − δ)·taxa·f_hid  (batente ±δ_max)
Alagamento:  Q = 0,62·A_rombo·√(2(p_ext − p_int)/ρ)
```

## 12. Sensores e navegação (`systems/sensors.ts`)

```
Profundímetro:  z_ind = (p − p_atm)/(ρ_cal·g),  ρ_cal = 1025 kg/m³
Agulha magnética:  ψ_mag = ψ_verd − declinação
Modo avançado:  y = filtro_1ª_ordem(x, τ) + σ·N(0,1)   (gerador determinístico com semente)
Navegação estimada:  ṗ_DR = R(φ_med, θ_med, ψ_med)·v_Doppler
```

## 13. Controle automático (`systems/autopilot.ts`)

```
δ_r = K·[Kp·e_ψ + Ki·∫e_ψ − Kd·r]
θ_cmd = sat(Kz·e_z + Ki·∫e_z + Kzd·ż, ±θ_max)          (∫e_z só com |e_z| < 3 m)
δ_ré = K·[Kθ·(θ_cmd − θ) + Ki·∫ − Kq·q]                 (|δ_ré| ≤ 20°)
δ_vante = K·[Kb·(1 + L)·sat(e_z, ±b)·max(w, a) + Kbd·ż·w]   (|δ_vante| ≤ 10° + L·10°)
w = 1 para |e_z| ≤ b, → 0 linearmente até |e_z| = b + f ;   a = a₀ + L·(1 − a₀)
θ_max = 10,5° − L·(10,5° − 4°) ;   L = sat((U_alto − U)/(U_alto − U_baixo), 0, 1)
K = min(4, (U₀/U)²)   (escalonamento pela efetividade ∝ U²)
```

**Divisão do trabalho entre os lemes.** A mudança de cota é feita pela cascata dos **lemes de ré**: o erro de profundidade vira um pitch ordenado (até ±10,5°) e é o ângulo — a sustentação do casco inclinado — que leva o submarino à nova cota. Os lemes de ré têm momento de caturro ~6× maior que os de vela (21 m² a 31,5 m × 11 m² a 10,5 m). Os **lemes de vela** (vante) fazem só o **ajuste fino**: perto da cota (|e_z| ≤ b = 3 m, desaparecendo até 8 m) corrigem pequenos erros e freiam a chegada com força vertical direta; na travessia ficam numa pequena ajuda constante (a₀ = 0,7 de K·Kb·b, ≈ 3,5° a 6 nós), com autoridade de ±10° acima de ~4 nós.

**Baixa velocidade.** Perto da velocidade crítica dos lemes de ré (~3 nós neste modelo) a força direta do leme de ré anula a sustentação que o ângulo produz no casco, e eles deixam de mudar a cota. Entre U_alto = 2,0 m/s (~3,9 nós) e U_baixo = 1,6 m/s (~3,1 nós) a fração L passa de 0 a 1 e transfere a cota para os lemes de vela (ganho dobrado, ajuda total e autoridade de 20°), reduzindo o pitch ordenado para 4°.

Por que a versão anterior usava demais os lemes de vela: o termo direto δ_vante = K·[Kb·e_z + Kbd·ż] recebia o erro de profundidade inteiro, sem limite (1°/m × K, com K ≈ 1,7–2,2 a 5–6 nós), e saturava em 20° em qualquer mudança acima de ~10 m, enquanto os lemes de ré só executavam um pitch limitado a 8°. Como os lemes de vela saturados já davam boa parte do momento de proa, a malha de pitch chegava a θ_max com os lemes de ré a 4–5° — eles só limitavam o ângulo. Além disso, o integral de profundidade acumulava durante toda a aproximação (|e_z| < 15 m), deixando um sobrepasso de ~1 m que levava mais de 5 min para sumir.

Os controladores usam as leituras dos sensores. A transferência é sem salto (bumpless) e o anti-windup usa integração condicional.

## 14. Ondas (`environment/waves.ts`)

Espectro de Pierson–Moskowitz (Hs, Tp do estado do mar), discretizado em N = 24 componentes de amplitude aᵢ = √(2 S(ωᵢ) Δω), direção θᵢ com espalhamento cos², fase aleatória (semente fixa). Águas profundas: kᵢ = ωᵢ²/g.

```
η(x,t)   = Σ aᵢ cos(kᵢ·x − ωᵢ t + φᵢ)
u(x,z,t) = Σ aᵢ ωᵢ e^(−kᵢ z) [cos(·) k̂ᵢ , sin(·)]       (z positivo para baixo)
a = ∂u/∂t ;  p_d = ρ g Σ aᵢ e^(−kᵢ z) cos(·)
```

Em cada fatia do casco: o empuxo usa a imersão relativa à superfície local (z − η); o arrasto transversal usa a velocidade relativa à orbital; e a força de inércia é

```
F = (Ca + f_FK) ρ A dx a_água ,  Ca = 1 ,  f_FK = imersão da fatia
```

O campo é avaliado uma vez por passo (no meio do passo). A pressão na quilha soma ρ p_d, e o snorkel compara a cabeça com a elevação local. O oceano 3D (shader WebGL) usa exatamente as mesmas componentes e fases. Verificado no teste V13 (decaimento e^(−kz)).

## 15. Balanços de verificação

```
Massa interna: m(t) − m(0) = admissão − descarga + alagamento + (água no tanque de comb. − comb. queimado)
               + ar comprimido − ar ventilado − ar derramado
Bateria:       E_química = E_terminais + perdas I²R
Barramento:    E_cargas = E_geradores + E_bateria
```

Os valores ficam visíveis no modo engenharia e são verificados no teste V10.
