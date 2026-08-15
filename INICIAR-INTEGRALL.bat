@echo off
chcp 65001 >nul
cd /d "%~dp0"
title INTEGRALL - Inicializador

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao foi encontrado. Instale o Node.js e tente novamente.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias pela primeira vez...
  call npm install
  if errorlevel 1 (
    echo Falha ao instalar dependencias.
    pause
    exit /b 1
  )
)

echo Iniciando a INTEGRALL...
start "INTEGRALL Server" cmd /k "cd /d ""%~dp0"" && npm run dev"
timeout /t 3 /nobreak >nul
start "" "http://localhost:3000"

echo.
echo Loja aberta em http://localhost:3000
echo Para o painel administrativo, execute ABRIR-ADMIN.bat
pause
