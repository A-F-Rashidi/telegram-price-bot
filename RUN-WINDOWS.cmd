@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

if not exist "node_modules" (
  echo node_modules not found. Run SETUP-WINDOWS.cmd first.
  pause
  exit /b 1
)

if not exist ".dev.vars" (
  echo .dev.vars not found. Run SETUP-WINDOWS.cmd first.
  pause
  exit /b 1
)

echo Starting Cloudflare Worker locally...
echo Health: http://localhost:8787/health
echo Manual cron: http://localhost:8787/__scheduled?cron=*+*+*+*+*
echo Press Ctrl+C to stop.
echo.
call npm run dev
