@echo off
echo Starting SK Hynix Dashboard + AI Agent...
echo.

echo [1/2] FastAPI Agent (port 8000)...
start "Agent (8000)" cmd /k "cd /d %~dp0backend && uvicorn main:app --port 8000"
timeout /t 2 /nobreak >nul

echo [2/2] Dashboard (port 5173)...
start "Dashboard (5173)" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo ===================================================
echo   Agent API : http://localhost:8000
echo   Dashboard : http://localhost:5173   ^<-- OPEN THIS
echo ===================================================
echo.
pause