@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao foi encontrado.
  echo Instale o Node.js 20 ou superior e tente novamente.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERRO] O npm nao foi encontrado junto com o Node.js.
  echo Reinstale o Node.js e tente novamente.
  exit /b 1
)

set "NEED_INSTALL=0"
if not exist "node_modules\express\package.json" set "NEED_INSTALL=1"
if not exist "node_modules\mercadopago\package.json" set "NEED_INSTALL=1"
if not exist "node_modules\pg\package.json" set "NEED_INSTALL=1"

if "%NEED_INSTALL%"=="1" (
  echo.
  echo Preparando as dependencias obrigatorias do projeto...
  if exist "package-lock.json" (
    call npm ci --no-audit --no-fund
  ) else (
    call npm install --no-audit --no-fund
  )
  if errorlevel 1 (
    echo.
    echo [ERRO] Nao foi possivel instalar as dependencias.
    echo Verifique a internet, DNS, proxy ou firewall e execute novamente.
    echo O servidor precisa de express, mercadopago e pg para iniciar.
    exit /b 1
  )
)

if not exist "node_modules\express\package.json" goto :missing
if not exist "node_modules\mercadopago\package.json" goto :missing
if not exist "node_modules\pg\package.json" goto :missing

exit /b 0

:missing
echo.
echo [ERRO] A instalacao ficou incompleta.
echo Exclua a pasta node_modules e execute este arquivo novamente.
exit /b 1
