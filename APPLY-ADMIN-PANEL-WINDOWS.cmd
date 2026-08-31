@echo off
setlocal
cd /d "%~dp0"

echo ======================================================
echo Telegram Price Bot - Admin Panel Patch v3.2.0
echo ======================================================

if not exist "src\index.js" (
  echo [ERROR] Copy this CMD and the patch-files folder into your existing bot project first.
  pause
  exit /b 1
)

if not exist "patch-files\src\index.js" (
  echo [ERROR] patch-files\src\index.js not found.
  pause
  exit /b 1
)

echo [1/3] Backing up current files...
copy /Y "src\index.js" "src\index.before-admin-panel.bak.js" >nul
if exist "test\bot.test.js" copy /Y "test\bot.test.js" "test\bot.test.before-admin-panel.bak.js" >nul

echo [2/3] Applying admin panel patch...
copy /Y "patch-files\src\index.js" "src\index.js" >nul
copy /Y "patch-files\test\bot.test.js" "test\bot.test.js" >nul
copy /Y "patch-files\README-ADMIN-PANEL-FA.md" "README-ADMIN-PANEL-FA.md" >nul

echo [3/3] Running tests...
call npm test
if errorlevel 1 (
  echo.
  echo [ERROR] Tests failed. Restore the .bak.js files if needed.
  pause
  exit /b 1
)

echo.
echo ======================================================
echo PATCH COMPLETE - 28 tests should pass.
echo Next:
echo   1. npx wrangler deploy
echo   2. Re-run /admin/setup-webhook once to enable callback_query
 echo  3. Send /start to the bot once
 echo  4. Use the permanent Admin Panel buttons
 echo ======================================================
pause
