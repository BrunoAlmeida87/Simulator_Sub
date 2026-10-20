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
- Navios: posição 3D = posição do mapa (< 1 m) para três origens; um modelo por tipo (`tests/ships.test.ts`).
- Costa: terra/mar/restinga nos dados embutidos, cais na orla, transição contínua do fundo, costa desligada nos cenários originais e nos arquivos v1, cenários costeiros sem encalhe e com alarme antes do contato (`tests/coast.test.ts`).

## Cenários de verificação manual (navegador e Electron)

1. **Estado antigo** — Configurações → Carregar arquivo → `tests/fixtures/estado-v1-submerso50.json`: deve aparecer pausado a ~58 m, 30°, piloto em AUTO; ▶ continua.
2. **Salvar e continuar** — cenário "Submerso 50 m", ordenar 6 nós e uma manobra; Baixar arquivo; recarregar a página; Carregar arquivo; conferir profundidade, rumo, velocidade, tanques, bateria e etapa da manobra; ▶.
3. **Segunda janela** — "⧉ 2ª janela": a cena, camadas, identificação e navios devem acompanhar a janela de controle.
4. **Desempenho** — aba Pilotagem em qualidade alta e baixa: a barra superior não deve mostrar "CPU: tempo reduzido" em 1× e 8×.
5. **Celular** — largura de 390 px: sem rolagem horizontal nas abas novas.

## Registro da verificação desta série (20/10/2026)

Executado no ambiente de nuvem (Linux, Chromium 1194 do Playwright com WebGL por software e Electron 44.9.0 em tela virtual):

| Verificação | Resultado |
|---|---|
| `npm test` | 10 arquivos, 77 testes aprovados |
| `npm run build` | sem erros de tipos; build gerado |
| Estado antigo (`estado-v1-submerso50.json`) pela interface | abre convertido, pausado a 57,7 m; ▶ Retomar continua |
| Segunda janela (duas páginas no mesmo navegador) | nome, aviso de trim ampliado, aviso de gravação, camadas novas e mudança da costa chegam à visualização |
| Electron (`electron .` sobre o build) | abre, carrega o estado v1, aba Governo com cena 3D, 2ª janela espelhando |
| Celular (Pixel 5, 393 px) | sem rolagem horizontal em Pilotagem, Governo, Fluxo de energia, Propulsão, Trim, 3D, Mapa, Configurações e Cenários |
| Toque | manche do painel de governo responde a arrastar com toque |
| Desempenho (medido em Node) | terreno médio: 78 ms para montar, 36 ms para recentrar (alto: 251/94 ms); fundo com costa: 0,25 µs por consulta |

Não verificado aqui: desempenho real em placa de vídeo (a renderização por software não é representativa), o executável Windows gerado (`npm run dist:win`) e os fundos de mapa da internet (bloqueados neste ambiente).
