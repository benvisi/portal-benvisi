@echo off
rem Publicar imagens agora - double-click launcher for run-publicar.ps1 -Persist.
rem Publication, logging and the single-instance lock all live in the wrapper
rem and the worker; this file only starts them and explains the outcome.
rem Set PUBLICAR_NOPAUSE=1 to skip the final "press any key" (automated tests).
chcp 65001 >nul
setlocal
title Publicar imagens agora

echo.
echo ===============================================
echo   Publicar imagens agora
echo ===============================================
echo   Publica as imagens aprovadas que estao na fila.
echo   Um navegador Chromium vai abrir; nao feche a janela.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-publicar.ps1" -Persist
set "CODE=%ERRORLEVEL%"

echo.
echo -----------------------------------------------
if "%CODE%"=="0" (
  echo   CONCLUIDO. Nada pendente ou todas as publicacoes foram processadas.
  echo   Se outra execucao estava em andamento, ela continua e nada foi duplicado.
) else if "%CODE%"=="2" (
  echo   ATENCAO: alguma publicacao falhou. Ela sera tentada de novo mais tarde.
  echo   Veja o motivo no log abaixo.
) else if "%CODE%"=="124" (
  echo   TEMPO LIMITE atingido. O que ficou pendente sera retomado na proxima execucao.
) else if "%CODE%"=="130" (
  echo   INTERROMPIDO. O que ficou pendente sera retomado na proxima execucao.
) else if "%CODE%"=="143" (
  echo   INTERROMPIDO. O que ficou pendente sera retomado na proxima execucao.
) else (
  echo   ERRO ^(codigo %CODE%^). Veja o log abaixo e avise o responsavel tecnico.
)
if defined PUBLICAR_LOG_DIR (
  echo   Log: %PUBLICAR_LOG_DIR%
) else (
  echo   Log: %LOCALAPPDATA%\PortalBenvisi\logs
)
echo -----------------------------------------------
echo.
if not defined PUBLICAR_NOPAUSE pause
exit /b %CODE%
