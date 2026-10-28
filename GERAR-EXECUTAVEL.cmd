@echo off
setlocal
title Gerar executavel - SX-1 Simulador
pushd "%~dp0"
where npm >nul 2>nul
if errorlevel 1 goto :sem_node

echo Instalando as dependencias. Aguarde; a primeira vez pode demorar.
call npm ci --include=dev
if errorlevel 1 goto :erro

echo Gerando o instalador e a versao portatil para Windows...
call npm run dist:win
if errorlevel 1 goto :erro

echo.
echo Pronto! Os arquivos .exe estao na pasta release.
start "" "%~dp0release"
popd
pause
exit /b 0

:sem_node
echo Instale o Node.js LTS em https://nodejs.org e tente novamente.
echo Depois de instalar, feche e abra esta janela.
goto :fim_erro

:erro
echo.
echo Nao foi possivel concluir. Copie a mensagem de erro acima para pedir ajuda.
echo Confira sua conexao com a internet e se o Node.js LTS esta instalado.
:fim_erro
popd
pause
exit /b 1
