@echo off
chcp 65001 >nul
setlocal

echo ======================================================
echo Telegram Price Bot - Cloudflare Webhook Patch v3.1.0
echo ======================================================

echo This patch updates src\index.js and test\bot.test.js only.
echo It DOES NOT overwrite wrangler.jsonc or your D1 database_id.
echo.

if not exist "src\index.js" (
  echo ERROR: Run this patch from the existing bot project folder.
  pause
  exit /b 1
)

if not exist "patch-files\src\index.js" (
  echo ERROR: patch-files folder is missing.
  pause
  exit /b 1
)

copy /Y "src\index.js" "src\index.js.backup" >nul
copy /Y "patch-files\src\index.js" "src\index.js" >nul
if exist "patch-files\test\bot.test.js" copy /Y "patch-files\test\bot.test.js" "test\bot.test.js" >nul
copy /Y "patch-files\README-CLOUDFLARE-WEBHOOK-FA.md" ".\README-CLOUDFLARE-WEBHOOK-FA.md" >nul

echo.
echo Patch applied. Running tests...
call npm test

echo.
echo If tests pass, run:
echo   npx wrangler secret put WEBHOOK_SETUP_SECRET
echo   npx wrangler deploy
echo.
pause
