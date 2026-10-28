# Gerar o executável do SX-1 para Windows

O projeto inclui Electron e electron-builder para transformar o simulador em um aplicativo de **Windows 10/11 de 64 bits**. A simulação e a cena 3D ficam dentro do programa; você não precisa abrir o navegador nem manter um servidor ligado. Os fundos do mapa tático e os links da documentação precisam de internet.

## Jeito mais simples: dois cliques

Você só precisa instalar o Node.js no computador usado para **gerar** o executável. Quem receber o `.exe` não precisa de Node.js.

1. Acesse <https://nodejs.org> e instale a versão **LTS** (24 ou mais recente), mantendo as opções padrão. Se já tiver Node.js, use no mínimo a versão 22.12.
2. Baixe a versão deste repositório que contém os arquivos do Electron. No GitHub: botão **Code → Download ZIP**. Se as alterações estiverem em outra branch, selecione essa branch antes de baixar.
3. Clique com o botão direito no ZIP e escolha **Extrair tudo**. Abra a pasta extraída até encontrar `package.json` e `GERAR-EXECUTAVEL.cmd`. Não execute de dentro do ZIP.
4. Dê dois cliques em **GERAR-EXECUTAVEL.cmd**. Mantenha a conexão com a internet e espere a janela informar **Pronto!**. A primeira execução baixa arquivos grandes e pode levar vários minutos.
5. A pasta **release** abrirá automaticamente. Ela terá:

| Arquivo | Como usar |
|---|---|
| `SX-1-Simulador-0.1.0-Instalador.exe` | Abra e siga as telas para instalar. Ele cria atalhos no menu Iniciar e na área de trabalho. |
| `SX-1-Simulador-0.1.0-Portatil.exe` | Abra diretamente, sem instalar. Pode ser copiado para outro computador Windows de 64 bits. |

O número `0.1.0` acompanha a versão definida em `package.json`. Distribua um desses dois arquivos `.exe`; os outros arquivos da pasta `release` servem ao empacotamento.

Depois de alterar o simulador, feche o aplicativo e execute novamente `GERAR-EXECUTAVEL.cmd` para gerar os arquivos atualizados.

## Se preferir usar comandos

Na pasta extraída, clique na barra de endereço do Explorador de Arquivos, digite `cmd` e pressione Enter. Cole um comando por vez e espere terminar:

```bat
npm ci --include=dev
npm run dist:win
```

Os dois `.exe` aparecerão na pasta `release`.

Para abrir o aplicativo pelo código-fonte, sem gerar instalador:

```bat
npm run desktop
```

Esse comando compila uma cópia do simulador e abre o Electron. Depois de editar o código, feche o aplicativo e execute o comando novamente.

## Gerar pelo GitHub, sem instalar Node.js

Esta opção fica disponível depois que os arquivos desta alteração estiverem salvos no repositório do GitHub.

A geração começa automaticamente a cada atualização da branch `main`. Para baixar essa versão, abra a execução mais recente desse workflow e siga os passos 5 a 7. Para gerar novamente a qualquer momento, use **Run workflow**, como descrito abaixo.

1. Abra o repositório no GitHub e clique em **Actions**.
2. Se o GitHub pedir para habilitar os workflows do seu próprio repositório, habilite-os.
3. Selecione **Gerar executavel Windows (Electron)**.
4. Clique em **Run workflow**, selecione a branch que contém esta alteração e confirme **Run workflow**.
5. Aguarde a execução ficar verde e abra o resultado.
6. Na seção **Artifacts**, baixe **SX-1-Windows**. É necessário estar conectado à sua conta do GitHub.
7. Extraia o ZIP e abra o instalador ou o portátil. O download fica disponível por 30 dias; você pode gerar outro quando precisar.

## Uso do aplicativo

- O botão **2ª janela** abre a visualização em outra janela do aplicativo. Arraste-a para o segundo monitor. **＋ Tela** abre o simulador completo (todas as abas) em mais uma janela, para um terceiro monitor. Fechar a janela principal também fecha as outras.
- Os botões de exportar estado e histórico continuam gerando arquivos JSON e CSV.
- Preferências e estados salvos ficam no perfil local do aplicativo, separado do navegador. No Windows, o perfil fica em `%APPDATA%\simulador-submarino`. A versão portátil também usa esse perfil local; ela não leva automaticamente os estados salvos para outro computador. Use a exportação/importação de JSON para transferi-los.
- O menu **Exibir** permite ajustar o zoom e entrar em tela cheia.

## Problemas comuns

- **“npm não é reconhecido” ou Node.js ausente:** instale o Node.js LTS, feche a janela e execute o arquivo `.cmd` novamente.
- **Erro durante o download:** confira sua conexão. Redes corporativas ou antivírus podem bloquear o download do Electron. Guarde a mensagem de erro para identificar o bloqueio.
- **A janela informa erro:** ela permanece aberta. Copie a mensagem completa que aparece antes de “Não foi possível concluir” para pedir ajuda.
- **Aviso de editor desconhecido:** os executáveis gerados não têm certificado de assinatura digital. O Windows pode exibir um aviso de reputação. Confira a origem do arquivo e respeite as políticas de segurança do seu computador.
- **Mapa sem fundo:** os mapas usam serviços online. Sem internet, a simulação e a cena 3D continuam disponíveis.
- **Instalação em Windows de 32 bits ou Windows antigo:** os pacotes configurados são para Windows 10/11 de 64 bits.
