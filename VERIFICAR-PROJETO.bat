@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

call PREPARAR-DEPENDENCIAS.bat
if errorlevel 1 (
  echo.
  echo A verificacao foi interrompida porque as dependencias nao foram instaladas.
  pause
  exit /b 1
)

call npm run verify
if errorlevel 1 (
  echo.
  echo [ERRO] A verificacao encontrou falhas. Leia as mensagens acima.
  pause
  exit /b 1
)

call npm run admin:check-default
if errorlevel 1 (
  echo.
  echo [ERRO] A senha administrativa padrao nao foi validada.
  pause
  exit /b 1
)

echo.
echo [OK] Projeto e acesso administrativo validados.
pause
