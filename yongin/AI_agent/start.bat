@echo off
chcp 65001 >nul
echo === SK Hynix Field Health Agent ===

start "Backend"  /d "%~dp0backend"  cmd /k "python -m uvicorn main:app --reload --port 8080"
timeout /t 2 /nobreak >nul
start "Frontend" /d "%~dp0frontend" cmd /k "python -m http.server 7700"
timeout /t 2 /nobreak >nul
