@echo off
cd /d "%~dp0"
docker compose stop postgres
pause
