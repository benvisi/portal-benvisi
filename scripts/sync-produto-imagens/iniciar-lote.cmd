@echo off
rem Starts the stock-prioritized image batch in the background and returns at once.
rem Acquires candidates from Lacoste and scores them (PAID Anthropic calls) into the
rem review queue. Never approves or publishes. Needs the logged-in desktop session.
rem Usage: iniciar-lote.cmd [target]     (default 25; e.g. 250 = until 250 scored candidates)
setlocal
set "LIMIT=%~1"
if "%LIMIT%"=="" set "LIMIT=25"
if defined LOCALAPPDATA (set "LOGS=%LOCALAPPDATA%\PortalBenvisi\logs") else (set "LOGS=%TEMP%")

start "Lote de imagens" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-lote.ps1" -Persist -Limit %LIMIT%

echo Lote iniciado em segundo plano (meta %LIMIT% candidatos prontos).
echo Acompanhe: %LOGS%\lote-AAAAMMDD.log
echo Pode fechar esta janela. Nao saia da sessao do Windows nem suspenda o computador.
timeout /t 8 >nul
