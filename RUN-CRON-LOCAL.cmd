@echo off
setlocal
chcp 65001 >nul

echo Calling the local scheduled handler on port 8787...
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing 'http://localhost:8787/__scheduled?cron=*+*+*+*+*' | Select-Object -ExpandProperty Content } catch { Write-Host $_.Exception.Message; exit 1 }"
echo.
pause
