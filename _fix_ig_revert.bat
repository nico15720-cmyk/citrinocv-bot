@echo off
cd /d C:\Users\Lenovo\Claude\citrino-bot
git add bot/sender.js
git commit -m "fix: revertir a /me/messages para Instagram"
git push origin main
echo.
echo === Deploy enviado! ===
pause
