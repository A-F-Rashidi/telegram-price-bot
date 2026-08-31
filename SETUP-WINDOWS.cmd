@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo ======================================================
echo Telegram Price Bot - Windows Setup
echo ======================================================

echo [1/5] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: Node.js was not found.
  echo Install Node.js LTS first, then run this file again.
  pause
  exit /b 1
)
node --version

echo.
echo [2/5] Installing npm dependencies...
call npm install
if errorlevel 1 goto :fail

echo.
echo [3/5] Creating .dev.vars if needed...
if not exist ".dev.vars" (
  copy /Y ".dev.vars.example" ".dev.vars" >nul
  echo Created .dev.vars. Open it and enter your Telegram values.
) else (
  echo .dev.vars already exists; leaving it unchanged.
)

echo.
echo [4/5] Initializing LOCAL D1 database...
call npx wrangler d1 execute telegram-price-bot-db --local --file=./schema.sql
if errorlevel 1 goto :fail

echo.
echo [5/5] Running project tests...
call npm test
if errorlevel 1 goto :fail

echo.
echo ======================================================
echo SETUP COMPLETE
echo 1. Open .dev.vars in Notepad and enter your values.
echo 2. Double-click RUN-WINDOWS.cmd to start the Worker.
echo 3. Open http://localhost:8787/health
echo ======================================================
pause
exit /b 0

:fail
echo.
echo SETUP FAILED. Read the error shown above.
pause
exit /b 1
