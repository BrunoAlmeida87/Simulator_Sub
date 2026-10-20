# Verificação por etapa

Referência estável antes desta série de mudanças: commit `fa4e609` da `main`
("Gera executáveis Windows automaticamente ao atualizar a main"), com 46 testes
automáticos aprovados e build de produção sem erros.

Arquivos de estado no formato antigo (v1), gerados com essa versão, ficam em
`tests/fixtures/` e são abertos pelos testes a cada execução
(`tests/session.test.ts`):

| Arquivo | Conteúdo |
|---|---|
| `estado-v1-submerso50.json` | 50 m, 90 rpm, pilotos de rumo e profundidade em AUTO, admissão automática de compensação em andamento, falha de ecobatímetro (deriva) |
| `estado-v1-antigo.json` | o mesmo estado sem campos acrescentados ao longo do tempo (ondas, peso deslocável, referência de trim) |

## Verificações automáticas (`npm test`)

- Validação física V01…V13 (`tests/validation.test.ts`).
- Coerência da apresentação, manobras, cenário guiado (`tests/presentation.test.ts`).
- Unidades e conversões (`tests/units.test.ts`).
- Sessão: continuação exata após salvar/carregar, números não finitos, abertura dos arquivos v1, mensagens de erro (`tests/session.test.ts`).
- Sessão pela interface: manobra IMERGIR salva no meio retoma na mesma etapa (`tests/session-ui.test.ts`).
- Fundo do mar: modo uniforme padrão, relevo preservado, ecobatímetro e contato (`tests/bottom.test.ts`).
- Trimagem na superfície: rigidez e Δθ calculados × esperados, calados nas marcas (`tests/trim-surface.test.ts`).
- Gravação e reprodução: reprodução bit a bit com manobra automática, sem duplicar comandos, bloqueio de comandos e avisos de versão (`tests/recording.test.ts`).
- Estaleiro: posição (coordenada publicada da base), galpões sobre o aterro, aterro/quebra-mar/shiplift na física, fundo contínuo, caminho dragado da bacia ao mar, 3D e mapa com os mesmos contornos da física, cenário Saída da base sai pela entrada sem contato (`tests/shipyard.test.ts`).
- Rota do mapa: o rumo ordenado usa a origem geográfica da simulação, também nos cenários costeiros (`tests/route.test.ts`).
- Iluminação da cena: padrão Clara, valores inválidos ignorados, perfis completos (`tests/graphics.test.ts`).
- Navios: posição 3D = posição do mapa (< 1 m) para três origens; um modelo por tipo (`tests/ships.test.ts`).
- Costa: terra/mar/restinga nos dados embutidos, transição contínua do fundo, costa desligada nos cenários originais e nos arquivos v1, cenários costeiros sem encalhe e com alarme antes do contato (`tests/coast.test.ts`).

## Cenários de verificação manual (navegador e Electron)

1. **Estado antigo** — Configurações → Carregar arquivo → `tests/fixtures/estado-v1-submerso50.json`: deve aparecer pausado a ~58 m, 30°, piloto em AUTO; ▶ continua.
2. **Salvar e continuar** — cenário "Submerso 50 m", ordenar 6 nós e uma manobra; Baixar arquivo; recarregar a página; Carregar arquivo; conferir profundidade, rumo, velocidade, tanques, bateria e etapa da manobra; ▶.
3. **Segunda janela** — "⧉ 2ª janela": a cena, camadas, identificação e navios devem acompanhar a janela de controle.
4. **Desempenho** — aba Pilotagem em qualidade alta e baixa: a barra superior não deve mostrar "CPU: tempo reduzido" em 1× e 8×.
5. **Celular** — em pé e deitado: cabeçalho compacto com ☰, botão ⚙ Vista nas cenas 3D, diagramas com rolagem lateral, sem rolagem horizontal da página em nenhuma aba. No PC, a mesma página deve continuar idêntica.

## Registro da verificação desta série (20/10/2026)

Executado no ambiente de nuvem (Linux, Chromium 1194 do Playwright com WebGL por software e Electron 44.9.0 em tela virtual):

| Verificação | Resultado |
|---|---|
| `npm test` | 14 arquivos, 96 testes aprovados |
| `npm run build` | sem erros de tipos; build gerado |
| Estado antigo (`estado-v1-submerso50.json`) pela interface | abre convertido, pausado a 57,7 m; ▶ Retomar continua |
| Segunda janela (duas páginas no mesmo navegador) | nome, aviso de trim ampliado, aviso de gravação, camadas novas e mudança da costa chegam à visualização |
| Electron (`electron .` sobre o build) | abre, carrega o estado v1, aba Governo com cena 3D, 2ª janela espelhando |
| Celular (toque) | iPhone SE 320 px, Galaxy S8 360 px, iPhone 13 390 px e Pixel 7 412 px em pé; iPhone 13 e Galaxy S8 deitados: cabeçalho de 70 px, sem rolagem horizontal nas 17 abas, controles do 3D recolhidos, diagramas legíveis |
| PC inalterado pela adaptação ao celular | 17 abas × 1366×768, 1920×1080 e 1100×800 (mouse): 20 433 elementos com a mesma posição e o mesmo tamanho e nenhum pixel diferente (cena 3D oculta, animações paradas) em relação à versão anterior |
| Toque | manche do painel de governo responde a arrastar com toque |
| Iluminação da cena | Natural, Clara e Estúdio aplicadas na hora; a 2ª janela acompanha; preferência antiga sem o campo abre em Clara; sem a faixa clara no limite do fundo debaixo d'água |
| Estaleiro (Ilha da Madeira) | contornos ajustados à imagem Sentinel-2 (sobreposição de 83 % com a máscara de construções); 3D com 16 malhas e ~5 mil triângulos (35 ms para montar); consulta às estruturas ≈ 1 µs; física na bacia ~5–8 % mais lenta que a superfície em mar aberto; 2ª janela mostra o estaleiro e o rótulo; mapa com os mesmos contornos |
| Desempenho (medido em Node) | terreno médio: 78 ms para montar, 36 ms para recentrar (alto: 251/94 ms); fundo com costa: 0,25 µs por consulta |

Não verificado aqui: desempenho real em placa de vídeo (a renderização por software não é representativa), o executável Windows gerado (`npm run dist:win`) e os fundos de mapa da internet (bloqueados neste ambiente).
