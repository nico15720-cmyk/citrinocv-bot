@echo off
cd /d C:\Users\Lenovo\Claude\citrino-bot

echo ========================================
echo  DEPLOY: Fix Instagram sender
echo ========================================
echo.

git add bot/sender.js
git commit -m "fix: Instagram sender - /me/messages hardcoded + mejor logging"
git push origin main

echo.
echo ========================================
echo  Deploy enviado a Railway!
echo  Railway va a reiniciar automaticamente.
echo ========================================
echo.
echo Abriendo Railway para verificar logs...
start https://railway.app

pause
