@echo off
echo Starting SK Hynix AI Agent + Dashboard...

start "FastAPI (port 8000)" cmd /k "cd /d %~dp0agent && uvicorn main:app --reload --port 8000"
timeout /t 2 /nobreak >nul
start "Dashboard (port 5173)" cmd /k "cd /d %~dp0dashboard && npm run dev"

echo.
echo FastAPI : http://localhost:8000
echo Dashboard: http://localhost:5173
echo.
pause