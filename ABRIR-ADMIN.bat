@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:3000/api/health; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }"
if errorlevel 1 (
  if not exist ".env" copy ".env.example" ".env" >nul
  call PREPARAR-DEPENDENCIAS.bat
  if errorlevel 1 (
    pause
    exit /b 1
  )
  echo Iniciando o servidor...
  start "INTEGRALL Server" cmd /k "cd /d ""%~dp0"" && npm run dev"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; 1..30 | ForEach-Object { try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:3000/api/health; if($r.StatusCode -eq 200){$ok=$true; break} } catch {}; Start-Sleep -Seconds 1 }; if($ok){exit 0}else{exit 1}"
  if errorlevel 1 (
    echo [ERRO] O servidor nao iniciou. Consulte a janela "INTEGRALL Server".
    pause
    exit /b 1
  )
)

start "" "http://localhost:3000/admin"
echo.
echo E-mail: deixe em branco
echo Use a credencial administrativa configurada para este ambiente.
pause
