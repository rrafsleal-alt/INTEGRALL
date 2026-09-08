@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title INTEGRALL - Inicializador

if not exist ".env" copy ".env.example" ".env" >nul

call PREPARAR-DEPENDENCIAS.bat
if errorlevel 1 (
  echo.
  echo A INTEGRALL nao foi iniciada porque faltam dependencias.
  pause
  exit /b 1
)

echo.
echo Iniciando a INTEGRALL...
start "INTEGRALL Server" cmd /k "cd /d ""%~dp0"" && npm run dev"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; 1..30 | ForEach-Object { try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:3000/api/health; if($r.StatusCode -eq 200){$ok=$true; break} } catch {}; Start-Sleep -Seconds 1 }; if($ok){exit 0}else{exit 1}"
if errorlevel 1 (
  echo.
  echo [ERRO] O servidor nao respondeu em http://localhost:3000/api/health.
  echo Verifique a janela "INTEGRALL Server" para identificar a mensagem de erro.
  pause
  exit /b 1
)

start "" "http://localhost:3000"

echo.
echo Loja aberta em http://localhost:3000
echo Area de personalizacao: http://localhost:3000/admin
echo Use a credencial administrativa configurada para este ambiente.
pause
