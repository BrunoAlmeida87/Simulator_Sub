@echo off
rem ==========================================================================
rem  Abrir o Simulador SX-1 com duplo clique (Windows, sem instalar nada).
rem
rem  Liga um pequeno servidor local (PowerShell, ja incluso no Windows) e
rem  abre o navegador em http://localhost:8765/. Os navegadores nao rodam o
rem  simulador aberto direto do arquivo (file://), por isso o servidor.
rem
rem  Funciona:
rem   - na pasta da versao pronta (zip da branch gh-pages, ou a pasta dist);
rem   - na pasta do codigo-fonte (zip da main): usa a pasta dist; se ela nao
rem     existir e o Node.js estiver instalado, compila uma vez (npm).
rem  Para encerrar, feche esta janela.
rem ==========================================================================
setlocal
title Simulador SX-1
cd /d "%~dp0"

set "SX_ROOT="
if exist "%~dp0index.html" if exist "%~dp0assets\" set "SX_ROOT=%~dp0"
if not defined SX_ROOT if exist "%~dp0dist\index.html" set "SX_ROOT=%~dp0dist"
if defined SX_ROOT goto serve

if not exist "%~dp0package.json" goto nobuild
where npm >nul 2>nul
if errorlevel 1 goto nobuild
echo Primeira execucao: compilando o simulador (alguns minutos)...
call npm install
if errorlevel 1 goto buildfail
call npm run build
if errorlevel 1 goto buildfail
set "SX_ROOT=%~dp0dist"
goto serve

:nobuild
echo.
echo Nao encontrei a versao pronta do simulador nesta pasta.
echo  - Baixe o zip da branch gh-pages no GitHub (Code - Download ZIP),
echo    descompacte e de duplo clique neste arquivo dentro dela; ou
echo  - instale o Node.js e rode este arquivo na pasta do codigo-fonte; ou
echo  - use o site: https://brunoalmeida87.github.io/Simulator_Sub/
echo.
pause
exit /b 1

:buildfail
echo.
echo A compilacao falhou. Veja as mensagens acima.
pause
exit /b 1

:serve
set "SX_BAT=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = [IO.File]::ReadAllText($env:SX_BAT); iex ($t.Substring($t.LastIndexOf(':POWERSHELL') + 11))"
if errorlevel 1 pause
exit /b

:POWERSHELL
$ErrorActionPreference = 'Stop'
$sep = [string][IO.Path]::DirectorySeparatorChar
$root = [IO.Path]::GetFullPath($env:SX_ROOT.TrimEnd('\', '/') + $sep)
$mime = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.webp' = 'image/webp'; '.ico' = 'image/x-icon'; '.woff2' = 'font/woff2'; '.woff' = 'font/woff'; '.wasm' = 'application/wasm'; '.bin' = 'application/octet-stream'; '.txt' = 'text/plain; charset=utf-8' }
# porta fixa (as preferencias do navegador ficam guardadas por porta); se ocupada, tenta as seguintes
$listener = $null
$port = 8765
while ($port -lt 8785) {
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add("http://localhost:$port/")
  try { $l.Start(); $listener = $l; break } catch { $l.Close(); $port++ }
}
if ($listener -eq $null) { Write-Host 'Nao consegui abrir uma porta local (8765 a 8784).'; exit 1 }
$url = "http://localhost:$port/"
Write-Host ''
Write-Host "  Simulador SX-1 em $url"
Write-Host "  Pasta: $root"
Write-Host '  Deixe esta janela aberta enquanto usa o simulador. Para encerrar, feche-a.'
Write-Host ''
try { Start-Process $url } catch { Write-Host "  Abra no navegador: $url" }
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($rel.EndsWith('/')) { $rel = $rel + 'index.html' }
    $file = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $rel.TrimStart('/').Replace('/', $sep)))
    if (-not $file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
      $ctx.Response.StatusCode = 403
    } elseif ([IO.File]::Exists($file)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
      $type = $mime[$ext]
      if ($type -eq $null) { $type = 'application/octet-stream' }
      $ctx.Response.ContentType = $type
      $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
  } catch {
    # navegador cancelou o pedido no meio: segue atendendo os proximos
  } finally {
    try { $ctx.Response.Close() } catch { }
  }
}
