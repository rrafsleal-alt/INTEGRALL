@echo off
chcp 65001 >nul
cd /d "%~dp0"
title INTEGRALL - PostgreSQL Local

where docker >nul 2>nul
if errorlevel 1 (
  echo Docker nao foi encontrado.
  echo Instale o Docker Desktop ou use o banco PostgreSQL da Render em producao.
  pause
  exit /b 1
)

echo Iniciando PostgreSQL local...
docker compose up -d postgres
if errorlevel 1 (
  echo Nao foi possivel iniciar o PostgreSQL.
  pause
  exit /b 1
)

powershell -NoProfile -Command "$p='.env'; $s=Get-Content $p -Raw; $url='DATABASE_URL=postgresql://integrall:integrall_local_2026@localhost:5433/integrall'; if($s -match '(?m)^DATABASE_URL=.*$'){ $s=[regex]::Replace($s,'(?m)^DATABASE_URL=.*$',$url) } else { $s += \"`r`n$url`r`n\" }; Set-Content -Path $p -Value $s -Encoding utf8"

echo PostgreSQL configurado em localhost:5433.
echo Aguarde alguns segundos e execute INICIAR-INTEGRALL.bat.
pause
